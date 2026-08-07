-- 0005_community.sql
-- 기획서 §9.5 / §10 — 커뮤니티. 기능 자체는 M2(P1)이나 스키마는 M0 에서 함께 만든다.

create table if not exists boards (
  id           bigserial primary key,
  slug         text not null unique,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true
);

-- §10.1. 대학별 게시판은 어뷰징 리스크로 §16 #5 미결정 — 만들지 않는다.
insert into boards (slug, name, description, sort_order) values
  ('free',    '자유게시판',   '', 10),
  ('admission', '입시·진로',  '', 20),
  ('matchup', '매치업 토론',  '매치업 쌍마다 자동 생성되는 스레드 (§10.3)', 30)
on conflict (slug) do nothing;

create table if not exists posts (
  id           bigserial primary key,
  board_id     bigint not null references boards (id) on delete restrict,
  profile_id   uuid   references profiles (id) on delete set null,
  matchup_key  text,                       -- 'p{min_id}-{max_id}' — 매치업 스레드 연결 (§9.5)
  title        text not null,
  content      text not null,
  view_count   integer not null default 0,
  upvotes      integer not null default 0,
  downvotes    integer not null default 0,
  hot_score    numeric not null default 0,
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_board_idx   on posts (board_id, created_at desc) where not is_deleted;
create index if not exists posts_matchup_idx on posts (matchup_key) where matchup_key is not null;
create index if not exists posts_hot_idx     on posts (hot_score desc) where not is_deleted;
create index if not exists posts_profile_idx on posts (profile_id, created_at desc);

create trigger posts_updated_at
  before update on posts
  for each row execute function set_updated_at();

create table if not exists comments (
  id          bigserial primary key,
  post_id     bigint not null references posts (id) on delete cascade,
  profile_id  uuid   references profiles (id) on delete set null,
  parent_id   bigint references comments (id) on delete cascade,
  content     text not null,
  upvotes     integer not null default 0,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx    on comments (post_id, created_at);
create index if not exists comments_profile_idx on comments (profile_id, created_at desc);

-- §10.2 대댓글은 2 depth 까지.
create or replace function comments_enforce_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_parent bigint;
begin
  if new.parent_id is null then
    return new;
  end if;

  select parent_id into v_parent_parent from comments where id = new.parent_id;

  if v_parent_parent is not null then
    raise exception '댓글은 2 depth 까지만 허용됩니다 (기획서 §10.2)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger comments_enforce_depth_trg
  before insert or update on comments
  for each row execute function comments_enforce_depth();

create table if not exists post_reactions (
  id          bigserial primary key,
  profile_id  uuid   not null references profiles (id) on delete cascade,
  post_id     bigint not null references posts (id) on delete cascade,
  kind        text   not null check (kind in ('up', 'down')),
  created_at  timestamptz not null default now(),
  unique (profile_id, post_id)
);

create table if not exists comment_reactions (
  id          bigserial primary key,
  profile_id  uuid   not null references profiles (id) on delete cascade,
  comment_id  bigint not null references comments (id) on delete cascade,
  kind        text   not null check (kind in ('up', 'down')),
  created_at  timestamptz not null default now(),
  unique (profile_id, comment_id)
);

-- §11 / §12.2 신고 → 임시조치 절차 (정보통신망법상 게시판 운영자 의무)
create table if not exists reports (
  id           bigserial primary key,
  reporter_id  uuid not null references profiles (id) on delete cascade,
  target_type  text not null check (target_type in ('post', 'comment', 'reason', 'profile')),
  target_id    bigint not null,
  reason       text not null,
  detail       text,
  status       text not null default 'pending'
                 check (status in ('pending', 'reviewing', 'resolved', 'rejected')),
  handled_by   uuid references profiles (id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists reports_status_idx on reports (status, created_at);

-- §11.3 유저 Program 추가 신청. 자동 승인 없음 — 반드시 운영자 수동 승인.
create table if not exists program_requests (
  id               bigserial primary key,
  profile_id       uuid not null references profiles (id) on delete cascade,
  university_name  text not null,
  major_name       text not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected')),
  note             text,
  created_at       timestamptz not null default now(),
  handled_at       timestamptz
);
create index if not exists program_requests_status_idx on program_requests (status, created_at);


alter table boards            enable row level security;
alter table posts             enable row level security;
alter table comments          enable row level security;
alter table post_reactions    enable row level security;
alter table comment_reactions enable row level security;
alter table reports           enable row level security;
alter table program_requests  enable row level security;

create policy "boards read" on boards for select to anon, authenticated using (is_active);

-- §6.1 열람은 비로그인도 가능, 글쓰기는 로그인 필요.
create policy "posts read"       on posts for select to anon, authenticated using (not is_deleted);
create policy "posts insert own" on posts for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "posts update own" on posts for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

create policy "comments read"       on comments for select to anon, authenticated using (not is_deleted);
create policy "comments insert own" on comments for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "comments update own" on comments for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

create policy "post_reactions own" on post_reactions for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "comment_reactions own" on comment_reactions for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- 신고는 본인이 낸 것만 조회. 처리는 어드민(service_role).
create policy "reports insert own" on reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy "reports select own" on reports for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy "program_requests insert own" on program_requests for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "program_requests select own" on program_requests for select to authenticated
  using (profile_id = (select auth.uid()));

-- 집계 카운터는 유저가 직접 쓸 수 없게 막는다.
revoke all on posts from anon, authenticated;
grant select on posts to anon, authenticated;
grant insert (board_id, profile_id, matchup_key, title, content) on posts to authenticated;
grant update (title, content, is_deleted) on posts to authenticated;

revoke all on comments from anon, authenticated;
grant select on comments to anon, authenticated;
grant insert (post_id, profile_id, parent_id, content) on comments to authenticated;
grant update (content, is_deleted) on comments to authenticated;
