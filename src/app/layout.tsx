import type { Metadata } from "next";
import "./globals.css";

// 폰트는 globals.css 에서 Pretendard 를 불러온다 (§13.1).
// next/font/google 를 쓰지 않는 이유: Pretendard 는 Google Fonts 에 없고,
// 한글 폰트는 용량이 커서 동적 서브셋 배포판을 쓰는 편이 훨씬 가볍다.

export const metadata: Metadata = {
  title: "어디갈래",
  description:
    "당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까? 수험생이 직접 만드는 대학·학과 선호도 지수.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
