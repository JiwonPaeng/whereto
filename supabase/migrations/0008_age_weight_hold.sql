-- 0008_age_weight_hold.sql
-- 결정: §5.3 연령 가중치 "수집만, 적용은 보류" (2026-08-07)
--
-- 배경: 기획서 §2 는 연령을 카카오 로그인의 생년월일로 판정한다고 전제했으나,
-- 카카오가 생년월일·출생연도 동의항목을 비즈 앱 전환 뒤에만 열어준다.
--
-- 선택: 생년월일은 가입 시 직접 입력받아 수집하되, w_age 적용은 검증 수단이
-- 확보될 때까지 보류한다. 보류 중에는 로그인 유저 전원 w_age = 1.0.
--
-- 왜 안전한가 — 소급 계산에 필요한 정보가 전부 남는다:
--   birth_date      수정 불가 (grant update 목록에 없음) → 당시 만 나이 역산 가능
--   profile_changes status 변경 이력 + 타임스탬프 → N수 보정도 투표 시점 기준 복원 가능
--   votes           append-only + created_at + weight_applied (§5.7)
-- 따라서 shadow 컬럼 없이 나중에 전체 재계산이 가능하다.
--
-- 해제 방법: app_config 의 weight.age_enabled 를 1 로 바꾸면 즉시 §5.3 이 적용된다.
-- 코드 수정 불필요 (불변 원칙 4).

insert into app_config (key, value_num, description) values
  ('weight.age_enabled', 0,
   '§5.3 연령 가중치 적용 스위치. 0=보류(로그인 유저 전원 w_age=1.0), 1=적용. '
   '카카오 비즈 앱 전환으로 생년월일 검증이 확보되면 1 로 전환한다. '
   '보류 구간의 투표도 birth_date·profile_changes·votes.created_at 으로 소급 계산 가능하다.')
on conflict (key) do nothing;

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
  v_enabled   numeric;
  v_base      numeric;
  v_decay     numeric;
  v_floor     numeric;
  v_bonus     numeric;
  v_max_age   numeric;
  v_cooldown  numeric;
  v_weight    numeric;
begin
  select
    max(value_num) filter (where key = 'weight.age_enabled'),
    max(value_num) filter (where key = 'weight.age_base'),
    max(value_num) filter (where key = 'weight.age_decay'),
    max(value_num) filter (where key = 'weight.age_floor'),
    max(value_num) filter (where key = 'weight.retaker_bonus'),
    max(value_num) filter (where key = 'weight.retaker_max_age'),
    max(value_num) filter (where key = 'weight.retaker_cooldown_days')
  into v_enabled, v_base, v_decay, v_floor, v_bonus, v_max_age, v_cooldown
  from app_config;

  -- 보류 구간: 로그인 유저는 연령과 무관하게 1.0.
  -- 비로그인 투표(profile 없음)의 w_age = 0 은 vote_submit RPC 가 별도로 처리한다.
  if coalesce(v_enabled, 0) = 0 then
    return 1.0;
  end if;

  -- 생년월일 미상 → 지수 미반영
  if p_age is null then
    return 0;
  end if;

  if p_age <= 18 then
    v_weight := 1.0;
  else
    v_weight := greatest(v_floor, v_base - v_decay * (p_age - 19));
  end if;

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

revoke execute on function compute_age_weight(integer, text, timestamptz)
  from public, anon, authenticated;

-- 보류 스위치는 §8.6 공개 대상이 아니다 — 어뷰징 임계값과 달리 숨길 이유는 없으나,
-- weight.* 는 이미 공개 범위이므로 별도 조치 없이 그대로 노출된다.
