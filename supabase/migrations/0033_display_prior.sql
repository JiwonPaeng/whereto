-- 표시용 사전값(prior)
--
-- 적용 시점의 두 마이그레이션(display_prior, display_prior_tuning)을 최종 상태로 합쳤다.
--
-- 실제 ELO(ratings.elo · university_ratings.elo)는 건드리지 않는다 — 전부 1500 에서
-- 출발한 실측값 그대로다. 사전값은 **표시 계층에서만** 섞이고, 투표가 쌓이면 가중치가
-- 자동으로 줄어 실측값으로 대체된다. elo.prior_weight = 0 이면 완전히 꺼진다.
--
-- 값을 바꾸려면 아래 두 곳만 고치면 된다 (다음 MV 갱신에 반영):
--   · 대학 단위      → university_ratings.prior_elo
--   · 학과 보정      → programs.prior_offset
--   · 사전값 비중    → app_config 'elo.prior_weight'

alter table university_ratings
  add column if not exists prior_elo integer not null default 1500;

alter table programs
  add column if not exists prior_offset integer not null default 0;

comment on column university_ratings.prior_elo is
  '표시용 대학 사전값. 실측 ELO 와 섞여 elo_display 를 만든다. 실제 ELO 에는 영향 없음.';
comment on column programs.prior_offset is
  '표시용 학과 보정. 소속 대학 수준을 크게 벗어나는 학과(의예과 등)를 위한 값.';

insert into app_config (key, value_num, description) values
  ('elo.prior_weight', 200,
   '표시용 사전값의 가중치. univ_effective = (n×univ_elo + w×prior_elo)/(n+w). '
   '대학별 누적 표가 w 를 넘어서면 실측값이 우세해진다. 0 이면 사전값을 끈다')
on conflict (key) do update set value_num = excluded.value_num,
                                description = excluded.description;

update app_config
set description = '초기 점수. 모든 Program 동일. 실측 ELO 는 여기서 출발한다. '
                  '표시값의 사전값은 university_ratings.prior_elo 로 따로 둔다'
where key = 'elo.initial';

-- shrinkage 를 5 -> 12 로 올린다.
-- k=5 는 shrink 목표가 전부 1500 근처여서 정보가 없던 시절 값이다. 목표가 사전값으로
-- 바뀐 뒤에는 표 한 장이 표시값을 (prior-1500)/6 ≈ 86점씩 끌어내려 화면이 요동친다 —
-- 실제로 연세대 치의예과(표 0)가 의예과(표 1)보다 위에 표시됐다.
-- k=12 면 표 한 장의 영향이 약 32점으로 줄고, 표가 쌓이면 여전히 학과 값이 드러난다.
update app_config
set value_num = 12,
    description = '표시용 shrinkage 상수. elo_display = (n×program_elo + k×univ_prior)/(n+k). '
                  'n=k 에서 반반. 사전값이 정보를 담고 있으므로 k 를 너무 낮추면 표 한 장에 '
                  '화면이 크게 흔들린다. 0 이면 shrinkage 를 끈다'
where key = 'elo.shrinkage_k';


-- ── 대학 사전값 ─────────────────────────────────────────────────────────
update university_ratings ur set prior_elo = v.p
from (values
  ('서울대',1900),('연세대',1830),('고려대',1825),('성균관대',1765),('한양대',1755),
  ('서강대',1750),('중앙대',1700),('경희대',1685),('이화여대',1670),('한국외대',1655),
  ('서울시립대',1650),('건국대',1635),('부산대',1630),('경북대',1625),('동국대',1620),
  ('홍익대',1610),('인하대',1600),('서울과학기술대',1590),('숙명여대',1580),('충남대',1570),
  ('숭실대',1565),('세종대',1560),('아주대',1560),('한국항공대',1555),('전남대',1550),
  ('국민대',1545),('광운대',1540),('가톨릭대',1530),('단국대',1520),('충북대',1515),
  ('전북대',1515),('인천대',1510),('가천대',1505),('강원대',1500),('명지대',1500),
  ('경기대',1490),('상명대',1480),('한국공학대',1470),('한성대',1465),('서경대',1455),
  ('삼육대',1430)
) as v(name, p)
where ur.university_id = (
  select u.id from universities u
  where coalesce(u.short_name, u.name) = v.name limit 1
);


-- ── 학과 보정 ───────────────────────────────────────────────────────────
-- ⚠️ 완전 일치 정규식을 쓴다. like '%의예%' 로 시작했다가 고려대 '의학과' ·
--    중앙대 '의학부' · 서울대 '치의학과' 가 전부 빠졌고, 부분 일치로 넓히면
--    '바이오시스템의과학부' 같은 이름이 걸린다.
update programs set prior_offset = 0;

update programs set prior_offset = 260 where display_name ~ '^(의예과|의학과|의학부|의과대학)$';
update programs set prior_offset = 200 where display_name ~ '^(치의예과|치의학과|치의학부)$';
update programs set prior_offset = 155 where display_name ~ '^(한의예과|한의학과)$';
update programs set prior_offset = 150 where display_name ~ '^(수의예과|수의학과)$';
update programs set prior_offset = 120 where display_name ~ '^(약학과|약학부|약학계열|약학대학|제약학과|한약학과)$';
update programs set prior_offset =  90 where display_name ~ '^초등교육과$';
update programs set prior_offset =  45 where display_name ~ '^(간호학과|간호학부|간호대학)$';
update programs set prior_offset =  45
  where display_name ~ '컴퓨터|소프트웨어|인공지능|반도체|데이터사이언스'
    and prior_offset = 0;


-- ── MV: elo_display 에 사전값을 섞는다 ──────────────────────────────────
drop materialized view if exists mv_ranking_overall;

create materialized view mv_ranking_overall as
with cfg as (
  select
    max(value_num) filter (where key = 'badge.provisional_threshold') as provisional,
    max(value_num) filter (where key = 'badge.low_sample_threshold')  as low_sample,
    max(value_num) filter (where key = 'elo.shrinkage_k')             as shrink_k,
    coalesce(max(value_num) filter (where key = 'elo.prior_weight'), 0) as prior_w
  from app_config
),
base as (
  select
    p.id as program_id, u.id as university_id, u.name as university_name,
    u.short_name as university_short_name, u.campus, u.logo_url, u.region_group,
    p.faculty_group, p.display_name,
    r.elo, r.vote_count, r.win_count,
    ur.elo as university_elo,
    -- 대학 수준 추정값: 실측 대학 ELO 와 사전값을 대학별 누적 표로 가중 평균한다.
    -- 표가 쌓이면 사전값 비중이 줄어 자동으로 대체된다.
    ((ur.vote_count * ur.elo + cfg.prior_w * ur.prior_elo)
      / nullif(ur.vote_count + cfg.prior_w, 0)) + p.prior_offset as univ_effective,
    -- D-016 표시용 shrinkage. 저장값(r.elo)은 건드리지 않는다.
    -- n=0 이면 위의 대학 수준 추정값, n 이 커지면 학과 자기 값으로 풀린다.
    round((r.vote_count * r.elo + cfg.shrink_k *
            (((ur.vote_count * ur.elo + cfg.prior_w * ur.prior_elo)
              / nullif(ur.vote_count + cfg.prior_w, 0)) + p.prior_offset))
          / nullif(r.vote_count + cfg.shrink_k, 0))::integer as elo_display,
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
  '§9.6 랭킹. elo 는 실측 Program ELO, elo_display 는 대학 실측값 + 표시용 사전값으로 shrink 한 값.';

grant select on mv_ranking_overall to anon, authenticated;

select refresh_ranking_mv();
