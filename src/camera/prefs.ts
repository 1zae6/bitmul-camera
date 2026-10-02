import type { Phase } from '../shared/types'

// 폰마다 기억해 두는 작은 설정. 지워져도 기본값으로 돌아갈 뿐이다.
const KEY = 'bitmul-camera:prefs'

type Prefs = { autoCapture: boolean; aiField: boolean; last: { code: string; phase: Phase } | null; recentCodes: string[] }

const DEFAULTS: Prefs = { autoCapture: true, aiField: true, last: null, recentCodes: [] }

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return { ...DEFAULTS }
}

function save(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // 무시
  }
}

export function getAutoCapture() {
  return load().autoCapture
}

export function setAutoCapture(on: boolean) {
  save({ ...load(), autoCapture: on })
}

/** 저장하자마자 AI 로 채점해 결과를 보여 줄지 */
export function getAiField() {
  return load().aiField
}

export function setAiField(on: boolean) {
  save({ ...load(), aiField: on })
}

export function rememberShot(code: string, phase: Phase) {
  const p = load()
  const recentCodes = [code, ...p.recentCodes.filter((c) => c !== code)].slice(0, 6)
  save({ ...p, last: { code, phase }, recentCodes })
}

export function recentCodes() {
  return load().recentCodes
}

/** 한재욱-07 → 한재욱-08 처럼 끝 숫자를 하나 올린다. 숫자가 없으면 그대로 */
export function nextCode(code: string): string {
  const m = code.match(/^(.*?)(\d+)$/)
  if (!m) return code
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0')
  return m[1] + n
}

/**
 * 다음 번호와 단계를 미리 채운다. 번호는 찍는 사람 이름 + 순번(한재욱-01)이라 사람끼리 겹치지 않는다.
 * 대부분 청소 없이 새 빗물받이를 찍으므로 항상 '다음 번호 · 청소 전'.
 * 같은 빗물받이의 청소 후·재방문은 찍는 사람이 최근 번호와 단계를 직접 고른다
 */
export function suggestNext(name: string): { code: string; phase: Phase; reason: string } {
  const last = load().last
  // 저장할 때 번호를 대문자로 바꾸므로 영문 이름도 대문자로 맞춘다
  const prefix = `${name.trim().toUpperCase()}-`
  // 처음 찍거나, 이 폰에서 다른 이름으로 찍던 번호면 내 이름 01부터
  if (!last || !last.code.startsWith(prefix)) return { code: `${prefix}01`, phase: 'before', reason: '' }
  return {
    code: nextCode(last.code),
    phase: 'before',
    reason: `지난 번호(${last.code}) 다음으로 채웠습니다. 같은 빗물받이의 청소 후·재방문이면 번호와 단계를 바꿔 주세요.`,
  }
}
