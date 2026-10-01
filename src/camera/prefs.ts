import { CONFIG } from '../shared/config'
import type { Phase } from '../shared/types'

// 폰마다 기억해 두는 작은 설정. 지워져도 기본값으로 돌아갈 뿐이다.
const KEY = 'bitmul-camera:prefs'

type Prefs = { autoCapture: boolean; last: { code: string; phase: Phase } | null; recentCodes: string[] }

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { autoCapture: true, last: null, recentCodes: [], ...JSON.parse(raw) }
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return { autoCapture: true, last: null, recentCodes: [] }
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

export function rememberShot(code: string, phase: Phase) {
  const p = load()
  const recentCodes = [code, ...p.recentCodes.filter((c) => c !== code)].slice(0, 6)
  save({ ...p, last: { code, phase }, recentCodes })
}

export function recentCodes() {
  return load().recentCodes
}

/** YG-07 → YG-08 처럼 끝 숫자를 하나 올린다. 숫자가 없으면 그대로 */
export function nextCode(code: string): string {
  const m = code.match(/^(.*?)(\d+)$/)
  if (!m) return code
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0')
  return m[1] + n
}

/** 지난 사진을 보고 다음 번호와 단계를 미리 채운다: 청소 전 → 같은 번호 청소 후 → 다음 번호 청소 전 */
export function suggestNext(): { code: string; phase: Phase; reason: string } {
  const last = load().last
  if (!last) return { code: `${CONFIG.drainCodePrefix}01`, phase: 'before', reason: '' }
  if (last.phase === 'before')
    return { code: last.code, phase: 'after', reason: `지난 사진이 ${last.code} 청소 전이라 같은 번호의 청소 후로 채웠습니다.` }
  if (last.phase === 'after')
    return { code: nextCode(last.code), phase: 'before', reason: `지난 사진이 ${last.code} 청소 후라 다음 번호로 채웠습니다.` }
  return { code: nextCode(last.code), phase: 'revisit', reason: `지난 사진이 ${last.code} 재방문이라 다음 번호로 채웠습니다.` }
}
