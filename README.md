# Whistle

- 2D 격자 편집 → 3D 탐색 · Pd(pd4web) 사운드
- [브라우저에서 열기](https://suspiciouscloudgames.github.io/whistle/)

## 실행

- Node.js 22.13 이상

```sh
npm ci       # 최초 설치
npm run dev  # Pd 패치 복사 · 서버 시작
```

- 종료: `Ctrl+C`
- 접속: [게임](http://127.0.0.1:5173/whistle/) · [오디오 테스트](http://127.0.0.1:5173/whistle/audio-lab/index.html) · [사운드스케이프 테스트](http://127.0.0.1:5173/whistle/audio-lab/soundscape.html) · [UWB 테스트](http://127.0.0.1:5173/whistle/uwb-lab/index.html)
- 포트 변경 시 터미널 주소 확인

## 사운드 수정

- 편집음·플레이어음·규칙 이벤트음은 각각 `edit.pd`, `player.pd`, `event.pd`에서 수정한다. 지형·환경·구조 영역은 개별 패치를 쓴다.
- 게임·UWB의 풀 타격과 고리 숨결은 `world-resonance-live.pd`, 게임의 배치 음원 효과는 `placed-sound-fx.pd`에서 수정한다. [격자·공간화·Pd 입력](docs/soundscape-design.md)
- 패치 저장 → `npm run audio:build` → 페이지 새로고침. 새 최상위 패치는 `audio/patch-targets.json`에 등록한다.
- `public/audio-test/`: 자동 생성 파일, 직접 수정 금지
- `whistle-board-height`: 보드 높이 수신만 연결, 소리 변화 없음

## UWB 테스트

- 세계 선택: **샘플 세계** / **Whistle 3D**
- Whistle 3D: 저장된 세계 표시 · 별도 편집기 변경 반영(같은 브라우저·서버 주소)
- 가상 입력: 평면도 클릭 또는 X·Z·보드 높이 입력(미터)
- 전시장 매핑: 원점·회전·가로·세로 설정
- **오디오 시작**: 풀 밀도에 따른 시계·사인파·바람 소리 확인
- 보드 높이: 가상 지면·플레이어 높이와 별개

### PC 수신 테스트 — 장비 없이

```sh
npm run uwb:demo  # 별도 터미널에서 실행
```

- 입력 모드: **실제 데이터 · PC 수신기**
- 연결: `ws://127.0.0.1:5194` · 태그 ID `0`
- 경로: 가상 거리 → UDP → 좌표 계산 → WebSocket
- 기본값: 6×6m 공간 · 보드 높이 1.2m 고정
- 수신: USB·UDP · 최대 4명 / 화면 표시: 선택한 1명

### 실제 T0로 테스트

- T0 → 공유기 Wi-Fi → Mac UDP 5195. 거리 보고 `AT+RANGE` 한 줄을 패킷 하나로 전송
- Mac에서 거리 파싱·X·Z 계산 → WebSocket 5194 → 브라우저에서 위치별 사운드 재생
- 별도 전원으로 무선 수신 확인. 청음 시험의 보드 높이는 0.65m 고정
- 실측 높이로 소리를 제어하려면 현장에서 3D 높이 정확도를 먼저 검증한 뒤 Pd에 매핑
- [무선 태그 연결](docs/uwb-bridge.md#t0-무선-연결) · [현장 높이 시험](docs/uwb-bridge.md#현장-높이-시험) · [무선 앵커 배치 측정](docs/uwb-anchor-survey.md)

## 검증

```sh
npm run test:uwb  # UWB 테스트
npm test          # 전체 테스트
npm run build     # 빌드
```
