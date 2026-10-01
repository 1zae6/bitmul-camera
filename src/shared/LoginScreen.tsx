import { useState } from 'react'
import { getName, login } from './auth'
import { isConfigured } from './supabase'

type Props = { title: string; subtitle: string; nameLabel: string }

export function LoginScreen({ title, subtitle, nameLabel }: Props) {
  const [name, setName] = useState(getName())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!isConfigured) return <SetupNeeded />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('이름을 입력해 주세요.')
    if (!password) return setError('팀 비밀번호를 입력해 주세요.')
    setBusy(true)
    setError('')
    try {
      await login(name, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-5">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 text-[15px] text-gray-700">{subtitle}</p>
        </div>
        <label className="block">
          <span className="text-[15px] font-medium text-gray-800">{nameLabel}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="예: 한재욱"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-base text-gray-900"
          />
        </label>
        <label className="block">
          <span className="text-[15px] font-medium text-gray-800">팀 비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-base text-gray-900"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-800">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-lg bg-blue-600 text-base font-semibold text-white disabled:bg-blue-300"
        >
          {busy ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-5">
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-amber-300 bg-white p-6">
        <h1 className="text-xl font-bold text-gray-900">설정이 필요합니다</h1>
        <p className="text-[15px] text-gray-800">
          Supabase 연결 정보가 없습니다. 프로젝트 폴더의 <code className="rounded bg-gray-100 px-1">.env</code> 파일에
          아래 세 값을 채운 뒤 다시 실행해 주세요.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-gray-800">
          <li>VITE_SUPABASE_URL</li>
          <li>VITE_SUPABASE_ANON_KEY</li>
          <li>VITE_TEAM_EMAIL</li>
        </ul>
        <p className="text-[15px] text-gray-700">자세한 순서는 README.md 에 있습니다.</p>
      </div>
    </div>
  )
}
