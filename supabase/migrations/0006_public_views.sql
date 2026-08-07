-- 0006_public_views.sql
-- 기획서 §4.1.2 (익명 정책), §6.2 (프로필 공개 영역), §9.6 (Materialized View)
--
-- ⚠️ 이 파일이 "타 유저에게 무엇이 보이는가"의 유일한 경계선이다.
--
-- 왜 뷰인가: votes 의 RLS 는 "본인 행만 SELECT" 다. 공개된 이유는 타 유저도 봐야 하는데,
-- votes 에 공개 행 SELECT 정책을 여는 방식은 쓸 수 없다 — 그러면 같은 행의 weight_applied
-- (연령대가 역산된다), response_ms, elo_* 까지 함께 노출된다. 행 단위 정책으로는 컬럼을
-- 가릴 수 없으므로, 노출 컬럼을 명시적으로 고정한 뷰만 공개한다.
--
-- 이 뷰들은 security_invoker 를 켜지 않는다(= 뷰 소유자 권한으로 실행). 의도된 설계다.
-- Supabase security advisor 가 "Security Definer View" 로 경고하지만, 여기서는 그것이
-- 정확히 필요한 동작이다. 대신 뷰가 내보내는 컬럼을 최소로 고정해 위험을 좁힌다.

-- §6.2 프로필 공개 영역: 닉네임, 가입 시기, 평판 점수.
-- birth_date / age_years / bias_score / trust_coeff / vote_weight 는 절대 나가지 않는다.
create or replace view public_profiles as
select
  p.id,
  p.nickname,
  p.created_at,
  p.reputation_raw
from profiles p
where not p.is_banned;

comment on view public_profiles is '§6.2 프로필 공개 영역. 연령·가중치·편향 스코어는 노출하지 않는다.';

-- §4.1.1 / §4.3 / §6.2 공개 선택된 "이유".
-- 이유를 공개하는 순간 그 한 건의 선택은 드러난다 — 유저가 명시적으로 opt-in 한 결과다.
-- 공개하지 않은 투표는 여기 나오지 않으므로 §4.1.2 익명 정책은 유지된다.
create or replace view public_reasons as
select
  v.id            as vote_id,
  v.profile_id,
  pr.nickname,
  v.winner_id,
  case when v.winner_id = v.program_a_id then v.program_b_id else v.program_a_id end as loser_id,
  v.reason,
  v.reason_upvotes,
  v.reason_downvotes,
  v.created_at
from votes v
join profiles pr on pr.id = v.profile_id
where v.reason_public
  and v.reason is not null
  and v.is_valid
  and not pr.is_banned;

comment on view public_reasons is
  '§4.1.1 공개 선택된 이유만. weight_applied·response_ms·elo_* 는 컬럼 목록에서 제외되어 나가지 않는다.';

grant select on public_profiles to anon, authenticated;
grant select on public_reasons  to anon, authenticated;


-- §9.6 랭킹 Materialized View.
-- §4.2.2: 잠정(n < provisional_threshold) Program 은 순위를 부여하지 않는다 → rank 컬럼 null.
create materialized view if not exists mv_ranking_overall as
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
    u.logo_url,
    u.region_group,
    m.id                as major_id,
    m.name              as major_name,
    m.faculty_group,
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
  join majors m       on m.id = p.major_id
  join ratings r      on r.program_id = p.id
  cross join cfg
  where p.is_active and u.is_active
)
select
  base.*,
  case when confidence = '잠정' then null
       else rank() over (partition by (confidence = '잠정') order by elo desc) end as rank_overall,
  case when confidence = '잠정' then null
       else rank() over (partition by (confidence = '잠정'), faculty_group order by elo desc) end as rank_faculty,
  case when confidence = '잠정' then null
       else rank() over (partition by (confidence = '잠정'), region_group order by elo desc) end as rank_region
from base;

-- REFRESH ... CONCURRENTLY 에는 UNIQUE 인덱스가 필요하다.
create unique index if not exists mv_ranking_overall_pk on mv_ranking_overall (program_id);
create index if not exists mv_ranking_overall_elo_idx     on mv_ranking_overall (elo desc);
create index if not exists mv_ranking_overall_faculty_idx on mv_ranking_overall (faculty_group, elo desc);
create index if not exists mv_ranking_overall_region_idx  on mv_ranking_overall (region_group, elo desc);

comment on materialized view mv_ranking_overall is
  '§9.6 랭킹. 계열·지역 순위를 컬럼으로 함께 담아 별도 mv_ranking_faculty 를 두지 않는다 — 같은 데이터를 두 번 갱신할 이유가 없고, §4.3 상세 페이지가 세 순위를 한 번에 필요로 한다.';

-- §10.4 인기글
create materialized view if not exists mv_hot_posts as
select
  po.id as post_id,
  po.board_id,
  po.title,
  po.profile_id,
  po.upvotes,
  po.downvotes,
  po.created_at,
  (po.upvotes - po.downvotes - 1)
    / power(extract(epoch from (now() - po.created_at)) / 3600.0 + 2, 1.5) as score
from posts po
where not po.is_deleted;

create unique index if not exists mv_hot_posts_pk on mv_hot_posts (post_id);
create index if not exists mv_hot_posts_score_idx on mv_hot_posts (score desc);

grant select on mv_ranking_overall to anon, authenticated;
grant select on mv_hot_posts       to anon, authenticated;
