import type { SpatialSoundOptions, SoundInstance, PdFilterMode } from "./types.ts";

/**
 * 사운드 에셋 및 외부 음원(MP3/OGG/WAV) 공간 재생 관리자
 */
export class SoundAssetManager {
  private clips = new Map<string, AudioBuffer>();
  private activeVoices = new Set<SoundInstance>();
  private readonly maxActiveVoices = 6; // 모바일 HRTF 부하 방지를 위한 동시 보이스 제한

  /**
   * 외부 사운드 파일(ArrayBuffer, Blob, 또는 URL)을 디코딩하여 캐싱
   * Web Audio의 decodeAudioData를 사용하여 브라우저가 지원하는 모든 오디오 포맷(MP3, OGG, WAV, AAC 등) 디코딩
   */
  async loadClip(
    id: string,
    source: ArrayBuffer | Blob | string,
    context: AudioContext,
  ): Promise<AudioBuffer> {
    let arrayBuffer: ArrayBuffer;
    if (typeof source === "string") {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`사운드 파일을 불러오지 못했습니다: ${source}`);
      arrayBuffer = await response.arrayBuffer();
    } else if (source instanceof Blob) {
      arrayBuffer = await source.arrayBuffer();
    } else {
      arrayBuffer = source;
    }

    // decodeAudioData는 인수로 전달된 ArrayBuffer를 detach할 수 있으므로 slice로 복사본 사용
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    this.clips.set(id, audioBuffer);
    return audioBuffer;
  }

  hasClip(id: string): boolean {
    return this.clips.has(id);
  }

  getClip(id: string): AudioBuffer | undefined {
    return this.clips.get(id);
  }

  unloadClip(id: string) {
    this.clips.delete(id);
  }

  /**
   * 클립 재생 (3D 공간화 / 2D Equal Power Panning / Pd 필터 라우팅)
   */
  playSpatialClip(
    id: string,
    options: SpatialSoundOptions,
    context: AudioContext,
    masterNode: AudioNode,
    filterWorklet?: AudioNode,
  ): SoundInstance | null {
    const buffer = this.clips.get(id);
    if (!buffer) return null;

    // 모바일 보호를 위한 보이스 풀링 (초과 시 가장 오래된 음원 정리)
    if (this.activeVoices.size >= this.maxActiveVoices) {
      const oldest = this.activeVoices.values().next().value;
      if (oldest) oldest.stop();
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = !!options.loop;

    const gainNode = context.createGain();
    const volume = Math.max(0, Math.min(options.volume ?? 1.0, 1.0));
    gainNode.gain.setValueAtTime(volume, context.currentTime);

    // 필터 노드 체인 구성
    let currentOut: AudioNode = source;
    const filter = options.filter ?? "bypass";

    let biquadFilter: BiquadFilterNode | undefined;
    if (filter !== "bypass") {
      if (filterWorklet) {
        // Pd 제작 필터 WASM(adc~)이 연결된 경우
        source.connect(filterWorklet);
        currentOut = filterWorklet;
      } else {
        // Pd 필터가 로드되기 전이거나 폴백 프리셋용 BiquadFilterNode
        biquadFilter = context.createBiquadFilter();
        if (filter === "underwater") {
          biquadFilter.type = "lowpass";
          biquadFilter.frequency.setValueAtTime(450, context.currentTime);
          biquadFilter.Q.setValueAtTime(2.0, context.currentTime);
        } else if (filter === "radio") {
          biquadFilter.type = "bandpass";
          biquadFilter.frequency.setValueAtTime(1800, context.currentTime);
          biquadFilter.Q.setValueAtTime(1.5, context.currentTime);
        } else {
          biquadFilter.type = "lowpass";
          biquadFilter.frequency.setValueAtTime(1200, context.currentTime);
        }
        source.connect(biquadFilter);
        currentOut = biquadFilter;
      }
    }

    currentOut.connect(gainNode);

    // 공간화 노드 체인 구성
    let spatialNode: AudioNode = gainNode;
    let panner3d: PannerNode | undefined;
    let stereoPanner: StereoPannerNode | undefined;

    if (options.position) {
      // 3D 위치 기반 (상공, 지상 오브젝트 지원)
      panner3d = new PannerNode(context, {
        panningModel: options.panningModel ?? "HRTF",
        distanceModel: "inverse",
        refDistance: 1,
        maxDistance: 80,
        rolloffFactor: 1.2,
        positionX: options.position[0],
        positionY: options.position[1],
        positionZ: options.position[2],
      });
      gainNode.connect(panner3d);
      spatialNode = panner3d;
    } else if (options.pan !== undefined) {
      // 2D Equal Power Panning (StereoPannerNode는 W3C 표준 equal-power curve 적용)
      const clampedPan = Math.max(-1, Math.min(1, options.pan));
      stereoPanner = new StereoPannerNode(context, { pan: clampedPan });
      gainNode.connect(stereoPanner);
      spatialNode = stereoPanner;
    }

    spatialNode.connect(masterNode);

    let stopped = false;
    const instance: SoundInstance = {
      id,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try { source.stop(); } catch {}
        try { source.disconnect(); } catch {}
        try { gainNode.disconnect(); } catch {}
        try { panner3d?.disconnect(); } catch {}
        try { stereoPanner?.disconnect(); } catch {}
        this.activeVoices.delete(instance);
      },
      setVolume: (v: number) => {
        if (stopped) return;
        const target = Math.max(0, Math.min(v, 1.0));
        gainNode.gain.setValueAtTime(target, context.currentTime);
      },
      setPosition: (pos: [number, number, number]) => {
        if (stopped || !panner3d) return;
        const now = context.currentTime;
        if (panner3d.positionX) {
          panner3d.positionX.setValueAtTime(pos[0], now);
          panner3d.positionY.setValueAtTime(pos[1], now);
          panner3d.positionZ.setValueAtTime(pos[2], now);
        } else {
          panner3d.setPosition(pos[0], pos[1], pos[2]);
        }
      },
      setPan: (p: number) => {
        if (stopped || !stereoPanner) return;
        stereoPanner.pan.setValueAtTime(Math.max(-1, Math.min(1, p)), context.currentTime);
      },
      setFilter: (f: PdFilterMode) => {
        if (stopped || !biquadFilter) return;
        if (f === "underwater") {
          biquadFilter.type = "lowpass";
          biquadFilter.frequency.setValueAtTime(450, context.currentTime);
        } else if (f === "radio") {
          biquadFilter.type = "bandpass";
          biquadFilter.frequency.setValueAtTime(1800, context.currentTime);
        } else {
          biquadFilter.type = "allpass";
        }
      },
    };

    source.onended = () => {
      instance.stop();
    };

    this.activeVoices.add(instance);
    source.start();
    return instance;
  }

  stopAll() {
    for (const voice of Array.from(this.activeVoices)) {
      voice.stop();
    }
    this.activeVoices.clear();
  }
}

export const soundAssetManager = new SoundAssetManager();
