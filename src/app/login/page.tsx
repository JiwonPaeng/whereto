"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginInner() {
  const params = useSearchParams();
  const error = params.get("error");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setFailure(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setFailure(error.message);
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-narrow flex-1 flex-col items-center justify-center px-4 py-16">
      <h1 className="text-3xl font-bold text-brand">어디갈래</h1>
      <p className="mt-3 text-center text-base text-fg-muted">
        당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?
      </p>

      {(error || failure) && (
        <p className="mt-6 w-full rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
          로그인에 실패했습니다: {failure ?? error}
        </p>
      )}

      <button
        onClick={signIn}
        disabled={pending}
        className="mt-8 w-full rounded-md bg-[#FEE500] px-4 py-3 text-base font-semibold text-[#191600] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "이동 중…" : "카카오로 시작하기"}
      </button>

      {/* 약관 제4조 — 동의하고 로그인한 때 이용계약이 성립한다. 그 고지가 여기 있어야 한다. */}
      <p className="mt-4 text-center text-2xs leading-relaxed text-fg-subtle">
        로그인하면{" "}
        <a href="/terms" className="text-accent hover:underline">
          이용약관
        </a>
        과{" "}
        <a href="/privacy" className="text-accent hover:underline">
          개인정보처리방침
        </a>
        에 동의하는 것으로 봅니다.
        <br />
        만 14세 미만은 가입할 수 없습니다.
        <br />
        로그인하지 않아도 순위와 게시판은 볼 수 있습니다.
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
