// 숫자 기준은 전부 여기서 고친다. 현장에서 써 보고 조정할 값이 대부분이다.
export const CONFIG = {
  /** 저장할 사진 크기 */
  photo: {
    maxLongEdge: 1920,
    jpegQuality: 0.9,
    thumbLongEdge: 480,
    thumbQuality: 0.8,
  },
  /** 촬영 화면의 가이드 틀과 기본 빨간 박스 (사진 폭·높이에 대한 비율) */
  guide: { x: 0.15, y: 0.25, w: 0.7, h: 0.5 },
  /** 빨간 박스를 한 변마다 이만큼(박스 크기 대비) 넓힌 범위를 '주변 범위'로 보여 준다 */
  contextPadding: 0.3,
  /** 박스 최소 크기 (사진 대비) */
  minBoxSize: 0.05,
  /** 흔들림 멈추면 자동 촬영 */
  auto: {
    analysisWidth: 160,
    analysisFps: 8,
    /** 이 시간 동안 계속 안정돼야 카운트다운을 시작한다 */
    stableMs: 700,
    countdownSteps: 3,
    countdownStepMs: 400,
    /** 움직임 센서 기준: 회전 속도(도/초)와 가속도(m/s²) */
    maxRotationDegPerSec: 15,
    maxAccel: 0.8,
    /** 센서가 없을 때 화면 변화량(0~255 평균 차이) 기준 */
    maxFrameDiff: 6,
    /** 실시간 선명도 기준 (작은 화면에서 계산한 값) */
    minSharpness: 35,
    /** 폰 기울기(beta): 0 = 바닥을 수직으로 내려다봄, 90 = 정면 */
    minTilt: -15,
    maxTilt: 60,
  },
  /** 찍은 뒤 품질 경고 */
  quality: {
    analysisWidth: 320,
    minSharpness: 25,
    minBrightness: 45,
    maxBrightness: 235,
  },
  /** 이보다 오래된 위치는 쓰지 않는다 */
  gpsMaxAgeMs: 30_000,
  /** 정답지 목표 장수 */
  goal: 100,
  /** Supabase 저장소 버킷 이름 (supabase/schema.sql 과 같아야 한다) */
  bucket: 'drain-photos',
  /** 빗물받이 번호 앞부분 기본값 (역곡동 = YG) */
  drainCodePrefix: 'YG-',
  /** 사진 보기용 임시 주소 유효 시간(초) */
  signedUrlSeconds: 3600,
} as const
