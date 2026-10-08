import { useEffect, useRef, useState } from 'react'
import { boxStyle, containRect } from '../shared/box'
import { CONFIG } from '../shared/config'
import type { CaptureMode } from '../shared/types'
import { useElementSize } from '../shared/useElementSize'
import { demoCanvas, drawScaled, fileToCanvas } from './image'
import { MotionWatcher } from './motion'
import { getAutoCapture, setAutoCapture } from './prefs'
import { laplacianVariance, meanAbsDiff, meanOf, sampleRegion } from './quality'

/** torch: 찍는 순간 손전등이 켜져 있었는지 */
export type Captured = { canvas: HTMLCanvasElement; mode: CaptureMode; torch: boolean }

/** 손전등 버튼 상태. unsupported 면 기본 카메라 앱(플래시 사용 가능)을 안내한다 */
type TorchUi = 'unsupported' | 'off' | 'on'

/** 표준 타입에는 아직 없는 손전등 제약 */
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean }

type Live = {
  /** null = 아직 판단 중 */
  still: boolean | null
  sensor: boolean
  tilt: 'ok' | 'low' | 'unknown'
  sharp: boolean
  bright: boolean
  countdown: number
  numbers: { sharpness: number; brightness: number; diff: number; beta: number | null }
}

const INITIAL: Live = {
  still: null,
  sensor: false,
  tilt: 'unknown',
  sharp: false,
  bright: true,
  countdown: 0,
  numbers: { sharpness: 0, brightness: 0, diff: 0, beta: null },
}

type Props = {
  active: boolean
  demo: boolean
  locationText: string
  onCapture: (c: Captured) => void
  onClose: () => void
}

export function CameraView({ active, demo, locationText, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [boxRef, size] = useElementSize<HTMLDivElement>()
  const [video, setVideo] = useState({ w: 0, h: 0 })
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [autoOn, setAutoOn] = useState(getAutoCapture)
  const [live, setLive] = useState<Live>(INITIAL)
  const [showNumbers, setShowNumbers] = useState(false)
  const [flash, setFlash] = useState(false)
  const [note, setNote] = useState('')

  // 손전등: 지원하는 폰(주로 안드로이드 크롬)에서만 켤 수 있다.
  // 어두우면 촬영 화면마다 한 번 자동으로 켜고, 사람이 직접 켜고 끄면 그 뒤로는 자동으로 건드리지 않는다
  const [track, setTrack] = useState<MediaStreamTrack | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchWanted, setTorchWanted] = useState(false)
  const torchActive = useRef(false)
  const torchTouched = useRef(false)
  const autoTorchDone = useRef(false)
  const torchSupportedRef = useRef(false)
  torchSupportedRef.current = torchSupported

  const motion = useRef(new MotionWatcher())
  const capturing = useRef(false)
  const autoRef = useRef(autoOn)
  autoRef.current = autoOn
  const captureRef = useRef(onCapture)
  captureRef.current = onCapture

  // 카메라 켜기
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 주소에서는 카메라를 쓸 수 없습니다. https 주소로 열어 주세요.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        setTrack(s.getVideoTracks()[0] ?? null)
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          void v.play().catch(() => undefined)
        }
      })
      .catch((err: unknown) => setError(cameraErrorText(err)))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt])

  const showNote = (text: string) => {
    setNote(text)
    window.setTimeout(() => setNote((n) => (n === text ? '' : n)), CONFIG.torch.noteMs)
  }

  // 손전등을 켤 수 있는 카메라인지 (영상이 나오기 시작한 뒤 다시 확인한다)
  const detectTorch = (t: MediaStreamTrack | null) => {
    const caps = t?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
    setTorchSupported(Boolean(caps?.torch))
  }
  useEffect(() => detectTorch(track), [track])

  // 원하는 상태를 카메라에 반영한다. 저장 화면으로 넘어가 촬영 화면이 숨으면 끄고, 돌아오면 다시 켠다
  useEffect(() => {
    if (!track || !torchSupported) return
    const on = torchWanted && active
    const c: TorchConstraint = { torch: on }
    track
      .applyConstraints({ advanced: [c] })
      .then(() => {
        torchActive.current = on
      })
      .catch(() => {
        torchActive.current = false
        if (!on) return
        setTorchSupported(false)
        setTorchWanted(false)
        showNote("이 폰에서는 손전등을 켜지 못했습니다. '기본 카메라'로 찍으면 플래시를 쓸 수 있습니다.")
      })
  }, [track, torchSupported, torchWanted, active])

  const autoTorch = () => {
    if (!torchSupportedRef.current || torchTouched.current || autoTorchDone.current) return
    autoTorchDone.current = true
    setTorchWanted(true)
    showNote('어두워서 손전등을 켰습니다')
  }
  const autoTorchRef = useRef(autoTorch)
  autoTorchRef.current = autoTorch

  const toggleTorch = () => {
    torchTouched.current = true
    setTorchWanted((w) => !w)
  }

  // 움직임·기울기 센서
  useEffect(() => {
    const m = motion.current
    m.start()
    return () => m.stop()
  }, [])

  // 화면으로 돌아오면 다시 찍을 수 있게
  useEffect(() => {
    if (!active) return
    capturing.current = false
    void videoRef.current?.play().catch(() => undefined)
  }, [active])

  const shoot = (mode: CaptureMode) => {
    const v = videoRef.current
    if (!v || !v.videoWidth || capturing.current) return
    capturing.current = true
    const canvas = drawScaled(v, v.videoWidth, v.videoHeight, CONFIG.photo.maxLongEdge)
    navigator.vibrate?.(40)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 160)
    setLive((l) => ({ ...l, countdown: 0 }))
    captureRef.current({ canvas, mode, torch: torchActive.current })
  }
  const shootRef = useRef(shoot)
  shootRef.current = shoot

  // 흔들림·각도·선명도 검사와 자동 촬영
  useEffect(() => {
    if (!active || error || !video.w) return
    const canvas = document.createElement('canvas')
    const a = CONFIG.auto
    let prev: Float32Array | null = null
    let lastUnstable = performance.now()
    let okSince: number | null = null
    let darkSince: number | null = null

    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2 || !v.videoWidth || capturing.current) return
      const now = performance.now()
      const { gray, w, h } = sampleRegion(v, v.videoWidth, v.videoHeight, CONFIG.guide, a.analysisWidth, canvas)
      const sharpness = laplacianVariance(gray, w, h)
      const brightness = meanOf(gray)
      const diff = prev ? meanAbsDiff(prev, gray) : 255
      prev = gray

      const sensorStill = motion.current.stillFor(now)
      let stillMs: number
      if (sensorStill !== null) {
        stillMs = sensorStill
      } else {
        if (diff > a.maxFrameDiff) lastUnstable = now
        stillMs = now - lastUnstable
      }
      const still = stillMs >= a.stableMs
      const beta = motion.current.beta
      const portrait = window.innerHeight >= window.innerWidth
      const tilt: Live['tilt'] =
        beta === null || !portrait ? 'unknown' : beta >= a.minTilt && beta <= a.maxTilt ? 'ok' : 'low'
      const sharp = sharpness >= a.minSharpness
      const bright = brightness >= CONFIG.quality.minBrightness
      const allOk = still && tilt !== 'low' && sharp && bright

      // 어두운 상태가 이어지면 손전등을 한 번 자동으로 켠다
      if (!bright) {
        darkSince ??= now
        if (now - darkSince >= CONFIG.torch.autoOnAfterMs) autoTorchRef.current()
      } else {
        darkSince = null
      }

      let countdown = 0
      if (autoRef.current && allOk) {
        if (okSince === null) okSince = now
        const step = Math.floor((now - okSince) / a.countdownStepMs)
        if (step >= a.countdownSteps) {
          okSince = null
          shootRef.current('auto')
          return
        }
        countdown = a.countdownSteps - step
      } else {
        okSince = null
      }

      setLive({
        still,
        sensor: sensorStill !== null,
        tilt,
        sharp,
        bright,
        countdown,
        numbers: { sharpness: Math.round(sharpness), brightness: Math.round(brightness), diff: Math.round(diff * 10) / 10, beta: beta === null ? null : Math.round(beta) },
      })
    }, 1000 / a.analysisFps)
    return () => window.clearInterval(timer)
  }, [active, error, video.w])

  const onVideoSize = () => {
    const v = videoRef.current
    if (v && v.videoWidth) setVideo({ w: v.videoWidth, h: v.videoHeight })
    // 일부 폰은 영상이 나온 뒤에야 손전등 지원 여부를 알려 준다
    if (!torchSupported) detectTorch(track)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const canvas = await fileToCanvas(f)
      // 기본 카메라 앱의 플래시 사용 여부는 알 수 없다
      captureRef.current({ canvas, mode: 'file', torch: false })
    } catch {
      setNote('사진을 읽지 못했습니다. 다시 골라 주세요.')
    }
  }

  const toggleAuto = () => {
    setAutoOn((on) => {
      setAutoCapture(!on)
      return !on
    })
  }

  const torchUi: TorchUi = !torchSupported ? 'unsupported' : torchWanted ? 'on' : 'off'
  const rect = containRect(size.width, size.height, video.w, video.h)
  const ready = !error && video.w > 0
  const allGood = live.still === true && live.tilt !== 'low' && live.sharp && live.bright
  const frameColor = allGood ? '#16A34A' : '#FFFFFF'

  return (
    <div className={`fixed inset-0 z-10 bg-black text-white select-none ${active ? '' : 'hidden'}`}>
      <div ref={boxRef} className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={onVideoSize}
          onResize={onVideoSize}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {rect && ready && (
          <div className="pointer-events-none absolute" style={rect}>
            <div className="absolute" style={boxStyle(CONFIG.guide)}>
              <GuideCorners color={frameColor} />
              {live.countdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-7xl font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
                    {live.countdown}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {flash && <div className="absolute inset-0 bg-white/80" />}

      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="h-11 rounded-full bg-black/60 px-4 text-[15px] font-semibold">
            닫기
          </button>
          <div className="flex items-center gap-2">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                aria-pressed={torchWanted}
                className={`h-11 rounded-full px-3 text-[15px] font-semibold ${torchWanted ? 'bg-yellow-300 text-gray-900' : 'bg-black/60'}`}
              >
                손전등 {torchWanted ? '켜짐' : '꺼짐'}
              </button>
            )}
            <button
              onClick={toggleAuto}
              className={`h-11 rounded-full px-3 text-[15px] font-semibold ${autoOn ? 'bg-blue-600' : 'bg-black/60'}`}
            >
              자동 촬영 {autoOn ? '켜짐' : '꺼짐'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[14px] text-white">비 올 때 금지 · 인도 쪽에서만 · 덮개 열지 않기 · 사람·번호판 찍지 않기</p>
      </div>

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-semibold">{error}</p>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <button onClick={() => setAttempt((n) => n + 1)} className="h-12 rounded-lg bg-white text-base font-semibold text-gray-900">
              카메라 다시 켜기
            </button>
            <button onClick={() => fileRef.current?.click()} className="h-12 rounded-lg bg-blue-600 text-base font-semibold">
              기본 카메라 앱으로 찍기
            </button>
            {demo && (
              <button onClick={() => captureRef.current({ canvas: demoCanvas(), mode: 'demo', torch: false })} className="h-12 rounded-lg bg-gray-700 text-base font-semibold">
                연습용 샘플 사진 쓰기
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}>
          <p className="text-center text-[16px] font-semibold">{ready ? hintText(live, autoOn, torchUi) : '카메라를 켜는 중…'}</p>
          {torchUi === 'on' && <p className="mt-1 text-center text-[14px] text-yellow-200">빛이 반사되면 폰을 조금 비스듬히 기울여 주세요</p>}
          <button onClick={() => setShowNumbers((s) => !s)} className="mx-auto mt-2 flex flex-wrap justify-center gap-1.5">
            <Chip ok={live.still} label={live.sensor ? '흔들림' : '흔들림(화면)'} />
            <Chip ok={live.tilt === 'unknown' ? null : live.tilt === 'ok'} label="각도" />
            <Chip ok={ready ? live.sharp && live.bright : null} label="선명" />
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[13px]">{locationText}</span>
          </button>
          {showNumbers && (
            <p className="mt-1 text-center text-[13px] text-gray-200">
              선명도 {live.numbers.sharpness}(기준 {CONFIG.auto.minSharpness}) · 밝기 {live.numbers.brightness} · 화면 변화 {live.numbers.diff} · 기울기 {live.numbers.beta ?? '-'}°
            </p>
          )}
          {note && <p className="mt-1 text-center text-[14px] text-amber-300">{note}</p>}
          <div className="mt-3 grid grid-cols-3 items-center">
            <button onClick={() => fileRef.current?.click()} className="h-11 justify-self-start rounded-lg bg-black/60 px-3 text-[14px] font-semibold">
              기본 카메라
            </button>
            <button
              onClick={() => shoot('manual')}
              disabled={!ready}
              aria-label="찍기"
              className="h-[76px] w-[76px] justify-self-center rounded-full border-[5px] border-white bg-white/25 active:bg-white/60 disabled:opacity-40"
            />
            {demo ? (
              <button onClick={() => captureRef.current({ canvas: demoCanvas(), mode: 'demo', torch: false })} className="h-11 justify-self-end rounded-lg bg-black/60 px-3 text-[14px] font-semibold">
                샘플 사진
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
    </div>
  )
}

function GuideCorners({ color }: { color: string }) {
  const s = { borderColor: color }
  const c = 'absolute h-9 w-9'
  return (
    <>
      <div className="absolute inset-0 border-2 border-dashed" style={{ borderColor: `${color}99` }} />
      <div className={`${c} left-0 top-0 border-l-[5px] border-t-[5px]`} style={s} />
      <div className={`${c} right-0 top-0 border-r-[5px] border-t-[5px]`} style={s} />
      <div className={`${c} bottom-0 left-0 border-b-[5px] border-l-[5px]`} style={s} />
      <div className={`${c} bottom-0 right-0 border-b-[5px] border-r-[5px]`} style={s} />
    </>
  )
}

function Chip({ ok, label }: { ok: boolean | null; label: string }) {
  const style = ok === null ? 'bg-black/60 text-gray-200' : ok ? 'bg-green-600 text-white' : 'bg-black/60 text-white'
  const mark = ok === null ? '–' : ok ? '✓' : '…'
  return (
    <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${style}`}>
      {label} {mark}
    </span>
  )
}

function hintText(l: Live, auto: boolean, torch: TorchUi): string {
  if (l.countdown > 0) return '그대로 멈춰 주세요'
  if (l.tilt === 'low') return '폰을 더 숙여서 바닥을 내려다봐 주세요'
  if (!l.bright) {
    if (torch === 'off') return '어둡습니다. 위의 손전등을 켜 주세요'
    if (torch === 'on') return '손전등을 켜도 어둡습니다. 조금 더 가까이 비춰 주세요'
    return "어둡습니다. 왼쪽 아래 '기본 카메라'로 찍으면 플래시를 쓸 수 있습니다"
  }
  if (l.still === false) return '폰을 잠깐 멈춰 주세요'
  if (l.still === true && !l.sharp) return '흐립니다. 조금 떨어져서 찍어 주세요'
  return auto ? '흰 틀 안에 빗물받이를 맞추고 멈추면 자동으로 찍힙니다' : '흰 틀 안에 빗물받이를 맞추고 찍기를 눌러 주세요'
}

function cameraErrorText(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return '카메라 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 카메라를 허용해 주세요.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '쓸 수 있는 카메라를 찾지 못했습니다.'
  if (name === 'NotReadableError') return '다른 앱이 카메라를 쓰고 있습니다. 그 앱을 닫고 다시 켜 주세요.'
  return '카메라를 켜지 못했습니다.'
}
