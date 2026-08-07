import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";

// 로그인 상태에 따라 갈리므로 캐시하지 않는다.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 이미 온보딩을 마쳤으면 다시 받지 않는다.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) redirect("/");

  // 카카오가 넘겨주는 닉네임을 기본값으로 채운다. 생년월일은 비즈 앱 전환 전까지
  // 받아올 수 없어 직접 입력받는다 (D-004).
  const kakaoNickname =
    (user.user_metadata?.name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined) ??
    "";

  return (
    <main className="mx-auto w-full max-w-narrow px-4 py-12">
      <h1 className="text-2xl font-bold text-brand">가입 정보 입력</h1>
      <p className="mt-1 text-sm text-fg-muted">
        투표 결과를 지수에 반영하려면 아래 정보가 필요합니다.
      </p>

      <OnboardingForm defaultNickname={kakaoNickname.slice(0, 12)} />
    </main>
  );
}
