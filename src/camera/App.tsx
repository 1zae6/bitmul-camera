import { useEffect, useState } from 'react'
import { useAuth } from '../shared/auth'
import { CONFIG } from '../shared/config'
import { LoginScreen } from '../shared/LoginScreen'
import { holdUpdates } from '../shared/pwa'
import { sb } from '../shared/supabase'
import { PHASE_LABEL } from '../shared/types'
import { AiCheck, type AiJob } from './AiCheck'
import { BoxEditor } from './BoxEditor'
import { CameraView, type Captured } from './CameraView'
import { freshFix, geoText, useGeolocation } from './geo'
import { Home } from './Home'
import { canvasToJpeg, encodePhoto } from './image'
import { getAiField } from './prefs'
import { assess } from './quality'
import { addPending, uploadErrorText, useQueue, type PendingRow } from './queue'
import { Review, type ReviewResult, type Shot } from './Review'

export function App() {
  const auth = useAuth()
  if (auth.status === 'loading') return <Splash />
  if (auth.status === 'signedOut')
    return (
      <LoginScreen
        title="빗물받이 촬영기"
        subtitle="팀 비밀번호로 들어갑니다. 이름은 누가 찍었는지 기록하는 데 씁니다."
        nameLabel="내 이름"
      />
    )
  return <Shooter name={auth.name} />
}

type Stage = 'home' | 'camera' | 'review' | 'ai' | 'boxes'

function Shooter({ name }: { name: string }) {
  const demo = new URLSearchParams(window.location.search).has('demo')
  const [stage, setStage] = useState<Stage>('home')
  const [shot, setShot] = useState<Shot | null>(null)
  const [aiJob, setAiJob] = useState<AiJob | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const geo = useGeolocation(stage !== 'home')
  const queue = useQueue()
  const counts = useCounts(name, queue.pending, queue.uploading)
  const fix = freshFix(geo.fix, CONFIG.gpsMaxAgeMs)
  const locationText = geoText(geo.status, fix)

  // 저장 화면·AI 결과 화면에서는 새 버전으로 새로 고치지 않는다
  useEffect(() => holdUpdates(stage === 'review' || stage === 'ai' || stage === 'boxes'), [stage])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(t)
  }, [toast])

  const onCapture = async ({ canvas, mode, torch }: Captured) => {
    const takenAt = new Date().toISOString()
    const quality = assess(canvas, canvas.width, canvas.height, CONFIG.guide, CONFIG.quality.analysisWidth)
    const preview = await canvasToJpeg(canvas, 0.85)
    setShot({ canvas, url: URL.createObjectURL(preview), width: canvas.width, height: canvas.height, mode, torch, takenAt, fix, quality })
    setStage('review')
  }

  const closeShot = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
  }

  const onSave = async (r: ReviewResult) => {
    if (!shot) return
    setSaving(true)
    try {
      const { photo, thumb } = await encodePhoto(shot.canvas)
      const q = assess(shot.canvas, shot.width, shot.height, r.box, CONFIG.quality.analysisWidth)
      const id = crypto.randomUUID()
      const row: PendingRow = {
        id,
        taken_at: shot.takenAt,
        photographer: name,
        drain_code: r.code,
        phase: r.phase,
        memo: r.memo || null,
        width: shot.width,
        height: shot.height,
        box_x: round4(r.box.x),
        box_y: round4(r.box.y),
        box_w: round4(r.box.w),
        box_h: round4(r.box.h),
        lat: shot.fix?.lat ?? null,
        lng: shot.fix?.lng ?? null,
        gps_accuracy: shot.fix ? Math.round(shot.fix.accuracy) : null,
        capture_mode: shot.mode,
        sharpness: q.sharpness,
        brightness: q.brightness,
        is_test: r.isTest,
        device: navigator.userAgent.slice(0, 200),
        // 꺼진 경우는 DB 기본값(false)에 맡겨, 손전등 열이 없는 DB 에도 그대로 올라가게 한다
        ...(shot.torch ? { torch: true } : {}),
      }
      await addPending({ id, photo, thumb, row, addedAt: Date.now(), grade: r.mine })
      if (getAiField()) {
        // 찍고 바로 AI 채점: 사진은 결과 화면이 끝날 때까지 들고 있는다
        setAiJob({ id, code: r.code, phase: r.phase, shot, box: r.box, mine: r.mine })
        setStage('ai')
        return
      }
      closeShot()
      setStage('camera')
      setToast(`${r.code} ${PHASE_LABEL[r.phase]} 저장했습니다. 올리는 중…`)
      void queue.upload().then((res) => {
        if (res.failed) setToast('올리지 못한 사진이 있습니다. 처음 화면에서 다시 올려 주세요.')
        else if (res.uploaded) setToast(`${r.code} 올렸습니다.`)
      })
    } catch (err) {
      setToast(`저장하지 못했습니다. ${uploadErrorText(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {stage === 'home' && (
        <Home name={name} counts={counts} queue={queue} onStart={() => setStage('camera')} onFixBoxes={() => setStage('boxes')} />
      )}
      {stage === 'boxes' && <BoxEditor name={name} onClose={() => setStage('home')} />}
      {(stage === 'camera' || stage === 'review' || stage === 'ai') && (
        <CameraView
          active={stage === 'camera'}
          demo={demo}
          locationText={locationText}
          onCapture={(c) => void onCapture(c)}
          onClose={() => {
            closeShot()
            setStage('home')
          }}
        />
      )}
      {stage === 'review' && shot && (
        <Review
          shot={shot}
          name={name}
          locationText={locationText}
          saving={saving}
          onRetake={() => {
            closeShot()
            setStage('camera')
          }}
          onSave={(r) => void onSave(r)}
        />
      )}
      {stage === 'ai' && aiJob && (
        <AiCheck
          job={aiJob}
          name={name}
          onDone={() => {
            setAiJob(null)
            closeShot()
            setStage('camera')
          }}
          onRetake={() => {
            setAiJob(null)
            closeShot()
            setStage('camera')
            setToast('연습용으로 바꿨습니다. 다시 찍어 주세요.')
          }}
        />
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-32 z-30 flex justify-center px-4">
          <p className="rounded-full bg-gray-900/95 px-4 py-2.5 text-center text-[15px] font-medium text-white">{toast}</p>
        </div>
      )}
    </>
  )
}

/** 올라간 사진 수 (연습용 제외). 대기열이 바뀔 때마다 다시 센다 */
function useCounts(name: string, pending: number, uploading: boolean) {
  const [counts, setCounts] = useState<{ total: number | null; mine: number | null }>({ total: null, mine: null })
  useEffect(() => {
    if (uploading) return
    let cancelled = false
    const base = () => sb().from('photos').select('id', { count: 'exact', head: true }).eq('is_test', false)
    Promise.all([base(), base().eq('photographer', name)])
      .then(([all, mine]) => {
        if (!cancelled) setCounts({ total: all.count ?? null, mine: mine.count ?? null })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [name, pending, uploading])
  return counts
}

function round4(v: number) {
  return Math.round(v * 10000) / 10000
}

function Splash() {
  return <div className="flex h-full items-center justify-center text-[16px] text-gray-800">불러오는 중…</div>
}
