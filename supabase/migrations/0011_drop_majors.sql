-- 0011_drop_majors.sql
-- D-007 — 표준 학과(majors) 계층을 없애고 계열까지만 분류한다.
--
-- 근거: §5.4 매칭 정책은 major_id 를 쓰지 않는다. 계열과 ELO 만 쓴다.
--   1) 계열 선택 (90% 동일 / 10% 교차)
--   2) 계열 안에서 ELO 근접도 + 노출 형평성
-- §4.3 상세도 전체/계열/지역 순위만 요구하며 학과 단위 순위는 없다.
--
-- 부수 효과 (개선): faculty_group 이 programs 로 내려오면서 대학별 실제 소속을
-- 반영할 수 있게 된다. majors 에 있을 때는 대학 무관 단일 값이라
-- 통계학(서울대 자연과학대학 / 고려대 정경대학) 같은 학과를 한쪽으로 몰아야 했다.
--
-- 잃는 것: §4.2 "학과 검색"의 정규화. display_name 텍스트 검색으로는
-- '소프트웨어학부'가 '컴퓨터공학' 묶음에 걸리지 않는다.
-- 되돌릴 때는 programs.major_id 를 nullable 로 추가해 점진적으로 매핑하면 된다.

-- MV 가 majors 를 참조하므로 먼저 내린다.
drop materialized view if exists mv_ranking_overall;

alter table programs add column faculty_group text;

-- 기존 데이터 이관 (현재 programs 는 비어 있어 0행이지만 순서를 지킨다)
update programs p
set faculty_group = m.faculty_group
from majors m
where m.id = p.major_id;

alter table programs alter column faculty_group set not null;
alter table programs add constraint programs_faculty_group_check
  check (faculty_group in ('인문', '사회', '자연', '공학', '의약', '사범', '예체능'));

comment on column programs.faculty_group is
  '§3 계열. 해당 대학에서의 실제 소속을 반영한다 — 같은 학과명이라도 대학마다 다를 수 있다 (D-007).';

-- major_id 를 떼면 programs_major_idx 도 함께 사라진다.
alter table programs drop column major_id;
drop table majors;

-- §5.4 매칭 큐가 계열로 후보를 좁힌다.
create index if not exists programs_faculty_idx on programs (faculty_group) where is_active;


-- §9.6 랭킹 MV 재생성 — majors 조인 제거, faculty_group 은 programs 에서 읽는다.
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

create unique index mv_ranking_overall_pk on mv_ranking_overall (program_id);
create index mv_ranking_overall_elo_idx     on mv_ranking_overall (elo desc);
create index mv_ranking_overall_faculty_idx on mv_ranking_overall (faculty_group, elo desc);
create index mv_ranking_overall_region_idx  on mv_ranking_overall (region_group, elo desc);

comment on materialized view mv_ranking_overall is
  '§9.6 랭킹. 계열·지역 순위를 컬럼으로 함께 담는다 (D-003). 학과 단위 순위는 없다 (D-007).';

grant select on mv_ranking_overall to anon, authenticated;
