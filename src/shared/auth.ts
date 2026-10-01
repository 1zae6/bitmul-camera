import { useEffect, useState } from 'react'
import { isConfigured, sb, TEAM_EMAIL } from './supabase'

// 팀 공용 계정 하나로 로그인하고, 누가 찍었는지·매겼는지는 입력한 이름으로 구분한다
const NAME_KEY = 'bitmul-camera:name'
const NAME_EVENT = 'bitmul-camera:name-changed'

export function getName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim())
  } catch {
    // 저장이 막힌 브라우저에서도 이번 화면에서는 그대로 쓴다
  }
  window.dispatchEvent(new Event(NAME_EVENT))
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

export function useAuth(): { status: AuthStatus; name: string } {
  const [hasSession, setHasSession] = useState<boolean | null>(isConfigured ? null : false)
  const [name, setName] = useState(getName())

  useEffect(() => {
    if (!isConfigured) return
    const client = sb()
    client.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)))
    const { data } = client.auth.onAuthStateChange((_event, session) => setHasSession(Boolean(session)))
    const onName = () => setName(getName())
    window.addEventListener(NAME_EVENT, onName)
    return () => {
      data.subscription.unsubscribe()
      window.removeEventListener(NAME_EVENT, onName)
    }
  }, [])

  const status: AuthStatus = hasSession === null ? 'loading' : hasSession && name ? 'signedIn' : 'signedOut'
  return { status, name }
}

export async function login(name: string, password: string) {
  saveName(name)
  const { error } = await sb().auth.signInWithPassword({ email: TEAM_EMAIL, password })
  if (error) throw new Error(loginErrorText(error.message))
}

export async function logout() {
  await sb().auth.signOut()
}

function loginErrorText(message: string): string {
  if (/invalid login credentials/i.test(message)) return '비밀번호가 맞지 않습니다.'
  if (/email not confirmed/i.test(message))
    return '팀 계정이 아직 인증되지 않았습니다. Supabase에서 계정을 만들 때 Auto Confirm User를 켜야 합니다.'
  if (/fetch|network/i.test(message)) return '인터넷 연결을 확인해 주세요.'
  return `로그인하지 못했습니다: ${message}`
}
