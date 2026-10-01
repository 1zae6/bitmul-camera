import L from 'leaflet'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { PHASE_LABEL, PHASES, type Phase, type PhotoRow } from '../shared/types'

const PHASE_COLOR: Record<Phase, string> = { before: '#DC2626', after: '#16A34A', revisit: '#F59E0B' }
/** 사진이 없을 때 처음 보여 줄 곳: 가톨릭대 성심교정 부근(대략) */
const DEFAULT_CENTER: [number, number] = [37.4866, 126.8015]

type Props = { photos: PhotoRow[]; selectedId: string | null; onSelect: (id: string) => void }

export function MapView({ photos, selectedId, onSelect }: Props) {
  const located = photos.filter((p) => p.lat !== null && p.lng !== null)
  return (
    <div className="relative h-full min-h-[480px]">
      <MapContainer center={DEFAULT_CENTER} zoom={16} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={located} />
        {located.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat!, p.lng!]}
            radius={p.id === selectedId ? 11 : 8}
            pathOptions={{ color: '#111827', weight: p.id === selectedId ? 3 : 1, fillColor: PHASE_COLOR[p.phase], fillOpacity: 0.9 }}
            eventHandlers={{ click: () => onSelect(p.id) }}
          >
            <Tooltip>
              {p.drain_code} · {PHASE_LABEL[p.phase]} · {p.photographer}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="absolute bottom-4 left-4 z-[1000] space-y-1 rounded-lg bg-white/95 px-3 py-2 shadow">
        {PHASES.map((p) => (
          <div key={p.value} className="flex items-center gap-2 text-gray-900">
            <span className="h-3 w-3 rounded-full border border-gray-900" style={{ background: PHASE_COLOR[p.value] }} />
            {p.label}
          </div>
        ))}
      </div>
      {located.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-[1000] mx-auto w-fit rounded-lg bg-white px-4 py-2 text-gray-900 shadow">
          위치가 기록된 사진이 없습니다
        </div>
      )}
    </div>
  )
}

function FitBounds({ points }: { points: PhotoRow[] }) {
  const map = useMap()
  const key = points.map((p) => p.id).join(',')
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map((p) => [p.lat!, p.lng!] as [number, number]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 })
  }, [key, map]) // 사진 목록이 바뀔 때만 다시 맞춘다
  return null
}
