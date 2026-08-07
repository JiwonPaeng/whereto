import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { PlacementChart, type RankRow } from "./PlacementChart";

// §13.3 랭킹은 materialized view + ISR. 실시간성보다 읽기 부하 방어가 중요하다.
export const revalidate = 600;

export default async function RankingPage() {
  const supabase = createPublicClient();

  // 예체능 제외 (D-011). 매칭이 분리되어 지수 척도가 인문·자연과 이어지지 않는다.
  // 데이터는 그대로 있으며 조회에서만 뺀다.
  //
  // ⚠️ Supabase 의 db-max-rows 가 1000 이라 limit·Range 로 넘길 수 없다.
  // 페이지네이션하지 않으면 1,763개 중 1,000개만 그려지고 나머지가 조용히 사라진다.
  const PAGE = 1000;
  const rows: RankRow[] = [];
  let error: { message: string } | null = null;

  for (let from = 0; ; from += PAGE) {
    const res = await supabase
      .from("mv_ranking_overall")
      .select(
        "program_id, university_name, university_short_name, campus, region_group, faculty_group, display_name, elo, vote_count, win_rate, confidence, rank_overall, rank_faculty",
      )
      .neq("faculty_group", "예체능")
      .order("elo", { ascending: false })
      .order("program_id", { ascending: true }) // 페이지 경계에서 순서가 흔들리지 않게
      .range(from, from + PAGE - 1);

    if (res.error) {
      error = res.error;
      break;
    }
    rows.push(...((res.data ?? []) as RankRow[]));
    if (!res.data || res.data.length < PAGE) break;
  }
  const provisional = rows.filter((r) => r.confidence === "잠정").length;

  return (
    <main className="mx-auto w-full max-w-app px-3 py-6 lg:py-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">선호도 배치표</h1>
          <p className="mt-1 text-sm text-fg-muted">
            세로축이 선호도 지수입니다. 같은 높이면 같은 지수입니다.
          </p>
        </div>
        <Link
          href="/vote"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
        >
          투표하러 가기
        </Link>
      </header>

      {error && (
        <p className="mb-3 rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
          랭킹을 불러오지 못했습니다: {error.message}
        </p>
      )}

      {rows.length > 0 && provisional === rows.length && (
        <p className="mb-3 rounded-md border border-warn-400 bg-surface px-3 py-2 text-sm text-warn-600">
          아직 모든 학과가 <strong>잠정</strong> 상태입니다. 표본이 쌓이기 전이라 전부 같은
          지수(1500)에서 출발해 있으며, 순위가 부여되지 않습니다. 투표가 모이면 세로로
          흩어집니다.
        </p>
      )}

      <PlacementChart rows={rows} />

      {/* §4.2.1 계열 간 비교 안내 — 상시 노출 */}
      <p className="mt-6 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
        계열이 다른 학과 사이의 점수 차이는 참고용입니다. 응답자의 계열 분포에 영향을 받기
        때문에, 정확한 비교는 <strong>같은 계열 안에서</strong> 이루어질 때 가장 신뢰할 수
        있습니다.
      </p>

      {/* §12.1 고지 문구 — 하단 배치 (§16 #3 은 구현 중 결정하기로 되어 있었다) */}
      <p className="mt-2 text-2xs leading-relaxed text-fg-subtle">
        본 지표는 수험생들의 <strong>선호도 투표 결과</strong>이며, 대학의 교육 품질·학문적
        수준·연구 역량에 대한 평가가 아닙니다.
      </p>
    </main>
  );
}
