// 게임 ↔ 사운드스케이프 연결. 3D 플레이 중 오디오 프레임마다
// 리스너를 옮기고, 플레이어 근처에 걸친 소리 영역(층별로 같은 종류끼리 이어진 섬)을 가까운 순으로 켠다.
// 음원은 영역 외곽에서 플레이어에게 가장 가까운 점. 다가갈수록 커지고(외곽에서 1) 패닝이 줄어들어
// 외곽에 닿으면 좌우 모두 1, 안에서는 계속 1. 농도는 음량에 쓰지 않고 패치로 보낸다.
import type { Soundscape } from "./soundscape.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import {
  terrainRegions, nearbyRegions, diffActive, toScene, forwardOf, DEFAULT_NEARBY,
  type NearbyOptions, type Regions, type SoundField,
} from "./terrain-sources.ts";

/** 리스너(귀) 높이: 발 높이 + Scene.tsx의 EYE_HEIGHT */
export const EAR_HEIGHT = 1.35;
/** 영역 패치가 받는 버스: [농도 0~1](풀·안개·바람 세기, 나머지 층은 1). 패치에 `r whistle-region`이 없으면 보내지 않는다. */
export const REGION_BUS = "whistle-region";

type Scape = Pick<Soundscape, "set" | "remove" | "activate" | "deactivate" | "setListener">;

export function createGameSoundscape(scape: Scape, log: (message: string) => void, options: NearbyOptions = DEFAULT_NEARBY) {
  let regions: Regions | undefined;
  let active = new Set<string>();

  const stop = () => {
    for (const id of active) scape.deactivate(id);
    active = new Set();
  };

  /** 맵(지형·환경·구조물)이 바뀌었을 때만 영역을 다시 나눈다(같은 객체면 아무것도 안 함). */
  const sync = (field: SoundField) => {
    const last = regions?.field;
    if (last && last.size === field.size && last.tiles === field.tiles &&
        last.environment === field.environment && last.structures === field.structures) return;
    stop();
    for (const region of regions?.list ?? []) scape.remove(region.id);
    regions = terrainRegions(field);
    // 등록만 한다(노드 없음). 위치·음량은 켜질 때 프레임마다 정한다.
    for (const region of regions.list) scape.set({ id: region.id, patch: region.patch, position: { x: 0, y: 0, z: 0 }, gain: 0 });
    const kinds = Object.entries(regions.list.reduce<Record<string, number>>((count, r) => {
      count[r.kind] = (count[r.kind] ?? 0) + 1;
      return count;
    }, {})).map(([kind, n]) => `${kind} ${n}`).join(", ");
    const size = field.size;
    log(`소리 영역 등록 ${regions.list.length}개 (${size}×${size}, ${kinds || "없음"}) · 반경 ${options.radius}타일, 패닝 전환 ${options.blend}타일, 가까운 순 최대 ${options.max}개`);
  };

  return {
    sync,
    /** 3D 오디오 프레임마다 호출 */
    frame(frame: PlayerAudioFrame, field: SoundField) {
      sync(field);
      scape.setListener(
        { x: toScene(frame.x, frame.size), y: frame.y + EAR_HEIGHT, z: toScene(frame.z, frame.size) },
        forwardOf(frame.yaw),
      );
      const near = nearbyRegions(frame, regions!, active, options);
      const next = new Set(near.map((r) => r.id));
      const { on, off } = diffActive(active, next);
      for (const id of off) scape.deactivate(id);
      for (const { id, patch, position, gain, width, amount } of near) {
        scape.set({ id, patch, position, gain, width, messages: { [REGION_BUS]: [amount] } });
      }
      for (const id of on) scape.activate(id);
      active = next;
    },
    /** 에디터 복귀·일시정지·종료: 켜진 영역을 모두 fade out */
    stop,
    activeIds: () => [...active],
  };
}

export type GameSoundscape = ReturnType<typeof createGameSoundscape>;
