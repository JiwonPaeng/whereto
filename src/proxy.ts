import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
