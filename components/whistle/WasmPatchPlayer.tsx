"use client";
import React, { useState, useEffect, useRef } from "react";
import { SoundscapeManager } from "@/lib/audio/soundscape-manager";
import type { WasmPatchInstance } from "@/lib/audio/wasm-patch-instance";

const AVAILABLE_PATCHES = [
  "bell01",
  "bell01_random",
  "bouncing_rhythm",
  "dama_object_bluenote",
  "player3",
  "simplesine",
  "stone_knock",
  "uwb-player",
];

export function WasmPatchPlayer() {
  const [audioRunning, setAudioRunning] = useState(false);
  const [playerDistance, setPlayerDistance] = useState(5); // 플레이어와의 거리 (m)
  const [tilePatch, setTilePatch] = useState("bell01");
  const [ambientPatch, setAmbientPatch] = useState("simplesine");
  const [tileState, setTileState] = useState<"on" | "off">("off");
  const [ambientState, setAmbientState] = useState<"on" | "off">("off");
  const [cullingRadius, setCullingRadius] = useState(15);

  const contextRef = useRef<AudioContext | null>(null);
  const soundscapeRef = useRef<SoundscapeManager | null>(null);
  const tileInstanceRef = useRef<WasmPatchInstance | null>(null);
  const ambientInstanceRef = useRef<WasmPatchInstance | null>(null);

  const initSoundscape = async () => {
    if (!contextRef.current) {
      const ctx = new AudioContext();
      await ctx.resume();
      const masterLimiter = ctx.createDynamicsCompressor();
      masterLimiter.threshold.setValueAtTime(-1.0, ctx.currentTime);
      masterLimiter.ratio.setValueAtTime(20.0, ctx.currentTime);
      masterLimiter.connect(ctx.destination);

      const manager = new SoundscapeManager(
        ctx,
        masterLimiter,
        `${import.meta.env.BASE_URL}audio-test/`,
        cullingRadius
      );

      contextRef.current = ctx;
      soundscapeRef.current = manager;
    }

    const manager = soundscapeRef.current!;
    // 1. 타일 WASM 패치 등록 (거리 컬링 조건)
    const tile = await manager.registerPatch({
      id: "tile-demo-1",
      patchName: tilePatch,
      position: { x: 0, y: 0, z: -playerDistance },
      policy: { type: "distance", radius: cullingRadius },
      initialGain: 0.8,
    });
    tileInstanceRef.current = tile;

    // 2. 전역 앰비언트 WASM 패치 등록 (상시 On 조건)
    const ambient = await manager.registerPatch({
      id: "ambient-demo-1",
      patchName: ambientPatch,
      policy: { type: "always" },
      initialGain: 0.3,
    });
    ambientInstanceRef.current = ambient;

    setAudioRunning(true);
    updateStates();
  };

  const updateStates = () => {
    if (soundscapeRef.current) {
      soundscapeRef.current.update({ x: 0, y: 0, z: 0 });
      setTileState(tileInstanceRef.current?.isEnabled() ? "on" : "off");
      setAmbientState(ambientInstanceRef.current?.isEnabled() ? "on" : "off");
    }
  };

  // 거리 변경 시 타일 위치 업데이트 및 거리 컬링 평가
  useEffect(() => {
    if (tileInstanceRef.current && soundscapeRef.current) {
      tileInstanceRef.current.setPosition(0, 0, -playerDistance);
      soundscapeRef.current.update({ x: 0, y: 0, z: 0 });
      // 상태 반영을 위해 약간의 딜레이 후 조회
      setTimeout(updateStates, 50);
    }
  }, [playerDistance, cullingRadius]);

  const toggleManualTile = async () => {
    if (!tileInstanceRef.current) return;
    if (tileInstanceRef.current.isEnabled()) {
      tileInstanceRef.current.disable();
    } else {
      await tileInstanceRef.current.enable();
    }
    updateStates();
  };

  const toggleManualAmbient = async () => {
    if (!ambientInstanceRef.current) return;
    if (ambientInstanceRef.current.isEnabled()) {
      ambientInstanceRef.current.disable();
    } else {
      await ambientInstanceRef.current.enable();
    }
    updateStates();
  };

  const stopAll = async () => {
    soundscapeRef.current?.destroy();
    if (contextRef.current) {
      await contextRef.current.close();
      contextRef.current = null;
    }
    soundscapeRef.current = null;
    tileInstanceRef.current = null;
    ambientInstanceRef.current = null;
    setAudioRunning(false);
    setTileState("off");
    setAmbientState("off");
  };

  useEffect(() => {
    return () => {
      soundscapeRef.current?.destroy();
      contextRef.current?.close();
    };
  }, []);

  return (
    <div style={{ padding: 20, background: "#18181b", color: "#f4f4f5", borderRadius: 10, maxWidth: 460, fontFamily: "sans-serif", margin: "20px auto", border: "1px solid #27272a" }}>
      <h3 style={{ margin: "0 0 14px 0", fontSize: 16 }}>단일 AudioContext 멀티 WASM 사운드스케이프</h3>
      <p style={{ fontSize: 12, color: "#a1a1aa", marginTop: 0 }}>
        하나의 AudioContext에서 다수의 WASM 패치를 동시 믹싱하고, 통일된 On/Off 스위치 및 거리 컬링을 적용합니다.
      </p>

      {!audioRunning ? (
        <button onClick={initSoundscape} style={{ width: "100%", padding: "10px 0", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, fontWeight: "bold", cursor: "pointer" }}>
          사운드스케이프 오디오 엔진 시작
        </button>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: "#4ade80", fontWeight: "bold" }}>● 오디오 엔진 실행 중</span>
            <button onClick={stopAll} style={{ padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
              전체 정지 (Close)
            </button>
          </div>

          {/* 1. 타일 WASM 모듈 제어 */}
          <div style={{ background: "#27272a", padding: 12, borderRadius: 6, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: "bold", fontSize: 13 }}>타일 WASM (3D 공간화 & 거리 컬링)</span>
              <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 4, background: tileState === "on" ? "#166534" : "#7f1d1d", color: tileState === "on" ? "#bbf7d0" : "#fecaca" }}>
                상태: {tileState.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 12, marginBottom: 8, color: "#d4d4d8" }}>
              패치: <code>{tilePatch}.wasm</code>
            </div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              플레이어와의 거리: <b>{playerDistance}m</b> (컬링 기준: {cullingRadius}m)
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                value={playerDistance}
                onChange={(e) => setPlayerDistance(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4 }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#71717a" }}>
                <span>1m (가까움: On)</span>
                <span>{cullingRadius}m (경계)</span>
                <span>30m (멀음: Off)</span>
              </div>
            </div>
            <button onClick={toggleManualTile} style={{ marginTop: 6, padding: "4px 10px", background: "#52525b", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
              수동 On/Off 스위치 토글
            </button>
          </div>

          {/* 2. 전역 앰비언트 WASM 모듈 제어 */}
          <div style={{ background: "#27272a", padding: 12, borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: "bold", fontSize: 13 }}>전역 앰비언트 WASM (상시 On)</span>
              <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 4, background: ambientState === "on" ? "#166534" : "#7f1d1d", color: ambientState === "on" ? "#bbf7d0" : "#fecaca" }}>
                상태: {ambientState.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 12, marginBottom: 8, color: "#d4d4d8" }}>
              패치: <code>{ambientPatch}.wasm</code>
            </div>
            <button onClick={toggleManualAmbient} style={{ padding: "4px 10px", background: "#52525b", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
              수동 On/Off 스위치 토글
            </button>
          </div>
        </>
      )}
    </div>
  );
}
