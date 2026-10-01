import { CONFIG } from './config'
import type { Box } from './types'

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 박스를 한 변마다 박스 크기 × pad 만큼 넓히고 사진 안으로 자른다 */
export function expandBox(b: Box, pad: number): Box {
  const x0 = clamp(b.x - b.w * pad, 0, 1)
  const y0 = clamp(b.y - b.h * pad, 0, 1)
  const x1 = clamp(b.x + b.w * (1 + pad), 0, 1)
  const y1 = clamp(b.y + b.h * (1 + pad), 0, 1)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export type DragMode = { move: true } | { move: false; n: boolean; s: boolean; e: boolean; w: boolean }

/** 드래그 시작 박스에서 (dx, dy)만큼 움직였을 때의 새 박스. 값은 사진 대비 비율 */
export function dragBox(start: Box, mode: DragMode, dx: number, dy: number): Box {
  if (mode.move) {
    return {
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    }
  }
  const min = CONFIG.minBoxSize
  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h
  if (mode.w) l = clamp(l + dx, 0, r - min)
  if (mode.e) r = clamp(r + dx, l + min, 1)
  if (mode.n) t = clamp(t + dy, 0, b - min)
  if (mode.s) b = clamp(b + dy, t + min, 1)
  return { x: l, y: t, w: r - l, h: b - t }
}

export function boxStyle(b: Box): { left: string; top: string; width: string; height: string } {
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
  }
}

/** 컨테이너(cw×ch) 안에 사진(iw×ih)을 비율 유지로 넣었을 때 사진이 놓이는 위치 */
export function containRect(cw: number, ch: number, iw: number, ih: number) {
  if (!cw || !ch || !iw || !ih) return null
  const scale = Math.min(cw / iw, ch / ih)
  const w = iw * scale
  const h = ih * scale
  return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h }
}
