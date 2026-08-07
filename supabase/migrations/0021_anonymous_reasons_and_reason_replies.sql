-- 0021_anonymous_reasons_and_reason_replies.sql
-- D-014 — 익명 선택 이유 노출 + 이유에 직접 대댓글
--
-- 1) reason_public 의 의미를 바꾼다.
--      이전: true=노출, false=숨김
--      이후: true=닉네임과 함께 노출, false=익명으로 노출
--    §4.1.2 는 "누가 어느 쪽을 골랐는지"의 연결을 금지하는 것이지 이유 텍스트 자체를
--    금지하지 않는다. 익명 노출은 그 연결을 만들지 않으므로 원칙과 충돌하지 않는다.
--
-- 2) 이유마다 직접 답글을 달 수 있게 comments 에 reason_vote_id 를 추가한다.

-- ── 1. 이유에 답글 달기 ───────────────────────────────────────────────────
alter table comments
  add column if not exists reason_vote_id bigint references votes (id) on delete cascade;

comment on column comments.reason_vote_id is
  '이 댓글이 특정 선택 이유에 대한 답글이면 그 votes.id. null 이면 스레드 전체에 대한 댓글 (D-014).';

create index if not exists comments_reason_idx on comments (reason_vote_id)
  where reason_vote_id is not null;


-- ── 2. public_reasons 재정의 ──────────────────────────────────────────────
--
-- 익명 이유는 profile_id 와 nickname 을 내보내지 않는다. 내보내면 익명이 아니게 된다.
-- is_named 로 화면이 표기를 구분한다.
--
-- profiles 와의 조인은 INNER 를 유지한다 — 탈퇴하면 이유가 사라져야 한다.
-- 개인정보처리방침 7항이 "탈퇴 시 공개했던 이유는 노출이 중단된다"고 명시하고 있다.
--
-- §7 평판: 익명 이유는 귀속될 주체가 없으므로 평판에 반영되지 않는다.
-- 이것이 닉네임 공개의 유인이 된다 (§7.3 과 같은 논리).
-- 컬럼 구성이 바뀌므로 CREATE OR REPLACE 로는 안 된다 (컬럼 이름 변경 불가).
drop view if exists public_reasons;

create view public_reasons as
select
  v.id            as vote_id,
  case when v.reason_public then v.profile_id else null end as profile_id,
  case when v.reason_public then pr.nickname   else null end as nickname,
  v.reason_public as is_named,
  v.winner_id,
  case when v.winner_id = v.program_a_id then v.program_b_id else v.program_a_id end as loser_id,
  v.reason,
  v.reason_upvotes,
  v.reason_downvotes,
  v.created_at
from votes v
join profiles pr on pr.id = v.profile_id
where v.reason is not null
  and v.is_valid
  and not pr.is_banned;

comment on view public_reasons is
  '§4.1.1 선택 이유. reason_public=false 는 숨김이 아니라 익명 노출을 뜻한다 (D-014). '
  '익명 행은 profile_id·nickname 을 null 로 내보내 식별을 차단한다.';

grant select on public_reasons to anon, authenticated;


-- ── 3. 스레드 댓글 RPC — 이유 답글 지원 ──────────────────────────────────
create or replace function matchup_thread_comment(
  p_program_lo    bigint,
  p_program_hi    bigint,
  p_content       text,
  p_parent_id     bigint default null,
  p_reason_vote_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_lo bigint; v_hi bigint;
  v_key text; v_board bigint; v_post bigint;
  v_title text; v_content text; v_comment bigint;
begin
  if v_profile is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  v_content := nullif(btrim(coalesce(p_content, '')), '');
  if v_content is null then
    raise exception '내용을 입력해 주세요' using errcode = '22023';
  end if;
  if char_length(v_content) > 2000 then
    raise exception '댓글은 2000자 이하여야 합니다' using errcode = '22001';
  end if;

  v_lo := least(p_program_lo, p_program_hi);
  v_hi := greatest(p_program_lo, p_program_hi);
  if v_lo = v_hi then
    raise exception '같은 Program 끼리는 스레드를 만들 수 없습니다' using errcode = '22023';
  end if;
  if (select count(*) from programs where id in (v_lo, v_hi) and is_active) <> 2 then
    raise exception '존재하지 않는 Program 입니다' using errcode = '22023';
  end if;

  -- 이유 답글이면, 그 이유가 정말 이 매치업의 것인지 확인한다.
  -- 확인하지 않으면 임의의 vote_id 를 붙여 남의 스레드에 답글을 심을 수 있다.
  if p_reason_vote_id is not null then
    if not exists (
      select 1 from votes v
      where v.id = p_reason_vote_id
        and v.is_valid
        and v.reason is not null
        and least(v.program_a_id, v.program_b_id) = v_lo
        and greatest(v.program_a_id, v.program_b_id) = v_hi
    ) then
      raise exception '이 매치업의 선택 이유가 아닙니다' using errcode = '22023';
    end if;
  end if;

  v_key := 'p' || v_lo || '-' || v_hi;
  select id into v_post from posts where matchup_key = v_key limit 1;

  if v_post is null then
    select id into v_board from boards where slug = 'matchup';
    select string_agg(t.label, ' vs ' order by t.ord) into v_title
    from (
      select 1 as ord, coalesce(u.short_name, u.name) || ' ' || pr.display_name as label
      from programs pr join universities u on u.id = pr.university_id where pr.id = v_lo
      union all
      select 2, coalesce(u.short_name, u.name) || ' ' || pr.display_name
      from programs pr join universities u on u.id = pr.university_id where pr.id = v_hi
    ) t;
    insert into posts (board_id, profile_id, matchup_key, title, content)
    values (v_board, null, v_key, v_title, '')
    returning id into v_post;
  end if;

  insert into comments (post_id, profile_id, parent_id, content, reason_vote_id)
  values (v_post, v_profile, p_parent_id, v_content, p_reason_vote_id)
  returning id into v_comment;

  return v_comment;
end;
$$;

-- 인자가 바뀌었으므로 이전 시그니처를 정리한다.
drop function if exists matchup_thread_comment(bigint, bigint, text, bigint);

revoke all on function matchup_thread_comment(bigint, bigint, text, bigint, bigint) from public;
grant execute on function matchup_thread_comment(bigint, bigint, text, bigint, bigint) to authenticated;


-- ── 4. 스레드 댓글 뷰 — reason_vote_id 노출 ──────────────────────────────
-- 여기도 컬럼이 중간에 추가되므로 drop 후 재생성한다.
drop view if exists public_thread_comments;

create view public_thread_comments as
select
  c.id,
  po.matchup_key,
  c.post_id,
  c.parent_id,
  c.reason_vote_id,
  c.profile_id,
  pr.nickname,
  c.content,
  c.upvotes,
  c.created_at
from comments c
join posts po on po.id = c.post_id
left join profiles pr on pr.id = c.profile_id
where not c.is_deleted
  and not po.is_deleted
  and po.matchup_key is not null;

grant select on public_thread_comments to anon, authenticated;
