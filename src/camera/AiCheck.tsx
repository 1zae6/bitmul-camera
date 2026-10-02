import { useEffect, useRef, useState } from 'react'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { areaText, buildParts, callAi, cropForAi, ensureFieldRun, fieldRunId, toAiRow, type AiResult } from '../shared/ai'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { sb } from '../shared/supabase'
import { PHASE_LABEL, type Box, type GradeInput, type Phase } from '../shared/types'
import { listPending, uploadAll, uploadErrorText } from './queue'
import type { Shot } from './Review'

export type AiJob = { id: string; code: string; phase: Phase; shot: Shot; box: Box; mine: GradeInput }

type Step =
  | { kind: 'upload' }
  | { kind: 'ai'; waitSec?: number }
  | { kind: 'done'; result: AiResult }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

type Props = {
  job: AiJob
  name: string
  /** 확인 또는 기다리지 않고 계속 찍기 */
  onDone: () => void
  /** 연습용으로 돌린 뒤 다시 찍기 */
  onRetake: () => void
}

/** 저장 직후: 사진을 올리고 바로 AI 로 채점해 내 등급과 나란히 보여 준다 */
export function AiCheck({ job, name, onDone, onRetake }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'upload' })
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        await uploadAll()
        const stillWaiting = (await listPending()).some((p) => p.id === job.id)
        if (stillWaiting) return setStep({ kind: 'offline' })
        setStep({ kind: 'ai' })
        const model = CONFIG.ai.fieldModel
        const img = cropForAi(job.shot.canvas, job.shot.width, job.shot.height, job.box)
        const { result, latencyMs } = await callAi(model, buildParts(img, []), {
          onWait: (sec) => setStep({ kind: 'ai', waitSec: sec }),
        })
        await ensureFieldRun(model, name)
        const { error } = await sb().from('ai_grades').upsert(toAiRow(fieldRunId(model), job.id, result, latencyMs))
        if (error) throw error
        setStep({ kind: 'done', result })
      } catch (err) {
        setStep({ kind: 'error', message: err instanceof Error ? err.message : uploadErrorText(err) })
      }
    })()
  }, [job, name])

  const toPractice = async () => {
    setBusy(true)
    const { error } = await sb().from('photos').update({ is_test: true }).eq('id', job.id)
    setBusy(false)
    if (error) return setStep({ kind: 'error', message: uploadErrorText(error) })
    onRetake()
  }

  const waiting = step.kind === 'upload' || step.kind === 'ai'
  const mine = job.mine

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <p className="text-[16px] font-bold text-gray-900">
          {job.code} · {PHASE_LABEL[job.phase]} 저장했습니다
        </p>
        <p className="text-[14px] text-gray-700">내 등급: {gradeText(mine.grade, mine.unusable, mine.needs_report)}</p>
      </div>

      <AnnotatedImage className="min-h-[30vh] flex-1" src={job.shot.url} imgW={job.shot.width} imgH={job.shot.height} box={job.box} />

      <div className="max-h-[52vh] space-y-3 overflow-y-auto border-t border-gray-200 px-4 py-3">
        {step.kind === 'upload' && <Notice text="사진을 올리는 중…" />}
        {step.kind === 'ai' && (
          <Notice text={step.waitSec ? `무료 한도에 걸려 ${step.waitSec}초 기다렸다가 다시 보냅니다…` : 'AI가 채점하는 중… (보통 3~6초)'} />
        )}
        {step.kind === 'offline' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-gray-900">
            인터넷이 없어 AI 채점을 하지 못했습니다. 사진과 내 등급은 폰에 저장돼 있다가 인터넷이 되면 올라갑니다. AI 채점은 나중에 PC
            뷰어에서 '이어서 채점'으로 하면 됩니다.
          </p>
        )}
        {step.kind === 'error' && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-900">
            AI 채점을 하지 못했습니다: {step.message}
            <span className="block text-gray-800">사진과 내 등급은 저장됐습니다.</span>
          </p>
        )}
        {step.kind === 'done' && <ResultCard mine={mine} ai={step.result} />}
        {step.kind === 'done' && (!step.result.is_drain || step.result.unusable) && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-[15px] text-gray-900">AI가 빗물받이를 찾지 못했거나 판단할 수 없다고 봤습니다. 사진이 잘못됐다면 연습용으로 돌리고 다시 찍어 주세요.</p>
            <button onClick={() => void toPractice()} disabled={busy} className="h-12 w-full rounded-lg bg-gray-900 text-[15px] font-semibold text-white">
              연습용으로 돌리고 다시 찍기
            </button>
          </div>
        )}
        <p className="text-[14px] text-gray-700">AI 결과를 보고 내 등급을 바꾸지 않습니다. 잘못 누른 경우만 PC 뷰어에서 고쳐 주세요.</p>
      </div>

      <div className="border-t border-gray-200 px-4 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        <button
          onClick={onDone}
          className={`h-14 w-full rounded-xl text-[17px] font-bold ${waiting ? 'border border-gray-300 text-gray-900' : 'bg-blue-600 text-white'}`}
        >
          {waiting ? '기다리지 않고 계속 찍기' : '확인 · 다음 촬영'}
        </button>
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-3">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      <span className="text-[15px] text-gray-900">{text}</span>
    </div>
  )
}

function ResultCard({ mine, ai }: { mine: GradeInput; ai: AiResult }) {
  const sameGrade = mine.unusable === ai.unusable && (mine.unusable || mine.grade === ai.grade)
  const sameReport = mine.needs_report === ai.needs_report
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="grid grid-cols-[64px_1fr] gap-y-1 text-[15px]">
        <span className="text-gray-700">내 등급</span>
        <span className="font-semibold text-gray-900">{gradeText(mine.grade, mine.unusable, mine.needs_report)}</span>
        <span className="text-gray-700">AI</span>
        <span className="font-semibold text-gray-900">{gradeText(ai.grade, ai.unusable, ai.needs_report)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge ok={sameGrade} text={sameGrade ? '등급 같음' : '등급 다름'} />
        <Badge ok={sameReport} text={sameReport ? '신고 판단 같음' : '신고 판단 다름'} />
      </div>
      <p className="text-[15px] text-gray-800">
        {areaText(ai)} · 확신도 {ai.confidence.toFixed(2)}
        {ai.causes.length > 0 && ` · ${ai.causes.join(', ')}`}
      </p>
      {ai.reason && <p className="text-[15px] text-gray-800">{ai.reason}</p>}
    </div>
  )
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-[14px] font-semibold ${ok ? 'bg-green-600 text-white' : 'bg-amber-500 text-gray-900'}`}>{text}</span>
  )
}
