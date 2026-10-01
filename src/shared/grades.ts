// 막힘 등급 기준 (초안). 팀이 고치면 여기만 바꾸면 촬영 앱과 뷰어에 함께 반영된다.

export const GRADE_RULES = [
  '빨간 박스 안의 빗물받이 덮개(구멍)가 얼마나 가려졌는지만 본다.',
  '고무판·장판·비닐로 덮어 둔 것도 가린 것으로 센다.',
  '박스 주변에 쌓인 쓰레기는 등급에 넣지 않는다. 구멍을 덮기 시작했을 때부터 센다.',
  '애매하면 낮은 등급과 높은 등급 중 높은 쪽을 고른다.',
]

export const GRADES = [
  { value: 0, short: '깨끗함', desc: '구멍이 거의 다 보인다. 가려진 부분 5% 미만' },
  { value: 1, short: '조금 막힘', desc: '낙엽·꽁초가 조금 있다. 구멍의 5~25%가 가려짐' },
  { value: 2, short: '절반 가까이', desc: '구멍의 25~50%가 쓰레기·흙으로 가려짐' },
  { value: 3, short: '대부분 막힘', desc: '구멍의 50~90%가 가려져 물이 잘 안 빠질 것 같다' },
  { value: 4, short: '완전히 막힘', desc: '덮개·쓰레기·흙으로 90% 이상 가려짐' },
] as const

export const UNUSABLE = {
  short: '판단 불가',
  desc: '빗물받이가 아니거나, 흐리거나, 너무 멀어서 가려진 정도를 알 수 없다',
}

export function gradeText(grade: number | null, unusable: boolean): string {
  if (unusable) return UNUSABLE.short
  if (grade === null) return '-'
  return `${grade} ${GRADES[grade]?.short ?? ''}`
}
