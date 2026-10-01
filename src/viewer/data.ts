import { useCallback, useEffect, useState } from 'react'
import { CONFIG } from '../shared/config'
import { sb } from '../shared/supabase'
import type { GradeRow, PhotoRow } from '../shared/types'

export function errorText(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err)
  if (/fetch|network/i.test(msg)) return '인터넷 연결을 확인해 주세요.'
  if (/relation .* does not exist|could not find the table/i.test(msg))
    return '테이블이 없습니다. Supabase에서 supabase/schema.sql 을 실행했는지 확인해 주세요.'
  return msg
}

/** 사진과 등급을 한 번에 불러온다. Supabase 기본 설정상 한 번에 최대 1000줄까지 온다 */
export function useData() {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [grades, setGrades] = useState<GradeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [p, g] = await Promise.all([
        sb().from('photos').select('*').order('taken_at', { ascending: false }),
        sb().from('grades').select('*'),
      ])
      if (p.error) throw p.error
      if (g.error) throw g.error
      setPhotos((p.data ?? []) as PhotoRow[])
      setGrades((g.data ?? []) as GradeRow[])
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { photos, setPhotos, grades, setGrades, loading, error, reload }
}

// 사진 저장소는 비공개라 잠깐만 열리는 주소(서명 URL)를 받아서 보여 준다
const urlCache = new Map<string, { url: string; until: number }>()

export async function signUrls(paths: string[]) {
  const now = Date.now()
  const need = [...new Set(paths)].filter((p) => {
    const c = urlCache.get(p)
    return !c || c.until < now
  })
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100)
    const { data, error } = await sb().storage.from(CONFIG.bucket).createSignedUrls(batch, CONFIG.signedUrlSeconds)
    if (error) throw error
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) urlCache.set(d.path, { url: d.signedUrl, until: now + (CONFIG.signedUrlSeconds - 120) * 1000 })
    }
  }
}

function cachedUrl(path: string): string | undefined {
  const c = urlCache.get(path)
  return c && c.until > Date.now() ? c.url : undefined
}

export async function getSignedUrl(path: string): Promise<string> {
  await signUrls([path])
  const url = cachedUrl(path)
  if (!url) throw new Error('사진 주소를 받지 못했습니다')
  return url
}

export function useSignedUrls(paths: string[]): Record<string, string> {
  const key = paths.join('|')
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    const list = key ? key.split('|') : []
    signUrls(list)
      .then(() => {
        if (cancelled) return
        const m: Record<string, string> = {}
        for (const p of list) {
          const u = cachedUrl(p)
          if (u) m[p] = u
        }
        setMap(m)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [key])
  return map
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Cell = string | number | boolean | null | undefined

/** 엑셀에서 한글이 깨지지 않도록 BOM 을 붙인 CSV */
export function toCsv(header: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(name: string, csv: string) {
  downloadBlob(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
}
