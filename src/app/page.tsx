import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { HomeVote, type HomeMatchup } from "./HomeVote";

/*
 * 홈은 커뮤니티 첫 화면이다. 서비스 소개가 아니라 **지금 무슨 일이 벌어지고 있는지**를
 * 먼저 보여준다. 소개는 §1.5 `/about` 이 담당하므로 여기서 되풀이하지 않는다.
 *
 * 목록 전부를 `home_feed()` 하나로 받는다. §13.3 — 서버측 Supabase 왕복은 비싸고,
 * 예전에 이 화면이 느렸던 원인이 순차 쿼리였다.
 */
export const dynamic = "force-dynamic";

type Label = {
  id: number;
  university: string;
  campus: string;
  name: string;
  faculty_group: string;
};

type Feed = {
  stats: {
    votes: number;
    reasons: number;
    voters: number;
    programs: number;
    universities: number;
  } | null;
  hot: {
    matchup_key: string;
    vote_count: number;
    reason_count: number;
    comment_count: number;
    lo: Label;
    hi: Label;
  }[];
  close: {
    matchup_key: string;
    vote_count: number;
    lo_wins: number;
    hi_wins: number;
    lo: Label;
    hi: Label;
  }[];
  neck: { lo: Label; hi: Label; faculty_group: string; elo_a: number; votes: number }[];
  programs: {
    program_id: number;
    heat: number;
    votes: number;
    label: Label;
    elo: number | null;
    confidence: string | null;
  }[];
  reasons: {
    vote_id: number;
    reason: string;
    is_named: boolean;
    nickname: string | null;
    winner: Label;
    matchup_key: string;
  }[];
};

export default async function Home() {
  const db = await createClient();

  // D-016 비로그인 세션 식별자. 로그인 상태라면 vote_submit 이 auth.uid() 를 우선하므로
  // 그대로 넘겨도 무해하다 — 대신 getUser() 왕복 하나를 아낀다.
  const anonId = (await cookies()).get("wt_anon")?.value ?? null;

  // ⚠️ 쌍은 서버가 만든다 (§8.2). 클라이언트는 이 토큰과 선택 결과만 제출한다.
  const [feedRes, matchupRes] = await Promise.all([
    db.rpc("home_feed"),
    db.rpc("matchup_next", { p_anon_id: anonId }),
  ]);

  const feed = (feedRes.data ?? {}) as Partial<Feed>;
  const s = feed.stats;
  const matchup: HomeMatchup | null = matchupRes.data?.token
    ? (matchupRes.data as HomeMatchup)
    : null;

  return (
    <main className="flex-1">
      {/* ── 즉시 투표 ─────────────────────────────────────────────
          커뮤니티에 들어온 사람이 첫 화면에서 바로 할 일이 있어야 한다. */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-narrow px-3 py-5 lg:py-8">
          {/* §1.2 서비스의 헌법. 어디서도 "어디가 더 좋은 학교인가"로 바꾸지 않는다. */}
          <h1 className="mb-3 break-keep text-center text-base font-semibold text-fg lg:text-xl">
            당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?
          </h1>

          {matchup ? (
            <>
              <HomeVote matchup={matchup} anonId={anonId} />
              <p className="mt-2 text-center text-2xs text-fg-subtle">
                한 표를 던지면 바로 다음 매치업으로 이어집니다 · 로그인 없이도 반영됩니다
              </p>
            </>
          ) : (
            <p className="rounded-md border border-line bg-surface-sunken px-3 py-8 text-center text-sm text-fg-subtle">
              지금은 출제할 매치업이 없습니다.{" "}
              <Link href="/ranking" className="text-accent hover:underline">
                배치표 보기
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* ── 현황 ─────────────────────────────────────────────── */}
      <section className="border-b border-line bg-surface-sunken/50">
        <div className="mx-auto grid max-w-app grid-cols-4 divide-x divide-line px-3">
          <Stat label="누적 투표" value={s?.votes ?? 0} />
          <Stat label="남긴 이유" value={s?.reasons ?? 0} />
          <Stat label="학과" value={s?.programs ?? 0} />
          <Stat label="대학" value={s?.universities ?? 0} />
        </div>
      </section>

      <div className="mx-auto max-w-app px-3 py-6 lg:py-8">
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          {/* 🔥 반응이 뜨거운 매치업 */}
          <Panel
            title="반응이 뜨거운 매치업"
            icon="🔥"
            href="/board/matchup"
            hrefLabel="전체 토론"
            empty="아직 이유나 댓글이 달린 매치업이 없습니다."
            emptyCta
          >
            {(feed.hot ?? []).map((m) => (
              <Row key={m.matchup_key} href={`/matchup/${m.matchup_key}`}>
                <Pair lo={m.lo} hi={m.hi} />
                <Meta>
                  <span>{m.vote_count}표</span>
                  {m.reason_count > 0 && (
                    <span className="text-accent">이유 {m.reason_count}</span>
                  )}
                  {m.comment_count > 0 && <span>댓글 {m.comment_count}</span>}
                </Meta>
              </Row>
            ))}
          </Panel>

          {/* ⚖️ 박빙 — 쌍 단위로 표가 갈린 매치업이 아직 없으면 "지수가 맞붙은 학과"로 대체한다.
              둘 다 "누가 위인지 아직 모른다"는 같은 재미를 노린다. */}
          {(feed.close ?? []).length > 0 ? (
            <Panel title="박빙 매치업" icon="⚖️" href="/board/matchup" hrefLabel="전체 토론">
              {(feed.close ?? []).map((m) => (
                <Row key={m.matchup_key} href={`/matchup/${m.matchup_key}`}>
                  <Pair lo={m.lo} hi={m.hi} />
                  <Meta>
                    <span className="font-semibold text-fg">
                      {m.lo_wins} : {m.hi_wins}
                    </span>
                    <span>{m.vote_count}표</span>
                  </Meta>
                </Row>
              ))}
            </Panel>
          ) : (
            <Panel
              title="지수가 맞붙은 학과"
              icon="⚖️"
              href="/ranking"
              hrefLabel="배치표"
              note="같은 계열 안에서 표시 지수가 가장 가까운 두 학과입니다."
              empty="아직 표가 모인 학과가 없습니다."
              emptyCta
            >
              {/* 두 학과를 나란히 세우는 자리라 한쪽만 링크로 두지 않는다.
                  행 전체를 감싸면 링크가 중첩되므로 각 학과가 자기 링크를 갖는다. */}
              {(feed.neck ?? []).map((m) => (
                <li key={`${m.lo.id}-${m.hi.id}`} className="px-3 py-2">
                  <div className="break-keep text-sm font-medium">
                    <ProgramLink label={m.lo} />
                    <span className="mx-1.5 text-2xs font-normal text-fg-subtle">↔</span>
                    <ProgramLink label={m.hi} />
                  </div>
                  <Meta>
                    <span className="font-semibold text-fg">지수 {m.elo_a}</span>
                    <span>{m.faculty_group}</span>
                    <span>표본 {m.votes}</span>
                  </Meta>
                </li>
              ))}
            </Panel>
          )}

          {/* 💬 말이 많은 학과 */}
          <Panel
            title="말이 많은 학과"
            icon="💬"
            href="/ranking"
            hrefLabel="배치표"
            note="자기가 낀 매치업에서 이유·댓글이 가장 많이 달린 학과입니다."
            empty="아직 반응이 모인 학과가 없습니다."
            emptyCta
          >
            {(feed.programs ?? []).map((p) => (
              <Row key={p.program_id} href={`/program/${p.program_id}`}>
                <div className="break-keep text-sm font-medium text-fg">
                  <span className="text-fg-muted">{uni(p.label)}</span> {p.label.name}
                </div>
                <Meta>
                  <span className="text-accent">반응 {p.heat}</span>
                  <span>{p.votes}표</span>
                  {p.elo !== null && (
                    <span
                      className={p.confidence === "잠정" ? "text-badge-provisional" : "text-fg"}
                    >
                      지수 {p.elo}
                      {p.confidence === "잠정" && " (잠정)"}
                    </span>
                  )}
                </Meta>
              </Row>
            ))}
          </Panel>

          {/* 최근 선택 이유 */}
          <Panel
            title="최근 선택 이유"
            icon="✍️"
            href="/board/matchup"
            hrefLabel="전체 토론"
            empty="아직 남겨진 이유가 없습니다."
            emptyCta
          >
            {(feed.reasons ?? []).map((r) => (
              <Row key={r.vote_id} href={`/matchup/${r.matchup_key}`}>
                <div className="break-keep text-sm leading-relaxed text-fg">
                  <span className="mr-1.5 whitespace-nowrap rounded-sm bg-vote-selected-bg px-1.5 py-0.5 text-2xs font-semibold text-brand">
                    {uni(r.winner)} {r.winner.name}
                  </span>
                  {r.reason}
                </div>
                <Meta>
                  {/* §4.1.2 익명이면 닉네임이 애초에 내려오지 않는다 */}
                  <span>{r.is_named ? r.nickname : <span className="italic">익명</span>}</span>
                </Meta>
              </Row>
            ))}
          </Panel>
        </div>

        {/* 소개는 여기서 되풀이하지 않고 §1.5 · §8.6 으로 보낸다 */}
        <div className="mt-8 rounded-md border border-line bg-surface px-3 py-3">
          <p className="break-keep text-sm leading-relaxed text-fg-muted">
            <strong className="text-fg">처음 오셨나요?</strong> 입결·취업률은 이미 숫자로 나와
            있지만, 수험생이 실제로 어디를 더 가고 싶어 하는지는 어디에도 수치화되어 있지
            않습니다. 두 학과를 놓고 고르는 투표를 모아 그 선호를 하나의 숫자로 만듭니다.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs">
            <Link href="/about" className="text-accent hover:underline">
              만든 이유 →
            </Link>
            <Link href="/method" className="text-accent hover:underline">
              지수 산출 방식 →
            </Link>
            <Link href="/ranking" className="text-accent hover:underline">
              선호도 배치표 →
            </Link>
          </p>
        </div>

        {/* §12.1 고지 */}
        <p className="mt-6 border-t border-line pt-4 text-2xs leading-relaxed text-fg-subtle">
          본 지표는 수험생들의 <strong>선호도 투표 결과</strong>이며, 대학의 교육 품질·학문적
          수준·연구 역량에 대한 평가가 아닙니다. 입시 결과를 예측하거나 대체하지 않습니다.
        </p>
      </div>
    </main>
  );
}

/** 지방 캠퍼스는 이름만으로 구분되지 않으므로 붙여 준다 (§16 #9 미결정) */
function uni(l: Label) {
  return l.campus && l.campus !== "본교" ? `${l.university}(${l.campus})` : l.university;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-3 text-center">
      <div className="text-lg font-bold tabular text-brand lg:text-2xl">
        {value.toLocaleString("ko-KR")}
      </div>
      <div className="text-2xs text-fg-subtle">{label}</div>
    </div>
  );
}

function Panel({
  title,
  icon,
  href,
  hrefLabel,
  note,
  empty,
  emptyCta,
  children,
}: {
  title: string;
  icon: string;
  href: string;
  hrefLabel: string;
  note?: string;
  empty?: string;
  emptyCta?: boolean;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) && items.length === 0;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-line-strong pb-1.5">
        <h2 className="text-base font-bold text-fg">
          <span className="mr-1">{icon}</span>
          {title}
        </h2>
        <Link href={href} className="whitespace-nowrap text-2xs text-accent hover:underline">
          {hrefLabel} →
        </Link>
      </div>
      {note && <p className="mb-1.5 text-2xs text-fg-subtle">{note}</p>}

      {isEmpty ? (
        <p className="rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-fg-subtle">
          {empty}
          {emptyCta && (
            <>
              <br />
              <Link href="/vote" className="text-accent hover:underline">
                투표하고 첫 기록을 남겨보세요 →
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">{items}</ul>
      )}
    </section>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="block px-3 py-2 transition-colors hover:bg-surface-sunken">
        {children}
      </Link>
    </li>
  );
}

function ProgramLink({ label }: { label: Label }) {
  return (
    <Link href={`/program/${label.id}`} className="hover:underline">
      <span className="text-fg-muted">{uni(label)}</span>{" "}
      <span className="text-fg">{label.name}</span>
    </Link>
  );
}

function Pair({ lo, hi }: { lo: Label; hi: Label }) {
  return (
    <div className="break-keep text-sm font-medium text-fg">
      <span className="text-fg-muted">{uni(lo)}</span> {lo.name}
      <span className="mx-1.5 text-2xs font-normal text-fg-subtle">vs</span>
      <span className="text-fg-muted">{uni(hi)}</span> {hi.name}
    </div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 text-2xs tabular text-fg-subtle">{children}</div>
  );
}
