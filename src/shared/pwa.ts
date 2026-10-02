import { registerSW } from 'virtual:pwa-register'
import { CONFIG } from './config'

/** 저장 전 사진을 보고 있는 동안에는 새 버전 확인을 미룬다. 새로 고쳐지면 그 사진이 사라지기 때문이다 */
let hold = false

export function holdUpdates(on: boolean) {
  hold = on
}

/**
 * 새 버전을 올리면 폰에 설치한 앱도 알아서 바뀌게 한다.
 * 앱을 켜 둔 채로 두어도 다시 화면에 나올 때와 일정 시간마다 새 버전을 확인하고,
 * 받으면 화면을 새로 고친다(autoUpdate). 저장한 사진은 폰 대기열에 있어서 새로 고쳐도 남는다.
 */
export function keepUpdated() {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine && !hold) void reg.update().catch(() => undefined)
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.setInterval(check, CONFIG.updateCheckMinutes * 60_000)
    },
  })
}
