/**
 * 임시 토큰 확인 페이지. M1 에서 실제 랜딩/랭킹표로 교체된다.
 * §14 판단(정보 밀도, 표의 시각적 신뢰감, 카드 중립성)을 눈으로 검증하는 용도.
 *
 * 인증 상태를 표시하느라 force-dynamic 이다. M1 의 실제 랭킹 페이지는
 * §13.3 대로 ISR(revalidate 600)로 가야 한다 — 이 설정을 그대로 옮기지 말 것.
 */

import { AuthStatus } from "./AuthStatus";

export const dynamic = "force-dynamic";

const SAMPLE = [
  { rank: 1, delta: 0, univ: "가대학교", major: "컴퓨터공학부", elo: 1642, n: 312, badge: null },
  { rank: 2, delta: +3, univ: "나대학교", major: "전기전자공학부", elo: 1618, n: 287, badge: null },
  { rank: 3, delta: -1, univ: "다대학교", major: "기계공학과", elo: 1594, n: 245, badge: null },
  { rank: 4, delta: 0, univ: "라대학교", major: "화학공학과", elo: 1571, n: 33, badge: "표본 부족" },
  { rank: null, delta: null, univ: "마대학교", major: "신소재공학부", elo: 1508, n: 6, badge: "잠정" },
];

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-fg-subtle">—</span>;
  if (value === 0) return <span className="text-rank-same">—</span>;
  return value > 0 ? (
    <span className="text-rank-up">▲{value}</span>
  ) : (
    <span className="text-rank-down">▼{Math.abs(value)}</span>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-app px-4 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand">어디갈래</h1>
          <p className="mt-1 text-sm text-fg-muted">
            디자인 토큰 확인용 임시 화면 · 기획서 §14
          </p>
        </div>
        <AuthStatus />
      </header>

      {/* 투표 화면 — §14.4 좌우 카드는 색으로 구분하지 않는다 */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">투표 카드</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            { u: "가대학교", m: "컴퓨터공학부", r: "서울" },
            { u: "나대학교", m: "전기전자공학부", r: "수도권" },
          ].map((p) => (
            <button
              key={p.u}
              className="rounded-md border border-vote-card-line bg-vote-card p-6 text-left transition-colors hover:bg-vote-card-hover"
            >
              <div className="text-2xs text-fg-subtle">{p.r}</div>
              <div className="mt-1 text-3xl font-bold text-fg">{p.u}</div>
              <div className="mt-0.5 text-lg text-fg-muted">{p.m}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-base text-fg-muted">
          당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?
        </p>
        <p className="mt-2 text-2xs text-fg-subtle">
          ⚠️ 두 카드는 반드시 동일한 토큰을 쓴다. 파랑 vs 빨강 배색은 특정 학교
          상징색을 연상시켜 선택에 영향을 준다 (§14.4).
        </p>
      </section>

      {/* 랭킹표 — §14.3 표는 표처럼 보여야 한다 */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">랭킹표</h2>
        <div className="overflow-x-auto rounded-md border border-line-strong bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-2xs uppercase text-fg-subtle">
              <tr>
                <th className="px-3 py-2 text-right font-medium">순위</th>
                <th className="px-2 py-2 text-center font-medium">변동</th>
                <th className="px-3 py-2 text-left font-medium">대학</th>
                <th className="px-3 py-2 text-left font-medium">학과</th>
                <th className="px-3 py-2 text-right font-medium">선호도 지수</th>
                <th className="px-3 py-2 text-right font-medium">표본</th>
                <th className="px-3 py-2 text-left font-medium">신뢰도</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {SAMPLE.map((row) => (
                <tr key={row.univ} className="border-t border-line hover:bg-gray-25">
                  <td className="px-3 py-1.5 text-right font-semibold">
                    {row.rank ?? <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs">
                    <Delta value={row.delta} />
                  </td>
                  <td className="px-3 py-1.5 font-medium">{row.univ}</td>
                  <td className="px-3 py-1.5 text-fg-muted">{row.major}</td>
                  <td
                    className={`px-3 py-1.5 text-right font-semibold ${
                      row.badge === "잠정" ? "text-badge-provisional" : "text-fg"
                    }`}
                  >
                    {row.elo}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-fg-muted">{row.n}</td>
                  <td className="px-3 py-1.5">
                    {row.badge === "표본 부족" && (
                      <span className="inline-flex items-center gap-1 text-2xs text-warn-600">
                        <span className="size-1.5 rounded-full bg-badge-low-sample" />
                        표본 부족
                      </span>
                    )}
                    {row.badge === "잠정" && (
                      <span className="text-2xs text-fg-subtle">잠정 · 순위 미부여</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-2xs text-fg-subtle">
          계열이 다른 학과 사이의 점수 차이는 참고용입니다. 정확한 비교는 같은 계열
          안에서 이루어질 때 가장 신뢰할 수 있습니다. (§4.2.1)
        </p>
      </section>

      {/* 색 램프 */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">색 램프</h2>
        {[
          { name: "navy", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
          { name: "gray", steps: [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
          { name: "accent", steps: [300, 400, 500, 600, 700] },
        ].map((ramp) => (
          <div key={ramp.name} className="mb-2">
            <div className="mb-1 text-2xs text-fg-subtle">{ramp.name}</div>
            <div className="flex gap-1">
              {ramp.steps.map((s) => (
                <div
                  key={s}
                  className="h-8 flex-1 rounded-xs border border-line"
                  style={{ backgroundColor: `var(--color-${ramp.name}-${s})` }}
                  title={`${ramp.name}-${s}`}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 타이포 스케일 */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">타이포 스케일</h2>
        <div className="space-y-1 rounded-md border border-line bg-surface p-4">
          <p className="text-4xl font-bold">1642 — 선호도 지수 (36px)</p>
          <p className="text-3xl font-bold">가대학교 (28px)</p>
          <p className="text-2xl font-semibold">섹션 제목 (22px)</p>
          <p className="text-xl font-semibold">소제목 (18px)</p>
          <p className="text-lg">리드 문장 (16px)</p>
          <p className="text-base">기본 본문입니다. 정보 밀도 우선 (14px)</p>
          <p className="text-sm">표 본문 (13px)</p>
          <p className="text-xs text-fg-muted">보조 컬럼 (12px)</p>
          <p className="text-2xs text-fg-subtle">배지 · 캡션 (11px)</p>
        </div>
      </section>
    </main>
  );
}
