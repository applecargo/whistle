# WebPd 오디오 연결과 테스트

## 역할 분리

게임은 상호작용과 공간 상태를 계산하고 Pd에 전달한다. Pd는 그 값으로
합성·재생·엔벌로프·음색 변화를 처리한다. 오디오 때문에 지형을 다시 생성하거나
플레이어 이동 계산을 변경하지 않는다.

```text
2D 편집 결과 ── 단발 이벤트 ─┐
                            ├─ 오디오 어댑터 → WebPd AudioWorklet → Pd DSP → 출력
3D 이동 상태 ── 연속 값 ─────┘
```

하나의 AudioContext에서 여러 패치(named patch)를 실행한다. 상호작용 패치(`uwb-player.pd`)가
편집용 소리와 플레이용 소리를 나누고, 지형 사운드스케이프 패치(`terrain_clock.pd` 등)는 공간에 배치한다. 최종 패치가 여러 파일이면 상위 패치에서 합성한다.
현재 테스트는 단일 .pd 파일이다. 샘플 파일·외부 오브젝트·서브패치는 아직 검증하지 않았다.

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
- 3D 상태를 수신하면 고정 크기의 연속 시험음을 재생한다. 제자리나 점프 중에도
  위치·재질 상태를 전달하며, 이동 속도로 음량을 조절하지 않는다.
- 편집 화면 복귀·문서 교체·blur·탭 숨김 시 보행 상태와 대기 입력을 비우고 음소거한다.
  다시 키나 포인터를 조작하면 재개한다. 세션은 재사용하고 컴포넌트 해제 시 닫는다.
- 패치 로딩 중 편집은 마지막 한 건, 이동은 최신 상태만 보존한다. 모드 전환 시
  대기 입력을 취소한다. 로딩 실패는 편집·이동을 막지 않으며 다음 클릭에서 재시도한다.
- 기존 시뮬레이션의 `sound` 이벤트도 `whistle-event`로 전송한다. 기존 주파수 선택,
  거리 감쇠·방향 계산은 유지하며 소리 합성은 Pd에서 처리한다.

좌표는 어댑터에서 `(gridCoordinate + 0.5) / world.size`로 정규화한다.
높이는 장면의 발 높이다. 3D 오디오는 연속 시험음으로 연결했으며,
최종 발걸음 샘플·착지 소리·개별 바위 오브젝트 접촉음은 아직 구현하지 않았다.
현재 아이콘 ID, 추가/삭제, 지면 종류는 패치로 전달되지만 개별 아이콘 음색은 아직 지정하지 않았다.

### 믹스 구조와 지형 사운드스케이프 (`components/whistle/useGameAudio.ts`)

```text
edit.pd · player.pd(→ 이동음 게인) · event.pd ─┐
지형 타일 패치들(PannerNode, equalpower) ────────┼─→ 마스터 게인 → 리미터 → 출력   (AudioContext 1개)
배치한 녹음 사운드 ─────────────────────────────┘
```

- 상호작용 패치는 `edit`(whistle-edit), `player`(whistle-player·whistle-board-height),
  `event`(whistle-event) 세 개로 나뉘며 각각 `whistle-ready`를 받은 뒤 사용한다.
- 음소거(편집 화면 복귀·blur·탭 숨김)는 `whistle-gate` 대신 마스터 게인 fade, 3D 이동음 정지는
  `whistle-player-stop` 대신 `player` 패치 뒤의 게인 fade로 한다. 두 버스는 더 이상 쓰지 않는다.
- 3D 플레이 중 오디오 프레임(80ms)마다 `lib/audio/game-soundscape.ts`가
  - 지형이 바뀌었을 때만 타일 소스를 다시 등록하고(노드 없음),
  - 리스너를 발 높이 + 1.35m(눈높이), yaw 방향으로 옮기고,
  - 플레이어에서 반경 3타일 안의 가까운 타일 최대 10개만 켠다(fade in/out).
    이미 켜진 타일은 반경 + 0.5타일까지 유지하고 순위에서도 0.5타일 가깝게 쳐서 경계에서 깜빡이지 않는다.
- 편집 화면 복귀·일시정지 시 켜진 타일을 모두 fade out한다. fade가 끝난 노드는 오디오 시계 기준으로 정리된다.
- 좌표: 격자 (x, z) → 장면 `n × 2 − size + 1`(타일 한 칸 2m), 높이 `tile.height × LEVEL`.
  구멍 타일은 소스가 없다. 지면 종류 → 패치 매핑(`SURFACE_PATCHES`)은 지금 모두 `terrain_clock`.
- 콘솔 로그(`[Whistle:Audio]`): 오디오 시작(준비까지 걸린 시간), 지형 소스 등록 개수,
  타일별 켜짐/꺼짐, 로드 실패(warn).
- 패치 준비 신호는 메인 스레드로 오므로 무거운 3D 렌더링 중에는 늦다. GPU 없는 headless Chromium에서
  3D 장면 실행 중 17~23초가 걸렸다(실험 페이지에서는 0.1초대). 제한 시간은 30초.

게임 화면 연결은 단위 테스트(`tests/game-soundscape.test.ts`, `tests/terrain-sources.test.ts`)와
실제 브라우저에서의 청취로 확인한다. GPU 없는 headless 브라우저에서는 3D 장면이 너무 느려
게임 화면 브라우저 테스트가 클릭 단계에서 멈추므로 자동화하지 않았다.

## 최소 테스트 구현

- 원본: `audio/patches/uwb-player.pd` (`player3.pd`를 불러옴)
- WebPd: `1.0.0-alpha.14` 고정, 개발 의존성. `.pd`를 WASM으로 사전 컴파일한다.
- 브리지: `lib/audio/webpd-runtime.ts`(패치 로드) · `lib/audio/webpd-session.ts`(상호작용 패치의 버스 인터페이스)
- 게임 연결: `components/whistle/useGameAudio.ts`, `lib/audio/game-audio.ts`, `lib/audio/game-parameters.ts`
- 수동 테스트: `audio-lab/index.html`
- 다중 패치 실험: `audio-lab/soundscape.html`, 회귀 테스트 `tests/browser/soundscape-lab.spec.ts`

| Pd 버스 | 입력 | 테스트 패치의 반응 |
| --- | --- | --- |
| `whistle-edit` | `[x, z, overlap]` | `440 + 220 × overlap` Hz, 짧은 엔벌로프. X/Z는 수신 확인용 |
| `whistle-player` | `[x, y, z, grass, rough]` | `220 + 220z + 220grass + 440rough` Hz, 고정 진폭 0.02, X에 따른 좌우 출력. Y는 수신 확인용 |
| `whistle-board-height` | `[heightMetres]` | UWB 테스트 전용. 0~10m, 위 플레이 시험음에 `110 × heightMetres` Hz 추가. 초기값 0 |
| `whistle-player-stop` | `bang` | 3D 음만 정지. 편집 화면 복귀·일시정지에서 사용 |
| `whistle-event` | `[frequency, gain, pan]` | 기존 규칙 이벤트용 사인파, 25ms 어택·1100ms 감쇠 |
| `whistle-gate` | `[0 또는 1]` | 전체 음소거/해제, 20ms 변화 |
| `whistle-ready` | 패치 → 브라우저 `bang` | DSP 초기화 확인 |

게임에서 보내는 메시지는 기본 값 뒤에 문맥을 덧붙인다.

- `whistle-edit`: `[x, z, overlap, assetId, action, surface]`
- `whistle-player`: `[x, y, z, grass, rough, grounded, falling, yaw, water]`

접지·낙하·물은 0/1이고 yaw는 라디안이다. 기존 실험 페이지는 앞의 기본 값만 전송한다.
현재 패치는 뒤의 문맥 값을 수신·반환하며 음색 합성에는 기본 값만 사용한다.

UWB 테스트의 보드 높이는 현실 바닥 기준 미터 값이며, 가상 지면/발 높이 `y`와 별개다.
`InteractionSession.boardHeight()`로 별도 버스에 보내며 유한하지 않거나 0~10m 범위 밖이면 거부한다.
UWB 페이지에서 숫자 또는 JSON의 `boardHeight`로 시험한다. 높이만 바뀌어도 시험음에 반영된다.
일반 게임은 이 버스를 보내지 않으므로 기존 시험음과 동작을 유지한다.

X/Z·겹침·풀·바위 값은 0–1로 제한한다.
유한하지 않은 숫자는 전송하지 않는다. 테스트 음은 최종 사운드 디자인이 아니며,
X에 따른 좌우 출력도 실제 플레이어 방향을 고려한 3D 공간음향은 아니다.

WebPd alpha.14의 기본 외부 입력은 최상위 `[send]` 객체의 inlet으로 전달된다.
패치에 같은 이름의 `[s whistle-player]`와 `[r whistle-player]`를 두었고,
JS는 컴파일 결과 메타데이터에서 해당 노드 ID를 찾아 사용한다.
`n_0_*` 같은 컴파일러 생성 ID를 앱에 고정하지 않는다.
각 `[r]`의 메시지가 브라우저로 돌아오는 것을 확인하며, 별도로 PCM 출력도 측정한다.

`run()` 반환만으로 DSP가 준비됐다고 가정하지 않는다. `[loadbang]`에서 오는
`whistle-ready`를 받은 후에만 입력을 허용한다. 오디오는 클릭으로 시작하고,
시작 실패·종료 시 AudioContext와 노드를 정리한다. 재시작도 가능하다.
테스트 페이지가 숨겨지면 음소거하며 사용자가 해제한다. 마이크 입력은 사용하지 않는다.

## 예전 엔진에서 옮기기

예전 `createPdSession(baseUrl, receive)`(단일 `patch.wasm`, 세션마다 AudioContext 생성)는 삭제했다.
같은 메서드(`edit`·`player`·`stopPlayer`·`event`·`mute`·`boardHeight`·`close`, `context`, `node`)를 가진
`createInteractionSession(baseUrl, receive, shared?)`로 바꾼다. 내부에서는 `startPatch`로
`uwb-player` named patch를 로드하고 `whistle-ready`를 받은 뒤에 돌려준다.

- `shared` 없이 부르면 예전처럼 AudioContext를 새로 만들고 `close()` 때 닫는다.
  실험 페이지(`audio-lab/index.html`, `uwb-lab`)는 이 방식으로 옮겼다(이름만 변경).
- 게임처럼 다른 패치와 함께 쓰려면 `shared: { context, output }`으로 AudioContext를 공유한다.
  이때 `close()`는 패치만 정리하고 컨텍스트는 닫지 않는다.
- 브라우저 테스트에서 패치 로드를 가로챌 때는 `**/audio-test/patches/uwb-player.wasm`을 쓴다.
- 새 패치를 추가할 때는 `audio/patch-targets.json`에 등재하고 `startPatch(context, baseUrl, 이름)`으로 로드한다.
  외부 메시지는 최상위 `[send 이름]`이 있어야 manifest의 `inputs`에 나타난다(위 참고).

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

오디오 테스트와 전체 브라우저 테스트, 빌드는 패치를 먼저 컴파일한다.
일반 `npm run dev`도 패치를 자동 컴파일한다.
패치를 수정한 뒤에도 다시 컴파일하고 페이지를 새로고침한다.
빌드 결과에도 `/whistle/audio-lab/index.html` 테스트 페이지가 포함된다.
생성 파일 `public/audio-test/`는 Git에서 제외하며 빌드로 재생성한다.

### 사운드스케이프 엔진

```text
패치 노드 → 게인(fade) → PannerNode(3D) → 마스터 → 출력      (AudioContext 1개)
```

- `lib/audio/webpd-runtime.ts`: 런타임 스크립트는 페이지당 1회, 워클릿 초기화는
  AudioContext당 1회. 패치 wasm은 한 번 받아 캐시하고 인스턴스마다 사본을 넘긴다.
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

### 패치별 빌드 (사운드스케이프용)

`audio/patch-targets.json`의 `patches` 배열에 등재한 패치만 각각 컴파일한다.
다른 패치 안에서 불러오는 하위 패치(abstraction)는 등재하지 않는다.

- 출력: `public/audio-test/patches/<이름>.wasm`, 전체 목록은 `patches/manifest.json`
  (파일명·해시·크기·send/receive 버스)
- 캐시: 대상 패치와 그것이 불러오는 하위 패치 전체의 내용, WebPd 버전으로 해시를 만든다.
  해시가 같고 wasm이 있으면 건너뛴다. 하위 패치만 고쳐도 다시 컴파일된다.
- 목록에서 빠진 패치의 이전 결과물은 빌드 때 지운다.
- WebPd 런타임(`webpd-runtime.js`)은 모든 패치가 공유하며 패키지에서 그대로 복사한다.
- 예전 단일 패치 빌드(`patch.wasm`, `io.json`)는 폐기했다. `uwb-player.pd`도 다른 패치와 같이
  목록에 등재해 `patches/uwb-player.wasm`으로 빌드한다. 예전 결과물이 남아 있으면 빌드가 지운다.
- 컴파일하는 패치마다 시작·완료 시간을 출력한다. 큰 패치는 1분 이상 걸릴 수 있다.

게임 화면(`/whistle/`)에서는 격자를 편집하거나 플레이를 시작하면 연결된다.
실험 페이지에서는 같은 패치에 직접 입력한 파라미터를 보내 비교할 수 있다.
비주얼과 플레이어 이동 로직은 유지했다. 기존 이벤트음은 Pd 합성으로 교체되어 감쇠 특성이 다를 수 있다.

## 검증 범위

upstream의 사인파 시험 패치(`interaction-test.pd`)와 그 브라우저 테스트
(`audio.spec.ts`, `game-audio.spec.ts`)는 현재 패치와 맞지 않아 폐기했다.
위 버스 표의 주파수 설명은 그 시험 패치 기준이며, 기존 엔진 교체 시 함께 정리한다.

`tests/soundscape.test.ts`는 가짜 AudioContext로 엔진의 연결 순서, fade 램프 값,
오디오 시계 기준 정리, 로딩 중 끄기·다시 켜기, 실패 후 재시도, dispose를 확인한다.

`tests/browser/soundscape-lab.spec.ts`는 실험 페이지에서 Chromium과 Firefox로 다음을 확인한다
(`npm run test:audio`가 둘 다 실행. Firefox는 AudioListener의 AudioParam이 없어 예전 API로 설정한다).

- equalpower(기본): 리스너 정확히 왼쪽의 소리는 R 채널 무음, 뒤로 돌면 L 채널 무음(기하 검증)
- HRTF(옵션): AudioContext 1개에서 WebPd 초기화 1회, 패치 인스턴스 2개 동시 실행,
  끄면 fade 후 노드 정리·무음, 다시 켜기, 종료, 콘솔 오류 없음

HRTF의 공간감(앞뒤·거리감)은 귀로 확인한다.

## 참고

- [WebPd 공식 저장소](https://github.com/sebpiq/WebPd): 컴파일 방식, 지원 오브젝트, 메시지 순서 지침.
- [WebPd 런타임](https://github.com/sebpiq/WebPd_runtime): AudioWorklet 실행 계층.

알파 버전이므로 컴파일러 내부 메타데이터 읽기는 빌드 스크립트에만 모았다.
업그레이드 시 이 스크립트와 오디오 테스트를 함께 확인한다.
WebPd 런타임의 LGPL 라이선스 파일도 생성 디렉터리와 배포물에 복사한다.
