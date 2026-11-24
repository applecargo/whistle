"use client";
import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent } from "react";
import type { Player } from "@/lib/world";
import { useLanguage } from "./Language";

type Props = {
  controls: MutableRefObject<Set<string>>;
  stick: MutableRefObject<{ x: number; y: number }>;
  player: MutableRefObject<Player>;
  movementMode: "walk" | "crouch";
  onMovementModeChange: (mode: "walk" | "crouch") => void;
};

const STICK_RADIUS = 40;
const DEAD_ZONE = 0.15;

function Stick({ stick, label }: { stick: Props["stick"]; label: string }) {
  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null);
  const set = useCallback((x: number, y: number) => {
    stick.current = { x, y };
    if (knob.current) knob.current.style.transform = `translate(${x * STICK_RADIUS}px, ${-y * STICK_RADIUS}px)`;
  }, [stick]);
  const release = useCallback(() => {
    const id = pointer.current;
    pointer.current = null;
    set(0, 0);
    if (id !== null && pad.current?.hasPointerCapture(id)) pad.current.releasePointerCapture(id);
  }, [set]);
  useEffect(() => {
    const hide = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hide);
      release();
    };
  }, [release]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    let x = (event.clientX - box.left - box.width / 2) / STICK_RADIUS;
    let y = -(event.clientY - box.top - box.height / 2) / STICK_RADIUS;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    set(Math.abs(x) < DEAD_ZONE ? 0 : x, Math.abs(y) < DEAD_ZONE ? 0 : y);
  };
  return <div ref={pad} className="stick" role="group" tabIndex={0} aria-label={label}
    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (pointer.current !== null || event.button !== 0) return;
      event.preventDefault();
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      move(event);
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) move(event); }}
    onPointerUp={event => { if (pointer.current === event.pointerId) release(); }}
    onPointerCancel={event => { if (pointer.current === event.pointerId) release(); }}
    onLostPointerCapture={event => { if (pointer.current === event.pointerId) release(); }}>
    <span ref={knob} className="stick-knob" aria-hidden="true" />
  </div>;
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
