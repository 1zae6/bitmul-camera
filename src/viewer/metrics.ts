import type { GradeRow } from '../shared/types'

// 등급 비교 계산. 사람끼리 비교(일치율 탭)와 AI·사람 비교(AI 채점 탭)가 같은 계산을 쓴다.

export const CATS = ['0', '1', '2', '3', '4', 'X'] as const
export type Cat = (typeof CATS)[number]

/** 판단 불가는 X */
export function catOf(grade: number | null, unusable: boolean): Cat {
  return unusable || grade === null ? 'X' : (String(grade) as Cat)
}

export type Pair = { a: Cat; b: Cat }

export type Comparison = {
  n: number
  agree: number
  /** 둘 다 판단 가능한 쌍 중 등급 차이가 1 이하인 수 */
  within1: number
  numeric: number
  /** 코언 카파: 우연히 맞을 확률을 뺀 일치도 */
  kappa: number | null
  /** matrix[a][b] = a 쪽 등급, b 쪽 등급인 사진 수 (순서는 CATS) */
  matrix: number[][]
}

export function compare(pairs: Pair[]): Comparison {
  const matrix = CATS.map(() => CATS.map(() => 0))
  let agree = 0
  let within1 = 0
  let numeric = 0
  const countA: Record<string, number> = {}
  const countB: Record<string, number> = {}
  for (const { a, b } of pairs) {
    matrix[CATS.indexOf(a)][CATS.indexOf(b)]++
    countA[a] = (countA[a] ?? 0) + 1
    countB[b] = (countB[b] ?? 0) + 1
    if (a === b) agree++
    if (a !== 'X' && b !== 'X') {
      numeric++
      if (Math.abs(Number(a) - Number(b)) <= 1) within1++
    }
  }
  const n = pairs.length
  let kappa: number | null = null
  if (n) {
    const po = agree / n
    const pe = CATS.reduce((s, c) => s + ((countA[c] ?? 0) / n) * ((countB[c] ?? 0) / n), 0)
    kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe)
  }
  return { n, agree, within1, numeric, kappa, matrix }
}

export function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '-'
}

export type Truth = { cat: Cat; raters: number }

/**
 * 사람 등급으로 사진별 '정답'을 정한다.
 * 매긴 사람이 모두 같으면 정답(raters = 매긴 사람 수), 서로 다르면 conflicted 로 빼 둔다.
 */
export function humanTruth(grades: GradeRow[]): { truth: Map<string, Truth>; conflicted: Set<string> } {
  const byPhoto = new Map<string, Cat[]>()
  for (const g of grades) {
    const list = byPhoto.get(g.photo_id) ?? []
    list.push(catOf(g.grade, g.unusable))
    byPhoto.set(g.photo_id, list)
  }
  const truth = new Map<string, Truth>()
  const conflicted = new Set<string>()
  for (const [id, cats] of byPhoto) {
    if (cats.every((c) => c === cats[0])) truth.set(id, { cat: cats[0], raters: cats.length })
    else conflicted.add(id)
  }
  return { truth, conflicted }
}
