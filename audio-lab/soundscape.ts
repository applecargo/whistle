import { loadManifest, startPatch, type PatchInstance } from "../lib/audio/webpd-runtime";

const base = `${import.meta.env.BASE_URL}audio-test/`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $<HTMLButtonElement>("start");
const stop = $<HTMLButtonElement>("stop");
const status = $<HTMLParagraphElement>("status");
const controls = $<HTMLFieldSetElement>("controls");
const select = $<HTMLSelectElement>("patch");
const pan = $<HTMLInputElement>("pan");
const add = $<HTMLButtonElement>("add");
const list = $<HTMLTableSectionElement>("voices");
const meter = $<HTMLOutputElement>("meter");
const logBox = $<HTMLPreElement>("log");

type Voice = { id: number; patch: PatchInstance; panner: StereoPannerNode };
let context: AudioContext | undefined;
let master: GainNode | undefined;
let analysers: [AnalyserNode, AnalyserNode] | undefined;
// terrain_clock처럼 간헐적인 소리도 읽을 수 있게 채널별 최근 1초 최대값을 유지한다.
const hold = [{ peak: 0, at: 0 }, { peak: 0, at: 0 }];
let voices: Voice[] = [];
let nextId = 1;
let frame = 0;

function log(message: string) {
  console.log(`[soundscape-lab] ${message}`);
  logBox.textContent = `${new Date().toLocaleTimeString()} ${message}\n${logBox.textContent}`;
}

function render() {
  status.textContent = context
    ? `AudioContext ${context.state} · ${context.sampleRate}Hz · 실행 중인 패치 ${voices.length}개`
    : "시작 전";
  list.replaceChildren(...voices.map((voice) => {
    const row = document.createElement("tr");
    for (const text of [String(voice.id), voice.patch.name, voice.panner.pan.value.toFixed(1)]) {
      row.insertCell().textContent = text;
    }
    const remove = document.createElement("button");
    remove.textContent = "제거";
    remove.onclick = () => removeVoice(voice.id);
    row.insertCell().append(remove);
    return row;
  }));
}

function measure() {
  if (!analysers) return;
  const now = performance.now();
  const parts = analysers.map((analyser, channel) => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    const held = hold[channel];
    if (peak >= held.peak || now - held.at > 1000) { held.peak = peak; held.at = now; }
    return `${channel ? "R" : "L"} ${held.peak.toFixed(4)}`;
  });
  meter.textContent = parts.join(" · ");
  frame = requestAnimationFrame(measure);
}

async function addVoice() {
  if (!context || !master) return;
  const name = select.value;
  const id = nextId++;
  add.disabled = true;
  try {
    const started = performance.now();
    const patch = await startPatch(context, base, name, (bus, message) => log(`#${id} ${bus}: ${message.join(" ")}`));
    const panner = new StereoPannerNode(context, { pan: Number(pan.value) });
    patch.node.connect(panner).connect(master);
    voices.push({ id, patch, panner });
    log(`#${id} ${name} 시작 (pan ${pan.value}, ${Math.round(performance.now() - started)}ms)`);
  } catch (error) {
    log(`#${id} ${name} 실패: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    add.disabled = false;
    render();
  }
}

function removeVoice(id: number) {
  const voice = voices.find((v) => v.id === id);
  if (!voice) return;
  voice.patch.destroy();
  voice.panner.disconnect();
  voices = voices.filter((v) => v !== voice);
  log(`#${id} ${voice.patch.name} 제거`);
  render();
}

start.onclick = async () => {
  start.disabled = true;
  try {
    context = new AudioContext();
    await context.resume();
    master = new GainNode(context, { gain: 0.8 });
    master.connect(context.destination);
    const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
    analysers = [new AnalyserNode(context, { fftSize: 2048 }), new AnalyserNode(context, { fftSize: 2048 })];
    master.connect(splitter);
    splitter.connect(analysers[0], 0);
    splitter.connect(analysers[1], 1);
    const manifest = await loadManifest(base);
    select.replaceChildren(...Object.keys(manifest.patches).map((name) => new Option(name, name)));
    controls.disabled = false;
    stop.disabled = false;
    log(`시작: 패치 ${Object.keys(manifest.patches).length}종 (${Object.keys(manifest.patches).join(", ")})`);
    measure();
  } catch (error) {
    log(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
    start.disabled = false;
  }
  render();
};

stop.onclick = async () => {
  cancelAnimationFrame(frame);
  for (const voice of voices) voice.patch.destroy();
  voices = [];
  await context?.close();
  context = master = analysers = undefined;
  controls.disabled = true;
  stop.disabled = true;
  start.disabled = false;
  meter.textContent = "—";
  log("종료");
  render();
};

add.onclick = addVoice;
