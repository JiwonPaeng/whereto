-- ── 1. 공개 집계 뷰 ─────────────────────────────────────────────────────
-- votes 는 §8.2 로 anon 에게 SELECT 정책이 없다. 홈 화면의 누적 투표 수가 0 으로
-- 나온 원인이다. 행을 내보내지 않고 **집계만** 노출하는 뷰를 둔다.
create or replace view public_stats as
select
  (select count(*) from votes where is_valid)                              as votes,
  (select count(*) from votes where is_valid and reason is not null)       as reasons,
  (select count(distinct profile_id) from votes where profile_id is not null) as voters,
  (select count(*) from programs where is_active)                          as programs,
  (select count(*) from universities where is_active)                      as universities;

comment on view public_stats is
  '공개 집계. votes 는 RLS 로 행 조회가 막혀 있으므로 수치만 내보낸다 (§8.2, §4.1.2).';

grant select on public_stats to anon, authenticated;


-- ── 2. 댓글·답글 익명 선택권 ─────────────────────────────────────────────
-- 닉네임이 남는 모든 곳에 익명 선택권을 준다. 이유(votes.reason_public)와 같은 방식이다.
alter table comments add column if not exists is_anonymous boolean not null default false;

comment on column comments.is_anonymous is
  'true 면 닉네임을 노출하지 않는다. public_thread_comments 가 profile_id·nickname 을 null 로 내보낸다.';

drop view if exists public_thread_comments;

create view public_thread_comments as
select
  c.id,
  po.matchup_key,
  c.post_id,
  c.parent_id,
  c.reason_vote_id,
  case when c.is_anonymous then null else c.profile_id end as profile_id,
  case when c.is_anonymous then null else pr.nickname end  as nickname,
  (not c.is_anonymous) as is_named,
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


-- ── 3. 댓글 RPC 에 익명 옵션 ─────────────────────────────────────────────
create or replace function matchup_thread_comment(
  p_program_lo     bigint,
  p_program_hi     bigint,
  p_content        text,
  p_parent_id      bigint  default null,
  p_reason_vote_id bigint  default null,
  p_anonymous      boolean default false
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
    raise exception '같은 학과끼리는 스레드를 만들 수 없습니다' using errcode = '22023';
  end if;
  if (select count(*) from programs where id in (v_lo, v_hi) and is_active) <> 2 then
    raise exception '존재하지 않는 학과입니다' using errcode = '22023';
  end if;

  if p_reason_vote_id is not null then
    if not exists (
      select 1 from votes v
      where v.id = p_reason_vote_id and v.is_valid and v.reason is not null
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

  insert into comments (post_id, profile_id, parent_id, content, reason_vote_id, is_anonymous)
  values (v_post, v_profile, p_parent_id, v_content, p_reason_vote_id, coalesce(p_anonymous, false))
  returning id into v_comment;

  return v_comment;
end;
$$;

drop function if exists matchup_thread_comment(bigint, bigint, text, bigint, bigint);

revoke all on function matchup_thread_comment(bigint, bigint, text, bigint, bigint, boolean) from public;
grant execute on function matchup_thread_comment(bigint, bigint, text, bigint, bigint, boolean) to authenticated;
