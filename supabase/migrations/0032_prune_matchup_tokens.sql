-- matchup_tokens 는 조회마다 한 행씩 늘어나고 지우는 곳이 없었다.
-- 홈 화면도 즉시 투표를 위해 토큰을 발급하게 되면서 증가 속도가 두 배가 된다.
--
-- ⚠️ matchup_feedback 이 token 을 on delete cascade 로 참조한다. 조건 없이 지우면
--    §5.4.1 매치업 품질 신호가 함께 사라진다. **소비된 토큰은 건드리지 않고**,
--    피드백이 달리지 않은 미사용·만료 토큰만 지운다.
create or replace function prune_matchup_tokens(p_older_than_days int default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  delete from matchup_tokens t
  where not t.consumed
    and t.expires_at < now() - make_interval(days => greatest(p_older_than_days, 1))
    and not exists (select 1 from matchup_feedback f where f.token = t.token);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function prune_matchup_tokens(int) is
  '미사용·만료 매치업 토큰 정리. 소비된 토큰과 피드백이 달린 토큰은 남긴다 (§5.4.1).';

revoke all on function prune_matchup_tokens(int) from public;

-- pg_cron 은 UTC 로 돈다. 21:05 UTC = 06:05 KST — 기존 일일 배치 사이에 끼운다.
select cron.schedule('prune-matchup-tokens', '5 21 * * *',
  $$select prune_matchup_tokens()$$);
