import { useCallback, useEffect, useState } from 'react'
import { CONFIG } from '../shared/config'
import { sb } from '../shared/supabase'
import type { PhotoRow } from '../shared/types'

// 찍은 사진은 먼저 폰 안(IndexedDB)에 넣고, 올리기에 성공하면 지운다. 인터넷이 끊겨도 사진을 잃지 않는다.

export type PendingRow = Omit<PhotoRow, 'storage_path' | 'thumb_path' | 'created_at'>
export type Pending = { id: string; photo: Blob; thumb: Blob; row: PendingRow; addedAt: number; error?: string }

const DB_NAME = 'bitmul-camera'
const STORE = 'pending'
const QUEUE_EVENT = 'bitmul-camera:queue-changed'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function changed() {
  window.dispatchEvent(new Event(QUEUE_EVENT))
}

export async function addPending(p: Pending) {
  await run('readwrite', (s) => s.put(p))
  changed()
}

export function listPending(): Promise<Pending[]> {
  return run('readonly', (s) => s.getAll() as IDBRequest<Pending[]>)
}

async function removePending(id: string) {
  await run('readwrite', (s) => s.delete(id))
  changed()
}

async function markError(p: Pending, error: string) {
  await run('readwrite', (s) => s.put({ ...p, error }))
  changed()
}

async function uploadOne(p: Pending) {
  const day = p.row.taken_at.slice(0, 10)
  const path = `photos/${day}/${p.id}.jpg`
  const thumbPath = `thumbs/${day}/${p.id}.jpg`
  const bucket = sb().storage.from(CONFIG.bucket)
  const a = await bucket.upload(path, p.photo, { contentType: 'image/jpeg', upsert: true })
  if (a.error) throw a.error
  const b = await bucket.upload(thumbPath, p.thumb, { contentType: 'image/jpeg', upsert: true })
  if (b.error) throw b.error
  const { error } = await sb()
    .from('photos')
    .upsert({ ...p.row, id: p.id, storage_path: path, thumb_path: thumbPath })
  if (error) throw error
}

export function uploadErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (/fetch|network|load failed/i.test(msg)) return '인터넷 연결이 없어 올리지 못했습니다.'
  if (/bucket not found/i.test(msg)) return '사진 저장소가 없습니다. supabase/schema.sql 을 실행했는지 확인해 주세요.'
  if (/row-level security|permission|not authorized|unauthorized|jwt/i.test(msg))
    return '권한이 없습니다. 다시 로그인하거나 Supabase 설정을 확인해 주세요.'
  return `올리지 못했습니다: ${msg}`
}

let running: Promise<{ uploaded: number; failed: number }> | null = null

/** 대기 중인 사진을 하나씩 올린다. 이미 올리는 중이면 그 작업을 기다린다 */
export function uploadAll() {
  if (running) return running
  running = (async () => {
    let uploaded = 0
    let failed = 0
    const items = (await listPending()).sort((a, b) => a.addedAt - b.addedAt)
    for (const p of items) {
      try {
        await uploadOne(p)
        await removePending(p.id)
        uploaded++
      } catch (err) {
        failed++
        await markError(p, uploadErrorText(err))
      }
    }
    return { uploaded, failed }
  })().finally(() => {
    running = null
  })
  return running
}

/** 화면에 대기 장수와 마지막 오류를 보여 주기 위한 훅 */
export function useQueue() {
  const [items, setItems] = useState<Pending[]>([])
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(() => {
    listPending()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  const upload = useCallback(async () => {
    setUploading(true)
    try {
      return await uploadAll()
    } finally {
      setUploading(false)
      refresh()
    }
  }, [refresh])

  useEffect(() => {
    refresh()
    window.addEventListener(QUEUE_EVENT, refresh)
    const onOnline = () => void upload()
    window.addEventListener('online', onOnline)
    void upload()
    return () => {
      window.removeEventListener(QUEUE_EVENT, refresh)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh, upload])

  const lastError = items.find((p) => p.error)?.error ?? ''
  return { pending: items.length, uploading, lastError, upload }
}
