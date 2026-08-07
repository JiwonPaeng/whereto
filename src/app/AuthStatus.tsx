import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * 임시 인증 상태 표시. M1 에서 실제 헤더로 대체된다.
 * 로그인 플로우가 끝까지 동작했는지 눈으로 확인하는 용도.
 */
export async function AuthStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Link href="/login" className="text-sm font-medium text-accent hover:underline">
        카카오로 로그인
      </Link>
    );
  }

  // RLS 로 본인 행만 조회된다 (§4.1.2).
  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname, status, track, age_years, vote_weight")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return (
      <Link href="/onboarding" className="text-sm font-medium text-accent hover:underline">
        가입 정보 입력하기
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-fg">
        <strong className="font-semibold">{profile.nickname}</strong>
        <span className="ml-1.5 text-fg-muted">
          {profile.status} · {profile.track} · 만 {profile.age_years}세
        </span>
      </span>
      <span
        className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-subtle"
        title="D-004 — 연령 가중치 적용 보류 중이라 전원 1.0 입니다"
      >
        w_age {profile.vote_weight}
      </span>
      <form action="/auth/signout" method="post">
        <button className="text-2xs text-fg-subtle hover:underline">로그아웃</button>
      </form>
    </div>
  );
}
