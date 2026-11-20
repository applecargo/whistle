// 게임 ↔ 사운드스케이프 연결. 3D 플레이 중 오디오 프레임마다
// 리스너를 옮기고 플레이어 근처 타일만 켠다(나머지는 등록만, 노드 없음).
import type { Tile } from "../terrain.ts";
import type { Soundscape } from "./soundscape.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { terrainSources, nearbyTiles, diffActive, toScene, forwardOf, DEFAULT_NEARBY, type NearbyOptions } from "./terrain-sources.ts";

/** 리스너(귀) 높이: 발 높이 + Scene.tsx의 EYE_HEIGHT */
export const EAR_HEIGHT = 1.35;

type Scape = Pick<Soundscape, "set" | "remove" | "activate" | "deactivate" | "setListener">;

export function createGameSoundscape(scape: Scape, log: (message: string) => void, options: NearbyOptions = DEFAULT_NEARBY) {
  let tiles: readonly Tile[] | undefined;
  let size = 0;
  let ids: string[] = [];
  let candidates = new Set<number>();
  let active = new Set<string>();

  const stop = () => {
    for (const id of active) scape.deactivate(id);
    active = new Set();
  };

  /** 지형이 바뀌었을 때만 소스를 다시 등록한다(같은 배열이면 아무것도 안 함). */
  const sync = (nextTiles: readonly Tile[], nextSize: number) => {
    if (nextTiles === tiles && nextSize === size) return;
    stop();
    for (const id of ids) scape.remove(id);
    const sources = terrainSources(nextTiles, nextSize);
    for (const source of sources) scape.set(source);
    tiles = nextTiles;
    size = nextSize;
    ids = sources.map((s) => s.id);
    candidates = new Set(sources.map((s) => Number(s.id.slice("tile-".length))));
    const patches = Object.entries(sources.reduce<Record<string, number>>((count, s) => {
      count[s.patch] = (count[s.patch] ?? 0) + 1;
      return count;
    }, {})).map(([patch, n]) => `${patch} ${n}`).join(", ");
    log(`지형 소스 등록 ${sources.length}개 (${nextSize}×${nextSize}, ${patches || "없음"}) · 반경 ${options.radius}타일, 최대 ${options.max}개`);
  };

  return {
    sync,
    /** 3D 오디오 프레임마다 호출 */
    frame(frame: PlayerAudioFrame, frameTiles: readonly Tile[]) {
      sync(frameTiles, frame.size);
      scape.setListener(
        { x: toScene(frame.x, frame.size), y: frame.y + EAR_HEIGHT, z: toScene(frame.z, frame.size) },
        forwardOf(frame.yaw),
      );
      const next = nearbyTiles(frame, frame.size, candidates, active, options);
      const { on, off } = diffActive(active, next);
      for (const id of off) scape.deactivate(id);
      for (const id of on) scape.activate(id);
      active = next;
    },
    /** 에디터 복귀·일시정지·종료: 켜진 타일을 모두 fade out */
    stop,
    activeIds: () => [...active],
  };
}

export type GameSoundscape = ReturnType<typeof createGameSoundscape>;
