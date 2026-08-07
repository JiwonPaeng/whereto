-- 0015_vote_reason_write_once.sql
-- §4.1 "즉시 확정" 과 §4.1.1 "투표 직후 이유 입력" 을 동시에 만족시킨다.
--
-- 문제: 카드를 누르면 그 순간 투표가 확정되어야 하는데(§4.1), 이유는 그 다음에 쓴다(§4.1.1).
-- 그런데 votes 는 append-only 라 reason 을 나중에 채울 수 없었다.
--
-- 해결: reason 을 **쓰기 1회**로 연다. NULL → 값 은 허용, 값 → 다른 값 은 금지.
-- 투표 내용(선택·가중치·ELO)은 여전히 불변이다. 이유는 투표가 아니라 투표에 덧붙는 논거다.

create or replace function votes_block_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutable text[] := array[
    'is_valid', 'reason_public', 'reason_upvotes', 'reason_downvotes', 'reason'
  ];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'votes 는 append-only 입니다. 변경 가능한 컬럼은 % 뿐입니다 (기획서 §5.6, 불변 원칙 1)',
      array_to_string(v_mutable, ', ')
      using errcode = 'restrict_violation';
  end if;

  -- reason 은 쓰기 1회. 한번 쓴 논거를 고쳐 쓰면 §7 평판 평가의 대상이 사후에 바뀐다.
  if old.reason is not null and new.reason is distinct from old.reason then
    raise exception '선택 이유는 한 번만 작성할 수 있습니다'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

revoke execute on function votes_block_update() from public, anon, authenticated;


-- §4.1.1 투표 직후 이유 작성. 작성을 강제하지 않는다 — 강제하면 표본이 급감한다.
create or replace function vote_add_reason(
  p_vote_id bigint,
  p_reason  text,
  p_public  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_max_len numeric;
  v_clean   text;
  v_row     votes%rowtype;
begin
  if v_profile is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  select value_num into v_max_len from app_config where key = 'vote.reason_max_length';

  v_clean := nullif(btrim(coalesce(p_reason, '')), '');
  if v_clean is null then
    raise exception '이유를 입력해 주세요' using errcode = '22023';
  end if;
  if char_length(v_clean) > v_max_len then
    raise exception '선택 이유는 %자 이하여야 합니다', v_max_len::int using errcode = '22001';
  end if;

  select * into v_row from votes where id = p_vote_id for update;
  if not found then
    raise exception '투표를 찾을 수 없습니다' using errcode = '22023';
  end if;
  if v_row.profile_id is distinct from v_profile then
    raise exception '본인의 투표가 아닙니다' using errcode = '42501';
  end if;
  if v_row.reason is not null then
    raise exception '이미 이유를 작성했습니다' using errcode = 'restrict_violation';
  end if;

  update votes
  set reason = v_clean, reason_public = coalesce(p_public, true)
  where id = p_vote_id;

  return jsonb_build_object('vote_id', p_vote_id, 'reason', v_clean, 'reason_public', coalesce(p_public, true));
end;
$$;

comment on function vote_add_reason(bigint, text, boolean) is
  '§4.1.1 투표 직후 선택 이유 작성. 쓰기 1회. 공개 시 §7 평판의 대상이 된다.';

revoke all on function vote_add_reason(bigint, text, boolean) from public;
grant execute on function vote_add_reason(bigint, text, boolean) to authenticated;
