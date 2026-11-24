// 배치한 소리(업로드한 mp3 등)를 Pd로 재생한다.
// - 원본은 지금처럼 맵 데이터 안의 mp3다(새로고침·내보내기와 함께 남는다). 엔진 디스크의 wav는 Pd가 읽을 임시 사본이다.
// - 소리마다 한 번: 브라우저가 풀고(decodeAudioData, 엔진과 같은 샘플레이트) 16비트 wav(모노는 모노, 스테레오는 스테레오)로
//   엔진 디스크에 쓰고, whistle-sound-bank로 "<이름> <경로>"를 보낸다. main.pd 안의 [pd sound_bank]가 [pd sounds]에
//   <이름>-L, <이름>-R 배열을 만들고 한 번 읽는다. 영역을 나갔다 들어와도 다시 읽지 않는다. 다른 필터도 같은 배열을 쓸 수 있다.
// - 재생 하나 = 슬롯 하나(placed_sound.pd): "set <이름>-L <이름>-R"(모노면 -L만)을 보낸다. 어떻게 재생할지는 패치가 정한다
//   (지금은 array_player~로, 가까우면 느리게 멀면 빠르게. paulstretch~ 버전은 placed_sound_paulstretch_example.pd).
// - wav 파일은 페이지가 살아 있는 동안 둔다(main.pd를 다시 열면 [pd sound_bank]가 다시 읽는다).
import type { PdEngine, PdMessage } from "./pd-runtime.ts";
import type { Recording } from "./recording.ts";

/**
 * 업로드한 소리가 엔진 메모리에서 쓸 수 있는 양(바이트). 엔진은 256MB로 고정이고(scripts/build-audio-engine.mjs),
 * 넘치면 엔진이 죽는다(OOM). 소리 하나 = wav 사본(16비트) + Pd 배열(32비트) = 샘플당 6바이트. 1분 스테레오 약 35MB.
 * 시험: 1분 스테레오 7개까지 됐고 8개째에 OOM. 넉넉히 남긴다. 넘치는 소리는 풀지 않는다(재생되지 않는다).
 */
export const SOUND_MEMORY = 200_000_000;

/** 배치한 소리를 재생하는 슬롯 패치(audio/patches/placed_sound.pd) */
export const PLACED_PATCH = "placed_sound";
export type PlacedVoice = {
  /** 슬롯 이름(v17…) */ id: string;
  node: AudioNode;
  /** 소리를 끝까지 한 번 다 재생했을 때(placed_sound.pd가 [s $1-whistle-sound-end]로 알린다. 패치가 늘리거나 빠르게 해도 맞다) */
  onEnd(listener: () => void): void;
  /** 패치에 보낸다(placed_sound.pd의 [r $1-whistle-sound]: distance <타일> <반경>) */
  send(message: PdMessage): void;
  destroy(): void;
};
export type PlaySound = {
  /** 소리를 미리 풀어 main.pd의 [pd sound_bank]에 읽어 둔다(같은 소리는 한 번만) */
  prepare(recording: Recording): Promise<unknown>;
  play(recording: Recording): Promise<PlacedVoice>;
};

/** 16비트 PCM wav. 채널은 1개 또는 2개 */
export function wavFile(channels: Float32Array[], sampleRate: number) {
  const count = channels.length, length = channels[0]?.length ?? 0, size = length * count * 2;
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + size, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, size, true);
  // 샘플을 Int16Array에 바로 쓴다(DataView로 하나씩 쓰면 1분 스테레오에 0.5초 넘게 걸린다). wav는 리틀엔디언, 브라우저도 리틀엔디언.
  const samples = new Int16Array(bytes.buffer, 44, length * count);
  for (let c = 0; c < count; c++) {
    const channel = channels[c];
    for (let i = 0, k = c; i < length; i++, k += count) {
      const v = channel[i];
      samples[k] = Math.round((v > 1 ? 1 : v < -1 ? -1 : v) * 32767);
    }
  }
  return bytes;
}

export function createPdSounds(engine: Pick<PdEngine, "context" | "start" | "send" | "writeFile">): PlaySound {
  const sounds = new Map<string, Promise<{ name: string; stereo: boolean }>>();
  let count = 0, used = 0;
  // 한 번에 하나씩 푼다(여러 개를 한꺼번에 풀면 그동안 페이지가 멈춘다).
  let queue: Promise<unknown> = Promise.resolve();
  const prepare = (recording: Recording) => {
    let sound = sounds.get(recording.data);
    if (!sound) {
      const data = recording.data;
      sound = queue.then(async () => {
        // base64를 브라우저 내장으로 바이트로 바꾼다(atob 뒤 글자마다 바꾸거나 data: URL을 fetch하면 페이지가 멈춘다).
        const bytes = (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(data.slice(data.indexOf(",") + 1));
        const buffer = await engine.context.decodeAudioData(bytes.buffer as ArrayBuffer);
        const name = `sound${++count}`, path = `uploads/${name}.wav`;
        const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
        const size = buffer.length * channels.length * 6;
        if (used + size > SOUND_MEMORY) throw new Error(`엔진 메모리가 모자라 이 소리는 재생하지 않습니다(${Math.round(size / 1e6)}MB, 남은 ${Math.round((SOUND_MEMORY - used) / 1e6)}MB).`);
        used += size;
        engine.writeFile(path, wavFile(channels, buffer.sampleRate));
        engine.send("whistle-sound-bank", [name, `/${path}`]);
        return { name, stereo: channels.length === 2 };
      });
      queue = sound.catch(() => {});
      // 풀지 못한 소리도 그대로 둔다(지우면 매 프레임 다시 풀려고 한다).
      sound.catch((error) => console.warn("[sounds] 소리를 풀지 못했습니다", error));
      sounds.set(data, sound);
    }
    return sound;
  };
  return {
    prepare,
    async play(recording) {
      const { name, stereo } = await prepare(recording);
      const voice = await engine.start(PLACED_PATCH);
      voice.send("whistle-sound", stereo ? ["set", `${name}-L`, `${name}-R`] : ["set", `${name}-L`]);
      return { id: voice.id, node: voice.node, onEnd: (listener) => voice.onBang("whistle-sound-end", listener),
        send: (message) => voice.send("whistle-sound", message), destroy: voice.destroy };
    },
  };
}
