-- 0007_hardening.sql
-- Supabase security advisor 대응.
--
-- 처리한 것:
--   1. 트리거 함수의 search_path 고정 (function_search_path_mutable)
--   2. 내부 전용 함수의 EXECUTE 권한 회수 (anon/authenticated_security_definer_function_executable)
--      → 트리거 함수가 /rest/v1/rpc/... 로 노출되어 있었다.
--        PostgreSQL 은 트리거 함수의 EXECUTE 권한을 CREATE TRIGGER 시점에만 검사하므로
--        권한을 회수해도 트리거는 정상 동작한다.
--
-- 처리하지 않은 것 (의도된 설계):
--   - security_definer_view (public_profiles / public_reasons): 0006 주석 참조.
--     행 단위 RLS 로는 컬럼을 가릴 수 없어, 노출 컬럼을 고정한 definer 뷰가 정확히 필요한 도구다.
--   - materialized_view_in_api (mv_ranking_overall / mv_hot_posts): 랭킹과 인기글은
--     서비스의 공개 산출물이다 (§8.6 투명성). 익명 읽기가 의도된 동작이다.

create or replace function set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function votes_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'votes 는 append-only 입니다. 삭제 대신 is_valid=false 로 무효 처리하십시오 (기획서 §5.6, 불변 원칙 1)'
    using errcode = 'restrict_violation';
end;
$$;

create or replace function votes_block_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutable text[] := array['is_valid', 'reason_public', 'reason_upvotes', 'reason_downvotes'];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'votes 는 append-only 입니다. 변경 가능한 컬럼은 % 뿐입니다 (기획서 §5.6, 불변 원칙 1)',
      array_to_string(v_mutable, ', ')
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- 내부 전용 함수는 API 로 노출하지 않는다.
revoke execute on function set_updated_at()          from public, anon, authenticated;
revoke execute on function votes_block_delete()      from public, anon, authenticated;
revoke execute on function votes_block_update()      from public, anon, authenticated;
revoke execute on function profiles_sync_age()       from public, anon, authenticated;
revoke execute on function profiles_log_changes()    from public, anon, authenticated;
revoke execute on function comments_enforce_depth()  from public, anon, authenticated;
revoke execute on function programs_init_rating()    from public, anon, authenticated;
revoke execute on function compute_age_weight(integer, text, timestamptz)
  from public, anon, authenticated;
