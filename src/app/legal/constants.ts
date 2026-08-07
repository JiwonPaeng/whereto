/**
 * 약관·개인정보처리방침의 공통 값.
 *
 * ⚠️ 아래 [[ ]] 는 전부 채워야 한다. 비워둔 채 공개하면
 * 개인정보보호법상 의무 기재사항 누락이 되고, 카카오 로그인 심사에서도 반려된다.
 */
export const LEGAL = {
  serviceName: "어디갈래",
  operator: "[[운영자명 또는 상호]]",
  representative: "[[대표자 성명]]",
  address: "[[소재지]]",
  contactEmail: "[[문의 이메일]]",

  // 개인정보 보호책임자 (개인정보보호법 제31조)
  privacyOfficerName: "[[성명]]",
  privacyOfficerRole: "[[직책]]",
  privacyOfficerEmail: "[[이메일]]",

  effectiveDate: "[[시행일 YYYY년 M월 D일]]",
  lastUpdated: "[[최종 개정일 YYYY년 M월 D일]]",
} as const;
