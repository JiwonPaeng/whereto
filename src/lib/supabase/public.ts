import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * 인증 없는 읽기 전용 클라이언트.
 *
 * server.ts 의 클라이언트는 cookies() 를 읽어 라우트를 동적으로 만든다.
 * 랭킹·Program 상세는 §13.3 대로 ISR 이어야 하므로 쿠키를 건드리지 않는 클라이언트를 쓴다.
 * 공개 데이터만 조회한다 — 방어선은 RLS 다.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
