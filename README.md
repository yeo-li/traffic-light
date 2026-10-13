# 건널까? — MVP 0

행정안전부 한국지역정보개발원의 전국 통합데이터로 서울·경기도 교차로를 표시하고, T-Data로 실제 **보행** 신호와 잔여시간을 표시하는 모바일 우선 웹 앱입니다. 차량 신호는 무시합니다. 지역별 교차로 목록은 서버에서 하루 동안 캐시하고, 핀을 선택한 경우에만 해당 교차로의 실시간 신호를 요청합니다.

## 실행

```bash
npm install
npm run dev
```

로컬 Cloudflare 호환 실행을 사용할 때는 `.dev.vars.example`을 `.dev.vars`로 복사하고 공공데이터포털에서 받은 일반 인증키를 `NATIONAL_RTI_SERVICE_KEY`, T-Data 키를 `T_DATA_API_KEY`에 입력합니다. `.dev.vars`는 git에서 제외되며 프런트엔드 번들(`src/`)에서는 해당 값을 읽을 수 없습니다.

또한 `.env.example`을 `.env.local`로 복사한 뒤 Google Cloud의 **Maps JavaScript API 키**를 `VITE_GOOGLE_MAPS_API_KEY`로 설정합니다. 이 키는 브라우저에 전달되는 공개 키이므로, Google Cloud에서 Maps JavaScript API만 허용하고 `http://localhost:8788`과 배포할 도메인으로 HTTP referrer를 제한합니다.

`npm run dev`는 빌드 뒤 Cloudflare 호환 로컬 서버를 실행합니다. Vercel 배포와 같은 함수를 로컬에서 확인하려면 `npx vercel dev --listen 8788`을 사용합니다. 화면만 빠르게 다듬을 때는 `npm run dev:ui`를 사용할 수 있지만, 이 서버에서는 프록시 함수가 실행되지 않습니다.

## Vercel 배포

1. GitHub에 저장소를 푸시한 뒤 Vercel에서 **Add New → Project → Import**를 선택합니다.
2. Vercel 프로젝트 설정은 빌드 명령 `npm run build`, 출력 디렉터리 `dist`를 사용합니다. `vercel.json`에도 동일하게 설정되어 있습니다.
3. Project Settings → Environment Variables에서 Production과 Preview 모두에 다음 값을 설정합니다.
   - `NATIONAL_RTI_SERVICE_KEY` (비공개)
   - `T_DATA_API_KEY` (비공개)
   - `VITE_GOOGLE_MAPS_API_KEY` (Google Maps JavaScript API의 도메인 제한 공개 키)
4. Google Cloud Console에서 지도 키의 HTTP referrer에 운영 도메인 `https://*.vercel.app/*`와 연결할 맞춤 도메인을 추가합니다.
5. 배포 후 `/api/intersections?stdgCd=1100000000`와 `/api/signals?intersectionId=20386&stdgCd=1100000000`를 확인합니다.

Vercel 함수는 최상단 `api/` 폴더에 있습니다. API의 실제 신호·교차로 처리 로직은 Cloudflare 로컬 호환 함수와 공유하므로, 두 환경에서 응답 형식이 같습니다.

`/api/intersections`는 전국 통합데이터의 교차로 Map 정보를 지역 코드별로 하루 동안 메모리 캐시합니다. `/api/signals`는 T-Data에서 선택한 교차로의 실제 신호잔여시간 정보를 읽고 1초 동안 캐시합니다. 지도에 모든 신호 상태를 한꺼번에 요청하지 않습니다. 프런트엔드는 선택한 교차로의 가장 먼저 끝나는 신호가 0초가 된 뒤에 최신 정보를 확인하고, 새 현시가 아직 도착하지 않으면 1.2초 간격으로 다시 확인합니다. 그 사이에는 이전 초록·빨강을 유지하지 않고 `신호 전환 확인 중`으로 표시합니다.

## API 응답

`GET /api/signals?intersectionId=20386&stdgCd=1100000000`

신호는 `*PdsgStatNm`과 `*PdsgRmdrCs`에서만 추출됩니다. `permissive-Movement-Allowed`와 `protected-Movement-Allowed`는 `WALK`, `stop-And-Remain`은 `STOP`, 그 외와 null은 `UNKNOWN`입니다.

`RmdrCs`는 유효한 경우에만 0.1초 단위로 표시합니다. SPaT TimeMark의 `36000`(1시간 초과)과 `36001`(정의되지 않음/알 수 없음), 그리고 보행 신호에 비현실적으로 큰 값은 잔여시간으로 환산하지 않습니다. 이 경우 2초 간격으로 최대 다섯 번 최신 값을 다시 확인합니다. 다섯 번 뒤에도 유효한 값이 없으면 `잔여시간 정보를 확인하지 못했습니다`를 표시합니다.

지도 마커는 교차로 좌표의 보행 신호 요약을 나타냅니다. 제공 방향 중 하나라도 진행 허용이면 초록, 모두 정지면 빨강, 데이터가 없거나 미확인 상태면 회색입니다. 방향 필드와 실제 횡단보도 위치의 대응은 아직 검증되지 않아 개별 횡단보도 위치에는 표시하지 않습니다.
