#!/bin/sh
# 플레이어 PC에서 Whistle 플레이어 페이지를 Chrome으로 띄운다(클릭 없이 소리, docs/uwb-multiplayer.md).
#   sh scripts/open-player.sh <키오스크 IP> <태그 0~3> [페이지 포트, 기본 5173]
# 이 PC에 저장소가 없어도 된다: 아래 chrome 줄만 그대로 실행해도 같다.
set -e
[ -n "$1" ] && [ -n "$2" ] || { echo "사용법: sh scripts/open-player.sh <키오스크 IP> <태그 0~3> [포트]"; exit 1; }
KIOSK="$1"; TAG="$2"; PORT="${3:-5173}"
ORIGIN="http://$KIOSK:$PORT"
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done
[ -n "$CHROME" ] || { echo "Chrome을 찾지 못했습니다."; exit 1; }
# --autoplay-policy: 클릭 없이 소리를 낸다
# --unsafely-treat-insecure-origin-as-secure: 공유기 주소(http)에서도 Pd 엔진(AudioWorklet·SharedArrayBuffer)이 돈다
# --user-data-dir: 따로 띄운 Chrome이어야 위 옵션이 먹는다(평소 Chrome이 켜져 있어도)
exec "$CHROME" --autoplay-policy=no-user-gesture-required \
  --unsafely-treat-insecure-origin-as-secure="$ORIGIN" \
  --user-data-dir="${TMPDIR:-/tmp}/whistle-player-$TAG" --no-first-run \
  --app="$ORIGIN/whistle/player/?tag=$TAG"
