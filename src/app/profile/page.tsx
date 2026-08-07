import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyVotes, type MyVote } from "./MyVotes";

export const metadata: Metadata = { title: "내 정보 · 어디갈래" };
export const dynamic = "force-dynamic";

type Stats = {
  total: number;
  reasons: number;
  by_faculty: Record<string, number>;
  majority_rate: number | null;
  decided: number;
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 세 쿼리를 한 번에 던진다. 순차로 하면 Supabase 왕복이 그대로 쌓인다.
  const [{ data: profile }, { data: stats }, { data: rawVotes }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, nickname, status, track, age_years, vote_weight, trust_coeff, reputation_raw, reputation_mult, created_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("my_vote_stats"),
    // RLS 로 본인 행만 조회된다 (§8.2).
    supabase
      .from("votes")
      .select(
        "id, winner_id, program_a_id, program_b_id, reason, reason_public, weight_applied, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (!profile) redirect("/onboarding");

  const ids = Array.from(
    new Set((rawVotes ?? []).flatMap((v) => [v.program_a_id, v.program_b_id])),
  );
  const labels = new Map<number, string>();
  if (ids.length > 0) {
    const { data } = await supabase
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

  const votes: MyVote[] = (rawVotes ?? []).map((v) => {
    const loserId = v.winner_id === v.program_a_id ? v.program_b_id : v.program_a_id;
    return {
      id: v.id as number,
      winner_id: v.winner_id as number,
      winner_label: labels.get(v.winner_id as number) ?? `#${v.winner_id}`,
      loser_label: labels.get(loserId as number) ?? `#${loserId}`,
      reason: v.reason as string | null,
      reason_public: v.reason_public as boolean,
      counted: Number(v.weight_applied) > 0,
      created_at: v.created_at as string,
    };
  });

  const s = (stats ?? {}) as Partial<Stats>;

  return (
    <main className="mx-auto w-full max-w-narrow px-3 py-6 lg:py-10">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">{profile.nickname}</h1>
          <p className="mt-1 text-2xs text-fg-subtle">
            {profile.status} · {profile.track} · 만 {profile.age_years}세 ·{" "}
            {new Date(profile.created_at).toLocaleDateString("ko-KR")} 가입
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/u/${profile.id}`}
            className="rounded-md border border-line-strong px-3 py-1.5 text-xs hover:bg-surface-sunken"
          >
            공개 프로필 보기
          </Link>
          <form action="/auth/signout" method="post">
            <button className="rounded-md border border-line-strong px-3 py-1.5 text-xs hover:bg-surface-sunken">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {/* §6.2 비공개 영역 — 내 투표 통계 */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">내 투표 통계</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="총 투표" value={s.total ?? 0} />
          <Stat label="남긴 이유" value={s.reasons ?? 0} />
          <Stat
            label="다수 의견 일치율"
            value={
              s.majority_rate === null || s.majority_rate === undefined
                ? "—"
                : `${Math.round(s.majority_rate * 100)}%`
            }
            hint={`표가 갈린 ${s.decided ?? 0}건 기준`}
          />
          <Stat label="투표 반영도" value={Number(profile.vote_weight)} hint="w_age × 신뢰도" />
        </div>

        {s.by_faculty && Object.keys(s.by_faculty).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(s.by_faculty).map(([fg, c]) => (
              <span
                key={fg}
                className="rounded-sm bg-surface-sunken px-2 py-1 text-2xs text-fg-muted"
              >
                {fg} <strong className="text-fg">{c}</strong>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* §6.2 비공개 영역 — 전체 투표 기록 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          내 투표 기록{" "}
          <span className="text-2xs font-normal text-fg-subtle">
            나만 볼 수 있습니다 · 최근 100건
          </span>
        </h2>
        <MyVotes votes={votes} />
      </section>

      <p className="mt-6 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
        투표 자체는 다른 이용자에게 공개되지 않습니다. 공개되는 것은 이유를 남긴 경우 그
        내용뿐이며, 닉네임 표시 여부는 위에서 언제든 바꿀 수 있습니다.
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="text-2xs text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
