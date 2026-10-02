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
  /** 빨간 박스를 한 변마다 이만큼(박스 크기 대비) 넓힌 범위가 '주변'이다. 흰 점선으로 보여 주고 AI 에도 이 범위만 보낸다.
   *  사진은 원본째 저장되므로 바꿔도 사진은 그대로지만, 정답지 등급을 매기기 시작한 뒤에는 바꾸지 않는다 */
  contextPadding: 0.2,
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
  /** 모을 사진 목표(연습용 제외). 5명 × 30장. 의견이 갈려 빠질 사진을 생각해 정답지 목표보다 넉넉히 잡는다 */
  goal: 150,
  /** 정답지(두 사람이 같은 등급을 준, 판단 가능한 사진) 목표. 기획안 기준 */
  answerKeyGoal: 100,
  /** Supabase 저장소 버킷 이름 (supabase/schema.sql 과 같아야 한다) */
  bucket: 'drain-photos',
  /** 사진 보기용 임시 주소 유효 시간(초) */
  signedUrlSeconds: 3600,
  /** PC 뷰어의 AI 채점 (Gemini). 모델 이름은 Gemini API 문서 기준(2026-10 확인) */
  ai: {
    models: [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (빠름·저렴)' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (가장 똑똑함)' },
    ],
    /** AI에 보내는 사진(빨간 박스 + 주변 범위만 잘라 냄)의 긴 변 */
    imageLongEdge: 768,
    /** 무료 한도에 걸리지 않도록 요청 사이에 쉬는 시간(초) */
    intervalSec: 5,
    /** 한도(429)에 걸렸을 때 다시 시도하는 횟수 */
    maxRetries: 3,
    /** 확신도가 이보다 낮으면 사람이 다시 봐야 하는 사진으로 센다 */
    reviewConfidence: 0.7,
    /** 기획안의 AI 판정 일치율 목표 */
    goalAgreement: 0.8,
    /** 폰에서 찍고 바로 채점할 때 쓰는 모델 (하루 한도가 넉넉한 Flash-Lite) */
    fieldModel: 'gemini-3.5-flash-lite',
    /** Gemini 를 대신 불러 주는 Supabase 서버 함수 이름 (supabase/functions/grade-photo) */
    functionName: 'grade-photo',
    keyPageUrl: 'https://aistudio.google.com/app/apikey',
    rateLimitUrl: 'https://aistudio.google.com/rate-limit',
  },
} as const
