// 여러 Pd 패치를 3D 공간에 배치하고 하나의 마스터로 믹스하는 엔진.
//
//   패치 노드 → 게인(fade·음량) ─┬→ PannerNode(3D) → 점 게인 ──────────────┬→ 마스터 → 출력
//                                └→ 가운데 게인 ─(diffuse면 → 공유 확산 버스)─┘
//
// width(0~1): 0 = 패닝(방향), 1 = 방향 없이 좌우 모두 1. 영역 경계에 가까워질수록 커진다.
// - 기본(diffuse 꺼짐): 필터 없음. 가운데 경로는 같은 신호를 좌우에 그대로 보낸다(모노 → 좌우 1).
//   두 경로가 같은 신호라 진폭으로 더해지므로 직선으로 섞는다(점 = 1 − width, 가운데 = width).
// - diffuse 켜짐: 가운데 경로를 공유 확산 버스로 보낸다. 모노로 모은 뒤 왼쪽·오른쪽에 서로 다른
//   all-pass 필터 4개씩을 걸어 좌우를 다르게(비상관) 만든다. 서로 다른 신호라 equal-power로 섞는다
//   (점 = cos, 가운데 = sin). 필터가 소리를 바꿀 수 있어 기본은 끔.
//
// 패닝 기본값은 equalpower(가벼움, 앞뒤 구분 없음). HRTF는 옵션(panning: "HRTF").
//
// - 소스는 등록만으로는 아무 오디오 노드도 만들지 않는다. activate()할 때 패치를 로드한다.
// - 좌표는 3D 장면 좌표(미터)다. 타일 좌표 변환은 호출하는 쪽(게임 연결) 책임.
// - fade는 AudioParam 스케줄링으로만 한다(타이머 없음). fade-out이 끝난 노드는
//   해제 시각에 끝나도록 예약한 무음 ConstantSourceNode의 onended(오디오 시계 기준)에서 정리한다.
//   update()를 매 프레임 불러도 같은 정리를 한다(둘 중 먼저 오는 쪽).

export type Vec3 = { x: number; y: number; z: number };
export type PdMessage = (string | number)[];
export type SoundscapeSource = {
  id: string; patch: string; position: Vec3; gain?: number; width?: number;
  /** 패치로 보낼 메시지(수신 버스 이름 → 값). 값이 바뀔 때만 보낸다. 패치에 그 버스가 없으면 건너뛴다. */
  messages?: Record<string, PdMessage>;
};
export type SoundscapeEvent =
  | { type: "loading" | "active" | "releasing" | "released"; id: string; patch: string }
  | { type: "error"; id: string; patch: string; error: unknown };

/** 패치 하나를 시작해 연결되지 않은 노드를 돌려준다. 실제로는 webpd-runtime의 startPatch. */
export type PatchHandle = { node: AudioNode; destroy(): void; send?(bus: string, message: PdMessage): void };
type StartPatch = (context: BaseAudioContext, name: string) => Promise<PatchHandle>;

export type SoundscapeOptions = {
  context: BaseAudioContext;
  start: StartPatch;
  destination?: AudioNode;
  /** fade in/out 길이(초) */
  fade?: number;
  panning?: PanningModelType;
  /** width의 가운데 경로에 비상관(all-pass) 필터를 쓴다. 기본 false(필터 없음) */
  diffuse?: boolean;
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
  dry?: GainNode;
  wet?: GainNode;
  /** 버스별 마지막으로 보낸 값(같으면 다시 보내지 않음). 패치에 없는 버스는 null */
  sent?: Map<string, string | null>;
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

/** 확산 경로의 좌우 all-pass 주파수(Hz). 좌우가 달라야 위상이 서로 달라진다. */
const DIFFUSE_ALLPASS = [[190, 760, 2300, 6200], [330, 1150, 3600, 8800]];
/** 점·확산 섞는 비율이 바뀔 때의 시간 상수(초) */
const MIX_SMOOTHING = 0.08;

function createDiffuser(context: BaseAudioContext, output: AudioNode) {
  const input = context.createGain();
  input.channelCount = 1;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const merger = context.createChannelMerger(2);
  const nodes: AudioNode[] = [input, merger];
  DIFFUSE_ALLPASS.forEach((frequencies, channel) => {
    let last: AudioNode = input;
    for (const frequency of frequencies) {
      const allpass = context.createBiquadFilter();
      allpass.type = "allpass";
      allpass.frequency.value = frequency;
      allpass.Q.value = 0.5;
      last.connect(allpass);
      nodes.push(allpass);
      last = allpass;
    }
    last.connect(merger, 0, channel);
  });
  merger.connect(output);
  return { input, dispose: () => nodes.forEach((n) => n.disconnect()) };
}

export function createSoundscape(options: SoundscapeOptions) {
  const { context, start, fade = 0.4, panning = "equalpower", refDistance = 2, rolloff = 1, diffuse = false } = options;
  const emit = options.onEvent ?? (() => {});
  const master = context.createGain();
  master.connect(options.destination ?? context.destination);
  const sources = new Map<string, SoundscapeSource>();
  const voices = new Map<string, Voice>();
  let disposed = false;
  let diffuser: ReturnType<typeof createDiffuser> | undefined;

  /** 점·가운데 경로 비율. immediate면 바로(처음 연결할 때), 아니면 부드럽게. */
  const mix = (voice: Voice, immediate = false) => {
    if (!voice.dry || !voice.wet) return;
    const width = Math.min(1, Math.max(0, voice.source.width ?? 0));
    const dry = diffuse ? Math.cos(width * Math.PI / 2) : 1 - width;
    const wet = diffuse ? Math.sin(width * Math.PI / 2) : width;
    if (immediate) { voice.dry.gain.value = dry; voice.wet.gain.value = wet; return; }
    const now = context.currentTime;
    voice.dry.gain.setTargetAtTime(dry, now, MIX_SMOOTHING);
    voice.wet.gain.setTargetAtTime(wet, now, MIX_SMOOTHING);
  };

  /** 값이 바뀐 메시지만 패치로 보낸다. 패치에 없는 버스(send가 throw)는 기억해 두고 다시 보내지 않는다. */
  const deliver = (voice: Voice) => {
    const send = voice.patch?.send;
    if (!send || !voice.source.messages) return;
    voice.sent ??= new Map();
    for (const [bus, message] of Object.entries(voice.source.messages)) {
      const last = voice.sent.get(bus);
      const key = JSON.stringify(message);
      if (last === null || last === key) continue;
      try {
        send.call(voice.patch, bus, message);
        voice.sent.set(bus, key);
      } catch {
        voice.sent.set(bus, null);
      }
    }
  };

  const setPosition = (panner: PannerNode, position: Vec3) => placePanner(panner, position, context.currentTime);

  const release = (id: string, voice: Voice) => {
    voice.patch?.destroy();
    voice.gain?.disconnect();
    voice.panner?.disconnect();
    voice.dry?.disconnect();
    voice.wet?.disconnect();
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
      const dry = context.createGain();
      const wet = context.createGain();
      patch.node.connect(gain);
      gain.connect(panner).connect(dry).connect(master);
      if (diffuse) gain.connect(wet).connect((diffuser ??= createDiffuser(context, master)).input);
      else gain.connect(wet).connect(master);
      Object.assign(voice, { patch, gain, panner, dry, wet });
      mix(voice, true);
      deliver(voice);
      fadeIn(id, voice);
    } catch (error) {
      if (voices.get(id) === voice) voices.delete(id);
      emit({ type: "error", id, patch: voice.source.patch, error });
    }
  };

  function reap() {
    const now = context.currentTime;
    for (const [id, voice] of voices) {
      if (voice.state === "releasing" && voice.releaseAt !== undefined && now >= voice.releaseAt) release(id, voice);
    }
  }

  /** 오디오 시계로 time에 reap()이 불리게 한다. 값 0인 소스라 소리에는 영향이 없다. */
  function reapAt(time: number) {
    const clock = context.createConstantSource();
    clock.offset.value = 0;
    clock.connect(master); // 연결되지 않은 노드는 처리되지 않을 수 있다
    clock.onended = () => { clock.disconnect(); if (!disposed) reap(); };
    clock.start(context.currentTime);
    clock.stop(time);
  }

  function deactivate(id: string) {
    const voice = voices.get(id);
    if (!voice) return;
    if (voice.state === "loading") { voice.wanted = false; return; }
    if (voice.state === "releasing") return;
    voice.state = "releasing";
    const now = context.currentTime;
    voice.releaseAt = now + fade;
    ramp(voice.gain!.gain, 0, now, fade);
    reapAt(voice.releaseAt);
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
      mix(voice);
      deliver(voice);
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
    /** fade-out이 끝난 소스의 노드를 정리한다. 자동으로도 불리므로 선택 사항. */
    update: reap,
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
      diffuser?.dispose();
      master.disconnect();
    },
  };
}

export type Soundscape = ReturnType<typeof createSoundscape>;
