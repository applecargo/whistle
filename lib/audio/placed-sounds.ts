import type { Actor, World } from "../world.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { MAX_RECORDING_SECONDS, MAX_SOUND_VOICES, type Recording } from "./recording.ts";
import type { Environment } from "../environment.ts";
import { soundRangeAt } from "./sound-range.ts";

type Nearby = { id: string; recording: Recording; radius: number; distance: number; gain: number; pan: number };
type Voice = { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode };

export function nearbySounds(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment): Nearby[] {
  return actors.flatMap(actor => {
    const recording = world.assets.find(asset => asset.id === actor.asset)?.sound;
    if (actor.removed || !recording) return [];
    const dx = actor.x - player.x, dz = actor.z - player.z;
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, -dz) - player.yaw;
    const radius = soundRangeAt(environment, actor.x, actor.z);
    return [{ id: actor.id, recording, radius, distance,
      gain: recording.volume * Math.max(0, 1 - distance / radius) ** 2 * 0.25,
      pan: Math.sin(angle) }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

export function createPlacedSounds(context: AudioContext, output: AudioNode, onError: () => void) {
  const voices = new Map<string, Voice>();
  const buffers = new Map<string, AudioBuffer>();
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  const played = new Set<string>();
  let wanted: Nearby[] = [], generation = 0;
  const origin = context.currentTime;
  const stopVoice = (id: string) => {
    const voice = voices.get(id);
    if (!voice) return;
    voice.source.onended = null;
    voice.source.stop();
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect();
    voices.delete(id);
  };
  const start = (item: Nearby, buffer: AudioBuffer) => {
    if (voices.has(item.id) || voices.size >= MAX_SOUND_VOICES || context.state !== "running") return;
    if (item.recording.mode === "approach" && played.has(item.id)) return;
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    source.buffer = buffer;
    source.loop = item.recording.mode === "loop";
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.setTargetAtTime(item.gain, context.currentTime, 0.04);
    pan.pan.value = item.pan;
    source.connect(gain).connect(pan).connect(output);
    voices.set(item.id, { source, gain, pan });
    source.onended = () => {
      source.disconnect(); gain.disconnect(); pan.disconnect(); voices.delete(item.id);
    };
    const duration = Math.min(item.recording.duration, buffer.duration);
    source.loopEnd = duration;
    if (source.loop) source.start(0, (context.currentTime - origin) % duration);
    else source.start(0, 0, duration);
    if (!source.loop) played.add(item.id);
  };
  const load = (item: Nearby) => {
    const data = item.recording.data;
    if (buffers.has(data)) { start(item, buffers.get(data)!); return; }
    if (pending.has(data) || failed.has(data) || pending.size >= MAX_SOUND_VOICES) return;
    const request = generation;
    const task = (async () => {
      try {
        const binary = atob(data.slice(data.indexOf(",") + 1));
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        if (generation !== request || !wanted.some(next => next.recording.data === data)) return;
        if (buffer.duration > MAX_RECORDING_SECONDS + 0.1 || buffer.duration < 0.01 || buffer.numberOfChannels > 2)
          throw new Error("Unsupported recording");
        buffers.set(data, buffer);
        for (const next of wanted) if (next.recording.data === data) start(next, buffer);
      } catch {
        if (generation === request) { failed.add(data); onError(); }
      } finally {
        if (generation === request) pending.delete(data);
      }
    })();
    pending.set(data, task);
  };
  return {
    update(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment) {
      const candidates = nearbySounds(world, actors, player, environment);
      for (const id of played) {
        const item = candidates.find(item => item.id === id);
        if (!item || item.distance > item.radius + 0.5) played.delete(id);
      }
      wanted = candidates.filter(item => item.gain > 0 && !failed.has(item.recording.data) &&
        (item.recording.mode === "loop" || !played.has(item.id) || voices.has(item.id))).slice(0, MAX_SOUND_VOICES);
      for (const id of voices.keys()) if (!wanted.some(item => item.id === id)) stopVoice(id);
      for (const data of buffers.keys()) if (!wanted.some(item => item.recording.data === data)) buffers.delete(data);
      for (const item of wanted) {
        const voice = voices.get(item.id);
        if (voice) {
          voice.gain.gain.setTargetAtTime(item.gain, context.currentTime, 0.06);
          voice.pan.pan.setTargetAtTime(item.pan, context.currentTime, 0.06);
        } else load(item);
      }
    },
    stop(reset = true) {
      generation++;
      wanted = [];
      for (const id of voices.keys()) stopVoice(id);
      buffers.clear(); pending.clear();
      if (reset) { played.clear(); failed.clear(); }
    },
  };
}
