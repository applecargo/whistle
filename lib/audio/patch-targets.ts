/**
 * WASM 빌드 대상 및 사운드스케이프에서 사용 가능한 독립 실행 Pd 패치 목록
 * 하위 참조 패치(Abstractions)나 서브 패치는 제외하고, 실제 앱과 지형에서 직접 재생되는 타깃만 정의합니다.
 */
export const SOUNDSCAPE_TARGET_PATCHES = [
  "uwb-player",
  "terrain_clock",
  "bell01",
  "stone_knock",
  "noise_mod",
  "simplesine",
  "player3",
  "bouncing_rhythm",
  "dama_object_bluenote",
] as const;

export type SoundscapePatchName = (typeof SOUNDSCAPE_TARGET_PATCHES)[number];
