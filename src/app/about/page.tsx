import type { Metadata } from "next";
import Link from "next/link";
import { Article, LegalPage, Note, Ol, Ul } from "../legal/ui";

export const metadata: Metadata = {
  title: "만든 이유 · 어디갈래",
  description:
    "수험생 선호도는 어디에도 수치화되어 있지 않습니다. 그것을 집단 투표로 측정해 하나의 숫자로 만듭니다.",
};

// §1.5 정적 문서. 자주 바뀌지 않는다.
export const revalidate = 3600;

export default function AboutPage() {
  return (
    <LegalPage title="만든 이유" subtitle="이 서비스가 무엇을 하고, 무엇을 하지 않는가">
      <Article no="1." title="던지는 질문">
        <Note>
          <strong>당신이 이 두 곳을 모두 갈 수 있다면, 어디를 선택하시겠습니까?</strong>
        </Note>
        <p>
          이 문구가 서비스의 전부입니다. &ldquo;어디가 더 좋은 학교인가&rdquo;가 아니라{" "}
          <strong>&ldquo;당신이라면 어디를 가겠는가&rdquo;</strong> 입니다. 이 차이가 이 서비스의
          정체성이고, 화면·공유 이미지·약관 어디에서도 앞의 표현으로 바꾸지 않습니다.
        </p>
        <p>
          전자는 대학을 평가하는 질문입니다. 후자는 자기 선택을 말하는 질문입니다. 우리가 모을 수
          있는 것은 후자뿐이고, 그것으로 충분하다고 봅니다.
        </p>
      </Article>

      <Article no="2." title="왜 만들었나">
        <p>
          수험생이 대학을 고를 때 참고할 수 있는 정량 지표는 이미 많습니다. 입결(백분위·등급컷),
          취업률, 등록금, 재학생 수, 장학 규모 — 대학알리미와 대입정보포털이 제공합니다.
        </p>
        <p>
          그런데 실제 선택에서 큰 비중을 차지하는 <strong>&ldquo;수험생 선호도&rdquo;</strong> 는
          어디에도 수치화되어 있지 않습니다. 학교 위치, 브랜드 이미지, 대학가 상권, 통학 여건, 또래
          인식 같은 정량화되지 않은 요소들의 총합이기 때문입니다.
        </p>
        <p>
          그 결과 이 정보는 지금 커뮤니티의 감(感)과 학교별 옹호 문화에 의해 왜곡된 형태로만
          유통됩니다. 목소리 큰 쪽이 이기는 구조입니다.
        </p>
        <p>
          <strong>이 서비스는 그 선호도를 집단 투표로 측정해 하나의 숫자로 만듭니다.</strong> 한
          명이 아무리 오래 주장해도 한 표이고, 두 학과를 놓고 실제로 고른 선택만 반영됩니다.
        </p>
      </Article>

      <Article no="3." title="하지 않는 것">
        <p>아래 세 가지는 이 서비스가 명시적으로 다루지 않습니다.</p>
        <Ol>
          <li>
            <strong>대학의 교육 품질·학문적 수준·연구 역량 평가.</strong> 선호도는 인기이지 품질이
            아닙니다. 두 값은 자주 어긋나며, 우리는 앞의 것만 측정합니다.
          </li>
          <li>
            <strong>입시 결과(합격 점수) 예측 또는 대체.</strong> 지수가 높다고 합격선이 높은 것이
            아니고, 그 반대도 아닙니다.
          </li>
          <li>
            <strong>진학 상담이나 입시 컨설팅.</strong> 참고 자료일 뿐이며, 진학 결정의 결과에
            책임지지 않습니다.
          </li>
        </Ol>
        <p>
          지수는 투표 결과만으로 움직입니다. 투표가 쌓이지 않은 학과는 아직 값이라고 부를 것이
          없어서 <strong>소속 대학 수준으로 추정한 값</strong>을 대신 표시하며, 표가 모이면 학과
          자체의 값으로 옮겨갑니다.
        </p>
      </Article>

      <Article no="4." title="왜 투표를 익명으로 두는가">
        <p>
          누가 어느 쪽을 골랐는지는 어떤 화면에서도 공개되지 않습니다. 이것은 편의가 아니라 측정의
          조건입니다.
        </p>
        <p>
          실명이 노출되면 투표는 사회적으로 안전한 방향으로 기웁니다. 같은 학교 친구나 커뮤니티
          이용자가 볼 수 있다는 인식은 솔직한 선택을 억제하고, 그 순간 이 지표는
          &ldquo;선호도&rdquo;가 아니라 <strong>&ldquo;공개적으로 표명 가능한 선호도&rdquo;</strong>
          를 측정하게 됩니다.
        </p>
        <p>
          또한 실명 노출은 특정 선택을 한 사람에 대한 보복의 통로가 됩니다. 그래서 데이터베이스
          수준에서 다른 이용자가 남의 투표 기록을 조회할 수 없도록 막아 두었습니다.
        </p>
        <p>
          공개되는 것은 스스로 남기기로 선택한 <strong>&ldquo;선택 이유&rdquo;</strong> 뿐이고, 그
          경우에도 닉네임을 붙일지 익명으로 할지 직접 정합니다.
        </p>
      </Article>

      <Article no="5." title="대학 관계자분께">
        <Note>
          본 지표는 수험생들의 <strong>선호도 투표 결과</strong>이며, 대학의 교육 품질·학문적
          수준·연구 역량에 대한 평가가 아닙니다.
        </Note>
        <Ul>
          <li>
            산출 방식은 전부 공개되어 있습니다 —{" "}
            <Link href="/method" className="text-accent hover:underline">
              지수 산출 방식
            </Link>
          </li>
          <li>
            특정 대학·학과에 유리하거나 불리하도록 임의로 값을 조정하지 않습니다. 조정한다면 그
            사실이 위 문서와 어긋나게 됩니다
          </li>
          <li>
            학과 정보의 오류, 비하 표현, 그 밖의 이의는 이용약관에 안내된 연락처로 접수해 주시면
            조치합니다
          </li>
        </Ul>
      </Article>

      <p className="border-t border-line pt-4 text-xs text-fg-subtle">
        <Link href="/method" className="text-accent hover:underline">
          지수 산출 방식
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
