import { useEffect, useMemo, useState } from 'react'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { GRADE_RULES, GRADES, MAX_GRADE, REPORT, UNUSABLE } from '../shared/grades'
import { sb } from '../shared/supabase'
import { rowBox, type GradeRow, type PhotoRow } from '../shared/types'
import { errorText, signUrls, useSignedUrls } from './data'

type Props = {
  /** 연습용을 뺀 사진 */
  photos: PhotoRow[]
  grades: GradeRow[]
  name: string
  onGraded: (g: GradeRow) => void
}

/**
 * 정답지용 등급 매기기. 다른 사람의 등급과 사진 정보(번호·단계·촬영자)는 보여 주지 않는다.
 * 청소 전·후를 알면 판단이 쏠리기 때문이다.
 */
export function GradeView({ photos, grades, name, onGraded }: Props) {
  const sorted = useMemo(() => [...photos].sort((a, b) => a.taken_at.localeCompare(b.taken_at)), [photos])
  const mine = useMemo(() => new Map(grades.filter((g) => g.grader === name).map((g) => [g.photo_id, g])), [grades, name])
  // 정답지는 매긴 사람 전원이 같아야 하므로 사진마다 2명(찍은 사람 + 1명)만 매긴다
  const raters = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of grades) m.set(g.photo_id, (m.get(g.photo_id) ?? 0) + 1)
    return m
  }, [grades])
  const [onlyTodo, setOnlyTodo] = useState(true)
  const [pos, setPos] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const list = onlyTodo ? sorted.filter((p) => !mine.has(p.id) && (raters.get(p.id) ?? 0) < 2) : sorted
  const idx = Math.min(pos, Math.max(0, list.length - 1))
  const photo = list[idx] as PhotoRow | undefined
  const current = photo ? mine.get(photo.id) : undefined
  const done = sorted.filter((p) => mine.has(p.id)).length
  const urls = useSignedUrls(photo ? [photo.storage_path] : [])
  // '신고 필요'는 등급과 별개. 사진이 바뀌면 이미 매긴 값으로 맞춘다
  const [report, setReport] = useState(false)
  useEffect(() => {
    setReport(current?.needs_report ?? false)
  }, [photo?.id, current?.needs_report])

  // 다음 사진 주소를 미리 받아 둔다
  const upcoming = list.slice(idx + 1, idx + 3).map((p) => p.storage_path).join('|')
  useEffect(() => {
    if (upcoming) void signUrls(upcoming.split('|')).catch(() => undefined)
  }, [upcoming])

  const save = async (grade: number | null, unusable: boolean, needsReport = report) => {
    if (!photo || busy) return
    setBusy(true)
    setError('')
    const row: GradeRow = { photo_id: photo.id, grader: name, grade, unusable, needs_report: needsReport, updated_at: new Date().toISOString() }
    const { error: err } = await sb().from('grades').upsert(row, { onConflict: 'photo_id,grader' })
    setBusy(false)
    if (err) return setError(errorText(err))
    onGraded(row)
    // '2차 채점할 사진만'이면 매긴 사진이 목록에서 빠지므로 같은 자리에 다음 사진이 온다
    if (!onlyTodo) setPos(Math.min(idx + 1, list.length - 1))
  }

  /** 이미 매긴 사진이면 바로 저장하고, 아직이면 등급을 고를 때 같이 저장한다 */
  const toggleReport = () => {
    const next = !report
    setReport(next)
    if (current) void save(current.grade, current.unusable, next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
      if (/^\d$/.test(e.key) && Number(e.key) <= MAX_GRADE) void save(Number(e.key), false)
      else if (e.key === 'x' || e.key === 'X') void save(null, true)
      else if (e.key === 'r' || e.key === 'R') toggleReport()
      else if (e.key === 'ArrowRight') setPos(Math.min(idx + 1, list.length - 1))
      else if (e.key === 'ArrowLeft') setPos(Math.max(idx - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold text-gray-900">
            내가 매긴 사진 {done} / {sorted.length}장
          </p>
          <label className="flex items-center gap-1.5 text-gray-800">
            <input
              type="checkbox"
              checked={onlyTodo}
              onChange={(e) => {
                setOnlyTodo(e.target.checked)
                setPos(0)
              }}
            />
            2차 채점할 사진만 (아직 한 명만 매긴 것)
          </label>
          {list.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setPos(Math.max(idx - 1, 0))} disabled={idx === 0} className="h-8 rounded-md border border-gray-300 px-3 disabled:opacity-40">
                ← 이전
              </button>
              <span className="text-gray-800">
                {idx + 1} / {list.length}
              </span>
              <button
                onClick={() => setPos(Math.min(idx + 1, list.length - 1))}
                disabled={idx >= list.length - 1}
                className="h-8 rounded-md border border-gray-300 px-3 disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          )}
        </div>

        {photo ? (
          urls[photo.storage_path] ? (
            <AnnotatedImage
              key={photo.id}
              className="min-h-0 flex-1 rounded-lg"
              src={urls[photo.storage_path]}
              imgW={photo.width}
              imgH={photo.height}
              box={rowBox(photo)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-gray-100 text-gray-700">사진 불러오는 중…</div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-700">
            {sorted.length === 0
              ? '등급을 매길 사진이 없습니다. 연습용 사진과 이미 두 명이 매긴 사진은 여기서 빠집니다.'
              : '2차 채점할 사진이 없습니다. "2차 채점할 사진만"을 끄면 매긴 등급을 고칠 수 있습니다.'}
          </div>
        )}
        <p className="text-gray-700">
          판단이 쏠리지 않도록 번호·단계·촬영자는 가렸습니다. 다른 사람의 등급도 이 화면에는 나오지 않습니다.
        </p>
      </div>

      <div className="space-y-3 overflow-y-auto border-l border-gray-200 p-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">등급 기준</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-800">
            {GRADE_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <button
          onClick={toggleReport}
          disabled={!photo || busy}
          className={`flex w-full items-start gap-3 rounded-lg border p-2.5 text-left disabled:opacity-50 ${report ? 'border-red-600 bg-red-50' : 'border-gray-300 hover:bg-gray-50'}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg font-bold ${report ? 'bg-red-600 text-white' : 'border-2 border-gray-400 text-gray-500'}`}>
            {report ? '✓' : 'R'}
          </span>
          <span>
            <span className="block font-semibold text-gray-900">{REPORT.short} (등급과 별개)</span>
            <span className="block text-gray-700">{REPORT.desc}</span>
          </span>
        </button>
        <p className="text-gray-700">신고 필요를 먼저 켜고 등급을 누르면 둘 다 저장됩니다.</p>
        <div className="space-y-2">
          {GRADES.map((g) => (
            <button
              key={g.value}
              onClick={() => void save(g.value, false)}
              disabled={!photo || busy}
              className={`flex w-full items-start gap-3 rounded-lg border p-2.5 text-left disabled:opacity-50 ${current && !current.unusable && current.grade === g.value ? 'border-blue-600 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-900 text-lg font-bold text-white">{g.value}</span>
              <span>
                <span className="block font-semibold text-gray-900">{g.short}</span>
                <span className="block text-gray-700">{g.desc}</span>
              </span>
            </button>
          ))}
          <button
            onClick={() => void save(null, true)}
            disabled={!photo || busy}
            className={`flex w-full items-start gap-3 rounded-lg border p-2.5 text-left disabled:opacity-50 ${current?.unusable ? 'border-blue-600 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-500 text-lg font-bold text-white">X</span>
            <span>
              <span className="block font-semibold text-gray-900">{UNUSABLE.short}</span>
              <span className="block text-gray-700">{UNUSABLE.desc}</span>
            </span>
          </button>
        </div>
        <p className="text-gray-700">키보드: 숫자 0~{MAX_GRADE}, X(판단 불가), R(신고 필요), ←·→(이동)</p>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      </div>
    </div>
  )
}
