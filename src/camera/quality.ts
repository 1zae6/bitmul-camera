import type { Box } from '../shared/types'

// 사진 품질을 숫자로 잰다. 학습 데이터 없이 픽셀 계산만 한다.

export function toGray(data: Uint8ClampedArray): Float32Array {
  const n = data.length / 4
  const g = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  return g
}

/** 선명도: 라플라시안 분산. 흐리면 작아진다 */
export function laplacianVariance(g: Float32Array, w: number, h: number): number {
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      sum += v
      sum2 += v * v
      n++
    }
  }
  if (!n) return 0
  const mean = sum / n
  return sum2 / n - mean * mean
}

/** 밝기: 0(검정)~255(흰색) 평균 */
export function meanOf(g: Float32Array): number {
  let s = 0
  for (let i = 0; i < g.length; i++) s += g[i]
  return g.length ? s / g.length : 0
}

/** 두 프레임의 평균 밝기 차이. 폰이나 장면이 움직이면 커진다 */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 255
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

/** 원본(srcW×srcH)의 box 영역을 targetW 폭으로 줄여 흑백으로 읽는다 */
export function sampleRegion(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  box: Box,
  targetW: number,
  canvas: HTMLCanvasElement,
) {
  const sx = box.x * srcW
  const sy = box.y * srcH
  const sw = Math.max(1, box.w * srcW)
  const sh = Math.max(1, box.h * srcH)
  const w = Math.max(8, Math.round(targetW))
  const h = Math.max(8, Math.round((targetW * sh) / sw))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { gray: new Float32Array(0), w, h }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)
  return { gray: toGray(ctx.getImageData(0, 0, w, h).data), w, h }
}

export function assess(src: CanvasImageSource, srcW: number, srcH: number, box: Box, targetW: number) {
  const { gray, w, h } = sampleRegion(src, srcW, srcH, box, targetW, document.createElement('canvas'))
  return {
    sharpness: Math.round(laplacianVariance(gray, w, h) * 10) / 10,
    brightness: Math.round(meanOf(gray) * 10) / 10,
  }
}
