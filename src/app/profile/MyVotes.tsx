"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type MyVote = {
  id: number;
  winner_label: string;
  loser_label: string;
  winner_id: number;
  reason: string | null;
  reason_public: boolean;
  counted: boolean;
  created_at: string;
};

/**
 * §6.2 비공개 영역 — 전체 투표 기록.
 * 투표 자체는 타 유저에게 노출되지 않는다 (§4.1.2). 여기는 본인만 본다.
 */
export function MyVotes({ votes }: { votes: MyVote[] }) {
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<Record<number, boolean>>(
    Object.fromEntries(votes.map((v) => [v.id, v.reason_public])),
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(voteId: number) {
    const next = !state[voteId];
    setBusy(voteId);
    setError(null);
    const { error } = await supabase.rpc("vote_set_reason_public", {
      p_vote_id: voteId,
      p_public: next,
    });
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setState((s) => ({ ...s, [voteId]: next }));
  }

  if (votes.length === 0) {
    return (
      <p className="rounded-md border border-line bg-surface px-3 py-8 text-center text-sm text-fg-subtle">
        아직 투표 기록이 없습니다.{" "}
        <Link href="/vote" className="text-accent hover:underline">
          투표하러 가기
        </Link>
      </p>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-2xs text-danger-600">{error}</p>}
      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {votes.map((v) => (
          <li key={v.id} className="px-3 py-2.5">
            <div className="break-keep text-sm">
              <span className="font-semibold text-fg">{v.winner_label}</span>
              <span className="mx-1.5 text-2xs text-fg-subtle">선택</span>
              <span className="text-fg-muted">vs {v.loser_label}</span>
            </div>

            {v.reason ? (
              <div className="mt-1.5 rounded-md bg-surface-sunken px-2 py-1.5">
                <p className="text-sm text-fg">{v.reason}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-2xs text-fg-subtle">
                    {state[v.id] ? "닉네임과 함께 표시 중" : "익명으로 표시 중"}
                  </span>
                  {/* §6.2 이유 공개 여부 사후 변경 */}
                  <button
                    onClick={() => toggle(v.id)}
                    disabled={busy === v.id}
                    className="rounded-sm border border-line-strong px-2 py-0.5 text-2xs hover:bg-surface disabled:opacity-40"
                  >
                    {busy === v.id
                      ? "변경 중…"
                      : state[v.id]
                        ? "익명으로 바꾸기"
                        : "닉네임 공개하기"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-2xs text-fg-subtle">이유 없음</p>
            )}

            <p className="mt-1 flex gap-2 text-2xs text-fg-subtle">
              <span>{new Date(v.created_at).toLocaleDateString("ko-KR")}</span>
              {!v.counted && <span className="text-warn-600">지수 미반영</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
