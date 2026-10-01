import { useState } from 'react'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { sb } from '../shared/supabase'
import { CAPTURE_MODE_LABEL, PHASE_LABEL, PHASES, rowBox, type GradeRow, type Phase, type PhotoRow } from '../shared/types'
import { downloadBlob, errorText, useSignedUrls } from './data'

type Props = {
  photo: PhotoRow
  myGrade: GradeRow | undefined
  onClose: () => void
  onUpdated: (p: PhotoRow) => void
  onDeleted: (id: string) => void
}

export function PhotoDetail({ photo, myGrade, onClose, onUpdated, onDeleted }: Props) {
  const urls = useSignedUrls([photo.storage_path, photo.thumb_path])
  const src = urls[photo.storage_path] ?? urls[photo.thumb_path]
  const [code, setCode] = useState(photo.drain_code)
  const [phase, setPhase] = useState<Phase>(photo.phase)
  const [memo, setMemo] = useState(photo.memo ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const patch = { drain_code: code.trim().toUpperCase(), phase, memo: memo.trim() || null }
  const dirty = patch.drain_code !== photo.drain_code || patch.phase !== photo.phase || patch.memo !== photo.memo

  const update = async (values: Partial<PhotoRow>, done: string) => {
    setBusy(true)
    setMsg('')
    const { data, error } = await sb().from('photos').update(values).eq('id', photo.id).select().single()
    setBusy(false)
    if (error) return setMsg(errorText(error))
    onUpdated(data as PhotoRow)
    setMsg(done)
  }

  const download = async () => {
    const url = urls[photo.storage_path]
    if (!url) return
    try {
      const blob = await (await fetch(url)).blob()
      downloadBlob(`${photo.drain_code}_${PHASE_LABEL[photo.phase]}_${photo.id.slice(0, 8)}.jpg`, blob)
    } catch (err) {
      setMsg(errorText(err))
    }
  }

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    // 기록을 먼저 지우고 파일을 지운다 (파일만 남는 쪽이 기록만 남는 쪽보다 덜 위험하다)
    const { error } = await sb().from('photos').delete().eq('id', photo.id)
    if (error) {
      setBusy(false)
      return setMsg(errorText(error))
    }
    await sb().storage.from(CONFIG.bucket).remove([photo.storage_path, photo.thumb_path])
    onDeleted(photo.id)
  }

  const box = rowBox(photo)
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">
          {photo.drain_code} · {PHASE_LABEL[photo.phase]}
          {photo.is_test && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-800">연습용</span>}
        </h2>
        <button onClick={onClose} className="rounded-md px-2 py-1 font-medium text-gray-800 hover:bg-gray-100">
          닫기
        </button>
      </div>

      {src ? (
        <AnnotatedImage className="h-[340px] rounded-lg" src={src} imgW={photo.width} imgH={photo.height} box={box} />
      ) : (
        <div className="flex h-[340px] items-center justify-center rounded-lg bg-gray-100 text-gray-700">사진 불러오는 중…</div>
      )}
      <p className="text-gray-700">빨간 박스 = 빗물받이, 흰 점선 = 주변 범위</p>

      <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1">
        <dt className="text-gray-700">촬영자</dt>
        <dd>{photo.photographer}</dd>
        <dt className="text-gray-700">촬영 시각</dt>
        <dd>{new Date(photo.taken_at).toLocaleString('ko-KR')}</dd>
        <dt className="text-gray-700">위치</dt>
        <dd>
          {photo.lat !== null && photo.lng !== null ? (
            <a
              className="text-blue-700 underline"
              href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lng}#map=19/${photo.lat}/${photo.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              {photo.lat.toFixed(6)}, {photo.lng.toFixed(6)} (±{photo.gps_accuracy ?? '?'}m)
            </a>
          ) : (
            '기록 없음'
          )}
        </dd>
        <dt className="text-gray-700">촬영 방식</dt>
        <dd>{CAPTURE_MODE_LABEL[photo.capture_mode]}</dd>
        <dt className="text-gray-700">선명도·밝기</dt>
        <dd>
          {photo.sharpness ?? '-'} · {photo.brightness ?? '-'}
          {photo.sharpness !== null && photo.sharpness < CONFIG.quality.minSharpness && (
            <span className="ml-1 text-amber-800">(흐릴 수 있음)</span>
          )}
        </dd>
        <dt className="text-gray-700">크기</dt>
        <dd>
          {photo.width}×{photo.height}
        </dd>
        <dt className="text-gray-700">메모</dt>
        <dd>{photo.memo ?? '-'}</dd>
        <dt className="text-gray-700">내 등급</dt>
        <dd>{myGrade ? gradeText(myGrade.grade, myGrade.unusable) : '안 매김'}</dd>
      </dl>

      <section className="space-y-2 rounded-lg border border-gray-200 p-3">
        <p className="font-semibold text-gray-900">정보 고치기</p>
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-28 rounded-md border border-gray-300 px-2" />
          <select value={phase} onChange={(e) => setPhase(e.target.value as Phase)} className="h-9 flex-1 rounded-md border border-gray-300 px-2">
            {PHASES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모" className="h-9 w-full rounded-md border border-gray-300 px-2" />
        <button
          disabled={!dirty || busy || !patch.drain_code}
          onClick={() => void update(patch, '고쳤습니다.')}
          className="h-9 w-full rounded-md bg-blue-600 font-semibold text-white disabled:bg-gray-300"
        >
          고친 내용 저장
        </button>
      </section>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void download()} disabled={!urls[photo.storage_path]} className="h-9 rounded-md border border-gray-300 px-3 font-medium">
          원본 내려받기
        </button>
        <button
          onClick={() => void update({ is_test: !photo.is_test }, photo.is_test ? '정답지용으로 바꿨습니다.' : '연습용으로 바꿨습니다.')}
          disabled={busy}
          className="h-9 rounded-md border border-gray-300 px-3 font-medium"
        >
          {photo.is_test ? '정답지용으로 바꾸기' : '연습용으로 바꾸기'}
        </button>
        <button
          onClick={() => void remove()}
          disabled={busy}
          className={`h-9 rounded-md px-3 font-medium ${confirmDelete ? 'bg-red-600 text-white' : 'border border-red-300 text-red-700'}`}
        >
          {confirmDelete ? '한 번 더 누르면 지워집니다' : '사진 삭제'}
        </button>
      </div>
      {msg && <p className="text-gray-800">{msg}</p>}
    </div>
  )
}
