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
  /** 저장된 Program ELO */
  elo: number;
  /** D-016 대학 ELO 로 shrink 한 표시값. 화면 위치와 순위는 이 값을 쓴다. */
  elo_display: number;
  university_elo: number;
  vote_count: number;
  win_rate: number | null;
  confidence: string | null;
  rank_overall: number | null;
  rank_faculty: number | null;
};

/**
 * ⚠️ 이 상수들은 실제 렌더 높이와 맞아야 한다. 라벨은 `absolute` 로 y 를 직접 주기 때문에
 * 폰트가 커지면 자동으로 밀려나지 않고 **그냥 겹친다.**
 *
 * ROW_H: 라벨 한 줄 높이. text-2xs(12px) × line-height 1.35 = 16.2px + 여유.
 * BLOCK_HEAD_H: 대학 이름 배지가 들어갈 자리. 배지는 12px × 1.35 + py-0.5(4px) ≈ 20.2px 이고,
 *   배지 wrapper 는 flex 라 body 의 line-height strut 을 타지 않는다 —
 *   **wrapper 를 일반 블록으로 되돌리면 strut(15px × 1.6 = 24px)이 살아나 다시 겹친다.**
 */
const ROW_H = 19;
const BLOCK_HEAD_H = 28;
const BLOCK_PAD_BOTTOM = 5;
const HEADER_H = 30; // 차트 상단 여백 (y=0 이 maxElo)
const COL_W = 136; // 레인이 도입되어 폭이 늘었으므로 조금 좁혔다 (라벨 잘림은 측정으로 확인)

/**
 * 세로 스케일은 **데이터 범위에 맞춰 정한다.**
 *
 * 고정 배율(예전 3px/점)을 쓰면 지수 폭이 좁은 초기에 실제 위치가 충돌 밀어내기에 묻힌다 —
 * 범위 115점이 345px 인데 컬럼당 라벨 43개가 688px 를 차지하면, 보이는 건 위치가 아니라
 * 그냥 정렬된 목록이다. 범위가 목표 높이를 채우도록 배율을 역산한다.
 */
const TARGET_SPAN_PX = 2200;
const MIN_PX_PER_POINT = 1.5;
const MAX_PX_PER_POINT = 60;

/**
 * 한 대학 안에서 지수가 크게 벌어진 학과는 **블록을 나눈다.**
 *
 * 의약처럼 소속 대학 수준을 완전히 벗어나는 학과가 있으면, 그 대학 블록이 세로로
 * 지나치게 길어져 다른 대학과 전부 겹치고 컬럼 패킹이 무의미해진다.
 *
 * ⚠️ **인접 낙차만 보면 안 쪼개진다.** 의약 계열은 본체에서 한 번에 뚝 떨어지지 않고
 * 의예 → 치의 → 약학 → 본체로 계단을 이룬다. 낙차 기준을 계단 하나 크기까지 낮추면
 * 본체 내부가 잘게 부서지고, 계단 전체를 덮게 높이면 아무것도 안 쪼개진다.
 * 실측: 41개 대학 중 낙차가 범위의 20%를 넘는 곳이 2곳뿐이었다(서울대 span 307 /
 * 최대낙차 95).
 *
 * 그래서 기준이 둘이다.
 *   · GAP  — 인접 항목 간 낙차. 진짜 절벽을 잡는다
 *   · SPAN — **블록이 덮는 지수 폭의 상한.** 계단으로 내려가도 누적 폭이 넘으면 끊는다
 */
const SPLIT_GAP_RATIO = 0.09; // 전체 지수 범위 대비
const SPLIT_GAP_MIN = 25;
const SPLIT_SPAN_RATIO = 0.14; // 한 블록이 덮을 수 있는 지수 폭
const SPLIT_SPAN_MIN = 60;

/**
 * 한 **레인**(블록 내부 열)에 담을 항목 수 상한.
 *
 * 값으로는 더 쪼갤 수 없는 덩어리가 남는다 — 표가 없는 학과는 전부 소속 대학의 같은
 * 표시값에 몰려 있어서 낙차도 폭도 0이다. 부산대 67개가 폭 104점 안에 있는데 세로로는
 * 67 × ROW_H = 1273px 를 차지했다. 화면에 보이는 건 지수 위치가 아니라 밀어내기 결과다.
 *
 * ⚠️ **덩어리를 세로로 쪼개 별 블록으로 만들면 안 된다.** 컬럼 패킹이 빈 자리를 찾아
 * 넣으므로 같은 대학이 차트 폭 전체에 산개한다 — 실측으로 부산대가 컬럼
 * 352 · 500 · 3756 · 3904 에 흩어졌다. 블록으로 묶는 의미가 사라진다.
 *
 * 대신 **블록을 넓혀 내부에서 여러 레인으로 배치한다.** 대학은 하나의 블록으로 남고
 * 폭만 늘어난다. 항목은 레인에 라운드로빈으로 나눠 각 레인이 같은 지수 구간을 절반
 * 밀도로 덮게 한다 — 밀어내기가 줄어 위치가 더 정확해진다.
 */
const MAX_LANE_ITEMS = 26;

/** 눈금이 8~12개 나오도록 사람이 읽기 좋은 간격을 고른다. */
function niceStep(range: number): number {
  const raw = Math.max(range / 10, 0.5);
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  return candidates.find((c) => c >= raw) ?? 1000;
}

type Placed = RankRow & { y: number; lane: number };
type Block = {
  university: string;
  campus: string;
  items: Placed[];
  top: number;
  bottom: number;
  col: number;
  /** 블록 내부 열 수. 폭 = lanes × COL_W */
  lanes: number;
};

export function PlacementChart({ rows }: { rows: RankRow[] }) {
  const [faculty, setFaculty] = useState<"전체" | "인문" | "자연">("전체");
  const [region, setRegion] = useState<string>("전체");
  const [selected, setSelected] = useState<RankRow | null>(null);

  const regions = useMemo(
    () => ["전체", ...Array.from(new Set(rows.map((r) => r.region_group)))],
    [rows],
  );

  const { blocks, cols, height, maxElo, minElo, pxPerPoint, gridStep } = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (faculty === "전체" || r.faculty_group === faculty) &&
        (region === "전체" || r.region_group === region),
    );

    if (filtered.length === 0) {
      return {
        blocks: [] as Block[], cols: 0, height: 200,
        maxElo: 0, minElo: 0, pxPerPoint: 1, gridStep: 50,
      };
    }

    const maxElo = Math.max(...filtered.map((r) => r.elo_display));
    const minElo = Math.min(...filtered.map((r) => r.elo_display));
    const range = Math.max(maxElo - minElo, 1);
    const pxPerPoint = Math.min(
      MAX_PX_PER_POINT,
      Math.max(MIN_PX_PER_POINT, TARGET_SPAN_PX / range),
    );
    const gridStep = niceStep(range);

    // 대학별로 묶고, 지수 내림차순으로 세로 배치한다.
    // 같은 지수가 겹치면 아래로 밀어낸다 — 실제 배치표와 같은 방식.
    const byUniv = new Map<string, RankRow[]>();
    for (const r of filtered) {
      const key = `${r.university_short_name ?? r.university_name}|${r.campus}`;
      if (!byUniv.has(key)) byUniv.set(key, []);
      byUniv.get(key)!.push(r);
    }

    const splitGap = Math.max(SPLIT_GAP_MIN, range * SPLIT_GAP_RATIO);
    const splitSpan = Math.max(SPLIT_SPAN_MIN, range * SPLIT_SPAN_RATIO);

    const raw: Omit<Block, "col">[] = [];
    for (const [key, list] of byUniv) {
      const [university, campus] = key.split("|");
      const sorted = [...list].sort((a, b) => b.elo_display - a.elo_display);

      // 절벽(인접 낙차) 또는 누적 폭 초과면 같은 대학이라도 블록을 끊는다.
      const clusters: RankRow[][] = [];
      let current: RankRow[] = [];
      for (const r of sorted) {
        const prev = current[current.length - 1];
        const cliff = prev !== undefined && prev.elo_display - r.elo_display > splitGap;
        const tooTall =
          current.length > 0 && current[0].elo_display - r.elo_display > splitSpan;
        if (cliff || tooTall) {
          clusters.push(current);
          current = [];
        }
        current.push(r);
      }
      if (current.length > 0) clusters.push(current);

      for (const cluster of clusters) {
        // 항목이 많으면 블록을 넓혀 레인으로 나눈다. 별 블록으로 쪼개지 않는다.
        const lanes = Math.max(1, Math.ceil(cluster.length / MAX_LANE_ITEMS));

        // 라운드로빈 — 각 레인이 같은 지수 구간을 1/lanes 밀도로 덮는다.
        // 앞쪽 절반/뒤쪽 절반으로 나누면 레인끼리 높이가 어긋난다.
        const items: Placed[] = [];
        const cursors = new Array<number>(lanes).fill(-Infinity);
        cluster.forEach((r, i) => {
          const lane = i % lanes;
          const ideal = (maxElo - r.elo_display) * pxPerPoint;
          const y = Math.max(ideal, cursors[lane] + ROW_H);
          cursors[lane] = y;
          items.push({ ...r, y, lane });
        });

        raw.push({
          university,
          campus,
          items,
          lanes,
          top: Math.min(...items.map((it) => it.y)),
          bottom: Math.max(...items.map((it) => it.y)) + ROW_H,
        });
      }
    }

    // 컬럼 패킹: 위 대학의 최하위가 끝난 지점 아래면 같은 컬럼을 재사용한다.
    // 세로축은 하나를 공유하므로 "같은 높이 = 같은 지수" 관계가 유지된다.
    raw.sort((a, b) => a.top - b.top);
    const colBottoms: number[] = [];
    const blocks: Block[] = [];
    // 위 블록의 바닥 + (아래 블록의 헤더 자리 + 숨 쉴 틈) 아래여야 컬럼을 재사용한다.
    const clears = (bottom: number, top: number) =>
      top >= bottom + BLOCK_PAD_BOTTOM + BLOCK_HEAD_H + 8;

    // lanes 개의 **연속된** 컬럼이 필요하다. 나눠 놓으면 대학이 갈라져 보인다.
    const fits = (c: number, lanes: number, top: number) => {
      if (c < 0 || c + lanes > colBottoms.length) return false;
      for (let k = 0; k < lanes; k++) if (!clears(colBottoms[c + k], top)) return false;
      return true;
    };

    /*
     * ⚠️ 한 대학이 여러 블록으로 갈리면 그 블록들이 차트 폭 전체에 흩어진다
     * (부산대가 컬럼 56 과 3904). **같은 대학이 쓰던 컬럼을 우선 재사용하는 방식은
     * 시도했고 효과가 전혀 없었다** — 위쪽 블록이 컬럼을 잡은 뒤 다른 대학 블록들이
     * 같은 컬럼을 덮어써서, 본체 블록이 도착할 때는 이미 막혀 있다.
     *
     * 대학별로 컬럼을 예약하면 붙일 수 있지만 컬럼 재사용을 포기해야 한다 —
     * 41개 대학 × 평균 2.5레인 ≈ 100컬럼 = 14,800px. 압축된 차트와 대학 인접성은
     * 1,763개 라벨에서 양립하지 않는다. 압축을 택했다.
     */
    for (const b of raw) {
      let col = -1;
      for (let c = 0; c + b.lanes <= colBottoms.length; c++) {
        if (fits(c, b.lanes, b.top)) {
          col = c;
          break;
        }
      }
      if (col === -1) {
        col = colBottoms.length;
        for (let k = 0; k < b.lanes; k++) colBottoms.push(0);
      }
      for (let k = 0; k < b.lanes; k++) colBottoms[col + k] = b.bottom;
      blocks.push({ ...b, col });
    }

    return {
      blocks,
      cols: colBottoms.length,
      height: Math.max(...blocks.map((b) => b.bottom)) + 20,
      maxElo,
      minElo,
      pxPerPoint,
      gridStep,
    };
  }, [rows, faculty, region]);

  const gridTop = Math.ceil(maxElo / gridStep) * gridStep;
  const gridLines: number[] = [];
  for (let v = gridTop; v >= minElo - gridStep; v -= gridStep) gridLines.push(v);

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
            const y = (maxElo - v) * pxPerPoint + HEADER_H;
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

          {/* 대학 블록. 학과들이 하나의 반투명 묶음 위에 올라간다. */}
          {blocks.map((b) => {
            const blockTop = b.top + HEADER_H - BLOCK_HEAD_H;
            const blockHeight = b.bottom - b.top + BLOCK_HEAD_H + BLOCK_PAD_BOTTOM;

            return (
              <div
                // 한 대학이 여러 블록으로 쪼개질 수 있으므로 대표 Program 을 키에 포함한다
                key={`${b.university}-${b.campus}-${b.items[0].program_id}`}
                className="absolute"
                style={{ left: 56 + b.col * COL_W, width: b.lanes * COL_W - 8, top: 0 }}
              >
                {/* 묶음 배경.
                    반투명이어야 한다 — 불투명하면 지수 눈금선이 가려져
                    "같은 높이 = 같은 지수"라는 배치표의 전제가 눈으로 확인되지 않는다.
                    DOM 순서상 먼저 와서 라벨보다 아래에 깔린다. */}
                <div
                  className="absolute rounded-md border border-navy-200 bg-navy-500/[0.07]"
                  style={{ top: blockTop, height: blockHeight, left: 0, right: 0 }}
                />

                {/* flex 로 감싼다 — 일반 블록이면 body 의 line-height strut 이 살아나
                    배지보다 큰 줄 상자가 만들어지고, 그만큼 첫 학과 라벨을 파고든다. */}
                <div
                  className="absolute left-0 right-0 flex justify-center"
                  style={{ top: blockTop + 2 }}
                >
                  <span className="max-w-full truncate rounded-sm bg-brand px-2 py-0.5 text-2xs font-bold leading-tight text-fg-on-brand">
                    {b.university}
                  </span>
                </div>

                {b.items.map((it) => (
                  <button
                    key={it.program_id}
                    onClick={() => setSelected(it)}
                    className={[
                      "absolute truncate rounded-xs px-1 text-center text-2xs transition-colors hover:bg-surface",
                      it.confidence === "잠정" ? "text-badge-provisional" : "text-fg",
                      selected?.program_id === it.program_id
                        ? "bg-vote-selected-bg font-semibold ring-1 ring-accent"
                        : "",
                    ].join(" ")}
                    // 레인 단위로 가로 위치를 잡는다. left-1/right-1 로는 블록이 넓어져도
                    // 라벨이 블록 전체 폭으로 늘어나 레인이 겹친다.
                    style={{ top: it.y + HEADER_H, left: it.lane * COL_W + 4, width: COL_W - 12 }}
                    title={`${it.display_name} · ${it.elo_display} · 표본 ${it.vote_count}`}
                  >
                    {it.confidence === "표본 부족" && (
                      <span className="mr-0.5 inline-block size-1 rounded-full bg-badge-low-sample align-middle" />
                    )}
                    {it.display_name}
                  </button>
                ))}
              </div>
            );
          })}

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
                  선호도 지수 <strong className="text-fg">{selected.elo_display}</strong>
                  {selected.confidence === "잠정" && (
                    <span className="ml-1 text-fg-subtle">
                      (표본 부족 — 소속 대학 수준으로 추정)
                    </span>
                  )}
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
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={`/program/${selected.program_id}`}
                className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-surface-sunken"
              >
                상세 보기
              </a>
              <button
                onClick={() => setSelected(null)}
                className="text-2xs text-fg-subtle hover:underline"
              >
                닫기
              </button>
            </div>
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
