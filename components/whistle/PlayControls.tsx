"use client";
import { useRef, type MutableRefObject } from "react";
import type { Player } from "@/lib/world";
import { useLanguage } from "./Language";

/** 조이스틱 손잡이가 움직이는 반지름(px). 이만큼 끌면 최대 */
const STICK_RADIUS = 40;
/** 이보다 조금 끈 것(0~1)은 0으로 본다(손가락 떨림) */
const DEAD_ZONE = 0.15;

type Props = {
  controls: MutableRefObject<Set<string>>;
  stick: MutableRefObject<{ x: number; y: number }>;
  player: MutableRefObject<Player>;
  movementMode: "walk" | "crouch";
  onMovementModeChange: (mode: "walk" | "crouch") => void;
};

/** 아날로그 조이스틱: 위아래로 끈 만큼 앞뒤로 걷고, 좌우로 끈 만큼 돈다. 손을 떼면 멈춘다. */
function Stick({ stick, label }: { stick: Props["stick"]; label: string }) {
  const knob = useRef<HTMLSpanElement>(null);
  const set = (x: number, y: number) => {
    stick.current = { x, y };
    if (knob.current) knob.current.style.transform = `translate(${x * STICK_RADIUS}px, ${-y * STICK_RADIUS}px)`;
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - (box.left + box.width / 2)) / STICK_RADIUS;
    let y = -(e.clientY - (box.top + box.height / 2)) / STICK_RADIUS;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    set(Math.abs(x) < DEAD_ZONE ? 0 : x, Math.abs(y) < DEAD_ZONE ? 0 : y);
  };
  const release = () => set(0, 0);
  return (
    <div className="stick" role="application" aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}>
      <span ref={knob} className="stick-knob" aria-hidden="true" />
    </div>
  );
}

export function PlayControls({
  controls, stick, player, movementMode, onMovementModeChange,
}: Props) {
  const { t } = useLanguage();
  return (
    <div className="touch-controls" aria-label={t("이동 터치패드")}>
      <Stick stick={stick} label={t("이동 조이스틱")} />
      <div className="movement-modes">
        <button aria-label={t("점프")}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            if (!player.current.falling) { controls.current.add("jump"); controls.current.add("jump-held"); }
          }}
          onPointerUp={() => controls.current.delete("jump-held")}
          onPointerCancel={() => controls.current.delete("jump-held")}
          onLostPointerCapture={() => controls.current.delete("jump-held")}
          onClick={(e) => {
            if (e.detail === 0 && !player.current.falling) controls.current.add("jump");
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path className="control-outline" d="M8 14l4-4 4 4" /><path d="M8 14l4-4 4 4" /></svg>
        </button>
        <button aria-label={t("기어가기")}
          aria-pressed={movementMode === "crouch"}
          onClick={() => {
            if (player.current.falling) return;
            const next = movementMode === "crouch" ? "walk" : "crouch";
            controls.current.delete("run");
            controls.current.delete("crouch");
            if (next === "crouch") controls.current.add("crouch");
            onMovementModeChange(next);
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path className="control-outline" d="M8 10l4 4 4-4" /><path d="M8 10l4 4 4-4" /></svg>
        </button>
      </div>
    </div>
  );
}
