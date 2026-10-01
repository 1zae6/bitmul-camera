import { expandBox } from '../shared/box'
import { CONFIG } from '../shared/config'
import { GRADE_RULES, GRADES, UNUSABLE } from '../shared/grades'
import { rowBox, type PhotoRow } from '../shared/types'

// Gemini API 로 사진의 막힘 등급을 매긴다.
// API 키는 공개 사이트 코드에 넣지 않고, PC 뷰어에서 입력받아 그 브라우저에만 저장한다.

/** 지시문을 바꾸면 이 값을 올려서 결과를 구분한다 */
export const PROMPT_VERSION = 'v1'

const KEY_STORAGE = 'bitmul-camera:gemini-key'

export function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function saveKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim())
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    // 저장이 막힌 브라우저면 이번 화면에서만 쓴다
  }
}

export function maskKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••'
}

export const CAUSES = ['낙엽', '담배꽁초', '흙·모래', '비닐·쓰레기', '덮개·장판', '기타', '없음'] as const

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_drain: { type: 'BOOLEAN', description: '빨간 박스 안에 빗물받이 덮개가 보이면 true' },
    unusable: { type: 'BOOLEAN', description: '흐리거나 너무 멀어서 가려진 정도를 알 수 없으면 true' },
    covered_percent: { type: 'INTEGER', description: '빨간 박스 안 덮개 구멍이 가려진 비율(0~100)' },
    grade: { type: 'INTEGER', description: '막힘 등급 0~4' },
    confidence: { type: 'NUMBER', description: '이 판정을 얼마나 확신하는지 0~1' },
    causes: { type: 'ARRAY', items: { type: 'STRING', enum: [...CAUSES] }, description: '구멍을 가린 원인' },
    reason: { type: 'STRING', description: '판정 이유 한 문장' },
  },
  required: ['is_drain', 'unusable', 'covered_percent', 'grade', 'confidence', 'causes', 'reason'],
  propertyOrdering: ['is_drain', 'unusable', 'covered_percent', 'grade', 'confidence', 'causes', 'reason'],
}

/** 사람에게 보여 주는 등급 기준과 같은 문장을 그대로 쓴다 */
function instruction(): string {
  return [
    '너는 빗물받이가 얼마나 막혔는지 판정한다.',
    '사진은 빗물받이 주변을 잘라 낸 것이고, 빨간 박스 안이 판정할 빗물받이 덮개(격자)다.',
    '등급 기준:',
    ...GRADES.map((g) => `- ${g.value}등급(${g.short}): ${g.desc}`),
    `- 판단 불가: ${UNUSABLE.desc}. 이때 unusable=true 로 답한다.`,
    '규칙:',
    ...GRADE_RULES.map((r) => `- ${r}`),
    '빨간 박스 안에 빗물받이가 없으면 is_drain=false, unusable=true 로 답한다.',
    '정해진 JSON 형식으로만 답한다.',
  ].join('\n')
}

export type Example = { grade: number; data: string }

export function buildParts(target: string, examples: Example[]): unknown[] {
  const parts: unknown[] = [{ text: instruction() }]
  if (examples.length) {
    parts.push({ text: '아래는 사람이 등급을 매긴 예시 사진이다.' })
    for (const ex of examples) {
      parts.push({ text: `예시: ${ex.grade}등급(${GRADES[ex.grade].short})` })
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: ex.data } })
    }
  }
  parts.push({ text: '이제 다음 사진을 판정하라.' })
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: target } })
  return parts
}

/** 빨간 박스 + 주변 범위만 잘라 내고 박스를 그려서 base64 JPEG 로 만든다 */
export async function prepareImage(photo: PhotoRow, url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`사진을 받지 못했습니다 (${res.status})`)
  const bmp = await createImageBitmap(await res.blob())
  try {
    const W = bmp.width
    const H = bmp.height
    const box = rowBox(photo)
    const area = expandBox(box, CONFIG.contextPadding)
    const sx = area.x * W
    const sy = area.y * H
    const sw = Math.max(1, area.w * W)
    const sh = Math.max(1, area.h * H)
    const scale = Math.min(1, CONFIG.ai.imageLongEdge / Math.max(sw, sh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw * scale)
    canvas.height = Math.round(sh * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('사진을 그리지 못했습니다')
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 200))
    ctx.strokeRect((box.x * W - sx) * scale, (box.y * H - sy) * scale, box.w * W * scale, box.h * H * scale)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  } finally {
    bmp.close()
  }
}

export type AiResult = {
  is_drain: boolean
  unusable: boolean
  covered_percent: number
  grade: number | null
  confidence: number
  causes: string[]
  reason: string
}

/** fatal 이면 다음 사진도 같은 이유로 실패하므로 실행을 멈춘다 */
export class AiError extends Error {
  constructor(message: string, readonly fatal = false) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** 결과와 함께, 성공한 요청 한 번에 걸린 시간(한도 대기 제외)을 돌려준다 */
export async function callGemini(
  key: string,
  model: string,
  parts: unknown[],
  onWait?: (sec: number) => void,
): Promise<{ result: AiResult; latencyMs: number }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    const t0 = performance.now()
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
        }),
      })
    } catch {
      throw new AiError('Gemini에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    }
    const body = await res.json().catch(() => null)
    if (res.status === 429 && attempt < CONFIG.ai.maxRetries) {
      const sec = retrySeconds(body) ?? 30 * (attempt + 1)
      onWait?.(sec)
      await sleep(sec * 1000)
      continue
    }
    if (!res.ok) {
      const msg: string = body?.error?.message ?? `HTTP ${res.status}`
      throw new AiError(geminiErrorText(res.status, msg), [400, 401, 403, 404, 429].includes(res.status))
    }
    const cand = body?.candidates?.[0]
    const text: string = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
    if (!text) throw new AiError(`AI 응답이 비었습니다 (${cand?.finishReason ?? body?.promptFeedback?.blockReason ?? '이유 모름'})`)
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(text)
    } catch {
      throw new AiError('AI 응답을 읽지 못했습니다 (JSON 형식 아님)')
    }
    return { result: normalize(raw), latencyMs: Math.round(performance.now() - t0) }
  }
}

function retrySeconds(body: unknown): number | null {
  const details = (body as { error?: { details?: { '@type'?: string; retryDelay?: string }[] } } | null)?.error?.details ?? []
  const delay = details.find((d) => String(d['@type']).includes('RetryInfo'))?.retryDelay
  const m = typeof delay === 'string' ? delay.match(/^(\d+(?:\.\d+)?)s$/) : null
  return m ? Math.ceil(Number(m[1])) + 1 : null
}

function geminiErrorText(status: number, msg: string): string {
  if (status === 400 && /api key/i.test(msg)) return 'API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.'
  if (status === 403) return `이 키로는 이 모델을 쓸 수 없습니다: ${msg}`
  if (status === 404) return `모델을 찾지 못했습니다. 다른 모델을 골라 주세요: ${msg}`
  if (status === 429) return '무료 한도에 걸렸습니다. 요청 간격을 늘리거나, 오늘 한도가 끝났다면 내일 다시 시도해 주세요.'
  if (status >= 500) return `Gemini 서버 오류입니다 (${status}). 잠시 뒤 다시 시도해 주세요.`
  return `Gemini 오류 (${status}): ${msg}`
}

/** 모델이 형식을 조금 벗어나도 저장할 수 있게 값을 정리한다 */
function normalize(raw: Record<string, unknown>): AiResult {
  const isDrain = raw.is_drain !== false
  const unusable = raw.unusable === true || !isDrain
  const gradeNum = Math.round(Number(raw.grade))
  const grade = unusable || !Number.isFinite(gradeNum) ? null : Math.min(4, Math.max(0, gradeNum))
  const pctNum = Math.round(Number(raw.covered_percent))
  const conf = Number(raw.confidence)
  return {
    is_drain: isDrain,
    unusable: unusable || grade === null,
    covered_percent: Number.isFinite(pctNum) ? Math.min(100, Math.max(0, pctNum)) : 0,
    grade,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    causes: Array.isArray(raw.causes) ? raw.causes.map(String).slice(0, 7) : [],
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '',
  }
}
