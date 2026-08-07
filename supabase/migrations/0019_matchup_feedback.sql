-- 0019_matchup_feedback.sql
-- D-013 — 매치업 품질 신호 수집
--
-- 목표는 "좋은 평가를 받은 매치업 유형을 더 자주 띄우는" 피드백 루프다(D-013).
-- 그 알고리즘은 데이터가 쌓여야 튜닝할 수 있으므로, 지금은 **수집만** 시작한다.
--
-- 현재 신호:
--   skips            부정 (답하기 어렵다)
--   votes            긍정 (답할 수 있었다)
--   matchup_feedback 명시적 좋아요/싫어요  ← 이 파일에서 추가
--   response_ms      보조 (votes 에 이미 기록 중)

create table if not exists matchup_feedback (
  token       uuid primary key references matchup_tokens (token) on delete cascade,
  profile_id  uuid references profiles (id) on delete cascade,
  kind        text not null check (kind in ('good', 'bad')),
  created_at  timestamptz not null default now()
);

comment on table matchup_feedback is
  '매치업 자체에 대한 평가. 발급 단위(token)당 1회. 투표 결과가 아니라 "이 비교가 답할 만했는가"를 묻는다.';

create index if not exists matchup_feedback_profile_idx on matchup_feedback (profile_id, created_at desc);

alter table matchup_feedback enable row level security;

create policy "matchup_feedback select own" on matchup_feedback
  for select to authenticated using (profile_id = (select auth.uid()));

revoke all on matchup_feedback from anon, authenticated;
grant select on matchup_feedback to authenticated;


-- 토큰을 통해서만 제출한다 — 불변 원칙 3과 같은 이유로, 클라이언트가 임의 쌍에 대해
-- 평가를 남길 수 없어야 한다. 토큰이 소비된(=투표된) 뒤에도 남길 수 있다.
create or replace function matchup_feedback_submit(p_token uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t matchup_tokens%rowtype;
begin
  if p_kind not in ('good', 'bad') then
    raise exception '잘못된 평가 값입니다' using errcode = '22023';
  end if;

  select * into t from matchup_tokens where token = p_token;
  if not found then
    raise exception '유효하지 않은 토큰입니다' using errcode = '22023';
  end if;
  if t.profile_id is distinct from auth.uid() then
    raise exception '본인에게 발급된 토큰이 아닙니다' using errcode = '42501';
  end if;

  insert into matchup_feedback (token, profile_id, kind)
  values (p_token, t.profile_id, p_kind)
  on conflict (token) do update set kind = excluded.kind, created_at = now();
end;
$$;

revoke all on function matchup_feedback_submit(uuid, text) from public;
grant execute on function matchup_feedback_submit(uuid, text) to authenticated;


-- 계열 조합별 품질 지표. D-013 피드백 루프의 입력이자, D-009·D-011 에서
-- "스킵률을 보고 재조정한다"고 남긴 항목의 관찰 창구다.
--
-- 주의: votes/skips 는 token 을 저장하지 않으므로 쌍(pair)으로 집계한다.
-- 발급 단위가 아니라 사건 단위 집계라는 점을 감안해서 읽을 것.
create or replace view matchup_quality_by_faculty as
with ev as (
  select least(pa.faculty_group, pb.faculty_group) as fg_lo,
         greatest(pa.faculty_group, pb.faculty_group) as fg_hi,
         'vote'::text as kind
  from votes v
  join programs pa on pa.id = v.program_a_id
  join programs pb on pb.id = v.program_b_id
  where v.is_valid
  union all
  select least(pa.faculty_group, pb.faculty_group),
         greatest(pa.faculty_group, pb.faculty_group), 'skip'
  from skips s
  join programs pa on pa.id = s.program_a_id
  join programs pb on pb.id = s.program_b_id
  union all
  select least(pa.faculty_group, pb.faculty_group),
         greatest(pa.faculty_group, pb.faculty_group), f.kind
  from matchup_feedback f
  join matchup_tokens t on t.token = f.token
  join programs pa on pa.id = t.program_a_id
  join programs pb on pb.id = t.program_b_id
)
select
  fg_lo || ' ↔ ' || fg_hi                                        as faculty_combo,
  count(*) filter (where kind = 'vote')                          as votes,
  count(*) filter (where kind = 'skip')                          as skips,
  count(*) filter (where kind = 'good')                          as good,
  count(*) filter (where kind = 'bad')                           as bad,
  round(
    count(*) filter (where kind = 'skip')::numeric
    / nullif(count(*) filter (where kind in ('vote', 'skip')), 0), 4
  )                                                              as skip_rate
from ev
group by fg_lo, fg_hi
order by 1;

comment on view matchup_quality_by_faculty is
  'D-013 매치업 품질. 어드민 전용 — anon/authenticated 에 grant 하지 않는다.';
