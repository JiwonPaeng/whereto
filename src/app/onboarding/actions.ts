"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STATUS = ["고1", "고2", "고3", "N수", "대학생", "기타"] as const;
const TRACK = ["인문사회", "자연공학", "의약", "사범", "예체능"] as const;

export type OnboardingState = { error: string | null };

/**
 * 프로필 생성 (§6.1).
 *
 * 여기서 vote_weight / trust_coeff 를 다루지 않는다 — 유저에게 UPDATE 권한 자체가 없고,
 * vote_weight 는 DB 트리거가 계산한다. 현재는 D-004 에 따라 전원 1.0 이다.
 * 만 14세 미만 차단도 트리거가 강제하므로 여기서는 사용자에게 보여줄 메시지만 처리한다.
 */
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const nickname = String(formData.get("nickname") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "");
  const status = String(formData.get("status") ?? "");
  const track = String(formData.get("track") ?? "");

  if (nickname.length < 2 || nickname.length > 12) {
    return { error: "닉네임은 2~12자로 입력해 주세요." };
  }
  if (!birthDate) {
    return { error: "생년월일을 입력해 주세요." };
  }
  if (!STATUS.includes(status as (typeof STATUS)[number])) {
    return { error: "신분을 선택해 주세요." };
  }
  if (!TRACK.includes(track as (typeof TRACK)[number])) {
    return { error: "계열을 선택해 주세요." };
  }

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    nickname,
    birth_date: birthDate,
    status,
    track,
  });

  if (error) {
    // 23505 unique_violation — 닉네임 중복
    if (error.code === "23505") {
      return { error: "이미 사용 중인 닉네임입니다." };
    }
    // 23514 check_violation — profiles_sync_age 트리거의 만 14세 미만 차단
    if (error.code === "23514" || error.message.includes("만 14세")) {
      return { error: "만 14세 미만은 가입할 수 없습니다." };
    }
    return { error: `프로필 생성에 실패했습니다: ${error.message}` };
  }

  redirect("/");
}
