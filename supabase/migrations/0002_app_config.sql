-- 0002_app_config.sql
-- 기획서 §5.5 — 파라미터 외부화 (불변 원칙 4)
--
-- 알고리즘 임계값·가중치는 코드에 하드코딩하지 않는다. 전부 여기서 런타임 조회한다.
-- 초기값은 전부 "런칭 프리셋" 기준. 성숙 프리셋 전환은 자동이 아니라 운영자 판단이다 (§4.2.2).

create table if not exists app_config (
  key           text primary key,
  value_num     numeric,
  value_text    text,
  description   text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (value_num is not null or value_text is not null)
);

comment on table app_config is '알고리즘 파라미터. 하드코딩 금지 (불변 원칙 4). 어드민에서 수정 가능해야 한다.';

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_config_updated_at
  before update on app_config
  for each row execute function set_updated_at();

insert into app_config (key, value_num, description) values
  -- ELO (§5.1, §5.2) — 런칭 프리셋
  ('elo.initial',                1500, '초기 점수. 모든 Program 동일. 외부 지표 시딩 금지 (§5.1)'),
  ('elo.k_tier1_threshold',        10, 'K 1단계 경계 (누적 투표 수)'),
  ('elo.k_tier2_threshold',        40, 'K 2단계 경계'),
  ('elo.k_tier1',                  48, 'n < tier1_threshold 일 때 K_base'),
  ('elo.k_tier2',                  32, 'tier1 ≤ n < tier2 일 때 K_base'),
  ('elo.k_tier3',                  24, 'n ≥ tier2_threshold 일 때 K_base'),

  -- 연령 가중치 (§5.3)
  ('weight.age_base',            0.50, '만 19세 기준값'),
  ('weight.age_decay',           0.04, '연간 체감폭'),
  ('weight.age_floor',           0.10, '하한'),
  ('weight.retaker_bonus',       0.30, 'N수생 보정 (상한 1.0)'),
  ('weight.retaker_max_age',       23, '이 나이 이상은 N수 보정 미적용 (§5.3 남용 방지)'),
  ('weight.retaker_cooldown_days',  7, 'status 변경 후 이 기간 동안 보정 미적용 (§5.3)'),

  -- 매칭 큐 (§5.4)
  ('match.cross_faculty_rate',   0.10, '교차 계열 매칭 비율'),
  ('match.close_pair_rate',      0.70, '근접 쌍(ELO 차 ≤ 200) 비율'),
  ('match.close_elo_gap',         200, '근접 쌍 판정 ELO 차이'),
  ('match.coldstart_close_rate', 0.30, '콜드스타트 구간의 근접 쌍 비율'),
  ('match.coldstart_threshold',  5000, '전체 투표 수가 이 값 미만이면 콜드스타트'),
  ('match.low_exposure_pct',     0.20, '투표 수 하위 비율 — 노출 형평성 대상'),

  -- 신뢰도 배지 (§4.2.2) — 런칭 프리셋
  ('badge.provisional_threshold',  10, '잠정 경계. n < 이 값이면 순위 미부여'),
  ('badge.low_sample_threshold',   40, '표본 부족 경계'),
  ('badge.preset_review_votes', 50000, '전체 누적 투표가 이 값에 도달하면 성숙 프리셋 전환 검토 (자동 전환 아님)'),

  -- 평판 (§7.1, §7.4)
  ('reputation.max_multiplier',  1.15, 'r_reputation 상한'),
  ('reputation.min_multiplier',  0.85, 'r_reputation 하한'),
  ('reputation.amplitude',       0.15, 'clamp(1 + amplitude × tanh(raw/scale)) 의 진폭'),
  ('reputation.tanh_scale',        50, 'tanh 스케일 — 수확 체감 폭'),
  ('reputation.new_account_days',   7, '가입 후 이 기간 미만 계정의 추천/비추천은 평판 미반영'),
  ('reputation.reaction_daily_limit', 3, '동일 유저의 이유에 대한 일일 추천/비추천 상한'),

  -- 어뷰징 방지 (§8.1, §8.2, §8.4)
  ('token.ttl_minutes',            10, '매치업 토큰 TTL (분). 1회용'),
  ('abuse.new_account_minutes',    10, '계정 생성 후 이 시간 전 투표는 c_trust 를 낮게 적용'),
  ('abuse.response_ms_floor',     700, '이 값 미만 응답이 연속되면 검토 큐로'),
  ('ratelimit.votes_per_hour',     60, '시간당 투표 상한'),
  ('ratelimit.votes_per_day',     300, '일일 투표 상한'),

  -- 입력 제약 (§4.1.1)
  ('vote.reason_max_length',      200, '선택 이유 최대 길이')
on conflict (key) do nothing;

alter table app_config enable row level security;

-- §8.6 투명성: 산출 방식은 공개한다. 다만 어뷰징 방어 임계값은 노출하지 않는다.
create policy "app_config public read" on app_config
  for select to anon, authenticated
  using (key not like 'ratelimit.%' and key not like 'abuse.%');
