import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 서버용 Supabase 클라이언트 (Server Component / Route Handler / Server Action).
 * Next 16 에서 cookies() 는 비동기다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component 에서 호출되면 쿠키를 쓸 수 없다.
            // proxy.ts 가 세션을 갱신하므로 무시해도 된다.
          }
        },
      },
    },
  );
}
