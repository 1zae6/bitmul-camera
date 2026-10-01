import { useRef } from 'react'
import { boxStyle, containRect, dragBox, expandBox, type DragMode } from './box'
import { CONFIG } from './config'
import type { Box } from './types'
import { useElementSize } from './useElementSize'

type Props = {
  src: string
  imgW: number
  imgH: number
  box: Box
  /** 주면 박스를 손가락·마우스로 옮기고 크기를 바꿀 수 있다 */
  onChange?: (b: Box) => void
  showContext?: boolean
  className?: string
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** 사진 위에 빨간 박스(빗물받이)와 점선 주변 범위를 겹쳐 보여 준다 */
export function AnnotatedImage({ src, imgW, imgH, box, onChange, showContext = true, className = '' }: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const rect = containRect(size.width, size.height, imgW, imgH)
  const drag = useRef<{ mode: DragMode; x: number; y: number; start: Box; w: number; h: number } | null>(null)
  const editable = Boolean(onChange)

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (!onChange || !rect) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: box, w: rect.width, h: rect.height }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !onChange) return
    onChange(dragBox(d.start, d.mode, (e.clientX - d.x) / d.w, (e.clientY - d.y) / d.h))
  }
  const end = () => {
    drag.current = null
  }

  return (
    <div ref={ref} className={`relative overflow-hidden bg-black ${className}`}>
      {rect && (
        <div
          className="absolute"
          style={{ ...rect, touchAction: editable ? 'none' : undefined }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />
          {showContext && (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-white"
              style={{ ...boxStyle(expandBox(box, CONFIG.contextPadding)), boxShadow: '0 0 0 1px rgba(0,0,0,0.45)' }}
            />
          )}
          <div
            className={`absolute border-[3px] border-red-600 ${editable ? 'cursor-move' : 'pointer-events-none'}`}
            style={{ ...boxStyle(box), boxShadow: '0 0 0 1px rgba(255,255,255,0.7)' }}
            onPointerDown={editable ? begin({ move: true }) : undefined}
          >
            {editable &&
              CORNERS.map((c) => (
                <div
                  key={c}
                  className="absolute flex h-11 w-11 items-center justify-center"
                  style={{
                    left: c.endsWith('w') ? -22 : undefined,
                    right: c.endsWith('e') ? -22 : undefined,
                    top: c.startsWith('n') ? -22 : undefined,
                    bottom: c.startsWith('s') ? -22 : undefined,
                    cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                  onPointerDown={begin({
                    move: false,
                    n: c.startsWith('n'),
                    s: c.startsWith('s'),
                    w: c.endsWith('w'),
                    e: c.endsWith('e'),
                  })}
                >
                  <div className="h-5 w-5 rounded-sm border-[3px] border-red-600 bg-white" />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 비율이 고정된 칸(목록 썸네일)에 쓰는 가벼운 버전. 칸이 사진 비율과 같아야 한다 */
export function BoxOverlay({ box }: { box: Box }) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-red-600"
      style={{ ...boxStyle(box), boxShadow: '0 0 0 1px rgba(255,255,255,0.7)' }}
    />
  )
}
