import type { Player } from "../world.ts";

export function whistleSpatial(source: { x: number; z: number }, listener: Player) {
  const dx = source.x - listener.x, dz = source.z - listener.z;
  const distance = Math.hypot(dx, dz);
  return { gain: .16 / (1 + distance * .45), pan: distance < .01 ? 0 : Math.sin(Math.atan2(dx, -dz) - listener.yaw) };
}

export function createMeetingWhistle(context: AudioContext, listener: () => Player) {
  const voices = new Set<{ oscillator: OscillatorNode; vibrato: OscillatorNode; gain: GainNode; pan: StereoPannerNode;
    envelope: GainNode; depth: GainNode; source: () => {x: number; z: number} }>();
  const update = () => {
    for (const voice of voices) {
      const spatial = whistleSpatial(voice.source(), listener());
      voice.gain.gain.setTargetAtTime(spatial.gain, context.currentTime, .02);
      voice.pan.pan.setTargetAtTime(spatial.pan, context.currentTime, .02);
    }
  };
  const play = (source: () => { x: number; z: number }) => {
    if (context.state !== "running" || voices.size >= 3) return;
    const oscillator = context.createOscillator(), vibrato = context.createOscillator();
    const envelope = context.createGain(), gain = context.createGain(), depth = context.createGain(), pan = context.createStereoPanner();
    const now = context.currentTime;
    const voice = { oscillator, vibrato, gain, pan, envelope, depth, source };
    const dispose = () => {
      voices.delete(voice);
      for (const node of [oscillator, vibrato, gain, pan, envelope, depth]) node.disconnect();
    };
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1450, now);
    oscillator.frequency.exponentialRampToValueAtTime(1850, now + .08);
    oscillator.frequency.exponentialRampToValueAtTime(1650, now + .32);
    vibrato.frequency.value = 7; depth.gain.value = 16;
    vibrato.connect(depth); depth.connect(oscillator.frequency);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + .025);
    envelope.gain.setValueAtTime(.85, now + .18);
    envelope.gain.linearRampToValueAtTime(0, now + .34);
    oscillator.connect(envelope); envelope.connect(gain); gain.connect(pan); pan.connect(context.destination);
    voices.add(voice); update();
    oscillator.onended = dispose;
    oscillator.start(now); vibrato.start(now);
    oscillator.stop(now + .36); vibrato.stop(now + .36);
  };
  const stop = () => {
    for (const voice of voices) {
      voice.oscillator.stop(); voice.vibrato.stop();
      voice.envelope.gain.cancelScheduledValues(context.currentTime);
      voice.envelope.gain.setValueAtTime(0, context.currentTime);
    }
  };
  return { play, update, stop };
}
