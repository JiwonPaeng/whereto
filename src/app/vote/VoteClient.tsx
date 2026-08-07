"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type ProgramCard = {
  id: number;
  display_name: string;
  faculty_group: string;
  university: string;
  short_name: string | null;
  campus: string;
  region_group: string;
  logo_url: string | null;
};

export type Matchup = { token: string; expires_at: string; a: ProgramCard; b: ProgramCard };

type VoteResult = {
  vote_id: number;
  winner_id: number;
  program_a_id: number;
  program_b_id: number;
  a_wins: number;
  b_wins: number;
  counted: boolean;
  is_majority: boolean | null;
};

type Phase = "loading" | "voting" | "submitting" | "result" | "exhausted";

export function VoteClient({
  isLoggedIn,
  initialMatchup,
  anonId,
}: {
  isLoggedIn: boolean;
  /** 첫 매치업은 서버에서 받아 넘긴다 — 마운트 시 클라이언트 왕복을 없앤다. */
  initialMatchup: Matchup | null;
  /** D-016 비로그인 세션 식별자. 로그인 상태면 null. */
  anonId: string | null;
}) {
  const supabase = useRef(createClient()).current;

  const [phase, setPhase] = useState<Phase>(initialMatchup ? "voting" : "exhausted");
  const [matchup, setMatchup] = useState<Matchup | null>(initialMatchup);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // §8.4 응답 시간 필터의 입력값. 렌더 중에는 Date.now() 를 부를 수 없어 마운트 후에 잡는다.
  const shownAt = useRef<number>(0);

  const [reason, setReason] = useState("");
  const [reasonPublic, setReasonPublic] = useState(true);
  const [reasonSaved, setReasonSaved] = useState(false);
  const [reasonBusy, setReasonBusy] = useState(false);

  // D-013 매치업 품질 신호. 투표 결과가 아니라 "이 비교가 답할 만했는가"를 묻는다.
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);

  const loadMatchup = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setResult(null);
    setReason("");
    setReasonSaved(false);
    setReasonPublic(true);
    setFeedback(null);

    const { data, error } = await supabase.rpc("matchup_next", { p_anon_id: anonId });
    if (error) {
      setError(error.message);
      setPhase("voting");
      return;
    }
    if (data?.exhausted) {
      setPhase("exhausted");
      return;
    }
    if (!data?.token) {
      setError("매치업을 불러오지 못했습니다.");
      setPhase("voting");
      return;
    }
    setMatchup(data as Matchup);
    shownAt.current = Date.now();
    setPhase("voting");
  }, [supabase, anonId]);

  // 서버에서 받은 첫 매치업의 노출 시점 기록. ref 변경이라 상태 갱신이 아니다.
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  const pick = useCallback(
    async (winnerId: number) => {
      if (!matchup || phase !== "voting") return;
      setPhase("submitting");
      setError(null);

      const { data, error } = await supabase.rpc("vote_submit", {
        p_token: matchup.token,
        p_winner_id: winnerId,
        p_response_ms: shownAt.current
          ? Math.min(Date.now() - shownAt.current, 2_147_483_647)
          : null,
        p_anon_id: anonId,
      });

      if (error) {
        setError(error.message);
        // 매치업이 상해서 실패한 경우(만료·중복·다른 창) 화면이 막다른 길이 되면 안 된다.
        // 메시지를 보여준 뒤 새 매치업을 자동으로 불러온다.
        const stale =
          error.message.includes("불러올게요") ||
          error.message.includes("이미 선택을 마친") ||
          error.message.includes("이미 투표한 조합");
        if (stale) {
          setTimeout(() => void loadMatchup(), 1200);
          return;
        }
        setPhase("voting");
        return;
      }
      setResult(data as VoteResult);
      setPhase("result");
    },
    [matchup, phase, supabase, loadMatchup, anonId],
  );

  const skip = useCallback(async () => {
    if (!matchup || phase !== "voting") return;
    setPhase("submitting");
    await supabase.rpc("matchup_skip", { p_token: matchup.token });
    void loadMatchup();
  }, [matchup, phase, supabase, loadMatchup]);

  const sendFeedback = useCallback(
    async (kind: "good" | "bad") => {
      if (!matchup) return;
      const next = feedback === kind ? null : kind;
      setFeedback(next);
      if (next === null) return; // 취소는 로컬에서만 — 기록은 남긴다
      await supabase.rpc("matchup_feedback_submit", {
        p_token: matchup.token,
        p_kind: next,
      });
    },
    [matchup, feedback, supabase],
  );

  const saveReason = useCallback(async () => {
    if (!result || !reason.trim()) return;
    setReasonBusy(true);
    const { error } = await supabase.rpc("vote_add_reason", {
      p_vote_id: result.vote_id,
      p_reason: reason,
      p_public: reasonPublic,
    });
    setReasonBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setReasonSaved(true);
  }, [result, reason, reasonPublic, supabase]);

  // 데스크톱 키보드 단축키 (§14.2)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (phase === "voting" && matchup) {
        if (e.key === "ArrowLeft") void pick(matchup.a.id);
        if (e.key === "ArrowRight") void pick(matchup.b.id);
        if (e.key.toLowerCase() === "s") void skip();
      }
      if (phase === "result" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        void loadMatchup();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, matchup, pick, skip, loadMatchup]);

  if (phase === "exhausted") {
    return (
      <div className="mx-auto max-w-narrow px-4 py-20 text-center">
        <p className="text-lg font-semibold">출제할 매치업을 모두 소진했습니다.</p>
        <p className="mt-2 text-sm text-fg-muted">
          같은 쌍은 다시 나오지 않습니다 (§5.6). 대학이 추가되면 새 매치업이 생깁니다.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
          홈으로
        </Link>
      </div>
    );
  }

  const total = result ? result.a_wins + result.b_wins : 0;
  const aPct = total ? Math.round((result!.a_wins / total) * 100) : 0;
  const bPct = total ? 100 - aPct : 0;

  return (
    <div className="mx-auto flex w-full max-w-app flex-1 flex-col px-3 py-4 lg:py-8">
      {error && (
        <p className="mb-3 rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      {/* D-016 비로그인 투표도 반영된다. 다만 가중치가 낮고 일일 한도가 있다. */}
      {!isLoggedIn && (
        <p className="mb-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-2xs text-fg-muted">
          로그인하지 않아도 투표가 반영됩니다.{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            로그인
          </Link>
          하면 반영 비중이 커지고 이유를 남길 수 있습니다.
        </p>
      )}

      {/* D-013 매치업 품질 평가. 우상단에 작게 — 투표 자체를 방해하지 않아야 한다. */}
      {isLoggedIn && matchup && (
        <div className="mb-1.5 flex items-center justify-end gap-1">
          <span className="mr-1 text-2xs text-fg-subtle">이 비교, 어땠나요?</span>
          {(
            [
              ["good", "👍", "답할 만한 비교였다"],
              ["bad", "👎", "비교하기 어려웠다"],
            ] as const
          ).map(([kind, icon, label]) => (
            <button
              key={kind}
              onClick={() => sendFeedback(kind)}
              title={label}
              aria-label={label}
              aria-pressed={feedback === kind}
              className={[
                "rounded-sm border px-1.5 py-0.5 text-xs transition-colors",
                feedback === kind
                  ? "border-accent bg-vote-selected-bg"
                  : "border-line bg-surface opacity-60 hover:opacity-100",
              ].join(" ")}
            >
              {icon}
            </button>
          ))}
        </div>
      )}

      {/* 카드 — 모바일에서도 좌우 분할 (D-010).
          ⚠️ 두 카드는 반드시 같은 토큰을 쓴다. 색으로 구분하지 않는다 (§14.4). */}
      <div className="grid flex-1 grid-cols-2 gap-2 lg:gap-4">
        {(["a", "b"] as const).map((side) => {
          const p = matchup?.[side];
          const chosen = result ? result.winner_id === p?.id : false;
          const pct = side === "a" ? aPct : bPct;

          return (
            <button
              key={side}
              onClick={() => p && pick(p.id)}
              disabled={phase !== "voting"}
              className={[
                "relative flex min-h-[46vh] flex-col items-center justify-center rounded-lg border p-3 text-center transition-colors lg:min-h-[52vh] lg:p-8",
                phase === "result" && chosen
                  ? "border-vote-selected bg-vote-selected-bg"
                  : "border-vote-card-line bg-vote-card",
                phase === "voting" ? "cursor-pointer hover:bg-vote-card-hover" : "cursor-default",
                phase === "result" && !chosen ? "opacity-60" : "",
              ].join(" ")}
            >
              {!matchup ? (
                <span className="text-sm text-fg-subtle">불러오는 중…</span>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap justify-center gap-1">
                    <Badge>{p!.faculty_group}</Badge>
                    <Badge>{p!.region_group}</Badge>
                  </div>

                  <div className="break-keep text-xl font-bold leading-tight text-fg lg:text-3xl">
                    {p!.short_name ?? p!.university}
                  </div>
                  <div className="mt-1 break-keep text-sm text-fg-muted lg:text-xl">
                    {p!.display_name}
                  </div>

                  {phase === "result" && (
                    <div className="mt-5 w-full">
                      <div className="text-2xl font-bold tabular lg:text-4xl">
                        {pct}%
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className={chosen ? "h-full bg-vote-selected" : "h-full bg-gray-400"}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* §1.2 서비스의 헌법. 이 문구는 어디서도 바꾸지 않는다. */}
      <p className="mt-4 text-center text-sm font-medium text-fg lg:text-lg">
        당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?
      </p>

      {phase === "voting" && (
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            onClick={skip}
            className="text-xs text-fg-subtle underline-offset-2 hover:underline"
          >
            잘 모르겠음 / 건너뛰기
          </button>
          <span className="hidden text-2xs text-fg-subtle lg:inline">
            ← → 로 선택 · S 로 건너뛰기
          </span>
        </div>
      )}

      {phase === "result" && result && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-3 lg:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">
              {result.is_majority === null
                ? "아직 표가 갈리지 않았습니다"
                : result.is_majority
                  ? "다수 의견과 같습니다"
                  : "소수 의견입니다"}
              <span className="ml-2 text-2xs text-fg-subtle">이 쌍의 누적 {total}표</span>
              {!result.counted && (
                <span className="ml-2 text-2xs text-warn-600">지수 미반영</span>
              )}
            </p>
            <div className="flex items-center gap-3">
              {/* §10.3 이 매치업의 토론 스레드로. 공개된 이유들이 모여 있다. */}
              <Link
                href={`/matchup/p${Math.min(result.program_a_id, result.program_b_id)}-${Math.max(
                  result.program_a_id,
                  result.program_b_id,
                )}`}
                className="text-xs text-accent hover:underline"
              >
                이 매치업 토론 보기
              </Link>
              <button
                onClick={loadMatchup}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
              >
                다음 매치업
              </button>
            </div>
          </div>

          {/* §4.1.1 작성을 강제하지 않는다. 강제하면 표본이 급감한다. */}
          {isLoggedIn && !reasonSaved && (
            <div className="mt-3 border-t border-line pt-3">
              <label className="text-2xs text-fg-subtle">
                선택한 이유 (선택 사항, 200자)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 200))}
                rows={2}
                placeholder="왜 그쪽을 골랐는지 한 줄로 남겨보세요"
                className="mt-1 w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                {/* D-014 — 이유는 어느 쪽이든 공개된다. 체크박스는 '닉네임을 붙일지'만 정한다.
                    이 문구가 곧 이용자의 동의 내용이므로 애매하게 쓰면 안 된다. */}
                <label className="flex items-start gap-1.5 text-2xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={reasonPublic}
                    onChange={(e) => setReasonPublic(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    닉네임 공개
                    <span className="block text-fg-subtle">
                      해제하면 익명으로 표시됩니다. 이유 자체는 어느 쪽이든 공개됩니다.
                    </span>
                  </span>
                </label>
                <button
                  onClick={saveReason}
                  disabled={!reason.trim() || reasonBusy}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  {reasonBusy ? "저장 중…" : "이유 남기기"}
                </button>
              </div>
            </div>
          )}

          {reasonSaved && (
            <p className="mt-3 border-t border-line pt-3 text-2xs text-success-500">
              이유를 저장했습니다{reasonPublic ? " · 닉네임과 함께 표시됩니다" : " · 익명으로 표시됩니다"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-subtle">
      {children}
    </span>
  );
}
