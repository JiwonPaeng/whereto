import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ProgramsClient, type ProgramRow, type University } from "./ProgramsClient";

export const metadata: Metadata = { title: "학과 관리 · 어디갈래" };

export default async function AdminProgramsPage() {
  const supabase = await createClient();

  // 첫 목록은 서버에서 받아 넘긴다. 마운트 후 effect 로 채우면 왕복이 한 번 더 생기고,
  // effect 본문의 setState 가 React 19 규칙(set-state-in-effect)에도 걸린다.
  const [{ data: uni }, { data: programs }] = await Promise.all([
    // 대학은 41개뿐이라 전량 넘겨 선택지로 쓴다.
    supabase.from("public_universities").select("id, name, short_name, campus").order("name"),
    supabase.rpc("admin_program_search", { p_q: null, p_limit: 200 }),
  ]);

  const universities: University[] = (uni ?? []).map((u) => ({
    id: u.id as number,
    name: u.name as string,
    short_name: u.short_name as string | null,
    campus: u.campus as string,
  }));

  return (
    <ProgramsClient
      universities={universities}
      initialRows={(programs ?? []) as ProgramRow[]}
    />
  );
}
