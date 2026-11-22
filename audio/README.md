# Pd(pd4web) 오디오 연결과 테스트

풀 타격, 물가 바위의 잔향, 고리 숨결의 입력값과 수정할 패치는 [사운드 설계 · Pd 작업 안내](../docs/soundscape-design.md)에 정리했다. 아래는 배치 음원, 실행 방법, 개별 청음 실험의 상세 안내다.

## 배치 음원 효과

일반 게임의 편집기에서 **사운드 만들기 → 사운드 불러오기 → 미리 듣기**로 파일 자체의 음색을 듣는다. **반복**을 선택해 저장하고, 시작점 주변에 배치한 뒤 **플레이**를 누른다. 배치가 들리는 범위 안에서 격자의 X축을 따라 움직이면 변조 속도가 달라진다. 목소리나 길게 유지되는 음으로 비교하기 쉽다.

```text
2D 편집 결과 ── 단발 이벤트 ─┐
                            ├─ 오디오 어댑터 → pd4web(Pd 0.56 wasm) AudioWorklet → Pd DSP → 출력
3D 이동 상태 ── 연속 값 ─────┘
```

Pd 엔진 하나(AudioContext 하나)에서 여러 패치를 실행한다. 소리 하나 = 패치 하나: 상호작용 패치(edit·player·event)와
사운드스케이프 영역 패치(`environment_grass.pd` 등)가 각각 엔진의 "슬롯" 하나를 쓴다. 하위 패치(abstraction)도 쓸 수 있다.

## Pd 엔진 (pd4web)

- 엔진: [pd4web](https://github.com/charlesneimog/pd4web) 3.4.1(libpd, Pd 0.56의 vanilla 객체 전체를 C에서 wasm으로).
  빈 host 패치만 들어 있는 엔진을 한 번 빌드해 `audio/engine/`에 커밋해 둔다(pd4web.js·wasm·data, 약 2MB).
  **pdlua(GPL-2.0-or-later)는 빼고 빌드한다.** pd4web 3.4.1은 pdlua를 항상 링크하므로 빌드 스크립트가 CLI가 만든 빌드 폴더에서
  pdlua 링크·호출·패키징(pd.lua 등)을 잘라 내고 다시 빌드한다(`engine.json`의 `"pdlua": false`). Lua 객체와 GUI는 쓸 수 없다.
  남은 구성 요소는 Pd·libpd·pd4web(BSD), ThorVG·Emscripten·musl(MIT), LLVM libc++(Apache-2.0 + LLVM 예외)이다.
  저작권·라이선스 고지는 `public/THIRD_PARTY_LICENSES.txt`(배포물 `/whistle/THIRD_PARTY_LICENSES.txt`). 엔진을 다시 빌드해 버전이 바뀌면 함께 고친다.
  **패치는 엔진에 넣어 빌드하지 않는다.** 실행 중에 `.pd` 파일을 엔진 파일시스템으로 보내고(`sendFile`) 동적 패칭으로 만든다.
  그래서 패치를 고치면 `npm run audio:build`(파일 복사, 수 초) 후 새로고침만 하면 된다. 개발 PC에 pd4web·Emscripten이 없어도 된다.
- 엔진을 다시 빌드할 때(pd4web 버전업, 외부 객체 추가 등)만 `npm run audio:engine`.
  pd4web CLI(파이썬 `pip install pd4web`, Python 3.12+)가 필요하다. `PD4WEB=/경로/pd4web npm run audio:engine`.
  첫 빌드는 Emscripten 등을 받아 수 분, 이후는 `output/pd4web-engine/` 캐시로 약 4~5분(CLI 빌드 + pdlua 제외 재빌드).
  pd4web 버전을 바꿔 잘라 낼 코드가 달라지면 빌드가 멈춘다(pdlua가 조용히 남지 않도록). 그때 스크립트의 `stripPdlua`를 맞춘다.
- 런타임 `lib/audio/pd-runtime.ts`: `openEngine(baseUrl, { latencyHint })`가 페이지당 엔진 하나를 연다(AudioContext도 엔진의 것).
  `engine.start(이름, { scoped })` → 슬롯 하나: host의 `[pd slotN]` 안에 `[<패치> slotN]` → `[dac~ 2N+1 2N+2]`를 만들고
  `loadbang`을 보낸다(동적으로 만든 패치에는 loadbang이 저절로 오지 않음). 엔진 출력 32채널을 슬롯별 스테레오 노드로 나눠 돌려준다.
  슬롯은 16개(Web Audio 노드 출력 최대 32채널). `destroy()`는 슬롯을 비운다(`clear`).
- 교차 출처 격리(COOP/COEP)가 필요하다(SharedArrayBuffer). 개발·미리보기 서버는 `vite.config.ts`의 헤더로,
  GitHub Pages는 `public/coi-serviceworker.js`(pd4web에 포함된 coi-serviceworker, MIT)로 건다. 첫 방문 때 페이지가 한 번 새로고침된다.
- Pd → JS 메시지(`onBangReceived` 등)는 쓰지 않는다. 이 구성에서는 콜백이 오지 않았다(print만 옴).
  실험 페이지의 "Pd가 수신한 값"은 JS가 Pd에 보낸 값을 보여 준다.

### 패치 규칙 (pd4web 전환 때 바뀜)

- **출력은 최상위 `[outlet~]` 두 개**(왼쪽 L, 오른쪽 R. 화면에서 왼쪽에 있는 것이 L). `[dac~]`를 쓰면 모든 소리가 한 채널에 섞여
  소리별 패닝을 할 수 없다. 기존 패치는 `dac~`의 L/R 입력을 그대로 두 `outlet~`로 옮겼다.
  Pd에서 단독으로 들어 보려면 그 패치를 객체로 넣고 `[dac~]`에 연결한 시험용 패치를 연다.
- `$1`은 슬롯 이름(`slot0`…). 같은 패치가 여러 영역에 동시에 뜨므로 **영역마다 따로 받을 버스는 `[r $1-whistle-region]`**.
  사운드스케이프는 `scoped`로 열어 `whistle-region`을 `slotN-whistle-region`으로 보낸다.
  상호작용 패치(edit·player·event)는 하나씩만 뜨므로 `whistle-player` 같은 전역 이름 그대로.
- 받는 객체가 없는 버스로 보내도 Pd가 조용히 버린다.
- 전역 이름(`[delwrite~ b]`, `[s 이름]`, `[table 이름]`)은 같은 패치가 여러 번 뜨면 겹친다. 패치 안에서만 쓰는 이름은 `$0-`.
- `whistle-ready`는 더 이상 쓰지 않는다(남아 있어도 무해).

## 게임 연결

- `useGameAudio`가 게임의 오디오 세션 하나를 관리한다. 첫 유효한 격자 편집 또는
  플레이 버튼 클릭으로 시작한다. 초기 로드·무변경 칠하기·시작점 지정·실행 취소는 편집음을 내지 않는다.
- `paint` 처리 전후 문서를 비교해 실제 변경된 셀만 판별한다. 드래그 콜백마다
  마지막 변경 셀 하나를 대표해 전송한다. 누적 셀의 ID만 다시 생성된 경우에는 재생하지 않는다.
- `WorldDerivation`의 기존 환경·구조 캐시를 재사용한다. 겹침 강도는 풀, 물,
  안개, 그늘, 바위 지면, 생성 구조의 결과로 정한다. 물리적 오브젝트 중첩 개수와는 다르다.
- `Scene.onAudioFrame`이 발 X/Y/Z, 풀·바위·물,
  접지·낙하·방향을 보낸다. 80ms 간격으로 전달한다.
- 이동·충돌·점프·카메라 계산은 유지한다. 카메라 흔들림이 아닌 발 높이를 사용하고,
  접근성 설정의 동작 줄이기 여부와 보행음의 접지 판정을 분리한다.
- 제자리나 점프 중에도 위치·재질 상태를 전달한다. 배치 음원의 가청 범위와 음량은 음원 주변 지형과 플레이어까지의 거리에 따라 계산한다.
- 편집 화면 복귀·문서 교체·blur·탭 숨김 시 보행 상태와 대기 입력을 비우고 음소거한다.
  다시 키나 포인터를 조작하면 재개한다. 세션은 재사용하고 컴포넌트 해제 시 닫는다.
- 패치 로딩 중 편집은 마지막 한 건, 이동은 최신 상태만 보존한다. 모드 전환 시
  대기 입력을 취소한다. 로딩 실패는 편집·이동을 막지 않으며 다음 클릭에서 재시도한다.
- 기존 시뮬레이션의 `sound` 이벤트도 `whistle-event`로 전송한다. 기존 주파수 선택,
  거리 감쇠·방향 계산은 유지하며 소리 합성은 Pd에서 처리한다.

좌표는 어댑터에서 `(gridCoordinate + 0.5) / world.size`로 정규화한다.
높이 `y`는 장면에서 플레이어 발의 높이다.
현재 아이콘 ID, 추가/삭제, 지면 종류는 패치로 전달되지만 개별 아이콘 음색은 아직 지정하지 않았다.

### 믹스 구조와 지형 사운드스케이프 (`components/whistle/useGameAudio.ts`)

```text
edit.pd · player.pd(→ 이동음 게인) · event.pd ─┐
층별 영역 패치들(패닝 + 가운데 경로) ────────────┼─→ 마스터 게인 → 리미터 → 출력   (AudioContext 1개)
world-audio.pd (풀·물 공명 + 배치 음원 Pd 효과) ──┘
```

- 상호작용 패치는 `edit`(whistle-edit), `player`(whistle-player·whistle-board-height),
  `event`(whistle-event) 세 슬롯에서 실행한다. 게임과 UWB에서는 네 번째 슬롯에 `world-audio`도 연다.
- 음소거(편집 화면 복귀·blur·탭 숨김)는 `whistle-gate` 대신 마스터 게인 fade, 3D 이동음 정지는
  `whistle-player-stop` 대신 `player` 패치 뒤의 게인 fade로 한다. 두 버스는 더 이상 쓰지 않는다.
- 소리의 단위는 **층별 영역**이다. 입력은 `world-derivation`의 결과(지형 타일 + `environment` + `structures`)이고,
  층마다 같은 종류끼리 이어진 칸을 묶는다(위에서 내려다본 섬). 한 칸이 여러 층에 동시에 속할 수 있다
  (예: 번짐 칸 위에 풀과 안개가 있으면 surface·grass·fog 세 영역에 모두 속해 각각 소리가 난다).

  | 층 | 속하는 칸 | 농도(whistle-region으로 보냄) |
  |---|---|---|
  | surface | 구멍이 아닌 칸. 종류(빈 타일·거침·흐름·번짐)별로 묶음 | 1 |
  | water | `cell.water !== null` | 1 |
  | grass | `cell.grass > 0` | grass |
  | tree | `cell.tree`(대각선도 이어서 숲 하나) | 1 |
  | fog | `cell.fog > 0` | fog |
  | wind | 바람 세기 > 0 | 바람 세기 |
  | structure | 계단·다리·캐노피. 하나하나가 따로 소스, 높이는 구조물 높이 | 1 |

  같은 종류라도 떨어진 섬은 각각 소스가 되고, 구멍은 surface 영역을 끊는다. 높이는 영역을 나누지 않는다.
  맵(지형·환경·구조물 객체)이 바뀔 때만 다시 나눈다(`terrainRegions`).
- 3D 플레이 중 오디오 프레임(80ms)마다 `lib/audio/game-soundscape.ts`가
  - 리스너를 발 높이 + 1.35m(눈높이), yaw 방향으로 옮기고,
  - 칸을 한 변 1인 정사각형으로 보고, 플레이어에서 각 영역 외곽까지 유클리드 거리 d를 잰다(영역 안이면 0).
  - 모든 층에서 d ≤ 2타일인 영역을 모아 **층을 가리지 않고 가까운 순**으로 최대 6개 켠다(fade in/out).
  - 음원 위치: 영역 외곽에서 플레이어에게 가장 가까운 점(안이면 플레이어 위치). 높이는 그 칸의 높이.
  - 음량: 1 − d/3(반경에서 0, 외곽·안에서 1). 패너의 거리 감쇠는 쓰지 않는다(`rolloff: 0`).
  - 패닝: width = 1 − d/2(`blend` 2타일). 0이면 패닝만, 1이면 방향 없이 좌우 모두 1.
    다가갈수록 양쪽이 강해지며 패닝 차이가 줄어 외곽에 닿으면 좌우 1, 안에서는 계속 좌우 1.
  - 농도(풀·안개·바람 세기)는 음량·위치에 쓰지 않는다. 가장 가까운 칸의 값을 영역 패치로 보낸다:
    **`whistle-region` [농도 0~1]** (나머지 층은 1). 값이 바뀔 때만 보내고, 패치에 `r whistle-region`이 없으면 건너뛴다.
  - 이미 켜진 영역은 d ≤ 3.5까지 유지하고, 거리 순위에서 0.5타일 가깝게 쳐서 경계에서 깜빡이지 않는다.
  - 여러 소리가 더해진 음량은 마지막 리미터가 받는다.
- 편집 화면 복귀·일시정지 시 켜진 영역을 모두 fade out한다. fade가 끝난 노드는 오디오 시계 기준으로 정리된다.
- 좌표: 격자 (x, z) → 장면 `n × 2 − size + 1`(타일 한 칸 2m), 높이 `tile.height × LEVEL`.
  종류 → 패치 매핑(`KIND_PATCHES`: plain·rough·slick·soft·water·grass·tree·fog·wind·stairs·bridge·canopy)은 지금 모두 `terrain_clock`.
- 콘솔 로그(`[Whistle:Audio]`): 오디오 시작(준비까지 걸린 시간), 소리 영역 등록 개수(종류별),
  영역별 켜짐/꺼짐, 로드 실패(warn).
- 엔진은 메인 스레드에서 로드되므로 무거운 3D 렌더링 중에는 늦다(GPU 없는 headless UWB 페이지에서 약 18초, 실험 페이지 0.4초).

게임 화면 연결은 단위 테스트(`tests/game-soundscape.test.ts`, `tests/terrain-sources.test.ts`)와
실제 브라우저에서의 청취로 확인한다. GPU 없는 headless 브라우저에서는 3D 장면이 너무 느려
게임 화면 브라우저 테스트가 클릭 단계에서 멈추므로 자동화하지 않았다.

## 앱에서 쓰는 Pd 입력

| 버스 | 값과 용도 |
| --- | --- |
| `whistle-edit` | 편집 좌표 X·Z, 겹침, 아이콘, 동작, 지면 재질 → `edit.pd` |
| `whistle-player` | X, 발 높이, Z, 풀·바위, 접지·낙하, 시선 각도, 물 → `player.pd`. 배치 음원 효과도 같은 X를 받아 40~160Hz로 변조 |
| `whistle-event` | 주파수, 음량, 패닝 → `event.pd` |
| `whistle-board-height` | UWB 보드의 바닥 기준 높이(0~10m). 가상 지면의 발 높이와 독립 |
| `$1-whistle-resonance` / `$1-whistle-resonance-control` | 풀 타격·고리 숨결의 위치, 음량, 재질, 재생 제어 → `world-resonance-live.pd` |

배치 음원은 거리·패닝을 거쳐 `world-audio.pd`의 `[adc~ 1 2]` → `placed-sound-fx.pd` → 세션 출력으로 흐른다. 입력은 앱 내부의 녹음 재생 전용이다. `audio:build`는 pd4web 3.4.1의 브라우저 연결 코드에서 마이크 자동 연결을 빼고, 스테레오 입력을 libpd의 L/R 교차 순서로 전달한다. 엔진 버전을 올리면 배치 음원의 주파수와 좌우 채널을 재검증한다.

## 실행

```sh
npm ci
npm run dev:audio
```

Vite에 표시된 주소 뒤에 `audio-lab/index.html`을 붙여 연다.
기본 주소는 `http://127.0.0.1:5173/whistle/audio-lab/index.html`이다.
`오디오 시작`을 클릭하고 두 입력 그룹을 조작한다. `오디오 종료`로 정지한다.

```sh
npm run test:audio
npm test
npm run build
```

오디오 테스트와 전체 브라우저 테스트, 빌드, `npm run dev`는 먼저 `audio:build`(엔진·패치 파일 복사)를 한다.
패치를 수정한 뒤에는 `npm run audio:build` 후 페이지를 새로고침한다(컴파일 없음).
빌드 결과에도 `/whistle/audio-lab/index.html` 테스트 페이지가 포함된다.
생성 파일 `public/audio-test/`는 Git에서 제외하며 빌드로 재생성한다.

### 사운드스케이프 엔진

```text
패치 노드 → 게인(fade·음량) ─┬→ PannerNode(3D) → 패닝 게인 ──────────────┬→ 마스터 → 출력   (AudioContext 1개)
                             └→ 가운데 게인 ─(diffuse면 → 공유 확산 버스)─┘
```

- width(0~1): 패닝 경로(PannerNode)와 가운데 경로를 섞는다.
  - 기본(필터 없음): 가운데 경로는 같은 신호를 좌우에 그대로 보낸다(모노 → 좌우 1). 같은 신호끼리라 직선으로 섞는다
    (패닝 1 − width, 가운데 width). 측정(오른쪽 옆 소스): width 0 → L 0 / R 1, 0.5 → 0.5 / 1, 1 → 1 / 1.
  - `diffuse: true`(게임에서는 주소에 `?diffuse`, 실행 중에는 **F 키**로 켜고 끔. `setDiffuse()`): 가운데 경로를 공유 확산 버스로 보낸다. 모노로 모은 뒤
    왼쪽·오른쪽에 서로 다른 all-pass 필터 4개씩을 걸어 좌우를 다르게(비상관) 만들고 equal-power로 섞는다.
    필터가 소리를 바꿀 수 있어 기본은 끔. 측정(정면, 잡음): 좌우 상관 width 0 → 1.00, 0.5 → 0.56, 1 → 0.31.
- `messages`: 소스마다 패치로 보낼 메시지(버스 → 값). 값이 바뀔 때만 보낸다. 패치에 없는 버스는 건너뛴다.

- `lib/audio/pd-runtime.ts`: 엔진은 페이지당 1개. 패치 파일은 한 번만 엔진에 보낸다(해시가 바뀌면 다시).
  만든 노드는 연결하지 않고 돌려준다.
- `lib/audio/soundscape.ts`: 소스 등록(`set`)만으로는 노드를 만들지 않는다.
  `activate`에서 로드·연결하고 fade in, `deactivate`에서 fade out 후
  `update()`(매 프레임)가 오디오 시계 기준으로 노드를 정리한다. 타이머는 쓰지 않는다.
  로딩 중 끄기, fade out 중 다시 켜기(같은 노드로 현재 값에서 복귀), 로드 실패 후 재시도를 처리한다.
- 좌표는 3D 장면 좌표(미터). 리스너는 위치와 바라보는 방향 벡터로 설정한다.
  타일 좌표 변환과 yaw → 방향 벡터 변환은 게임 연결 쪽 책임이다.
- 패닝 기본값은 equalpower(가벼움, 좌우 뚜렷, 앞뒤 구분 없음). HRTF(앞뒤·높이 단서,
  더 무거움)는 `panning: "HRTF"` 옵션. 성능을 확인한 뒤 HRTF로 옮기는 것이 목표다.
  HRTF에서 저음은 좌우 음량차가 작고 방향감은 주로 도달 시간차로 생긴다.
- 실험 페이지: `audio-lab/soundscape.html` (`?panning=hrtf`로 비교).
  평면도를 클릭해 패치를 놓고 리스너 방향을 돌린다.

### 패치 목록과 복사 (`npm run audio:build`)

`audio/patch-targets.json`의 `patches` 배열에 등재한 패치와, 그것이 (재귀적으로) 불러오는 하위 패치 파일을
`public/audio-test/patches/`에 그대로 복사한다. 하위 패치는 등재하지 않는다.

- `patches/manifest.json`: 엔진 정보와 패치별 의존 파일·해시. 해시(엔진 버전 + 의존 파일 내용)는 브라우저 캐시를 넘기는 데 쓴다.
- 엔진 파일은 `audio/engine/`에서 `public/audio-test/pd4web/`로 복사한다.
- 목록에서 빠진 패치 파일과 예전 WebPd 결과물(wasm, 런타임)은 지운다.

게임 화면(`/whistle/`)에서는 격자를 편집하거나 플레이를 시작하면 연결된다.
실험 페이지에서는 같은 패치에 직접 입력한 파라미터를 보내 비교할 수 있다.
비주얼과 플레이어 이동 로직은 유지했다. 기존 이벤트음은 Pd 합성으로 교체되어 감쇠 특성이 다를 수 있다.

## 검증 범위

`npm run test:soundscape`는 영역 믹서, 게임·가상 UWB의 격자 계산, 실제 pd4web 출력의 풀 타격·고리 숨결을 확인한다. `tests/browser/placed-sounds.spec.ts`는 게임에서 업로드한 음원의 변조 주파수를 검사한다.

`tests/soundscape.test.ts`는 가짜 AudioContext로 엔진의 연결 순서, fade 램프 값,
오디오 시계 기준 정리, 로딩 중 끄기·다시 켜기, 실패 후 재시도, dispose를 확인한다.

`tests/browser/soundscape-lab.spec.ts`는 실험 페이지에서 Chromium과 Firefox로 다음을 확인한다
(`npm run test:audio`가 둘 다 실행. Firefox는 AudioListener의 AudioParam이 없어 예전 API로 설정한다).

- equalpower(기본): 리스너 정확히 왼쪽의 소리는 R 채널 무음, 뒤로 돌면 L 채널 무음(기하 검증)
- HRTF(옵션): AudioContext 1개에서 엔진 생성 1회, 패치 인스턴스 2개 동시 실행,
  끄면 fade 후 노드 정리·무음, 다시 켜기, 종료, 콘솔 오류 없음

HRTF의 공간감(앞뒤·거리감)은 귀로 확인한다.

## 참고

- [pd4web](https://github.com/charlesneimog/pd4web): 엔진, CLI, JS API(`pd4web.d.ts`).
- 성능(2026-11-21, i5-7200U 3.1GHz 고정, headless Chromium, 코어 하나 기준): grass 1개 WebPd 11.1% / pd4web 8.7%,
  grass 6개 WebPd 51%(노드 6개)·48%(패치 하나에 6개) / pd4web 23%(엔진 하나).

### 물길 끝에서 돌아오는 숨결

평평한 빈 구역에 다음 모양을 놓는다. `풀`은 **번짐**, `물`은 **흐름**, `·`은 빈 타일이다.

```text
·  ·  ·  물 물 물
풀 물 물 물 ·  물
·  ·  ·  물 물 물
```

- **고리가 닫혔을 때** 풀 타격이 물길을 거쳐 부드럽게 부풀었다 사라지는 숨소리로 돌아온다. 풀에서 고리까지 멀수록 늦게 도착하고, 고리 안의 빈칸이 많을수록 길게 사라진다.
- **물길을 끊을 때** 가운데 줄의 세 번째 칸을 지운다. 고리는 닫혀 있어도 풀에서 닿을 수 없어 그쪽에서 오는 응답은 멈춘다.
- **고리만 열 때** 물길을 복구하고 윗줄 가운데 물을 지운다. 같은 풀 타격이 열린 물길 끝에서 짧고 둥근 메아리로 돌아온다. 이미 난 숨결은 짧게 잦아든다.
- 타격의 출발점은 기존 게임에서 소리를 내는 가장 짙은 풀밭이다. 물길은 상하좌우로 따라가며, 고리 안의 마른 빈 타일은 대각선으로도 바깥과 이어지지 않아야 한다. 여러 고리에 닿으면 가장 가까운 하나를 울린다.
- 게임과 가상 UWB에서 같은 세계를 열고 풀 가까이에 멈춰 듣는다. `whistle-resonance`의 다섯째 값은 물길 거리(칸), 여섯째 값은 닿는 고리의 내부 면적(칸)이다. 열린 물길은 두 칸부터 응답한다. [숨결·메아리 음색 패치](patches/water-loop-return.pd)
- 공간화를 비교하려면 위 배치에서 풀과 고리 사이에 선다. 격자 위쪽을 정면으로 두면 풀 타격은 왼쪽, 숨결은 오른쪽에서 들린다. [Pd의 음량·패닝 입력값](../docs/soundscape-design.md#pd가-받는-값)

과거 세 가지 청음 실험의 MP3는 `output/world-studies/`에 있다. 원본을 다시 렌더링할 때만 FFmpeg와 `webpd@1.0.0-alpha.14`가 필요하다. `npm install --no-save --package-lock=false webpd@1.0.0-alpha.14` 후 `node --experimental-strip-types scripts/render-world-studies.mjs`로 생성한다.
