# USB 없는 앵커 배치 측정

- 대상: Makerfabs ESP32-S3 + STM32 AT UWB, A0~A3. 확인한 UWB 펌웨어 v1.1.6
- 네 보드에 `firmware/uwb-anchor/uwb-anchor.ino`를 처음 한 번 USB로 설치
- 기존 UWB ID를 자동으로 읽음. 네 보드 모두 같은 바이너리 사용
- A0~A3: 기존 공유기의 2.4GHz Wi-Fi에 각각 접속. A0도 일반 클라이언트
- Mac: 같은 공유기 네트워크에서 인터넷 연결을 유지하며 네 보드에 측정 명령 전송·결과 수신
- IP는 공유기 DHCP에서 할당. 주소는 `http://whistle-a0.local` ~ `http://whistle-a3.local`
- Mac IP를 보드에 고정 입력하거나 전용 Wi-Fi로 전환할 필요 없음
- 측정 시에는 전원만 공급. 모든 앵커의 위치·방향·높이를 고정하고 관객 태그 T0 전원은 끔
- 전원을 켤 때 무조건 역할을 바꾸지는 않음. PC 명령 한 번으로 네 앵커를 차례로 측정

## 설치

1. `config/uwb-router.local.json`에 공유기 정보 입력:

```json
{"ssid":"공유기 Wi-Fi 이름","password":"공유기 Wi-Fi 비밀번호"}
```

비밀번호가 없는 공개 Wi-Fi는 `"password":""`로 설정합니다. 앵커와 태그에 같은 공유기 설정을 사용합니다.

2. 설정 생성:

```sh
npm run uwb:setup-network
# 기존 A0 전용망 설정에서 전환할 때
npm run uwb:setup-network -- --replace
```

- 기존 제어 키를 유지하고, 이전 설정은 `output/uwb/network-backup-*`에 백업
- PC 설정: `config/uwb-survey.local.json`. 펌웨어 설정: `firmware/uwb-anchor/network.local.h`
- 접속 정보·생성 설정은 Git 제외, 파일 권한 600. 네 보드에 같은 펌웨어를 재설치해야 전환 완료
- Arduino ESP32 core와 Adafruit SSD1306 라이브러리 필요. ESP32 core 3.3.13에서 빌드 확인
- 보드: ESP32S3 Dev Module, USB CDC On Boot 비활성화, UART USB로 업로드
- 업로드 전 기존 ESP32 플래시를 백업. 최소한 업로드로 바뀌는 모든 섹터를 포함하며, 부분 백업이면 나머지 영역을 지우거나 merged 전체 이미지를 쓰지 않음. STM32의 앵커 ID·PAN·안테나 보정값은 초기화하지 않음
- 백업 도구가 보드를 재시작하면 기존 제조사 스케치가 UWB 초기화를 실행할 수 있음. 마지막 백업 후 기존 스케치의 부팅 완료를 기다리고, 최초 기록한 UWB 설정과 비교·복구·저장한 다음 업로드. 설치 후에도 PAN을 포함한 모든 설정을 다시 비교
- 최초 설치는 현재 보드가 앵커 A0~A3 중 하나여야 함. 설정이 잘못되면 측정을 시작하지 않음
- OLED에는 ID·UWB 상태·Wi-Fi 연결 여부·IP 표시. USB 진단 속도 250000bps

3. 네 보드 재설치 후 연결만 확인:

```sh
npm run uwb:survey -- --check
```

- 역할을 바꾸지 않고 네 보드의 ID·설정을 확인
- `.local` 주소가 검색되지 않으면 OLED에 표시된 IP로 PC 설정의 해당 `url`을 교체
- 공유기에서 단말 간 통신이 차단된 게스트망은 사용하지 않음

## 측정

1. 보드 네 개를 같은 높이에 설치하고 전원 공급. 보드를 Mac 쪽으로 옮기지 않음
2. T0 전원 끄기. Mac과 네 보드를 같은 공유기에 연결한 상태 유지
3. 실행:

```sh
npm run uwb:survey -- --fixed-layout
```

- A0 → A1 → A2 → A3 순서로 각 10초 측정
- 임시 태그 ID는 0. 기존 역할·ID를 기록하고 측정 후 저장·재시작·복구 확인
- UWB 재시작은 제조사 예제의 GPIO16 리셋선을 3.2초 낮추는 방식. ESP32·Wi-Fi는 재시작하지 않음
- 네 보드에서 총 12방향 측정, 여섯 앵커 쌍을 양방향으로 검증
- 표본 부족, 거리 변동 30cm 초과, 양방향 차이 25cm 초과, 평면 적합 오차가 크면 좌표 계산 거부
- 결과·중간 측정·실패 원인: `output/uwb/survey-*.json`. 실패해도 기존 결과를 덮어쓰지 않음
- 보드는 PC 연결과 관계없이 측정 종료 후 복구. 전원 중단 시에도 다음 부팅에서 저장된 원래 역할을 먼저 복구
- PC가 복구를 확인하지 못하면 다음 보드로 진행하지 않음. 동일 네트워크에서는 측정 프로그램 하나만 실행
- 상태·결과 조회의 연결이 끊기면 같은 요청을 최대 두 번 재시도. 측정 시작 명령은 자동 재전송하지 않음

좌표는 **A0=(0,0), A0→A1=+X, A2가 +Z 쪽**인 상대 평면 좌표입니다. 거리만으로 절대 방향·높이는 결정할 수 없습니다. 직사각형을 강제하지 않습니다. 같은 높이 가정은 소프트웨어로 확인할 수 없으며, 거리 적합도가 좋아도 공통 거리 편향은 남을 수 있습니다.

현재는 배치 측정과 JSON 출력까지 제공합니다. 게임·Pd·UWB 페이지 배치를 자동으로 덮어쓰지 않습니다. 실제 높이와 가상공간 방향을 정한 뒤 기존 PC 수신기의 앵커 설정으로 연결할 수 있습니다.

## 장비 없는 테스트

```sh
npm run uwb:survey:demo
npm run test:survey
```

가상 네 보드의 측정·복구·배치 계산을 실행합니다. 테스트는 실제 로컬 HTTP 통신, 연결 실패, 잘못된 ID, 오래된 결과, 복구 실패, 이동·불안정 거리 거부도 포함합니다.

## 보드 한 개 진단

USB 시리얼에서 `STATUS`를 보내면 역할과 상태를 확인합니다. `MEASURE ` 뒤에 36자 세션 UUID를 보내면 해당 보드가 10초 측정 후 스스로 복구하고 JSON 결과를 출력합니다. `RESULT`로 마지막 결과를 다시 읽습니다. 이 진단도 다른 보드 세 개는 앵커로 켜져 있고 T0는 꺼진 상태에서만 실행합니다.

`NETWORK`는 Wi-Fi 연결 여부·IP·mDNS 상태를 출력합니다. 연결 실패 시 시리얼에 `WiFi disconnected reason=...`도 기록합니다. 비밀번호는 출력하지 않습니다. `STATUS`·`NETWORK`·`RESULT` 조회만 할 때는 다른 보드나 T0의 전원을 바꿀 필요가 없습니다.

하드웨어 핀·AT 설정은 [Makerfabs 예제](https://github.com/Makerfabs/MaUWB_ESP32S3-with-STM32-AT-Command/tree/main/example/Firmware%20V1.1.6%20Manual%26%20Demo), Wi-Fi 구성은 [ESP32 Arduino Wi-Fi API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html)를 기준으로 합니다.
