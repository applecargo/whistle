"use client";
import { useEffect, useMemo, useRef } from "react";
import { createPdSession, type EditSound } from "@/lib/audio/webpd-session";
import { createGameAudio } from "@/lib/audio/game-audio";
import { resonanceAt } from "@/lib/audio/soundscape";
import { playerSound, type PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { createPlacedSounds } from "@/lib/audio/placed-sounds";
import type { Actor, World, Event, Player } from "@/lib/world";
import type { Environment } from "@/lib/environment";

export function useGameAudio() {
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const recordings = useRef<ReturnType<typeof createPlacedSounds> | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const api = useMemo(() => {
    const get = () => controller.current ??= createGameAudio(
      async () => {
        const session = await createPdSession(`${import.meta.env.BASE_URL}audio-test/`, () => {});
        recordings.current = createPlacedSounds(session.context, session.node, () => {});
        return session;
      },
      () => {},
    );
    return {
      edit: (sound: EditSound) => { enabled.current = false; recordings.current?.stop(); get().edit(sound); },
      play: () => { enabled.current = true; paused.current = false; recordings.current?.stop(); get().play(); },
      stop: () => { enabled.current = false; recordings.current?.stop(); controller.current?.stop(); },
      reset: () => { recordings.current?.stop(); controller.current?.reset(); },
      movement: (frame: PlayerAudioFrame, world?: World, actors?: Actor[], environment?: Environment) => {
        controller.current?.movement({ ...playerSound(frame), resonance: environment && resonanceAt(environment, frame) });
        if (enabled.current && !paused.current && world && actors) recordings.current?.update(world, actors, frame, environment);
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
    const pause = () => { paused.current = true; recordings.current?.stop(false); controller.current?.pause(); };
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
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return api;
}
