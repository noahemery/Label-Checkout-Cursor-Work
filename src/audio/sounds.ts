/**
 * Distinct audio cues generated with WebAudio (no asset files needed):
 *   success  — two ascending tones (verified)
 *   error    — low double buzz (mismatch / problem)
 *   blip     — short tick (scan accepted, still waiting on more)
 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.25,
) {
  const ac = audioCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ac.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playSuccess(): void {
  tone(880, 0, 0.12);
  tone(1320, 0.13, 0.22);
}

export function playError(): void {
  tone(196, 0, 0.22, 'sawtooth', 0.3);
  tone(165, 0.26, 0.32, 'sawtooth', 0.3);
}

export function playBlip(): void {
  tone(1200, 0, 0.06, 'square', 0.12);
}
