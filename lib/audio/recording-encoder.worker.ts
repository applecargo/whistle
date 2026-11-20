import type * as Lame from "@breezystack/lamejs";

self.onmessage = async (event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const encoderUrl = `${import.meta.env.BASE_URL}audio-encoder/lamejs.js`;
    const { Mp3Encoder } = import.meta.env.DEV
      ? await import("@breezystack/lamejs")
      : await import(/* @vite-ignore */ encoderUrl) as typeof Lame;
    const { channels, sampleRate } = event.data;
    const encoder = new Mp3Encoder(channels.length, sampleRate, 128);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < channels[0].length; offset += 1152) {
      const pcm = channels.map(channel => Int16Array.from(channel.subarray(offset, offset + 1152), value => {
        const sample = Math.max(-1, Math.min(1, value));
        return Math.round(sample * (sample < 0 ? 32768 : 32767));
      }));
      const chunk = encoder.encodeBuffer(pcm[0], pcm[1]);
      if (chunk.length) chunks.push(new Uint8Array(chunk));
    }
    const last = encoder.flush();
    if (last.length) chunks.push(new Uint8Array(last));
    self.postMessage({ blob: new Blob(chunks, { type: "audio/mpeg" }) });
  } catch {
    self.postMessage({ error: true });
  }
};
