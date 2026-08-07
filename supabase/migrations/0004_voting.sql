-- 0004_voting.sql
-- 기획서 §9.4 — 투표 / 지수. 불변 원칙 1(append-only)·3(서버 권위)의 물리적 강제 지점.

-- §8.2 매치업 토큰. 서버가 쌍을 정하고 발급한다. 클라이언트는 토큰만 되돌려준다.
create table if not exists matchup_tokens (
  token         uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles (id) on delete cascade,  -- 비로그인 체험 시 null (§2)
  program_a_id  bigint not null references programs (id) on delete restrict,
  program_b_id  bigint not null references programs (id) on delete restrict,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed      boolean not null default false,
  check (program_a_id <> program_b_id)
);

comment on table matchup_tokens is '§8.2 서버 발급 매치업 토큰. TTL 은 app_config token.ttl_minutes.';
create index if not exists matchup_tokens_profile_idx on matchup_tokens (profile_id, issued_at desc);
create index if not exists matchup_tokens_open_idx    on matchup_tokens (expires_at) where not consumed;


-- ⚠️ APPEND-ONLY (불변 원칙 1). 아래 트리거로 물리적으로 강제한다.
create table if not exists votes (
  id                bigserial primary key,
  profile_id        uuid   references profiles (id) on delete set null,
  program_a_id      bigint not null references programs (id) on delete restrict,
  program_b_id      bigint not null references programs (id) on delete restrict,
  winner_id         bigint not null references programs (id) on delete restrict,
  reason            text,
  reason_public     boolean not null default true,
  reason_upvotes    integer not null default 0,
  reason_downvotes  integer not null default 0,
  weight_applied    numeric not null,        -- w_age × c_trust × r_reputation (§5.7 재계산 전제)
  elo_a_before      integer not null,
  elo_b_before      integer not null,
  elo_a_delta       integer not null,        -- §5.2 각자의 K_base 적용 → 제로섬 아님
  elo_b_delta       integer not null,
  response_ms       integer,
  is_valid          boolean not null default true,
  created_at        timestamptz not null default now(),
  check (program_a_id <> program_b_id),
  check (winner_id in (program_a_id, program_b_id))
);

comment on table votes is
  'APPEND-ONLY (불변 원칙 1). UPDATE/DELETE 금지. 무효 처리는 is_valid=false 로만. profile_id 는 타 유저에게 절대 노출 금지 (§4.1.2).';
comment on column votes.profile_id is '비로그인 체험 투표는 null. weight_applied=0 으로 지수 미반영 (§5.3).';
comment on column votes.weight_applied is
  '투표 시점에 실제 적용된 가중치. 타임스탬프와 함께 Bradley-Terry 전체 재적합의 전제다 (§5.7).';
comment on column votes.elo_a_delta is
  '§9.4 는 elo_delta 단일 컬럼이나, §5.2 가 두 Program 에 각자의 K_base 를 적용하도록 규정해 제로섬이 깨진다. 재계산 가능성을 위해 양쪽을 각각 보존한다.';

-- §5.6 (유저, Program 쌍) 조합당 1회. 순서 무관하게 같은 쌍으로 취급한다.
-- 표현식 UNIQUE 는 제약이 아니라 인덱스로만 만들 수 있다.
create unique index if not exists votes_profile_pair_uniq
  on votes (profile_id, least(program_a_id, program_b_id), greatest(program_a_id, program_b_id))
  where profile_id is not null;

create index if not exists votes_program_a_idx on votes (program_a_id) where is_valid;
create index if not exists votes_program_b_idx on votes (program_b_id) where is_valid;
create index if not exists votes_winner_idx    on votes (winner_id)    where is_valid;
create index if not exists votes_created_idx   on votes (created_at desc);
-- §4.3 / §6.2 공개된 이유 모아보기
create index if not exists votes_public_reason_idx
  on votes (winner_id, reason_upvotes desc, created_at desc)
  where reason_public and reason is not null and is_valid;
-- §8.4 rate limit 조회
create index if not exists votes_profile_created_idx on votes (profile_id, created_at desc);


-- 불변 원칙 1 강제: DELETE 는 어떤 경우에도 불가.
create or replace function votes_block_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'votes 는 append-only 입니다. 삭제 대신 is_valid=false 로 무효 처리하십시오 (기획서 §5.6, 불변 원칙 1)'
    using errcode = 'restrict_violation';
end;
$$;

create trigger votes_block_delete_trg
  before delete on votes
  for each row execute function votes_block_delete();

-- 불변 원칙 1 강제: UPDATE 는 아래 4개 컬럼만 허용한다.
--   is_valid                        — 무효 처리 (§5.6)
--   reason_public                   — 공개 여부 사후 변경 (§6.2)
--   reason_upvotes/reason_downvotes — §7 반응 집계 (투표 내용이 아닌 파생 카운터)
create or replace function votes_block_update()
returns trigger
language plpgsql
as $$
declare
  v_mutable text[] := array['is_valid', 'reason_public', 'reason_upvotes', 'reason_downvotes'];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'votes 는 append-only 입니다. 변경 가능한 컬럼은 %  뿐입니다 (기획서 §5.6, 불변 원칙 1)',
      array_to_string(v_mutable, ', ')
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger votes_block_update_trg
  before update on votes
  for each row execute function votes_block_update();


-- §4.1 스킵은 투표가 아니다. 매칭 품질 지표로만 쌓는다.
create table if not exists skips (
  id            bigserial primary key,
  profile_id    uuid references profiles (id) on delete cascade,
  program_a_id  bigint not null references programs (id) on delete cascade,
  program_b_id  bigint not null references programs (id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists skips_profile_idx on skips (profile_id, created_at desc);


-- §7 공개된 이유에 대한 추천/비추천
create table if not exists reason_reactions (
  id          bigserial primary key,
  vote_id     bigint not null references votes (id) on delete cascade,
  profile_id  uuid   not null references profiles (id) on delete cascade,
  kind        text   not null check (kind in ('up', 'down')),
  down_reason text   check (down_reason in ('근거 없음', '비방', '스팸', '기타')),
  is_counted  boolean not null default true,   -- §7.4 보류/무효 처리용
  created_at  timestamptz not null default now(),
  unique (vote_id, profile_id),
  -- §7.4 비추천 시 사유 필수: "학교 선택"이 아니라 "논거 품질"을 평가하게 강제한다.
  check (kind = 'up' or down_reason is not null)
);
create index if not exists reason_reactions_vote_idx    on reason_reactions (vote_id);
create index if not exists reason_reactions_profile_idx on reason_reactions (profile_id, created_at desc);


-- 현재 지수. 프로그램마다 1행이며 programs INSERT 시 자동 생성된다.
create table if not exists ratings (
  program_id  bigint primary key references programs (id) on delete cascade,
  elo         integer not null,
  vote_count  integer not null default 0,
  win_count   integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists ratings_elo_idx        on ratings (elo desc);
create index if not exists ratings_vote_count_idx on ratings (vote_count);

create or replace function programs_init_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial numeric;
begin
  select value_num into v_initial from app_config where key = 'elo.initial';
  insert into ratings (program_id, elo)
  values (new.id, coalesce(v_initial, 1500)::integer)
  on conflict (program_id) do nothing;
  return new;
end;
$$;

create trigger programs_init_rating_trg
  after insert on programs
  for each row execute function programs_init_rating();


-- §4.3 지수 변동 추이 그래프의 원천. 일 배치가 채운다.
create table if not exists rating_history (
  program_id     bigint not null references programs (id) on delete cascade,
  snapshot_date  date   not null,
  elo            integer not null,
  rank_overall   integer,
  rank_faculty   integer,
  vote_count     integer not null default 0,
  primary key (program_id, snapshot_date)
);
create index if not exists rating_history_date_idx on rating_history (snapshot_date desc);


alter table matchup_tokens   enable row level security;
alter table votes            enable row level security;
alter table skips            enable row level security;
alter table reason_reactions enable row level security;
alter table ratings          enable row level security;
alter table rating_history   enable row level security;

-- §8.2 votes: 본인 행 SELECT 만. 타 유저의 votes 행은 어떤 경로로도 조회 불가.
-- 공개된 "이유"는 0006 의 전용 뷰로만 노출한다.
create policy "votes select own" on votes
  for select to authenticated using (profile_id = (select auth.uid()));

-- INSERT 는 vote_submit RPC(security definer)를 통해서만 이루어진다.
-- 직접 INSERT 를 열어두면 클라이언트가 ELO 값을 지정할 수 있게 되므로 정책을 두지 않는다 (불변 원칙 2).
revoke all on votes from anon, authenticated;
grant select on votes to authenticated;

-- 토큰은 발급받은 본인만 조회. 생성은 서버(RPC)만.
create policy "matchup_tokens select own" on matchup_tokens
  for select to authenticated using (profile_id = (select auth.uid()));
revoke all on matchup_tokens from anon, authenticated;
grant select on matchup_tokens to authenticated;

create policy "skips insert own" on skips
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "skips select own" on skips
  for select to authenticated using (profile_id = (select auth.uid()));

create policy "reason_reactions select own" on reason_reactions
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "reason_reactions insert own" on reason_reactions
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "reason_reactions delete own" on reason_reactions
  for delete to authenticated using (profile_id = (select auth.uid()));

-- 지수는 서비스의 공개 산출물이다.
create policy "ratings read"        on ratings        for select to anon, authenticated using (true);
create policy "rating_history read" on rating_history for select to anon, authenticated using (true);
