import { Fragment, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { sb } from '../shared/supabase'
import { PHASE_LABEL, type AiGradeRow, type AiMode, type AiRunRow, type GradeRow, type PhotoRow } from '../shared/types'
import { downloadCsv, errorText, getSignedUrl, today, toCsv, useSignedUrls, type AiData } from './data'
import { AiError, answerJson, buildParts, callGemini, loadKey, maskKey, prepareImage, PROMPT_VERSION, saveKey, type Example } from './gemini'
import { catOf, compare, humanTruth, pct, type Truth } from './metrics'
import { ConfusionTable, Stat } from './ui'

type Props = {
  /** 연습용 포함 전체 사진 (여기서 연습용을 뺀다) */
  photos: PhotoRow[]
  grades: GradeRow[]
  name: string
  onSelect: (id: string) => void
  ai: AiData
}

type Target = 'agreed' | 'truth' | 'all'
const TARGETS: { value: Target; label: string }[] = [
  { value: 'agreed', label: '두 사람 이상 등급이 같은 사진 (정답지)' },
  { value: 'truth', label: '사람 등급이 있는 사진 (1명이 매긴 것 포함)' },
  { value: 'all', label: '연습용을 뺀 모든 사진' },
]
const MODES: { value: AiMode; label: string }[] = [
  { value: 'zero', label: '등급 기준 문장만 보냄' },
  { value: 'few', label: '등급별 예시 사진 1장씩 함께 보냄 (예시 사진은 채점에서 빠짐)' },
]

type ExamplePick = { photo: PhotoRow; grade: number }
/** 한 번 돌릴 일. 새 실행이면 ai_runs 에 줄을 만들고, 이어서 하기면 기존 실행에 결과를 더한다 */
type Job = { runId: string; isNew: boolean; label: string; model: string; mode: AiMode; list: PhotoRow[]; examples: ExamplePick[] }

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** Gemini 로 사진 등급을 매기고, 사람 정답과 얼마나 같은지 본다 */
export function AiView({ photos, grades, name, onSelect, ai }: Props) {
  const real = useMemo(
    () => photos.filter((p) => !p.is_test).sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
    [photos],
  )
  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const { truth, conflicted } = useMemo(() => {
    const ids = new Set(real.map((p) => p.id))
    return humanTruth(grades.filter((g) => ids.has(g.photo_id)))
  }, [grades, real])
  const agreedCount = [...truth.values()].filter((t) => t.raters >= 2).length

  const [key, setKey] = useState(loadKey)
  const [keyDraft, setKeyDraft] = useState('')
  const [model, setModel] = useState<string>(CONFIG.ai.models[0].id)
  const [mode, setMode] = useState<AiMode>('zero')
  const [target, setTarget] = useState<Target>('agreed')
  const [maxCount, setMaxCount] = useState('')
  const [intervalSec, setIntervalSec] = useState<number>(CONFIG.ai.intervalSec)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0, message: '' })
  const stopRef = useRef(false)

  const [runId, setRunId] = useState('')
  const [onlyAgreed, setOnlyAgreed] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const max = Number(maxCount) > 0 ? Math.floor(Number(maxCount)) : Infinity

  // 대상 조건에 맞는 사진 (오래된 순)
  const targetList = useMemo(
    () =>
      real.filter((p) => {
        if (target === 'all') return true
        const t = truth.get(p.id)
        return target === 'truth' ? Boolean(t) : (t?.raters ?? 0) >= 2
      }),
    [real, truth, target],
  )

  // 새로 돌릴 때: 예시 사진(등급별 1장, 두 사람 일치 우선)을 고르고 나머지에서 최대 장수만큼
  const plan = useMemo(() => {
    const examples: ExamplePick[] = []
    if (mode === 'few') {
      const pool = real
        .filter((p) => {
          const t = truth.get(p.id)
          return t && t.cat !== 'X'
        })
        .sort((a, b) => truth.get(b.id)!.raters - truth.get(a.id)!.raters)
      for (const g of [0, 1, 2, 3, 4]) {
        const ex = pool.find((p) => truth.get(p.id)!.cat === String(g))
        if (ex) examples.push({ photo: ex, grade: g })
      }
    }
    const exIds = new Set(examples.map((e) => e.photo.id))
    const all = targetList.filter((p) => !exIds.has(p.id))
    return { examples, all, list: all.slice(0, max) }
  }, [real, truth, targetList, mode, max])

  // 결과에서 고른 실행
  const selected = ai.runs.find((r) => r.run_id === runId) ?? ai.runs[0]
  const runRows = useMemo(() => ai.aiRows.filter((r) => r.run_id === selected?.run_id), [ai.aiRows, selected])

  // 이어서 하기: 그 실행이 아직 안 매긴 사진을, 지금 고른 대상·최대 장수 기준으로
  const continuePlan = useMemo(() => {
    if (!selected) return null
    const done = new Set(runRows.map((r) => r.photo_id))
    const exIds = new Set(selected.example_ids)
    const examples = selected.example_ids
      .map((id) => photoById.get(id))
      .filter((p): p is PhotoRow => Boolean(p))
      .map((p) => ({ photo: p, grade: Number(truth.get(p.id)?.cat) }))
      .filter((e) => Number.isInteger(e.grade))
    const rest = targetList.filter((p) => !done.has(p.id) && !exIds.has(p.id))
    return { examples, rest, list: rest.slice(0, max) }
  }, [selected, runRows, photoById, truth, targetList, max])

  const execute = async (job: Job) => {
    if (!key || running || !job.list.length) return
    stopRef.current = false
    setRunning(true)
    setConfirmDelete(false)
    setProgress({ done: 0, total: job.list.length, errors: 0, message: '' })
    let errors = 0
    let saved = 0
    let created = false
    try {
      const exData: Example[] = []
      for (const ex of job.examples) {
        exData.push({ grade: ex.grade, data: await prepareImage(ex.photo, await getSignedUrl(ex.photo.storage_path)) })
      }
      if (job.isNew) {
        const run: AiRunRow = {
          run_id: job.runId,
          label: job.label,
          model: job.model,
          mode: job.mode,
          prompt_version: PROMPT_VERSION,
          example_ids: job.examples.map((e) => e.photo.id),
          created_by: name,
        }
        const ins = await sb().from('ai_runs').insert(run)
        if (ins.error) throw ins.error
        created = true
        ai.setRuns((rs) => [run, ...rs])
      }
      setRunId(job.runId)

      for (let i = 0; i < job.list.length; i++) {
        if (stopRef.current) break
        const p = job.list[i]
        try {
          const img = await prepareImage(p, await getSignedUrl(p.storage_path))
          const { result: r, latencyMs } = await callGemini(key, job.model, buildParts(img, exData), (sec) =>
            setProgress((s) => ({ ...s, message: `무료 한도에 걸려 ${sec}초 기다렸다가 다시 보냅니다…` })),
          )
          const row: AiGradeRow = {
            run_id: job.runId,
            photo_id: p.id,
            grade: r.grade,
            unusable: r.unusable,
            is_drain: r.is_drain,
            covered_percent: r.covered_percent,
            confidence: r.confidence,
            causes: r.causes,
            reason: r.reason,
            latency_ms: latencyMs,
          }
          const up = await sb().from('ai_grades').upsert(row)
          if (up.error) throw up.error
          saved++
          ai.setAiRows((rows) => [...rows.filter((x) => !(x.run_id === row.run_id && x.photo_id === row.photo_id)), row])
          setProgress((s) => ({ ...s, done: i + 1, message: '' }))
        } catch (err) {
          errors++
          const msg = err instanceof AiError ? err.message : errorText(err)
          setProgress((s) => ({ ...s, done: i + 1, errors, message: msg }))
          if (err instanceof AiError && err.fatal) break
        }
        if (i < job.list.length - 1 && !stopRef.current) await sleep(intervalSec * 1000)
      }
    } catch (err) {
      setProgress((s) => ({ ...s, message: errorText(err) }))
    } finally {
      // 한 장도 못 매긴 새 실행(키 오류 등)은 결과 목록에 남기지 않는다
      if (created && saved === 0) {
        await sb().from('ai_runs').delete().eq('run_id', job.runId)
        setRunId('')
      }
      setRunning(false)
      void ai.reload()
    }
  }

  const startNew = () => {
    const modelName = CONFIG.ai.models.find((m) => m.id === model)?.label.split(' (')[0] ?? model
    const when = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    void execute({
      runId: `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 6)}`,
      isNew: true,
      label: `${when} · ${modelName} · ${mode === 'zero' ? '기준 문장만' : `예시 ${plan.examples.length}장`}`,
      model,
      mode,
      list: plan.list,
      examples: plan.examples,
    })
  }

  const continueSelected = () => {
    if (!selected || !continuePlan) return
    void execute({
      runId: selected.run_id,
      isNew: false,
      label: selected.label,
      model: selected.model,
      mode: selected.mode,
      list: continuePlan.list,
      examples: continuePlan.examples,
    })
  }

  // 결과 지표
  const compared = runRows.filter((r) => {
    const t = truth.get(r.photo_id)
    return t && (!onlyAgreed || t.raters >= 2)
  })
  const stats = compare(compared.map((r) => ({ a: truth.get(r.photo_id)!.cat, b: catOf(r.grade, r.unusable) })))
  const needReview = runRows.filter((r) => r.unusable || (r.confidence ?? 0) < CONFIG.ai.reviewConfidence).length
  const avgSec = runRows.length ? runRows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / runRows.length / 1000 : null

  const exportRun = () => {
    if (!selected) return
    const rows = runRows.map((r) => {
      const p = photoById.get(r.photo_id)
      const t = truth.get(r.photo_id)
      return [
        r.photo_id, p?.drain_code, p ? PHASE_LABEL[p.phase] : '', t?.cat ?? '', t?.raters ?? 0,
        r.grade, r.unusable, r.covered_percent, r.confidence, (r.causes ?? []).join('|'), r.reason, r.latency_ms,
      ]
    })
    downloadCsv(
      `AI채점_${today()}_${selected.model}.csv`,
      toCsv(['photo_id', '빗물받이번호', '단계', '사람정답', '매긴사람수', 'AI등급', 'AI판단불가', '가려진비율', '확신도', '원인', '이유', '응답ms'], rows),
    )
  }

  const removeRun = async () => {
    if (!selected) return
    if (!confirmDelete) return setConfirmDelete(true)
    const { error } = await sb().from('ai_runs').delete().eq('run_id', selected.run_id)
    setConfirmDelete(false)
    if (error) return setProgress((s) => ({ ...s, message: errorText(error) }))
    setRunId('')
    void ai.reload()
  }

  const minutes = Math.ceil((plan.list.length * (intervalSec + 3)) / 60)

  return (
    <div className="space-y-4 p-4">
      {ai.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{ai.error}</p>}

      <section className="space-y-2 rounded-lg border border-gray-200 p-3">
        <p className="font-semibold text-gray-900">Gemini API 키</p>
        {key ? (
          <div className="flex items-center gap-3">
            <span className="text-gray-800">저장된 키 {maskKey(key)} (이 PC 브라우저에만 저장)</span>
            <button
              onClick={() => {
                saveKey('')
                setKey('')
              }}
              disabled={running}
              className="h-8 rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40"
            >
              키 지우기
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              autoComplete="off"
              placeholder="Google AI Studio 에서 만든 키"
              className="h-9 w-80 rounded-md border border-gray-300 px-2"
            />
            <button
              onClick={() => {
                saveKey(keyDraft)
                setKey(keyDraft.trim())
                setKeyDraft('')
              }}
              disabled={!keyDraft.trim()}
              className="h-9 rounded-md bg-blue-600 px-3 font-semibold text-white disabled:bg-gray-300"
            >
              저장
            </button>
            <a href={CONFIG.ai.keyPageUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              키 만들기 (Google AI Studio)
            </a>
          </div>
        )}
        <p className="text-gray-700">
          키는 서버나 GitHub에 올라가지 않습니다. 무료 구간에 보낸 사진은 구글 제품 개선에 쓰일 수 있으니, 사람 얼굴·차량 번호판이 나온 사진은
          연습용으로 바꿔 빼 주세요.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 p-3">
        <p className="font-semibold text-gray-900">새로 채점하기</p>
        <div className="grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-2">
          <span className="text-gray-700">모델</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running} className="h-9 rounded-md border border-gray-300 px-2">
            {CONFIG.ai.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-gray-700">방식</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as AiMode)} disabled={running} className="h-9 rounded-md border border-gray-300 px-2">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-gray-700">대상</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as Target)} disabled={running} className="h-9 rounded-md border border-gray-300 px-2">
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="text-gray-700">최대 장수</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
              disabled={running}
              placeholder="전부"
              className="h-9 w-24 rounded-md border border-gray-300 px-2"
            />
            장 · 한 번에 이만큼만 보냅니다(사진 1장 = 요청 1번). 하루 한도가 작은 모델은 나눠서 '이어서 채점'하세요
          </span>
          <span className="text-gray-700">요청 간격</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={60}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Math.max(0, Number(e.target.value) || 0))}
              disabled={running}
              className="h-9 w-20 rounded-md border border-gray-300 px-2"
            />
            초 · 무료 한도는
            <a href={CONFIG.ai.rateLimitUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              AI Studio
            </a>
            에서 확인
          </span>
        </div>

        <p className="text-gray-800">
          사람 정답: 두 사람 이상 일치 {agreedCount}장 · 한 사람만 매김 {truth.size - agreedCount}장 · 사람끼리 다름 {conflicted.size}장
        </p>
        <p className="text-gray-800">
          조건에 맞는 사진 {plan.all.length}장 중 이번에 {plan.list.length}장{plan.list.length > 0 && ` · 예상 약 ${minutes}분`}
          {mode === 'few' &&
            (plan.examples.length
              ? ` · 예시: ${plan.examples.map((e) => `${e.grade}등급 ${e.photo.drain_code}`).join(', ')}`
              : ' · 예시로 쓸 사람 정답 사진이 아직 없습니다')}
        </p>

        <div className="flex items-center gap-3">
          {running ? (
            <button onClick={() => (stopRef.current = true)} className="h-9 rounded-md bg-gray-900 px-4 font-semibold text-white">
              멈춤
            </button>
          ) : (
            <button
              onClick={startNew}
              disabled={!key || !plan.list.length || (mode === 'few' && !plan.examples.length)}
              className="h-9 rounded-md bg-blue-600 px-4 font-semibold text-white disabled:bg-gray-300"
            >
              AI 채점 시작
            </button>
          )}
          {progress.total > 0 && (
            <span className="text-gray-800">
              {progress.done} / {progress.total}장{progress.errors > 0 && ` · 실패 ${progress.errors}장`}
              {running ? ' · 진행 중' : ' · 끝남'}
            </span>
          )}
        </div>
        {progress.total > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-600" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
        {progress.message && <p className="rounded-md bg-amber-50 px-3 py-2 text-gray-900">{progress.message}</p>}
        {!key && <p className="text-gray-700">먼저 위에서 API 키를 저장해 주세요.</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-gray-900">결과</p>
          {ai.runs.length > 0 && (
            <select
              value={selected?.run_id ?? ''}
              onChange={(e) => {
                setRunId(e.target.value)
                setConfirmDelete(false)
              }}
              disabled={running}
              className="h-9 rounded-md border border-gray-300 px-2"
            >
              {ai.runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.label} · {r.created_by}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-gray-800">
            <input type="checkbox" checked={onlyAgreed} onChange={(e) => setOnlyAgreed(e.target.checked)} />
            두 사람 이상 일치한 사진만 비교
          </label>
          {selected && (
            <span className="ml-auto flex gap-2">
              <button onClick={exportRun} disabled={!runRows.length} className="h-9 rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40">
                이 결과 CSV
              </button>
              <button
                onClick={() => void removeRun()}
                disabled={running}
                className={`h-9 rounded-md px-3 font-medium ${confirmDelete ? 'bg-red-600 text-white' : 'border border-red-300 text-red-700'}`}
              >
                {confirmDelete ? '한 번 더 누르면 지워집니다' : '이 결과 삭제'}
              </button>
            </span>
          )}
        </div>

        {!selected ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-gray-700">아직 AI로 채점한 기록이 없습니다.</p>
        ) : (
          <>
            {continuePlan && (
              <div className="flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2">
                <span className="text-gray-800">
                  이 실행이 아직 안 매긴 사진 {continuePlan.rest.length}장 (위의 '대상' 기준)
                  {selected.prompt_version !== PROMPT_VERSION && ` · 이 실행은 이전 지시문(${selected.prompt_version})으로 시작했습니다`}
                </span>
                <button
                  onClick={continueSelected}
                  disabled={running || !key || !continuePlan.list.length || (selected.mode === 'few' && !continuePlan.examples.length)}
                  className="h-9 rounded-md bg-gray-900 px-3 font-semibold text-white disabled:bg-gray-300"
                >
                  {continuePlan.list.length}장 이어서 채점
                </button>
                <span className="text-gray-700">모델·방식은 이 실행 그대로, 최대 장수는 위의 값</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Stat label="AI가 매긴 사진" value={`${runRows.length}장`} hint={`사람 정답과 비교한 사진 ${stats.n}장`} />
              <Stat
                label="완전 일치"
                value={stats.n ? `${stats.agree}장 (${pct(stats.agree, stats.n)})` : '-'}
                hint={`기획안 목표 ${Math.round(CONFIG.ai.goalAgreement * 100)}%`}
              />
              <Stat label="±1 등급 이내" value={pct(stats.within1, stats.numeric)} hint="판단 불가 제외" />
              <Stat label="코언 카파" value={stats.kappa === null ? '-' : stats.kappa.toFixed(2)} hint="우연히 맞을 확률을 뺀 일치도" />
              <Stat
                label="사람이 다시 볼 사진"
                value={runRows.length ? `${needReview}장 (${pct(needReview, runRows.length)})` : '-'}
                hint={`확신도 ${CONFIG.ai.reviewConfidence} 미만이거나 판단 불가`}
              />
              <Stat label="평균 응답 시간" value={avgSec === null ? '-' : `${avgSec.toFixed(1)}초`} />
            </div>
            {stats.n > 0 ? (
              <ConfusionTable matrix={stats.matrix} rowLabel="사람 정답" colLabel="AI" />
            ) : (
              <p className="text-gray-700">
                비교할 사람 정답이 없습니다. 등급 매기기 탭에서 사람이 먼저 매기거나, 위의 '두 사람 이상 일치한 사진만 비교'를 꺼 보세요.
              </p>
            )}
            <AnswerTable rows={runRows} photoById={photoById} truth={truth} conflicted={conflicted} onSelect={onSelect} />
          </>
        )}
      </section>
    </div>
  )
}

type Filter = 'all' | 'miss' | 'review'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'miss', label: '사람과 다른 것' },
  { value: 'review', label: '다시 볼 것' },
]

/** 사진마다 AI 가 답한 내용 전부. JSON 버튼을 누르면 Gemini 답 모양 그대로 보인다 */
function AnswerTable({
  rows,
  photoById,
  truth,
  conflicted,
  onSelect,
}: {
  rows: AiGradeRow[]
  photoById: Map<string, PhotoRow>
  truth: Map<string, Truth>
  conflicted: Set<string>
  onSelect: (id: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = rows
    .filter((r) => {
      const t = truth.get(r.photo_id)
      if (filter === 'miss') return Boolean(t) && t!.cat !== catOf(r.grade, r.unusable)
      if (filter === 'review') return r.unusable || (r.confidence ?? 0) < CONFIG.ai.reviewConfidence
      return true
    })
    .sort((a, b) => (photoById.get(a.photo_id)?.taken_at ?? '').localeCompare(photoById.get(b.photo_id)?.taken_at ?? ''))
  const urls = useSignedUrls(list.slice(0, 200).map((r) => photoById.get(r.photo_id)?.thumb_path ?? '').filter(Boolean))

  const humanText = (id: string) => {
    const t = truth.get(id)
    if (t) return `${t.cat === 'X' ? '판단 불가' : `${t.cat}등급`}${t.raters < 2 ? ' (1명)' : ''}`
    return conflicted.has(id) ? '사람끼리 다름' : '-'
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-semibold text-gray-900">AI 답 전체 {rows.length}장</p>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`h-8 rounded-full border px-3 ${filter === f.value ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-gray-300 text-gray-800'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-700">해당하는 사진이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-300 text-gray-700">
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">사진</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">번호·단계</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">사람</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">AI</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">가려짐</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">확신도</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">원인</th>
                <th className="whitespace-nowrap py-1.5 pr-2 font-medium">이유</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const p = photoById.get(r.photo_id)
                const t = truth.get(r.photo_id)
                const miss = Boolean(t) && t!.cat !== catOf(r.grade, r.unusable)
                const low = r.unusable || (r.confidence ?? 0) < CONFIG.ai.reviewConfidence
                const open = openId === r.photo_id
                return (
                  <Fragment key={r.photo_id}>
                    <tr className="border-b border-gray-200 align-top">
                      <td className="py-1.5 pr-2">
                        <button onClick={() => p && onSelect(p.id)} className="block h-14 w-14 overflow-hidden rounded bg-gray-100">
                          {p && urls[p.thumb_path] && <img src={urls[p.thumb_path]} alt="" className="h-full w-full object-cover" />}
                        </button>
                      </td>
                      <td className="min-w-[110px] py-1.5 pr-2">
                        <button onClick={() => p && onSelect(p.id)} className="text-left font-semibold text-gray-900 hover:underline">
                          {p ? `${p.drain_code} · ${PHASE_LABEL[p.phase]}` : '(지워진 사진)'}
                        </button>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-gray-800">{humanText(r.photo_id)}</td>
                      <td className={`whitespace-nowrap py-1.5 pr-2 ${miss ? 'font-semibold text-red-700' : 'text-gray-900'}`}>{gradeText(r.grade, r.unusable)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-gray-800">{r.covered_percent ?? '-'}%</td>
                      <td className={`whitespace-nowrap py-1.5 pr-2 ${low ? 'font-semibold text-amber-800' : 'text-gray-800'}`}>{r.confidence?.toFixed(2) ?? '-'}</td>
                      <td className="py-1.5 pr-2 text-gray-800">{(r.causes ?? []).join(', ') || '-'}</td>
                      <td className="max-w-[320px] py-1.5 pr-2 text-gray-800">{r.reason || '-'}</td>
                      <td className="py-1.5">
                        <button onClick={() => setOpenId(open ? null : r.photo_id)} className="h-7 whitespace-nowrap rounded border border-gray-300 px-2 text-xs font-medium">
                          {open ? '닫기' : 'JSON'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-gray-200">
                        <td colSpan={9} className="pb-2">
                          <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-900">{answerJson(r)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
