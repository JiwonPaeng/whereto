drop function if exists vote_submit(uuid, bigint, text, boolean, integer);

create or replace function vote_submit(
  p_token         uuid,
  p_winner_id     bigint,
  p_reason        text    default null,
  p_reason_public boolean default true,
  p_response_ms   integer default null,
  p_anon_id       uuid    default null
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
  ra ratings%rowtype; rb ratings%rowtype;
  ua university_ratings%rowtype; ub university_ratings%rowtype;
  v_ua_id bigint; v_ub_id bigint;
  v_k1 numeric; v_k2 numeric; v_k3 numeric; v_t1 numeric; v_t2 numeric;
  v_max_len numeric; v_new_min numeric; v_new_trust numeric;
  v_anon_w numeric; v_rl_h numeric; v_rl_d numeric;
  v_wage numeric := 0; v_trust numeric := 1; v_rep numeric := 1; v_weight numeric;
  v_ea numeric; v_eb numeric; v_sa numeric; v_sb numeric;
  v_ka numeric; v_kb numeric; v_da integer; v_db integer;
  v_uea numeric; v_uka numeric; v_ukb numeric; v_uda integer; v_udb integer;
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
    max(value_num) filter (where key = 'abuse.new_account_trust'),
    max(value_num) filter (where key = 'weight.anonymous'),
    max(value_num) filter (where key = 'ratelimit.anon_votes_per_hour'),
    max(value_num) filter (where key = 'ratelimit.anon_votes_per_day')
  into v_k1, v_k2, v_k3, v_t1, v_t2, v_max_len, v_new_min, v_new_trust, v_anon_w, v_rl_h, v_rl_d
  from app_config;

  if p_reason is not null and char_length(p_reason) > v_max_len then
    raise exception '선택 이유는 %자 이하여야 합니다', v_max_len::int using errcode = '22001';
  end if;

  -- 중복 검사 (§5.6). 로그인은 profile_id, 비로그인은 anon_id 기준.
  if v_profile is not null then
    if exists (select 1 from votes v where v.profile_id = v_profile
                 and least(v.program_a_id, v.program_b_id) = least(t.program_a_id, t.program_b_id)
                 and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id)) then
      raise exception '이미 투표한 조합입니다. 같은 조합은 한 번만 투표할 수 있어요' using errcode = '23505';
    end if;
  elsif p_anon_id is not null then
    if exists (select 1 from votes v where v.anon_id = p_anon_id and v.profile_id is null
                 and least(v.program_a_id, v.program_b_id) = least(t.program_a_id, t.program_b_id)
                 and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id)) then
      raise exception '이미 투표한 조합입니다. 같은 조합은 한 번만 투표할 수 있어요' using errcode = '23505';
    end if;
    -- 비로그인은 §8.1 진입 장벽이 없으므로 rate limit 을 여기서 건다.
    if (select count(*) from votes v where v.anon_id = p_anon_id
          and v.created_at > now() - interval '1 hour') >= v_rl_h then
      raise exception '잠시 후에 다시 시도해 주세요' using errcode = '54000';
    end if;
    if (select count(*) from votes v where v.anon_id = p_anon_id
          and v.created_at > now() - interval '1 day') >= v_rl_d then
      raise exception '오늘의 투표 한도에 도달했습니다. 로그인하면 더 투표할 수 있어요' using errcode = '54000';
    end if;
  end if;

  -- 가중치
  if v_profile is not null then
    select * into prof from profiles where id = v_profile;
    if not found then
      raise exception '가입 정보를 먼저 입력해 주세요' using errcode = '42501';
    end if;
    if prof.is_banned and (prof.banned_until is null or prof.banned_until > now()) then
      raise exception '현재 투표가 제한된 계정입니다' using errcode = '42501';
    end if;
    v_wage := prof.vote_weight; v_trust := prof.trust_coeff; v_rep := prof.reputation_mult;
    if prof.created_at > now() - make_interval(mins => v_new_min::int) then
      v_trust := least(v_trust, v_new_trust);
    end if;
    v_weight := v_wage * v_trust * v_rep;
  elsif p_anon_id is not null then
    -- D-016 비로그인도 반영한다. 낮은 가중치이며 나중에 무효화·재계산할 수 있다.
    v_weight := coalesce(v_anon_w, 0);
  else
    v_weight := 0;
  end if;

  -- Program ELO (§5.2). 데드락 방지를 위해 id 오름차순으로 잠근다.
  perform program_id from ratings
   where program_id in (t.program_a_id, t.program_b_id) order by program_id for update;
  select * into ra from ratings where program_id = t.program_a_id;
  select * into rb from ratings where program_id = t.program_b_id;

  v_ea := 1.0 / (1.0 + power(10.0, (rb.elo - ra.elo) / 400.0));
  v_eb := 1.0 - v_ea;
  v_sa := case when p_winner_id = t.program_a_id then 1 else 0 end;
  v_sb := 1 - v_sa;
  v_ka := case when ra.vote_count < v_t1 then v_k1 when ra.vote_count < v_t2 then v_k2 else v_k3 end;
  v_kb := case when rb.vote_count < v_t1 then v_k1 when rb.vote_count < v_t2 then v_k2 else v_k3 end;
  v_da := round(v_ka * v_weight * (v_sa - v_ea));
  v_db := round(v_kb * v_weight * (v_sb - v_eb));

  insert into votes (
    profile_id, anon_id, program_a_id, program_b_id, winner_id,
    reason, reason_public, weight_applied,
    elo_a_before, elo_b_before, elo_a_delta, elo_b_delta, response_ms
  ) values (
    v_profile, case when v_profile is null then p_anon_id end,
    t.program_a_id, t.program_b_id, p_winner_id,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_reason_public, true), v_weight,
    ra.elo, rb.elo, v_da, v_db, p_response_ms
  ) returning id into v_vote_id;

  if v_weight > 0 then
    update ratings set elo = elo + v_da, vote_count = vote_count + 1,
      win_count = win_count + case when p_winner_id = t.program_a_id then 1 else 0 end,
      updated_at = now() where program_id = t.program_a_id;
    update ratings set elo = elo + v_db, vote_count = vote_count + 1,
      win_count = win_count + case when p_winner_id = t.program_b_id then 1 else 0 end,
      updated_at = now() where program_id = t.program_b_id;

    -- D-016 대학 레벨 ELO. 서로 다른 대학일 때만 갱신한다 —
    -- 같은 대학 안의 대결은 대학 간 우열에 대한 정보를 담지 않는다.
    select university_id into v_ua_id from programs where id = t.program_a_id;
    select university_id into v_ub_id from programs where id = t.program_b_id;

    if v_ua_id <> v_ub_id then
      perform university_id from university_ratings
       where university_id in (v_ua_id, v_ub_id) order by university_id for update;
      select * into ua from university_ratings where university_id = v_ua_id;
      select * into ub from university_ratings where university_id = v_ub_id;

      v_uea := 1.0 / (1.0 + power(10.0, (ub.elo - ua.elo) / 400.0));
      v_uka := case when ua.vote_count < v_t1 then v_k1 when ua.vote_count < v_t2 then v_k2 else v_k3 end;
      v_ukb := case when ub.vote_count < v_t1 then v_k1 when ub.vote_count < v_t2 then v_k2 else v_k3 end;
      v_uda := round(v_uka * v_weight * (v_sa - v_uea));
      v_udb := round(v_ukb * v_weight * (v_sb - (1.0 - v_uea)));

      update university_ratings set elo = elo + v_uda, vote_count = vote_count + 1,
        win_count = win_count + case when p_winner_id = t.program_a_id then 1 else 0 end,
        updated_at = now() where university_id = v_ua_id;
      update university_ratings set elo = elo + v_udb, vote_count = vote_count + 1,
        win_count = win_count + case when p_winner_id = t.program_b_id then 1 else 0 end,
        updated_at = now() where university_id = v_ub_id;
    end if;
  end if;

  update matchup_tokens set consumed = true where token = p_token;

  select count(*) filter (where v.winner_id = t.program_a_id),
         count(*) filter (where v.winner_id = t.program_b_id)
  into v_a_wins, v_b_wins
  from votes v
  where v.is_valid
    and least(v.program_a_id, v.program_b_id) = least(t.program_a_id, t.program_b_id)
    and greatest(v.program_a_id, v.program_b_id) = greatest(t.program_a_id, t.program_b_id);

  return jsonb_build_object(
    'vote_id', v_vote_id, 'winner_id', p_winner_id,
    'program_a_id', t.program_a_id, 'program_b_id', t.program_b_id,
    'a_wins', v_a_wins, 'b_wins', v_b_wins,
    'weight_applied', v_weight, 'counted', v_weight > 0,
    'is_majority', case when v_a_wins = v_b_wins then null
                        when p_winner_id = t.program_a_id then v_a_wins > v_b_wins
                        else v_b_wins > v_a_wins end
  );
end;
$$;

revoke all on function vote_submit(uuid, bigint, text, boolean, integer, uuid) from public;
grant execute on function vote_submit(uuid, bigint, text, boolean, integer, uuid) to anon, authenticated;
