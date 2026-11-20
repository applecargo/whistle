import type { World } from "./world";

export async function encodeWorld(w: World): Promise<string> {
  return btoa(encodeURIComponent(JSON.stringify(w)));
}

export function downloadWorld(w: World) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(w, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${w.title || "Whistle"}.whistle.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
