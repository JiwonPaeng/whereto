"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProgramCard } from "./vote/VoteClient";

export type HomeMatchup = { token: string; a: ProgramCard; b: ProgramCard };

/**
 * 홈 최상단의 즉시 투표.
 *
 * 한 표를 던지면 곧바로 `/vote` 로 넘어가 흐름이 이어진다. 결과 화면(누적 %, 이유 입력,
 * 스레드 미리보기)은 `/vote` 가 이미 다 갖고 있으므로 여기서 다시 만들지 않는다.
 *
 * ⚠️ 쌍과 토큰은 **서버가 발급한 것만** 쓴다 (§8.2 불변 원칙). 여기서 하는 일은
 * 토큰 + 선택 결과를 제출하는 것뿐이다.
 *
 * ⚠️ 두 카드는 같은 토큰을 쓴다. 색으로 구분하지 않는다 (§14.4).
 */
export function HomeVote({
  matchup,
  anonId,
}: {
  matchup: HomeMatchup;
  /**
   * D-016 비로그인 세션 식별자.
   *
   * ⚠️ 반드시 넘겨야 한다. 빼면 `vote_submit` 에서 `v_profile` 과 `p_anon_id` 가 모두
   * null 이 되어 `weight_applied = 0` 으로 기록된다 — 표는 남지만 지수는 움직이지 않고,
   * 중복 투표 검사도 건너뛴다. 화면상 아무 이상이 없어 조용히 틀린다.
   */
  anonId: string | null;
}) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function pick(winnerId: number) {
    if (busy !== null) return;
    setBusy(winnerId);

    // 홈이 브라우저에 오래 떠 있었으면 토큰이 만료됐을 수 있다. 그 경우에도 막지 않고
    // /vote 로 보낸다 — 거기서 새 매치업을 받으면 사용자 입장에서는 흐름이 끊기지 않는다.
    await supabase.rpc("vote_submit", {
      p_token: matchup.token,
      p_winner_id: winnerId,
      p_anon_id: anonId,
    });

    router.push("/vote");
  }

  return (
    <div className="grid grid-cols-2 gap-2 lg:gap-4">
      {(["a", "b"] as const).map((side) => {
        const p = matchup[side];
        return (
          <button
            key={side}
            onClick={() => pick(p.id)}
            disabled={busy !== null}
            className={[
              "flex min-h-[7.5rem] flex-col items-center justify-center rounded-lg border border-vote-card-line bg-vote-card p-3 text-center transition-colors lg:min-h-[9.5rem] lg:p-5",
              busy === null ? "hover:bg-vote-card-hover" : "",
              busy !== null && busy !== p.id ? "opacity-50" : "",
              busy === p.id ? "border-vote-selected bg-vote-selected-bg" : "",
            ].join(" ")}
          >
            <span className="mb-1.5 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-subtle">
              {p.faculty_group}
            </span>
            <span className="break-keep text-lg font-bold leading-tight text-fg lg:text-2xl">
              {p.short_name ?? p.university}
            </span>
            {/* §9.1 Program 의 정체성은 실제 학과명이다. 곁다리로 눌러두지 않는다. */}
            <span className="mt-1 break-keep text-sm font-semibold leading-snug text-fg lg:text-lg">
              {p.display_name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
