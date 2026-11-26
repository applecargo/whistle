# 공간화 소스와 규칙

공간화 채널(슬롯 15개, `dac~ 3`–`32`)에 나가는 소리를 **소스**라고 부른다. 소스는 세 종류이고 모두 같은 길로 나간다.

| 종류 | 누가 켜고 끄나 | 슬롯의 이름(`$1`) | 코드 |
| --- | --- | --- | --- |
| 영역(지형·환경·구조물) | JS(가까운 순 최대 6개) | `v1`, `v2`…(엔진) | `lib/audio/game-soundscape.ts` |
| 배치한 소리(업로드) | JS(가까운 순 최대 3개) | `v1`, `v2`…(엔진) | `lib/audio/placed-sounds.ts` |
| 이벤트 소리(fallingstar 등) | 게임 또는 Pd가 만들고, 게임이나 Pd가 끈다 | 만든 쪽이 정한 이름(`star1`, `fallingstar`) | `lib/audio/event-sources.ts` |

길: 패치 → gain(음량·페이드) → PannerNode(equal power, 방향) + 가운데 경로(width) → 마스터. 채널을 나누는 것은 JS 한 곳이다(`engine.start`).

## 규칙: 거리 → 음량·width (`lib/audio/spatial-rule.ts`)

```
x = 1 − 거리/range              range 밖 0, 닿으면(영역 가장자리·소리 위치) 1
음량 = curve(x)
width = width + (1 − width) · x   range에서 시작값, 닿으면 1(방향 없이 좌우 모두)
```

| curve | 쓰는 법 | 느낌 |
| --- | --- | --- |
| `lin` | `curve lin` | x 그대로. 귀로는 멀리서 빨리 커지고 가까이서 덜 커진다 |
| `pow n` | `curve pow 2` | xⁿ. n이 클수록 가까이서 몰려 커진다 |
| `exp` | `curve exp` (dB 폭을 붙일 수 있다: `curve exp 60`, 기본 40) | 천천히 올라가다 가까이서 훅. range 끝 −40dB에서 dB가 거리에 따라 직선으로 오른다(0에서 시작하게 고친 식) |
| `log` | `curve log` | exp의 거울. 빨리 올라가고 가까이서 천천히 |

기본 규칙:

| 소스 | range | width | curve |
| --- | --- | --- | --- |
| 영역 | 2 (`DEFAULT_NEARBY.radius`, width는 `blend` 2부터) | 0 | lin |
| 배치한 소리 | 놓인 칸의 환경(2–6, `sound-range.ts`) | 0 | pow 2 |
| 이벤트 소리 | 10 | 0.3 | lin (fallingstar도 같다) |

## Pd가 규칙을 바꾸기

패치가 자기 이름(`$1`)을 앞에 붙인 리스트로 `[s whistle-source]`에 보낸다. 예: `environment_water.pd`

```
[loadbang]
|
[curve exp(
|
[list prepend $1]
|
[s whistle-source]
```

- **영역·배치한 소리**: 그 패치 이름의 모든 소스에 적용된다(페이지를 새로 열 때까지 JS가 기억한다).
  처음 켜질 때는 아직 모르므로 기본 규칙으로 켜지고, loadbang이 알린 뒤부터 그 규칙이다. range를 넓히면 그 뒤로 더 멀리서부터 켜진다.
- **이벤트 소리**: 그 소스 하나에만.
- 여러 개를 한 번에: `range 4 curve exp width 0.2`. 빠진 것은 그대로.

## 이벤트 소리

### 만들기

- 게임: `useGameAudio`의 `spawn(이름, 패치, pos, 규칙)`. 지금은 디버그 화면(백틱)의 1 키가 `fallingstar`를 플레이어 앞 4칸, 6 위에 띄운다.
- Pd: `[s whistle-spawn]`에 리스트 `<이름> <패치> x y z [규칙…]`(아래 "보내는 모양"). 예: `star1 fallingstar_source 0.5 3 0.5 range 8 curve exp`.
  - 좌표는 `whistle-player position`과 같다: x, z = 0~1, y = 높이(발 높이와 같은 단위).
  - 이름은 만드는 쪽이 정한다. `v`+숫자 꼴(엔진이 쓰는 이름)과 지금 살아 있는 이름은 받지 않는다(콘솔에 경고).
    끝난 이름은 다시 쓸 수 있지만, 끝나자마자 같은 이름이면 페이드 아웃 중인 것과 겹칠 수 있어 `star1`, `star2`처럼 늘려 쓰는 게 안전하다.
- 슬롯은 `on N <패치> <이름> L R`로 영역과 똑같이 뜬다. 슬롯이 모자라면 띄우지 않고 경고만 한다(다시 시도하지 않는다).

### 공유 값

소스마다 값이 한 묶음 있다. 누가 바꾸든 JS 한 곳에 두고, 바뀐 것을 패치의 `[r $1-whistle-source]`로 보낸다.
그래서 패치는 자기가 바꿨든 게임이 바꿨든 늘 같은 값을 본다. 동시에 바꾸면 나중에 온 값이다.

| 값 | 바꾸기(`[s whistle-source]`에 `<이름> …`, 게임은 `setSource(이름, […])`) | 패치가 받는 것 |
| --- | --- | --- |
| `alive` | `star1 alive 0`: 끝내기(먼저 쓴 쪽이 끝낸다). 페이드 아웃 뒤 슬롯을 닫는다 | 열 때 `alive 1` |
| `pos` | `star1 pos x y z` | 바뀔 때 |
| `range`, `width`, `curve` | `star1 range 6`, `star1 curve exp` | 열 때와 바뀔 때 |
| `distance` | (JS가 계산) | 플레이어까지 거리(타일, 높이 한 칸 = 2). 바뀔 때마다 |

`fallingstar_source.pd`는 `alive`를 `[fallingstar]`의 입구로 넣는다(1 = 별이 떨어지기 시작).

### 보내는 모양: 이름을 앞에 붙인 리스트

`whistle-spawn`과 `whistle-source`는 JS가 바로 받는다(main.pd를 거치지 않는다). 패치는 늘 **리스트**로 보낸다.

```
[curve exp(            [star1 fallingstar_source 0.5 3 0.5(
|                      |
[list prepend $1]      [list]
|                      |
[s whistle-source]     [s whistle-spawn]
```

메시지 상자에서 `[s]`로 바로 보내거나 `[; whistle-spawn star1 …(`로 보내면 리스트가 아니라 메시지라서 JS에 오지 않는다(아무 일도 없다).
pd4web은 한 이름을 한 종류로만 받을 수 있어서(두 종류로 받으면 겹쳐 불린다, [`pd-to-js-fix.md`](pd-to-js-fix.md)) 리스트 하나로 정했다.

## 시험

- `tests/spatial-rule.test.ts`: 곡선, 영역 기본 규칙이 예전 그대로인지, 패치 규칙
- `tests/event-sources.test.ts`: 만들기·이름·공유 값·실패
- `tests/browser/event-sources.spec.ts`: 실제 엔진에서 Pd가 만들고 끄기, 1 키의 fallingstar, 영역 슬롯에 규칙 보내기
