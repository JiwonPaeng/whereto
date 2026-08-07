import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";

// §13.3 게시판 목록 30초 캐시.
export const revalidate = 30;

export default async function MatchupBoardPage() {
  const db = createPublicClient();

  const { data: threads } = await db
    .from("matchup_threads")
    .select(
      "matchup_key, program_lo_id, program_hi_id, vote_count, reason_count, comment_count, last_activity",
    )
    .order("last_activity", { ascending: false })
    .limit(50);

  const ids = Array.from(
    new Set((threads ?? []).flatMap((t) => [t.program_lo_id, t.program_hi_id])),
  );

  const labels = new Map<number, string>();
  if (ids.length > 0) {
    const { data } = await db
      .from("mv_ranking_overall")
      .select("program_id, university_short_name, university_name, display_name")
      .in("program_id", ids);
    for (const p of data ?? []) {
      labels.set(
        p.program_id as number,
        `${p.university_short_name ?? p.university_name} ${p.display_name}`,
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-narrow px-3 py-6 lg:py-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">매치업 토론</h1>
          <p className="mt-1 text-sm text-fg-muted">
            투표하며 공개한 선택 이유가 각 매치업 스레드로 모입니다.
          </p>
        </div>
        <Link
          href="/vote"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
        >
          투표하러 가기
        </Link>
      </header>

      {(threads ?? []).length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-3 py-10 text-center text-sm text-fg-subtle">
          아직 투표된 매치업이 없습니다.
          <br />
          <Link href="/vote" className="text-accent hover:underline">
            첫 투표를 남겨보세요.
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {(threads ?? []).map((t) => (
            <li key={t.matchup_key}>
              <Link
                href={`/matchup/${t.matchup_key}`}
                className="block px-3 py-2.5 transition-colors hover:bg-surface-sunken"
              >
                <div className="break-keep text-sm font-medium text-fg">
                  {labels.get(t.program_lo_id as number) ?? `#${t.program_lo_id}`}
                  <span className="mx-1.5 text-fg-subtle">vs</span>
                  {labels.get(t.program_hi_id as number) ?? `#${t.program_hi_id}`}
                </div>
                <div className="mt-1 flex gap-3 text-2xs text-fg-subtle tabular">
                  <span>{t.vote_count}표</span>
                  <span className={Number(t.reason_count) > 0 ? "text-accent" : ""}>
                    이유 {t.reason_count}
                  </span>
                  <span>댓글 {t.comment_count}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-2xs leading-relaxed text-fg-subtle">
        스레드는 투표가 있었던 매치업에만 생깁니다. 가능한 조합이 2만 개가 넘어 미리 만들지
        않습니다.
      </p>
    </main>
  );
}
