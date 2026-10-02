// 폰마다 기억해 두는 작은 설정. 지워져도 기본값으로 돌아갈 뿐이다.
const KEY = 'bitmul-camera:prefs'

/** seq: 빗물받이 번호 앞부분(이름-)별로 이 폰에서 쓴 가장 큰 순번 */
type Prefs = { autoCapture: boolean; aiField: boolean; seq: Record<string, number> }

const DEFAULTS: Prefs = { autoCapture: true, aiField: true, seq: {} }

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

// 빗물받이 번호 = 찍는 사람 이름 + 순번(한재욱-01). 사람끼리 겹치지 않고, 찍는 사람은 번호를 볼 필요가 없다.
// 저장할 때 번호를 대문자로 바꾸므로 영문 이름도 대문자로 맞춘다
function prefixOf(name: string) {
  return `${name.trim().toUpperCase()}-`
}

function seqOf(code: string, prefix: string): number {
  if (!code.startsWith(prefix)) return 0
  const n = Number(code.slice(prefix.length))
  return Number.isInteger(n) && n > 0 ? n : 0
}

export function rememberShot(code: string) {
  const p = load()
  const prefix = code.slice(0, code.lastIndexOf('-') + 1)
  const n = seqOf(code, prefix)
  if (prefix && n > (p.seq[prefix] ?? 0)) save({ ...p, seq: { ...p.seq, [prefix]: n } })
}

/** 새 빗물받이 번호. known 에는 서버에 이미 올라간 내 번호를 넣어 다른 폰에서 찍은 번호와도 겹치지 않게 한다 */
export function nextDrainCode(name: string, known: string[] = []): string {
  const prefix = prefixOf(name)
  const max = Math.max(load().seq[prefix] ?? 0, ...known.map((c) => seqOf(c, prefix)))
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}
