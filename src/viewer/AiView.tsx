import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { sb } from '../shared/supabase'
import { PHASE_LABEL, type AiGradeRow, type AiMode, type AiRunRow, type GradeRow, type PhotoRow } from '../shared/types'
import { downloadCsv, errorText, getSignedUrl, today, toCsv, useSignedUrls } from './data'
import { AiError, buildParts, callGemini, loadKey, maskKey, prepareImage, PROMPT_VERSION, saveKey, type Example } from './gemini'
import { catOf, compare, humanTruth, pct } from './metrics'
import { ConfusionTable, Stat } from './ui'

type Props = {
  /** 연습용 포함 전체 사진 (여기서 연습용을 뺀다) */
  photos: PhotoRow[]
  grades: GradeRow[]
  name: string
  onSelect: (id: string) => void
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

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** Gemini 로 사진 등급을 매기고, 사람 정답과 얼마나 같은지 본다 */
export function AiView({ photos, grades, name, onSelect }: Props) {
  const real = useMemo(
    () => photos.filter((p) => !p.is_test).sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
    [photos],
  )
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
  const [intervalSec, setIntervalSec] = useState<number>(CONFIG.ai.intervalSec)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0, message: '' })
  const stopRef = useRef(false)

  const [runs, setRuns] = useState<AiRunRow[]>([])
  const [aiRows, setAiRows] = useState<AiGradeRow[]>([])
  const [runId, setRunId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [onlyAgreed, setOnlyAgreed] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const [r, g] = await Promise.all([
      sb().from('ai_runs').select('*').order('created_at', { ascending: false }),
      sb().from('ai_grades').select('*'),
    ])
    if (r.error || g.error) {
      setLoadError(errorText(r.error ?? g.error))
      return
    }
    setLoadError('')
    setRuns((r.data ?? []) as AiRunRow[])
    setAiRows((g.data ?? []) as AiGradeRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 이번에 채점할 사진과 예시 사진
  const plan = useMemo(() => {
    let list = real.filter((p) => {
      if (target === 'all') return true
      const t = truth.get(p.id)
      return target === 'truth' ? Boolean(t) : (t?.raters ?? 0) >= 2
    })
    const examples: { photo: PhotoRow; grade: number }[] = []
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
      const exIds = new Set(examples.map((e) => e.photo.id))
      list = list.filter((p) => !exIds.has(p.id))
    }
    return { list, examples }
  }, [real, truth, target, mode])

  const start = async () => {
    if (!key || running || !plan.list.length) return
    const { list, examples } = plan
    stopRef.current = false
    setRunning(true)
    setConfirmDelete(false)
    setProgress({ done: 0, total: list.length, errors: 0, message: '' })
    const newRunId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 6)}`
    const modelName = CONFIG.ai.models.find((m) => m.id === model)?.label.split(' (')[0] ?? model
    const when = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const label = `${when} · ${modelName} · ${mode === 'zero' ? '기준 문장만' : `예시 ${examples.length}장`}`
    let errors = 0
    let saved = 0
    let created = false
    try {
      const exData: Example[] = []
      for (const ex of examples) {
        exData.push({ grade: ex.grade, data: await prepareImage(ex.photo, await getSignedUrl(ex.photo.storage_path)) })
      }
      const ins = await sb()
        .from('ai_runs')
        .insert({ run_id: newRunId, label, model, mode, prompt_version: PROMPT_VERSION, example_ids: examples.map((e) => e.photo.id), created_by: name })
      if (ins.error) throw ins.error
      created = true
      setRunId(newRunId)
      setRuns((rs) => [{ run_id: newRunId, label, model, mode, prompt_version: PROMPT_VERSION, example_ids: examples.map((e) => e.photo.id), created_by: name }, ...rs])

      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) break
        const p = list[i]
        try {
          const img = await prepareImage(p, await getSignedUrl(p.storage_path))
          const { result: r, latencyMs } = await callGemini(key, model, buildParts(img, exData), (sec) =>
            setProgress((s) => ({ ...s, message: `무료 한도에 걸려 ${sec}초 기다렸다가 다시 보냅니다…` })),
          )
          const row: AiGradeRow = {
            run_id: newRunId,
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
          setAiRows((rows) => [...rows.filter((x) => !(x.run_id === row.run_id && x.photo_id === row.photo_id)), row])
          setProgress((s) => ({ ...s, done: i + 1, message: '' }))
        } catch (err) {
          errors++
          const msg = err instanceof AiError ? err.message : errorText(err)
          setProgress((s) => ({ ...s, done: i + 1, errors, message: msg }))
          if (err instanceof AiError && err.fatal) break
        }
        if (i < list.length - 1 && !stopRef.current) await sleep(intervalSec * 1000)
      }
    } catch (err) {
      setProgress((s) => ({ ...s, message: errorText(err) }))
    } finally {
      // 한 장도 못 매긴 실행(키 오류 등)은 결과 목록에 남기지 않는다
      if (created && saved === 0) {
        await sb().from('ai_runs').delete().eq('run_id', newRunId)
        setRunId('')
      }
      setRunning(false)
      void load()
    }
  }

  // 결과
  const selected = runs.find((r) => r.run_id === runId) ?? runs[0]
  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const runRows = useMemo(() => aiRows.filter((r) => r.run_id === selected?.run_id), [aiRows, selected])
  const compared = runRows.filter((r) => {
    const t = truth.get(r.photo_id)
    return t && (!onlyAgreed || t.raters >= 2)
  })
  const stats = compare(compared.map((r) => ({ a: truth.get(r.photo_id)!.cat, b: catOf(r.grade, r.unusable) })))
  const needReview = runRows.filter((r) => r.unusable || (r.confidence ?? 0) < CONFIG.ai.reviewConfidence).length
  const avgSec = runRows.length ? runRows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / runRows.length / 1000 : null
  const misses = compared.filter((r) => truth.get(r.photo_id)!.cat !== catOf(r.grade, r.unusable))
  const urls = useSignedUrls(misses.slice(0, 60).map((r) => photoById.get(r.photo_id)?.thumb_path ?? '').filter(Boolean))

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
    if (error) return setLoadError(errorText(error))
    setRunId('')
    void load()
  }

  const minutes = Math.ceil((plan.list.length * (intervalSec + 3)) / 60)

  return (
    <div className="space-y-4 p-4">
      {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{loadError}</p>}

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
        <p className="font-semibold text-gray-900">채점하기</p>
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
          채점할 사진 {plan.list.length}장{plan.list.length > 0 && ` · 예상 약 ${minutes}분`}
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
              onClick={() => void start()}
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
          {runs.length > 0 && (
            <select
              value={selected?.run_id ?? ''}
              onChange={(e) => {
                setRunId(e.target.value)
                setConfirmDelete(false)
              }}
              className="h-9 rounded-md border border-gray-300 px-2"
            >
              {runs.map((r) => (
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
            {misses.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-gray-900">AI와 사람이 다른 사진 {misses.length}장</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
                  {misses.map((r) => {
                    const p = photoById.get(r.photo_id)
                    if (!p) return null
                    const t = truth.get(r.photo_id)!
                    return (
                      <button key={r.photo_id} onClick={() => onSelect(p.id)} className="overflow-hidden rounded-lg border border-gray-200 text-left hover:border-gray-400">
                        <div className="relative bg-gray-100" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                          {urls[p.thumb_path] && <img src={urls[p.thumb_path]} alt="" loading="lazy" className="absolute inset-0 h-full w-full" />}
                        </div>
                        <div className="space-y-0.5 p-2 text-gray-900">
                          <p className="font-semibold">
                            {p.drain_code} · {PHASE_LABEL[p.phase]}
                          </p>
                          <p className="text-gray-800">
                            사람 {t.cat === 'X' ? '판단 불가' : `${t.cat}등급`} / AI {gradeText(r.grade, r.unusable)}
                          </p>
                          <p className="text-gray-700">확신도 {r.confidence?.toFixed(2) ?? '-'}</p>
                          {r.reason && <p className="text-gray-700">{r.reason}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
