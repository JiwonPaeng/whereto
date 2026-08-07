@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

**어디갈래 / whereto** — 수험생이 (대학, 학과) 조합 두 개를 1:1 비교 투표하고, 누적 결과로 "수험생 선호도 지수"를 만드는 커뮤니티.

- 한글명 **어디갈래** (기획서 §17 후보 중 확정), 영문명·코드 슬러그 **`whereto`**. 저장소·패키지·도메인은 전부 `whereto`.
- **도메인 확보는 아직 미확인**이다 (§17 주석).
- 영문명에 `rank`·`best`·`top`·`tier` 계열 단어를 쓰지 않는다 — §1.2(서열이 아니라 선호)와 충돌하고 §12.1 대학 측 리스크를 이름부터 키운다.
- `odiga`·`eodiga` 계열도 쓰지 않는다 — 교육부 대입정보포털 **'어디가'** 와 충돌한다. §11.2가 교차 확인 출처로 지목한 서비스라 혼동 소지가 실재한다.

**기획서 [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) 가 기준 문서다.** 기능 작업 전 해당 절을 읽을 것. 아래는 요약이며, 충돌 시 기획서가 우선한다.

**단, [docs/DECISIONS.md](docs/DECISIONS.md) 는 기획서보다 우선한다.** 기획서는 확정 문서(v1.1)라 직접 수정하지 않고, 구현 중 전제가 바뀐 결정만 결정 로그에 남긴다. **기획서와 코드가 어긋나 보이면 먼저 결정 로그를 확인할 것** — 대개 의도된 차이다.

현재 유효한 결정: 영문명 `whereto`(D-001) · `votes` ELO 변동량 2컬럼(D-002) · `mv_ranking_faculty` 통합(D-003) · **§5.3 연령 가중치 적용 보류(D-004)** · 마스터 데이터 단계적 확장(D-005) · Program 정체성 = 실제 학과명 + 계열 7분류(D-006) · **`majors` 제거(D-007)**.

현재 로드맵 M0(§15) 진행 중.

## 불변 원칙 (기획서 §0 — 위반 금지)

1. **`votes` 테이블은 append-only.** UPDATE/DELETE 하지 않는다. 무효 처리는 `is_valid = false` 플래그로만. 예외적으로 변경 가능한 컬럼은 `reason_public` 뿐이다. (§5.6, §5.7)
2. **ELO 계산은 Postgres RPC 함수 내부에서만.** 클라이언트가 점수를 계산해 전송하는 구조 금지. (§9.3, §13.3)
3. **매치업 쌍은 서버가 생성한다.** 클라이언트는 서버 발급 토큰 + 선택 결과만 제출한다. 임의 쌍 제출 불가. (§8.2)
4. **알고리즘 임계값·가중치를 코드에 하드코딩하지 않는다.** 전부 `app_config` 테이블에서 런타임 조회. (§5.5에 키 목록)
5. **투표는 타 유저에게 항상 익명.** 유저가 명시적으로 공개한 "선택 이유"만 닉네임과 함께 노출된다. RLS로 강제한다. (§4.1.2)

## 작업 규칙

- 기능마다 우선순위 태그가 있다: `P0`(1차 릴리즈) / `P1`(2차) / `P2`(이후). **§15 로드맵 순서를 따르고 마일스톤을 건너뛰지 않는다.** M1까지가 1차 릴리즈다.
- §5(알고리즘) · §7(평판) · §8(어뷰징 방지) · §9(데이터 모델)은 이 서비스의 핵심 자산이다. **임의로 단순화하지 말고, 변경이 필요하면 먼저 질문한다.**
- **§16 미결정 사항은 임의로 정하지 않는다** (시즌제 도입, 고지 문구 배치, 네이버 로그인, 대학별 게시판, 연령 가중치 계수, 교차 계열 비율, 평판 반영 폭). 부딪히면 확인할 것.
- 투표 질문 문구 — "당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?" — 는 서비스 정체성이다. UI 카피·공유 이미지·약관 어디에서도 "어디가 더 좋은 학교인가"로 바꾸지 않는다. (§1.2)
- 대학·학과 마스터 데이터는 **전면 수동 큐레이션**이다. 크롤링·API 자동 수집 코드를 작성하지 않는다. (§11.2)

## 아키텍처 (여러 절에 흩어져 있는 큰 그림)

**Program이 랭킹의 최소 단위** — 실제로 존재하는 (대학, 학과) 하나. `programs (university_id, display_name, faculty_group)`, `UNIQUE (university_id, display_name)`.

⚠️ **`majors`(표준 학과) 테이블은 없다. D-007로 제거했다 — 되살리지 말 것.** 기획서 §9.1과 CLAUDE.md 구버전이 "majors ↔ display_name 분리를 반드시 유지"라고 했으나, §5.4 매칭은 `major_id`를 쓰지 않고 계열과 ELO만 쓴다. 학과 단위 순위도 §4.3에 없다. 700개 Program을 손으로 표준 학과에 매핑하는 비용에 상응하는 이득이 없었다.

**분류는 계열(3개)까지만 한다.** `인문 / 자연 / 예체능` (D-008). 수험생이 실제로 쓰는 구분(문과/이과/예체능)이다. 학과 단위는 실제 명칭(`display_name`)으로만 다룬다 — 우리가 정규화하지 않는다. `profiles.track`도 같은 3개 어휘를 쓴다.

**`faculty_group`은 `programs`에 있다.** 대학별 실제 소속을 반영한다 — 통계학이 어떤 대학에선 자연과학대학, 다른 대학에선 정경대학인 것을 그대로 담는다.

**한 대학에 같은 계열 Program이 여럿인 게 정상이다.** 컴퓨터공학과와 인공지능학과가 공존한다. Program의 정체성은 실제 학과명이다.

알려진 대가: §4.2 "학과 검색"이 `display_name` 텍스트 검색으로만 가능해 '소프트웨어학부'가 '컴퓨터공학' 묶음에 안 걸린다. 필요해지면 `programs.major_id`를 **nullable**로 추가해 점진 매핑한다 (D-007).

**투표 플로우 (§13.3)** — 이 경로 전체가 서버 권위 구조다:
```
매치업 요청 → 서버가 §5.4 정책으로 쌍 선택 → matchup_tokens 발급 (TTL 10분, 1회용)
           → 클라이언트는 token + winner_id + reason 만 제출
           → vote_submit RPC 단일 트랜잭션:
              토큰 검증 → 중복 검사 → app_config 로드 → 유저 가중치 조회
              → ELO SELECT FOR UPDATE → K_eff 계산 → votes INSERT + ratings UPDATE + 토큰 consumed
```

**가중치는 세 축의 곱** — `K_eff = K_base(n) × w_age × c_trust × r_reputation`. 각각 다른 곳에서 산출된다: `w_age`는 생년월일+신분 기반 일 배치(§5.3), `c_trust`는 편향 탐지 배치(§8.3), `r_reputation`은 공개 이유에 대한 반응 집계 일 배치(§7.1). 셋 다 `profiles` 컬럼으로 캐시되며 투표 시점 값이 `votes.weight_applied`에 기록된다.

⚠️ **`w_age`는 현재 보류 중이라 로그인 유저 전원 1.0이다 (D-004). 버그가 아니다.** 카카오가 생년월일 동의항목을 비즈 앱 전환 뒤에만 열어주기 때문. 생년월일 수집은 계속하므로 나중에 소급 계산이 가능하다. 해제는 `app_config` 의 `weight.age_enabled` 를 1로 바꾸면 되고 코드 수정은 필요 없다.

**`weight_applied` + 타임스탬프 보존이 Bradley-Terry 전환의 전제다** (§5.7). append-only 원칙과 함께 지켜야 전체 재계산이 가능하다.

**읽기 부하 방어가 설계 전제** — 수능·정시 시즌 트래픽 급증을 가정한다. 랭킹은 materialized view + ISR(`revalidate: 600`), Program 상세 ISR(300), 게시판 목록 30초. **투표 화면만 `dynamic = 'force-dynamic'`.** Supabase Realtime은 쓰지 않는다. (§13.3)

**배치는 `pg_cron`** — 등록된 잡 4개. **pg_cron은 UTC로 돈다** (18:00 UTC = 03:00 KST).

| jobname | 스케줄 | 함수 |
|---|---|---|
| `daily-rating-snapshot` | `0 18 * * *` | `batch_daily_snapshot()` — `rating_history` 적재 (§4.3 추이 그래프, §4.2 순위 변동의 원천) |
| `daily-profile-weights` | `10 18 * * *` | `batch_recompute_profile_weights()` — `age_years` 갱신, 트리거가 `vote_weight` 동반 계산 |
| `refresh-ranking-mv` | `*/10 * * * *` | `refresh_ranking_mv()` |
| `refresh-hot-posts-mv` | `*/5 * * * *` | `refresh_hot_posts_mv()` |

`bias_score`(§8.3)·`reputation_mult`(§7.1) 재계산은 M2/M3이라 아직 없다.

**어뷰징 방지는 부가 기능이 아니라 핵심 기능이다.** 지표가 조작되면 서비스 존재 이유가 사라진다. 방어선을 애플리케이션 레이어에만 두지 않고 RLS로 DB 레벨에 둔다 — `votes`는 INSERT만, 본인 행 SELECT만. 타 유저 `votes` 행은 어떤 경로로도 조회 불가. (§8, §13.2)

**모바일/데스크톱 레이아웃을 각각 설계한다** (§14.2). 한쪽을 늘리거나 줄여 재사용하지 않는다. `lg`(1024px)가 전환점.

## 스택

**설치된 실제 버전**: Next.js **16.3.0** (App Router) · React **19.2.8** · **Tailwind v4** · TypeScript 5 · ESLint 9

⚠️ **Next 16 / Tailwind v4는 학습 데이터와 다를 수 있다.** 루트 `AGENTS.md`(Next.js가 `next dev`마다 자동 재생성)가 `node_modules/next/dist/docs/` 참조를 지시하지만 **현재 이 디렉터리는 비어 있다.** API가 기억과 다르게 동작하면 추측하지 말고 `node_modules/next/`의 실제 타입 정의를 확인하거나 사용자에게 물을 것.

- Tailwind v4는 `tailwind.config.ts`가 없다. 디자인 토큰은 [src/app/globals.css](src/app/globals.css)의 `@theme` 블록에 정의한다 (§14 네이비/인디고 베이스, 폭넓은 그레이 스케일).
- 예정: Supabase(Postgres + Auth Kakao + Storage) · Vercel · shadcn/ui(헤드리스 동작만, 기본 룩 사용 금지) · Pretendard · TanStack Query · Recharts · Upstash Redis · PostHog · Sentry

**`AGENTS.md`는 삭제하지 말 것.** 기획서 §13.4는 Codex 병행이 없으니 불필요하다고 했으나, 이 파일은 다른 이유로 존재한다 — Next.js가 자동 생성하며, AGENTS.md가 관리 블록을 갖고 있는 동안에만 `next dev`가 CLAUDE.md를 건드리지 않는다. 지우면 CLAUDE.md가 덮어써진다.

## 명령어

```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run start    # 빌드 결과 실행
npm run lint     # ESLint
```

DB 마이그레이션은 현재 Supabase MCP(`apply_migration`)로 원격 프로젝트에 직접 적용한다. **적용한 SQL은 반드시 `supabase/migrations/` 에 같은 내용으로 파일로 남겨 버전 관리한다** — MCP만 쓰면 스키마 이력이 저장소에 남지 않는다. 시드 데이터(마스터 데이터, `app_config`)도 마이그레이션 파일로 관리한다 (§11.2).

## 환경

Windows + VS Code. node 24.14.1 / npm 11.x. Supabase MCP 연결됨(조직 `Paengclub`), Vercel MCP 미연결.
