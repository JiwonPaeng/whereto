-- 0024_university_elo_and_anon_votes.sql
-- D-016 — 콜드스타트 대응: 대학 레벨 ELO + shrinkage, 비로그인 투표 반영
--
-- 문제: Program 2,056개를 21표로 나누고 있다. 모든 Program 이 '잠정'을 벗어나려면
-- 약 10,280표가 필요하다. 추정 대상을 41개 대학으로 낮추면 약 410표면 된다 (25배).
--
-- 원칙: 저장은 원본 ELO 를 그대로 둔다. shrinkage 는 **표시 계층**에서만 한다.
-- §5.7 Bradley-Terry 전환의 전제(전체 재계산 가능성)를 깨지 않기 위해서다.

-- ── 1. 설정 ──────────────────────────────────────────────────────────────
insert into app_config (key, value_num, description) values
  ('elo.shrinkage_k', 10,
   '표시용 shrinkage 상수. elo_display = (n×program_elo + k×univ_elo)/(n+k). '
   'n=0 이면 소속 대학 값, n≫k 면 자기 값. 0 으로 두면 shrinkage 를 끈다 (D-016)'),
  ('weight.anonymous', 0.3,
   '비로그인 투표의 weight_applied. 0 이면 지수 미반영(이전 동작)이다. '
   '초기 데이터 확보를 위해 열되 낮게 준다. 문제가 생기면 is_valid=false 로 무효화하고 재계산 (D-016)'),
  ('ratelimit.anon_votes_per_hour', 30, '비로그인 세션당 시간당 투표 상한 (D-016)'),
  ('ratelimit.anon_votes_per_day',  150, '비로그인 세션당 일일 투표 상한 (D-016)')
on conflict (key) do nothing;


-- ── 2. 대학 레벨 ELO ─────────────────────────────────────────────────────
create table if not exists university_ratings (
  university_id bigint primary key references universities (id) on delete cascade,
  elo           integer not null,
  vote_count    integer not null default 0,
  win_count     integer not null default 0,
  updated_at    timestamptz not null default now()
);

comment on table university_ratings is
  '§5 대학 레벨 ELO. 서로 다른 대학의 Program 이 맞붙을 때만 갱신된다 — 같은 대학 내 대결은 대학 간 우열 정보를 담지 않는다 (D-016).';

alter table university_ratings enable row level security;
create policy "university_ratings read" on university_ratings
  for select to anon, authenticated using (true);

create or replace function universities_init_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_initial numeric;
begin
  select value_num into v_initial from app_config where key = 'elo.initial';
  insert into university_ratings (university_id, elo)
  values (new.id, coalesce(v_initial, 1500)::integer)
  on conflict (university_id) do nothing;
  return new;
end;
$$;

drop trigger if exists universities_init_rating_trg on universities;
create trigger universities_init_rating_trg
  after insert on universities
  for each row execute function universities_init_rating();

revoke execute on function universities_init_rating() from public, anon, authenticated;

-- 기존 41개 대학 백필. 지금까지의 21표는 재생하지 않는다 — 노이즈 수준이고,
-- votes 가 남아 있으므로 필요해지면 언제든 재계산할 수 있다.
insert into university_ratings (university_id, elo)
select u.id, (select value_num from app_config where key = 'elo.initial')::integer
from universities u
on conflict (university_id) do nothing;


-- ── 3. 비로그인 투표 식별자 ──────────────────────────────────────────────
-- profile_id 가 없으면 중복을 막을 수단이 없다. proxy 가 심는 쿠키의 UUID 를 받아
-- 같은 쌍 재투표와 rate limit 의 기준으로 쓴다.
-- 쿠키는 지우면 그만이므로 권위 있는 방어가 아니다 — 문턱을 높이는 장치다.
alter table votes add column if not exists anon_id uuid;

comment on column votes.anon_id is
  '비로그인 투표의 세션 식별자(쿠키 기반). 권위 있는 신원이 아니라 중복·남용 문턱용이다 (D-016).';

create unique index if not exists votes_anon_pair_uniq
  on votes (anon_id, least(program_a_id, program_b_id), greatest(program_a_id, program_b_id))
  where anon_id is not null and profile_id is null;

create index if not exists votes_anon_created_idx
  on votes (anon_id, created_at desc) where anon_id is not null;
