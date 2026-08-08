import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * §8.5 어드민 영역.
 *
 * 이 가드는 화면을 가릴 뿐이고 **권한의 근거가 아니다.** 실제 권한은 DB 쪽
 * `is_admin()` 을 확인하는 SECURITY DEFINER RPC 가 쥐고 있다. 여기를 우회해도
 * 데이터는 나오지 않는다.
 *
 * 403 대신 notFound() 를 쓴다 — 어드민 경로가 존재한다는 사실 자체를 알릴 이유가 없다.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!data?.is_admin) notFound();

  const nav = [
    { href: "/admin", label: "대시보드" },
    { href: "/admin/programs", label: "학과 관리" },
  ];

  return (
    <main className="mx-auto w-full max-w-app px-3 py-6 lg:py-8">
      <header className="mb-5 border-b border-line-strong pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold text-fg">관리</h1>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-2.5 py-1 text-sm text-fg-muted hover:bg-surface-sunken hover:text-fg"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
}
