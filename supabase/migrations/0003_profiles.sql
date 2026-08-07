-- 0003_profiles.sql
-- 기획서 §6 (유저/프로필), §5.3 (연령 가중치), §8.1 (진입 장벽)

create table if not exists profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  nickname          text not null unique,
  birth_date        date,
  age_years         integer,                 -- 일 배치로 재계산 (§9.3)
  status            text check (status in ('고1', '고2', '고3', 'N수', '대학생', '기타')),
  status_changed_at timestamptz,             -- §5.3 N수 보정 쿨다운 판정용
  track             text check (track in ('인문사회', '자연공학', '의약', '사범', '예체능')),

  -- 가중치 3축. 전부 배치가 산출한다. 유저가 직접 쓸 수 없도록 컬럼 GRANT 로 차단한다.
  vote_weight       numeric not null default 0,    -- w_age (§5.3)
  trust_coeff       numeric not null default 1.0,  -- c_trust (§8.3)
  reputation_raw    integer not null default 0,    -- §7.1
  reputation_mult   numeric not null default 1.0,  -- r_reputation (§7.1, 일 배치)
  bias_score        numeric,                       -- §8.3

  is_banned         boolean not null default false,
  banned_until      timestamptz,
  created_at        timestamptz not null default now()
);

comment on table profiles is '유저 프로필. 투표 기록은 votes 에 있으며 타 유저에게 노출되지 않는다 (§4.1.2).';
comment on column profiles.vote_weight is
  'w_age. 기본값 0 — 생년월일이 없으면 지수에 반영하지 않는다. 1.0 으로 두면 성인에게 만점 가중치가 새는 함정이 된다.';
comment on column profiles.trust_coeff is 'c_trust. §8.3 편향 탐지 배치가 1.0 → 0.7 → 0.4 → 0.1 로 감쇠시킨다.';

create table if not exists profile_changes (
  id          bigserial primary key,
  profile_id  uuid not null references profiles (id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now()
);

comment on table profile_changes is '§6.1 계열·신분 변경 이력. 어뷰징 탐지 신호 (§5.3).';
create index if not exists profile_changes_profile_idx on profile_changes (profile_id, changed_at desc);


-- §5.3 연령 가중치. 계수는 전부 app_config 에서 읽는다 (불변 원칙 4).
create or replace function compute_age_weight(
  p_age               integer,
  p_status            text,
  p_status_changed_at timestamptz
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base      numeric;
  v_decay     numeric;
  v_floor     numeric;
  v_bonus     numeric;
  v_max_age   numeric;
  v_cooldown  numeric;
  v_weight    numeric;
begin
  -- 생년월일 미상 → 지수 미반영 (§5.3 비로그인 투표와 동일 취급)
  if p_age is null then
    return 0;
  end if;

  select
    max(value_num) filter (where key = 'weight.age_base'),
    max(value_num) filter (where key = 'weight.age_decay'),
    max(value_num) filter (where key = 'weight.age_floor'),
    max(value_num) filter (where key = 'weight.retaker_bonus'),
    max(value_num) filter (where key = 'weight.retaker_max_age'),
    max(value_num) filter (where key = 'weight.retaker_cooldown_days')
  into v_base, v_decay, v_floor, v_bonus, v_max_age, v_cooldown
  from app_config;

  if p_age <= 18 then
    v_weight := 1.0;
  else
    v_weight := greatest(v_floor, v_base - v_decay * (p_age - 19));
  end if;

  -- N수생 보정: 만 19~21세 재수·삼수생은 실제 수험 당사자다.
  -- 자기신고 값이므로 (1) 연령 상한 (2) status 변경 후 쿨다운 두 장치를 건다.
  if p_status = 'N수'
     and p_age < v_max_age
     and (p_status_changed_at is null
          or p_status_changed_at <= now() - make_interval(days => v_cooldown::int))
  then
    v_weight := least(1.0, v_weight + v_bonus);
  end if;

  return v_weight;
end;
$$;


-- 만 14세 미만 차단 (§6.1, §12.2 개인정보보호법) + age_years·vote_weight 동기화.
-- CHECK 제약은 current_date 가 immutable 이 아니라 쓸 수 없어 트리거로 강제한다.
create or replace function profiles_sync_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.birth_date is not null then
    new.age_years := extract(year from age(current_date, new.birth_date))::integer;

    if new.age_years < 14 then
      raise exception '만 14세 미만은 가입할 수 없습니다 (개인정보보호법)'
        using errcode = 'check_violation';
    end if;
  else
    new.age_years := null;
  end if;

  -- status 변경 시점 기록 (N수 보정 쿨다운 기준)
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  elsif tg_op = 'INSERT' and new.status is not null then
    new.status_changed_at := now();
  end if;

  new.vote_weight := compute_age_weight(new.age_years, new.status, new.status_changed_at);
  return new;
end;
$$;

create trigger profiles_sync_age_trg
  before insert or update on profiles
  for each row execute function profiles_sync_age();


-- §6.1 계열·신분 변경 이력 기록
create or replace function profiles_log_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into profile_changes (profile_id, field, old_value, new_value)
    values (new.id, 'status', old.status, new.status);
  end if;

  if new.track is distinct from old.track then
    insert into profile_changes (profile_id, field, old_value, new_value)
    values (new.id, 'track', old.track, new.track);
  end if;

  if new.nickname is distinct from old.nickname then
    insert into profile_changes (profile_id, field, old_value, new_value)
    values (new.id, 'nickname', old.nickname, new.nickname);
  end if;

  return new;
end;
$$;

create trigger profiles_log_changes_trg
  after update on profiles
  for each row execute function profiles_log_changes();


alter table profiles        enable row level security;
alter table profile_changes enable row level security;

-- 본인 행만 조회·수정. 타 유저에게 보여줄 공개 필드는 별도 뷰로 노출한다 (0006).
create policy "profiles select own" on profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "profiles insert own" on profiles
  for insert to authenticated with check (id = (select auth.uid()));

create policy "profiles update own" on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 변경 이력은 본인만 열람. 쓰기는 트리거(security definer)만.
create policy "profile_changes select own" on profile_changes
  for select to authenticated using (profile_id = (select auth.uid()));

-- 컬럼 단위 권한: 가중치 3축을 유저가 직접 쓰지 못하게 막는다.
-- RLS 만으로는 "본인 행의 vote_weight 를 1.0 으로 올리는" 것을 막을 수 없다.
revoke all on profiles from anon, authenticated;
grant select on profiles to authenticated;
grant insert (id, nickname, birth_date, status, track) on profiles to authenticated;
grant update (nickname, status, track) on profiles to authenticated;
grant select on profile_changes to authenticated;
