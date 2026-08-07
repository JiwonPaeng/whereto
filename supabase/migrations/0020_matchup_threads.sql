-- 0020_matchup_threads.sql
-- §10.3 매치업 토론 스레드
--
-- 설계: 스레드를 미리 만들지 않는다.
--   202개 Program → 가능한 쌍 20,301개. 미리 posts 행을 만들면 대부분 영원히 빈 채로 남는다.
--   스레드는 matchup_key('p{lo}-{hi}')로 식별되는 **가상 개념**이고,
--   실제 posts 행은 첫 댓글이 달릴 때 생성한다. 읽기는 행이 없어도 된다.
--
-- §10.3 의 요점은 "공개된 이유가 자동 유입되어 게시판이 빈 상태로 시작하지 않는다"이다.
-- 그 유입은 votes 를 그대로 읽는 것으로 충분하며 별도 복사가 필요 없다.

-- 활동이 있는 매치업 스레드 목록.
-- 투표가 한 번이라도 있었던 쌍만 나온다 — 아무도 안 본 쌍까지 나열할 이유가 없다.
create or replace view matchup_threads as
with pairs as (
  select
    least(v.program_a_id, v.program_b_id)    as program_lo_id,
    greatest(v.program_a_id, v.program_b_id) as program_hi_id,
    count(*)                                                     as vote_count,
    count(*) filter (where v.reason_public and v.reason is not null) as reason_count,
    max(v.created_at)                                            as last_vote_at
  from votes v
  where v.is_valid
  group by 1, 2
)
select
  'p' || p.program_lo_id || '-' || p.program_hi_id as matchup_key,
  p.program_lo_id,
  p.program_hi_id,
  p.vote_count,
  p.reason_count,
  coalesce(c.comment_count, 0)                    as comment_count,
  greatest(p.last_vote_at, coalesce(c.last_comment_at, p.last_vote_at)) as last_activity
from pairs p
left join lateral (
  select count(cm.id) as comment_count, max(cm.created_at) as last_comment_at
  from posts po
  join comments cm on cm.post_id = po.id and not cm.is_deleted
  where po.matchup_key = 'p' || p.program_lo_id || '-' || p.program_hi_id
    and not po.is_deleted
) c on true;

comment on view matchup_threads is
  '§10.3 매치업 스레드 목록. posts 행을 미리 만들지 않으므로 votes 에서 파생한다.';

grant select on matchup_threads to anon, authenticated;


-- 첫 댓글이 달릴 때 스레드 posts 행을 만든다.
-- matchup_key 형식을 서버가 강제한다 — 클라이언트가 임의 키로 글을 만들 수 없어야 한다.
create or replace function matchup_thread_comment(
  p_program_lo bigint,
  p_program_hi bigint,
  p_content    text,
  p_parent_id  bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_lo bigint; v_hi bigint;
  v_key text;
  v_board bigint;
  v_post bigint;
  v_title text;
  v_content text;
  v_comment bigint;
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

  -- 실재하는 활성 Program 인지 확인
  if (select count(*) from programs where id in (v_lo, v_hi) and is_active) <> 2 then
    raise exception '존재하지 않는 Program 입니다' using errcode = '22023';
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

    -- 시스템이 만드는 스레드이므로 profile_id 는 비운다.
    insert into posts (board_id, profile_id, matchup_key, title, content)
    values (v_board, null, v_key, v_title, '')
    returning id into v_post;
  end if;

  insert into comments (post_id, profile_id, parent_id, content)
  values (v_post, v_profile, p_parent_id, v_content)
  returning id into v_comment;

  return v_comment;
end;
$$;

comment on function matchup_thread_comment(bigint, bigint, text, bigint) is
  '§10.3 매치업 스레드 댓글. 스레드 posts 행을 필요할 때 생성한다.';

revoke all on function matchup_thread_comment(bigint, bigint, text, bigint) from public;
grant execute on function matchup_thread_comment(bigint, bigint, text, bigint) to authenticated;


-- 스레드 댓글 조회용 뷰.
-- comments 는 작성자 연결이 profile_id 라 닉네임을 붙이려면 profiles 조인이 필요한데,
-- profiles 는 RLS 로 본인 행만 보인다. public_profiles 와 같은 방식으로 닉네임만 노출한다.
create or replace view public_thread_comments as
select
  c.id,
  po.matchup_key,
  c.post_id,
  c.parent_id,
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

comment on view public_thread_comments is
  '§10.3 스레드 댓글 + 닉네임. profiles 가 RLS 로 막혀 있어 별도 뷰로 닉네임만 노출한다.';

grant select on public_thread_comments to anon, authenticated;
