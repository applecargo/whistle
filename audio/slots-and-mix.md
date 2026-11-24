# 슬롯과 믹스: 패치 소리가 스피커까지 가는 길

Pd 패치는 소리만 만든다. 그 소리가 어디서 얼마나 크게 들리는지는 Web Audio 쪽이 정한다.
앞부분(슬롯)은 `lib/audio/pd-runtime.ts`, 뒷부분(믹스)은 `lib/audio/soundscape.ts`·`components/whistle/useGameAudio.ts`.

## 1. 슬롯

브라우저에는 Pd 엔진이 하나뿐이고 그 안에서 여러 패치가 같이 돈다. 엔진 출력은 32채널 하나뿐이라
패치마다 두 채널씩 나눠 준다. 그 한 칸이 **슬롯**이다(16개, `SLOTS`). `[s]`/`[r]` 같은 메시지 통로가 아니다.

엔진 안의 모습(Pd 데스크톱에는 없고, 브라우저 엔진에서 JS가 만든다):

```
index.pd (host)
 ├ [pd slot0] 안: [environment_water slot0] → [dac~ 1 2]
 ├ [pd slot1] 안: [terrain_rough slot1]     → [dac~ 3 4]
 └ ...
```

- **Pd 쪽 슬롯**: `index.pd` 안의 `[pd slotN]` 서브패치 하나. 그 안에 `[패치 slotN] → [dac~ 2N+1 2N+2]`.
- **브라우저 쪽 슬롯**: 엔진 출력 32채널 중 두 채널을 꺼낸 스테레오 노드 하나.
- 패치 작성자에게 보이는 것은 `$1`(= `slotN`)뿐이다. `[r $1-whistle-region]`은 실제로 `[r slot3-whistle-region]`.
  `whistle-player` 같은 전역 이름은 슬롯과 상관없이 그대로다.

### 빈 host 패치를 연다

엔진에 들어 있는 패치는 이것뿐이다(`output/pd4web-engine/src/index.pd`).

```
#N canvas 0 50 450 300 12;
#X text 20 20 whistle host: slots are created by JS;
```

```ts
pd.openPatch("index.pd", { channelCountOut: SLOTS * 2, renderGui: false, ... });
```

엔진 출력을 32채널로 연다. 열린 패치의 캔버스는 `pd-index.pd`라는 이름으로 메시지를 받는다(`HOST`).

### 엔진 출력 32채널을 나눌 준비 (Web Audio)

```ts
worklet.disconnect();                                      // pd4web이 스피커에 바로 꽂아 둔 것을 뺀다
const splitter = context.createChannelSplitter(SLOTS * 2); // 32채널을 낱개로 나누는 노드
```

### 패치 하나 띄우기 = 슬롯 하나 쓰기 (`start`)

JS가 하는 일은 Pd의 동적 패칭과 같다. 캔버스에 `obj`, `connect` 메시지를 보내 상자를 만들고 잇는다.

```ts
let index = 0;
while (used.has(index)) index++;   // 비어 있는 가장 작은 번호
const slot = `slot${index}`;       // "slot3"
const canvas = `pd-${slot}`;       // "pd-slot3": [pd slot3] 서브패치의 캔버스 이름
```

(1) host에 서브패치 상자를 만든다(슬롯마다 처음 한 번).

```ts
message(HOST, "obj", [20, 40 + 30 * index, "pd", slot]);
```

Pd로 쓰면 `[; pd-index.pd obj 20 130 pd slot3(`.

(2) 그 서브패치 안을 채운다(`build`).

```ts
message(canvas, "clear", []);
message(canvas, "obj", [20, 20, name, slot]);                           // 0번 상자: [environment_water slot3]
message(canvas, "obj", [20, 80, "dac~", 2 * index + 1, 2 * index + 2]); // 1번 상자: [dac~ 7 8]
message(canvas, "connect", [0, 0, 1, 0]);                               // 왼쪽 outlet~ → dac~ 왼쪽
message(canvas, "connect", [0, 1, 1, 1]);                               // 오른쪽 outlet~ → dac~ 오른쪽
message(canvas, "loadbang", []);                                        // 동적으로 만든 패치에는 loadbang이 저절로 오지 않는다
```

Pd로 쓰면:

```
[; pd-slot3 clear;
   pd-slot3 obj 20 20 environment_water slot3;
   pd-slot3 obj 20 80 dac~ 7 8;
   pd-slot3 connect 0 0 1 0;
   pd-slot3 connect 0 1 1 1;
   pd-slot3 loadbang(
```

(3) 브라우저 쪽에서 그 두 채널을 꺼낸다.

```ts
const merger = context.createChannelMerger(2);
splitter.connect(merger, 2 * index, 0);       // 7번 채널(0부터 세면 6) → 왼쪽
splitter.connect(merger, 2 * index + 1, 1);   // 8번 채널 → 오른쪽
return { name, slot, node: merger, send, destroy };
```

`merger`가 이 패치만의 스테레오 소리다. 사운드스케이프가 이것을 받아 믹스한다(아래 2).

### 메시지 보내기 (`send`)

```ts
const target = options.scoped ? `${slot}-${bus}` : bus;
```

- 사운드스케이프 패치는 `scoped`로 연다: `send("whistle-region", …)` → `slot3-whistle-region` → 패치의 `[r $1-whistle-region]`.
- 상호작용 패치(edit·player·event)는 `scoped` 없이: `whistle-player` 그대로.

### 닫기 (`destroy`)

```ts
message(canvas, "clear", []);   // [pd slot3] 안을 비운다(상자 [pd slot3]는 남겨 다시 쓴다)
splitter.disconnect(merger);    // 브라우저 쪽 통로를 뗀다
used.delete(index);             // 번호를 비운다 → 다음 start가 이 번호를 쓴다
```

개발 서버에서 패치를 고쳐 다시 만들 때는 `build()`만 다시 부른다. `[pd slotN]` 안만 비웠다가 다시 채우고, 브라우저 쪽 통로는 그대로다.

## 2. 믹스

슬롯의 `merger`는 사운드스케이프 영역마다 이 줄기를 지난다.

```
[슬롯 N의 merger] ─→ gain(볼륨·페이드) ─┬─→ panner(방향) ─→ dry ─┐
   (patch.node)                           ├─→ wet(가운데) ──────────┤
                                          └─→ wetDiffuse ─→ diffuser ┤ (선택)
                                                                     ↓
                                           soundscape master ─→ 앱 master ─→ limiter ─→ 스피커
```

상호작용 패치(edit·player·event)는 이 줄기 없이 앱 master로 바로 간다(공간화 없음).

### 노드를 만들고 잇는다 (`soundscape.ts`의 `load`)

```ts
const patch = await start(context, voice.source.patch);   // 슬롯을 하나 띄운다(engine.start)
const gain = context.createGain();
gain.gain.value = 0;                                      // 0에서 시작해 페이드 인
const panner = context.createPanner();
panner.panningModel = panning;                            // 기본 "equalpower"(HRTF도 고를 수 있음)
panner.distanceModel = "inverse";
panner.refDistance = refDistance;
panner.rolloffFactor = rolloff;                           // 게임에서는 0: 패너는 거리 감쇠를 안 함
setPosition(panner, voice.source.position, true);
const dry = context.createGain();
const wet = context.createGain();
patch.node.connect(gain);
gain.connect(panner).connect(dry).connect(master);        // 방향이 있는 소리
gain.connect(wet).connect(master);                        // 방향 없이 가운데로 오는 소리
mix(voice, true);                                         // dry/wet 비율
deliver(voice);                                           // 패치에 첫 메시지(amount, distance)
fadeIn(id, voice);                                        // gain을 목표 볼륨까지
```

- **gain**: 이 영역의 볼륨. 켤 때 0에서 페이드 인, 끌 때 0으로 페이드 아웃(`fade` 기본 0.4초).
  거리에 따른 볼륨은 패너가 아니라 게임(`game-soundscape.ts`)이 영역 외곽까지 거리로 계산해 여기에 넣는다.
- **panner**: Web Audio 3D 패너. 소리가 어느 방향에서 오는지.
- **dry / wet**: 같은 소리를 두 갈래로. dry는 패너를 거쳐 방향이 있고, wet은 패너 없이 머리 가운데에서 들린다.

### 비율 (`mix`)

```ts
const width = voice.source.width ?? 0;   // 0 = 한 점에서, 1 = 사방에서
[voice.dry,        diffuse ? cos(width·π/2) : 1 - width],
[voice.wet,        diffuse ? 0              : width],
[voice.wetDiffuse, diffuse ? sin(width·π/2) : 0],
```

- `width`는 게임이 영역마다 정한다. 영역 멀리 있으면 한 점에서 오는 소리(dry), 영역 안에 서 있으면 둘러싸는 소리(wet).
- **diffuser**(비상관 필터, 기본 꺼짐): 켜면 wet 대신 `wetDiffuse`. 가운데 소리를 좌우가 조금씩 다른 all-pass 필터(`createDiffuser`)에
  통과시켜 머리 가운데가 아니라 넓게 퍼져 들린다.

### 방향 (`toListenerSpace`, `placePanner`)

- 리스너는 그래프에서 원점에 고정(앞 = −Z, `placeListenerAtOrigin`).
- 플레이어가 움직이거나 돌면 리스너를 옮기지 않고, 각 소스 위치를 플레이어 기준 좌표로 바꿔 패너에 넣는다(`toListenerSpace`).
- Firefox는 리스너 위치를 부드럽게 옮길 수 없지만 패너 위치는 AudioParam이라 부드럽게 옮길 수 있기 때문이다(`placePanner`의 `ramp`).

### 마지막 출구 (`useGameAudio.ts`)

```ts
master = context.createGain();
const limiter = context.createDynamicsCompressor();   // -3dB, 비율 20: 사실상 리미터
master.connect(limiter).connect(context.destination);
createInteractionSession(engine, undefined, master);   // edit·player·event → master로 바로
createSoundscape({ destination: master, rolloff: 0, ..., start: (_c, name) => engine.start(name, { scoped: true }) });
```

사운드스케이프에도 자기 master가 하나 있고(`soundscape.ts`), 그것이 앱 master로 간다. 앱 master는 리미터를 거쳐 스피커로.

### 게임이 매 프레임 넣는 값 (`game-soundscape.ts`)

```ts
scape.set({ id, patch, position, gain, width, messages: { [REGION_BUS]: [["amount", amount], ["distance", distance]] } });
```

| 값 | 가는 곳 |
| --- | --- |
| `position` | panner 위치(방향) |
| `gain` | gain 노드(거리에 따른 볼륨) |
| `width` | dry/wet 비율(둘러싼 정도) |
| `messages` | 슬롯의 `[r $1-whistle-region]`으로 `amount`, `distance`(값이 바뀔 때만, `deliver`) |
