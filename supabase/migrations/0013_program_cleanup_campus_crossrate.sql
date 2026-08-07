-- 0013_program_cleanup_campus_crossrate.sql
-- D-009 — Program 정리, 캠퍼스 구분 도입, 교차 계열 비율 50%

-- ── 1. 매치업 품질을 해치는 Program 제거 ──────────────────────────────────
--
-- 고려대 '공과대학': 단과대명이다. 기계공학부·전기전자공학부 등이 별도 Program 으로
--   있어 "고려대 공과대학 vs 고려대 기계공학부" 같은 포함관계 매치업이 생긴다.
--
-- 연세대 진리자유학부 / 언더우드학부 계열: 같은 학부의 계열별 모집단위가 Program 4개였다.
--   서로 매칭되면 의미가 없다. '언더우드학부' 하나만 인문으로 남긴다.

delete from programs p
using universities u
where u.id = p.university_id
  and (
    (u.name = '고려대학교' and p.display_name = '공과대학')
    or (u.name = '연세대학교' and p.display_name in (
      '진리자유학부', '진리자유학부(인문)', '언더우드학부(인문사회)'
    ))
  );

update programs p
set faculty_group = '인문'
from universities u
where u.id = p.university_id
  and u.name = '연세대학교'
  and p.display_name = '언더우드학부';


-- ── 2. 캠퍼스 구분 ────────────────────────────────────────────────────────
-- 현재 3개는 전부 본교다. 세종·미래 캠퍼스 추가 여부는 미정이지만,
-- 지금 구분을 넣어두면 나중에 '고려대학교(세종)' 같은 이름 꼼수를 쓰지 않아도 된다.

alter table universities add column campus text;

update universities set campus = case name
  when '서울대학교' then '관악'
  when '고려대학교' then '안암'
  when '연세대학교' then '신촌'
end;

alter table universities alter column campus set not null;

-- name 단독 UNIQUE 를 (name, campus) 로 교체한다. 제약 이름은 자동 생성이라 조회해서 지운다.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'universities'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (name)';
  if c is not null then
    execute format('alter table universities drop constraint %I', c);
  end if;
end $$;

alter table universities add constraint universities_name_campus_key unique (name, campus);

comment on column universities.campus is
  '캠퍼스 구분. 같은 대학의 분교를 별도 행으로 두기 위한 것 (D-009). 표시에는 캠퍼스가 둘 이상일 때만 쓴다.';


-- ── 3. 랭킹 MV 재생성 (campus 노출) ───────────────────────────────────────
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


-- ── 4. 교차 계열 비율 50% (§16 #7 결정) ──────────────────────────────────
-- 문이과 통합이 추세라 인문↔자연 비교의 의미가 커졌다는 판단.
-- 계열 간 점수 눈금을 잇는 교차 매치가 많아지므로 §4.2.1 의 구조적 한계도 완화된다.
--
-- 관찰 필요: 3분류에서 교차는 인문↔자연뿐 아니라 X↔예체능도 포함한다.
-- "성악과 vs 의예과" 같은 쌍은 §1.2 질문에 답하기 어려워 스킵률이 오를 수 있다.
-- M1 에서 skips 테이블로 계열 조합별 스킵률을 보고 재조정한다.

update app_config
set value_num = 0.50,
    description = '교차 계열 비율. §16 #7 결정으로 10%→50% (D-009). 문이과 통합 추세 반영. 계열 조합별 스킵률을 보고 재조정할 것.'
where key = 'match.cross_faculty_rate';
