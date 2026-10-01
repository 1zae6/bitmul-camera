import { CONFIG } from '../shared/config'

/** 원본을 긴 변 maxLong 이하로 줄여 새 캔버스에 그린다 */
export function drawScaled(src: CanvasImageSource, srcW: number, srcH: number, maxLong: number): HTMLCanvasElement {
  const scale = Math.min(1, maxLong / Math.max(srcW, srcH))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(srcW * scale)
  canvas.height = Math.round(srcH * scale)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 만들지 못했습니다'))), 'image/jpeg', quality),
  )
}

/** 저장용 사진과 목록용 작은 사진을 만든다. 캔버스로 다시 그리므로 원본 파일의 위치 정보(EXIF)는 남지 않는다 */
export async function encodePhoto(canvas: HTMLCanvasElement) {
  const photo = await canvasToJpeg(canvas, CONFIG.photo.jpegQuality)
  const small = drawScaled(canvas, canvas.width, canvas.height, CONFIG.photo.thumbLongEdge)
  const thumb = await canvasToJpeg(small, CONFIG.photo.thumbQuality)
  return { photo, thumb }
}

/** 기본 카메라 앱이나 갤러리에서 고른 사진을 캔버스로 읽는다 (사진 방향은 브라우저가 맞춰 준다) */
export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return drawScaled(img, img.naturalWidth, img.naturalHeight, CONFIG.photo.maxLongEdge)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 카메라가 없는 PC에서 흐름을 시험할 때 쓰는 가짜 빗물받이 사진 (주소 끝에 ?demo=1) */
export function demoCanvas(): HTMLCanvasElement {
  const w = 1080
  const h = 1440
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#6b7280'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 9000; i++) {
    const v = 90 + Math.floor(Math.random() * 70)
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
  }
  const gx = w * 0.22
  const gy = h * 0.34
  const gw = w * 0.56
  const gh = h * 0.32
  ctx.fillStyle = '#1f2937'
  ctx.fillRect(gx, gy, gw, gh)
  ctx.fillStyle = '#0b0f19'
  for (let k = 0; k < 9; k++) ctx.fillRect(gx + 24 + k * ((gw - 48) / 9), gy + 24, (gw - 48) / 9 - 14, gh - 48)
  const leaves = ['#a16207', '#92400e', '#ca8a04', '#78350f']
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = leaves[i % leaves.length]
    ctx.beginPath()
    ctx.ellipse(gx + Math.random() * gw * 0.6, gy + Math.random() * gh, 18, 9, Math.random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 44px sans-serif'
  ctx.fillText('연습용 샘플', 40, 80)
  return c
}
