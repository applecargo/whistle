import type { EditSound, PlayerSound, PdSession } from "./webpd-session.ts";
import type { SpatialSoundOptions, SoundInstance, PlayerAudioState } from "./types.ts";
import { soundAssetManager } from "./sound-assets.ts";
import { audioStateBus } from "./audio-state.ts";
import { SoundscapeManager, type SoundscapePatchDescriptor } from "./soundscape-manager.ts";

type Session = Pick<PdSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "mute" | "close"> & {
  masterGain?: GainNode;
  node?: AudioNode;
};

export function createGameAudio(load: () => Promise<Session>, onError: (error: unknown) => void) {
  let session: Session | undefined;
  let loading: Promise<void> | undefined;
  let soundscape: SoundscapeManager | undefined;
  let disposed = false, paused = false, playing = false;
  let pendingEdit: EditSound | undefined;
  let latestPlayer: PlayerSound | undefined;
  let pendingEvent: [number, number, number] | undefined;

  const safely = (action: () => void) => {
    try { action(); } catch (error) { onError(error); }
  };

  const getSoundscape = () => {
    if (!soundscape && session?.masterGain) {
      soundscape = new SoundscapeManager(
        session.context,
        session.masterGain,
        `${import.meta.env.BASE_URL}audio-test/`
      );
    }
    return soundscape;
  };

  const flush = () => {
    if (!session || paused || disposed || (!playing && !pendingEdit)) return;
    session.mute(false);
    if (playing) {
      if (latestPlayer) session.player(latestPlayer);
      if (pendingEvent) { session.event(...pendingEvent); pendingEvent = undefined; }
    }
    else if (pendingEdit) { session.edit(pendingEdit); pendingEdit = undefined; }
  };

  const activate = () => {
    if (disposed) return;
    paused = false;
    if (session) {
      void session.context.resume().then(() => safely(flush)).catch(onError);
    } else if (!loading) {
      loading = load().then(async (created) => {
        if (disposed) { await created.close(); return; }
        session = created;
        getSoundscape();
        safely(flush);
      }).catch((error) => {
        pendingEdit = undefined;
        if (!disposed) onError(error);
      }).finally(() => { loading = undefined; });
    }
  };

  const reset = () => {
    pendingEdit = undefined;
    latestPlayer = undefined;
    pendingEvent = undefined;
    soundAssetManager.stopAll();
    soundscape?.disableAll();
    safely(() => { session?.stopPlayer(); session?.mute(true); });
  };

  return {
    edit(sound: EditSound) {
      if (disposed) return;
      playing = false;
      pendingEdit = sound;
      activate();
    },
    play() { reset(); playing = true; activate(); },
    stop() { playing = false; reset(); },
    reset,
    movement(sound: PlayerSound) {
      if (!playing || paused || disposed) return;
      latestPlayer = sound;
      safely(() => {
        session?.player(sound);
        audioStateBus.update(sound, session?.context);
        soundscape?.update({ x: sound.x, y: sound.y, z: sound.z });
      });
    },
    event(frequency: number, gain: number, pan: number) {
      if (!playing || paused || disposed) return;
      if (session) safely(() => session?.event(frequency, gain, pan));
      else pendingEvent = [frequency, gain, pan];
    },
    pause() { paused = true; reset(); },
    resume() { if (paused && (session || loading)) activate(); },
    dispose() {
      disposed = true;
      reset();
      soundscape?.destroy();
      soundscape = undefined;
      void session?.close().catch(onError);
      session = undefined;
    },

    // ── [신규 추가: 외부 음원 및 공간화 인터페이스] ──
    async loadClip(id: string, source: ArrayBuffer | Blob | string) {
      if (disposed) return;
      if (!session && !loading) activate();
      if (loading) await loading;
      if (session && typeof session.context.decodeAudioData === "function") {
        await soundAssetManager.loadClip(id, source, session.context);
      }
    },
    playSpatialClip(id: string, options: SpatialSoundOptions): SoundInstance | null {
      if (!session || paused || disposed || typeof session.context.createGain !== "function") return null;
      const destination = session.masterGain ?? session.context.destination;
      return soundAssetManager.playSpatialClip(id, options, session.context, destination);
    },
    unloadClip(id: string) {
      soundAssetManager.unloadClip(id);
    },
    updatePlayerState(state: Partial<PlayerAudioState>) {
      audioStateBus.update(state, session?.context);
    },

    // ── [신규 추가: 멀티 패치 사운드스케이프 인터페이스] ──
    async registerTilePatch(desc: SoundscapePatchDescriptor) {
      if (disposed) return;
      if (!session && !loading) activate();
      if (loading) await loading;
      return getSoundscape()?.registerPatch(desc);
    },
    unregisterTilePatch(id: string) {
      soundscape?.unregisterPatch(id);
    },
    updateSoundscape(player: { x: number; y: number; z: number }) {
      if (!playing || paused || disposed) return;
      soundscape?.update(player);
    },
  };
}
