import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 비로그인 투표의 세션 식별자 쿠키 (D-016) */
export const ANON_COOKIE = "wt_anon";

/**
 * 세션 갱신.
 *
 * ⚠️ Next 16 에서 `middleware.ts` 규약은 deprecated 이고 `proxy.ts` 가 대체한다.
 * 두 파일이 동시에 존재하면 빌드가 실패한다. (node_modules/next/dist/build/index.js 에서 확인)
 *
 * 여기서는 세션 토큰 갱신만 한다. 온보딩 완료 여부 같은 DB 조회는 넣지 않는다 —
 * 모든 요청마다 쿼리가 붙어 §13.3 읽기 부하 방어 전제와 충돌한다.
 * 온보딩 가드는 각 페이지에서 처리한다.
 */
export default async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  /*
   * 로그인하지 않은 방문자에게는 세션 갱신이 필요 없다.
   * getUser() 는 Supabase 로 네트워크 왕복을 하므로, 인증 쿠키가 아예 없으면
   * 그 왕복을 건너뛴다. 이 검사가 없으면 정적 페이지(§13.3 ISR)까지
   * 매 요청 왕복 비용을 물게 된다 — 실제로 prerender 된 /ranking 이 0.7초 걸렸다.
   */
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasAuthCookie) {
    /*
     * D-016 비로그인 투표도 지수에 반영된다. profile_id 가 없으므로 중복과 남용을
     * 막을 기준이 필요해 세션 식별자를 심는다.
     * 쿠키는 지우면 그만이라 권위 있는 방어가 아니다 — 문턱을 높이는 장치다.
     */
    if (!request.cookies.get(ANON_COOKIE)) {
      supabaseResponse.cookies.set(ANON_COOKIE, crypto.randomUUID(), {
        httpOnly: false, // 서버 컴포넌트와 클라이언트 양쪽에서 읽는다
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() 를 호출해야 만료된 토큰이 갱신된다. getSession() 은 서버에서 신뢰할 수 없다.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 정적 자산과 이미지 최적화 요청은 제외한다.
     * 랭킹 등 ISR 페이지에까지 붙으면 캐시 이점이 사라진다 (§13.3).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
