import { useMemo, useState } from 'react'
import { BoxOverlay } from '../shared/AnnotatedImage'
import { gradeText } from '../shared/grades'
import { PHASE_LABEL, PHASES, rowBox, type GradeRow, type Phase, type PhotoRow } from '../shared/types'
import { fmtTime, useSignedUrls } from './data'

type Props = {
  photos: PhotoRow[]
  myGrades: Map<string, GradeRow>
  selectedId: string | null
  onSelect: (id: string) => void
}

const PHASE_ORDER: Record<Phase, number> = { before: 0, after: 1, revisit: 2 }

export function PhotoList({ photos, myGrades, selectedId, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [who, setWho] = useState('')
  const [phase, setPhase] = useState<'' | Phase>('')
  const [sort, setSort] = useState<'new' | 'code'>('new')

  const people = useMemo(() => [...new Set(photos.map((p) => p.photographer))].sort(), [photos])
  const list = useMemo(() => {
    const term = q.trim().toUpperCase()
    const l = photos.filter(
      (p) =>
        (!term || p.drain_code.toUpperCase().includes(term) || (p.memo ?? '').toUpperCase().includes(term)) &&
        (!who || p.photographer === who) &&
        (!phase || p.phase === phase),
    )
    if (sort === 'code')
      return [...l].sort(
        (a, b) =>
          a.drain_code.localeCompare(b.drain_code, 'ko', { numeric: true }) ||
          PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
          a.taken_at.localeCompare(b.taken_at),
      )
    return l
  }, [photos, q, who, phase, sort])

  const urls = useSignedUrls(list.map((p) => p.thumb_path))

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="번호·메모 검색"
          className="h-9 w-48 rounded-md border border-gray-300 px-2"
        />
        <select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-md border border-gray-300 px-2">
          <option value="">촬영자 전체</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={phase} onChange={(e) => setPhase(e.target.value as '' | Phase)} className="h-9 rounded-md border border-gray-300 px-2">
          <option value="">단계 전체</option>
          {PHASES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'code')} className="h-9 rounded-md border border-gray-300 px-2">
          <option value="new">최근 찍은 순</option>
          <option value="code">빗물받이 번호 순</option>
        </select>
        <span className="text-gray-700">{list.length}장</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-gray-700">
          {photos.length === 0 ? '아직 올라온 사진이 없습니다. 폰 촬영기로 찍으면 여기에 나타납니다.' : '조건에 맞는 사진이 없습니다.'}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {list.map((p) => {
            const mine = myGrades.get(p.id)
            const url = urls[p.thumb_path]
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`overflow-hidden rounded-lg border bg-white text-left ${p.id === selectedId ? 'border-blue-600 ring-2 ring-blue-600' : 'border-gray-200 hover:border-gray-400'}`}
              >
                <div className="relative bg-gray-100" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                  {url && <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full" />}
                  <BoxOverlay box={rowBox(p)} />
                  {p.is_test && (
                    <span className="absolute left-1 top-1 rounded bg-gray-900/85 px-1.5 py-0.5 text-xs text-white">연습용</span>
                  )}
                </div>
                <div className="space-y-0.5 p-2">
                  <p className="font-semibold text-gray-900">
                    {p.drain_code} · {PHASE_LABEL[p.phase]}
                  </p>
                  <p className="text-gray-700">
                    {p.photographer} · {fmtTime(p.taken_at)}
                  </p>
                  <p className="text-gray-700">내 등급 {mine ? gradeText(mine.grade, mine.unusable) : '안 매김'}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
