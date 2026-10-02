// 폰마다 기억해 두는 작은 설정. 지워져도 기본값으로 돌아갈 뿐이다.
const KEY = 'bitmul-camera:prefs'

type Prefs = { autoCapture: boolean; aiField: boolean }

const DEFAULTS: Prefs = { autoCapture: true, aiField: true }

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
