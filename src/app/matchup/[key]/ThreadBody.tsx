"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Reason = {
  vote_id: number;
  nickname: string | null;
  is_named: boolean;
  winner_id: number;
  reason: string;
  reason_upvotes: number;
  created_at: string;
};

export type Comment = {
  id: number;
  parent_id: number | null;
  reason_vote_id: number | null;
  nickname: string | null;
  content: string;
  upvotes: number;
  created_at: string;
};

/**
 * 같은 대학끼리 붙는 매치업(예: 서울대 스마트시스템과학과 vs 서울대 의류학과)에서는
 * 학교명만으로 어느 쪽을 골랐는지 구분되지 않는다. 배지에 학과까지 함께 쓴다.
 */
export type SideLabel = { program_id: number; full: string };

export function ThreadBody({
  programLo,
  programHi,
  sides,
  reasons,
  comments,
  isLoggedIn,
}: {
  programLo: number;
  programHi: number;
  sides: SideLabel[];
  reasons: Reason[];
  comments: Comment[];
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [openReason, setOpenReason] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threadDraft, setThreadDraft] = useState("");

  const repliesOf = (voteId: number) => comments.filter((c) => c.reason_vote_id === voteId);
  const threadComments = comments.filter((c) => c.reason_vote_id === null);

  async function send(content: string, reasonVoteId: number | null) {
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("matchup_thread_comment", {
      p_program_lo: programLo,
      p_program_hi: programHi,
      p_content: content,
      p_parent_id: null,
      p_reason_vote_id: reasonVoteId,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDraft("");
    setThreadDraft("");
    setOpenReason(null);
    router.refresh();
  }

  const labelOf = (winnerId: number) =>
    sides.find((s) => s.program_id === winnerId)?.full ?? "";

  return (
    <>
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">
          선택 이유{" "}
          <span className="text-2xs font-normal text-fg-subtle">
            투표하며 남긴 논거가 모입니다
          </span>
        </h2>

        {reasons.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-fg-subtle">
            아직 남겨진 이유가 없습니다.
            <br />
            <a href="/vote" className="text-accent hover:underline">
              투표하며 이유를 남기면
            </a>{" "}
            여기에 모입니다.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {reasons.map((r) => {
              const replies = repliesOf(r.vote_id);
              return (
                <li key={r.vote_id} className="px-3 py-2.5">
                  <div>
                    <span className="mr-1.5 whitespace-nowrap rounded-sm bg-vote-selected-bg px-1.5 py-0.5 text-2xs font-semibold text-brand">
                      {labelOf(r.winner_id)}
                    </span>
                    <span className="text-sm leading-relaxed text-fg">{r.reason}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-2xs text-fg-subtle">
                    {/* D-014 익명 이유는 닉네임이 내려오지 않는다 (뷰에서 null) */}
                    <span className={r.is_named ? "" : "italic"}>
                      {r.is_named ? r.nickname : "익명"}
                    </span>
                    <span>추천 {r.reason_upvotes}</span>
                    {isLoggedIn && (
                      <button
                        onClick={() => {
                          setOpenReason(openReason === r.vote_id ? null : r.vote_id);
                          setDraft("");
                        }}
                        className="hover:underline"
                      >
                        답글 {replies.length > 0 && `(${replies.length})`}
                      </button>
                    )}
                    {!isLoggedIn && replies.length > 0 && <span>답글 {replies.length}</span>}
                  </p>

                  {replies.length > 0 && (
                    <ul className="mt-2 space-y-2 border-l-2 border-line pl-3">
                      {replies.map((rep) => (
                        <li key={rep.id}>
                          <p className="whitespace-pre-wrap break-words text-sm text-fg">
                            {rep.content}
                          </p>
                          <p className="mt-0.5 text-2xs text-fg-subtle">
                            {rep.nickname ?? "탈퇴한 사용자"} ·{" "}
                            {new Date(rep.created_at).toLocaleDateString("ko-KR")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {openReason === r.vote_id && (
                    <div className="mt-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                        rows={2}
                        placeholder="이 이유에 답글"
                        className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                      />
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          onClick={() => setOpenReason(null)}
                          className="text-2xs text-fg-subtle hover:underline"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => send(draft, r.vote_id)}
                          disabled={busy || !draft.trim()}
                          className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-fg-on-brand disabled:opacity-40"
                        >
                          등록
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">
          토론 <span className="text-2xs font-normal text-fg-subtle">{threadComments.length}</span>
        </h2>

        {threadComments.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-fg-subtle">
            아직 댓글이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {threadComments.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
                  {c.content}
                </p>
                <p className="mt-1 text-2xs text-fg-subtle">
                  {c.nickname ?? "탈퇴한 사용자"} ·{" "}
                  {new Date(c.created_at).toLocaleDateString("ko-KR")}
                </p>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-2 text-2xs text-danger-600">{error}</p>}

        {isLoggedIn ? (
          <div className="mt-3">
            <textarea
              value={threadDraft}
              onChange={(e) => setThreadDraft(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="이 비교 자체에 대한 의견을 남겨보세요"
              className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-1.5 flex justify-end">
              <button
                onClick={() => send(threadDraft, null)}
                disabled={busy || !threadDraft.trim()}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover disabled:opacity-40"
              >
                {busy ? "등록 중…" : "댓글 등록"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-2xs text-fg-muted">
            <a href="/login" className="font-semibold text-accent hover:underline">
              로그인
            </a>
            하면 의견을 남길 수 있습니다.
          </p>
        )}
      </section>
    </>
  );
}
