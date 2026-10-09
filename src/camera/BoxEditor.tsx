import { useEffect, useMemo, useState } from 'react'
import { areaText, buildParts, callAi, ensureFieldRun, fieldRunId, prepareImage, toAiRow, type AiResult } from '../shared/ai'
import { AnnotatedImage } from '../shared/AnnotatedImage'
import { CONFIG } from '../shared/config'
import { gradeText } from '../shared/grades'
import { sb } from '../shared/supabase'
import { PHASE_LABEL, rowBox, type Box, type PhotoRow } from '../shared/types'
import { uploadErrorText } from './queue'

// 박스 고치기 (CONFIG.boxEditors 에 든 이름만). 팀원이 맞춘 빨간 박스를 고쳐 덮어쓰고,
// 새 박스로 AI 채점을 다시 해 현장 즉시 채점 결과를 덮어쓴다. 사람이 매긴 등급은 건드리지 않는다.

type Props = { name: string; onClose: () => void }

export function BoxEditor({ name, onClose }: Props) {
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [who, setWho] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<PhotoRow | null>(null)

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await sb().from('photos').select('*').eq('is_test', false).order('taken_at', { ascending: false })
      if (err) return setError(uploadErrorText(err))
      const rows = (data ?? []) as PhotoRow[]
      setPhotos(rows)
      if (!rows.length) return
      const signed = await sb().storage.from(CONFIG.bucket).createSignedUrls(rows.map((r) => r.thumb_path), CONFIG.signedUrlSeconds)
      setThumbs(Object.fromEntries((signed.data ?? []).map((s) => [s.path, s.signedUrl])))
    })()
  }, [])

  const people = useMemo(() => [...new Set((photos ?? []).map((p) => p.photographer))].sort(), [photos])
  const list = (photos ?? []).filter((p) => !who || p.photographer === who)

  if (editing) {
    return (
      <EditOne
        photo={editing}
        name={name}
        onDone={(saved) => {
          setPhotos((ps) => ps?.map((p) => (p.id === saved.id ? saved : p)) ?? null)
          setEditing(null)
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <div>
          <p className="text-[16px] font-bold text-gray-900">박스 고치기</p>
          <p className="text-[14px] text-gray-700">사진을 누르면 빨간 박스를 고칠 수 있습니다</p>
        </div>
        <button onClick={onClose} className="h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-[15px] font-semibold text-gray-900">
          닫기
        </button>
      </div>
      <div className="px-4 py-2">
        <select value={who} onChange={(e) => setWho(e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 px-2 text-[15px] text-gray-900">
          <option value="">찍은 사람 전체</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-800">{error}</p>}
        {photos === null && !error ? (
          <p className="text-[15px] text-gray-800">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-[15px] text-gray-800">고칠 사진이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {list.map((p) => (
              <button key={p.id} onClick={() => setEditing(p)} className="overflow-hidden rounded-lg border border-gray-300 text-left">
                <div className="aspect-square bg-gray-100">{thumbs[p.thumb_path] && <img src={thumbs[p.thumb_path]} alt="" className="h-full w-full object-cover" />}</div>
                <div className="px-1.5 py-1 text-[13px] leading-tight text-gray-900">
                  <span className="block truncate font-semibold">{p.drain_code}</span>
                  <span className="block truncate text-gray-700">{p.photographer}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type Step = { kind: 'edit' } | { kind: 'saving'; text: string } | { kind: 'done'; result: AiResult | null; aiError: string } | { kind: 'error'; message: string }

function EditOne({ photo, name, onDone, onCancel }: { photo: PhotoRow; name: string; onDone: (p: PhotoRow) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('')
  const [box, setBox] = useState<Box>(rowBox(photo))
  const [step, setStep] = useState<Step>({ kind: 'edit' })
  const [saved, setSaved] = useState<PhotoRow | null>(null)

  useEffect(() => {
    void sb()
      .storage.from(CONFIG.bucket)
      .createSignedUrl(photo.storage_path, CONFIG.signedUrlSeconds)
      .then(({ data }) => setUrl(data?.signedUrl ?? ''))
  }, [photo.storage_path])

  const save = async () => {
    setStep({ kind: 'saving', text: '박스를 저장하는 중…' })
    const r4 = (v: number) => Math.round(v * 10000) / 10000
    const values = { box_x: r4(box.x), box_y: r4(box.y), box_w: r4(box.w), box_h: r4(box.h) }
    const { data, error } = await sb().from('photos').update(values).eq('id', photo.id).select().single()
    if (error || !data) return setStep({ kind: 'error', message: uploadErrorText(error) })
    const next = data as PhotoRow
    setSaved(next)
    // 새 박스로 AI 를 다시 채점해 현장 즉시 채점 결과를 덮어쓴다 (사람 등급은 그대로)
    setStep({ kind: 'saving', text: 'AI가 새 박스로 다시 채점하는 중…' })
    try {
      const model = CONFIG.ai.fieldModel
      const img = await prepareImage(next, url)
      const { result, latencyMs } = await callAi(model, buildParts(img, []), {
        onWait: (sec) => setStep({ kind: 'saving', text: `무료 한도에 걸려 ${sec}초 기다렸다가 다시 보냅니다…` }),
      })
      await ensureFieldRun(model, name)
      const up = await sb().from('ai_grades').upsert(toAiRow(fieldRunId(model), next.id, result, latencyMs))
      if (up.error) throw up.error
      setStep({ kind: 'done', result, aiError: '' })
    } catch (err) {
      setStep({ kind: 'done', result: null, aiError: err instanceof Error ? err.message : uploadErrorText(err) })
    }
  }

  const busy = step.kind === 'saving'

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <p className="text-[16px] font-bold text-gray-900">
          {photo.drain_code} · {PHASE_LABEL[photo.phase]} · {photo.photographer}
        </p>
        <p className="text-[14px] text-gray-700">빨간 박스를 덮개 테두리에 맞춰 주세요. 저장하면 박스를 덮어쓰고 AI 채점을 다시 합니다.</p>
      </div>

      {url ? (
        <AnnotatedImage
          className="min-h-[40vh] flex-1"
          src={url}
          imgW={photo.width}
          imgH={photo.height}
          box={box}
          onChange={step.kind === 'edit' || step.kind === 'error' ? setBox : undefined}
        />
      ) : (
        <div className="flex min-h-[40vh] flex-1 items-center justify-center bg-gray-100 text-[15px] text-gray-800">사진 불러오는 중…</div>
      )}

      <div className="space-y-2 border-t border-gray-200 px-4 py-3">
        {step.kind === 'saving' && <p className="text-[15px] text-gray-900">{step.text}</p>}
        {step.kind === 'error' && <p className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-800">저장하지 못했습니다: {step.message}</p>}
        {step.kind === 'done' && (
          <div className="rounded-lg border border-gray-200 p-3 text-[15px] text-gray-900">
            <p className="font-semibold">박스를 고쳤습니다. 사람이 매긴 등급은 그대로입니다.</p>
            {step.result ? (
              <>
                <p className="mt-1">
                  새 AI 채점: {gradeText(step.result.grade, step.result.unusable, step.result.needs_report)} · {areaText(step.result)} · 확신도{' '}
                  {step.result.confidence.toFixed(2)}
                </p>
                {step.result.reason && <p className="mt-1 text-gray-800">{step.result.reason}</p>}
              </>
            ) : (
              <p className="mt-1 text-red-800">AI 다시 채점은 못 했습니다: {step.aiError} (PC 뷰어의 AI 채점에서 다시 할 수 있습니다)</p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_2fr] gap-3 border-t border-gray-200 px-4 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        {step.kind === 'done' ? (
          <button onClick={() => onDone(saved ?? photo)} className="col-span-2 h-14 rounded-xl bg-blue-600 text-[17px] font-bold text-white">
            목록으로
          </button>
        ) : (
          <>
            <button onClick={onCancel} disabled={busy} className="h-14 rounded-xl border border-gray-300 text-base font-semibold text-gray-900">
              취소
            </button>
            <button onClick={() => void save()} disabled={busy || !url} className="h-14 rounded-xl bg-blue-600 text-[17px] font-bold text-white disabled:bg-blue-300">
              {busy ? '저장 중…' : '저장하고 AI 다시 채점'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
