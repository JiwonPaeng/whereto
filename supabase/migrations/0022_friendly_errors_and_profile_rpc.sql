-- 0022_friendly_errors_and_profile_rpc.sql
-- 1) vote_submit 오류 문구를 사용자 언어로. "토큰"은 구현 용어라 화면에 나오면 안 된다.
-- 2) §6.2 프로필 — 내 투표 통계, 이유 공개 여부 사후 변경

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
  select * into t from matchup_tokens where token = p_token for update;
  if not found then
    raise exception '이 매치업을 찾을 수 없습니다. 새 매치업을 불러올게요' using errcode = '22023';
  end if;
  if t.consumed then
    raise exception '이미 선택을 마친 매치업입니다' using errcode = '22023';
  end if;
  if t.expires_at < now() then
    raise exception '오래 머무르셨네요. 새 매치업을 불러올게요' using errcode = '22023';
  end if;
  if t.profile_id is distinct from v_profile then
    raise exception '다른 창에서 시작한 매치업입니다. 새로 불러올게요' using errcode = '42501';
  end if;
  if p_winner_id not in (t.program_a_id, t.program_b_id) then
    raise exception '이 매치업에 없는 학과입니다' using errcode = '22023';
  end if;

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

  if v_profile is not null and exists (
    select 1 from votes v
    where v.profile_id = v_profile
      and least(v.program_a_id, v.program_b_id)    = least(t.program_a_id, t.program_b_id)
      and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id)
  ) then
    raise exception '이미 투표한 조합입니다. 같은 조합은 한 번만 투표할 수 있어요'
      using errcode = '23505';
  end if;

  if v_profile is not null then
    select * into prof from profiles where id = v_profile;
    if not found then
      raise exception '가입 정보를 먼저 입력해 주세요' using errcode = '42501';
    end if;
    if prof.is_banned and (prof.banned_until is null or prof.banned_until > now()) then
      raise exception '현재 투표가 제한된 계정입니다' using errcode = '42501';
    end if;

    v_wage  := prof.vote_weight;
    v_trust := prof.trust_coeff;
    v_rep   := prof.reputation_mult;

    if prof.created_at > now() - make_interval(mins => v_new_min::int) then
      v_trust := least(v_trust, v_new_trust);
    end if;
  end if;

  v_weight := v_wage * v_trust * v_rep;

  perform program_id from ratings
   where program_id in (t.program_a_id, t.program_b_id)
   order by program_id
   for update;

  select * into ra from ratings where program_id = t.program_a_id;
  select * into rb from ratings where program_id = t.program_b_id;

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

  insert into votes (
    profile_id, program_a_id, program_b_id, winner_id,
    reason, reason_public, weight_applied,
    elo_a_before, elo_b_before, elo_a_delta, elo_b_delta, response_ms
  ) values (
    v_profile, t.program_a_id, t.program_b_id, p_winner_id,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_reason_public, true), v_weight,
    ra.elo, rb.elo, v_da, v_db, p_response_ms
  ) returning id into v_vote_id;

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


-- §6.2 이유 공개 여부 사후 변경 (공개 ↔ 익명).
-- votes 에 UPDATE 정책이 없으므로 RPC 로만 가능하다.
create or replace function vote_set_reason_public(p_vote_id bigint, p_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_profile uuid := auth.uid(); v_owner uuid;
begin
  if v_profile is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  select profile_id into v_owner from votes where id = p_vote_id;
  if not found then
    raise exception '투표를 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v_owner is distinct from v_profile then
    raise exception '본인의 투표가 아닙니다' using errcode = '42501';
  end if;

  update votes set reason_public = coalesce(p_public, true) where id = p_vote_id;
end;
$$;

revoke all on function vote_set_reason_public(bigint, boolean) from public;
grant execute on function vote_set_reason_public(bigint, boolean) to authenticated;


-- §6.2 비공개 영역 — 내 투표 통계.
-- votes 는 본인 행만 SELECT 되므로 집계 자체는 클라이언트로도 가능하지만,
-- "다수 의견 일치율"은 타 유저의 표를 세야 해서 RLS 를 넘어야 한다 → RPC.
create or replace function my_vote_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_profile uuid := auth.uid();
begin
  if v_profile is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  return (
    with mine as (
      select v.id, v.winner_id, v.program_a_id, v.program_b_id, p.faculty_group
      from votes v
      join programs p on p.id = v.winner_id
      where v.profile_id = v_profile and v.is_valid
    ),
    agreement as (
      select
        m.id,
        (select count(*) from votes v2
          where v2.is_valid and v2.weight_applied > 0
            and least(v2.program_a_id, v2.program_b_id)    = least(m.program_a_id, m.program_b_id)
            and greatest(v2.program_a_id, v2.program_b_id) = greatest(m.program_a_id, m.program_b_id)
            and v2.winner_id = m.winner_id) as same_side,
        (select count(*) from votes v2
          where v2.is_valid and v2.weight_applied > 0
            and least(v2.program_a_id, v2.program_b_id)    = least(m.program_a_id, m.program_b_id)
            and greatest(v2.program_a_id, v2.program_b_id) = greatest(m.program_a_id, m.program_b_id)
            and v2.winner_id <> m.winner_id) as other_side
      from mine m
    )
    select jsonb_build_object(
      'total', (select count(*) from mine),
      'reasons', (select count(*) from votes where profile_id = v_profile and reason is not null),
      'by_faculty', coalesce(
        (select jsonb_object_agg(faculty_group, c)
         from (select faculty_group, count(*) as c from mine group by 1) t), '{}'::jsonb),
      -- 동률(비교 대상이 나뿐인 경우 포함)은 분모에서 제외한다
      'majority_rate', (
        select round(avg(case when same_side > other_side then 1
                              when same_side < other_side then 0 end)::numeric, 4)
        from agreement
      ),
      'decided', (select count(*) from agreement where same_side <> other_side)
    )
  );
end;
$$;

revoke all on function my_vote_stats() from public;
grant execute on function my_vote_stats() to authenticated;
