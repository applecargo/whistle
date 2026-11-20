# WebPd 오디오 엔진 및 Web Audio 하이브리드 아키텍처

Whistle의 오디오 엔진은 **WebPd(Pure Data 기반 절차적 사운드 합성)**와 **Web Audio API(마스터 믹서, Limiter, Equal Power Panning, 3D HRTF 공간화, 외부 사운드 디코더)**가 결합된 하이브리드 구조로 동작합니다.

---

## 1. 역할 분리 및 신호 흐름

게임은 상호작용 및 공간 상태를 계산하여 오디오 엔진에 전달하고, 오디오 엔진은 합성·재생·필터링·공간화를 처리합니다. 지형 생성이나 물리 계산 로직은 변경하지 않습니다.

```text
[2D 편집 / 3D 이동 상태] ───► [AudioStateBus (전역 오디오 상태 버스)]
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────┐                             ┌───────────────────────┐
│ WebPd (WASM Worklet)  │                             │   Web Audio 네이티브   │
│ - player / edit 합성  │                             │ - 외부 음원 (MP3/OGG) │
│ - Pd DSP 필터 (adc~)  │                             │ - Listener Yaw/위치   │
└───────────┬───────────┘                             └───────────┬───────────┘
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       ▼
                       [채널 스트립 & 공간화 레이어]
                       - 2D Stereo Equal Power Panning (StereoPannerNode)
                       - 3D HRTF 공간화 (PannerNode, 최대 6 보이스 풀링)
                       - Pd 필터 인서트 (bypass / underwater / radio 등)
                                       │
                                       ▼
                       [마스터 믹서 & 브릭월 리미터]
                       - Master Gain
                       - Gate Gain (Mute/Unmute)
                       - Brickwall Limiter (-1dB True Peak 방지, 20:1 ratio)
                                       │
                                       ▼
                         AudioContext.destination (스피커)
```

---

## 2. 주요 아키텍처 특징

### A. Web Audio 마스터 리미터 (Brickwall Limiter)
* 복수의 음원(WebPd 합성음, 유저 업로드 BGM/효과음 등)이 동시 재생될 때 0dBFS 초과로 인한 디지털 클리핑(깨짐)을 방지합니다.
* Web Audio 표준 `DynamicsCompressorNode`를 하드 리미터로 설정:
  * **Threshold**: `-1.0 dB` (인터샘플 피크 여유 확보)
  * **Knee**: `0.0 dB` (하드 니 특성으로 임계치 도달 즉시 제압)
  * **Ratio**: `20.0` (브릭월 리미터 동작)
  * **Attack**: `0.001 s` (1ms의 초고속 트랜지언트 대응)
  * **Release**: `0.050 s` (50ms의 왜곡 없는 복원)

### B. Equal Power Panning & 3D HRTF 공간 음향
* **2D Equal Power Panning**: 수평 패닝에 W3C 표준 `StereoPannerNode`를 적용하여, 중앙($0$) 위치에서도 $-3\text{dB}$ 보정된 부드러운 코사인/사인 등파워 곡선($L=\cos, R=\sin$)을 구현합니다.
* **3D HRTF 바이너럴 공간화**: `PannerNode(panningModel: 'HRTF')`를 사용하여 상공 및 지상 오브젝트의 고도각(Elevation)과 거리 감쇠를 청각적으로 재현합니다.
* **UWB 헤드 오리엔테이션 한계 대응**: UWB 태그는 머리 끄덕임(Pitch/Roll) 트래커가 없으므로, Up 벡터([0, 1, 0])는 고정하고 수평 $yaw$ 기반의 전방 벡터($\sin(yaw), 0, -\cos(yaw)$)와 3D 위치를 `AudioListener`에 동기화합니다.
* **모바일 성능 보호**: 모바일 기기의 CPU 부하 방지를 위해 동시 활성 3D 공간음향 보이스를 **최대 6개로 제한(Voice Pooling)**하며, 초과 시 가장 오래된 음원을 안전하게 교체합니다.

### C. 외부 사운드(MP3, OGG, WAV 등) 및 Pd 필터 파이프라인
* 브라우저 네이티브 `AudioContext.decodeAudioData()`를 통해 사용자가 업로드한 모든 사운드 파일(MP3, OGG, WAV, AAC, WebM 등)을 디코딩하여 3D 공간에 배치할 수 있습니다.
* **필터 라우팅**:
  * `filter: "bypass"`: Pd를 거치지 않고 원음 그대로 깨끗하게 직결 재생.
  * `filter: "underwater" | "radio" | ...`: Pd 필터 WASM(`adc~`) 또는 전용 DSP 필터를 거쳐 수중 먹먹함, 라디오 효과 등을 부여.

### D. SHA-256 증분 빌드 (Incremental Build)
* `scripts/build-audio.mjs`에 파일 내용 해시 기반 캐시가 적용되어, `.pd` 패치 파일이 수정되지 않은 경우 재컴파일을 즉시 건너뜁니다 (빌드 시간 수십 초 $\rightarrow$ 10ms 수준 단축).
* 컴파일된 모든 패치는 `public/audio-test/[patchName].wasm` 및 `[patchName].io.json`으로 개별 보존되어 패치 간 덮어쓰기 충돌이 발생하지 않습니다.

### E. 멀티 WASM 사운드스케이프 & 통일된 On/Off 스위치 (단일 AudioContext)
* **단일 AudioContext 믹싱**: 모든 WASM 패치는 하나의 공유 `AudioContext` 내에서 개별 `AudioWorkletNode`로 로드되어 Master Limiter로 자동 믹싱되며, 팝 노이즈 및 스레드 오버헤드를 차단합니다.
* **통일된 On/Off 스위치 인터페이스 (`WasmPatchInstance`)**:
  * 타일 패치, 오브젝트 패치, 전역 앰비언트 등 모든 WASM 모듈은 `enable()` 및 `disable()`의 동일한 온오프 스위치 인터페이스를 갖습니다.
  * `disable()` 시 15ms 부드러운 페이드아웃 후 노드 연결을 분리하여 CPU 연산량을 0%로 절감합니다.
* **거리 컬링(Distance Culling) 정책**:
  * 타일 및 3D 오브젝트 WASM의 경우 기본적으로 거리 컬링 정책(`policy: { type: "distance", radius: 18 }`)이 개입합니다.
  * 플레이어가 특정 반경(예: 18m) 이내로 접근하면 자동으로 `enable()` 스위치가 켜지고, 멀어지면 `disable()`되어 불필요한 원거리 패치 연산을 사전에 방지합니다.

---

## 3. 개발자 API 레퍼런스

게임 엔진이나 씬 코드에 영향을 주지 않도록, `components/whistle/useGameAudio.ts` 및 `lib/audio/game-audio.ts`에서 깔끔한 TypeScript 인터페이스를 제공합니다.

### `useGameAudio` 확장 API

```typescript
import { useGameAudio } from "@/components/whistle/useGameAudio";

const audio = useGameAudio(notify);
```

#### 1) 기존 API (하위 호환 100% 유지)
* `audio.edit(sound: EditSound)`: 2D 배치 피드백음
* `audio.play()`: 3D 탐색 사운드 시작
* `audio.stop()`: 3D 탐색 사운드 정지
* `audio.movement(frame: PlayerAudioFrame)`: 플레이어 위치/재질 프레임 갱신 (사운드스케이프 거리 컬링 자동 동기화)
* `audio.event(event: Event, player: Player)`: 기존 규칙 이벤트 사운드 발생

#### 2) 멀티 WASM 타일/오브젝트 사운드스케이프 API (신규)

```typescript
// A. 타일 또는 오브젝트에 WASM 패치 등록 (거리 컬링 정책 기본 적용)
const tilePatch = await audio.registerTilePatch({
  id: "tile-3-5",
  patchName: "bell01",                          // public/audio-test/bell01.wasm 로드
  position: { x: 3, y: 0, z: 5 },              // 3D 공간 좌표
  policy: { type: "distance", radius: 18 },     // 18m 이내 접근 시 자동 On, 이탈 시 Off
  initialGain: 0.8,
});

// B. 패치 수동 제어 (통일된 On/Off 스위치)
await tilePatch?.enable();   // 즉시 On (페이드인)
tilePatch?.disable();        // 즉시 Off (페이드아웃, CPU 0%)
tilePatch?.setPosition(4, 0, 6);

// C. 등록 해제
audio.unregisterTilePatch("tile-3-5");
```

#### 3) 외부 음원 및 공간 사운드 API

```typescript
// A. 외부 오디오 파일 등록 (File, Blob, ArrayBuffer, 또는 URL)
await audio.loadClip("bird-chime", fileOrUrl);

// B. 3D 공간에 사운드 재생 (HRTF 또는 Equal Power Panning)
const instance = audio.playSpatialClip("bird-chime", {
  position: [10, 15, 20],   // 3D 월드 좌표 [X, Y, Z] (상공 오브젝트 지원)
  volume: 0.8,              // 볼륨 (0.0 ~ 1.0)
  loop: true,               // 반복 재생 여부
  filter: "bypass",         // "bypass" (원음) 또는 "underwater", "radio" (Pd 필터)
  panningModel: "HRTF",     // "HRTF" (3D 공간화) 또는 "equalpower" (2D 수평)
});

// C. 재생 중인 사운드 실시간 제어
instance?.setPosition([12, 16, 22]); // 위치 이동
instance?.setVolume(0.5);             // 볼륨 변경
instance?.setFilter("underwater");    // 필터 실시간 변경
instance?.stop();                     // 재생 정지

// D. 클립 캐시 해제
audio.unloadClip("bird-chime");

// E. 전역 플레이어 상태 갱신
audio.updatePlayerState({
  x: player.x,
  y: player.y,
  z: player.z,
  yaw: player.yaw,
  crouch: false,
  run: true,
});
```

---

## 4. Pd 버스 사양

| Pd 버스 | 입력 | 동작 및 설명 |
| :--- | :--- | :--- |
| `whistle-edit` | `[x, z, overlap, ...]` | `440 + 220 × overlap` Hz, 짧은 엔벌로프. |
| `whistle-player` | `[x, y, z, grass, rough, ...]` | `220 + 220z + 220grass + 440rough` Hz, 보행음/환경음 합성. |
| `whistle-board-height` | `[heightMetres]` | UWB 테스트 전용. 0~10m, 높이당 `110 × height` Hz 추가. |
| `whistle-player-stop` | `bang` | 3D 연속음 정지. |
| `whistle-event` | `[frequency, gain, pan]` | 이벤트용 합성음. 25ms 어택, 1100ms 감쇠. |
| `whistle-gate` | `[0 또는 1]` | 음소거/해제 게이트 제어. |
| `whistle-ready` | 패치 $\rightarrow$ 브라우저 `bang` | DSP 초기화 완료 신호. |

---

## 5. 실행 및 테스트

```sh
# 1. 의존성 설치
npm ci

# 2. 오디오 패치 컴파일 (증분 캐시 지원)
npm run audio:build
# 캐시 무시하고 강제 재컴파일 시:
node scripts/build-audio.mjs --force

# 3. 개발 서버 실행
npm run dev

# 4. 단위 테스트 실행 (신규 오디오 버스 및 공간화 테스트 포함)
npm run test:unit

# 5. 프로덕션 빌드
npm run build
```

### 오디오 실험실 (`audio-lab/index.html`)
* 브라우저에서 `http://127.0.0.1:5173/whistle/audio-lab/index.html`을 열어 수동 검증이 가능합니다.
* **1. 2D 배치 이벤트**: 겹침 강도에 따른 주파수 변화 확인.
* **2. 3D 이동 상태**: X 좌표 패닝, Z/풀/바위에 따른 음색 변화 확인.
* **3. 외부 사운드 & 공간 음향 (신규)**: 로컬 MP3/OGG/WAV 파일을 업로드하고 패닝(-1 ~ 1) 및 필터(Bypass/Underwater/Radio)를 실시간 청취 및 레벨 미터로 확인.
