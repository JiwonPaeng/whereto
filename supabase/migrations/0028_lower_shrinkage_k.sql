-- shrinkage 강도 완화. k=10 이면 n=k=10 에서야 반반이 되는데,
-- '잠정' 경계(n<10)와 겹쳐 표본이 생겨도 화면상 대학 값에 붙어 있었다.
-- k=5 로 낮춰 5표부터 자기 값이 절반 실리게 한다.
update app_config
set value_num = 5,
    description = '표시용 shrinkage 상수. elo_display = (n×program_elo + k×univ_elo)/(n+k). '
                  'n=k 에서 반반. 낮출수록 학과 자체 값이 빨리 드러나고 노이즈도 커진다. '
                  '0 이면 shrinkage 를 끈다 (D-016)'
where key = 'elo.shrinkage_k';

select refresh_ranking_mv();
