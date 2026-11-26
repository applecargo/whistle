# UWB 다중 플레이어 전시

키오스크 PC 한 대에서 맵을 만들고, 플레이어마다 PC 한 대가 그 플레이어(태그)의 소리만 냅니다. 출력은 플레이어 PC마다 블루투스 하나입니다.

```text
태그 T0~T3 ─UDP─→ [키오스크 PC] UWB 수신기(node) ── 위치 "/" ──────┐
                  [키오스크 PC] 키오스크 페이지 ── 맵 "/world" ─→ 수신기 ─┤ 공유기
                                                                    ├→ [플레이어 PC 1] Chrome: 플레이어 페이지 ?tag=0 → 블루투스
                                                                    └→ [플레이어 PC 2] Chrome: 플레이어 페이지 ?tag=1 → …
```

- **키오스크 페이지** (`/whistle/kiosk/`): 늘 만들기 상태인 편집기입니다. 플레이 버튼이 없고 소리를 내지 않습니다.
  - 맵이 바뀔 때마다 맵 전체를 수신기로 보냅니다.
  - 태그 0~3의 위치를 편집 격자 위에 `T0`~`T3`으로 표시합니다.
  - 맵 저장은 지금 편집기와 같습니다(브라우저 저장·파일 저장).
  - 수신기 주소와 **전시장 매핑**(현실 m → 격자)은 오른쪽 **전시장** 칸에서 정합니다. 매핑은 맵과 함께 플레이어에게 가므로 플레이어 PC에서는 정하지 않습니다.
- **UWB 수신기**: 태그 위치를 계산하고, 키오스크가 보낸 마지막 맵을 들고 있다가 플레이어에게 돌립니다. 늦게 켠 플레이어도 접속하자마자 맵을 받습니다.
- **플레이어 페이지** (`/whistle/player/?tag=N`): 오디오 재생 엔진입니다. 맵과 자기 태그 위치로 지금 게임과 같은 소리를 냅니다. 바라보는 방향은 0입니다. 위치가 처음 잡히면 오디오를 스스로 켭니다.
- 업로드한 소리는 이 모드에서 쓰지 않습니다.

## 키오스크 PC

같은 공유기에 연결하고, 키오스크 PC의 IP를 확인합니다(예: `192.168.0.10`).

```sh
npx vite --host 0.0.0.0                       # 페이지(5173)를 공유기에 연다
npm run uwb:bridge -- --serial /dev/... --config config/uwb.local.json --ws-host 0.0.0.0 --udp-host 0.0.0.0
```

- 수신기는 앵커 배치(`--config`)로 위치를 계산하는 모드로 띄웁니다. 플레이어 페이지에는 앵커 배치 입력이 없으므로 `--ranges-only`는 쓰지 않습니다.
- `--ws-host 0.0.0.0`: 플레이어 PC도 수신기에 붙을 수 있게 합니다. 페이지 출처는 이 PC 또는 수신기와 같은 주소에서 연 페이지만 받습니다.
- 장비 없이 시험할 때는 `--serial …` 대신 `--simulate`를 씁니다. 가상 태그 네 개가 원을 그리며 돕니다.

키오스크 PC의 Chrome에서 `http://localhost:5173/whistle/kiosk/`를 엽니다. **전시장** 칸에서 다음을 확인합니다.
- 맵 보내기: 연결됨
- 태그 수신: 연결됨
- T0~T3 위치

## 플레이어 PC

Chrome만 있으면 됩니다. 저장소는 필요 없습니다.

```sh
sh scripts/open-player.sh 192.168.0.10 1     # 키오스크 IP, 태그
```

스크립트가 하는 일은 아래 한 줄입니다(macOS 경로 예).

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --autoplay-policy=no-user-gesture-required \
  --unsafely-treat-insecure-origin-as-secure=http://192.168.0.10:5173 \
  --user-data-dir=/tmp/whistle-player-1 --no-first-run \
  --app="http://192.168.0.10:5173/whistle/player/?tag=1"
```

- `--autoplay-policy`: 클릭 없이 소리를 냅니다.
- `--unsafely-treat-insecure-origin-as-secure`: Pd 엔진은 안전한 주소(localhost·https)에서만 돕니다. 공유기 주소(http)도 안전한 주소로 칩니다.
- `--user-data-dir`: 따로 띄운 Chrome이어야 위 옵션이 먹습니다.

블루투스 출력은 그 PC의 기본 출력 장치로 정합니다. 페이지 위쪽에 다음이 표시됩니다.
- 키오스크 맵: 받음
- 태그: 수신 중
- 오디오 실행 중

다른 수신기 주소를 쓰려면 페이지 주소에 `&bridge=ws://IP:5194`를 붙입니다.

## 시험

```sh
npx playwright test tests/browser/uwb-multiplayer.spec.ts
```

가상 태그 수신기를 띄웁니다. 그리고 키오스크가 맵을 보내고 T0~T3을 표시하는지, 플레이어 페이지가 맵을 받아 스스로 오디오를 켜는지 확인합니다.
