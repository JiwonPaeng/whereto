import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { VoteClient, type Matchup } from "./VoteClient";

// §13.3 — 투표 화면만 동적이다. 랭킹·상세는 ISR 로 간다.
export const dynamic = "force-dynamic";

export default async function VotePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인했지만 온보딩 전이면 지수에 반영되지 않는다 (profiles 행이 있어야 가중치가 잡힌다).
  let hasProfile = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    hasProfile = !!data;
  }

  if (user && !hasProfile) {
    return (
      <main className="mx-auto max-w-narrow px-4 py-20 text-center">
        <p className="text-lg font-semibold">가입 정보를 먼저 입력해 주세요</p>
        <p className="mt-2 text-sm text-fg-muted">
          투표를 지수에 반영하려면 프로필이 필요합니다.
        </p>
        <Link
          href="/onboarding"
          className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
        >
          가입 정보 입력
        </Link>
      </main>
    );
  }

  // 첫 매치업을 서버에서 발급한다. 클라이언트 마운트 후 왕복을 없애고,
  // 마운트 effect 안에서 상태를 세팅하는 패턴도 피한다.
  const { data: first } = await supabase.rpc("matchup_next");
  const initialMatchup = first?.token ? (first as Matchup) : null;

  return (
    <main className="flex flex-1 flex-col">
      <VoteClient isLoggedIn={hasProfile} initialMatchup={initialMatchup} />
    </main>
  );
}
