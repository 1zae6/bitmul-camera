// 빗물받이 촬영기: Gemini 를 대신 불러 주는 Supabase 서버 함수 (Edge Function)
//
// 만드는 법: Supabase → Edge Functions → Deploy a new function → Via Editor
//   이름을 grade-photo 로 하고, 이 파일 내용을 통째로 붙여 넣은 뒤 Deploy function.
// 필요한 비밀값: Edge Functions → Secrets 에 GEMINI_API_KEY
//
// 로그인한 팀 계정만 부를 수 있고, 키는 이 서버에만 있다(폰·PC·GitHub 에는 없다).
// 지시문과 사진은 앱이 만들어 보내고, 이 함수는 키를 붙여 Gemini 에 전달만 한다.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 앱의 src/shared/config.ts 모델 목록과 같아야 한다 */
const MODELS = new Set(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'])

/** 사진 여러 장(예시 포함)을 넣어도 넉넉한 크기 */
const MAX_BODY = 6_000_000

function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, source: 'function' } }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function publicKey(): string {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY')
  if (legacy) return legacy
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')
    return String(Object.values(keys)[0] ?? '')
  } catch {
    return ''
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail(405, 'POST 요청만 받습니다')

  // 로그인한 사람인지 확인 (공개용 키만으로는 통과하지 못한다)
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: req.headers.get('Authorization') ?? '', apikey: publicKey() },
  })
  if (!who.ok) return fail(401, '로그인이 필요합니다')

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return fail(500, 'GEMINI_API_KEY 비밀값이 없습니다. Edge Functions → Secrets 에 넣어 주세요')

  const text = await req.text()
  if (text.length > MAX_BODY) return fail(413, '보낸 사진이 너무 큽니다')
  let body: { model?: string; contents?: unknown; generationConfig?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, '요청 형식이 잘못됐습니다')
  }
  if (!body.model || !MODELS.has(body.model)) return fail(400, `허용되지 않은 모델입니다: ${body.model}`)

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: body.contents, generationConfig: body.generationConfig }),
  })
  // Gemini 의 응답(한도 초과 429 포함)을 그대로 돌려줘서 앱이 같은 방식으로 처리한다
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
