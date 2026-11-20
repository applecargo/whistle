import { createPdSession, type PdSession } from "../lib/audio/webpd-session";
import { soundAssetManager } from "../lib/audio/sound-assets";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = element<HTMLButtonElement>("start");
const stop = element<HTMLButtonElement>("stop");
const mute = element<HTMLButtonElement>("mute");
const status = element("status");
const meter = element("meter");
const messages = element("messages");
const number = (id: string) => element<HTMLInputElement>(id).valueAsNumber;
let session: PdSession | undefined;
let muted = false;
let frame = 0;
let disconnectMeter = () => {};
const received: Record<string, (string | number)[]> = {};

function enable(enabled: boolean) {
  stop.disabled = mute.disabled = !enabled;
  element<HTMLFieldSetElement>("edit-controls").disabled = !enabled;
  element<HTMLFieldSetElement>("player-controls").disabled = !enabled;
  element<HTMLFieldSetElement>("spatial-controls").disabled = !enabled;
}

function measure(current: PdSession) {
  const splitter = current.context.createChannelSplitter(2);
  const analysers = [0, 1].map((channel) => {
    const analyser = current.context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel);
    return analyser;
  });
  current.node.connect(splitter);
  const wave = new Float32Array(4096);
  const spectrum = new Float32Array(2048);
  const update = () => {
    const levels = analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(wave);
      const rms = Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length);
      analyser.getFloatFrequencyData(spectrum);
      let peak = 0;
      for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
      return { rms, hz: peak * current.context.sampleRate / analyser.fftSize };
    });
    meter.textContent = levels.map((v, i) => `${i ? "R" : "L"} ${v.rms.toFixed(4)} / ${v.hz.toFixed(0)} Hz`).join(" · ");
    meter.dataset.levels = JSON.stringify(levels);
    frame = requestAnimationFrame(update);
  };
  update();
  disconnectMeter = () => {
    cancelAnimationFrame(frame);
    splitter.disconnect();
    analysers.forEach((analyser) => analyser.disconnect());
  };
}

start.onclick = async () => {
  start.disabled = true;
  status.textContent = "패치 준비 중";
  try {
    session = await createPdSession(`${import.meta.env.BASE_URL}audio-test/`, (bus, message) => {
      received[bus] = message;
      messages.textContent = JSON.stringify(received, null, 2);
    });
    muted = false;
    session.mute(false);
    mute.textContent = "음소거";
    measure(session);
    enable(true);
    status.textContent = "실행 중";
  } catch (error) {
    status.textContent = "오디오를 시작할 수 없습니다.";
    start.disabled = false;
  }
};

stop.onclick = async () => {
  enable(false);
  disconnectMeter();
  await session?.close();
  session = undefined;
  meter.textContent = "—";
  delete meter.dataset.levels;
  status.textContent = "종료됨";
  start.disabled = false;
};
mute.onclick = () => {
  muted = !muted;
  session?.mute(muted);
  mute.textContent = muted ? "음소거 해제" : "음소거";
};
const act = (action: () => void) => {
  try { action(); } catch (error) {
    status.textContent = "입력값이 올바르지 않습니다.";
  }
};
element("edit").onclick = () => act(() => session?.edit({
  x: number("edit-x"), z: number("edit-z"), overlap: number("overlap"),
}));
element("player").onclick = () => act(() => session?.player({
  x: number("player-x"), y: number("player-y"), z: number("player-z"),
  grass: number("grass"), rough: number("rough"),
}));
element<HTMLInputElement>("audio-file").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !session) return;
  try {
    status.textContent = `사운드 로드 중: ${file.name}`;
    await soundAssetManager.loadClip("uploaded-test", file, session.context);
    status.textContent = `사운드 준비 완료: ${file.name} (${file.type || "audio"})`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "사운드 파일 로드 실패";
  }
};
element("spatial-play").onclick = async () => act(async () => {
  if (!session) return;
  // 파일이 없으면 테스트용 톤 버퍼 즉석 생성
  if (!soundAssetManager.hasClip("uploaded-test")) {
    const buffer = session.context.createBuffer(1, session.context.sampleRate * 0.5, session.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin(i * 0.05) * Math.exp(-i / (session.context.sampleRate * 0.1));
    }
    const fakeSource = new ArrayBuffer(0);
    // Directly cache synthetic test tone
    (soundAssetManager as unknown as { clips: Map<string, AudioBuffer> }).clips?.set("uploaded-test", buffer);
  }
  const pan = number("spatial-pan");
  const filter = element<HTMLSelectElement>("spatial-filter").value;
  soundAssetManager.playSpatialClip("uploaded-test", {
    pan,
    filter,
    volume: 0.8,
  }, session.context, session.masterGain);
  status.textContent = `외부 사운드 재생 (Pan: ${pan}, Filter: ${filter})`;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && session) {
    muted = true;
    session.mute(true);
    mute.textContent = "음소거 해제";
  }
});
window.addEventListener("pagehide", () => {
  disconnectMeter();
  void session?.close();
});
