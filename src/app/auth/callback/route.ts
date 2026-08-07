import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 카카오 OAuth 콜백 (§6.1).
 * 카카오 → Supabase(/auth/v1/callback) → 여기로 code 가 넘어온다.
 *
 * 프로필이 없으면 온보딩으로 보낸다. profiles 행이 있어야 투표가 지수에 반영된다.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // 카카오 쪽에서 사용자가 취소했거나 설정이 잘못된 경우
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=코드가 없습니다`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let target = next;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) target = "/onboarding";
  }

  // Vercel 등 프록시 뒤에서는 origin 이 내부 주소일 수 있다.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";

  if (!isLocal && forwardedHost) {
    return NextResponse.redirect(`https://${forwardedHost}${target}`);
  }
  return NextResponse.redirect(`${origin}${target}`);
}
