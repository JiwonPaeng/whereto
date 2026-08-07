"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Comment = {
  id: number;
  parent_id: number | null;
  nickname: string | null;
  content: string;
  upvotes: number;
  created_at: string;
};

export function ThreadComments({
  programLo,
  programHi,
  comments,
  isLoggedIn,
}: {
  programLo: number;
  programHi: number;
  comments: Comment[];
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §10.2 대댓글은 2 depth 까지. 트리거가 DB 에서도 강제한다.
  const roots = comments.filter((c) => c.parent_id === null);
  const childrenOf = (id: number) => comments.filter((c) => c.parent_id === id);

  async function submit() {
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("matchup_thread_comment", {
      p_program_lo: programLo,
      p_program_hi: programHi,
      p_content: content,
      p_parent_id: replyTo,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setContent("");
    setReplyTo(null);
    router.refresh();
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">
        토론 <span className="text-2xs font-normal text-fg-subtle">{comments.length}</span>
      </h2>

      {comments.length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-fg-subtle">
          아직 댓글이 없습니다. 위의 선택 이유들을 보고 첫 의견을 남겨보세요.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {roots.map((c) => (
            <li key={c.id} className="px-3 py-2">
              <CommentBody c={c} onReply={() => setReplyTo(c.id)} canReply={isLoggedIn} />
              {childrenOf(c.id).length > 0 && (
                <ul className="mt-2 space-y-2 border-l-2 border-line pl-3">
                  {childrenOf(c.id).map((r) => (
                    <li key={r.id}>
                      <CommentBody c={r} canReply={false} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {isLoggedIn ? (
        <div className="mt-3">
          {replyTo !== null && (
            <p className="mb-1 text-2xs text-fg-muted">
              답글 작성 중{" "}
              <button onClick={() => setReplyTo(null)} className="text-accent hover:underline">
                취소
              </button>
            </p>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="이 비교에 대한 의견을 남겨보세요"
            className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="mt-1 text-2xs text-danger-600">{error}</p>}
          <div className="mt-1.5 flex justify-end">
            <button
              onClick={submit}
              disabled={busy || !content.trim()}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover disabled:opacity-40"
            >
              {busy ? "등록 중…" : replyTo !== null ? "답글 등록" : "댓글 등록"}
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
    </div>
  );
}

function CommentBody({
  c,
  onReply,
  canReply,
}: {
  c: Comment;
  onReply?: () => void;
  canReply: boolean;
}) {
  return (
    <div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
        {c.content}
      </p>
      <p className="mt-1 flex items-center gap-2 text-2xs text-fg-subtle">
        <span>{c.nickname ?? "탈퇴한 사용자"}</span>
        <span>{new Date(c.created_at).toLocaleDateString("ko-KR")}</span>
        {canReply && onReply && (
          <button onClick={onReply} className="hover:underline">
            답글
          </button>
        )}
      </p>
    </div>
  );
}
