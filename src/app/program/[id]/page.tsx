import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import {
  ProgramDetail,
  type ProgramInfo,
  type HistoryPoint,
  type ReasonItem,
  type RecordItem,
} from "./ProgramDetail";

// §13.3 Program 상세는 ISR(300).
export const revalidate = 300;

/**
 * 전 Program 을 빌드 시점에 프리렌더한다.
 * 이게 없으면 동적 세그먼트가 프리렌더 대상에서 빠져 매 요청이 서버 렌더가 된다 —
 * §13.3 의 ISR 의도와 어긋나고, M4 의 "Program 상세를 SEO 랜딩 페이지로"에도 불리하다.
 * 현재 202개라 빌드 비용이 작다. 대학이 크게 늘면 상위 N개만 프리렌더하는 방식으로 바꾼다.
 */
export async function generateStaticParams() {
  const supabase = createPublicClient();
  const { data } = await supabase.from("programs").select("id").eq("is_active", true);
  return (data ?? []).map((p) => ({ id: String(p.id) }));
}

export default async function ProgramPage({ params }: PageProps<"/program/[id]">) {
  const { id } = await params;
  const programId = Number(id);
  if (!Number.isFinite(programId)) notFound();

  const supabase = createPublicClient();

  const { data: program } = await supabase
    .from("mv_ranking_overall")
    .select(
      "program_id, university_name, university_short_name, campus, region_group, faculty_group, display_name, elo, vote_count, win_count, win_rate, confidence, rank_overall, rank_faculty, rank_region, rank_delta",
    )
    .eq("program_id", programId)
    .maybeSingle();

  if (!program) notFound();

  const [{ data: history }, { data: reasons }, { data: records }] = await Promise.all([
    supabase
      .from("rating_history")
      .select("snapshot_date, elo, rank_overall")
      .eq("program_id", programId)
      .order("snapshot_date", { ascending: true })
      .limit(90),
    // §4.1.1 공개된 이유만. 이 학과를 '선택한' 이유이므로 winner_id 기준이다.
    supabase
      .from("public_reasons")
      .select("vote_id, nickname, is_named, reason, reason_upvotes, created_at")
      .eq("winner_id", programId)
      .order("reason_upvotes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("public_matchup_records")
      .select("opponent_id, total, wins, losses")
      .eq("program_id", programId)
      .order("total", { ascending: false })
      .limit(30),
  ]);

  // 상대 이름은 별도 조회한다 — 뷰라서 PostgREST 관계 조인이 안 걸린다.
  const opponentIds = (records ?? []).map((r) => r.opponent_id);
  let labels = new Map<number, string>();
  if (opponentIds.length > 0) {
    const { data: opps } = await supabase
      .from("mv_ranking_overall")
      .select("program_id, university_short_name, university_name, display_name")
      .in("program_id", opponentIds);
    labels = new Map(
      (opps ?? []).map((o) => [
        o.program_id as number,
        `${o.university_short_name ?? o.university_name} ${o.display_name}`,
      ]),
    );
  }

  const recordItems: RecordItem[] = (records ?? []).map((r) => ({
    opponent_id: r.opponent_id as number,
    opponent_label: labels.get(r.opponent_id as number) ?? `#${r.opponent_id}`,
    total: r.total as number,
    wins: r.wins as number,
    losses: r.losses as number,
  }));

  const p = program as ProgramInfo;

  return (
    <main className="mx-auto w-full max-w-app px-3 py-6 lg:py-10">
      <nav className="mb-3 text-2xs text-fg-subtle">
        <Link href="/ranking" className="hover:underline">
          배치표
        </Link>
        <span className="mx-1">/</span>
        <span>{p.university_short_name ?? p.university_name}</span>
      </nav>

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-3">
        <div>
          <h1 className="text-2xl font-bold text-fg lg:text-3xl">
            {p.university_short_name ?? p.university_name}{" "}
            <span className="font-semibold text-fg-muted">{p.display_name}</span>
          </h1>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge>{p.faculty_group}</Badge>
            <Badge>{p.region_group}</Badge>
            <Badge>{p.campus}</Badge>
          </div>
        </div>
        <Link
          href="/vote"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
        >
          투표하러 가기
        </Link>
      </header>

      <ProgramDetail
        program={p}
        history={(history ?? []) as HistoryPoint[]}
        reasons={(reasons ?? []) as ReasonItem[]}
        records={recordItems}
      />

      <p className="mt-6 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
        계열이 다른 학과 사이의 점수 차이는 참고용입니다. 정확한 비교는{" "}
        <strong>같은 계열 안에서</strong> 이루어질 때 가장 신뢰할 수 있습니다.
      </p>
      <p className="mt-2 text-2xs leading-relaxed text-fg-subtle">
        본 지표는 수험생들의 <strong>선호도 투표 결과</strong>이며, 대학의 교육 품질·학문적
        수준·연구 역량에 대한 평가가 아닙니다.
      </p>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-subtle">
      {children}
    </span>
  );
}
