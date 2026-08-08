import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { Article, LegalPage, Note, Ol, Table, Ul } from "../legal/ui";

export const metadata: Metadata = {
  title: "지수 산출 방식 · 어디갈래",
  description: "선호도 지수가 어떤 공식으로 계산되는지 전부 공개합니다.",
};

// 설정값을 읽어 보여주므로 캐시를 짧게 잡는다.
export const revalidate = 300;

export default async function MethodPage() {
  const db = createPublicClient();

  /*
   * §8.6 — 이 페이지는 app_config 의 **실제 값**을 읽는다.
   * 하드코딩하면 설정을 바꾼 순간 공개 문서가 거짓이 된다. 그건 감추는 것보다 나쁘다.
   * ratelimit.* 과 abuse.* 는 RLS 로 애초에 내려오지 않는다 (의도된 비공개, 아래 7절).
   */
  const { data } = await db.from("app_config").select("key, value_num");
  const c = new Map((data ?? []).map((r) => [r.key as string, Number(r.value_num)]));
  const n = (k: string, fallback = 0) => (c.has(k) ? c.get(k)! : fallback);
  const pct = (k: string) => `${Math.round(n(k) * 100)}%`;

  const ageEnabled = n("weight.age_enabled") === 1;
  const shrinkK = n("elo.shrinkage_k");

  return (
    <LegalPage
      title="지수 산출 방식"
      subtitle="이 페이지의 숫자는 서비스가 실제로 사용하는 설정값을 그대로 읽어옵니다"
    >
      <Article no="1." title="왜 공개하는가">
        <p>
          지표가 신뢰받으려면 계산 과정이 감춰져 있으면 안 됩니다. 특히 이 서비스는 대학과 학과에
          숫자를 붙이는 일을 하므로, &ldquo;누군가 임의로 조정한 것 아니냐&rdquo;는 의심에 답할 수
          있어야 합니다.
        </p>
        <p>
          그래서 공식과 계수를 전부 공개합니다. <strong>이 페이지의 수치는 설명용으로 옮겨 적은
          것이 아니라 서비스가 실제로 참조하는 설정값입니다.</strong> 값을 바꾸면 이 문서도 함께
          바뀝니다.
        </p>
      </Article>

      <Article no="2." title="지수는 어떻게 움직이나">
        <p>
          체스 등에서 쓰는 ELO 방식입니다. 모든 학과는 <strong>{n("elo.initial", 1500)}점</strong>
          에서 출발하며, 입결이나 외부 순위로 초기값을 채우지 않습니다.
        </p>
        <Note>
          {"E = 1 / (1 + 10^((상대 점수 − 내 점수) / 400))"}
          <br />
          {"새 점수 = 기존 점수 + K × (결과 − E)"}
          <br />
          <span className="text-fg-muted">결과는 이기면 1, 지면 0. 무승부는 없습니다.</span>
        </Note>
        <p>
          <code>E</code>는 이길 것으로 예상되는 정도입니다. <strong>예상 밖의 결과일수록 점수가 크게
          움직입니다.</strong> 높은 점수의 학과가 낮은 점수의 학과를 이기면 거의 오르지 않고, 반대면
          크게 오릅니다.
        </p>
        <p>
          <code>K</code>는 한 번의 투표가 점수를 얼마나 움직이는지를 정합니다. 표본이 적을수록 크게
          잡아 빨리 자리를 잡게 하고, 쌓일수록 줄여 안정시킵니다.
        </p>
        <Table
          head={["그 학과의 누적 투표 수", "K"]}
          rows={[
            [`${n("elo.k_tier1_threshold", 10)}표 미만`, String(n("elo.k_tier1", 48))],
            [
              `${n("elo.k_tier1_threshold", 10)} ~ ${n("elo.k_tier2_threshold", 40) - 1}표`,
              String(n("elo.k_tier2", 32)),
            ],
            [`${n("elo.k_tier2_threshold", 40)}표 이상`, String(n("elo.k_tier3", 24))],
          ]}
        />
        <p>
          맞붙은 두 학과의 표본 수가 다르면 <strong>각자의 K를 각자에게 적용</strong>합니다. 오른
          점수와 내린 점수가 정확히 상쇄되지는 않지만, 새 학과가 빨리 제자리를 찾는 쪽이 총점
          보존보다 중요하다고 봤습니다.
        </p>
      </Article>

      <Article no="3." title="표본이 적은 학과는 어떻게 하나">
        <p>
          학과 수가 2,000개가 넘어서, 모든 학과가 충분한 표를 갖기까지는 오랜 시간이 걸립니다. 그
          전까지 아직 표가 거의 없는 학과를 &ldquo;아무 근거 없는 {n("elo.initial", 1500)}점&rdquo;
          으로 두면 화면이 사실을 말하지 못합니다.
        </p>
        <p>
          그래서 <strong>표본이 적은 학과는 소속 대학의 지수 쪽으로 당겨서 표시</strong>합니다.
          대학 지수는 서로 다른 대학의 학과가 맞붙을 때 같은 방식으로 따로 계산됩니다.
        </p>
        <Note>
          {`표시 지수 = (n × 학과 지수 + ${shrinkK} × 소속 대학 지수) / (n + ${shrinkK})`}
          <br />
          <span className="text-fg-muted">n = 그 학과의 누적 투표 수</span>
        </Note>
        <Ul>
          <li>표가 하나도 없으면 소속 대학의 지수를 그대로 보여줍니다</li>
          <li>
            <strong>{shrinkK}표</strong>가 모이면 학과 자체의 값이 절반 반영됩니다
          </li>
          <li>표가 쌓일수록 대학의 영향은 사라지고 학과 자체의 값으로 수렴합니다</li>
        </Ul>
        <p>
          이것은 데이터를 지어내는 것이 아니라 <strong>&ldquo;이 학과는 아직 모르니 소속 대학
          수준으로 추정한다&rdquo;는 사실을 그대로 표시</strong>하는 것입니다. 추정 상태인 학과에는
          화면에 그렇게 표기하며, 순위도 부여하지 않습니다(5절).
        </p>
        <p className="text-fg-subtle">
          저장되는 값은 언제나 학과 자체의 순수한 지수입니다. 당기는 계산은 화면에 보여줄 때만
          합니다.
        </p>
      </Article>

      <Article no="4." title="누구의 표가 얼마나 반영되나">
        <p>모든 표의 무게가 같지는 않습니다. 최종 반영도는 아래 값들의 곱입니다.</p>
        <Table
          head={["요소", "현재", "설명"]}
          rows={[
            [
              "연령 가중치",
              ageEnabled ? "적용 중" : <strong className="text-warn-600">적용하지 않음</strong>,
              ageEnabled
                ? `만 18세 이하 1.0, 만 19세부터 ${n("weight.age_base")}에서 시작해 해마다 ${n("weight.age_decay")}씩 감소(하한 ${n("weight.age_floor")})`
                : "현재 로그인 이용자는 연령과 무관하게 동일합니다. 생년월일을 검증할 수단이 없는 상태에서 연령별 차등을 두면, 이 문서를 읽고 생년월일을 다르게 입력하는 것을 막을 수 없기 때문입니다.",
            ],
            [
              "비로그인 투표",
              String(n("weight.anonymous")),
              "로그인 이용자를 1로 볼 때의 비중입니다. 초기 데이터 확보를 위해 반영하되 낮게 둡니다.",
            ],
            [
              "신뢰도",
              "1.0에서 시작",
              "특정 대학을 비정상적으로 일관되게 선택하는 계정은 이 값이 단계적으로 낮아집니다. 이용을 막지는 않고 영향력만 줄입니다.",
            ],
            [
              "평판",
              `${n("reputation.min_multiplier", 0.85)} ~ ${n("reputation.max_multiplier", 1.15)}`,
              "공개한 선택 이유가 받은 추천/비추천으로 결정됩니다. 폭을 좁게 묶은 이유는 6절에 있습니다. (아직 미도입)",
            ],
          ]}
        />
      </Article>

      <Article no="5." title="어떤 매치업이 나오나">
        <p>비교할 두 학과는 서버가 정합니다. 이용자가 임의의 쌍을 제출할 수는 없습니다.</p>
        <Ol>
          <li>
            <strong>계열 선택</strong> — 인문·자연 사이에서는{" "}
            <strong>{pct("match.cross_faculty_rate")}</strong>가 계열을 넘나드는 비교입니다. 문·이과
            통합 추세를 반영했고, 계열 간 점수 눈금을 이어주는 역할도 합니다.
          </li>
          <li>
            <strong>예체능</strong> — 일반 이용자에게는{" "}
            <strong>{pct("match.arts_rate_default")}</strong>만 등장하고, 계열을 예체능으로 설정한
            이용자에게는 <strong>{pct("match.arts_rate_arts_user")}</strong> 등장합니다. 음악·미술
            지망이 아닌 사람에게 성악과와 기악과를 비교하게 하면 응답이 아니라 잡음이 됩니다.
          </li>
          <li>
            <strong>쌍 선택</strong> — <strong>{pct("match.close_pair_rate")}</strong>는 지수 차이가{" "}
            {n("match.close_elo_gap", 200)}점 이내인 근접한 쌍입니다. 결과를 예측하기 어려운 비교일수록
            정보량이 큽니다. 나머지는 노출이 적었던 하위{" "}
            {pct("match.low_exposure_pct")} 학과를 우선 포함시킵니다.
          </li>
          <li>
            <strong>제외</strong> — 이미 투표한 조합은 다시 나오지 않습니다. 같은 조합에는 한 번만
            투표할 수 있고, 투표는 취소하거나 바꿀 수 없습니다.
          </li>
        </Ol>
        <p className="text-fg-subtle">
          전체 누적 투표가 {n("match.coldstart_threshold", 5000).toLocaleString("ko-KR")}표에 이르기
          전에는 근접 쌍 비율을 {pct("match.coldstart_close_rate")}로 낮춥니다. 초기에는 지수 추정
          자체가 부정확해 &ldquo;근접&rdquo;이 의미가 없기 때문입니다.
        </p>
      </Article>

      <Article no="6." title="신뢰도 표기">
        <Table
          head={["그 학과의 누적 투표 수", "표기"]}
          rows={[
            [
              `${n("badge.provisional_threshold", 10)}표 미만`,
              "잠정 — 점수를 회색으로 표시하고 순위를 부여하지 않습니다",
            ],
            [
              `${n("badge.provisional_threshold", 10)} ~ ${n("badge.low_sample_threshold", 40) - 1}표`,
              "표본 부족 — 주황 점으로 표시합니다",
            ],
            [`${n("badge.low_sample_threshold", 40)}표 이상`, "표기 없음"],
          ]}
        />
        <p>
          표본 수는 <strong>실제로 지수에 반영된 표</strong>만 셉니다.
        </p>
        <p>
          평판이 투표 반영도에 미치는 폭을{" "}
          {Math.round((n("reputation.max_multiplier", 1.15) - 1) * 100)}% 이내로 좁게 묶은 데에는
          이유가 있습니다. 평판이 영향력을 크게 좌우하면{" "}
          <strong>다수 의견에 동조할수록 영향력이 커지는 되먹임</strong>이 생깁니다. 소수 선호를 가진
          사람은 비추천을 받아 영향력이 줄고, 결국 지표에서 그 선호가 지워집니다. 그러면 이 지표는
          다수 의견을 증폭하는 기계가 되고, 없애려던 편향이 다른 경로로 돌아옵니다.
        </p>
      </Article>

      <Article no="7." title="공개하지 않는 것">
        <p>
          어뷰징 탐지의 <strong>구체적 임계값</strong>은 공개하지 않습니다. 초당 몇 표부터
          걸리는지, 편향 점수가 얼마를 넘으면 감쇠하는지 같은 값들입니다.
        </p>
        <p>
          공개하면 그 선을 피해 가는 방법을 함께 공개하는 셈이 되기 때문입니다.{" "}
          <strong>어떤 종류의 방어가 있는지는 위와 아래에 밝히되, 숫자만 감춥니다.</strong>
        </p>
        <p className="text-fg-subtle">
          이 문서가 설정값을 직접 읽어오는데도 해당 항목들이 보이지 않는 것은, 그 값들이 애초에
          외부로 내려오지 않도록 데이터베이스에서 막아 두었기 때문입니다.
        </p>
      </Article>

      <Article no="8." title="이 지표의 한계">
        <p>스스로 밝히는 약점입니다.</p>
        <Ul>
          <li>
            <strong>계열이 다른 학과 사이의 비교는 참고용입니다.</strong> 계열 간 눈금을 이어주는
            것은 교차 계열 투표인데, 그 결과는 응답자 집단의 계열 분포에 좌우됩니다.
          </li>
          <li>
            <strong>예체능은 사실상 별도 리그입니다.</strong> 위 5절의 이유로 다른 계열과 맞붙는
            비율이 매우 낮아, 인문·자연과 같은 축에 놓고 비교하기 어렵습니다. 그래서 기본 배치표에서
            제외하고 있습니다.
          </li>
          <li>
            <strong>표가 들어온 순서에 따라 결과가 달라집니다.</strong> ELO의 성질입니다. 모든 투표
            기록과 당시 적용된 반영도를 보존하고 있어, 필요하면 전체를 다시 계산할 수 있습니다.
          </li>
          <li>
            <strong>표본이 적은 지금 시점의 숫자는 대부분 추정입니다.</strong> 3절의 방식으로 소속
            대학 수준을 빌려 쓰고 있으며, 그 상태는 화면에 표기됩니다.
          </li>
          <li>
            <strong>학과 정보가 완전하지 않습니다.</strong> 각 대학 공식 자료를 바탕으로 수작업
            정리했으나 개편 반영이 늦거나 누락이 있을 수 있습니다.
          </li>
        </Ul>
      </Article>

      <p className="border-t border-line pt-4 text-xs text-fg-subtle">
        <Link href="/about" className="text-accent hover:underline">
          만든 이유
        </Link>
        {" · "}
        <Link href="/terms" className="text-accent hover:underline">
          이용약관
        </Link>
        {" · "}
        <Link href="/privacy" className="text-accent hover:underline">
          개인정보처리방침
        </Link>
      </p>
    </LegalPage>
  );
}
