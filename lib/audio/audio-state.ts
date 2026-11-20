import type { PlayerAudioState } from "./types.ts";

/**
 * 전역 플레이어 오디오 상태 버스
 * - 모든 WASM 모듈 및 Web Audio 노드가 참조 가능한 단일 상태 소스
 * - Web Audio의 AudioListener 위치와 방향(Yaw)을 자동으로 동기화
 */
class AudioStateBus {
  private defaultState: PlayerAudioState = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    crouch: false,
    run: false,
    grounded: true,
    falling: false,
    grass: 0,
    rough: 0,
    water: 0,
  };

  private state: PlayerAudioState = { ...this.defaultState };

  private listeners = new Set<(state: PlayerAudioState) => void>();

  /**
   * 상태 리셋
   */
  reset() {
    this.state = { ...this.defaultState };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * 현재 상태 조회
   */
  get(): Readonly<PlayerAudioState> {
    return this.state;
  }

  /**
   * 상태 갱신 및 리스너 브로드캐스트
   */
  update(partial: Partial<PlayerAudioState>, context?: AudioContext) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
    if (context && context.state === "running") {
      this.syncListener(context);
    }
  }

  /**
   * 상태 변경 구독
   */
  subscribe(callback: (state: PlayerAudioState) => void): () => void {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }

  /**
   * Web Audio의 AudioListener 위치/방향 동기화
   * - UWB 및 3D 게임 환경에서 pitch/roll(고개 끄덕임)은 0으로 고정하고 yaw(수평 방향)만 반영
   * - Up 벡터: [0, 1, 0] 고정
   */
  syncListener(context: AudioContext) {
    const { x, y, z, yaw } = this.state;
    const listener = context.listener;
    const now = context.currentTime;

    // Listener 위치
    if (listener.positionX) {
      listener.positionX.setValueAtTime(x, now);
      listener.positionY.setValueAtTime(y, now);
      listener.positionZ.setValueAtTime(z, now);
    } else {
      // 레거시 API 호환
      listener.setPosition(x, y, z);
    }

    // Listener 전방 벡터 (Yaw 기반)
    const forwardX = Math.sin(yaw);
    const forwardY = 0;
    const forwardZ = -Math.cos(yaw);

    if (listener.forwardX) {
      listener.forwardX.setValueAtTime(forwardX, now);
      listener.forwardY.setValueAtTime(forwardY, now);
      listener.forwardZ.setValueAtTime(forwardZ, now);
      listener.upX.setValueAtTime(0, now);
      listener.upY.setValueAtTime(1, now);
      listener.upZ.setValueAtTime(0, now);
    } else {
      // 레거시 API 호환
      listener.setOrientation(forwardX, forwardY, forwardZ, 0, 1, 0);
    }
  }
}

export const audioStateBus = new AudioStateBus();
