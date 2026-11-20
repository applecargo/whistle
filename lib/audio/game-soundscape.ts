// 게임 ↔ 사운드스케이프 연결. 3D 플레이 중 오디오 프레임마다
// 리스너를 옮기고, 플레이어 근처에 걸친 지형 영역(같은 종류끼리 이어진 섬)마다 소스 하나를 켠다.
import type { Tile } from "../terrain.ts";
import type { Soundscape } from "./soundscape.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { terrainRegions, nearbyRegions, diffActive, toScene, forwardOf, DEFAULT_NEARBY, type NearbyOptions, type Regions } from "./terrain-sources.ts";

/** 리스너(귀) 높이: 발 높이 + Scene.tsx의 EYE_HEIGHT */
export const EAR_HEIGHT = 1.35;

type Scape = Pick<Soundscape, "set" | "remove" | "activate" | "deactivate" | "setListener">;

export function createGameSoundscape(scape: Scape, log: (message: string) => void, options: NearbyOptions = DEFAULT_NEARBY) {
  let regions: Regions | undefined;
  let active = new Set<string>();

  const stop = () => {
    for (const id of active) scape.deactivate(id);
    active = new Set();
  };

  /** 지형이 바뀌었을 때만 영역을 다시 나눈다(같은 배열이면 아무것도 안 함). */
  const sync = (tiles: readonly Tile[], size: number) => {
    if (regions && regions.tiles === tiles && regions.size === size) return;
    stop();
    for (const region of regions?.list ?? []) scape.remove(region.id);
    regions = terrainRegions(tiles, size);
    // 등록만 한다(노드 없음). 위치·음량은 켜질 때 프레임마다 정한다.
    for (const region of regions.list) scape.set({ id: region.id, patch: region.patch, position: { x: 0, y: 0, z: 0 }, gain: 0 });
    const kinds = Object.entries(regions.list.reduce<Record<string, number>>((count, r) => {
      count[r.surface] = (count[r.surface] ?? 0) + 1;
      return count;
    }, {})).map(([surface, n]) => `${surface} ${n}`).join(", ");
    log(`지형 영역 등록 ${regions.list.length}개 (${size}×${size}, ${kinds || "없음"}) · 반경 ${options.radius}타일, 최대 ${options.max}개`);
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
      const near = nearbyRegions(frame, regions!, active, options);
      const next = new Set(near.map((r) => r.id));
      const { on, off } = diffActive(active, next);
      for (const id of off) scape.deactivate(id);
      for (const region of near) scape.set(region);
      for (const id of on) scape.activate(id);
      active = next;
    },
    /** 에디터 복귀·일시정지·종료: 켜진 영역을 모두 fade out */
    stop,
    activeIds: () => [...active],
  };
}

export type GameSoundscape = ReturnType<typeof createGameSoundscape>;
