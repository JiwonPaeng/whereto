"use client";

import { useMemo, useState } from "react";

export type RankRow = {
  program_id: number;
  university_name: string;
  university_short_name: string | null;
  campus: string;
  region_group: string;
  faculty_group: string;
  display_name: string;
  elo: number;
  vote_count: number;
  win_rate: number | null;
  confidence: string | null;
  rank_overall: number | null;
  rank_faculty: number | null;
};

const ROW_H = 16; // 라벨 한 줄 높이 — §14.3 고밀도
const PX_PER_POINT = 3; // 지수 1점당 세로 픽셀
const HEADER_H = 30;
const COL_W = 132;
const GRID_STEP = 50; // 눈금 간격 (지수)

type Placed = RankRow & { y: number };
type Block = { university: string; campus: string; items: Placed[]; top: number; bottom: number; col: number };

export function PlacementChart({ rows }: { rows: RankRow[] }) {
  const [faculty, setFaculty] = useState<"전체" | "인문" | "자연">("전체");
  const [region, setRegion] = useState<string>("전체");
  const [selected, setSelected] = useState<RankRow | null>(null);

  const regions = useMemo(
    () => ["전체", ...Array.from(new Set(rows.map((r) => r.region_group)))],
    [rows],
  );

  const { blocks, cols, height, maxElo, minElo } = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (faculty === "전체" || r.faculty_group === faculty) &&
        (region === "전체" || r.region_group === region),
    );

    if (filtered.length === 0) {
      return { blocks: [] as Block[], cols: 0, height: 200, maxElo: 0, minElo: 0 };
    }

    const maxElo = Math.max(...filtered.map((r) => r.elo));
    const minElo = Math.min(...filtered.map((r) => r.elo));

    // 대학별로 묶고, 지수 내림차순으로 세로 배치한다.
    // 같은 지수가 겹치면 아래로 밀어낸다 — 실제 배치표와 같은 방식.
    const byUniv = new Map<string, RankRow[]>();
    for (const r of filtered) {
      const key = `${r.university_short_name ?? r.university_name}|${r.campus}`;
      if (!byUniv.has(key)) byUniv.set(key, []);
      byUniv.get(key)!.push(r);
    }

    const raw: Omit<Block, "col">[] = [];
    for (const [key, list] of byUniv) {
      const [university, campus] = key.split("|");
      const sorted = [...list].sort((a, b) => b.elo - a.elo);
      const items: Placed[] = [];
      let cursor = -Infinity;
      for (const r of sorted) {
        const ideal = (maxElo - r.elo) * PX_PER_POINT;
        const y = Math.max(ideal, cursor + ROW_H);
        items.push({ ...r, y });
        cursor = y;
      }
      raw.push({
        university,
        campus,
        items,
        top: items[0].y,
        bottom: items[items.length - 1].y + ROW_H,
      });
    }

    // 컬럼 패킹: 위 대학의 최하위가 끝난 지점 아래면 같은 컬럼을 재사용한다.
    // 세로축은 하나를 공유하므로 "같은 높이 = 같은 지수" 관계가 유지된다.
    raw.sort((a, b) => a.top - b.top);
    const colBottoms: number[] = [];
    const blocks: Block[] = [];
    for (const b of raw) {
      let col = colBottoms.findIndex((bottom) => b.top >= bottom + HEADER_H + 8);
      if (col === -1) {
        col = colBottoms.length;
        colBottoms.push(0);
      }
      colBottoms[col] = b.bottom;
      blocks.push({ ...b, col });
    }

    return {
      blocks,
      cols: colBottoms.length,
      height: Math.max(...blocks.map((b) => b.bottom)) + 20,
      maxElo,
      minElo,
    };
  }, [rows, faculty, region]);

  const gridTop = Math.ceil(maxElo / GRID_STEP) * GRID_STEP;
  const gridLines: number[] = [];
  for (let v = gridTop; v >= minElo - GRID_STEP; v -= GRID_STEP) gridLines.push(v);

  return (
    <div>
      {/* 필터 — §4.2 계열 필터는 눈에 띄게 배치한다 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <FilterGroup
          label="계열"
          value={faculty}
          options={["전체", "인문", "자연"]}
          onChange={(v) => setFaculty(v as typeof faculty)}
        />
        <FilterGroup label="지역" value={region} options={regions} onChange={setRegion} />
      </div>

      <div className="overflow-x-auto">
        {/* 좌표계: y = 0 이 maxElo. 모든 요소를 HEADER_H 만큼 아래로 민다. */}
        <div
          className="relative"
          style={{ height: height + HEADER_H, minWidth: 56 + cols * COL_W }}
        >
          {/* 지수 눈금 */}
          {gridLines.map((v) => {
            const y = (maxElo - v) * PX_PER_POINT + HEADER_H;
            if (y < 0 || y > height + HEADER_H) return null;
            return (
              <div key={v} className="pointer-events-none absolute left-0 right-0" style={{ top: y }}>
                <div className="border-t border-dashed border-line" />
                <span className="absolute -top-2 left-0 bg-canvas pr-1 text-2xs tabular text-fg-subtle">
                  {v}
                </span>
              </div>
            );
          })}

          {/* 대학 블록 */}
          {blocks.map((b) => (
            <div
              key={`${b.university}-${b.campus}-${b.col}`}
              className="absolute"
              style={{ left: 56 + b.col * COL_W, width: COL_W - 8, top: 0 }}
            >
              {/* 대학 헤더는 그 대학의 최상위 학과 바로 위에 붙는다 */}
              <div
                className="absolute rounded-sm bg-brand px-2 py-1 text-2xs font-bold text-fg-on-brand"
                style={{ top: b.top + HEADER_H - 24 }}
              >
                {b.university}
              </div>

              {b.items.map((it) => (
                <button
                  key={it.program_id}
                  onClick={() => setSelected(it)}
                  className={[
                    "absolute w-full truncate rounded-xs px-1 text-left text-2xs transition-colors hover:bg-vote-selected-bg",
                    it.confidence === "잠정" ? "text-badge-provisional" : "text-fg",
                    selected?.program_id === it.program_id ? "bg-vote-selected-bg font-semibold" : "",
                  ].join(" ")}
                  style={{ top: it.y + HEADER_H }}
                  title={`${it.display_name} · ${it.elo} · 표본 ${it.vote_count}`}
                >
                  {it.confidence === "표본 부족" && (
                    <span className="mr-0.5 inline-block size-1 rounded-full bg-badge-low-sample align-middle" />
                  )}
                  {it.display_name}
                </button>
              ))}
            </div>
          ))}

          {blocks.length === 0 && (
            <p className="py-16 text-center text-sm text-fg-subtle">
              조건에 맞는 학과가 없습니다.
            </p>
          )}
        </div>
      </div>

      {/* 선택 상세 — 배치표에서 빠진 순위·변동·표본·승률을 여기서 보여준다 */}
      {selected && (
        <div className="sticky bottom-0 mt-3 rounded-md border border-line-strong bg-surface p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-bold">
                {selected.university_short_name ?? selected.university_name}{" "}
                <span className="font-normal text-fg-muted">{selected.display_name}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted tabular">
                <span>
                  선호도 지수 <strong className="text-fg">{selected.elo}</strong>
                </span>
                <span>
                  전체 순위{" "}
                  <strong className="text-fg">
                    {selected.rank_overall ?? "—"}
                  </strong>
                </span>
                <span>
                  계열 내{" "}
                  <strong className="text-fg">{selected.rank_faculty ?? "—"}</strong>
                </span>
                <span>표본 {selected.vote_count}</span>
                <span>
                  승률{" "}
                  {selected.win_rate === null
                    ? "—"
                    : `${Math.round(selected.win_rate * 100)}%`}
                </span>
                {selected.confidence && (
                  <span className="text-warn-600">{selected.confidence}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-2xs text-fg-subtle hover:underline"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs text-fg-subtle">{label}</span>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={[
              "rounded-sm border px-2 py-0.5 text-xs transition-colors",
              value === o
                ? "border-accent bg-vote-selected-bg font-semibold text-brand"
                : "border-line-strong bg-surface text-fg-muted hover:bg-surface-sunken",
            ].join(" ")}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
