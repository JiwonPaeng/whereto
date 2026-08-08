create or replace function matchup_next(p_anon_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_track text;
  v_cross_rate numeric; v_close_rate numeric; v_coldstart_rate numeric;
  v_coldstart_th numeric; v_gap numeric; v_low_pct numeric; v_ttl numeric;
  v_arts_default numeric; v_arts_user numeric; v_arts_cross numeric;
  v_total_votes bigint;
  v_use_arts boolean; v_is_cross boolean; v_is_close boolean;
  v_a_pool text[]; v_b_pool text[];
  v_a bigint; v_b bigint; v_tmp bigint; v_a_fg text;
  v_relax int := 0;
  v_token uuid; v_expires timestamptz;
begin
  select
    max(value_num) filter (where key = 'match.cross_faculty_rate'),
    max(value_num) filter (where key = 'match.close_pair_rate'),
    max(value_num) filter (where key = 'match.coldstart_close_rate'),
    max(value_num) filter (where key = 'match.coldstart_threshold'),
    max(value_num) filter (where key = 'match.close_elo_gap'),
    max(value_num) filter (where key = 'match.low_exposure_pct'),
    max(value_num) filter (where key = 'token.ttl_minutes'),
    max(value_num) filter (where key = 'match.arts_rate_default'),
    max(value_num) filter (where key = 'match.arts_rate_arts_user'),
    max(value_num) filter (where key = 'match.arts_cross_rate')
  into v_cross_rate, v_close_rate, v_coldstart_rate, v_coldstart_th, v_gap, v_low_pct, v_ttl,
       v_arts_default, v_arts_user, v_arts_cross
  from app_config;

  select count(*) into v_total_votes from votes where is_valid;
  if v_total_votes < v_coldstart_th then v_close_rate := v_coldstart_rate; end if;

  if v_profile is not null then
    select track into v_track from profiles where id = v_profile;
  end if;

  v_use_arts := random() < (case when v_track = '예체능' then v_arts_user else v_arts_default end);

  if v_use_arts then
    v_is_cross := random() < v_arts_cross;
    v_a_pool := array['예체능'];
    v_b_pool := case when v_is_cross then array['인문','자연'] else array['예체능'] end;
  else
    v_is_cross := random() < v_cross_rate;
    v_a_pool := array['인문','자연'];
    v_b_pool := null;
  end if;

  v_is_close := random() < v_close_rate;

  if v_is_close then
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p where p.is_active and p.faculty_group = any(v_a_pool)
    order by random() limit 1;
  else
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p join ratings r on r.program_id = p.id
    where p.is_active and p.faculty_group = any(v_a_pool)
      and r.vote_count <= (
        select percentile_disc(v_low_pct) within group (order by r2.vote_count)
        from ratings r2 join programs p2 on p2.id = r2.program_id
        where p2.is_active and p2.faculty_group = any(v_a_pool))
    order by random() limit 1;
  end if;

  if v_a is null then
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p where p.is_active and p.faculty_group = any(v_a_pool)
    order by random() limit 1;
  end if;
  if v_a is null then return jsonb_build_object('error', 'no_programs'); end if;

  if v_b_pool is null then
    v_b_pool := case when v_is_cross
                     then array[case when v_a_fg = '인문' then '자연' else '인문' end]
                     else array[v_a_fg] end;
  end if;

  while v_b is null and v_relax <= 2 loop
    select p.id into v_b
    from programs p
    join ratings r on r.program_id = p.id
    cross join lateral (select elo from ratings where program_id = v_a) a
    where p.is_active and p.id <> v_a
      and (v_relax >= 2 or p.faculty_group = any(v_b_pool))
      and (v_relax >= 1 or not v_is_close or abs(r.elo - a.elo) <= v_gap)
      -- §4.1 이미 투표한 쌍 제외. 비로그인은 anon_id 기준 (D-016)
      and (
        (v_profile is null and p_anon_id is null)
        or not exists (
          select 1 from votes v
          where ((v_profile is not null and v.profile_id = v_profile)
                 or (v_profile is null and v.anon_id = p_anon_id and v.profile_id is null))
            and least(v.program_a_id, v.program_b_id) = least(v_a, p.id)
            and greatest(v.program_a_id, v.program_b_id) = greatest(v_a, p.id))
      )
    order by random() limit 1;
    v_relax := v_relax + 1;
  end loop;

  if v_b is null then return jsonb_build_object('exhausted', true); end if;

  if random() < 0.5 then v_tmp := v_a; v_a := v_b; v_b := v_tmp; end if;

  v_expires := now() + make_interval(mins => v_ttl::int);
  insert into matchup_tokens (profile_id, program_a_id, program_b_id, expires_at)
  values (v_profile, v_a, v_b, v_expires) returning token into v_token;

  return jsonb_build_object(
    'token', v_token, 'expires_at', v_expires,
    'a', (select jsonb_build_object('id', p.id, 'display_name', p.display_name,
            'faculty_group', p.faculty_group, 'university', u.name, 'short_name', u.short_name,
            'campus', u.campus, 'region_group', u.region_group, 'logo_url', u.logo_url)
          from programs p join universities u on u.id = p.university_id where p.id = v_a),
    'b', (select jsonb_build_object('id', p.id, 'display_name', p.display_name,
            'faculty_group', p.faculty_group, 'university', u.name, 'short_name', u.short_name,
            'campus', u.campus, 'region_group', u.region_group, 'logo_url', u.logo_url)
          from programs p join universities u on u.id = p.university_id where p.id = v_b)
  );
end;
$$;

drop function if exists matchup_next();
revoke all on function matchup_next(uuid) from public;
grant execute on function matchup_next(uuid) to anon, authenticated;


drop materialized view if exists mv_ranking_overall;

create materialized view mv_ranking_overall as
with cfg as (
  select
    max(value_num) filter (where key = 'badge.provisional_threshold') as provisional,
    max(value_num) filter (where key = 'badge.low_sample_threshold')  as low_sample,
    max(value_num) filter (where key = 'elo.shrinkage_k')             as shrink_k
  from app_config
),
base as (
  select
    p.id as program_id, u.id as university_id, u.name as university_name,
    u.short_name as university_short_name, u.campus, u.logo_url, u.region_group,
    p.faculty_group, p.display_name,
    r.elo, r.vote_count, r.win_count,
    ur.elo as university_elo,
    -- D-016 표시용 shrinkage. 저장값(r.elo)은 건드리지 않는다.
    -- n=0 이면 소속 대학 값, n 이 커지면 자기 값으로 풀린다.
    round((r.vote_count * r.elo + cfg.shrink_k * ur.elo) / nullif(r.vote_count + cfg.shrink_k, 0))::integer
      as elo_display,
    case when r.vote_count > 0 then round(r.win_count::numeric / r.vote_count, 4) else null end as win_rate,
    case when r.vote_count < cfg.provisional then '잠정'
         when r.vote_count < cfg.low_sample  then '표본 부족' else null end as confidence
  from programs p
  join universities u        on u.id = p.university_id
  join ratings r             on r.program_id = p.id
  join university_ratings ur on ur.university_id = u.id
  cross join cfg
  where p.is_active and u.is_active
),
ranked as (
  select base.*,
    -- 순위는 표시값 기준. 화면 위치와 순위가 어긋나면 읽는 사람이 혼란스럽다.
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정') order by elo_display desc) end as rank_overall,
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정'), faculty_group order by elo_display desc) end as rank_faculty,
    case when confidence = '잠정' then null
         else rank() over (partition by (confidence = '잠정'), region_group order by elo_display desc) end as rank_region
  from base
)
select ranked.*, prev.rank_overall as rank_overall_prev,
  case when ranked.rank_overall is null or prev.rank_overall is null then null
       else prev.rank_overall - ranked.rank_overall end as rank_delta
from ranked
left join lateral (
  select rh.rank_overall from rating_history rh
  where rh.program_id = ranked.program_id and rh.snapshot_date < current_date
  order by rh.snapshot_date desc limit 1
) prev on true;

create unique index mv_ranking_overall_pk on mv_ranking_overall (program_id);
create index mv_ranking_overall_elo_idx     on mv_ranking_overall (elo_display desc);
create index mv_ranking_overall_faculty_idx on mv_ranking_overall (faculty_group, elo_display desc);
create index mv_ranking_overall_region_idx  on mv_ranking_overall (region_group, elo_display desc);

comment on materialized view mv_ranking_overall is
  '§9.6 랭킹. elo 는 저장된 Program ELO, elo_display 는 대학 ELO 로 shrink 한 표시값이다 (D-016).';

grant select on mv_ranking_overall to anon, authenticated;
