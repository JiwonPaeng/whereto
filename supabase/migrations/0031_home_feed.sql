-- 홈 커뮤니티 피드
--
-- 적용 시점의 마이그레이션 5건(home_feed, home_feed_fix, home_feed_neck,
-- home_feed_neck_same_faculty, home_feed_neck_cross_university)을 최종 상태로 합쳤다.

-- ── 큐레이션 임계값 (§0 #4 — 코드에 하드코딩하지 않는다) ────────────────
insert into app_config (key, value_num, description) values
  ('home.close_min_votes', 3,
   '홈 "박빙 매치업"에 올리기 위한 최소 표수. 2표에서 1:1 은 박빙이 아니라 표본 부족이다'),
  ('home.list_size', 5, '홈 각 목록의 항목 수')
on conflict (key) do nothing;


-- ── matchup_threads 에 진영별 승수 추가 ──────────────────────────────────
-- create or replace 로 컬럼을 **뒤에 추가**하는 것은 된다 (이름 변경·순서 변경·삭제는 안 된다).
-- 뷰는 security_invoker 가 아니므로 소유자 권한으로 돌아 votes 의 RLS 를 우회한다 —
-- 이것이 비로그인에게도 스레드 목록이 보이는 이유다 (§9.6).
create or replace view matchup_threads as
 WITH pairs AS (
         SELECT LEAST(v.program_a_id, v.program_b_id) AS program_lo_id,
            GREATEST(v.program_a_id, v.program_b_id) AS program_hi_id,
            count(*) AS vote_count,
            count(*) FILTER (WHERE (v.reason_public AND (v.reason IS NOT NULL))) AS reason_count,
            max(v.created_at) AS last_vote_at,
            count(*) FILTER (WHERE v.winner_id = LEAST(v.program_a_id, v.program_b_id)) AS lo_wins,
            count(*) FILTER (WHERE v.winner_id = GREATEST(v.program_a_id, v.program_b_id)) AS hi_wins
           FROM votes v
          WHERE v.is_valid
          GROUP BY LEAST(v.program_a_id, v.program_b_id), GREATEST(v.program_a_id, v.program_b_id)
        )
 SELECT ((('p'::text || p.program_lo_id) || '-'::text) || p.program_hi_id) AS matchup_key,
    p.program_lo_id,
    p.program_hi_id,
    p.vote_count,
    p.reason_count,
    COALESCE(c.comment_count, (0)::bigint) AS comment_count,
    GREATEST(p.last_vote_at, COALESCE(c.last_comment_at, p.last_vote_at)) AS last_activity,
    p.lo_wins,
    p.hi_wins
   FROM (pairs p
     LEFT JOIN LATERAL ( SELECT count(cm.id) AS comment_count,
            max(cm.created_at) AS last_comment_at
           FROM (posts po
             JOIN comments cm ON (((cm.post_id = po.id) AND (NOT cm.is_deleted))))
          WHERE ((po.matchup_key = ((('p'::text || p.program_lo_id) || '-'::text) || p.program_hi_id)) AND (NOT po.is_deleted))) c ON (true));

grant select on matchup_threads to anon, authenticated;


-- 학과 하나를 화면에 쓸 형태로 돌려준다. 목록마다 조인을 반복하지 않기 위한 헬퍼.
create or replace function program_label(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'university', coalesce(u.short_name, u.name),
    'campus', u.campus,
    'name', p.display_name,
    'faculty_group', p.faculty_group
  )
  from programs p join universities u on u.id = p.university_id
  where p.id = p_id;
$$;

revoke all on function program_label(bigint) from public;
grant execute on function program_label(bigint) to anon, authenticated;


-- ── 홈 피드 ─────────────────────────────────────────────────────────────
-- 홈에 필요한 목록 전부를 **한 번의 왕복**으로 돌려준다. §13.3 — 서버측 Supabase
-- 호출은 왕복 비용이 있고, 예전에 홈이 느렸던 원인이 순차 쿼리였다.
--
-- ⚠️ "누가 어느 쪽을 골랐는지"는 내보내지 않는다 (§4.1.2).
-- ⚠️ 표가 늘면 매 요청마다 votes 전체를 훑게 된다. 트래픽이 붙으면 MV 로 옮길 것.
create or replace function home_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_close int;
  v_n int;
begin
  select coalesce(max(value_num) filter (where key = 'home.close_min_votes'), 3)::int,
         coalesce(max(value_num) filter (where key = 'home.list_size'), 5)::int
  into v_min_close, v_n
  from app_config;

  return jsonb_build_object(
    'stats', (select to_jsonb(s) from public_stats s),

    -- 🔥 반응이 뜨거운 매치업: 이유 + 댓글이 많은 쪽. 표만 많은 것은 "반응"이 아니다.
    'hot', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.heat desc, x.last_activity desc), '[]'::jsonb)
      from (
        select t.matchup_key, t.vote_count, t.reason_count, t.comment_count, t.last_activity,
               (t.reason_count + t.comment_count) as heat,
               program_label(t.program_lo_id) as lo, program_label(t.program_hi_id) as hi
        from matchup_threads t
        where t.reason_count + t.comment_count > 0
        order by (t.reason_count + t.comment_count) desc, t.last_activity desc
        limit v_n
      ) x
    ),

    -- ⚖️ 박빙 매치업: 쌍 단위로 표가 갈린 정도. 최소 표수 미달은 박빙이 아니라 표본 부족이다.
    -- ⚠️ 부트스트랩 구간에서는 대체로 비어 있다 — §5.4 매칭이 표를 2,056개 학과에 퍼뜨려
    --    같은 쌍이 반복되지 않는다(839표 / 839쌍). 화면은 비었을 때 neck 을 대신 쓴다.
    'close', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.margin, x.vote_count desc), '[]'::jsonb)
      from (
        select t.matchup_key, t.vote_count, t.lo_wins, t.hi_wins,
               round(abs(t.lo_wins - t.hi_wins)::numeric / t.vote_count, 4) as margin,
               program_label(t.program_lo_id) as lo, program_label(t.program_hi_id) as hi
        from matchup_threads t
        where t.vote_count >= v_min_close and t.lo_wins > 0 and t.hi_wins > 0
        order by abs(t.lo_wins - t.hi_wins)::numeric / t.vote_count, t.vote_count desc
        limit v_n
      ) x
    ),

    -- ⚖️ 지수가 맞붙은 학과: 표시 지수가 인접한 두 학과.
    --
    -- 세 조건이 다 필요하다.
    --  · 같은 계열만 — 계열이 다른 점수 차이는 응답자 계열 분포에 좌우된다 (§4.2.1).
    --    홈 대표 자리에 서비스가 스스로 경고한 비교를 올릴 수 없다.
    --  · 서로 다른 대학만 — D-016 shrinkage 는
    --    elo_display = (n×program_elo + k×univ_elo)/(n+k) 이므로 같은 대학에서 표본 수가
    --    같은 두 학과는 **계산상 반드시 같은 값**이 된다. 관측된 동률이 아니다.
    --  · 양쪽 모두 표가 있어야 — 표 0이면 소속 대학 값 그대로라 우연히 같아진 것이다.
    'neck', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.gap, x.votes desc), '[]'::jsonb)
      from (
        select program_label(a.program_id) as lo, program_label(a.next_id) as hi,
               a.faculty_group, a.elo_a, a.elo_b, (a.elo_a - a.elo_b) as gap,
               (a.votes_a + a.votes_b) as votes
        from (
          select r.program_id, r.faculty_group, r.university_id,
                 r.elo_display as elo_a, r.vote_count as votes_a,
                 lead(r.program_id)    over w as next_id,
                 lead(r.elo_display)   over w as elo_b,
                 lead(r.vote_count)    over w as votes_b,
                 lead(r.university_id) over w as next_univ
          from mv_ranking_overall r
          where r.faculty_group <> '예체능' and r.vote_count > 0
          window w as (partition by r.faculty_group order by r.elo_display desc, r.program_id)
        ) a
        where a.next_id is not null
          and a.university_id <> a.next_univ
        order by (a.elo_a - a.elo_b), (a.votes_a + a.votes_b) desc
        limit v_n
      ) x
    ),

    -- 💬 말이 많은 학과: 자기가 낀 매치업에서 발생한 이유 + 댓글 총합
    'programs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.heat desc, x.votes desc), '[]'::jsonb)
      from (
        select g.program_id, g.heat, g.votes,
               program_label(g.program_id) as label,
               r.elo_display as elo, r.confidence
        from (
          select p.program_id,
                 sum(p.reason_count + p.comment_count) as heat,
                 sum(p.vote_count) as votes
          from (
            select program_lo_id as program_id, reason_count, comment_count, vote_count from matchup_threads
            union all
            select program_hi_id, reason_count, comment_count, vote_count from matchup_threads
          ) p
          group by p.program_id
          having sum(p.reason_count + p.comment_count) > 0
          order by 2 desc, 3 desc
          limit v_n
        ) g
        left join mv_ranking_overall r on r.program_id = g.program_id
      ) x
    ),

    -- 최근 선택 이유. public_reasons 가 이미 익명 처리를 담당한다 (§9.6).
    'reasons', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select r.vote_id, r.reason, r.is_named, r.nickname, r.created_at,
               program_label(r.winner_id) as winner,
               'p' || least(r.winner_id, r.loser_id) || '-'
                    || greatest(r.winner_id, r.loser_id) as matchup_key
        from public_reasons r
        order by r.created_at desc
        limit v_n
      ) x
    )
  );
end;
$$;

revoke all on function home_feed() from public;
grant execute on function home_feed() to anon, authenticated;
