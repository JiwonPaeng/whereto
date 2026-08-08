-- 적재 완료. 일회용 함수를 즉시 제거한다.
drop function if exists _seed_programs_once(text, text);

refresh materialized view mv_ranking_overall;
