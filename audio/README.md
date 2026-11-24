# pd4web 오디오

`audio/engine/`의 pd4web 엔진 하나에서 Pd 패치를 실행한다. 편집·플레이·배치한 녹음 소리가 AudioContext를 공유한다.

- 상호작용: `edit.pd`, `player.pd`, `event.pd`
- 지형·환경: `lib/audio/terrain-sources.ts`에서 플레이어 근처 영역을 선택한다. 동시에 최대 6개 영역을 재생한다.
- 연결: `lib/audio/pd-runtime.ts`, `lib/audio/pd-session.ts`, `components/whistle/useGameAudio.ts`
- 편집 메시지: `whistle-edit x z overlap asset action surface`
- 플레이 메시지: `whistle-player position x y z`, `yaw angle`, `stat crouch run grounded falling`, `footed grass water`
- UWB 보드 높이: `whistle-board-height metres` (0–10m)
- 규칙 이벤트: `whistle-event frequency gain pan`

X/Z는 세계 크기로 정규화한다. 음소거는 WebAudio 게인으로 처리하며, 게임이 숨겨지면 AudioContext를 일시정지한다. 소리는 사용자 조작 후 시작한다.

`npm run dev`에서 패치 수정이 반영되며, `npm run build`는 패치 폴더를 묶어 배포물에 포함한다. 엔진 자체를 다시 만들 때만 pd4web 환경에서 `npm run audio:engine`을 실행한다.

개발·미리보기·테스트 서버는 COOP/COEP 헤더를 제공한다. 헤더를 설정할 수 없는 정적 호스팅은 `coi-serviceworker.js`가 교차 출처 격리를 설정한다.

`npm run test:audio`로 실제 브라우저의 엔진 재사용, 메시지 전달, 출력 파형, 공간 음향과 게임 연결을 확인한다. 수동 테스트는 `audio-lab/index.html`, `audio-lab/soundscape.html`에서 할 수 있다. 실물 휴대폰의 성능과 스피커 청감은 별도 확인이 필요하다.
