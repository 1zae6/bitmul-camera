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
}

/** public.grades 테이블 한 줄. 판단 불가면 grade 는 null */
export type GradeRow = {
  photo_id: string
  grader: string
  grade: number | null
  unusable: boolean
  updated_at?: string
}

export function rowBox(p: Pick<PhotoRow, 'box_x' | 'box_y' | 'box_w' | 'box_h'>): Box {
  return { x: p.box_x, y: p.box_y, w: p.box_w, h: p.box_h }
}
