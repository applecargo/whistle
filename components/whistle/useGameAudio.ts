"use client";
import { useEffect, useMemo, useRef } from "react";
import { createInteractionSession, type EditSound } from "@/lib/audio/webpd-session";
import { createGameAudio } from "@/lib/audio/game-audio";
import { playerSound, type PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { createPlacedSounds } from "@/lib/audio/placed-sounds";
import { startPatch } from "@/lib/audio/webpd-runtime";
import { createSoundscape } from "@/lib/audio/soundscape";
import { createGameSoundscape, type GameSoundscape } from "@/lib/audio/game-soundscape";
import { flatTerrain } from "@/lib/terrain";
import type { Actor, World, Event, Player } from "@/lib/world";
import type { WorldDerivation } from "@/lib/world-derivation";

const BASE = `${import.meta.env.BASE_URL}audio-test/`;
const log = (message: string) => console.log(`[Whistle:Audio] ${message}`);
/** 전체 음소거 fade(초) */
const MASTER_FADE = 0.05;
/** 사운드스케이프 가운데 경로의 비상관 필터. 기본 끔, 주소에 `?diffuse`를 붙이면 켠 채로 시작한다.
 *  실행 중에는 F 키로 켜고 끈다(비교 청취). 키는 자판 위치(code)로 본다. */
const DIFFUSE_TOGGLE_CODE = "KeyF";
const diffuseEnabled = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("diffuse");
/** 지형이 없는 맵의 평지 타일. 프레임마다 새 배열이면 영역을 매번 다시 나누므로 크기별로 하나만 만든다. */
const flatTiles = new Map<number, ReturnType<typeof flatTerrain>["tiles"]>();
const tilesOf = (world: World) => world.terrain?.tiles ?? flatTiles.get(world.size) ??
  flatTiles.set(world.size, flatTerrain(world.size).tiles).get(world.size)!;

/**
 * AudioContext 1개:
 *   상호작용 패치(edit·player·event) ─┐
 *   사운드스케이프(층별 영역 패치들) ──┼─→ 마스터 게인(음소거 fade) → 리미터 → 출력
 *   배치한 녹음 사운드 ───────────────┘
 */
async function createGameMix() {
  const started = performance.now();
  const context = new AudioContext();
  try {
    await context.resume();
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(context.destination);
    const session = await createInteractionSession(BASE, () => {}, { context, output: master });
    const diffuse = diffuseEnabled();
    const scape = createSoundscape({
      context,
      destination: master,
      diffuse,
      // 거리에 따른 음량은 game-soundscape가 영역 외곽까지 거리로 정한다(패너 감쇠는 쓰지 않음).
      rolloff: 0,
      start: (c, name) => startPatch(c as AudioContext, BASE, name),
      onEvent: (event) => {
        if (event.type === "error") console.warn(`[Whistle:Audio] ${event.id} ${event.patch} 로드 실패`, event.error);
        else if (event.type === "active" || event.type === "released") log(`${event.id} ${event.patch} ${event.type === "active" ? "켜짐" : "꺼짐"}`);
      },
    });
    log(`오디오 시작: ${context.sampleRate}Hz, 상호작용 패치 edit·player·event 준비됨 (${Math.round(performance.now() - started)}ms), 비상관 필터 ${diffuse ? "켬" : "끔"}`);
    return {
      context, master, scape, diffuse, game: createGameSoundscape(scape, log),
      session: {
        ...session,
        // whistle-gate 대신 전체 마스터 게인으로 음소거한다(상호작용·사운드스케이프·녹음 사운드 모두).
        mute(muted: boolean) {
          const now = context.currentTime, gain = master.gain, current = gain.value;
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(current, now);
          gain.linearRampToValueAtTime(muted ? 0 : 1, now + MASTER_FADE);
        },
        async close() {
          scape.dispose();
          await session.close();
          await context.close();
        },
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const INTERACTION_PATCH_NAMES = ["edit", "player", "event"];

export type GameAudioDebug = {
  context: { state: AudioContextState; sampleRate: number; baseLatency: number; outputLatency?: number } | null;
  /** 시작된 상호작용 패치(오디오가 시작되면 3개가 계속 돈다) */
  interaction: string[];
  /** 사운드스케이프 패치 인스턴스(loading·active·releasing 모두 wasm 하나씩) */
  voices: { id: string; patch: string; state: string }[];
  soundscape: ReturnType<GameSoundscape["debug"]> | null;
  diffuse: boolean;
  enabled: boolean;
  paused: boolean;
  frame: PlayerAudioFrame | null;
};

export function useGameAudio() {
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const recordings = useRef<ReturnType<typeof createPlacedSounds> | null>(null);
  const soundscape = useRef<GameSoundscape | null>(null);
  const mixRef = useRef<Awaited<ReturnType<typeof createGameMix>> | null>(null);
  const lastFrame = useRef<PlayerAudioFrame | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const api = useMemo(() => {
    const get = () => controller.current ??= createGameAudio(
      async () => {
        const mix = await createGameMix();
        mixRef.current = mix;
        recordings.current = createPlacedSounds(mix.context, () => {}, mix.master);
        soundscape.current = mix.game;
        return mix.session;
      },
      (error) => console.warn("[Whistle:Audio] 오류", error),
    );
    const quiet = () => soundscape.current?.stop();
    return {
      edit: (sound: EditSound) => { enabled.current = false; quiet(); recordings.current?.stop(); get().edit(sound); },
      play: () => { enabled.current = true; paused.current = false; recordings.current?.stop(); get().play(); },
      stop: () => { enabled.current = false; quiet(); recordings.current?.stop(); controller.current?.stop(); },
      reset: () => { quiet(); recordings.current?.stop(); controller.current?.reset(); },
      movement: (frame: PlayerAudioFrame, world?: World, actors?: Actor[], derivation?: WorldDerivation) => {
        lastFrame.current = frame;
        controller.current?.movement(playerSound(frame));
        if (!enabled.current || paused.current || !world) return;
        soundscape.current?.frame(frame, {
          size: world.size,
          tiles: tilesOf(world),
          environment: derivation?.environment,
          structures: derivation?.structures,
        });
        if (actors) recordings.current?.update(world, actors, frame, derivation?.environment);
      },
      /** 디버그 오버레이용 현재 상태(읽기 전용 사본) */
      debug: (): GameAudioDebug => {
        const mix = mixRef.current;
        return {
          context: mix ? { state: mix.context.state, sampleRate: mix.context.sampleRate,
            baseLatency: mix.context.baseLatency, outputLatency: mix.context.outputLatency } : null,
          interaction: mix ? INTERACTION_PATCH_NAMES : [],
          voices: mix?.scape.snapshot().voices ?? [],
          soundscape: soundscape.current?.debug() ?? null,
          diffuse: mix?.scape.diffuse() ?? false,
          enabled: enabled.current,
          paused: paused.current,
          frame: lastFrame.current,
        };
      },
      event: (event: Event, player: Player) => {
        const distance = Math.hypot(event.x - player.x, event.z - player.z);
        const angle = Math.atan2(event.x - player.x, -(event.z - player.z)) - player.yaw;
        controller.current?.event(
          [261.63, 329.63, 392, 523.25, 659.25][Math.abs(Math.round(event.x + event.z)) % 5],
          0.12 / (1 + distance * 0.3), Math.sin(angle),
        );
      },
    };
  }, []);
  useEffect(() => {
    const pause = () => {
      paused.current = true;
      soundscape.current?.stop();
      recordings.current?.stop(false);
      controller.current?.pause();
    };
    const visibility = () => { if (document.hidden) pause(); };
    const resume = () => { if (!document.hidden) { paused.current = false; controller.current?.resume(); } };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    const toggleDiffuse = (event: KeyboardEvent) => {
      if (event.code !== DIFFUSE_TOGGLE_CODE || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
      const scape = mixRef.current?.scape;
      if (!scape) return;
      scape.setDiffuse(!scape.diffuse());
      log(`비상관 필터 ${scape.diffuse() ? "켬" : "끔"}`);
    };
    window.addEventListener("keydown", toggleDiffuse);
    return () => {
      window.removeEventListener("keydown", toggleDiffuse);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      recordings.current?.stop();
      recordings.current = null;
      soundscape.current = null;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return api;
}
