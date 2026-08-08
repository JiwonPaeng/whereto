"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type University = {
  id: number;
  name: string;
  short_name: string | null;
  campus: string;
};

export type ProgramRow = {
  id: number;
  display_name: string;
  faculty_group: string;
  is_active: boolean;
  university_id: number;
  university: string;
  elo: number | null;
  vote_count: number | null;
};

type Draft = {
  id: number | null;
  university_id: number | "";
  display_name: string;
  faculty_group: string;
  is_active: boolean;
};

const FACULTIES = ["인문", "자연", "예체능"] as const;

const EMPTY: Draft = {
  id: null,
  university_id: "",
  display_name: "",
  faculty_group: "인문",
  is_active: true,
};

/**
 * §8.5 학과 관리.
 *
 * 쓰기는 전부 `admin_program_*` RPC 를 거친다. `programs` 에는 클라이언트용 쓰기 정책이
 * 없고 앞으로도 두지 않는다 — 정책을 열면 RLS 만으로 검증을 다 짊어져야 한다.
 *
 * ⚠️ "제거"의 기본 동작은 **비활성화**다. votes 가 programs 를 on delete restrict 로
 * 참조하므로 표가 있는 학과는 지울 수 없고, 지우면 지수 이력이 끊긴다. 표가 0인 경우에만
 * 실제 삭제를 제안한다 (입력 실수 정정용).
 */
export function ProgramsClient({
  universities,
  initialRows,
}: {
  universities: University[];
  initialRows: ProgramRow[];
}) {
  const supabase = useRef(createClient()).current;

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ProgramRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const uniLabel = useCallback(
    (u: University) =>
      `${u.short_name ?? u.name}${u.campus && u.campus !== "본교" ? ` (${u.campus})` : ""}`,
    [],
  );

  const search = useCallback(
    async (term: string) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.rpc("admin_program_search", {
        p_q: term,
        p_limit: 200,
      });
      if (error) setError(error.message);
      setRows(error ? [] : ((data ?? []) as ProgramRow[]));
      setLoading(false);
    },
    [supabase],
  );

  async function save() {
    if (!draft) return;
    if (draft.university_id === "") {
      setError("대학을 선택해 주세요");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_program_upsert", {
      p_id: draft.id,
      p_university_id: draft.university_id,
      p_display_name: draft.display_name,
      p_faculty_group: draft.faculty_group,
      p_is_active: draft.is_active,
    });
    setBusy(false);
    if (error) {
      // UNIQUE(university_id, display_name) — 같은 대학 안에서 학과명은 유일하다 (§9.1)
      setError(
        error.message.includes("duplicate key")
          ? "같은 대학에 동일한 학과명이 이미 있습니다."
          : error.message,
      );
      return;
    }
    setNotice(draft.id === null ? "학과를 추가했습니다." : "학과를 수정했습니다.");
    setDraft(null);
    await search(q);
  }

  async function remove(row: ProgramRow) {
    const votes = row.vote_count ?? 0;
    const hard = votes === 0;
    const ok = window.confirm(
      hard
        ? `"${row.university} ${row.display_name}" 을(를) 완전히 삭제합니다.\n표가 한 건도 없어 복구할 기록이 없습니다.`
        : `"${row.university} ${row.display_name}" 에는 ${votes}표가 쌓여 있어 삭제할 수 없습니다.\n대신 비활성화합니다 — 매칭·배치표에서 빠지고 기존 기록은 남습니다.`,
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("admin_program_remove", {
      p_id: row.id,
      p_hard: hard,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    const res = data as { deleted: boolean };
    setNotice(res.deleted ? "학과를 삭제했습니다." : "학과를 비활성화했습니다.");
    await search(q);
  }

  async function toggleActive(row: ProgramRow) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_program_upsert", {
      p_id: row.id,
      p_university_id: row.university_id,
      p_display_name: row.display_name,
      p_faculty_group: row.faculty_group,
      p_is_active: !row.is_active,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice(row.is_active ? "비활성화했습니다." : "다시 활성화했습니다.");
    await search(q);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="대학명 또는 학과명"
            className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="whitespace-nowrap rounded-md border border-line-strong px-3 py-2 text-sm hover:bg-surface-sunken"
          >
            검색
          </button>
        </form>
        <button
          onClick={() => {
            setNotice(null);
            setError(null);
            setDraft({ ...EMPTY });
          }}
          className="whitespace-nowrap rounded-md bg-brand px-3 py-2 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover"
        >
          학과 추가
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-danger-500 bg-surface px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="rounded-md border border-line-strong bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
          {notice}
        </p>
      )}

      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="rounded-md border border-line-strong bg-surface p-3"
        >
          <h2 className="mb-2 text-sm font-semibold">
            {draft.id === null ? "학과 추가" : `학과 수정 · #${draft.id}`}
          </h2>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
            <select
              value={draft.university_id}
              onChange={(e) =>
                setDraft({ ...draft, university_id: Number(e.target.value) || "" })
              }
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
            >
              <option value="">대학 선택</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {uniLabel(u)}
                </option>
              ))}
            </select>
            <input
              value={draft.display_name}
              onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
              placeholder="학과명 (실제 명칭 그대로)"
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
            />
            <div className="flex gap-1">
              {FACULTIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDraft({ ...draft, faculty_group: f })}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    draft.faculty_group === f
                      ? "border-brand bg-brand text-fg-on-brand"
                      : "border-line-strong hover:bg-surface-sunken"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              활성 (매칭·배치표에 노출)
            </label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-sunken"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-fg-on-brand hover:bg-brand-hover disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
          <p className="mt-2 text-2xs text-fg-subtle">
            학과의 정체성은 <strong>실제 학과명</strong>입니다. 한 대학에 같은 계열 학과가 여럿인
            것은 정상입니다 (§9.1). 마스터 데이터는 수동 큐레이션이며 자동 수집하지 않습니다
            (§11.2).
          </p>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-surface-sunken text-2xs text-fg-subtle">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">대학</th>
              <th className="px-2 py-1.5 text-left font-medium">학과</th>
              <th className="px-2 py-1.5 text-left font-medium">계열</th>
              <th className="px-2 py-1.5 text-right font-medium">지수</th>
              <th className="px-2 py-1.5 text-right font-medium">표</th>
              <th className="px-2 py-1.5 text-right font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-2xs text-fg-subtle">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-2xs text-fg-subtle">
                  결과가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-line ${r.is_active ? "" : "bg-surface-sunken/60 text-fg-subtle"}`}
              >
                <td className="px-2 py-1.5">{r.university}</td>
                <td className="px-2 py-1.5 font-medium">
                  {r.display_name}
                  {!r.is_active && (
                    <span className="ml-1.5 rounded-sm bg-surface px-1 py-0.5 text-2xs text-warn-600">
                      비활성
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-2xs">{r.faculty_group}</td>
                <td className="px-2 py-1.5 text-right tabular">
                  {r.elo === null ? "—" : Math.round(Number(r.elo))}
                </td>
                <td className="px-2 py-1.5 text-right tabular">{r.vote_count ?? 0}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <button
                    onClick={() => {
                      setNotice(null);
                      setError(null);
                      setDraft({
                        id: r.id,
                        university_id: r.university_id,
                        display_name: r.display_name,
                        faculty_group: r.faculty_group,
                        is_active: r.is_active,
                      });
                    }}
                    className="rounded-sm px-1.5 py-1 text-2xs text-accent hover:underline"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => void toggleActive(r)}
                    disabled={busy}
                    className="rounded-sm px-1.5 py-1 text-2xs text-fg-muted hover:underline disabled:opacity-50"
                  >
                    {r.is_active ? "비활성" : "활성"}
                  </button>
                  <button
                    onClick={() => void remove(r)}
                    disabled={busy}
                    className="rounded-sm px-1.5 py-1 text-2xs text-danger-600 hover:underline disabled:opacity-50"
                  >
                    제거
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded-md bg-surface-sunken px-3 py-2 text-2xs leading-relaxed text-fg-muted">
        <strong>제거</strong>는 기본적으로 <strong>비활성화</strong>입니다. 표가 쌓인 학과를
        지우면 그 표가 만든 지수 이력이 끊기기 때문에 DB 가 삭제를 막습니다. 비활성화하면 매칭과
        배치표에서 빠지고 기록은 그대로 남습니다. 표가 한 건도 없는 학과만 실제로 삭제됩니다.
        최대 200건까지 표시하니, 많으면 검색으로 좁혀 주세요.
      </p>
    </div>
  );
}
