"use client";
// 3D 플레이 화면 위에 디버그 정보를 글자로 겹쳐 보인다.
// 3D 플레이 중 ` (백틱, 숫자 1 왼쪽) 키로 켜고 끈다(기본은 꺼짐). 켜면 오른쪽 위에 보인다.
// 키는 자판 위치(code)로 본다: 한/영 입력 상태와 상관없이 같은 키.
// 0.25초마다 읽기만 한다(게임·오디오 상태를 바꾸지 않음).
import { useEffect, useRef, useState } from "react";
import type { GameAudioDebug } from "@/components/whistle/useGameAudio";
import type { World } from "@/lib/world";
import type { WorldDerivation } from "@/lib/world-derivation";
import { isHole } from "@/lib/tile";

const TOGGLE_CODE = "Backquote";
const REFRESH_MS = 250;
/** 오버레이 폭(글자 수 기준). 가장 긴 줄보다 넉넉하게 */
const BOX_WIDTH_CH = 88;

const f = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(digits));
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Props = {
  audio: { debug(): GameAudioDebug };
  getWorld: () => World;
  derivation: WorldDerivation;
};

/** 렌더 루프 부하: 1초 동안의 프레임 수와 가장 긴 프레임 간격 */
function useFrameStats() {
  const stats = useRef({ fps: 0, worst: 0 });
  useEffect(() => {
    let frame = 0, count = 0, worst = 0, last = performance.now(), windowStart = last;
    const tick = (now: number) => {
      count++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart >= 1000) {
        stats.current = { fps: (count * 1000) / (now - windowStart), worst };
        count = 0; worst = 0; windowStart = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return stats;
}

function describe(info: GameAudioDebug, world: World, derivation: WorldDerivation, frame: { fps: number; worst: number }) {
  const lines: string[] = [];
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  lines.push(`렌더  ${f(frame.fps, 0)} fps · 최장 프레임 ${f(frame.worst, 0)} ms${memory ? ` · JS 힙 ${f(memory.usedJSHeapSize / 2 ** 20, 0)} MB` : ""}`);

  // 오디오
  const c = info.context;
  const byState = info.voices.reduce<Record<string, number>>((n, v) => ((n[v.state] = (n[v.state] ?? 0) + 1), n), {});
  const wasm = info.interaction.length + info.voices.length;
  lines.push(c
    ? `오디오 ${c.state} · ${c.sampleRate} Hz · 지연 ${f(c.baseLatency * 1000, 1)}+${f((c.outputLatency ?? NaN) * 1000, 1)} ms · 비상관 ${info.diffuse ? "켬" : "끔"}`
    : "오디오 시작 전");
  // 상호작용 패치는 항상 edit·player·event 세 개라 이름은 생략(줄이 길어지면 폭을 넘는다)
  lines.push(`wasm ${wasm}개 = 상호작용 ${info.interaction.length} + 사운드스케이프 ${info.voices.length}` +
    (info.voices.length ? ` (${Object.entries(byState).map(([s, n]) => `${s} ${n}`).join(", ")})` : ""));
  lines.push(`사운드스케이프 ${info.enabled ? (info.paused ? "일시정지" : "켜짐") : "꺼짐"}` +
    (info.soundscape ? ` · 등록 영역 ${info.soundscape.registered}개 · 반경 ${info.soundscape.options.radius} · 패닝 전환 ${info.soundscape.options.blend} · 최대 ${info.soundscape.options.max}` : ""));

  // 플레이어와 발밑 칸
  const p = info.frame;
  if (p) {
    const size = world.size, tx = Math.round(p.x), tz = Math.round(p.z);
    const inside = tx >= 0 && tz >= 0 && tx < size && tz < size;
    const index = tz * size + tx;
    const tile = inside ? world.terrain?.tiles[index] : undefined;
    const cell = inside ? derivation.environment.cells[index] : undefined;
    lines.push("");
    lines.push(`플레이어 격자 (${f(p.x)}, ${f(p.z)}) · 발 높이 ${f(p.y)} · yaw ${f((p.yaw * 180) / Math.PI, 0)}° · ${p.grounded ? "땅" : "공중"}${p.falling ? " · 낙하" : ""}`);
    lines.push(`칸 (${tx}, ${tz})${inside ? "" : " 맵 밖"}` + (tile
      ? ` · ${isHole(tile) ? "구멍" : tile.surface} · 높이 ${tile.height}`
      : ""));
    if (cell) {
      const wind = Math.hypot(cell.windX, cell.windZ);
      lines.push(`환경 물 ${cell.water === null ? "-" : f(cell.water)} · 풀 ${f(cell.grass)} · 안개 ${f(cell.fog)} · 바람 ${f(wind)} · 빛 ${f(cell.light)} · 습기 ${f(cell.moisture)}${cell.tree ? " · 나무" : ""}`);
    }
    const here = derivation.structures.filter((s) => Math.round(s.x) === tx && Math.round(s.z) === tz);
    if (here.length) lines.push(`구조물 ${here.map((s) => s.kind).join(", ")}`);
    lines.push(`whistle-player  grass ${f(p.grass)} · rough ${f(p.rough)} · water ${f(p.water)}`);
  }

  // 켜진 영역
  const near = info.soundscape?.near ?? [];
  if (near.length) {
    lines.push("");
    // 한글은 폭이 두 칸이라 열이 어긋나므로 머리글은 영문(거리 d, 음량 gain, 폭 width, 농도 amount)
    lines.push(`${pad("region", 14)}${pad("kind", 8)}${pad("patch", 20)}${pad("d", 6)}${pad("gain", 6)}${pad("width", 6)}${pad("amount", 7)}state`);
    for (const n of near) {
      const voice = info.voices.find((v) => v.id === n.id);
      lines.push(`${pad(n.id, 14)}${pad(n.kind, 8)}${pad(n.patch, 20)}${pad(f(n.distance), 6)}${pad(f(n.gain), 6)}${pad(f(n.width), 6)}${pad(f(n.amount), 7)}${voice?.state ?? "-"}`);
    }
  }
  return lines.join("\n");
}

export function DebugOverlay({ audio, getWorld, derivation }: Props) {
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState("");
  const frame = useFrameStats();
  const latest = useRef({ audio, getWorld, derivation });
  latest.current = { audio, getWorld, derivation };

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.code === TOGGLE_CODE && !event.repeat) setVisible((v) => !v);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const update = () => {
      const { audio, getWorld, derivation } = latest.current;
      setText(describe(audio.debug(), getWorld(), derivation, frame.current));
    };
    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, frame]);

  if (!visible) return null;
  return (
    <pre
      aria-hidden="true"
      style={{
        position: "absolute", top: "max(12px, env(safe-area-inset-top))", right: "max(12px, env(safe-area-inset-right))", zIndex: 50, margin: 0, padding: "8px 10px",
        // 폭 고정: 내용 길이(releasing 표시, 영역 수)에 따라 박스가 늘고 줄면 오른쪽 기준이라 글자 시작이 흔들린다.
        // 가장 긴 줄(wasm 6개 모두 다른 상태 + 영역 표 한 줄)이 들어가는 폭. 화면이 좁으면 화면에 맞춘다.
        boxSizing: "border-box", width: `min(${BOX_WIDTH_CH}ch, calc(100% - 80px))`, overflow: "hidden", pointerEvents: "none",
        font: "14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre",
        color: "#e8f5e9", background: "rgba(0, 0, 0, 0.62)", borderRadius: 6,
      }}
    >
      {text}
    </pre>
  );
}
