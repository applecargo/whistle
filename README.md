# Whistle

- 2D 격자 편집 → 3D 탐색 · WebPd 사운드
- [브라우저에서 열기](https://suspiciouscloudgames.github.io/whistle/)

## 실행

- Node.js 22.13 이상

```sh
npm ci       # 최초 설치
npm run dev  # Pd 자동 컴파일 · 서버 시작
```

- 종료: `Ctrl+C`
- 접속: [게임](http://127.0.0.1:5173/whistle/) · [오디오 테스트](http://127.0.0.1:5173/whistle/audio-lab/index.html) · [UWB 테스트](http://127.0.0.1:5173/whistle/uwb-lab/index.html)
- 포트 변경 시 터미널 주소 확인

## 사운드 엔진 및 공간 음향

- **하이브리드 아키텍처**: WebPd(DSP 음원 합성) + Web Audio API(마스터 믹서, Brickwall Limiter, Equal Power Panning, HRTF 3D 공간화)
- **멀티 WASM 사운드스케이프**: 단일 `AudioContext` 내에서 복수의 타일/오브젝트/앰비언트 WASM 패치 동시 믹싱
- **통일된 On/Off 스위치 & 거리 컬링**: 모듈별 통일된 `enable()`/`disable()` 스위치 제공 및 플레이어 거리(기본 18m) 기반 자동 컬링으로 CPU 연산량 0% 절감
- `audio/patches/player3.pd` 및 하위 패치: 음색·리듬·볼륨 수정
- `audio/patches/uwb-player.pd`: 원본 패치 로드 · 앱/UWB 입력 연결. 사운드만 수정할 때 유지
- **외부 사운드 지원**: 사용자가 업로드한 MP3/OGG/WAV 파일을 3D 공간에 배치하고 옵션으로 Pd 필터 WASM(`adc~`) 적용 가능
- **증분 빌드 캐싱**: `npm run audio:build` 시 변경된 패치만 자동 감지해 10ms 내로 개별 WASM 파일 빌드 (`[patchName].wasm`)
- 적용: Pd 저장 → `npm run audio:build` → 페이지 새로고침 → 오디오 시작
- 서버 재시작 시에도 자동 컴파일
- 입력 파라미터 변경 시 연결 패치·앱 코드 확인
- 자세한 아키텍처와 개발자 API는 [오디오 안내 문서](audio/README.md) 참조
- `public/audio-test/`: 자동 생성 파일, 직접 수정 금지
- `whistle-board-height`: 보드 높이 수신만 연결, 소리 변화 없음

## UWB 테스트

- 세계 선택: **샘플 세계** / **Whistle 3D**
- Whistle 3D: 저장된 세계 표시 · 별도 편집기 변경 반영(같은 브라우저·서버 주소)
- 가상 입력: 평면도 클릭 또는 X·Z·보드 높이 입력(미터)
- 전시장 매핑: 원점·회전·가로·세로 설정
- **오디오 시작**: 풀 밀도에 따른 시계·사인파·바람 소리 확인
- 보드 높이: 가상 지면·플레이어 높이와 별개
