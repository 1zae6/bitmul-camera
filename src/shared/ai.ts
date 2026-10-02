import { expandBox } from './box'
import { CONFIG } from './config'
import { GRADE_RULES, GRADES, REPORT, UNUSABLE } from './grades'
import { functionUrl, PUBLIC_KEY, sb } from './supabase'
import { rowBox, type AiGradeRow, type Box, type PhotoRow } from './types'

// Gemini 로 사진의 쓰레기 등급을 매긴다. 폰(찍고 바로 채점)과 PC 뷰어(AI 채점 탭)가 함께 쓴다.
// 기본은 Supabase 서버 함수(grade-photo)가 비밀값으로 둔 키로 대신 부른다.
// PC 뷰어에 키를 직접 넣어 둔 경우에만 그 브라우저에서 바로 부른다.

/** 등급 기준이나 지시문을 바꾸면 이 값을 올려서 결과를 구분한다 (v3: 덮개·주변 중 더 심한 쪽 + 신고 표시, 주변 범위 20%) */
export const PROMPT_VERSION = 'v3'

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
    unusable: { type: 'BOOLEAN', description: '흐리거나 너무 멀어서 쓰레기 양을 알 수 없으면 true' },
    grate_percent: { type: 'INTEGER', description: '빨간 박스 안(덮개)을 쓰레기·낙엽·흙·고무판 등이 위에서 가린 비율(0~100)' },
    around_percent: { type: 'INTEGER', description: '빨간 박스 바깥 주변을 쓰레기·낙엽·흙이 덮은 비율(0~100)' },
    grade: { type: 'INTEGER', description: '쓰레기 등급 0~4. 두 비율 중 큰 값으로 정한다' },
    needs_report: { type: 'BOOLEAN', description: '덮개 아래(틈으로 보이는 안쪽)에 쓰레기가 쌓여 지자체 신고가 필요하면 true' },
    confidence: { type: 'NUMBER', description: '이 판정을 얼마나 확신하는지 0~1' },
    causes: { type: 'ARRAY', items: { type: 'STRING', enum: [...CAUSES] }, description: '쌓인 쓰레기의 종류' },
    reason: { type: 'STRING', description: '판정 이유 한 문장' },
  },
  required: ['is_drain', 'unusable', 'grate_percent', 'around_percent', 'grade', 'needs_report', 'confidence', 'causes', 'reason'],
  propertyOrdering: ['is_drain', 'unusable', 'grate_percent', 'around_percent', 'grade', 'needs_report', 'confidence', 'causes', 'reason'],
}

/** 사람에게 보여 주는 등급 기준과 같은 문장을 그대로 쓴다 */
function instruction(): string {
  return [
    '너는 빗물받이 덮개와 그 주변에 쓰레기가 얼마나 쌓였는지 판정한다.',
    '사진은 빗물받이(빨간 박스)와 그 주변을 잘라 낸 것이다. 사진 전체가 사람이 보는 흰 점선 범위와 같다.',
    '등급 기준:',
    ...GRADES.map((g) => `- ${g.value}등급(${g.short}): ${g.desc}`),
    `- 판단 불가: ${UNUSABLE.desc}. 이때 unusable=true 로 답한다.`,
    `- 신고 필요(등급과 별개): ${REPORT.desc}. 이때 needs_report=true 로 답한다.`,
    '규칙:',
    ...GRADE_RULES.map((r) => `- ${r}`),
    'grate_percent 는 빨간 박스 안(덮개) 면적 중 쓰레기·낙엽·흙·담배꽁초·고무판 등이 위에서 가린 비율이다. 덮개 틈으로 보이는 아래 안쪽에 쌓인 것은 넣지 않는다.',
    'around_percent 는 빨간 박스 바깥(사진에서 빨간 박스를 뺀 나머지) 면적 중 쓰레기·낙엽·흙이 덮은 비율이다.',
    'grade 는 grate_percent 와 around_percent 중 큰 값을 위 등급 기준의 비율에 맞춰 정한다.',
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

/** 원본(W×H)에서 빨간 박스 + 주변(흰 점선 범위)만 잘라 내고 박스를 그려서 base64 JPEG 로 만든다 */
export function cropForAi(src: CanvasImageSource, W: number, H: number, box: Box): string {
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
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#ff0000'
  ctx.lineWidth = Math.max(2, Math.round(canvas.width / 200))
  ctx.strokeRect((box.x * W - sx) * scale, (box.y * H - sy) * scale, box.w * W * scale, box.h * H * scale)
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
}

/** 저장소에 올라간 사진을 받아서 AI 용으로 자른다 (PC 뷰어) */
export async function prepareImage(photo: PhotoRow, url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`사진을 받지 못했습니다 (${res.status})`)
  const bmp = await createImageBitmap(await res.blob())
  try {
    return cropForAi(bmp, bmp.width, bmp.height, rowBox(photo))
  } finally {
    bmp.close()
  }
}

export type AiResult = {
  is_drain: boolean
  unusable: boolean
  grate_percent: number
  around_percent: number
  grade: number | null
  needs_report: boolean
  confidence: number
  causes: string[]
  reason: string
}

/** AI 가 답한 쓰레기 비율. v3부터는 덮개·주변을 따로, 그 전 실행은 흰 점선 전체 비율 하나 */
export function areaText(r: { grate_percent: number | null; around_percent: number | null; covered_percent?: number | null }): string {
  if (r.grate_percent != null || r.around_percent != null) return `덮개 ${r.grate_percent ?? '-'}% · 주변 ${r.around_percent ?? '-'}%`
  return `쓰레기 면적 ${r.covered_percent ?? '-'}%`
}

/** fatal 이면 다음 사진도 같은 이유로 실패하므로 실행을 멈춘다 */
export class AiError extends Error {
  constructor(message: string, readonly fatal = false) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** key 를 주면 Gemini 를 바로 부르고, 없으면 Supabase 서버 함수를 거친다 */
async function send(model: string, payload: object, key?: string): Promise<Response> {
  if (key) {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
    })
  }
  const { data } = await sb().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AiError('로그인이 끊겼습니다. 다시 로그인해 주세요.', true)
  return fetch(functionUrl(CONFIG.ai.functionName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY },
    body: JSON.stringify({ model, ...payload }),
  })
}

/** 결과와 함께, 성공한 요청 한 번에 걸린 시간(한도 대기 제외)을 돌려준다 */
export async function callAi(
  model: string,
  parts: unknown[],
  opts: { key?: string; onWait?: (sec: number) => void } = {},
): Promise<{ result: AiResult; latencyMs: number }> {
  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    const t0 = performance.now()
    try {
      res = await send(model, payload, opts.key)
    } catch (err) {
      if (err instanceof AiError) throw err
      // 서버 함수가 없거나 이름이 다르면 브라우저가 응답을 막아서(CORS) 상태 코드 없이 여기로 온다
      if (!opts.key) {
        throw new AiError(
          `AI 서버 함수(${CONFIG.ai.functionName})에 연결하지 못했습니다. 인터넷 연결과, Supabase 에 이 이름으로 함수가 배포됐는지 확인해 주세요.`,
          true,
        )
      }
      throw new AiError('AI에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    }
    const body = await res.json().catch(() => null)
    if (res.status === 429 && attempt < CONFIG.ai.maxRetries) {
      const sec = retrySeconds(body) ?? 30 * (attempt + 1)
      opts.onWait?.(sec)
      await sleep(sec * 1000)
      continue
    }
    if (!res.ok) throw responseError(res.status, body, Boolean(opts.key))
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

type ErrorBody = { error?: { message?: string; source?: string }; message?: string; msg?: string } | null

function responseError(status: number, body: ErrorBody, direct: boolean): AiError {
  const fromFunction = body?.error?.source === 'function'
  const geminiMsg = !fromFunction ? body?.error?.message : undefined
  // 서버 함수 자체의 오류 (로그인, 키 비밀값 없음 등)
  if (fromFunction) return new AiError(`서버 함수: ${body?.error?.message}`, true)
  // Supabase 가 함수에 닿기 전에 막은 경우
  if (!direct && !geminiMsg) {
    const msg = body?.message ?? body?.msg ?? `HTTP ${status}`
    if (status === 404) return new AiError('서버 함수(grade-photo)가 아직 없습니다. Supabase 에 배포했는지 확인해 주세요.', true)
    if (status === 401 || status === 403) return new AiError(`서버 함수 접근이 막혔습니다: ${msg}. 다시 로그인해 보세요.`, true)
    return new AiError(`서버 함수 오류 (${status}): ${msg}`, status < 500)
  }
  const msg = geminiMsg ?? `HTTP ${status}`
  const fatal = [400, 401, 403, 404, 429].includes(status)
  if (status === 400 && /api key/i.test(msg)) return new AiError('API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.', true)
  if (status === 403) return new AiError(`이 키로는 이 모델을 쓸 수 없습니다: ${msg}`, true)
  if (status === 404) return new AiError(`모델을 찾지 못했습니다. 다른 모델을 골라 주세요: ${msg}`, true)
  if (status === 429) return new AiError('무료 한도에 걸렸습니다. 요청 간격을 늘리거나, 오늘 한도가 끝났다면 내일 다시 시도해 주세요.', true)
  if (status >= 500) return new AiError(`Gemini 서버 오류입니다 (${status}). 잠시 뒤 다시 시도해 주세요.`)
  return new AiError(`Gemini 오류 (${status}): ${msg}`, fatal)
}

/** 저장된 AI 판정을 Gemini 가 답한 JSON 모양 그대로 다시 보여 준다 (값은 저장 전에 범위를 정리한 것) */
export function answerJson(r: AiGradeRow): string {
  const area =
    r.grate_percent != null || r.around_percent != null
      ? { grate_percent: r.grate_percent, around_percent: r.around_percent }
      : { covered_percent: r.covered_percent }
  return JSON.stringify(
    {
      is_drain: r.is_drain,
      unusable: r.unusable,
      ...area,
      grade: r.grade,
      needs_report: r.needs_report,
      confidence: r.confidence,
      causes: r.causes,
      reason: r.reason,
    },
    null,
    2,
  )
}

/** 모델이 형식을 조금 벗어나도 저장할 수 있게 값을 정리한다 */
function normalize(raw: Record<string, unknown>): AiResult {
  const isDrain = raw.is_drain !== false
  const unusable = raw.unusable === true || !isDrain
  const gradeNum = Math.round(Number(raw.grade))
  const grade = unusable || !Number.isFinite(gradeNum) ? null : Math.min(4, Math.max(0, gradeNum))
  const pct = (v: unknown) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
  }
  const conf = Number(raw.confidence)
  return {
    is_drain: isDrain,
    unusable: unusable || grade === null,
    grate_percent: pct(raw.grate_percent),
    around_percent: pct(raw.around_percent),
    grade,
    needs_report: raw.needs_report === true,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    causes: Array.isArray(raw.causes) ? raw.causes.map(String).slice(0, 7) : [],
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '',
  }
}

/** 폰에서 찍고 바로 채점한 결과는 모델·기준 버전마다 실행 하나에 계속 쌓는다 */
export function fieldRunId(model: string): string {
  return `field-${model}-${PROMPT_VERSION}`
}

export async function ensureFieldRun(model: string, name: string) {
  const modelName = CONFIG.ai.models.find((m) => m.id === model)?.label.split(' (')[0] ?? model
  const { error } = await sb()
    .from('ai_runs')
    .upsert(
      {
        run_id: fieldRunId(model),
        label: `현장 즉시 채점 · ${modelName} · 기준 ${PROMPT_VERSION}`,
        model,
        mode: 'zero',
        prompt_version: PROMPT_VERSION,
        example_ids: [],
        created_by: name,
      },
      { onConflict: 'run_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

export function toAiRow(runId: string, photoId: string, r: AiResult, latencyMs: number): AiGradeRow {
  return {
    run_id: runId,
    photo_id: photoId,
    grade: r.grade,
    unusable: r.unusable,
    needs_report: r.needs_report,
    is_drain: r.is_drain,
    grate_percent: r.grate_percent,
    around_percent: r.around_percent,
    covered_percent: Math.max(r.grate_percent, r.around_percent),
    confidence: r.confidence,
    causes: r.causes,
    reason: r.reason,
    latency_ms: latencyMs,
  }
}
