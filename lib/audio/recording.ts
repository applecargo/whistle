export const MAX_RECORDING_BYTES = 10_000_000;
export const MAX_RECORDING_SECONDS = 60;
export const MAX_SOUND_VOICES = 3;

export type Recording = {
  data: string;
  duration: number;
  radius?: number;
  volume: number;
  mode: "loop" | "approach";
};

const audioData = /^data:audio\/(mpeg|mp3|wav|x-wav|wave|ogg|webm|mp4|aac|flac|x-m4a);base64,([A-Za-z0-9+/]+={0,2})$/;
export function recordingBytes(data: string) {
  const payload = data.slice(data.indexOf(",") + 1);
  return payload.length * 3 / 4 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
}

export function validRecording(value: unknown): value is Recording {
  if (!value || typeof value !== "object") return false;
  const r = value as Recording;
  const bounded = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  return typeof r.data === "string" && r.data.length <= Math.ceil(MAX_RECORDING_BYTES / 3) * 4 + 64 &&
    audioData.test(r.data) && r.data.slice(r.data.indexOf(",") + 1).length % 4 === 0 &&
    recordingBytes(r.data) <= MAX_RECORDING_BYTES && bounded(r.duration, 0.01, MAX_RECORDING_SECONDS) &&
    (r.radius === undefined || bounded(r.radius, 1, 8)) && bounded(r.volume, 0, 1) && ["loop", "approach"].includes(r.mode);
}

export async function readRecording(file: File, signal?: AbortSignal): Promise<{ data: string; duration: number }> {
  if (!file.size) throw new Error("사운드 파일을 읽을 수 없습니다.");
  if (file.size > MAX_RECORDING_BYTES) throw new Error("파일 용량이 10MB를 초과했습니다.");
  const mime = ({ mp3: "mpeg", wav: "wav", ogg: "ogg", webm: "webm", m4a: "mp4", mp4: "mp4", aac: "aac", flac: "flac" } as Record<string, string>)[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime) throw new Error("지원하지 않는 사운드 형식입니다.");
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(signal?.reason);
    const timer = setTimeout(() => finish(new Error("사운드 파일을 읽을 수 없습니다.")), 10_000);
    signal?.addEventListener("abort", cancel, { once: true });
    audio.preload = "metadata";
    audio.onerror = () => finish(new Error("사운드를 재생할 수 없습니다."));
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration < 0.01)
        finish(new Error("사운드 파일을 읽을 수 없습니다."));
      else if (audio.duration > MAX_RECORDING_SECONDS)
        finish(new Error("사운드 길이가 1분을 초과했습니다."));
      else finish();
    };
    audio.src = url;
  });
  const { compressRecording } = await import("./compress-recording.ts");
  const result = await compressRecording(file, signal);
  const blob = result.originalChannels <= 2 && file.size < result.blob.size
    ? new Blob([file], { type: `audio/${mime}` }) : result.blob;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사운드 파일을 읽을 수 없습니다."));
    reader.readAsDataURL(blob);
  });
  signal?.throwIfAborted();
  return { data, duration: result.duration };
}
