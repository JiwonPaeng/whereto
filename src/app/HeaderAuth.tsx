"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 전역 헤더의 로그인 상태 표시.
 *
 * ⚠️ 클라이언트에서 읽는다. `layout.tsx` 에서 `cookies()` 를 건드리면 모든 페이지가
 * 동적 렌더링이 되어 §13.3 의 ISR(배치표 60 / 상세 300)이 통째로 무력화되기 때문이다.
 *
 * 상태 갱신은 `onAuthStateChange` 콜백 안에서만 한다 — effect 본문에서 setState 하면
 * React 19 규칙(react-hooks/set-state-in-effect)에 걸린다.
 */
export function HeaderAuth() {
  const [nickname, setNickname] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    // 구독 시점에 INITIAL_SESSION 이 한 번 발화하므로 초기 상태도 여기서 받는다.
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!alive) return;
      const user = session?.user;
      if (!user) {
        setSignedIn(false);
        setNickname(null);
        return;
      }
      setSignedIn(true);
      const { data: profile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .maybeSingle();
      if (alive) setNickname(profile?.nickname ?? null);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // 판정 전에는 비워 둔다 — 로그인 상태에서 "로그인" 이 깜빡이는 것을 막는다.
  if (signedIn === null) {
    return <span className="ml-auto h-7 w-16" aria-hidden />;
  }

  if (!signedIn) {
    return (
      <Link
        href="/login"
        className="ml-auto whitespace-nowrap rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
      >
        로그인
      </Link>
    );
  }

  return (
    <Link
      href="/profile"
      className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-sunken"
    >
      <span className="truncate font-semibold text-fg">{nickname ?? "내 정보"}</span>
      {nickname === null && (
        <span className="whitespace-nowrap text-2xs text-warn-600">가입 정보 필요</span>
      )}
    </Link>
  );
}
