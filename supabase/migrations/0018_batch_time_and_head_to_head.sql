-- 0018_batch_time_and_head_to_head.sql
-- 1) 일 배치 시각을 06:00 KST 로 (수험생·대학생 생활 패턴 기준)
-- 2) §4.3 상대 전적용 집계 뷰

-- pg_cron 은 UTC 로 돈다. 06:00 KST = 21:00 UTC (전일).
select cron.unschedule('daily-rating-snapshot');
select cron.unschedule('daily-profile-weights');

select cron.schedule('daily-rating-snapshot', '0 21 * * *',  $$select batch_daily_snapshot()$$);
select cron.schedule('daily-profile-weights', '10 21 * * *', $$select batch_recompute_profile_weights()$$);


-- §4.3 "상대 전적: 이 Program 이 참여한 매치업의 상대별 승/패"
--
-- votes 는 RLS 로 본인 행만 SELECT 되므로 클라이언트에서 집계할 수 없다.
-- public_reasons 와 같은 방식으로, **집계만** 내보내는 뷰를 둔다.
-- profile_id 를 컬럼 목록에서 제외하므로 §4.1.2 익명 정책은 유지된다.
--
-- weight_applied > 0 인 표만 센다 — 비로그인 체험 투표는 ratings.vote_count 에도
-- 반영되지 않으므로, 전적과 표본 수가 어긋나지 않게 같은 기준을 쓴다.
create or replace view public_matchup_records as
with expanded as (
  select program_a_id as program_id, program_b_id as opponent_id,
         (winner_id = program_a_id) as won
  from votes
  where is_valid and weight_applied > 0
  union all
  select program_b_id, program_a_id,
         (winner_id = program_b_id)
  from votes
  where is_valid and weight_applied > 0
)
select
  program_id,
  opponent_id,
  count(*)                          as total,
  count(*) filter (where won)       as wins,
  count(*) filter (where not won)   as losses
from expanded
group by program_id, opponent_id;

comment on view public_matchup_records is
  '§4.3 상대 전적. 집계만 노출하며 profile_id 를 포함하지 않는다 (§4.1.2).';

grant select on public_matchup_records to anon, authenticated;
