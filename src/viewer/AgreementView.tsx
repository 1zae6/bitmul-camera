import { useMemo, useState } from 'react'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { PHASE_LABEL, type GradeRow, type PhotoRow } from '../shared/types'
import { downloadCsv, today, toCsv, useSignedUrls } from './data'

type Props = {
  /** 연습용을 뺀 사진 */
  photos: PhotoRow[]
  grades: GradeRow[]
  onSelect: (id: string) => void
}

const CATS = ['0', '1', '2', '3', '4', 'X'] as const
const cat = (g: GradeRow) => (g.unusable ? 'X' : String(g.grade))

type Pair = { p: PhotoRow; a: GradeRow; b: GradeRow }

/** 두 사람의 등급이 얼마나 같은지 보고, 둘이 같은 사진만 모아 정답지를 만든다 */
export function AgreementView({ photos, grades, onSelect }: Props) {
  const graders = useMemo(() => [...new Set(grades.map((g) => g.grader))].sort(), [grades])
  const [pickA, setPickA] = useState('')
  const [pickB, setPickB] = useState('')
  const A = pickA || graders[0] || ''
  const B = pickB || graders.find((g) => g !== A) || ''

  const byPhoto = useMemo(() => {
    const m = new Map<string, Map<string, GradeRow>>()
    for (const g of grades) {
      if (!m.has(g.photo_id)) m.set(g.photo_id, new Map())
      m.get(g.photo_id)!.set(g.grader, g)
    }
    return m
  }, [grades])

  const pairs: Pair[] = useMemo(() => {
    if (!A || !B || A === B) return []
    const out: Pair[] = []
    for (const p of photos) {
      const a = byPhoto.get(p.id)?.get(A)
      const b = byPhoto.get(p.id)?.get(B)
      if (a && b) out.push({ p, a, b })
    }
    return out
  }, [photos, byPhoto, A, B])

  const stats = useMemo(() => summarize(pairs), [pairs])
  const disagreements = pairs.filter((x) => cat(x.a) !== cat(x.b))
  const answerKey = pairs.filter((x) => cat(x.a) === cat(x.b) && !x.a.unusable)
  const urls = useSignedUrls(disagreements.slice(0, 60).map((x) => x.p.thumb_path))

  const exportAnswerKey = () => {
    const rows = answerKey.map(({ p, a }) => [
      p.id, p.drain_code, PHASE_LABEL[p.phase], p.photographer, p.taken_at, a.grade,
      p.storage_path, p.width, p.height, p.box_x, p.box_y, p.box_w, p.box_h, p.lat, p.lng,
    ])
    downloadCsv(
      `정답지_${A}_${B}_${today()}.csv`,
      toCsv(['photo_id', '빗물받이번호', '단계', '촬영자', '촬영시각', '등급', '사진경로', '폭', '높이', 'box_x', 'box_y', 'box_w', 'box_h', '위도', '경도'], rows),
    )
  }

  const exportAll = () => {
    const photoById = new Map(photos.map((p) => [p.id, p]))
    const rows = grades
      .filter((g) => photoById.has(g.photo_id))
      .map((g) => {
        const p = photoById.get(g.photo_id)!
        return [g.photo_id, p.drain_code, PHASE_LABEL[p.phase], g.grader, g.grade, g.unusable, g.updated_at]
      })
    downloadCsv(`전체등급_${today()}.csv`, toCsv(['photo_id', '빗물받이번호', '단계', '채점자', '등급', '판단불가', '매긴시각'], rows))
  }

  return (
    <div className="space-y-4 p-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-gray-900">
        이 화면에서는 서로의 등급이 보입니다. 두 사람이 각자 다 매긴 뒤에 여세요.
      </p>

      <section className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gray-900">비교할 두 사람</span>
        <GraderSelect value={A} options={graders} onChange={setPickA} />
        <span className="text-gray-700">와</span>
        <GraderSelect value={B} options={graders} onChange={setPickB} />
        <span className="ml-auto flex gap-2">
          <button onClick={exportAnswerKey} disabled={!answerKey.length} className="h-9 rounded-md bg-blue-600 px-3 font-semibold text-white disabled:bg-gray-300">
            정답지 CSV ({answerKey.length}장)
          </button>
          <button onClick={exportAll} disabled={!grades.length} className="h-9 rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40">
            전체 등급 CSV
          </button>
        </span>
      </section>

      <section className="rounded-lg border border-gray-200 p-3">
        <p className="font-semibold text-gray-900">채점 현황 (연습용 제외 {photos.length}장)</p>
        {graders.length === 0 ? (
          <p className="mt-1 text-gray-700">아직 등급을 매긴 사람이 없습니다.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-gray-800">
            {graders.map((g) => (
              <li key={g}>
                {g}: {photos.filter((p) => byPhoto.get(p.id)?.has(g)).length}장
              </li>
            ))}
          </ul>
        )}
      </section>

      {!A || !B || A === B ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-700">
          등급을 매긴 사람이 두 명 이상이어야 비교할 수 있습니다.
        </div>
      ) : pairs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-700">
          {A}와 {B}가 둘 다 매긴 사진이 아직 없습니다.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="둘 다 매긴 사진" value={`${pairs.length}장`} />
            <Stat label="완전 일치" value={`${stats.agree}장 (${pct(stats.agree, pairs.length)})`} />
            <Stat label="±1 등급 이내" value={stats.numeric ? pct(stats.within1, stats.numeric) : '-'} hint="판단 불가 제외" />
            <Stat label="코언 카파" value={stats.kappa === null ? '-' : stats.kappa.toFixed(2)} hint="우연히 맞을 확률을 뺀 일치도" />
            <Stat label="정답지" value={`${answerKey.length} / ${CONFIG.goal}장`} hint="두 사람이 같고 판단 가능한 사진" />
          </section>

          <section>
            <p className="mb-1 font-semibold text-gray-900">
              등급 맞대기 (세로 {A}, 가로 {B})
            </p>
            <table className="border-collapse text-center">
              <thead>
                <tr>
                  <th className="border border-gray-300 bg-gray-50 px-3 py-1.5" />
                  {CATS.map((c) => (
                    <th key={c} className="border border-gray-300 bg-gray-50 px-3 py-1.5">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATS.map((ra, i) => (
                  <tr key={ra}>
                    <th className="border border-gray-300 bg-gray-50 px-3 py-1.5">{ra}</th>
                    {CATS.map((cb, j) => (
                      <td key={cb} className={`border border-gray-300 px-3 py-1.5 ${i === j ? 'bg-green-50 font-semibold' : ''}`}>
                        {stats.matrix[i][j] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <p className="mb-1 font-semibold text-gray-900">등급이 다른 사진 {disagreements.length}장</p>
            {disagreements.length === 0 ? (
              <p className="text-gray-700">모두 같습니다.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {disagreements.map(({ p, a, b }) => (
                  <button key={p.id} onClick={() => onSelect(p.id)} className="overflow-hidden rounded-lg border border-gray-200 text-left hover:border-gray-400">
                    <div className="relative bg-gray-100" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                      {urls[p.thumb_path] && <img src={urls[p.thumb_path]} alt="" loading="lazy" className="absolute inset-0 h-full w-full" />}
                    </div>
                    <div className="p-2 text-gray-900">
                      <p className="font-semibold">
                        {p.drain_code} · {PHASE_LABEL[p.phase]}
                      </p>
                      <p className="text-gray-700">
                        {A}: {gradeText(a.grade, a.unusable)}
                      </p>
                      <p className="text-gray-700">
                        {B}: {gradeText(b.grade, b.unusable)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function GraderSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-gray-300 px-2">
      {options.length === 0 && <option value="">(없음)</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-gray-700">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-700">{hint}</p>}
    </div>
  )
}

function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : '-'
}

function summarize(pairs: Pair[]) {
  const matrix = CATS.map(() => CATS.map(() => 0))
  let agree = 0
  let within1 = 0
  let numeric = 0
  const countA: Record<string, number> = {}
  const countB: Record<string, number> = {}
  for (const { a, b } of pairs) {
    const ca = cat(a)
    const cb = cat(b)
    matrix[CATS.indexOf(ca as (typeof CATS)[number])][CATS.indexOf(cb as (typeof CATS)[number])]++
    countA[ca] = (countA[ca] ?? 0) + 1
    countB[cb] = (countB[cb] ?? 0) + 1
    if (ca === cb) agree++
    if (!a.unusable && !b.unusable && a.grade !== null && b.grade !== null) {
      numeric++
      if (Math.abs(a.grade - b.grade) <= 1) within1++
    }
  }
  const n = pairs.length
  let kappa: number | null = null
  if (n) {
    const po = agree / n
    const pe = CATS.reduce((s, c) => s + ((countA[c] ?? 0) / n) * ((countB[c] ?? 0) / n), 0)
    kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe)
  }
  return { matrix, agree, within1, numeric, kappa }
}
