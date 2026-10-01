# 빗물받이 촬영기

빗물받이 사진을 폰으로 찍어 모으고(정답지 100장), PC에서 보고 등급을 매기는 팀용 도구다.

- **폰 촬영 앱(PWA):** `https://1zae6.github.io/bitmul-camera/`
- **PC 뷰어:** `https://1zae6.github.io/bitmul-camera/viewer.html`

## 하는 일

| 화면 | 기능 |
|---|---|
| 폰 촬영 앱 | 흰 틀에 빗물받이를 맞추고 멈추면 자동 촬영(흔들림·각도·선명도 검사), 수동 셔터, 빨간 박스 조정, 빗물받이 번호·청소 전/후·메모 입력, 위치·시각 자동 기록, 인터넷이 끊기면 폰에 보관했다가 다시 올리기 |
| PC 뷰어 | 사진 목록·필터, 지도, 사진 정보 고치기·연습용 표시·삭제·원본 내려받기, 등급 매기기(다른 사람 등급과 번호·단계는 가림), 두 사람 일치율·코언 카파, 정답지 CSV |

로그인은 팀 공용 비밀번호 하나로 하고, 이름으로 촬영자·채점자를 구분한다.

## 처음 설정 (한 번만)

1. **Supabase 키:** `.env.example` 을 복사해 `.env` 를 만들고 값을 채운다.
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: Supabase → Project Settings → API Keys
   - anon(public) 또는 Publishable 키만 쓴다. service_role / secret 키는 넣지 않는다.
2. **데이터베이스:** Supabase → SQL Editor 에 `supabase/schema.sql` 전체를 붙여 넣고 Run.
3. **팀 공용 계정:** Supabase → Authentication → Users → Add user → Create new user
   - 이메일은 팀이 정한 주소(이 주소는 앱 코드에 들어가 공개된다), 비밀번호는 팀 비밀번호
   - **Auto Confirm User** 를 켠다
   - 만든 이메일을 `.env` 의 `VITE_TEAM_EMAIL` 에 넣는다
4. **회원가입 막기(중요):** Supabase → Authentication → Sign In / Providers → **Allow new users to sign up** 을 끈다.
   켜 두면 누구나 계정을 만들어 사진을 볼 수 있다.

## 실행과 배포

```bash
npm install
npm run dev        # http://localhost:5180 (촬영 앱), /viewer.html (뷰어)
npm run typecheck
npm run deploy     # 빌드한 뒤 gh-pages 브랜치로 올린다
```

배포 뒤 GitHub 저장소 → Settings → Pages 에서 Source 를 `Deploy from a branch`, 브랜치를 `gh-pages` / `(root)` 로 한 번만 정한다.

카메라가 없는 PC에서 흐름을 시험하려면 주소 끝에 `?demo=1` 을 붙인다. 샘플 사진은 연습용으로 저장된다.

## 등급 기준 (초안)

| 등급 | 뜻 |
|---|---|
| 0 깨끗함 | 구멍이 거의 다 보인다. 가려진 부분 5% 미만 |
| 1 조금 막힘 | 구멍의 5~25%가 가려짐 |
| 2 절반 가까이 | 구멍의 25~50%가 가려짐 |
| 3 대부분 막힘 | 구멍의 50~90%가 가려짐 |
| 4 완전히 막힘 | 90% 이상 가려짐 |
| X 판단 불가 | 빗물받이가 아니거나 흐려서 알 수 없음 |

빨간 박스 안의 덮개 구멍만 보고, 고무판·장판으로 덮은 것도 가린 것으로 센다. 기준을 바꾸려면 `src/shared/grades.ts` 를 고친다.

## 조정할 값

자동 촬영 기준(선명도, 흔들림, 기울기), 가이드 틀 위치, 사진 크기는 모두 `src/shared/config.ts` 에 있다.
촬영 화면 아래 상태 표시를 누르면 실제 선명도·밝기·기울기 숫자가 보이니, 현장에서 보고 기준을 맞춘다.

## 촬영 수칙

비 올 때 촬영 금지 · 인도 쪽에서만 · 덮개 열지 않기 · 사람 얼굴과 차량 번호판이 나오지 않게 찍기.
사진은 앱에서 다시 그려 저장하므로 원본 파일의 위치 정보(EXIF)는 남지 않는다. 위치는 앱이 따로 기록한다.
