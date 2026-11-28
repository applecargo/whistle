import { createInteractionSession } from "./pd-session.ts";
import { openEngine } from "./pd-runtime.ts";
import { createPlacedSounds } from "./placed-sounds.ts";
import { createPdSounds } from "./pd-sounds.ts";
import { createSoundscape } from "./soundscape.ts";
import { createGameSoundscape } from "./game-soundscape.ts";
import { createEventSources } from "./event-sources.ts";
import { parseRule, type SpatialRule } from "./spatial-rule.ts";
import { DEFAULT_NEARBY } from "./terrain-sources.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { flatTerrain } from "../terrain.ts";
import type { Actor, World } from "../world.ts";
import type { WorldDerivation } from "../world-derivation.ts";

const BASE = `${import.meta.env.BASE_URL}audio/`;
export const logAudio = (message: string) => console.log(`[Whistle:Audio] ${message}`);
/** 전체 음소거 fade(초) */
const MASTER_FADE = 0.05;
/** 오디오 버퍼 크기. 주소에 `?latency=playback`을 붙이면 큰 버퍼(끊김에 강함, 대신 발소리·편집음이 늦게 들림).
 *  `?latency=balanced`도 받는다. 없으면 브라우저 기본(interactive, 가장 짧음). */
const latencyHint = (): AudioContextLatencyCategory => {
  const value = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("latency");
  return value === "playback" || value === "balanced" ? value : "interactive";
};
const diffuseEnabled = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("diffuse");
/** 지형이 없는 맵의 평지 타일. 프레임마다 새 배열이면 영역을 매번 다시 나누므로 크기별로 하나만 만든다. */
const flatTiles = new Map<number, ReturnType<typeof flatTerrain>["tiles"]>();
const tilesOf = (world: World) => world.terrain?.tiles ?? flatTiles.get(world.size) ??
  flatTiles.set(world.size, flatTerrain(world.size).tiles).get(world.size)!;

/**
 * pd4web 엔진 1개(AudioContext도 엔진의 것. 페이지와 함께 계속 산다):
 *   상호작용 패치(edit·player·event) ─┐
 *   사운드스케이프(층별 영역 패치들) ──┼─→ 마스터 게인(음소거 fade) → 리미터 → 출력
 *   (배치한 소리도 사운드스케이프 소스: Pd 슬롯 placed_sound) ┘
 */
/** 소리 켜기를 이만큼(ms) 기다려도 안 되면 알린다(계속 기다리고, 다음 터치·키에서 켜진다: unlockAudio). */
const RESUME_NOTICE_MS = 3000;

export async function createGameMix(onBlocked: () => void, receive?: Parameters<typeof createInteractionSession>[1], outputLevel = 1) {
  const started = performance.now();
  const hint = latencyHint();
  const engine = await openEngine(BASE, { latencyHint: hint });
  const context = engine.context;
  let master: GainNode | undefined;
  try {
    // 엔진은 터치가 끝난 뒤에 열리므로, 폰 브라우저는 이 resume()을 다음 터치까지 미룬다.
    const notice = setTimeout(onBlocked, RESUME_NOTICE_MS);
    try { await context.resume(); } finally { clearTimeout(notice); }
    master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const speaker = context.createGain();
    speaker.gain.value = outputLevel;
    master.connect(limiter).connect(speaker).connect(context.destination);
    const session = await createInteractionSession(engine, receive, master);
    const output = master;
    const diffuse = diffuseEnabled();
    const scape = createSoundscape({
      context,
      destination: master,
      diffuse,
      // 거리에 따른 음량은 game-soundscape가 영역 외곽까지 거리로 정한다(패너 감쇠는 쓰지 않음).
      rolloff: 0,
      // 영역 버스(whistle-region)는 영역마다 따로 간다(패치는 [r $1-whistle-region]).
      start: (_c, name) => engine.start(name),
      onEvent: (event) => {
        if (event.type === "error") console.warn(`[Whistle:Audio] ${event.id} ${event.patch} 로드 실패`, event.error);
        else if (event.type === "active" || event.type === "released") logAudio(`${event.id} ${event.patch} ${event.type === "active" ? "켜짐" : "꺼짐"}`);
      },
    });
    // 패치 이름 → 패치가 알린 공간화 규칙(영역·배치한 소리. 예: environment_water가 loadbang에 "$1 curve exp")
    const rules = new Map<string, Partial<SpatialRule>>();
    // 이벤트 소리(fallingstar 등): 이름은 만드는 쪽이 정한다(패치의 $1)
    const events = createEventSources(scape, (patch, name) => engine.start(patch, name), (message) => console.warn(`[Whistle:Audio] ${message}`));
    // Pd → JS: 패치가 이름을 앞에 붙인 리스트로 보낸다([list prepend $1] → [s whistle-source]. audio/spatial-sources.md)
    const named = (listener: (name: string, words: (string | number)[]) => void) => ([name, ...words]: (string | number)[]) => {
      if (typeof name === "string") listener(name, words);
      else console.warn(`[Whistle:Audio] 이름(글자)으로 시작해야 합니다: ${[name, ...words].join(" ")}`);
    };
    const listening = [
      engine.onList("whistle-spawn", named((name, words) => events.fromPdSpawn(name, words))),
      engine.onList("whistle-source", named((name, words) => {
        if (events.set(name, words)) return;
        // 영역·배치한 소리의 슬롯(vK): 규칙이면 그 패치 이름의 모든 소스에
        const voice = scape.snapshot().voices.find((v) => v.instance === name);
        const rule = parseRule(words);
        if (!voice) { console.warn(`[Whistle:Audio] whistle-source ${name}: 그런 소스가 없습니다`); return; }
        if (!Object.keys(rule).length) return;
        rules.set(voice.patch, { ...rules.get(voice.patch), ...rule });
        logAudio(`${voice.patch} 공간화 규칙: ${words.join(" ")}`);
      })),
    ];
    logAudio(`오디오 시작: ${context.sampleRate}Hz, 상호작용 패치 edit·player·event 준비됨 (${Math.round(performance.now() - started)}ms), 비상관 필터 ${diffuse ? "켬" : "끔"}, 지연 설정 ${hint} (${(context.baseLatency * 1000).toFixed(1)}ms)`);
    const game = createGameSoundscape(scape, logAudio, DEFAULT_NEARBY, rules);
    const recordings = createPlacedSounds(scape, createPdSounds(engine), rules);
    return {
      context, hint, scape, game, recordings, events,
      worldFrame(frame: PlayerAudioFrame, world: World, actors?: Actor[], derivation?: WorldDerivation) {
        game.frame(frame, { size: world.size, tiles: tilesOf(world),
          environment: derivation?.environment, structures: derivation?.structures });
        if (actors) recordings.update(world, actors, frame);
        events.frame(frame);
      },
      stopWorld(resetRecordings = true) {
        game.stop();
        recordings.stop(resetRecordings);
        events.stop();
      },
      session: {
        ...session,
        // whistle-gate 대신 전체 마스터 게인으로 음소거한다(상호작용·사운드스케이프·녹음 사운드 모두).
        mute(muted: boolean) {
          const now = context.currentTime, gain = output.gain, current = gain.value;
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(current, now);
          gain.linearRampToValueAtTime(muted ? 0 : 1, now + MASTER_FADE);
        },
        async close() {
          for (const stop of listening) stop();
          recordings.stop();
          events.stop();
          scape.dispose();
          await session.close();
          output.disconnect();
          limiter.disconnect();
          speaker.disconnect();
          // 엔진은 닫지 않는다(페이지당 하나). 다음 시작 때 같은 엔진을 다시 쓴다.
          await context.suspend();
        },
      },
    };
  } catch (error) {
    master?.disconnect();
    throw error;
  }
}
