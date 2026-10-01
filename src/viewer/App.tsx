import { useMemo, useState } from 'react'
import { logout, useAuth } from '../shared/auth'
import { CONFIG } from '../shared/config'
import { LoginScreen } from '../shared/LoginScreen'
import type { GradeRow } from '../shared/types'
import { AgreementView } from './AgreementView'
import { AiView } from './AiView'
import { useAiData, useData } from './data'
import { GradeView } from './GradeView'
import { MapView } from './MapView'
import { PhotoDetail } from './PhotoDetail'
import { PhotoList } from './PhotoList'

export function App() {
  const auth = useAuth()
  if (auth.status === 'loading')
    return <div className="flex h-full items-center justify-center text-gray-800">불러오는 중…</div>
  if (auth.status === 'signedOut')
    return (
      <LoginScreen
        title="빗물받이 사진 뷰어"
        subtitle="팀 비밀번호로 들어갑니다. 이름은 등급을 매긴 사람을 구분하는 데 씁니다."
        nameLabel="내 이름 (채점자)"
      />
    )
  return <Viewer name={auth.name} />
}

type Tab = 'list' | 'map' | 'grade' | 'agree' | 'ai'
const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '사진 목록' },
  { id: 'map', label: '지도' },
  { id: 'grade', label: '등급 매기기' },
  { id: 'agree', label: '일치율 · 정답지' },
  { id: 'ai', label: 'AI 채점 (Gemini)' },
]

function Viewer({ name }: { name: string }) {
  const data = useData()
  const ai = useAiData()
  const [tab, setTab] = useState<Tab>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)

  const real = useMemo(() => data.photos.filter((p) => !p.is_test), [data.photos])
  const visible = showTest ? data.photos : real
  const selected = data.photos.find((p) => p.id === selectedId) ?? null
  const myGrades = useMemo(
    () => new Map(data.grades.filter((g) => g.grader === name).map((g) => [g.photo_id, g])),
    [data.grades, name],
  )
  const cameraUrl = new URL('./', window.location.href).href

  const upsertGrade = (g: GradeRow) =>
    data.setGrades((gs) => [...gs.filter((x) => !(x.photo_id === g.photo_id && x.grader === g.grader)), g])

  return (
    <div className="flex h-full flex-col text-sm text-gray-900">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-200 px-4">
        <h1 className="text-base font-bold">빗물받이 사진 뷰어</h1>
        <span className="text-gray-700">
          모은 사진 {real.length}장 / 목표 {CONFIG.goal}장 · 연습용 {data.photos.length - real.length}장
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-gray-700">채점자 {name}</span>
          <button
            onClick={() => void Promise.all([data.reload(), ai.reload()])}
            className="h-8 rounded-md border border-gray-300 px-3 font-medium"
          >
            {data.loading ? '불러오는 중…' : '새로고침'}
          </button>
          <button onClick={() => void logout()} className="h-8 rounded-md px-3 font-medium text-gray-800 hover:bg-gray-100">
            로그아웃
          </button>
        </div>
      </header>
      {data.error && <div className="bg-red-50 px-4 py-2 text-red-800">{data.error}</div>}

      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 space-y-1 border-r border-gray-200 bg-gray-50 p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full rounded-md px-3 py-2 text-left font-medium ${tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
          {(tab === 'list' || tab === 'map') && (
            <label className="mt-3 flex items-center gap-2 px-3 text-gray-800">
              <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
              연습용도 보기
            </label>
          )}
          <div className="px-3 pt-4 text-gray-700">
            <p className="font-medium text-gray-800">폰 촬영 주소</p>
            <p className="break-all">{cameraUrl}</p>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto">
          {tab === 'list' && <PhotoList photos={visible} myGrades={myGrades} selectedId={selectedId} onSelect={setSelectedId} />}
          {tab === 'map' && <MapView photos={visible} selectedId={selectedId} onSelect={setSelectedId} />}
          {tab === 'grade' && <GradeView photos={real} grades={data.grades} name={name} onGraded={upsertGrade} />}
          {tab === 'agree' && <AgreementView photos={real} grades={data.grades} onSelect={setSelectedId} />}
          {tab === 'ai' && <AiView photos={data.photos} grades={data.grades} name={name} onSelect={setSelectedId} ai={ai} />}
        </main>

        {selected && tab !== 'grade' && (
          <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-gray-200">
            <PhotoDetail
              key={selected.id}
              photo={selected}
              myGrade={myGrades.get(selected.id)}
              aiRows={ai.aiRows.filter((r) => r.photo_id === selected.id)}
              runs={ai.runs}
              onClose={() => setSelectedId(null)}
              onUpdated={(p) => data.setPhotos((ps) => ps.map((x) => (x.id === p.id ? p : x)))}
              onDeleted={(id) => {
                ai.setAiRows((rows) => rows.filter((r) => r.photo_id !== id))
                data.setPhotos((ps) => ps.filter((x) => x.id !== id))
                data.setGrades((gs) => gs.filter((g) => g.photo_id !== id))
                setSelectedId(null)
              }}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
