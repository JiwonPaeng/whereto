import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";

// 공개 프로필은 자주 바뀌지 않는다. 게시판과 같은 30초 캐시.
export const revalidate = 30;

export default async function PublicProfilePage({ params }: PageProps<"/u/[id]">) {
  const { id } = await params;
  const db = createPublicClient();

  // §6.2 공개 영역 — 닉네임, 가입 시기, 평판 점수.
  // 생년월일·연령·가중치·편향 스코어는 public_profiles 뷰에 아예 없다.
  const { data: profile } = await db
    .from("public_profiles")
    .select("id, nickname, created_at, reputation_raw")
    .eq("id", id)
    .maybeSingle();

  if (!profile) notFound();

  // 닉네임을 공개한 이유만. 익명으로 남긴 이유는 프로필에 뜨지 않는다 (D-014).
  const { data: reasons } = await db
    .from("public_reasons")
    .select("vote_id, winner_id, reason, reason_upvotes, created_at")
    .eq("profile_id", profile.id)
    .eq("is_named", true)
    .order("created_at", { ascending: false })
    .limit(50);

  const winnerIds = Array.from(new Set((reasons ?? []).map((r) => r.winner_id)));
  const labels = new Map<number, string>();
  if (winnerIds.length > 0) {
    const { data } = await db
      .from("mv_ranking_overall")
      .select("program_id, university_short_name, university_name, display_name")
      .in("program_id", winnerIds);
    for (const p of data ?? []) {
      labels.set(
        p.program_id as number,
        `${p.university_short_name ?? p.university_name} ${p.display_name}`,
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-narrow px-3 py-6 lg:py-10">
      <header className="mb-5 border-b border-line-strong pb-3">
        <h1 className="text-2xl font-bold text-fg">{profile.nickname}</h1>
        <p className="mt-1 text-2xs text-fg-subtle">
          {new Date(profile.created_at).toLocaleDateString("ko-KR")} 가입 · 평판{" "}
          {profile.reputation_raw}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          공개한 선택 이유{" "}
          <span className="text-2xs font-normal text-fg-subtle">
            익명으로 남긴 이유는 표시되지 않습니다
          </span>
        </h2>

        {(reasons ?? []).length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-3 py-8 text-center text-sm text-fg-subtle">
            공개한 선택 이유가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {(reasons ?? []).map((r) => (
              <li key={r.vote_id} className="px-3 py-2.5">
                <Link
                  href={`/program/${r.winner_id}`}
                  className="mr-1.5 whitespace-nowrap rounded-sm bg-vote-selected-bg px-1.5 py-0.5 text-2xs font-semibold text-brand hover:underline"
                >
                  {labels.get(r.winner_id as number) ?? `#${r.winner_id}`}
                </Link>
                <span className="text-sm leading-relaxed text-fg">{r.reason}</span>
                <p className="mt-1 text-2xs text-fg-subtle">
                  추천 {r.reason_upvotes} ·{" "}
                  {new Date(r.created_at).toLocaleDateString("ko-KR")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* §4.1.2 — 투표 자체는 어떤 화면에서도 노출되지 않는다. */}
      <p className="mt-6 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
        투표 기록은 공개되지 않습니다. 이 페이지에는 본인이 닉네임과 함께 공개하기로 선택한
        &ldquo;선택 이유&rdquo;만 표시됩니다.
      </p>
    </main>
  );
}
