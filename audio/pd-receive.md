# 패치에서 받을 수 있는 값

모든 패치는 Pd 엔진 하나 안에서 같이 돈다. 그래서 **전역 이름은 어느 패치에서나 그대로 받을 수 있다.**
`environment_*.pd`에서 플레이어 상태가 필요하면 `[r whistle-player]`를 놓으면 된다. `player.pd`가 받는 것과 같은 값이 동시에 들어온다.

값은 리스트로 오니 `[r 이름]` → `[unpack f f f …]`로 나눈다(글자가 섞인 리스트는 `s`: `[unpack f f f s s s]`).

| 받는 이름 | 값 | 언제 오나 |
|---|---|---|
| `whistle-player` | `x y z grass rough grounded falling yaw water` | 3D 플레이 중 약 0.08초마다 |
| `$1-whistle-region` | `amount` | 영역 패치만. 켜질 때와 값이 바뀔 때 |
| `whistle-edit` | `x z overlap asset action surface` | 편집 화면에서 칸을 바꿀 때 |
| `whistle-event` | `frequency gain pan` | 3D 플레이 중 규칙 이벤트가 일어날 때 |
| `whistle-board-height` | `height` | UWB 테스트 페이지에서만 |

## whistle-player (플레이어 상태)

| 순서 | 이름 | 범위 | 뜻 |
|---|---|---|---|
| 1 | `x` | 0~1 | 지도 위 동서 위치(0 서쪽 끝, 1 동쪽 끝) |
| 2 | `y` | 미터 | 발 높이(가상 지면 기준) |
| 3 | `z` | 0~1 | 지도 위 남북 위치(0 북쪽 끝, 1 남쪽 끝) |
| 4 | `grass` | 0~1 | 발밑 풀의 농도 |
| 5 | `rough` | 0~1 | 발밑 바닥의 거친 정도(물속이면 0) |
| 6 | `grounded` | 0/1 | 땅에 서 있으면 1(점프·낙하·비행 중 0) |
| 7 | `falling` | 0/1 | 구멍에 떨어지는 중이면 1 |
| 8 | `yaw` | 라디안 | 바라보는 방향. 0 = 북(−z), π/2 = 동(+x). 한 바퀴 돌아도 0으로 돌아가지 않고 계속 커지거나 작아진다 |
| 9 | `water` | 0/1 | 물속이면 1 |

편집 화면으로 돌아가거나 일시정지하면 보내지 않는다(마지막 값이 그대로 남는다).

## $1-whistle-region (영역 패치 전용)

사운드스케이프 영역 패치(`terrain_*`, `environment_*`, `structure_*`)는 같은 패치가 여러 영역에 동시에 뜬다.
그래서 영역마다 따로 오는 값은 `$1`을 붙여 받는다: `[r $1-whistle-region]`. `$1`은 슬롯 이름(`slot0`…)이다.

- `amount` 0~1: 플레이어에게 가장 가까운 칸의 농도. 풀·안개·바람은 그 세기이고, 나머지 층은 늘 1이다.
- 영역의 음량, 위치, 패닝은 브라우저가 처리한다. 패치가 거리를 계산할 필요는 없다.

## whistle-edit (편집음)

| 순서 | 이름 | 뜻 |
|---|---|---|
| 1 | `x` | 바꾼 칸의 동서 위치 0~1 |
| 2 | `z` | 바꾼 칸의 남북 위치 0~1 |
| 3 | `overlap` | 그 칸에 겹친 환경의 정도 0~1(풀, 물, 안개, 어둠, 거친 바닥, 구조물 중 가장 큰 값) |
| 4 | `asset` | 놓거나 지운 물체 이름. 물체가 아니라 지형을 바꿨으면 `terrain` |
| 5 | `action` | `add`(놓음) · `remove`(지움) · `paint`(그 밖에 지형 바꿈) |
| 6 | `surface` | 그 칸의 바닥 종류(`plain` 등, 구멍이면 `hole`) |

게임은 여섯 값을 다 보낸다. 실험 페이지(`audio-lab`)는 앞의 세 값만 보낸다.

## whistle-event (이벤트음)

`frequency`(20~20000 Hz), `gain`(0~0.12), `pan`(−1 왼쪽 ~ 1 오른쪽). 시뮬레이션 규칙이 소리를 낼 때 온다.

## whistle-board-height (UWB 테스트)

`height`: 현실 바닥에서 보드까지의 높이(0~10m). UWB 테스트 페이지에서만 오고, 게임에서는 오지 않는다.

## 참고

- 범위를 벗어난 값은 브라우저가 범위 안으로 잘라서 보낸다(보드 높이만 범위 밖이면 보내지 않는다).
- 받는 객체가 없어도 문제없다(Pd가 버린다).
- 보내는 쪽 코드: `lib/audio/pd-session.ts`(상호작용 버스), `lib/audio/game-soundscape.ts`(`whistle-region`).
  값의 출처: `components/whistle/Scene.tsx`(플레이어 상태).
