-- 부트스트랩 구간에서는 피드백 속도가 읽기 부하 방어보다 중요하다.
-- §13.3 은 랭킹 MV 10분 / 인기글 5분이지만, 트래픽이 사실상 없는 지금
-- 투표 결과가 화면에 뜨기까지 최대 20분(MV 10분 + ISR 10분)이 걸린다.
-- 유입이 생기면 되돌린다.
select cron.unschedule('refresh-ranking-mv');
select cron.schedule('refresh-ranking-mv', '* * * * *', $$select refresh_ranking_mv()$$);
