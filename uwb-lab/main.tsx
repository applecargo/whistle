import { createRoot } from "react-dom/client";
import Lab from "./Lab";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
const tag = new URLSearchParams(location.search).get("tag");
const exhibitionTag = tag !== null && /^[0-3]$/.test(tag) ? tag : undefined;
if (exhibitionTag) document.title = `Whistle · T${exhibitionTag} 전시장 출력`;
root.render(<Lab exhibitionTag={exhibitionTag} />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
