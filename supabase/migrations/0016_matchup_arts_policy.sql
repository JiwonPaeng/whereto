-- 0016_matchup_arts_policy.sql
-- D-011 — 예체능 매칭 분리
--
-- 기본은 인문/자연 풀에서만 매칭한다. 예체능은 낮은 확률로만 등장시키되,
-- 유저가 예체능 트랙이면 예체능을 주로 띄운다.
-- 예체능↔비예체능 교차는 누구에게나 낮게 유지한다.
--
-- ⚠️ §5.4 와 충돌한다. 기획서는 "유저 프로필 계열을 매칭에 반영하면 데이터가 편중된다.
-- 초기에는 반영하지 않고 데이터 축적 후 A/B로 검증한다"고 했다.
-- 그럼에도 진행하는 이유와 대가는 DECISIONS.md D-011 참조.

insert into app_config (key, value_num, description) values
  ('match.arts_rate_default',   0.07,
   '일반 유저에게 예체능이 등장하는 매치업 비율 (D-011)'),
  ('match.arts_rate_arts_user', 0.90,
   '유저 track 이 예체능일 때 예체능이 등장하는 비율 (D-011)'),
  ('match.arts_cross_rate',     0.07,
   '예체능이 등장하는 매치업 중 상대가 인문/자연인 비율. 누구에게나 낮게 유지한다 (D-011)')
on conflict (key) do nothing;


create or replace function matchup_next()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile      uuid := auth.uid();
  v_track        text;
  v_cross_rate   numeric; v_close_rate numeric; v_coldstart_rate numeric;
  v_coldstart_th numeric; v_gap numeric; v_low_pct numeric; v_ttl numeric;
  v_arts_default numeric; v_arts_user numeric; v_arts_cross numeric;
  v_total_votes  bigint;
  v_use_arts boolean; v_is_cross boolean; v_is_close boolean;
  v_a_pool text[]; v_b_pool text[];
  v_a bigint; v_b bigint; v_tmp bigint; v_a_fg text;
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
    max(value_num) filter (where key = 'token.ttl_minutes'),
    max(value_num) filter (where key = 'match.arts_rate_default'),
    max(value_num) filter (where key = 'match.arts_rate_arts_user'),
    max(value_num) filter (where key = 'match.arts_cross_rate')
  into v_cross_rate, v_close_rate, v_coldstart_rate, v_coldstart_th, v_gap, v_low_pct, v_ttl,
       v_arts_default, v_arts_user, v_arts_cross
  from app_config;

  select count(*) into v_total_votes from votes where is_valid;
  if v_total_votes < v_coldstart_th then
    v_close_rate := v_coldstart_rate;   -- 초기엔 ELO 추정이 부정확해 "근접"이 무의미하다 (§5.4)
  end if;

  -- 유저 계열. 비로그인·미설정이면 일반 유저로 취급한다.
  if v_profile is not null then
    select track into v_track from profiles where id = v_profile;
  end if;

  -- 1) 예체능을 띄울지 결정
  v_use_arts := random() < (case when v_track = '예체능' then v_arts_user else v_arts_default end);

  if v_use_arts then
    -- 예체능이 등장하는 매치업. 상대는 대개 예체능이고, 낮은 확률로만 인문/자연.
    v_is_cross := random() < v_arts_cross;
    v_a_pool := array['예체능'];
    v_b_pool := case when v_is_cross then array['인문','자연'] else array['예체능'] end;
  else
    -- 인문/자연 풀. 그 안에서 §5.4 의 동일/교차 계열 규칙을 적용한다.
    v_is_cross := random() < v_cross_rate;
    v_a_pool := array['인문','자연'];
    v_b_pool := null;   -- A 의 계열이 정해진 뒤 결정한다
  end if;

  v_is_close := random() < v_close_rate;

  -- 2) A 선택. 근접 쌍이 아니면 노출 형평성 — 투표 수 하위에서 뽑는다 (§5.4).
  if v_is_close then
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p
    where p.is_active and p.faculty_group = any(v_a_pool)
    order by random() limit 1;
  else
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p
    join ratings r on r.program_id = p.id
    where p.is_active and p.faculty_group = any(v_a_pool)
      and r.vote_count <= (
        select percentile_disc(v_low_pct) within group (order by r2.vote_count)
        from ratings r2 join programs p2 on p2.id = r2.program_id
        where p2.is_active and p2.faculty_group = any(v_a_pool)
      )
    order by random() limit 1;
  end if;

  if v_a is null then
    select p.id, p.faculty_group into v_a, v_a_fg
    from programs p where p.is_active and p.faculty_group = any(v_a_pool)
    order by random() limit 1;
  end if;
  if v_a is null then
    return jsonb_build_object('error', 'no_programs');
  end if;

  if v_b_pool is null then
    v_b_pool := case when v_is_cross
                     then array[case when v_a_fg = '인문' then '자연' else '인문' end]
                     else array[v_a_fg] end;
  end if;

  -- 3) B 선택. 못 맞추면 근접조건 → 계열조건 순으로 완화한다.
  while v_b is null and v_relax <= 2 loop
    select p.id into v_b
    from programs p
    join ratings r on r.program_id = p.id
    cross join lateral (select elo from ratings where program_id = v_a) a
    where p.is_active
      and p.id <> v_a
      and (v_relax >= 2 or p.faculty_group = any(v_b_pool))
      and (v_relax >= 1 or not v_is_close or abs(r.elo - a.elo) <= v_gap)
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

  -- 4) 좌/우 랜덤 배치 — 위치 편향 제거 (§4.1)
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

revoke all on function matchup_next() from public;
grant execute on function matchup_next() to anon, authenticated;
