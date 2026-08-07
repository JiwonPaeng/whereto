-- 0001_master_data.sql
-- 기획서 §9.1 — 마스터 데이터 (대학 / 표준 학과 / Program)
--
-- 핵심 설계: majors(표준 학과) ↔ programs.display_name(실제 명칭) 분리.
-- 매칭·필터는 majors 기준, 화면 표시는 display_name 기준. (§9.1 주석)

create table if not exists universities (
  id            bigserial primary key,
  name          text not null unique,           -- '고려대학교'
  short_name    text,                           -- '고려대'
  region        text not null,                  -- '서울특별시 성북구' 등 실제 소재지
  region_group  text not null
    check (region_group in ('서울', '수도권', '광역시', '기타')),
  est_type      text check (est_type in ('국립', '사립')),
  logo_url      text,
  homepage_url  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table universities is '대학 마스터. 전면 수동 큐레이션 (§11.2) — 크롤링 금지.';
comment on column universities.region_group is '§4.2 지역 필터 기준';

-- 표준 학과: 대학과 무관하게 정규화된 학과 개념
create table if not exists majors (
  id             bigserial primary key,
  name           text not null unique,          -- '컴퓨터공학'
  faculty_group  text not null
    check (faculty_group in ('인문사회', '자연공학', '의약', '사범', '예체능')),
  category       text,                          -- 중분류
  created_at     timestamptz not null default now()
);

comment on table majors is '표준 학과. 매칭·필터의 기준이며 계열(faculty_group)을 보유한다.';

-- Program = (대학, 학과) — 랭킹의 최소 단위 (§3)
create table if not exists programs (
  id             bigserial primary key,
  university_id  bigint not null references universities (id) on delete restrict,
  major_id       bigint not null references majors (id) on delete restrict,
  display_name   text   not null,               -- 실제 학과 명칭 '컴퓨터학과'
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (university_id, major_id)
);

comment on table programs is 'Program = (대학, 학과). 랭킹의 최소 단위.';
comment on column programs.display_name is '해당 대학의 실제 학과 명칭. 표시 전용 — 매칭/필터에 쓰지 않는다.';

create index if not exists programs_university_idx on programs (university_id);
create index if not exists programs_major_idx      on programs (major_id);
-- 매칭 큐가 활성 Program만 훑는다 (§5.4)
create index if not exists programs_active_idx     on programs (id) where is_active;

alter table universities enable row level security;
alter table majors       enable row level security;
alter table programs     enable row level security;

-- 마스터 데이터는 전체 공개 읽기. 쓰기는 service_role 전용(정책 없음 = 거부).
create policy "universities read" on universities for select to anon, authenticated using (true);
create policy "majors read"       on majors       for select to anon, authenticated using (true);
create policy "programs read"     on programs     for select to anon, authenticated using (true);
