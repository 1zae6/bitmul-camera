import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// API 화면에서 REST 주소(…/rest/v1/)를 복사해 넣어도 동작하도록 기본 주소만 남긴다
const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** 팀 공용 계정 이메일. 비밀번호는 코드에 두지 않고 로그인 화면에서만 입력받는다 */
export const TEAM_EMAIL = import.meta.env.VITE_TEAM_EMAIL ?? ''

export const isConfigured = Boolean(url && key && TEAM_EMAIL)

const client: SupabaseClient | null = isConfigured ? createClient(url!, key!) : null

/** 설정이 끝난 뒤에만 부른다 (설정 전에는 SetupNeeded 화면이 먼저 뜬다) */
export function sb(): SupabaseClient {
  if (!client) throw new Error('Supabase 설정(.env)이 없습니다')
  return client
}
