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
import type { Environment } from "@/lib/environment";

const BASE = `${import.meta.env.BASE_URL}audio-test/`;
const log = (message: string) => console.log(`[Whistle:Audio] ${message}`);
/** 전체 음소거 fade(초) */
const MASTER_FADE = 0.05;

/**
 * AudioContext 1개:
 *   상호작용 패치(edit·player·event) ─┐
 *   지형 사운드스케이프(타일 패치들) ──┼─→ 마스터 게인(음소거 fade) → 리미터 → 출력
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
    const scape = createSoundscape({
      context,
      destination: master,
      start: (c, name) => startPatch(c as AudioContext, BASE, name),
      onEvent: (event) => {
        if (event.type === "error") console.warn(`[Whistle:Audio] ${event.id} ${event.patch} 로드 실패`, event.error);
        else if (event.type === "active" || event.type === "released") log(`${event.id} ${event.patch} ${event.type === "active" ? "켜짐" : "꺼짐"}`);
      },
    });
    log(`오디오 시작: ${context.sampleRate}Hz, 상호작용 패치 edit·player·event 준비됨 (${Math.round(performance.now() - started)}ms)`);
    return {
      context, master, scape, game: createGameSoundscape(scape, log),
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

export function useGameAudio() {
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const recordings = useRef<ReturnType<typeof createPlacedSounds> | null>(null);
  const soundscape = useRef<GameSoundscape | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const api = useMemo(() => {
    const get = () => controller.current ??= createGameAudio(
      async () => {
        const mix = await createGameMix();
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
      movement: (frame: PlayerAudioFrame, world?: World, actors?: Actor[], environment?: Environment) => {
        controller.current?.movement(playerSound(frame));
        if (!enabled.current || paused.current || !world) return;
        soundscape.current?.frame(frame, (world.terrain ?? flatTerrain(world.size)).tiles);
        if (actors) recordings.current?.update(world, actors, frame, environment);
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
    return () => {
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
