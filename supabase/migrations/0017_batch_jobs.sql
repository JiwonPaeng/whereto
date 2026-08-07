-- 0017_batch_jobs.sql
-- M1 일 배치 (§13.3, §9.6)
--   일 단위: rating 스냅샷 + 순위, age_years/vote_weight 재계산
--   분 단위: materialized view refresh (랭킹 10분 / 인기글 5분)
--
-- bias_score(§8.3)·reputation_mult(§7.1) 재계산은 M2/M3 이므로 아직 넣지 않는다.

-- 데이터 정정: 괄호 표기 제거 (유일 사례)
update programs p
set display_name = '융합인문사회과학부'
from universities u
where u.id = p.university_id
  and u.name = '연세대학교'
  and p.display_name = '융합인문사회과학부(HASS)';


-- ═══ 배치 함수 ═══════════════════════════════════════════════════════════

-- §4.3 지수 변동 추이 그래프 + §4.2 순위 변동의 원천.
-- MV 에 의존하지 않고 ratings 에서 직접 계산한다 — MV 갱신 순서에 얽히지 않기 위해서다.
create or replace function batch_daily_snapshot()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_provisional numeric;
begin
  select value_num into v_provisional from app_config where key = 'badge.provisional_threshold';

  insert into rating_history (program_id, snapshot_date, elo, rank_overall, rank_faculty, vote_count)
  select
    x.program_id,
    current_date,
    x.elo,
    -- §4.2.2 잠정 Program 은 순위를 부여하지 않는다
    case when x.provisional then null
         else rank() over (partition by x.provisional order by x.elo desc) end,
    case when x.provisional then null
         else rank() over (partition by x.provisional, x.faculty_group order by x.elo desc) end,
    x.vote_count
  from (
    select p.id as program_id, p.faculty_group, r.elo, r.vote_count,
           (r.vote_count < v_provisional) as provisional
    from programs p
    join ratings r      on r.program_id = p.id
    join universities u on u.id = p.university_id
    where p.is_active and u.is_active
  ) x
  on conflict (program_id, snapshot_date) do update
    set elo          = excluded.elo,
        rank_overall = excluded.rank_overall,
        rank_faculty = excluded.rank_faculty,
        vote_count   = excluded.vote_count;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function batch_daily_snapshot() is
  '§9.6 일 단위 rating 스냅샷. 같은 날 재실행하면 덮어쓴다.';


-- §5.3 나이는 매일 바뀐다. age_years 를 다시 계산하면 트리거(profiles_sync_age)가
-- vote_weight 도 함께 갱신한다. 현재는 D-004 로 보류 중이라 전원 1.0 이 유지된다.
create or replace function batch_recompute_profile_weights()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update profiles
  set age_years = extract(year from age(current_date, birth_date))::integer
  where birth_date is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- §13.3 실시간성보다 읽기 부하 방어가 중요하다.
create or replace function refresh_ranking_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently mv_ranking_overall;
end;
$$;

create or replace function refresh_hot_posts_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently mv_hot_posts;
end;
$$;

revoke all on function batch_daily_snapshot()             from public, anon, authenticated;
revoke all on function batch_recompute_profile_weights()  from public, anon, authenticated;
revoke all on function refresh_ranking_mv()               from public, anon, authenticated;
revoke all on function refresh_hot_posts_mv()             from public, anon, authenticated;


-- ═══ 랭킹 MV 재생성 — 순위 변동(§4.2) 추가 ═══════════════════════════════
drop materialized view if exists mv_ranking_overall;

create materialized view mv_ranking_overall as
with cfg as (
  select
    max(value_num) filter (where key = 'badge.provisional_threshold') as provisional,
    max(value_num) filter (where key = 'badge.low_sample_threshold')  as low_sample
  from app_config
),
base as (
  select
    p.id                as program_id,
    u.id                as university_id,
    u.name              as university_name,
    u.short_name        as university_short_name,
    u.campus,
    u.logo_url,
    u.region_group,
    p.faculty_group,
    p.display_name,
    r.elo,
    r.vote_count,
    r.win_count,
    case when r.vote_count > 0
         then round(r.win_count::numeric / r.vote_count, 4)
         else null end  as win_rate,
    case
      when r.vote_count < cfg.provisional then '잠정'
      when r.vote_count < cfg.low_sample  then '표본 부족'
      else null
    end                 as confidence
  from programs p
  join universities u on u.id = p.university_id
  join ratings r      on r.program_id = p.id
  cross join cfg
  where p.is_active and u.is_active
),
ranked as (
  select
    base.*,
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정') order by elo desc) end as rank_overall,
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정'), faculty_group order by elo desc) end as rank_faculty,
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정'), region_group order by elo desc) end as rank_region
  from base
)
select
  ranked.*,
  prev.rank_overall as rank_overall_prev,
  -- 양수 = 순위 상승(숫자가 작아짐) → ▲
  case when ranked.rank_overall is null or prev.rank_overall is null then null
       else prev.rank_overall - ranked.rank_overall end as rank_delta
from ranked
left join lateral (
  select rh.rank_overall
  from rating_history rh
  where rh.program_id = ranked.program_id
    and rh.snapshot_date < current_date
  order by rh.snapshot_date desc
  limit 1
) prev on true;

create unique index mv_ranking_overall_pk on mv_ranking_overall (program_id);
create index mv_ranking_overall_elo_idx     on mv_ranking_overall (elo desc);
create index mv_ranking_overall_faculty_idx on mv_ranking_overall (faculty_group, elo desc);
create index mv_ranking_overall_region_idx  on mv_ranking_overall (region_group, elo desc);

comment on materialized view mv_ranking_overall is
  '§9.6 랭킹. 계열·지역 순위와 전일 대비 순위 변동을 함께 담는다. 학과 단위 순위는 없다 (D-007).';

grant select on mv_ranking_overall to anon, authenticated;


-- ═══ pg_cron 스케줄 ══════════════════════════════════════════════════════
create extension if not exists pg_cron;

-- 재적용 가능하도록 같은 이름의 기존 잡을 먼저 지운다.
do $$
declare j text;
begin
  for j in
    select jobname from cron.job
    where jobname in ('daily-rating-snapshot', 'daily-profile-weights',
                      'refresh-ranking-mv', 'refresh-hot-posts-mv')
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- pg_cron 은 UTC 로 돈다. 18:00 UTC = 03:00 KST — 트래픽이 가장 적은 시간대.
select cron.schedule('daily-rating-snapshot',  '0 18 * * *',  $$select batch_daily_snapshot()$$);
select cron.schedule('daily-profile-weights',  '10 18 * * *', $$select batch_recompute_profile_weights()$$);

-- §9.6 랭킹 10분 / 인기글 5분
select cron.schedule('refresh-ranking-mv',   '*/10 * * * *', $$select refresh_ranking_mv()$$);
select cron.schedule('refresh-hot-posts-mv', '*/5 * * * *',  $$select refresh_hot_posts_mv()$$);
