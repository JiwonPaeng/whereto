import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";

// 인증 상태와 실시간 집계를 보여주므로 동적이다.
// M4 SEO 작업 때 정적 부분과 분리하는 것을 검토한다.
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = createPublicClient();

  // votes 는 §8.2 로 anon 에게 행 조회가 막혀 있다. 집계는 public_stats 뷰로 읽는다 —
  // 직접 count 하면 0 이 나온다.
  const [stats, reasons] = await Promise.all([
    db.from("public_stats").select("votes, reasons, voters, programs, universities").maybeSingle(),
    db
      .from("public_reasons")
      .select("vote_id, nickname, is_named, winner_id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(4),
  ]);

  // 이유에 붙일 학과 이름
  const winnerIds = Array.from(new Set((reasons.data ?? []).map((r) => r.winner_id)));
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
    <main className="flex-1">
      {/* 히어로 */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-app px-4 py-12 lg:py-20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-2xs font-semibold uppercase tracking-wider text-accent">
                수험생이 만드는 대학·학과 선호도 지수
              </p>
              {/* §1.2 서비스의 헌법. 어디서도 "어디가 더 좋은 학교인가"로 바꾸지 않는다. */}
              <h1 className="mt-2 break-keep text-2xl font-bold leading-snug text-fg lg:text-4xl">
                당신이 이 두 곳을 모두 갈 수 있다면,
                <br />
                어디를 선택하시겠습니까?
              </h1>
              <p className="mt-4 break-keep text-sm leading-relaxed text-fg-muted lg:text-base">
                입결·취업률은 이미 숫자로 나와 있습니다. 하지만 수험생이 실제로 어디를 더 가고
                싶어 하는지는 어디에도 수치화되어 있지 않습니다. 두 학과를 놓고 고르는 투표를
                모아 그 선호를 하나의 숫자로 만듭니다.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href="/vote"
                  className="rounded-md bg-brand px-5 py-2.5 text-base font-semibold text-fg-on-brand transition-colors hover:bg-brand-hover"
                >
                  투표 시작하기
                </Link>
                <Link
                  href="/ranking"
                  className="rounded-md border border-line-strong px-5 py-2.5 text-base font-medium text-fg transition-colors hover:bg-surface-sunken"
                >
                  배치표 보기
                </Link>
              </div>
              <p className="mt-2 text-2xs text-fg-subtle">
                로그인 없이도 투표할 수 있습니다. 로그인하면 반영 비중이 커집니다.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* 현황 */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-app grid-cols-3 divide-x divide-line px-4">
          <Stat label="누적 투표" value={stats.data?.votes ?? 0} />
          <Stat label="학과" value={stats.data?.programs ?? 0} />
          <Stat label="대학" value={stats.data?.universities ?? 0} />
        </div>
      </section>

      <div className="mx-auto max-w-app px-4 py-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          {/* 작동 방식 */}
          <section>
            <h2 className="text-lg font-bold text-fg">어떻게 만들어지나요</h2>
            <ol className="mt-3 space-y-3">
              <Step n={1} title="서버가 두 학과를 골라 보여줍니다">
                비슷한 지수끼리, 그리고 노출이 적었던 학과를 섞어 제시합니다. 이용자가 비교할
                대상을 임의로 정할 수는 없습니다.
              </Step>
              <Step n={2} title="선택이 지수에 반영됩니다">
                ELO 방식으로 이긴 쪽이 오르고 진 쪽이 내려갑니다. 예상 밖의 결과일수록 크게
                움직입니다.
              </Step>
              <Step n={3} title="표본이 적으면 대학 수준으로 추정합니다">
                아직 표가 모이지 않은 학과는 소속 대학의 지수 쪽으로 당겨 표시하고, 투표가 쌓일수록
                학과 자체의 값으로 옮겨갑니다.
              </Step>
            </ol>

            <p className="mt-4 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
              누가 어느 쪽을 골랐는지는 공개되지 않습니다. 공개되는 것은 남기기로 선택한 &ldquo;선택
              이유&rdquo;뿐이며, 닉네임 표시 여부도 직접 정할 수 있습니다.
            </p>
          </section>

          {/* 최근 이유 */}
          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold text-fg">최근 선택 이유</h2>
              <Link href="/board/matchup" className="text-2xs text-accent hover:underline">
                매치업 토론 →
              </Link>
            </div>

            {(reasons.data ?? []).length === 0 ? (
              <p className="mt-3 rounded-md border border-line bg-surface px-3 py-8 text-center text-xs text-fg-subtle">
                아직 남겨진 이유가 없습니다.
                <br />
                <Link href="/vote" className="text-accent hover:underline">
                  첫 이유를 남겨보세요.
                </Link>
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface">
                {(reasons.data ?? []).map((r) => (
                  <li key={r.vote_id} className="px-3 py-2.5">
                    <Link
                      href={`/program/${r.winner_id}`}
                      className="mr-1.5 whitespace-nowrap rounded-sm bg-vote-selected-bg px-1.5 py-0.5 text-2xs font-semibold text-brand hover:underline"
                    >
                      {labels.get(r.winner_id as number) ?? "학과"}
                    </Link>
                    <span className="text-sm leading-relaxed text-fg">{r.reason}</span>
                    <p className="mt-1 text-2xs text-fg-subtle">
                      {r.is_named ? r.nickname : <span className="italic">익명</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* §12.1 고지 */}
        <p className="mt-10 border-t border-line pt-4 text-2xs leading-relaxed text-fg-subtle">
          본 지표는 수험생들의 <strong>선호도 투표 결과</strong>이며, 대학의 교육 품질·학문적
          수준·연구 역량에 대한 평가가 아닙니다. 입시 결과를 예측하거나 대체하지 않습니다.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-5 text-center">
      <div className="text-2xl font-bold tabular text-brand lg:text-3xl">
        {value.toLocaleString("ko-KR")}
      </div>
      <div className="mt-0.5 text-2xs text-fg-subtle">{label}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-2xs font-bold text-fg-on-brand">
        {n}
      </span>
      <div>
        <div className="text-sm font-semibold text-fg">{title}</div>
        <p className="mt-0.5 break-keep text-xs leading-relaxed text-fg-muted">{children}</p>
      </div>
    </li>
  );
}
