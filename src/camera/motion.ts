import { CONFIG } from '../shared/config'

type PermissionFn = () => Promise<'granted' | 'denied'>

/**
 * 아이폰은 움직임 센서를 쓰려면 버튼을 누른 순간에 권한을 물어야 한다.
 * 반드시 클릭 처리 함수 안에서 바로 부른다.
 */
export async function requestMotionPermission(): Promise<boolean> {
  const motion = (window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent
  const orient = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } })
    .DeviceOrientationEvent
  const asks: Promise<'granted' | 'denied'>[] = []
  if (motion?.requestPermission) asks.push(motion.requestPermission())
  if (orient?.requestPermission) asks.push(orient.requestPermission())
  if (!asks.length) return true
  try {
    const results = await Promise.all(asks)
    return results.every((r) => r === 'granted')
  } catch {
    return false
  }
}

/** 폰이 멈춰 있는지와 얼마나 기울었는지 센서로 따라간다. 센서가 없으면 null 을 돌려준다 */
export class MotionWatcher {
  available = false
  beta: number | null = null
  private lastMovingAt = 0

  private onMotion = (e: DeviceMotionEvent) => {
    const r = e.rotationRate
    const a = e.acceleration
    const hasRotation = r && r.alpha !== null && r.beta !== null && r.gamma !== null
    const hasAccel = a && a.x !== null && a.y !== null && a.z !== null
    if (!hasRotation && !hasAccel) return
    this.available = true
    const rot = hasRotation ? Math.hypot(r!.alpha!, r!.beta!, r!.gamma!) : 0
    const acc = hasAccel ? Math.hypot(a!.x!, a!.y!, a!.z!) : 0
    if (rot > CONFIG.auto.maxRotationDegPerSec || acc > CONFIG.auto.maxAccel) this.lastMovingAt = performance.now()
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta !== null) this.beta = e.beta
  }

  start() {
    this.lastMovingAt = performance.now()
    window.addEventListener('devicemotion', this.onMotion)
    window.addEventListener('deviceorientation', this.onOrientation)
  }

  stop() {
    window.removeEventListener('devicemotion', this.onMotion)
    window.removeEventListener('deviceorientation', this.onOrientation)
  }

  /** 마지막으로 움직인 뒤 지난 시간(ms). 센서가 없으면 null */
  stillFor(now: number): number | null {
    return this.available ? now - this.lastMovingAt : null
  }
}
