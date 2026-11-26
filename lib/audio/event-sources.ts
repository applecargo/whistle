// 이벤트 소리: 영역이 아닌데 공간화되는 소리(fallingstar 등). 영역처럼 슬롯 하나에 패치를 띄우고 같은 길(gain → PannerNode·width)로 낸다.
//
// - 만들기: 게임이 spawn()을 부르거나, Pd가 [s whistle-spawn]으로 "<이름> <패치> x y z [규칙…]"을 보낸다.
//   이름은 만드는 쪽이 정한다(패치의 $1). JS가 정하는 이름(v1, v2…)과 겹치지 않게 v+숫자 꼴은 받지 않는다.
// - 값(소스마다 하나, Pd와 JS가 함께 쓴다): alive 1/0 · pos x y z · range · width · curve.
//   누가 바꾸든(게임: set(), Pd: [s whistle-source]에 "<이름> <값이름> …") 여기 한 곳에 두고, 바뀐 값을 패치의 [r $1-whistle-source]로 보낸다.
//   그래서 패치는 자기가 바꿨든 게임이 바꿨든 늘 같은 값을 본다. 동시에 바꾸면 나중에 온 값.
//   패치는 같은 버스로 distance <타일>(플레이어까지)도 받는다(바뀔 때만).
// - alive 0: 누가 쓰든 페이드 아웃 후 슬롯을 닫고 지운다. 끝난 이름은 다시 쓸 수 있다.
// - 좌표는 whistle-player position과 같다: x, z = (격자 + 0.5) / 맵 크기(0~1), y = 높이(발 높이와 같은 단위).
import type { PdMessage, PatchHandle, Soundscape } from "./soundscape.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { toScene } from "./terrain-sources.ts";
import { EAR_HEIGHT } from "./game-soundscape.ts";
import { parseRule, ruleGain, ruleWidth, describeCurve, type SpatialRule, type Curve } from "./spatial-rule.ts";

/** 패치가 받는 버스(패치에서 [r $1-whistle-source] → [route alive pos range width curve distance]) */
export const SOURCE_BUS = "whistle-source";
/** 이벤트 소리의 기본 규칙(만들 때 규칙을 주지 않으면) */
export const EVENT_RULE: SpatialRule = { range: 10, width: 0.3, curve: { type: "lin" } };
/** JS가 정하는 이름 꼴. Pd·게임은 쓰지 않는다 */
const ENGINE_NAME = /^v\d+$/;

export type Position = { x: number; y: number; z: number };
type Source = { name: string; patch: string; pos: Position; rule: SpatialRule; handle?: PatchHandle; distance?: number };
type Scape = Pick<Soundscape, "set" | "remove" | "activate" | "deactivate">;
type Start = (patch: string, name: string) => Promise<PatchHandle>;

const curveWords = (curve: Curve): PdMessage =>
  curve.type === "lin" ? ["lin"] : curve.type === "pow" ? ["pow", curve.n] : [curve.type, curve.db];
/** 패치로 보내는 값 메시지들(alive는 따로) */
const values = (s: Source): PdMessage[] => [
  ["pos", s.pos.x, s.pos.y, s.pos.z], ["range", s.rule.range], ["width", s.rule.width], ["curve", ...curveWords(s.rule.curve)],
];

export function createEventSources(scape: Scape, start: Start, warn: (message: string) => void = console.warn) {
  const sources = new Map<string, Source>();
  let player: PlayerAudioFrame | undefined;
  const echo = (source: Source, message: PdMessage) => {
    try { source.handle?.send?.(SOURCE_BUS, message); } catch { /* 패치가 이미 닫힘 */ }
  };
  const kill = (name: string) => {
    if (!sources.delete(name)) return;
    scape.remove(name);
  };
  /** 플레이어까지 거리(타일). 높이 차이는 한 칸 = 2(장면 단위)로 친다 */
  const distanceOf = (pos: Position) => {
    if (!player) return Infinity;
    const size = player.size;
    return Math.hypot(pos.x * size - 0.5 - player.x, pos.z * size - 0.5 - player.z, (pos.y - player.y - EAR_HEIGHT) / 2);
  };
  const place = (source: Source) => {
    if (!player) return;
    const size = player.size, distance = distanceOf(source.pos);
    source.distance = distance;
    scape.set({
      id: source.name, patch: source.patch, start: () => open(source),
      position: { x: toScene(source.pos.x * size - 0.5, size), y: source.pos.y, z: toScene(source.pos.z * size - 0.5, size) },
      gain: ruleGain(source.rule, distance), width: ruleWidth(source.rule, distance),
      messages: { [SOURCE_BUS]: [["distance", Math.round(distance * 100) / 100]] },
    });
  };
  const open = async (source: Source) => {
    try {
      const handle = await start(source.patch, source.name);
      source.handle = handle;
      // 처음 값: 살아 있음과 지금 값 모두
      echo(source, ["alive", 1]);
      for (const message of values(source)) echo(source, message);
      return handle;
    } catch (error) {
      // 슬롯이 모자라는 등: 다시 시도하지 않는다
      warn(`[sources] ${source.name} ${source.patch}를 띄우지 못했습니다: ${error instanceof Error ? error.message : error}`);
      sources.delete(source.name);
      throw error;
    }
  };

  /** 값 하나를 바꾼다(게임이든 Pd든). 모르는 값 이름은 무시한다. 바뀐 것을 패치로 보낸다 */
  const update = (name: string, words: PdMessage) => {
    const source = sources.get(name);
    if (!source) return false;
    const [field, ...rest] = words;
    if (field === "alive") {
      if (rest[0] === 0) kill(name);
      return true;
    }
    if (field === "pos") {
      const [x, y, z] = rest;
      if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return true;
      source.pos = { x, y, z };
      echo(source, ["pos", x, y, z]);
    } else {
      const change = parseRule(words);
      if (!Object.keys(change).length) return true;
      source.rule = { ...source.rule, ...change };
      for (const key of Object.keys(change) as (keyof SpatialRule)[])
        echo(source, key === "curve" ? ["curve", ...curveWords(source.rule.curve)] : [key, source.rule[key] as number]);
    }
    place(source);
    return true;
  };

  return {
    /** 이벤트 소리를 띄운다. 같은 이름이 살아 있으면 무시한다. rule: 기본(EVENT_RULE)에서 바꿀 것(Pd 낱말 "range 8 curve exp"도 됨) */
    spawn(name: string, patch: string, pos: Position, rule: Partial<SpatialRule> | PdMessage = {}) {
      if (ENGINE_NAME.test(name)) { warn(`[sources] ${name}: v+숫자 이름은 엔진이 쓰므로 받지 않습니다.`); return false; }
      if (sources.has(name)) { warn(`[sources] ${name}: 이미 살아 있습니다(바꾸려면 whistle-source로).`); return false; }
      const change = Array.isArray(rule) ? parseRule(rule) : rule;
      const source: Source = { name, patch, pos, rule: { ...EVENT_RULE, ...change } };
      sources.set(name, source);
      place(source);
      if (player) scape.activate(name);
      return true;
    },
    set: update,
    /** Pd의 whistle-spawn 메시지: <이름> <패치> x y z [규칙…] (선택자 = 이름) */
    fromPdSpawn(name: string, words: PdMessage) {
      const [patch, x, y, z, ...rule] = words;
      if (typeof patch !== "string" || typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
        warn(`[sources] whistle-spawn ${name} ${words.join(" ")}: "<이름> <패치> x y z [규칙…]"이어야 합니다.`);
        return;
      }
      this.spawn(name, patch, { x, y, z }, rule);
    },
    has: (name: string) => sources.has(name),
    /** 오디오 프레임마다: 거리 → 음량·width */
    frame(next: PlayerAudioFrame) {
      const first = !player;
      player = next;
      for (const source of sources.values()) {
        place(source);
        if (first) scape.activate(source.name);
      }
    },
    /** 모두 끈다(에디터 복귀·일시정지·종료) */
    stop() { for (const name of [...sources.keys()]) kill(name); player = undefined; },
    /** 디버그 표시용 */
    snapshot: () => [...sources.values()].map((s) => ({
      name: s.name, patch: s.patch, distance: s.distance ?? NaN,
      gain: ruleGain(s.rule, s.distance ?? Infinity), width: ruleWidth(s.rule, s.distance ?? Infinity),
      rule: `range ${s.rule.range} · width ${s.rule.width} · ${describeCurve(s.rule.curve)}`,
    })),
  };
}

export type EventSources = ReturnType<typeof createEventSources>;
