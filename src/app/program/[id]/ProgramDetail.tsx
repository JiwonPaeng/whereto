"use client";

import Link from "next/link";
import { useState } from "react";

export type ProgramInfo = {
  program_id: number;
  university_name: string;
  university_short_name: string | null;
  campus: string;
  region_group: string;
  faculty_group: string;
  display_name: string;
  elo: number;
  /** D-016 대학 ELO 로 shrink 한 표시값 */
  elo_display: number;
  university_elo: number;
  vote_count: number;
  win_count: number;
  win_rate: number | null;
  confidence: string | null;
  rank_overall: number | null;
  rank_faculty: number | null;
  rank_region: number | null;
  rank_delta: number | null;
};

export type HistoryPoint = { snapshot_date: string; elo: number; rank_overall: number | null };
export type ReasonItem = {
  vote_id: number;
  /** D-014 익명 이유는 null 로 내려온다 */
  nickname: string | null;
  is_named: boolean;
  reason: string;
  reason_upvotes: number;
  created_at: string;
};
export type RecordItem = {
  opponent_id: number;
  opponent_label: string;
  total: number;
  wins: number;
  losses: number;
};

type Tab = "지표" | "이유" | "전적";

export function ProgramDetail({
  program,
  history,
  reasons,
  records,
}: {
  program: ProgramInfo;
  history: HistoryPoint[];
  reasons: ReasonItem[];
  records: RecordItem[];
}) {
  const [tab, setTab] = useState<Tab>("지표");

  return (
    <>
      {/* 모바일은 탭 전환, 데스크톱은 2단 동시 표시 (§14.2) */}
      <div className="mb-3 flex gap-1 lg:hidden">
        {(["지표", "이유", "전적"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors",
              tab === t
                ? "border-accent bg-vote-selected-bg font-semibold text-brand"
                : "border-line-strong bg-surface text-fg-muted",
            ].join(" ")}
          >
            {t}
            {t === "이유" && reasons.length > 0 && (
              <span className="ml-1 text-2xs text-fg-subtle">{reasons.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <section className={tab === "지표" ? "" : "hidden lg:block"}>
          <Metrics program={program} />
          <div className="mt-4 rounded-lg border border-line bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold">지수 변동 추이</h2>
            <EloChart history={history} />
          </div>
        </section>

        <div className="space-y-4">
          <section
            className={
              tab === "이유" ? "" : "hidden lg:block"
            }
          >
            <div className="rounded-lg border border-line bg-surface p-3">
              <h2 className="mb-2 text-sm font-semibold">
                이 학과를 선택한 이유{" "}
                <span className="text-2xs font-normal text-fg-subtle">
                  공개된 것만
                </span>
              </h2>
              {reasons.length === 0 ? (
                <p className="py-6 text-center text-xs text-fg-subtle">
                  아직 공개된 이유가 없습니다.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {reasons.map((r) => (
                    <li key={r.vote_id} className="py-2">
                      <p className="text-sm leading-relaxed text-fg">{r.reason}</p>
                      <p className="mt-1 text-2xs text-fg-subtle">
                        <span className={r.is_named ? "" : "italic"}>
                          {r.is_named ? r.nickname : "익명"}
                        </span>{" "}
                        · 추천 {r.reason_upvotes}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={tab === "전적" ? "" : "hidden lg:block"}>
            <div className="rounded-lg border border-line bg-surface p-3">
              <h2 className="mb-2 text-sm font-semibold">상대 전적</h2>
              {records.length === 0 ? (
                <p className="py-6 text-center text-xs text-fg-subtle">
                  아직 맞붙은 기록이 없습니다.
                </p>
              ) : (
                <table className="w-full text-xs tabular">
                  <thead className="text-2xs text-fg-subtle">
                    <tr>
                      <th className="py-1 text-left font-medium">상대</th>
                      <th className="py-1 text-right font-medium">승</th>
                      <th className="py-1 text-right font-medium">패</th>
                      <th className="py-1 text-right font-medium">승률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.opponent_id} className="border-t border-line">
                        <td className="py-1.5">
                          <Link
                            href={`/program/${r.opponent_id}`}
                            className="hover:text-accent hover:underline"
                          >
                            {r.opponent_label}
                          </Link>
                        </td>
                        <td className="py-1.5 text-right">{r.wins}</td>
                        <td className="py-1.5 text-right">{r.losses}</td>
                        <td className="py-1.5 text-right">
                          {Math.round((r.wins / r.total) * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Metrics({ program: p }: { program: ProgramInfo }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xs text-fg-subtle">선호도 지수</div>
          <div
            className={`text-4xl font-bold tabular ${
              p.confidence === "잠정" ? "text-badge-provisional" : "text-fg"
            }`}
          >
            {p.elo_display}
          </div>
          {p.confidence === "잠정" && (
            <div className="mt-0.5 text-2xs text-fg-subtle">
              표본이 적어 소속 대학 수준({p.university_elo})으로 추정한 값입니다
            </div>
          )}
        </div>
        {p.confidence && (
          <span className="rounded-sm bg-surface-sunken px-2 py-1 text-2xs text-warn-600">
            {p.confidence}
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <Stat label="전체 순위" value={p.rank_overall} delta={p.rank_delta} />
        <Stat label={`${p.faculty_group} 내`} value={p.rank_faculty} />
        <Stat label={`${p.region_group} 내`} value={p.rank_region} />
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-center">
        <Stat label="표본 수" value={p.vote_count} />
        <Stat
          label="승률"
          value={p.win_rate === null ? null : Math.round(p.win_rate * 100)}
          suffix="%"
        />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  delta,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  delta?: number | null;
}) {
  return (
    <div>
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="text-lg font-semibold tabular">
        {value === null ? <span className="text-fg-subtle">—</span> : `${value}${suffix ?? ""}`}
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span
            className={`ml-1 text-2xs ${delta > 0 ? "text-rank-up" : "text-rank-down"}`}
          >
            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * §4.3 지수 변동 추이.
 * Recharts(§13.1) 대신 인라인 SVG 를 쓴다 — 단일 시리즈에 상호작용도 없는데
 * ISR 페이지 전체에 차트 라이브러리를 실어보내는 것은 §13.3 읽기 부하 방어와 어긋난다.
 * 차트가 늘어나면(§8.5 어드민 대시보드) 그때 Recharts 를 도입한다.
 */
function EloChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <p className="py-10 text-center text-xs text-fg-subtle">
        추이를 그리려면 최소 2일치 스냅샷이 필요합니다.
        <br />
        <span className="text-2xs">
          일 배치가 매일 06:00에 기록합니다. 현재 {history.length}일치.
        </span>
      </p>
    );
  }

  const W = 600, H = 160, PAD = 28;
  const elos = history.map((h) => h.elo);
  const min = Math.min(...elos), max = Math.max(...elos);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (history.length - 1);
  const y = (v: number) => PAD + ((max - v) * (H - PAD * 2)) / span;
  const path = history.map((h, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(h.elo)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="지수 변동 추이">
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--line)" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" />
      <text x={2} y={PAD + 4} className="fill-[var(--fg-subtle)] text-[10px]">{max}</text>
      <text x={2} y={H - PAD + 4} className="fill-[var(--fg-subtle)] text-[10px]">{min}</text>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {history.map((h, i) => (
        <circle key={h.snapshot_date} cx={x(i)} cy={y(h.elo)} r={2.5} fill="var(--accent)">
          <title>{`${h.snapshot_date} · ${h.elo}`}</title>
        </circle>
      ))}
    </svg>
  );
}
