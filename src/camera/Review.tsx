import { useState } from 'react'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { CONFIG } from '../shared/config'
import { GRADE_RULES, GRADES, REPORT, UNUSABLE } from '../shared/grades'
import { CAPTURE_MODE_LABEL, PHASES, type Box, type CaptureMode, type GradeInput, type Phase } from '../shared/types'
import type { Fix } from './geo'

export type Shot = {
  canvas: HTMLCanvasElement
  url: string
  width: number
  height: number
  mode: CaptureMode
  takenAt: string
  fix: Fix | null
  quality: { sharpness: number; brightness: number }
}

/** mine: 찍은 사람이 현장에서 매기는 1차 등급 */
export type ReviewResult = { box: Box; code: string; phase: Phase; memo: string; isTest: boolean; mine: GradeInput }

/** 등급 버튼 값: 등급 숫자 또는 판단 불가 */
type Pick = number | 'X' | null

type Props = {
  shot: Shot
  locationText: string
  saving: boolean
  onRetake: () => void
  onSave: (r: ReviewResult) => void
  /** 찍는 사람 이름. 빗물받이 번호 예시에 쓴다 */
  name: string
}

/** 빗물받이 번호는 찍는 사람이 '이름-번호'로 직접 적는다 (예: 한재욱-1). 같은 빗물받이를 다시 찍으면 같은 번호를 적는다 */
const CODE_PATTERN = /^S+-d+$/

export function Review({ shot, locationText, saving, onRetake, onSave, name }: Props) {
  const [box, setBox] = useState<Box>({ ...CONFIG.guide })
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<Phase>('before')
  const [memo, setMemo] = useState('')
  const [isTest, setIsTest] = useState(shot.mode === 'demo')
  const [pick, setPick] = useState<Pick>(null)
  const [report, setReport] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [error, setError] = useState('')

  const q = shot.quality
  const warning =
    q.sharpness < CONFIG.quality.minSharpness
      ? '사진이 흐릴 수 있습니다. 가능하면 다시 찍어 주세요.'
      : q.brightness < CONFIG.quality.minBrightness
        ? '사진이 어둡습니다. 가능하면 밝은 곳에서 다시 찍어 주세요.'
        : q.brightness > CONFIG.quality.maxBrightness
          ? '빛이 반사돼 너무 밝습니다. 각도를 바꿔 다시 찍는 것을 권합니다.'
          : ''

  const submit = () => {
    // 하이픈 앞뒤 공백은 지우고, 영문은 대문자로 맞춰 같은 번호가 다르게 저장되지 않게 한다
    const c = code.trim().replace(/s*-s*/g, '-').toUpperCase()
    if (pick === null) return setError('내 등급을 골라 주세요.')
    if (!c) return setError(`빗물받이 번호를 적어 주세요. 예: ${name}-1`)
    if (!CODE_PATTERN.test(c)) return setError(`'이름-번호' 모양으로 적어 주세요. 예: ${name}-1`)
    setError('')
    const mine: GradeInput =
      pick === 'X' ? { grade: null, unusable: true, needs_report: report } : { grade: pick, unusable: false, needs_report: report }
    onSave({ box, code: c, phase, memo: memo.trim(), isTest, mine })
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <p className="text-[16px] font-bold text-gray-900">빨간 박스를 빗물받이 덮개 테두리에 맞춰 주세요</p>
        <p className="text-[14px] text-gray-700">모서리를 끌면 크기, 가운데를 끌면 위치가 바뀝니다. 흰 점선 안이 등급을 매기는 범위입니다.</p>
      </div>

      <AnnotatedImage
        className="min-h-[40vh] flex-1"
        src={shot.url}
        imgW={shot.width}
        imgH={shot.height}
        box={box}
        onChange={setBox}
      />

      <div className="max-h-[40vh] space-y-3 overflow-y-auto border-t border-gray-200 px-4 py-3">
        {warning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-amber-900">{warning}</p>}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold text-gray-900">내 등급 (덮개·주변 중 더 심한 쪽)</p>
            <button onClick={() => setShowRules((s) => !s)} className="min-h-10 px-1 text-[14px] font-semibold text-blue-700">
              {showRules ? '기준 접기' : '기준 보기'}
            </button>
          </div>
          {showRules && (
            <ul className="mb-2 list-disc space-y-1 rounded-lg bg-gray-50 py-2 pl-7 pr-3 text-[14px] text-gray-800">
              {GRADE_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {GRADES.map((g) => (
                <li key={g.value}>
                  {g.value} {g.short}: {g.desc}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 grid grid-cols-3 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.value}
                onClick={() => setPick(g.value)}
                className={`min-h-12 rounded-lg border px-1 text-[15px] font-semibold ${pick === g.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-900'}`}
              >
                {g.value} {g.short}
              </button>
            ))}
            <button
              onClick={() => setPick('X')}
              className={`min-h-12 rounded-lg border px-1 text-[15px] font-semibold ${pick === 'X' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-900'}`}
            >
              {UNUSABLE.short}
            </button>
          </div>
          <button
            onClick={() => setReport((r) => !r)}
            className={`mt-2 flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 text-left text-[15px] ${report ? 'border-red-600 bg-red-50 text-red-900' : 'border-gray-300 text-gray-900'}`}
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 font-bold ${report ? 'border-red-600 bg-red-600 text-white' : 'border-gray-400'}`}>
              {report ? '✓' : ''}
            </span>
            <span>
              <span className="font-semibold">{REPORT.short}</span>
              <span className="block text-[14px] text-gray-700">덮개 아래(틈 안쪽)에 쓰레기가 쌓여 시민이 치울 수 없음</span>
            </span>
          </button>
          <p className="mt-1 text-[14px] text-gray-700">현장에서 본 것이 아니라 사진에 보이는 것만 보고 매겨 주세요.</p>
        </div>

        <div>
          <label className="text-[15px] font-semibold text-gray-900" htmlFor="drain-code">
            빗물받이 번호 (필수)
          </label>
          <input
            id="drain-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            maxLength={30}
            placeholder={`예: ${name}-1`}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-[17px] font-semibold text-gray-900"
          />
          <p className="mt-1 text-[14px] text-gray-700">같은 빗물받이를 다시 찍으면 같은 번호를 적어 주세요.</p>
        </div>

        <div>
          <p className="text-[15px] font-semibold text-gray-900">단계</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {PHASES.map((p) => (
              <button
                key={p.value}
                onClick={() => setPhase(p.value)}
                className={`h-12 rounded-lg border text-[16px] font-semibold ${phase === p.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-800'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={200}
          placeholder="메모 (선택) 예: 덮개 위 장판, 꽁초 많음"
          className="h-12 w-full rounded-lg border border-gray-300 px-3 text-[16px] text-gray-900"
        />

        <div className="flex items-center justify-between gap-3 text-[14px] text-gray-700">
          <span>
            {locationText} · {CAPTURE_MODE_LABEL[shot.mode]}
          </span>
          <label className="flex min-h-11 items-center gap-2 text-[15px] text-gray-900">
            <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} className="h-5 w-5" />
            연습용
          </label>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-800">{error}</p>}
      </div>

      <div
        className="grid grid-cols-[1fr_2fr] gap-3 border-t border-gray-200 px-4 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <button onClick={onRetake} disabled={saving} className="h-14 rounded-xl border border-gray-300 text-base font-semibold text-gray-900">
          다시 찍기
        </button>
        <button onClick={submit} disabled={saving} className="h-14 rounded-xl bg-blue-600 text-[17px] font-bold text-white disabled:bg-blue-300">
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>

    </div>
  )
}
