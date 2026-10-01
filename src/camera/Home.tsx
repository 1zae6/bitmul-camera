import { useEffect, useState } from 'react'
import { logout, saveName } from '../shared/auth'
import { CONFIG } from '../shared/config'
import { requestMotionPermission } from './motion'

type Props = {
  name: string
  counts: { total: number | null; mine: number | null }
  queue: { pending: number; uploading: boolean; lastError: string; upload: () => Promise<unknown> }
  onStart: () => void
}

export function Home({ name, counts, queue, onStart }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const viewerUrl = new URL('viewer.html', window.location.href).href
  const total = counts.total ?? 0
  const percent = Math.min(100, Math.round((total / CONFIG.goal) * 100))

  const start = () => {
    // 아이폰은 이 클릭 안에서 바로 권한을 물어야 움직임 센서를 쓸 수 있다
    void requestMotionPermission().finally(onStart)
  }

  return (
    <div className="flex min-h-full flex-col bg-white" style={{ minHeight: '100dvh' }}>
      <div className="bg-amber-50 px-4 pb-2 text-[15px] font-medium text-gray-900" style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)' }}>
        비 올 때 촬영 금지 · 인도 쪽에서만 · 덮개 열지 않기 · 사람 얼굴·차량 번호판 찍지 않기
      </div>

      <div className="flex-1 space-y-4 px-4 py-4">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900">빗물받이 촬영기</h1>
          {renaming ? (
            <div className="mt-2 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={20}
                className="h-11 flex-1 rounded-lg border border-gray-300 px-3 text-base text-gray-900"
              />
              <button
                onClick={() => {
                  if (draft.trim()) saveName(draft)
                  setRenaming(false)
                }}
                className="h-11 rounded-lg bg-blue-600 px-4 text-[15px] font-semibold text-white"
              >
                저장
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-[16px] text-gray-800">
              <span>촬영자 {name}</span>
              <button onClick={() => setRenaming(true)} className="min-h-11 px-2 text-[15px] font-semibold text-blue-700">
                이름 바꾸기
              </button>
            </div>
          )}
        </div>

        <section className="rounded-xl border border-gray-200 p-4">
          <p className="text-[15px] font-semibold text-gray-800">모은 사진</p>
          <p className="mt-1 text-[28px] font-bold text-gray-900">
            {counts.total ?? '-'}
            <span className="text-[17px] font-semibold text-gray-700"> / {CONFIG.goal}장</span>
          </p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[15px] text-gray-800">내가 올린 사진 {counts.mine ?? '-'}장 · 연습용은 세지 않습니다</p>
        </section>

        {queue.pending > 0 && (
          <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-[16px] font-semibold text-gray-900">아직 안 올라간 사진 {queue.pending}장</p>
            {queue.lastError && <p className="text-[15px] text-red-800">{queue.lastError}</p>}
            <button
              onClick={() => void queue.upload()}
              disabled={queue.uploading}
              className="h-11 w-full rounded-lg bg-gray-900 text-[15px] font-semibold text-white disabled:bg-gray-500"
            >
              {queue.uploading ? '올리는 중…' : '다시 올리기'}
            </button>
          </section>
        )}

        <section className="rounded-xl bg-gray-50 p-4">
          <p className="text-[15px] font-semibold text-gray-900">찍는 순서</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-gray-800">
            <li>흰 틀 안에 빗물받이를 맞추고 폰을 멈추면 자동으로 찍힙니다.</li>
            <li>빨간 박스를 빗물받이 덮개 테두리에 맞춥니다.</li>
            <li>빗물받이 번호와 청소 전·후를 고르고 저장합니다.</li>
            <li>PC 뷰어에서 사진을 확인하고 등급을 매깁니다.</li>
          </ol>
        </section>

        <InstallHint />
      </div>

      <div className="space-y-2 px-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}>
        <button onClick={start} className="h-16 w-full rounded-2xl bg-blue-600 text-[19px] font-bold text-white">
          촬영 시작
        </button>
        <div className="flex items-center justify-between text-[14px] text-gray-700">
          <span className="truncate">PC 뷰어: {viewerUrl}</span>
          <button onClick={() => void logout()} className="min-h-11 shrink-0 pl-3 font-semibold text-gray-800">
            로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

type InstallEvent = Event & { prompt: () => Promise<void> }

function InstallHint() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (standalone) return null

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-[15px] text-gray-900">
      {deferred ? (
        <button
          onClick={() => void deferred.prompt().finally(() => setDeferred(null))}
          className="h-11 w-full rounded-lg bg-blue-600 font-semibold text-white"
        >
          홈 화면에 앱 설치
        </button>
      ) : ios ? (
        '사파리 아래쪽 공유 버튼 → "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있습니다.'
      ) : (
        '브라우저 메뉴 → "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 쓸 수 있습니다.'
      )}
    </section>
  )
}
