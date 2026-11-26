"use client";
import { useEffect, useMemo, useRef } from "react";
import type { EditSound, GameEvent } from "@/lib/audio/pd-session";
import { createGameAudio } from "@/lib/audio/game-audio";
import { playerSound, type PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { createPlacedSounds } from "@/lib/audio/placed-sounds";
import { createGameMix, logAudio as log } from "@/lib/audio/game-mix";
import { unlockAudio } from "@/lib/audio/pd-runtime";
import type { GameSoundscape } from "@/lib/audio/game-soundscape";
import { createEventSources, type Position } from "@/lib/audio/event-sources";
import type { SpatialRule } from "@/lib/audio/spatial-rule";
import { forwardOf } from "@/lib/audio/terrain-sources";
import type { Actor, World } from "@/lib/world";
import type { WorldDerivation } from "@/lib/world-derivation";

/** 사운드스케이프 가운데 경로의 비상관 필터. 기본 끔, 주소에 `?diffuse`를 붙이면 켠 채로 시작한다.
 *  실행 중에는 F 키로 켜고 끈다(비교 청취). 키는 자판 위치(code)로 본다. */
const DIFFUSE_TOGGLE_CODE = "KeyF";
/** 디버그 1 키의 fallingstar: 이름(패치의 $1), 패치, 플레이어 앞 몇 칸·몇 위(장면 단위)에, 공간화 규칙 */
const FALLINGSTAR = { name: "fallingstar", patch: "fallingstar_source", ahead: 4, up: 6,
  rule: { range: 10, width: 0.3, curve: { type: "lin" } } as Partial<SpatialRule> };
/** 플레이어가 보는 쪽으로 tiles칸 앞, up만큼 위. whistle-player position과 같은 좌표(x, z = (격자 + 0.5) / 크기) */
function ahead(frame: PlayerAudioFrame, tiles: number, up: number): Position {
  const f = forwardOf(frame.yaw), size = frame.size;
  return { x: (frame.x + f.x * tiles + 0.5) / size, y: frame.y + up, z: (frame.z + f.z * tiles + 0.5) / size };
}

const INTERACTION_PATCH_NAMES = ["edit", "player", "event"];

export type GameAudioDebug = {
  context: { state: AudioContextState; sampleRate: number; latencyHint: AudioContextLatencyCategory; baseLatency: number; outputLatency?: number } | null;
  /** 시작된 상호작용 패치(오디오가 시작되면 3개가 계속 돈다) */
  interaction: string[];
  /** 사운드스케이프 패치 인스턴스(영역·배치한 소리. loading·active·releasing 모두 Pd 엔진 슬롯 하나씩) */
  voices: { id: string; patch: string; state: string; instance?: string }[];
  soundscape: ReturnType<GameSoundscape["debug"]> | null;
  diffuse: boolean;
  enabled: boolean;
  paused: boolean;
  frame: PlayerAudioFrame | null;
  /** 플레이어 빠르기(칸/초, whistle-player speed) */
  speed: number;
  /** 배치한 소리(Pd 슬롯 placed_sound) */
  placed: ReturnType<ReturnType<typeof createPlacedSounds>["snapshot"]>;
  /** 이벤트 소리(fallingstar 등) */
  events: ReturnType<ReturnType<typeof createEventSources>["snapshot"]>;
};

export function useGameAudio(notify: (message: string) => void) {
  const report = useRef(notify);
  report.current = notify;
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const recordings = useRef<ReturnType<typeof createPlacedSounds> | null>(null);
  const soundscape = useRef<GameSoundscape | null>(null);
  const mixRef = useRef<Awaited<ReturnType<typeof createGameMix>> | null>(null);
  const lastFrame = useRef<PlayerAudioFrame | null>(null);
  /** 플레이어 빠르기(칸/초, 수평): 오디오 프레임(약 80ms) 사이 위치 변화로 잰다. 순간이동(1초 넘게 끊김)은 무시 */
  const motion = useRef<{ x: number; z: number; time: number; speed: number } | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  /** 이번 플레이에서 Pd에 보낸 rain 값(날씨가 비인지). 바뀔 때만 보낸다. */
  const rain = useRef<boolean | undefined>(undefined);
  const api = useMemo(() => {
    const failed = () => report.current("오디오를 시작하지 못했어요. 다음 클릭에서 다시 시도합니다.");
    const get = () => controller.current ??= createGameAudio(
      async () => {
        const mix = await createGameMix(failed);
        mixRef.current = mix;
        recordings.current = mix.recordings;
        soundscape.current = mix.game;
        return mix.session;
      },
      (error) => { console.warn("[Whistle:Audio] 오류", error); failed(); },
    );
    const quiet = () => { soundscape.current?.stop(); mixRef.current?.events.stop(); };
    return {
      edit: (sound: EditSound) => { enabled.current = false; quiet(); recordings.current?.stop(); get().edit(sound); },
      play: () => { enabled.current = true; paused.current = false; rain.current = undefined; recordings.current?.stop(); get().play(); },
      stop: () => { enabled.current = false; quiet(); recordings.current?.stop(); controller.current?.stop(); },
      reset: () => { quiet(); recordings.current?.stop(); controller.current?.reset(); },
      movement: (frame: PlayerAudioFrame, world?: World, actors?: Actor[], derivation?: WorldDerivation) => {
        lastFrame.current = frame;
        const now = performance.now(), last = motion.current;
        const seconds = last ? (now - last.time) / 1000 : 0;
        const measured = last && seconds > 0 && seconds < 1 ? Math.hypot(frame.x - last.x, frame.z - last.z) / seconds : 0;
        // 프레임 간격이 고르지 않아 잰 값이 튄다. 앞 값과 절반씩 섞어 약하게 고른다(패치는 더 부드럽게 할 수 있다).
        const speed = last && seconds < 1 ? last.speed * 0.5 + measured * 0.5 : 0;
        motion.current = { x: frame.x, z: frame.z, time: now, speed };
        controller.current?.movement({ ...playerSound(frame), speed });
        if (!enabled.current || paused.current || !world) return;
        // 날씨가 비면 rain 1, 아니면 rain 0(플레이 시작 때 한 번, 그 뒤로는 바뀔 때만).
        const raining = world.weather === "rain";
        if (raining !== rain.current) { rain.current = raining; controller.current?.event("rain", raining); }
        mixRef.current?.worldFrame(frame, world, actors, derivation);
      },
      /** 디버그 오버레이용 현재 상태(읽기 전용 사본) */
      debug: (): GameAudioDebug => {
        const mix = mixRef.current;
        return {
          context: mix ? { state: mix.context.state, sampleRate: mix.context.sampleRate, latencyHint: mix.hint,
            baseLatency: mix.context.baseLatency, outputLatency: mix.context.outputLatency } : null,
          interaction: mix ? INTERACTION_PATCH_NAMES : [],
          voices: mix?.scape.snapshot().voices ?? [],
          soundscape: soundscape.current?.debug() ?? null,
          diffuse: mix?.scape.diffuse() ?? false,
          enabled: enabled.current,
          paused: paused.current,
          frame: lastFrame.current,
          speed: motion.current?.speed ?? 0,
          placed: recordings.current?.snapshot() ?? [],
          events: mix?.events.snapshot() ?? [],
        };
      },
      /** whistle-event <이름> 1/0 (fallingstar: 디버그 화면의 1 키. rain은 위 movement가 날씨로 보낸다).
       *  fallingstar는 공간화한다: 켜면 플레이어 앞 위쪽에 이벤트 소리(fallingstar_source)를 띄우고, 끄면 alive 0 */
      event: (name: GameEvent, on: boolean) => {
        controller.current?.event(name, on);
        const events = mixRef.current?.events, frame = lastFrame.current;
        if (name !== "fallingstar" || !events) return;
        if (!on) { events.set(FALLINGSTAR.name, ["alive", 0]); return; }
        if (!frame || !enabled.current) return;
        events.spawn(FALLINGSTAR.name, FALLINGSTAR.patch, ahead(frame, FALLINGSTAR.ahead, FALLINGSTAR.up), FALLINGSTAR.rule);
      },
      /** 이벤트 소리를 띄운다(게임 쪽 whistle-spawn과 같다). pos는 whistle-player position과 같은 좌표 */
      spawn: (name: string, patch: string, pos: Position, rule?: Partial<SpatialRule>) => mixRef.current?.events.spawn(name, patch, pos, rule),
      /** 이벤트 소리의 값을 바꾼다(whistle-source와 같다. 예: ["alive", 0], ["pos", x, y, z], ["curve", "exp"]) */
      setSource: (name: string, words: (string | number)[]) => mixRef.current?.events.set(name, words),
    };
  }, []);
  useEffect(() => {
    const pause = () => {
      paused.current = true;
      soundscape.current?.stop();
      mixRef.current?.events.stop();
      recordings.current?.stop(false);
      controller.current?.pause();
    };
    const visibility = () => { if (document.hidden) pause(); };
    const resume = () => {
      if (document.hidden) return;
      // 폰 브라우저는 터치·키 처리 중에만 소리를 켜 준다. 엔진의 AudioContext가 막혀 있으면 여기서 켠다.
      unlockAudio();
      paused.current = false;
      controller.current?.resume();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", resume);
    // 터치는 누를 때(pointerdown)가 아니라 뗄 때(pointerup·touchend)만 브라우저가 사용자 조작으로 친다.
    window.addEventListener("pointerup", unlockAudio);
    window.addEventListener("touchend", unlockAudio);
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
      window.removeEventListener("pointerup", unlockAudio);
      window.removeEventListener("touchend", unlockAudio);
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
