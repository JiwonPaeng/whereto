-- §8.5 어드민 대시보드 + 학과(Program) 관리
--
-- 적용 시점의 두 마이그레이션(admin_role_and_rpcs, admin_stats_dense_hourly)을
-- 최종 상태로 합쳐 둔 파일이다.

-- ── 어드민 권한 ─────────────────────────────────────────────────────────
-- profiles 의 컬럼 GRANT 가 UPDATE 를 (nickname, status, track) 로,
-- INSERT 를 (id, nickname, birth_date, status, track) 로 제한하므로
-- 이용자가 자신의 is_admin 을 켤 수 없다. 부여는 service_role 로만 가능하다.
alter table profiles add column if not exists is_admin boolean not null default false;

comment on column profiles.is_admin is
  '어드민 여부. 컬럼 GRANT 로 이용자가 직접 쓸 수 없다. 어드민 RPC 는 전부 이 값을 확인한다.';

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;


-- ── §8.5 모니터링 집계 ──────────────────────────────────────────────────
-- ⚠️ "누가 어느 쪽을 골랐는지"는 반환하지 않는다 (§4.1.2).
--    어드민 화면도 집계와 어뷰징 신호만 다룬다.
create or replace function admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'overview', (
      select jsonb_build_object(
        'votes',        count(*),
        'votes_today',  count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
        'votes_24h',    count(*) filter (where created_at > now() - interval '24 hours'),
        'anon_votes',   count(*) filter (where profile_id is null),
        'reasons',      count(*) filter (where reason is not null),
        'invalidated',  count(*) filter (where not is_valid),
        'skips',        (select count(*) from skips),
        'voters',       count(distinct profile_id) filter (where profile_id is not null),
        'anon_sessions',count(distinct anon_id) filter (where anon_id is not null)
      ) from votes
    ),
    'programs', (
      select jsonb_build_object(
        'total',       count(*),
        'inactive',    count(*) filter (where not is_active),
        'universities',(select count(*) from universities),
        'provisional', (select count(*) from mv_ranking_overall where confidence = '잠정'),
        'ranked',      (select count(*) from mv_ranking_overall where rank_overall is not null)
      ) from programs
    ),
    -- §8.4 시간당 투표량 이상치. 빈 시간을 0 으로 채워 48행 고정으로 돌려준다 —
    -- 클라이언트에서 채우면 렌더 중 new Date() 를 부르게 되어 React 19 의
    -- react-hooks/purity 에 걸린다.
    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', to_char(h at time zone 'Asia/Seoul', 'MM/DD HH24시'),
        'votes', (select count(*) from votes v
                  where v.created_at >= h and v.created_at < h + interval '1 hour')
      ) order by h), '[]'::jsonb)
      from generate_series(
        date_trunc('hour', now()) - interval '47 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) h
    ),
    -- §5.4.1 · D-013 계열 조합별 품질
    'quality', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.faculty_combo), '[]'::jsonb)
      from matchup_quality_by_faculty q
    ),
    -- 대학별 지수 — 급변은 조직적 투표의 첫 징후다 (§8.5)
    'universities', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(u.short_name, u.name), 'elo', ur.elo, 'n', ur.vote_count) order by ur.elo desc), '[]'::jsonb)
      from university_ratings ur join universities u on u.id = ur.university_id
      where ur.vote_count > 0
    ),
    -- §8.3 편향 스코어 분포. 배치가 아직 없어 대부분 null 이다.
    'bias', (
      select jsonb_build_object(
        'scored', count(*) filter (where bias_score is not null),
        'trust_reduced', count(*) filter (where trust_coeff < 1.0),
        'banned', count(*) filter (where is_banned)
      ) from profiles
    )
  );
end;
$$;

revoke all on function admin_stats() from public;
grant execute on function admin_stats() to authenticated;


-- ── Program 관리 ────────────────────────────────────────────────────────
create or replace function admin_program_search(p_q text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(t order by t.university, t.display_name), '[]'::jsonb)
    from (
      select p.id, p.display_name, p.faculty_group, p.is_active,
             u.id as university_id, coalesce(u.short_name, u.name) as university,
             r.elo, r.vote_count
      from programs p
      join universities u on u.id = p.university_id
      left join ratings r on r.program_id = p.id
      where p_q is null or btrim(p_q) = ''
         or p.display_name ilike '%' || p_q || '%'
         or u.name ilike '%' || p_q || '%'
         or coalesce(u.short_name, '') ilike '%' || p_q || '%'
      limit greatest(1, least(p_limit, 200))
    ) t
  );
end;
$$;

-- 추가 / 수정. p_id 가 null 이면 신규.
create or replace function admin_program_upsert(
  p_id            bigint,
  p_university_id bigint,
  p_display_name  text,
  p_faculty_group text,
  p_is_active     boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; v_id bigint;
begin
  if not is_admin() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_name is null then
    raise exception '학과명을 입력해 주세요' using errcode = '22023';
  end if;
  if p_faculty_group not in ('인문', '자연', '예체능') then
    raise exception '계열은 인문·자연·예체능 중 하나여야 합니다' using errcode = '22023';
  end if;
  if not exists (select 1 from universities where id = p_university_id) then
    raise exception '존재하지 않는 대학입니다' using errcode = '22023';
  end if;

  if p_id is null then
    insert into programs (university_id, display_name, faculty_group, is_active)
    values (p_university_id, v_name, p_faculty_group, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update programs
    set university_id = p_university_id,
        display_name  = v_name,
        faculty_group = p_faculty_group,
        is_active     = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '학과를 찾을 수 없습니다' using errcode = '22023';
    end if;
  end if;

  return v_id;
end;
$$;

-- 제거. 표가 있으면 하드 삭제하지 않는다 —
-- votes 가 programs 를 on delete restrict 로 참조하며, 지우면 지수 이력이 끊긴다.
-- 표가 전혀 없을 때만(입력 실수 정정) 실제로 삭제한다.
create or replace function admin_program_remove(p_id bigint, p_hard boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_votes bigint;
begin
  if not is_admin() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;

  select count(*) into v_votes from votes
  where program_a_id = p_id or program_b_id = p_id;

  if p_hard and v_votes = 0 then
    delete from matchup_tokens where program_a_id = p_id or program_b_id = p_id;
    delete from skips          where program_a_id = p_id or program_b_id = p_id;
    delete from programs where id = p_id;
    return jsonb_build_object('deleted', true, 'votes', 0);
  end if;

  update programs set is_active = false where id = p_id;
  return jsonb_build_object('deleted', false, 'deactivated', true, 'votes', v_votes);
end;
$$;

revoke all on function admin_program_search(text, int)                             from public;
revoke all on function admin_program_upsert(bigint, bigint, text, text, boolean)    from public;
revoke all on function admin_program_remove(bigint, boolean)                        from public;
grant execute on function admin_program_search(text, int)                          to authenticated;
grant execute on function admin_program_upsert(bigint, bigint, text, text, boolean) to authenticated;
grant execute on function admin_program_remove(bigint, boolean)                     to authenticated;


-- 대학 목록 (관리 화면의 선택지)
create or replace view public_universities as
select id, name, short_name, campus, region_group, est_type
from universities where is_active;

grant select on public_universities to anon, authenticated;
