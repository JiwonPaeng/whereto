-- 0014_matchup_and_vote_rpc.sql
-- M1 코어 — §5.4 매칭 큐 + §13.3 vote_submit
--
-- 이 파일이 불변 원칙 2·3의 구현체다.
--   2. ELO 계산은 Postgres RPC 함수 내부에서만 (클라이언트가 점수를 보내지 않는다)
--   3. 매치업 쌍은 서버가 생성하고 토큰을 발급한다
-- 두 함수 모두 SECURITY DEFINER 이며, 클라이언트는 토큰과 선택 결과만 제출한다.

-- §8.1 "계정 생성 후 10분 경과 전 투표는 c_trust 를 낮게 적용" — 기획서가 값을 주지 않는다.
-- §8.3 의 감쇠 단계(1.0 → 0.7 → 0.4 → 0.1) 첫 단계를 차용했다. 임의값이므로 재검토 대상.
insert into app_config (key, value_num, description) values
  ('abuse.new_account_trust', 0.7,
   '§8.1 신규 계정(abuse.new_account_minutes 이내) 투표에 적용할 c_trust 상한. '
   '기획서에 값이 없어 §8.3 감쇠 첫 단계를 차용했다 — 재검토 필요.')
on conflict (key) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- matchup_next() — §5.4 매칭 큐 정책으로 쌍을 골라 토큰을 발급한다
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function matchup_next()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile      uuid := auth.uid();
  v_cross_rate   numeric; v_close_rate numeric; v_coldstart_rate numeric;
  v_coldstart_th numeric; v_gap numeric; v_low_pct numeric; v_ttl numeric;
  v_total_votes  bigint;
  v_is_cross     boolean; v_is_close boolean;
  v_a bigint; v_b bigint; v_tmp bigint;
  v_relax int := 0;
  v_token uuid; v_expires timestamptz;
begin
  select
    max(value_num) filter (where key = 'match.cross_faculty_rate'),
    max(value_num) filter (where key = 'match.close_pair_rate'),
    max(value_num) filter (where key = 'match.coldstart_close_rate'),
    max(value_num) filter (where key = 'match.coldstart_threshold'),
    max(value_num) filter (where key = 'match.close_elo_gap'),
    max(value_num) filter (where key = 'match.low_exposure_pct'),
    max(value_num) filter (where key = 'token.ttl_minutes')
  into v_cross_rate, v_close_rate, v_coldstart_rate, v_coldstart_th, v_gap, v_low_pct, v_ttl
  from app_config;

  select count(*) into v_total_votes from votes where is_valid;

  -- 콜드스타트: ELO 추정치 자체가 부정확해 "근접"이 의미 없다 (§5.4)
  if v_total_votes < v_coldstart_th then
    v_close_rate := v_coldstart_rate;
  end if;

  v_is_cross := random() < v_cross_rate;
  v_is_close := random() < v_close_rate;

  -- 1) A 선택. 근접 쌍이 아니면 노출 형평성 — 투표 수 하위 low_exposure_pct 에서 뽑는다.
  if v_is_close then
    select p.id into v_a from programs p where p.is_active order by random() limit 1;
  else
    select p.id into v_a
    from programs p
    join ratings r on r.program_id = p.id
    where p.is_active
      and r.vote_count <= (
        select percentile_disc(v_low_pct) within group (order by r2.vote_count)
        from ratings r2 join programs p2 on p2.id = r2.program_id
        where p2.is_active
      )
    order by random() limit 1;
  end if;

  if v_a is null then
    select p.id into v_a from programs p where p.is_active order by random() limit 1;
  end if;
  if v_a is null then
    return jsonb_build_object('error', 'no_programs');
  end if;

  -- 2) B 선택. 조건을 못 맞추면 단계적으로 완화한다.
  --    relax 0: 계열 규칙 + 근접 조건
  --    relax 1: 근접 조건 해제
  --    relax 2: 계열 규칙까지 해제 (그래도 없으면 유저가 모든 쌍을 소진한 것)
  while v_b is null and v_relax <= 2 loop
    select p.id into v_b
    from programs p
    join ratings r on r.program_id = p.id
    cross join lateral (
      select pa.faculty_group as fg, ra.elo as elo
      from programs pa join ratings ra on ra.program_id = pa.id
      where pa.id = v_a
    ) a
    where p.is_active
      and p.id <> v_a
      and (v_relax >= 2 or (case when v_is_cross
                                 then p.faculty_group <> a.fg
                                 else p.faculty_group =  a.fg end))
      and (v_relax >= 1 or not v_is_close or abs(r.elo - a.elo) <= v_gap)
      -- §4.1 이미 투표한 쌍은 재출제하지 않는다
      and (v_profile is null or not exists (
        select 1 from votes v
        where v.profile_id = v_profile
          and least(v.program_a_id, v.program_b_id)    = least(v_a, p.id)
          and greatest(v.program_a_id, v.program_b_id) = greatest(v_a, p.id)
      ))
    order by random() limit 1;

    v_relax := v_relax + 1;
  end loop;

  if v_b is null then
    return jsonb_build_object('exhausted', true);
  end if;

  -- 3) 좌/우 랜덤 배치 — 위치 편향 제거 (§4.1)
  if random() < 0.5 then
    v_tmp := v_a; v_a := v_b; v_b := v_tmp;
  end if;

  v_expires := now() + make_interval(mins => v_ttl::int);

  insert into matchup_tokens (profile_id, program_a_id, program_b_id, expires_at)
  values (v_profile, v_a, v_b, v_expires)
  returning token into v_token;

  return jsonb_build_object(
    'token',      v_token,
    'expires_at', v_expires,
    'a', (select jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'faculty_group', p.faculty_group,
            'university', u.name, 'short_name', u.short_name, 'campus', u.campus,
            'region_group', u.region_group, 'logo_url', u.logo_url)
          from programs p join universities u on u.id = p.university_id where p.id = v_a),
    'b', (select jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'faculty_group', p.faculty_group,
            'university', u.name, 'short_name', u.short_name, 'campus', u.campus,
            'region_group', u.region_group, 'logo_url', u.logo_url)
          from programs p join universities u on u.id = p.university_id where p.id = v_b)
  );
end;
$$;

comment on function matchup_next() is
  '§5.4 매칭 큐. 서버가 쌍을 정하고 토큰을 발급한다 (불변 원칙 3). 클라이언트는 임의 쌍을 제출할 수 없다.';


-- ═══════════════════════════════════════════════════════════════════════════
-- vote_submit() — §13.3 단일 트랜잭션
--   토큰 검증 → 중복 검사 → app_config 로드 → 가중치 조회
--   → ELO SELECT FOR UPDATE → K_eff 계산 → votes INSERT + ratings UPDATE + 토큰 consumed
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function vote_submit(
  p_token         uuid,
  p_winner_id     bigint,
  p_reason        text    default null,
  p_reason_public boolean default true,
  p_response_ms   integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  t         matchup_tokens%rowtype;
  prof      profiles%rowtype;
  ra        ratings%rowtype;
  rb        ratings%rowtype;
  v_k1 numeric; v_k2 numeric; v_k3 numeric; v_t1 numeric; v_t2 numeric;
  v_max_len numeric; v_new_min numeric; v_new_trust numeric;
  v_wage numeric := 0; v_trust numeric := 1; v_rep numeric := 1; v_weight numeric;
  v_ea numeric; v_eb numeric; v_sa numeric; v_sb numeric;
  v_ka numeric; v_kb numeric; v_da integer; v_db integer;
  v_vote_id bigint; v_a_wins bigint; v_b_wins bigint;
begin
  -- 1. 토큰 검증 (존재 / 미소비 / 미만료 / 본인)
  select * into t from matchup_tokens where token = p_token for update;
  if not found then
    raise exception '유효하지 않은 토큰입니다' using errcode = '22023';
  end if;
  if t.consumed then
    raise exception '이미 사용된 토큰입니다' using errcode = '22023';
  end if;
  if t.expires_at < now() then
    raise exception '만료된 매치업입니다. 새로 불러오세요' using errcode = '22023';
  end if;
  if t.profile_id is distinct from v_profile then
    raise exception '본인에게 발급된 토큰이 아닙니다' using errcode = '42501';
  end if;
  if p_winner_id not in (t.program_a_id, t.program_b_id) then
    raise exception '이 매치업에 없는 Program 입니다' using errcode = '22023';
  end if;

  -- 3. app_config 로드
  select
    max(value_num) filter (where key = 'elo.k_tier1'),
    max(value_num) filter (where key = 'elo.k_tier2'),
    max(value_num) filter (where key = 'elo.k_tier3'),
    max(value_num) filter (where key = 'elo.k_tier1_threshold'),
    max(value_num) filter (where key = 'elo.k_tier2_threshold'),
    max(value_num) filter (where key = 'vote.reason_max_length'),
    max(value_num) filter (where key = 'abuse.new_account_minutes'),
    max(value_num) filter (where key = 'abuse.new_account_trust')
  into v_k1, v_k2, v_k3, v_t1, v_t2, v_max_len, v_new_min, v_new_trust
  from app_config;

  if p_reason is not null and char_length(p_reason) > v_max_len then
    raise exception '선택 이유는 %자 이하여야 합니다', v_max_len::int using errcode = '22001';
  end if;

  -- 2. 중복 투표 검사 (§5.6). unique index 가 최종 방어선이나 메시지를 위해 선검사한다.
  if v_profile is not null and exists (
    select 1 from votes v
    where v.profile_id = v_profile
      and least(v.program_a_id, v.program_b_id)    = least(t.program_a_id, t.program_b_id)
      and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id)
  ) then
    raise exception '이미 투표한 쌍입니다' using errcode = '23505';
  end if;

  -- 4. 가중치 3축 조회. 비로그인은 전부 기본값이라 weight 0 → 지수 미반영 (§5.3)
  if v_profile is not null then
    select * into prof from profiles where id = v_profile;
    if not found then
      raise exception '프로필이 없습니다. 가입 정보를 먼저 입력하세요' using errcode = '42501';
    end if;
    if prof.is_banned and (prof.banned_until is null or prof.banned_until > now()) then
      raise exception '제재 중인 계정입니다' using errcode = '42501';
    end if;

    v_wage  := prof.vote_weight;
    v_trust := prof.trust_coeff;
    v_rep   := prof.reputation_mult;

    -- §8.1 계정 생성 직후 투표는 신뢰도를 낮춘다
    if prof.created_at > now() - make_interval(mins => v_new_min::int) then
      v_trust := least(v_trust, v_new_trust);
    end if;
  end if;

  v_weight := v_wage * v_trust * v_rep;

  -- 5. ELO 조회. 데드락을 막기 위해 program_id 오름차순으로 잠근다.
  perform program_id from ratings
   where program_id in (t.program_a_id, t.program_b_id)
   order by program_id
   for update;

  select * into ra from ratings where program_id = t.program_a_id;
  select * into rb from ratings where program_id = t.program_b_id;

  -- 6. K_eff 계산. §5.2 — 두 Program 의 n 이 다르면 각자의 K_base 를 각자에게 적용한다.
  --    제로섬이 깨지지만 신규 Program 의 빠른 수렴이 총점 보존보다 중요하다.
  v_ea := 1.0 / (1.0 + power(10.0, (rb.elo - ra.elo) / 400.0));
  v_eb := 1.0 - v_ea;
  v_sa := case when p_winner_id = t.program_a_id then 1 else 0 end;
  v_sb := 1 - v_sa;

  v_ka := case when ra.vote_count < v_t1 then v_k1
               when ra.vote_count < v_t2 then v_k2 else v_k3 end;
  v_kb := case when rb.vote_count < v_t1 then v_k1
               when rb.vote_count < v_t2 then v_k2 else v_k3 end;

  v_da := round(v_ka * v_weight * (v_sa - v_ea));
  v_db := round(v_kb * v_weight * (v_sb - v_eb));

  -- 7. votes INSERT + ratings UPDATE + 토큰 소비 (전부 이 트랜잭션 안)
  insert into votes (
    profile_id, program_a_id, program_b_id, winner_id,
    reason, reason_public, weight_applied,
    elo_a_before, elo_b_before, elo_a_delta, elo_b_delta, response_ms
  ) values (
    v_profile, t.program_a_id, t.program_b_id, p_winner_id,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_reason_public, true), v_weight,
    ra.elo, rb.elo, v_da, v_db, p_response_ms
  ) returning id into v_vote_id;

  -- 가중치 0(비로그인·생년월일 미상)은 지수에 반영하지 않는다.
  -- 표본 수(vote_count)도 올리지 않는다 — §4.2.2 신뢰도 배지가 실제 반영된 표본을 뜻해야 한다.
  if v_weight > 0 then
    update ratings set
      elo        = elo + v_da,
      vote_count = vote_count + 1,
      win_count  = win_count + case when p_winner_id = t.program_a_id then 1 else 0 end,
      updated_at = now()
    where program_id = t.program_a_id;

    update ratings set
      elo        = elo + v_db,
      vote_count = vote_count + 1,
      win_count  = win_count + case when p_winner_id = t.program_b_id then 1 else 0 end,
      updated_at = now()
    where program_id = t.program_b_id;
  end if;

  update matchup_tokens set consumed = true where token = p_token;

  -- §4.1 결과 오버레이용 — 이 쌍의 누적 득표 (방금 투표 포함)
  select
    count(*) filter (where v.winner_id = t.program_a_id),
    count(*) filter (where v.winner_id = t.program_b_id)
  into v_a_wins, v_b_wins
  from votes v
  where v.is_valid
    and least(v.program_a_id, v.program_b_id)    = least(t.program_a_id, t.program_b_id)
    and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id);

  return jsonb_build_object(
    'vote_id',        v_vote_id,
    'winner_id',      p_winner_id,
    'program_a_id',   t.program_a_id,
    'program_b_id',   t.program_b_id,
    'a_wins',         v_a_wins,
    'b_wins',         v_b_wins,
    'weight_applied', v_weight,
    'counted',        v_weight > 0,
    'is_majority',    case when v_a_wins = v_b_wins then null
                           when p_winner_id = t.program_a_id then v_a_wins > v_b_wins
                           else v_b_wins > v_a_wins end
  );
end;
$$;

comment on function vote_submit(uuid, bigint, text, boolean, integer) is
  '§13.3 투표 단일 트랜잭션. ELO 는 여기서만 계산한다 (불변 원칙 2). 클라이언트는 토큰+선택만 보낸다.';


-- 스킵은 투표가 아니다 (§4.1). 매칭 품질 지표로만 쌓는다.
create or replace function matchup_skip(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t matchup_tokens%rowtype;
begin
  select * into t from matchup_tokens where token = p_token for update;
  if not found or t.consumed then
    return;
  end if;
  if t.profile_id is distinct from auth.uid() then
    raise exception '본인에게 발급된 토큰이 아닙니다' using errcode = '42501';
  end if;

  insert into skips (profile_id, program_a_id, program_b_id)
  values (t.profile_id, t.program_a_id, t.program_b_id);

  update matchup_tokens set consumed = true where token = p_token;
end;
$$;


revoke all on function matchup_next()                                    from public;
revoke all on function vote_submit(uuid, bigint, text, boolean, integer)  from public;
revoke all on function matchup_skip(uuid)                                from public;

grant execute on function matchup_next()                                   to anon, authenticated;
grant execute on function vote_submit(uuid, bigint, text, boolean, integer) to anon, authenticated;
grant execute on function matchup_skip(uuid)                               to anon, authenticated;
