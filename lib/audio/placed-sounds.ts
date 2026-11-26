import type { Actor, World } from "../world.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { MAX_SOUND_VOICES, type Recording } from "./recording.ts";
import type { PlaySound } from "./pd-sounds.ts";
import type { Soundscape } from "./soundscape.ts";
import type { Environment } from "../environment.ts";
import { soundRangeAt } from "./sound-range.ts";
import { ruleGain, ruleWidth, type SpatialRule } from "./spatial-rule.ts";
import { toScene } from "./terrain-sources.ts";
import { EAR_HEIGHT } from "./game-soundscape.ts";

type Nearby = { id: string; recording: Recording; radius: number; distance: number; gain: number; width: number; x: number; z: number };
/** 배치한 소리의 공간화 규칙(spatial-rule.ts): range는 놓인 칸의 환경(sound-range.ts), 음량 곡선 x², width는 0에서 닿으면 1 */
export const PLACED_RULE: Omit<SpatialRule, "range"> = { width: 0, curve: { type: "pow", n: 2 } };
/** 녹음 볼륨에 곱하는 값(여러 소리가 겹쳐도 크지 않게) */
const PLACED_LEVEL = 0.25;
/** 사운드스케이프 소스 id(영역 id와 겹치지 않게) */
const sourceId = (actorId: string) => `placed:${actorId}`;
/** 패치가 받는 버스(placed_sound.pd의 [r $1-whistle-sound]: distance <타일> <반경>) */
export const PLACED_BUS = "whistle-sound";

export function nearbySounds(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment): Nearby[] {
  return actors.flatMap(actor => {
    const recording = world.assets.find(asset => asset.id === actor.asset)?.sound;
    if (actor.removed || !recording) return [];
    const distance = Math.hypot(actor.x - player.x, actor.z - player.z);
    const radius = soundRangeAt(environment, actor.x, actor.z);
    const rule = { ...PLACED_RULE, range: radius };
    return [{ id: actor.id, recording, radius, distance, x: actor.x, z: actor.z,
      gain: recording.volume * PLACED_LEVEL * ruleGain(rule, distance), width: ruleWidth(rule, distance) }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

type Scape = Pick<Soundscape, "set" | "remove" | "activate" | "deactivate" | "snapshot">;

/**
 * 가까운 배치 소리를 최대 MAX_SOUND_VOICES개 켠다. 영역과 같은 사운드스케이프 소스라 같은 길(gain → PannerNode·width)로 나간다.
 * 음량·width는 PLACED_RULE(spatial-rule.ts).
 * 패치는 play(Pd 슬롯 placed_sound, pd-sounds.ts)가 띄운다. 위치는 소리가 놓인 칸, 높이는 귀 높이(좌우·앞뒤만).
 * "approach"는 한 번 재생하고(패치가 끝을 알린다), 반경을 벗어나야 다시 울린다.
 * 리스너는 영역 쪽(game-soundscape의 frame)이 프레임마다 옮긴다.
 */
export function createPlacedSounds(scape: Scape, play: PlaySound) {
  /** 등록한 소스(액터 id) */
  const registered = new Set<string>();
  /** 지금 켠 소스(액터 id) */
  const active = new Set<string>();
  const failed = new Set<string>();
  const played = new Set<string>();
  let wanted: Nearby[] = [];
  const off = (id: string) => { scape.deactivate(sourceId(id)); active.delete(id); };
  const starter = (item: Nearby) => async () => {
    try {
      const sound = await play.play(item.recording);
      if (item.recording.mode === "approach") {
        played.add(item.id);
        sound.onEnd(() => { if (active.has(item.id)) off(item.id); });
      }
      return sound;
    } catch (error) {
      // 풀지 못한 소리는 다시 시도하지 않는다(맵을 다시 시작할 때까지)
      failed.add(item.recording.data);
      throw error;
    }
  };
  return {
    update(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment) {
      // 맵의 소리를 미리 Pd에 읽어 둔다(처음 한 번만 일이 있다). 다가갈 때 기다리지 않게.
      for (const asset of world.assets) if (asset.sound) play.prepare(asset.sound).catch(() => {});
      const candidates = nearbySounds(world, actors, player, environment);
      for (const id of played) {
        const item = candidates.find(item => item.id === id);
        if (!item || item.distance > item.radius + 0.5) played.delete(id);
      }
      wanted = candidates.filter(item => item.gain > 0 && !failed.has(item.recording.data) &&
        (item.recording.mode === "loop" || !played.has(item.id) || active.has(item.id))).slice(0, MAX_SOUND_VOICES);
      for (const id of active) if (!wanted.some(item => item.id === id)) off(id);
      for (const id of registered) if (!candidates.some(item => item.id === id)) { scape.remove(sourceId(id)); registered.delete(id); }
      const y = player.y + EAR_HEIGHT;
      for (const item of wanted) {
        scape.set({
          id: sourceId(item.id), patch: "placed_sound", start: starter(item),
          position: { x: toScene(item.x, player.size), y, z: toScene(item.z, player.size) },
          gain: item.gain, width: item.width,
          // 플레이어까지 거리(타일)와 들리는 반경. 패치가 재생 빠르기 등에 쓴다
          messages: { [PLACED_BUS]: [["distance", item.distance, item.radius]] },
        });
        registered.add(item.id);
        if (!active.has(item.id)) { active.add(item.id); scape.activate(sourceId(item.id)); }
      }
    },
    /** 디버그용: 지금 고른 소리와 상태(loading: 슬롯 여는 중, active: 재생 중, releasing: 끄는 중) */
    snapshot() {
      const voices = scape.snapshot().voices;
      return wanted.map(item => {
        const voice = voices.find(v => v.id === sourceId(item.id));
        return { id: item.id, slot: voice?.instance ?? "-", distance: item.distance, gain: item.gain, width: item.width,
          mode: item.recording.mode, state: voice?.state ?? "waiting" };
      });
    },
    stop(reset = true) {
      wanted = [];
      for (const id of [...active]) off(id);
      if (reset) { played.clear(); failed.clear(); }
    },
  };
}
