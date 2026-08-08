import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "관리 · 어디갈래" };

/**
 * §8.5 모니터링 대시보드.
 *
 * ⚠️ 여기에 "누가 어느 쪽을 골랐는지"를 띄우지 말 것. §4.1.2 가 지키려는 것이 정확히 그
 * 연결이고, 어뷰징 판단은 집계와 신호만으로 한다. `admin_stats()` 도 개별 투표를
 * 반환하지 않는다 — 화면을 늘릴 때 RPC 쪽부터 확인할 것.
 */
type Stats = {
  overview: {
    votes: number;
    votes_today: number;
    votes_24h: number;
    anon_votes: number;
    reasons: number;
    invalidated: number;
    skips: number;
    voters: number;
    anon_sessions: number;
  };
  programs: {
    total: number;
    inactive: number;
    universities: number;
    provisional: number;
    ranked: number;
  };
  /** 빈 시간까지 채워진 48행. 채우기는 DB 가 한다 — 렌더 중 new Date() 는 금지다. */
  hourly: { label: string; votes: number }[];
  quality: {
    faculty_combo: string;
    votes: number;
    skips: number;
    good: number;
    bad: number;
    skip_rate: number | null;
  }[];
  universities: { name: string; elo: number; n: number }[];
  bias: { scored: number; trust_reduced: number; banned: number };
};

export default async function AdminPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats");

  if (error) {
    return (
      <p className="rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
        지표를 불러오지 못했습니다: {error.message}
      </p>
    );
  }

  const s = data as Stats;
  const o = s.overview;
  const p = s.programs;
  const anonShare = o.votes > 0 ? Math.round((o.anon_votes / o.votes) * 100) : 0;
  const reasonShare = o.votes > 0 ? Math.round((o.reasons / o.votes) * 100) : 0;

  return (
    <div className="space-y-8">
      <section>
        <H>투표</H>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="누적 투표" value={o.votes} />
          <Stat label="오늘" value={o.votes_today} hint="KST 자정 기준" />
          <Stat label="최근 24시간" value={o.votes_24h} />
          <Stat label="스킵" value={o.skips} hint="§5.4.1 품질 신호" />
          <Stat label="투표자" value={o.voters} hint="로그인 계정" />
          <Stat label="비로그인 세션" value={o.anon_sessions} hint="가중치 0.3 (D-016)" />
          <Stat label="비로그인 비중" value={`${anonShare}%`} hint={`${o.anon_votes}표`} />
          <Stat label="이유 작성률" value={`${reasonShare}%`} hint={`${o.reasons}건`} />
        </div>
      </section>

      <section>
        <H>표본</H>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="대학" value={p.universities} />
          <Stat label="학과" value={p.total} hint={`비활성 ${p.inactive}`} />
          <Stat label="순위 부여" value={p.ranked} hint="확정 이상" />
          <Stat
            label="잠정"
            value={p.provisional}
            hint={
              p.total > 0 ? `전체의 ${Math.round((p.provisional / p.total) * 100)}%` : undefined
            }
          />
        </div>
      </section>

      {/* §8.4 시간당 투표량 이상치. 스파이크가 곧 어뷰징 신호다. */}
      <section>
        <H>시간당 투표량 · 최근 48시간</H>
        <HourlyBars data={s.hourly} />
      </section>

      {/* §5.4.1 · D-013 계열 조합별 품질 — 스킵률이 매칭 확률로 되먹임된다 */}
      <section>
        <H>계열 조합별 품질</H>
        {s.quality.length === 0 ? (
          <Empty>아직 집계할 매치업이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface-sunken text-2xs text-fg-subtle">
                <tr>
                  <Th className="text-left">조합</Th>
                  <Th>투표</Th>
                  <Th>스킵</Th>
                  <Th>스킵률</Th>
                  <Th>👍</Th>
                  <Th>👎</Th>
                </tr>
              </thead>
              <tbody>
                {s.quality.map((q) => (
                  <tr key={q.faculty_combo} className="border-t border-line">
                    <Td className="text-left font-medium">{q.faculty_combo}</Td>
                    <Td>{q.votes}</Td>
                    <Td>{q.skips}</Td>
                    <Td
                      className={
                        (q.skip_rate ?? 0) > 0.3 ? "font-semibold text-warn-600" : undefined
                      }
                    >
                      {q.skip_rate === null ? "—" : `${Math.round(Number(q.skip_rate) * 100)}%`}
                    </Td>
                    <Td>{q.good}</Td>
                    <Td className={q.bad > q.good ? "font-semibold text-warn-600" : undefined}>
                      {q.bad}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <H>대학 지수</H>
        <p className="mb-2 text-2xs text-fg-subtle">
          급변은 조직적 투표의 첫 징후다. §5.4 shrinkage 의 기준값이기도 하다.
        </p>
        {s.universities.length === 0 ? (
          <Empty>아직 표가 없습니다.</Empty>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {s.universities.map((u) => (
              <span
                key={u.name}
                className="rounded-sm border border-line bg-surface px-2 py-1 text-2xs"
              >
                {u.name}{" "}
                <strong className="tabular text-fg">{Math.round(Number(u.elo))}</strong>{" "}
                <span className="text-fg-subtle">({u.n})</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <H>어뷰징</H>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="무효 처리된 표" value={o.invalidated} hint="is_valid = false" />
          <Stat label="편향 스코어 산출" value={s.bias.scored} hint="§8.3 배치 미구현" />
          <Stat label="신뢰도 감쇄 계정" value={s.bias.trust_reduced} />
          <Stat label="차단 계정" value={s.bias.banned} />
        </div>
        <p className="mt-2 rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
          §8.3 편향 스코어 배치와 신뢰도 감쇄는 아직 구현 전이라 대부분 0 입니다. 이 화면은
          집계와 신호만 다루며, <strong>누가 어느 쪽을 골랐는지는 표시하지 않습니다</strong>{" "}
          (§4.1.2).
        </p>
      </section>

      <p className="border-t border-line pt-4 text-2xs text-fg-subtle">
        <Link href="/admin/programs" className="text-accent hover:underline">
          학과 관리로 이동
        </Link>
      </p>
    </div>
  );
}

/** 최근 48시간 투표량. 값이 작아 차트 라이브러리를 붙일 이유가 없다. */
function HourlyBars({ data }: { data: { label: string; votes: number }[] }) {
  if (data.length === 0) return <Empty>집계할 구간이 없습니다.</Empty>;

  const max = Math.max(1, ...data.map((d) => d.votes));

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex h-24 items-end gap-px">
        {data.map((d) => (
          <div
            key={d.label}
            title={`${d.label} · ${d.votes}표`}
            className="flex-1 rounded-t-sm bg-brand"
            style={{ height: `${Math.max(d.votes > 0 ? 4 : 1, (d.votes / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-fg-subtle">
        <span>{data[0]?.label}</span>
        <span>최고 {max}표/시</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-fg">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-surface px-3 py-4 text-center text-2xs text-fg-subtle">
      {children}
    </p>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-1.5 text-right font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-right tabular ${className}`}>{children}</td>;
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
