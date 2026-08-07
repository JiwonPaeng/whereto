-- 0010_program_identity_and_faculty_split.sql
-- D-006 — 두 가지 구조 수정. 기획서 §9.1 / §3 의 전제를 바꾼다.

-- ── 1. Program 의 정체성을 major_id 에서 display_name 으로 옮긴다 ────────────
--
-- 기존: UNIQUE (university_id, major_id)
--   → 한 대학에 표준 학과당 Program 이 하나뿐이라는 뜻이었다.
--     컴퓨터공학과와 인공지능학과가 공존하는 순간 둘 중 하나를 버려야 한다.
--     예외적 구성이 아니라 요즘 흔한 구성이다.
--
-- 변경: UNIQUE (university_id, display_name)
--   → 실제로 존재하는 (대학, 학과)가 사실이고, 표준 분류(major_id)는 그 위에 붙는 판단이다.
--     같은 major_id 를 가진 Program 이 한 대학에 여럿 존재할 수 있다.
--     "고려대 컴퓨터학과 vs 고려대 인공지능학과" 같은 매치업도 유효해진다.
--
-- major_id 는 NOT NULL 을 유지한다. 분류를 미루면 §5.4 매칭에서 그 Program 이 떠버린다.

alter table programs drop constraint programs_university_id_major_id_key;
alter table programs add constraint programs_university_display_key
  unique (university_id, display_name);

comment on column programs.major_id is
  '표준 분류. 한 대학에 같은 major_id 를 가진 Program 이 여럿일 수 있다 (컴퓨터공학과 + 인공지능학과).';
comment on constraint programs_university_display_key on programs is
  'Program 의 정체성은 실제 학과 명칭이다. 표준 분류로 식별하지 않는다 (D-006).';


-- ── 2. 계열을 5개에서 7개로 분리 ──────────────────────────────────────────
--
-- 인문사회 → 인문 / 사회,  자연공학 → 자연 / 공학
-- §3 이 정의한 5개 계열을 바꾼다. 인문학과 사회과학, 자연과학과 공학은
-- 지망 집단도 진로도 다른데 한 덩어리로 묶여 있었다.

alter table majors drop constraint majors_faculty_group_check;

update majors set faculty_group = case
  when name in ('국어국문', '영어영문', '사학', '철학') then '인문'
  when name in ('심리학', '사회학', '정치외교', '행정학',
                '경제학', '경영학', '통계학', '미디어커뮤니케이션', '법학') then '사회'
  when name in ('수학', '물리학', '화학', '생명과학', '식품영양학') then '자연'
  when name in ('컴퓨터공학', '전기전자공학', '기계공학', '화학공학', '신소재공학',
                '산업공학', '토목환경공학', '건축학', '항공우주공학') then '공학'
  else faculty_group
end
where faculty_group in ('인문사회', '자연공학');

alter table majors add constraint majors_faculty_group_check
  check (faculty_group in ('인문', '사회', '자연', '공학', '의약', '사범', '예체능'));

comment on column majors.faculty_group is
  '§3 계열. 대학과 무관한 표준 분류다 — 같은 학과가 대학마다 다른 단과대에 속해도 여기서는 하나로 정한다.';


-- ── 3. 유저 계열(profiles.track)도 같은 어휘로 ────────────────────────────
-- 랭킹 필터와 유저 프로필이 다른 어휘를 쓰면 §8.3 편향 분석에서 대조가 안 된다.

alter table profiles drop constraint profiles_track_check;

update profiles set track = case track
  when '인문사회' then '사회'
  when '자연공학' then '공학'
  else track
end
where track in ('인문사회', '자연공학');

alter table profiles add constraint profiles_track_check
  check (track in ('인문', '사회', '자연', '공학', '의약', '사범', '예체능'));


-- ── 4. 랭킹 MV 재생성 ────────────────────────────────────────────────────
-- faculty_group 값이 바뀌었으므로 rank_faculty 를 다시 계산한다.
refresh materialized view mv_ranking_overall;
