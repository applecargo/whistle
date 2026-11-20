// 여러 Pd 패치를 3D 공간에 배치하고 하나의 마스터로 믹스하는 엔진.
//
//   패치 노드 → 게인(fade) → PannerNode(3D) → 마스터 → 출력
//
// 패닝 기본값은 equalpower(가벼움, 앞뒤 구분 없음). HRTF는 옵션(panning: "HRTF").
//
// - 소스는 등록만으로는 아무 오디오 노드도 만들지 않는다. activate()할 때 패치를 로드한다.
// - 좌표는 3D 장면 좌표(미터)다. 타일 좌표 변환은 호출하는 쪽(게임 연결) 책임.
// - fade는 AudioParam 스케줄링으로만 한다(타이머 없음). fade-out이 끝난 노드는
//   update()에서 오디오 시계(currentTime)가 해제 시각을 지났을 때 정리한다.

export type Vec3 = { x: number; y: number; z: number };
export type SoundscapeSource = { id: string; patch: string; position: Vec3; gain?: number };
export type SoundscapeEvent =
  | { type: "loading" | "active" | "releasing" | "released"; id: string; patch: string }
  | { type: "error"; id: string; patch: string; error: unknown };

/** 패치 하나를 시작해 연결되지 않은 노드를 돌려준다. 실제로는 webpd-runtime의 startPatch. */
export type PatchHandle = { node: AudioNode; destroy(): void };
type StartPatch = (context: BaseAudioContext, name: string) => Promise<PatchHandle>;

export type SoundscapeOptions = {
  context: BaseAudioContext;
  start: StartPatch;
  destination?: AudioNode;
  /** fade in/out 길이(초) */
  fade?: number;
  panning?: PanningModelType;
  /** 이 거리(m)까지는 감쇠 없음 */
  refDistance?: number;
  rolloff?: number;
  onEvent?: (event: SoundscapeEvent) => void;
};

type Voice = {
  source: SoundscapeSource;
  state: "loading" | "active" | "releasing";
  /** loading 중에 deactivate되면 false */
  wanted: boolean;
  patch?: PatchHandle;
  gain?: GainNode;
  panner?: PannerNode;
  releaseAt?: number;
};

/** 현재 값을 고정하고 target까지 직선으로 바꾼다. Firefox에는 cancelAndHoldAtTime이 없다. */
function ramp(param: AudioParam, target: number, now: number, duration: number) {
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + duration);
}

// Firefox는 AudioListener의 position*/forward*/up* AudioParam을 지원하지 않고
// 예전 방식인 setPosition()/setOrientation()만 있다. PannerNode도 같은 방식으로 대비한다.
type LegacyListener = { setPosition(x: number, y: number, z: number): void; setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void };
type LegacyPanner = { setPosition(x: number, y: number, z: number): void };

function placePanner(panner: PannerNode, { x, y, z }: Vec3, now: number) {
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, now);
    panner.positionY.setValueAtTime(y, now);
    panner.positionZ.setValueAtTime(z, now);
  } else {
    (panner as unknown as LegacyPanner).setPosition(x, y, z);
  }
}

function placeListener(listener: AudioListener, position: Vec3, forward: Vec3, now: number) {
  if (listener.positionX) {
    listener.positionX.setValueAtTime(position.x, now);
    listener.positionY.setValueAtTime(position.y, now);
    listener.positionZ.setValueAtTime(position.z, now);
    listener.forwardX.setValueAtTime(forward.x, now);
    listener.forwardY.setValueAtTime(forward.y, now);
    listener.forwardZ.setValueAtTime(forward.z, now);
    listener.upX.setValueAtTime(0, now);
    listener.upY.setValueAtTime(1, now);
    listener.upZ.setValueAtTime(0, now);
  } else {
    const legacy = listener as unknown as LegacyListener;
    legacy.setPosition(position.x, position.y, position.z);
    legacy.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
  }
}

export function createSoundscape(options: SoundscapeOptions) {
  const { context, start, fade = 0.4, panning = "equalpower", refDistance = 2, rolloff = 1 } = options;
  const emit = options.onEvent ?? (() => {});
  const master = context.createGain();
  master.connect(options.destination ?? context.destination);
  const sources = new Map<string, SoundscapeSource>();
  const voices = new Map<string, Voice>();
  let disposed = false;

  const setPosition = (panner: PannerNode, position: Vec3) => placePanner(panner, position, context.currentTime);

  const release = (id: string, voice: Voice) => {
    voice.patch?.destroy();
    voice.gain?.disconnect();
    voice.panner?.disconnect();
    voices.delete(id);
    emit({ type: "released", id, patch: voice.source.patch });
  };

  const fadeIn = (id: string, voice: Voice) => {
    voice.state = "active";
    voice.releaseAt = undefined;
    ramp(voice.gain!.gain, voice.source.gain ?? 1, context.currentTime, fade);
    emit({ type: "active", id, patch: voice.source.patch });
  };

  const load = async (id: string, voice: Voice) => {
    try {
      const patch = await start(context, voice.source.patch);
      if (disposed || !voice.wanted || voices.get(id) !== voice) {
        voice.patch = patch;
        release(id, voice);
        return;
      }
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createPanner();
      panner.panningModel = panning;
      panner.distanceModel = "inverse";
      panner.refDistance = refDistance;
      panner.rolloffFactor = rolloff;
      setPosition(panner, voice.source.position);
      patch.node.connect(gain).connect(panner).connect(master);
      Object.assign(voice, { patch, gain, panner });
      fadeIn(id, voice);
    } catch (error) {
      if (voices.get(id) === voice) voices.delete(id);
      emit({ type: "error", id, patch: voice.source.patch, error });
    }
  };

  function deactivate(id: string) {
    const voice = voices.get(id);
    if (!voice) return;
    if (voice.state === "loading") { voice.wanted = false; return; }
    if (voice.state === "releasing") return;
    voice.state = "releasing";
    const now = context.currentTime;
    voice.releaseAt = now + fade;
    ramp(voice.gain!.gain, 0, now, fade);
    emit({ type: "releasing", id, patch: voice.source.patch });
  }

  return {
    master,
    /** 소스를 등록하거나 위치·패치를 갱신한다. 패치가 바뀌면 다음 activate 때 새로 로드한다. */
    set(source: SoundscapeSource) {
      const previous = sources.get(source.id);
      sources.set(source.id, source);
      const voice = voices.get(source.id);
      if (!voice) return;
      if (previous && previous.patch !== source.patch) {
        deactivate(source.id);
        return;
      }
      voice.source = source;
      if (voice.panner) setPosition(voice.panner, source.position);
      if (voice.gain && voice.state === "active") ramp(voice.gain.gain, source.gain ?? 1, context.currentTime, fade);
    },
    remove(id: string) {
      deactivate(id);
      sources.delete(id);
    },
    activate(id: string) {
      if (disposed) return;
      const source = sources.get(id);
      if (!source) throw new Error(`등록되지 않은 사운드스케이프 소스: ${id}`);
      const voice = voices.get(id);
      if (voice?.state === "active") return;
      if (voice?.state === "loading") { voice.wanted = true; return; }
      if (voice?.state === "releasing") {
        if (voice.source.patch === source.patch) { fadeIn(id, voice); return; }
        release(id, voice);
      }
      const created: Voice = { source, state: "loading", wanted: true };
      voices.set(id, created);
      emit({ type: "loading", id, patch: source.patch });
      void load(id, created);
    },
    deactivate,
    /** 리스너(플레이어 귀) 위치와 바라보는 방향. forward는 정규화하지 않아도 된다. */
    setListener(position: Vec3, forward: Vec3) {
      placeListener(context.listener, position, forward, context.currentTime);
    },
    /** 매 프레임 호출. fade-out이 끝난 소스의 노드를 정리한다. */
    update() {
      const now = context.currentTime;
      for (const [id, voice] of voices) {
        if (voice.state === "releasing" && voice.releaseAt !== undefined && now >= voice.releaseAt) release(id, voice);
      }
    },
    /** 디버깅·테스트용 현재 상태 */
    snapshot() {
      return {
        sources: sources.size,
        voices: [...voices].map(([id, v]) => ({ id, patch: v.source.patch, state: v.state })),
      };
    },
    dispose() {
      disposed = true;
      for (const [id, voice] of voices) {
        if (voice.state === "loading") voice.wanted = false;
        else release(id, voice);
      }
      master.disconnect();
    },
  };
}

export type Soundscape = ReturnType<typeof createSoundscape>;
