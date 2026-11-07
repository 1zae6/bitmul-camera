// 등급 기준 (v6, 2026-11-07): 4단계를 3단계로 줄이고, '괜찮음'을 5% 미만에서 20% 이하로 넓혔다.
// 팀이 고치면 여기만 바꾸면 촬영 앱·뷰어·AI 지시문에 함께 반영된다.
// 기준을 바꾸면 src/shared/ai.ts 의 PROMPT_VERSION 도 올려서 AI 결과를 구분한다.
//
// 저장하는 값은 옛 기준(v5)과 뜻이 겹치게 골랐다. 그래서 DB 를 고치지 않아도 되고, 아직 옛 버전 앱이 올린 등급도 뜻이 어긋나지 않는다.
//   0 = 괜찮음  (옛 0 '깨끗함' 5% 미만도 그대로 괜찮음)
//   2 = 쌓임    (옛 2 '꽤 쌓임' 33~66% 도 그대로 쌓임)
//   3 = 막힘    (옛 3 '많이 막힘' 66% 이상, 옛 5단계의 4 도 막힘)
//   1 = 옛 '조금 쌓임'(5~33%). 새 기준 20% 에서 갈려 어느 쪽인지 알 수 없으므로 매긴 사람이 다시 고른다. 새로 저장하지 않는다

/**
 * 괜찮음은 이 비율(%) 이하, 막힘은 이 비율 이상.
 * 20% 는 미국 워싱턴주 기그하버시 빗물받이 유지관리 기준(덮개 표면의 20% 넘게 막히면 청소)을 따랐다.
 */
export const PERCENT = { okMax: 20, blockedMin: 66 }

export const GRADE_RULES = [
  '덮개와 주변을 따로 보고, 둘 중 더 심한 쪽으로 매긴다. 덮개 = 빨간 박스 안을 쓰레기가 위에서 가린 비율, 주변 = 빨간 박스 밖·흰 점선 안을 쓰레기가 덮은 비율.',
  '물길을 막는 것만 센다: 쓰레기·낙엽·담배꽁초·흙더미, 덮개 위를 덮어 둔 고무판·장판·비닐. 얇게 깔린 흙먼지·모래, 얼룩, 이끼는 세지 않는다.',
  '빗물받이 아래(덮개 틈으로 보이는 안쪽)에 쌓인 쓰레기는 등급에 넣지 않고 "신고 필요"로 따로 표시한다. 시민이 덮개를 열고 치울 수 없기 때문이다.',
  '사진에 보이는 것만 보고 매긴다.',
  '애매하면 괜찮음과 쌓임 사이는 괜찮음, 쌓임과 막힘 사이는 막힘을 고른다.',
]

/** key: PC 등급 화면의 키보드 숫자, range: 버튼에 짧게 보여 줄 기준, dot: 신호등 색 */
export const GRADES = [
  {
    value: 0,
    key: '1',
    short: '괜찮음',
    range: `${PERCENT.okMax}% 이하`,
    dot: 'bg-green-600',
    desc: `치울 필요 없다. 덮개와 주변 둘 다 ${PERCENT.okMax}% 이하 (꽁초·낙엽 몇 개는 괜찮음)`,
  },
  {
    value: 2,
    key: '2',
    short: '쌓임',
    range: `${PERCENT.okMax}%~3분의 2`,
    dot: 'bg-amber-500',
    desc: `치워야 한다. 더 심한 쪽이 ${PERCENT.okMax}% 넘고 3분의 2(${PERCENT.blockedMin}%) 미만 덮였다`,
  },
  {
    value: 3,
    key: '3',
    short: '막힘',
    range: '3분의 2 이상',
    dot: 'bg-red-600',
    desc: `더 심한 쪽이 3분의 2(${PERCENT.blockedMin}%) 이상 덮였다. 덮개가 다 막힌 것도 여기`,
  },
] as const

/** 옛 기준(v5)의 1등급 '조금 쌓임'(5~33%). 새 기준 20% 에서 갈려서 매긴 사람이 다시 골라야 한다 */
export const OLD_PARTIAL = 1

/** 가장 높은 등급 값 (옛 5단계 기준의 4등급도 이 값으로 센다) */
export const MAX_GRADE = 3

export const UNUSABLE = {
  short: '판단 불가',
  desc: '빗물받이가 아니거나, 흐리거나, 너무 멀어서 쓰레기 양을 알 수 없다',
}

/** 등급과 별개로 켜는 표시. 지자체가 나중에 신고된 곳을 찾아가 청소한다 */
export const REPORT = {
  short: '신고 필요',
  desc: '빗물받이 아래(덮개 틈 안쪽)에 쓰레기·흙·낙엽이 쌓여 있다. 시민이 치울 수 없어 지자체에 신고한다',
}

/** 덮인 비율(%)을 등급 값으로. 옛 지시문으로 돌린 AI 결과를 지금 기준으로 다시 나눌 때 쓴다 */
export function gradeFromPercent(p: number): number {
  return p <= PERCENT.okMax ? 0 : p < PERCENT.blockedMin ? 2 : MAX_GRADE
}

/** 저장된 값을 지금 기준 등급 값으로. 옛 4등급은 막힘, 옛 1등급은 어느 쪽인지 알 수 없어 null */
export function currentGrade(grade: number | null): number | null {
  if (grade === null || grade === OLD_PARTIAL) return null
  return Math.min(grade, MAX_GRADE)
}

/** 옛 기준 '조금 쌓임'이라 매긴 사람이 다시 골라야 하는 등급 */
export function needsRegrade(g: { grade: number | null; unusable: boolean } | undefined): boolean {
  return Boolean(g && !g.unusable && g.grade === OLD_PARTIAL)
}

/** 등급 이름 (CSV 등). 판단 불가는 따로 표시하므로 여기서는 '-' */
export function gradeName(grade: number | null): string {
  if (grade === OLD_PARTIAL) return '옛 기준 조금 쌓임'
  const g = currentGrade(grade)
  return GRADES.find((x) => x.value === g)?.short ?? '-'
}

export function gradeText(grade: number | null, unusable: boolean, needsReport = false): string {
  const base = unusable ? UNUSABLE.short : grade === OLD_PARTIAL ? '옛 기준 조금 쌓임(다시 매기기)' : gradeName(grade)
  return needsReport ? `${base} · 신고` : base
}
