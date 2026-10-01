import { useMemo, useState } from 'react'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { CONFIG } from '../shared/config'
import { CAPTURE_MODE_LABEL, PHASES, type Box, type CaptureMode, type Phase } from '../shared/types'
import type { Fix } from './geo'
import { nextCode, recentCodes, suggestNext } from './prefs'

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

export type ReviewResult = { box: Box; code: string; phase: Phase; memo: string; isTest: boolean }

type Props = {
  shot: Shot
  locationText: string
  saving: boolean
  onRetake: () => void
  onSave: (r: ReviewResult) => void
}

export function Review({ shot, locationText, saving, onRetake, onSave }: Props) {
  const initial = useMemo(() => suggestNext(), [])
  const [box, setBox] = useState<Box>({ ...CONFIG.guide })
  const [code, setCode] = useState(initial.code)
  const [phase, setPhase] = useState<Phase>(initial.phase)
  const [memo, setMemo] = useState('')
  const [isTest, setIsTest] = useState(shot.mode === 'demo')
  const [error, setError] = useState('')

  const chips = useMemo(() => {
    const recent = recentCodes()
    const next = recent.length ? [nextCode(recent[0])] : []
    return [...new Set([initial.code, ...next, ...recent])].slice(0, 6)
  }, [initial.code])

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
    const c = code.trim().toUpperCase()
    if (!c) return setError('빗물받이 번호를 입력해 주세요.')
    setError('')
    onSave({ box, code: c, phase, memo: memo.trim(), isTest })
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <p className="text-[16px] font-bold text-gray-900">빨간 박스를 빗물받이 덮개 테두리에 맞춰 주세요</p>
        <p className="text-[14px] text-gray-700">모서리를 끌면 크기, 가운데를 끌면 위치가 바뀝니다. 흰 점선은 주변 범위입니다.</p>
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
          <label className="text-[15px] font-semibold text-gray-900" htmlFor="drain-code">
            빗물받이 번호
          </label>
          <input
            id="drain-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={20}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-[17px] font-semibold text-gray-900"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => setCode(c)}
                className={`h-10 rounded-full border px-3 text-[15px] ${c === code ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-800'}`}
              >
                {c}
              </button>
            ))}
          </div>
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
          {initial.reason && <p className="mt-1 text-[14px] text-gray-700">{initial.reason}</p>}
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
