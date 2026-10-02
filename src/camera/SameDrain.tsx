import { useEffect, useState } from 'react'
import { CONFIG } from '../shared/config'
import { sb } from '../shared/supabase'
import { PHASE_LABEL, type Phase } from '../shared/types'
import { listPending } from './queue'

/** 다시 찍을 때 고르는 '내가 찍은 빗물받이' 하나 (번호마다 가장 최근 사진) */
export type SameItem = { code: string; thumb: string; takenAt: string; phase: Phase }

type MyDrains = {
  /** null 이면 불러오는 중 */
  items: SameItem[] | null
  /** 내 번호 전부 (새 번호가 겹치지 않게 쓴다) */
  codes: string[]
  error: string
}

/** 로그인한 이름으로 찍은 사진만 모은다. 아직 안 올라간 폰 속 사진도 포함 */
export function useMyDrains(name: string): MyDrains {
  const [state, setState] = useState<MyDrains>({ items: null, codes: [], error: '' })

  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []
    void (async () => {
      const local: SameItem[] = []
      for (const p of await listPending().catch(() => [])) {
        if (p.row.photographer !== name || p.row.is_test) continue
        const url = URL.createObjectURL(p.thumb)
        objectUrls.push(url)
        local.push({ code: p.row.drain_code, thumb: url, takenAt: p.row.taken_at, phase: p.row.phase })
      }
      let remote: SameItem[] = []
      let error = ''
      try {
        const { data, error: err } = await sb()
          .from('photos')
          .select('drain_code,thumb_path,taken_at,phase')
          .eq('photographer', name)
          .eq('is_test', false)
          .order('taken_at', { ascending: false })
        if (err) throw err
        const rows = data ?? []
        const signed = rows.length
          ? (await sb().storage.from(CONFIG.bucket).createSignedUrls(rows.map((r) => r.thumb_path), CONFIG.signedUrlSeconds)).data ?? []
          : []
        const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]))
        remote = rows.map((r) => ({ code: r.drain_code, thumb: urlOf.get(r.thumb_path) ?? '', takenAt: r.taken_at, phase: r.phase as Phase }))
      } catch {
        error = '인터넷이 없어 이 폰에서 아직 안 올라간 사진만 보입니다.'
      }
      const all = [...local, ...remote].sort((a, b) => b.takenAt.localeCompare(a.takenAt))
      const latest = new Map<string, SameItem>()
      for (const it of all) if (!latest.has(it.code)) latest.set(it.code, it)
      if (!cancelled) {
        setState({ items: [...latest.values()].slice(0, CONFIG.sameDrainChoices), codes: [...latest.keys()], error })
      }
    })()
    return () => {
      cancelled = true
      objectUrls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [name])

  return state
}

type Props = {
  drains: MyDrains
  onPick: (item: SameItem) => void
  onClose: () => void
}

/** 같은 빗물받이를 다시 찍을 때: 번호 대신 내가 찍은 사진을 보고 고른다 */
export function SameDrainPicker({ drains, onPick, onClose }: Props) {
  const { items, error } = drains
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white" style={{ height: '100dvh' }}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 pb-2" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <div>
          <p className="text-[16px] font-bold text-gray-900">어느 빗물받이를 다시 찍었나요?</p>
          <p className="text-[14px] text-gray-700">내가 찍은 빗물받이만 최근 순으로 나옵니다.</p>
        </div>
        <button onClick={onClose} className="h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-[15px] font-semibold text-gray-900">
          닫기
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-gray-900">{error}</p>}
        {items === null ? (
          <p className="text-[15px] text-gray-800">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-[15px] text-gray-800">
            아직 내가 찍은 빗물받이가 없습니다. 닫고 새 빗물받이로 저장해 주세요.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <button key={it.code} onClick={() => onPick(it)} className="overflow-hidden rounded-lg border border-gray-300 text-left">
                <div className="aspect-square bg-gray-100">{it.thumb && <img src={it.thumb} alt="" className="h-full w-full object-cover" />}</div>
                <div className="px-1.5 py-1 text-[13px] leading-tight text-gray-900">
                  <span className="block">{fmtTime(it.takenAt)}</span>
                  <span className="block text-gray-700">{PHASE_LABEL[it.phase]}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
