// 플레이어 PC: 키오스크의 맵 + 태그 하나의 위치로 소리만 낸다(uwb-lab/Lab.tsx의 player 모드, docs/uwb-multiplayer.md).
//   ?tag=0~3  ?bridge=ws://키오스크IP:5194 (없으면 이 페이지를 연 호스트의 5194)
import { createRoot } from "react-dom/client";
import Lab from "../uwb-lab/Lab";
import "../uwb-lab/style.css";

const params = new URLSearchParams(location.search);
const tag = /^[0-3]$/.test(params.get("tag") ?? "") ? params.get("tag")! : "0";
const host = ["localhost", "[::1]", ""].includes(location.hostname) ? "127.0.0.1" : location.hostname;
const bridge = params.get("bridge") || `ws://${host}:5194`;
document.title = `Whistle · 플레이어 T${tag}`;
const root = createRoot(document.getElementById("root")!);
root.render(<Lab player={{ tag, bridge }} />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
