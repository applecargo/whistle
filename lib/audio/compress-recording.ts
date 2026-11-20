export async function compressRecording(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const decoder = new OfflineAudioContext(2, 1, 44100);
  let buffer: AudioBuffer;
  try { buffer = await decoder.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error("사운드를 재생할 수 없습니다."); }
  signal?.throwIfAborted();
  if (!Number.isFinite(buffer.duration) || buffer.duration < 0.01)
    throw new Error("사운드 파일을 읽을 수 없습니다.");
  if (buffer.duration > 60) throw new Error("사운드 길이가 1분을 초과했습니다.");
  const originalChannels = buffer.numberOfChannels;
  if (originalChannels > 2) {
    const mixer = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
    const source = mixer.createBufferSource();
    source.buffer = buffer; source.connect(mixer.destination); source.start();
    buffer = await mixer.startRendering();
    signal?.throwIfAborted();
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
  const blob = await new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL("./recording-encoder.worker.ts", import.meta.url), { type: "module" });
    const finish = (blob?: Blob, error?: unknown) => {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel); worker.terminate();
      if (blob?.size) resolve(blob);
      else reject(error ?? new Error("사운드를 압축할 수 없습니다."));
    };
    const cancel = () => finish(undefined, signal?.reason);
    const timer = setTimeout(() => finish(), 120_000);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob }>) => finish(event.data.blob);
    worker.onerror = () => finish();
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
  });
  signal?.throwIfAborted();
  return { blob, duration: buffer.duration, originalChannels };
}
