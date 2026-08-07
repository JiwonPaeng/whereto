import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { ThreadBody, type Comment, type Reason } from "./ThreadBody";

// §13.3 게시판은 30초 캐시. 댓글이 자주 바뀌므로 랭킹보다 짧게 잡는다.
export const revalidate = 30;

type ProgramLite = {
  program_id: number;
  university_short_name: string | null;
  university_name: string;
  display_name: string;
  faculty_group: string;
  elo: number;
};

/** 'p{lo}-{hi}' 형식만 받는다. 서버가 만든 키 외에는 404. */
function parseKey(key: string): [number, number] | null {
  const m = /^p(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo >= hi) return null;
  return [lo, hi];
}

export default async function MatchupThreadPage({ params }: PageProps<"/matchup/[key]">) {
  const { key } = await params;
  const parsed = parseKey(key);
  if (!parsed) notFound();
  const [lo, hi] = parsed;

  const db = createPublicClient();

  const [{ data: programs }, { data: record }, { data: reasons }, { data: comments }] =
    await Promise.all([
      db
        .from("mv_ranking_overall")
        .select(
          "program_id, university_short_name, university_name, display_name, faculty_group, elo",
        )
        .in("program_id", [lo, hi]),
      db
        .from("public_matchup_records")
        .select("wins, losses, total")
        .eq("program_id", lo)
        .eq("opponent_id", hi)
        .maybeSingle(),
      // §10.3 선택 이유가 스레드로 자동 유입된다 — 별도 복사 없이 votes 를 그대로 읽는다.
      // D-014 익명 이유도 포함되며, 그 행은 nickname 이 null 로 내려온다.
      db
        .from("public_reasons")
        .select("vote_id, nickname, is_named, winner_id, reason, reason_upvotes, created_at")
        .or(
          `and(winner_id.eq.${lo},loser_id.eq.${hi}),and(winner_id.eq.${hi},loser_id.eq.${lo})`,
        )
        .order("reason_upvotes", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("public_thread_comments")
        .select("id, parent_id, reason_vote_id, nickname, content, upvotes, created_at")
        .eq("matchup_key", key)
        .order("created_at", { ascending: true }),
    ]);

  const a = (programs ?? []).find((p) => p.program_id === lo) as ProgramLite | undefined;
  const b = (programs ?? []).find((p) => p.program_id === hi) as ProgramLite | undefined;
  if (!a || !b) notFound();

  // 로그인 여부만 확인한다. 쿠키를 읽으므로 이 호출이 라우트를 동적으로 만든다 —
  // 댓글이 자주 바뀌는 화면이라 감수한다.
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  const label = (p: ProgramLite) =>
    `${p.university_short_name ?? p.university_name} ${p.display_name}`;

  const aWins = record?.wins ?? 0;
  const bWins = record?.losses ?? 0; // lo 기준 패 = hi 의 승
  const total = aWins + bWins;

  return (
    <main className="mx-auto w-full max-w-narrow px-3 py-6 lg:py-10">
      <nav className="mb-3 text-2xs text-fg-subtle">
        <Link href="/board/matchup" className="hover:underline">
          매치업 토론
        </Link>
      </nav>

      <h1 className="text-xl font-bold text-fg lg:text-2xl">
        {label(a)} <span className="text-fg-subtle">vs</span> {label(b)}
      </h1>

      {/* 누적 득표 */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[
          { p: a, wins: aWins },
          { p: b, wins: bWins },
        ].map(({ p, wins }) => (
          <Link
            key={p.program_id}
            href={`/program/${p.program_id}`}
            className="rounded-md border border-line bg-surface p-3 transition-colors hover:bg-surface-sunken"
          >
            <div className="text-2xs text-fg-subtle">{p.faculty_group}</div>
            <div className="mt-0.5 break-keep text-sm font-semibold text-fg">{label(p)}</div>
            <div className="mt-2 text-2xl font-bold tabular">
              {total ? Math.round((wins / total) * 100) : 0}%
            </div>
            <div className="text-2xs text-fg-subtle tabular">
              {wins}표 · 지수 {p.elo}
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-1.5 text-center text-2xs text-fg-subtle">이 쌍의 누적 {total}표</p>

      <ThreadBody
        programLo={lo}
        programHi={hi}
        sides={[a, b].map((p) => ({
          program_id: p.program_id,
          short: p.university_short_name ?? p.university_name,
        }))}
        reasons={(reasons ?? []) as Reason[]}
        comments={(comments ?? []) as Comment[]}
        isLoggedIn={!!user}
      />
    </main>
  );
}
