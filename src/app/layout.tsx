import type { Metadata } from "next";
import Link from "next/link";
import { HeaderAuth } from "./HeaderAuth";
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
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}

/**
 * 전역 네비게이션.
 *
 * ⚠️ 서버에서 로그인 상태를 읽지 않는다. layout 에서 cookies() 를 건드리면 모든 페이지가
 * 동적 렌더링으로 바뀌어 §13.3 의 ISR 이 통째로 무력화된다.
 * 로그인 표시는 클라이언트 컴포넌트(HeaderAuth)가 담당한다.
 */
function SiteHeader() {
  const nav = [
    { href: "/vote", label: "투표" },
    { href: "/ranking", label: "배치표" },
    { href: "/board/matchup", label: "매치업 토론" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-app items-center gap-1 px-3 py-2">
        <Link href="/" className="mr-2 whitespace-nowrap text-base font-bold text-brand">
          어디갈래
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <HeaderAuth />
      </div>
    </header>
  );
}

/**
 * §12.2 이용약관·개인정보처리방침은 상시 접근 가능해야 한다 (카카오 로그인 심사 요건이기도 하다).
 * §1.5 "만든 이유" · §8.6 "산출 방식" 공개 페이지도 여기에 붙는다 — 둘 다 M3.
 */
function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line px-4 py-5 text-2xs text-fg-subtle">
      <div className="mx-auto flex max-w-app flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-semibold text-fg-muted">어디갈래</span>
        <Link href="/terms" className="hover:underline">이용약관</Link>
        <Link href="/privacy" className="hover:underline">개인정보처리방침</Link>
        <span className="ml-auto">
          선호도 투표 결과이며 대학의 교육 품질에 대한 평가가 아닙니다.
        </span>
      </div>
    </footer>
  );
}
