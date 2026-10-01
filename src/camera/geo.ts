import { useEffect, useState } from 'react'

export type Fix = { lat: number; lng: number; accuracy: number; at: number }
export type GeoStatus = 'idle' | 'waiting' | 'ok' | 'denied' | 'unavailable'

/** 촬영 중에만 위치를 계속 받는다. 실패해도 촬영·저장은 막지 않는다 */
export function useGeolocation(active: boolean) {
  const [fix, setFix] = useState<Fix | null>(null)
  const [status, setStatus] = useState<GeoStatus>('idle')

  useEffect(() => {
    if (!active) return
    if (!('geolocation' in navigator)) {
      setStatus('unavailable')
      return
    }
    setStatus('waiting')
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() })
        setStatus('ok')
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active])

  return { fix, status }
}

export function freshFix(fix: Fix | null, maxAgeMs: number): Fix | null {
  if (!fix) return null
  return Date.now() - fix.at <= maxAgeMs ? fix : null
}

export function geoText(status: GeoStatus, fix: Fix | null): string {
  if (fix) return `위치 ±${Math.round(fix.accuracy)}m`
  if (status === 'denied') return '위치 권한 꺼짐'
  if (status === 'unavailable') return '위치 못 찾음'
  return '위치 찾는 중'
}
