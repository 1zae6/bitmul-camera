/** 사진 폭·높이에 대한 비율(0~1)로 나타낸 박스 */
export type Box = { x: number; y: number; w: number; h: number }

export type Phase = 'before' | 'after' | 'revisit'

export const PHASES: { value: Phase; label: string }[] = [
  { value: 'before', label: '청소 전' },
  { value: 'after', label: '청소 후' },
  { value: 'revisit', label: '재방문' },
]

export const PHASE_LABEL: Record<Phase, string> = {
  before: '청소 전',
  after: '청소 후',
  revisit: '재방문',
}

export type CaptureMode = 'auto' | 'manual' | 'file' | 'demo'

export const CAPTURE_MODE_LABEL: Record<CaptureMode, string> = {
  auto: '자동 촬영',
  manual: '수동 촬영',
  file: '기본 카메라 앱',
  demo: '샘플(연습용)',
}

/** public.photos 테이블 한 줄 */
export type PhotoRow = {
  id: string
  created_at?: string
  taken_at: string
  photographer: string
  drain_code: string
  phase: Phase
  memo: string | null
  storage_path: string
  thumb_path: string
  width: number
  height: number
  box_x: number
  box_y: number
  box_w: number
  box_h: number
  lat: number | null
  lng: number | null
  gps_accuracy: number | null
  capture_mode: CaptureMode
  sharpness: number | null
  brightness: number | null
  is_test: boolean
  device: string | null
  /** 손전등을 켜고 찍었는지. supabase/schema.sql 8절의 열을 만들기 전 DB 에는 없다 */
  torch?: boolean
}

/** public.grades 테이블 한 줄. 판단 불가면 grade 는 null. needs_report 는 등급과 별개인 '신고 필요' 표시 */
export type GradeRow = {
  photo_id: string
  grader: string
  grade: number | null
  unusable: boolean
  needs_report: boolean
  updated_at?: string
}

/** 등급 입력 한 번에 고르는 값 */
export type GradeInput = { grade: number | null; unusable: boolean; needs_report: boolean }

/** zero = 등급 기준 문장만, few = 등급별 예시 사진도 함께 보냄 */
export type AiMode = 'zero' | 'few'

/** public.ai_runs: AI 채점을 한 번 돌린 기록 */
export type AiRunRow = {
  run_id: string
  label: string
  model: string
  mode: AiMode
  prompt_version: string
  example_ids: string[]
  created_by: string
  created_at?: string
}

/** public.ai_grades: 실행 1회 × 사진 1장의 AI 판정. 판단 불가면 grade 는 null */
export type AiGradeRow = {
  run_id: string
  photo_id: string
  grade: number | null
  unusable: boolean
  needs_report: boolean | null
  is_drain: boolean | null
  /** v3부터: 덮개를 가린 비율, 주변을 덮은 비율. covered_percent 는 둘 중 큰 값(v2까지는 흰 점선 전체 비율) */
  grate_percent: number | null
  around_percent: number | null
  covered_percent: number | null
  confidence: number | null
  causes: string[] | null
  reason: string | null
  latency_ms: number | null
  created_at?: string
}

export function rowBox(p: Pick<PhotoRow, 'box_x' | 'box_y' | 'box_w' | 'box_h'>): Box {
  return { x: p.box_x, y: p.box_y, w: p.box_w, h: p.box_h }
}
