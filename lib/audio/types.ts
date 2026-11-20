/**
 * 오디오 시스템 공통 타입 및 인터페이스
 */

/**
 * Pd 필터 적용 모드 / 프리셋
 */
export type PdFilterMode =
  | "bypass"       // 필터 바이패스 (원음 그대로 재생)
  | "default"      // 기본 Pd 필터
  | "underwater"   // 수중 먹먹함 효과
  | "reverb"       // 공간 울림 효과
  | "radio"        // 라디오 / Lo-Fi 효과
  | string;        // 추가 커스텀 프리셋

/**
 * 3D / 2D 공간 사운드 재생 옵션
 */
export interface SpatialSoundOptions {
  /** 3D 월드 좌표 [x, y, z] (지정 시 PannerNode 사용) */
  position?: [number, number, number];

  /** 좌우 패닝 (-1.0 ~ 1.0, 2D Equal Power Panning 사용 시) */
  pan?: number;

  /** 음량 (0.0 ~ 1.0, 기본값: 1.0) */
  volume?: number;

  /** 반복 재생 여부 (기본값: false) */
  loop?: boolean;

  /** Pd 필터 적용 여부 및 프리셋 (기본값: 'bypass') */
  filter?: PdFilterMode;

  /** 공간음향 모델 (기본값: 'HRTF') */
  panningModel?: "HRTF" | "equalpower";
}

/**
 * 재생 중인 사운드 제어 핸들
 */
export interface SoundInstance {
  id: string;
  stop: () => void;
  setVolume: (volume: number) => void;
  setPosition: (position: [number, number, number]) => void;
  setPan: (pan: number) => void;
  setFilter: (filter: PdFilterMode) => void;
}

/**
 * 전역 플레이어 상태
 */
export interface PlayerAudioState {
  x: number;
  y: number;
  z: number;
  yaw: number;             // 라디안
  crouch?: boolean;
  run?: boolean;
  grounded?: boolean;
  falling?: boolean;
  grass?: number;
  rough?: number;
  water?: number;
  boardHeight?: number;    // UWB 높이 (0~10m)
  speed?: number;
}
