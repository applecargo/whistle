import { createWasmPatchInstance, type WasmPatchInstance } from "./wasm-patch-instance";

export type ActivationPolicy = 
  | { type: "distance"; radius: number } // 플레이어와의 거리 기반 컬링 (타일/오브젝트 기본값)
  | { type: "always" }                  // 상시 켜짐 (전역 앰비언트 등)
  | { type: "manual" }                  // 명시적 enable()/disable() 호출로만 제어
  | { type: "custom"; predicate: (player: { x: number; y: number; z: number }) => boolean };

export type SoundscapePatchDescriptor = {
  id: string;
  patchName: string;
  position?: { x: number; y: number; z: number };
  policy?: ActivationPolicy;
  initialGain?: number;
};

export class SoundscapeManager {
  private instances = new Map<string, {
    instance: WasmPatchInstance;
    descriptor: SoundscapePatchDescriptor;
  }>();

  constructor(
    private context: AudioContext,
    private destination: AudioNode,
    private baseUrl: string,
    public defaultCullingRadius = 18.0
  ) {}

  /**
   * 새로운 사운드스케이프 패치(타일, 오브젝트, 전역 앰비언트 등)를 등록
   */
  async registerPatch(desc: SoundscapePatchDescriptor): Promise<WasmPatchInstance> {
    if (this.instances.has(desc.id)) {
      return this.instances.get(desc.id)!.instance;
    }

    const instance = await createWasmPatchInstance({
      id: desc.id,
      patchName: desc.patchName,
      baseUrl: this.baseUrl,
      context: this.context,
      destination: this.destination,
      spatial: desc.position,
      initialGain: desc.initialGain ?? 1.0,
    });

    const entry = {
      instance,
      descriptor: {
        ...desc,
        policy: desc.policy ?? (desc.position ? { type: "distance", radius: this.defaultCullingRadius } : { type: "always" }),
      },
    };

    this.instances.set(desc.id, entry);
    return instance;
  }

  /**
   * 패치 등록 해제 및 리소스 정리
   */
  unregisterPatch(id: string) {
    const entry = this.instances.get(id);
    if (entry) {
      entry.instance.destroy();
      this.instances.delete(id);
    }
  }

  getPatch(id: string): WasmPatchInstance | undefined {
    return this.instances.get(id)?.instance;
  }

  /**
   * 플레이어 위치 및 월드 상태를 반영하여 모든 등록된 패치의 On/Off 스위치 평가
   */
  update(player: { x: number; y: number; z: number }) {
    for (const { instance, descriptor } of this.instances.values()) {
      const policy = descriptor.policy;
      let shouldBeOn = false;

      switch (policy?.type) {
        case "distance": {
          if (descriptor.position) {
            const dx = descriptor.position.x - player.x;
            const dy = descriptor.position.y - player.y;
            const dz = descriptor.position.z - player.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const maxRadius = policy.radius;
            shouldBeOn = distSq <= maxRadius * maxRadius;
          }
          break;
        }
        case "always":
          shouldBeOn = true;
          break;
        case "manual":
          shouldBeOn = instance.isEnabled();
          break;
        case "custom":
          shouldBeOn = policy.predicate(player);
          break;
        default:
          shouldBeOn = false;
      }

      if (shouldBeOn && !instance.isEnabled()) {
        void instance.enable();
      } else if (!shouldBeOn && instance.isEnabled()) {
        instance.disable();
      }
    }
  }

  /**
   * 모든 활성화된 패치를 음소거/중지
   */
  disableAll() {
    for (const { instance } of this.instances.values()) {
      instance.disable();
    }
  }

  /**
   * 전체 사운드스케이프 매니저 종료 및 파괴
   */
  destroy() {
    for (const { instance } of this.instances.values()) {
      instance.destroy();
    }
    this.instances.clear();
  }
}
