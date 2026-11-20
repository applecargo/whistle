"use client";
import { useEffect, useMemo, useRef } from "react";
import { createPdSession, type EditSound } from "@/lib/audio/webpd-session";
import { createGameAudio } from "@/lib/audio/game-audio";
import { playerSound, type PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { createPlacedSounds } from "@/lib/audio/placed-sounds";
import type { Actor, Environment } from "@/lib/environment";
import type { SpatialSoundOptions, PlayerAudioState } from "@/lib/audio/types";
import type { SoundscapePatchDescriptor } from "@/lib/audio/soundscape-manager";
import type { Event, Player } from "@/lib/world";

export function useGameAudio() {
  const controller = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const recordings = useRef<ReturnType<typeof createPlacedSounds> | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const api = useMemo(() => {
    const get = () => controller.current ??= createGameAudio(
      async () => {
        const session = await createPdSession(`${import.meta.env.BASE_URL}audio-test/`, () => {});
        recordings.current = createPlacedSounds(session.context, () => {});
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
        controller.current?.movement(playerSound(frame));
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
      loadClip: (id: string, source: ArrayBuffer | Blob | string) => get().loadClip(id, source),
      playSpatialClip: (id: string, options: SpatialSoundOptions) => get().playSpatialClip(id, options),
      unloadClip: (id: string) => controller.current?.unloadClip(id),
      updatePlayerState: (state: Partial<PlayerAudioState>) => controller.current?.updatePlayerState(state),
      registerTilePatch: (desc: SoundscapePatchDescriptor) => get().registerTilePatch(desc),
      unregisterTilePatch: (id: string) => controller.current?.unregisterTilePatch(id),
      updateSoundscape: (player: { x: number; y: number; z: number }) => controller.current?.updateSoundscape(player),
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
