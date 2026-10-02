// 등급 기준 (v5, 2026-10-02: 깨끗함(5% 미만)을 빼고 나머지를 3분의 1씩 나눔). 팀이 고치면 여기만 바꾸면 촬영 앱·뷰어·AI 지시문에 함께 반영된다.
// 기준을 바꾸면 src/shared/ai.ts 의 PROMPT_VERSION 도 올려서 AI 결과를 구분한다.

export const GRADE_RULES = [
  '덮개와 주변을 따로 보고, 둘 중 더 심한 쪽으로 매긴다. 덮개 = 빨간 박스 안을 쓰레기가 위에서 가린 비율, 주변 = 빨간 박스 밖·흰 점선 안을 쓰레기가 덮은 비율.',
  '쓰레기·낙엽·흙·담배꽁초를 모두 센다. 덮개 위를 고무판·장판·비닐로 덮어 둔 것도 쓰레기로 센다.',
  '빗물받이 아래(덮개 틈으로 보이는 안쪽)에 쌓인 쓰레기는 등급에 넣지 않고 "신고 필요"로 따로 표시한다. 시민이 덮개를 열고 치울 수 없기 때문이다.',
  '사진에 보이는 것만 보고 매긴다.',
  '애매하면 낮은 등급과 높은 등급 중 높은 쪽을 고른다.',
]

export const GRADES = [
  { value: 0, short: '깨끗함', desc: '덮개도 주변도 거의 깨끗하다. 둘 다 5% 미만' },
  { value: 1, short: '조금 쌓임', desc: '낙엽·꽁초가 조금 있다. 더 심한 쪽이 5~33%(3분의 1 미만) 덮였다' },
  { value: 2, short: '꽤 쌓임', desc: '더 심한 쪽이 33~66%(3분의 1~3분의 2) 덮였다' },
  { value: 3, short: '많이 막힘', desc: '더 심한 쪽이 66%(3분의 2) 이상 덮였다. 덮개가 다 막힌 것도 여기' },
] as const

/** 가장 높은 등급 (예전 5단계 기준의 4등급은 이 값으로 센다) */
export const MAX_GRADE = GRADES[GRADES.length - 1].value

export const UNUSABLE = {
  short: '판단 불가',
  desc: '빗물받이가 아니거나, 흐리거나, 너무 멀어서 쓰레기 양을 알 수 없다',
}

/** 등급과 별개로 켜는 표시. 지자체가 나중에 신고된 곳을 찾아가 청소한다 */
export const REPORT = {
  short: '신고 필요',
  desc: '빗물받이 아래(덮개 틈 안쪽)에 쓰레기·흙·낙엽이 쌓여 있다. 시민이 치울 수 없어 지자체에 신고한다',
}

export function gradeText(grade: number | null, unusable: boolean, needsReport = false): string {
  const base = unusable ? UNUSABLE.short : grade === null ? '-' : `${Math.min(grade, MAX_GRADE)} ${GRADES[Math.min(grade, MAX_GRADE)]?.short ?? ''}`
  return needsReport ? `${base} · 신고` : base
}
