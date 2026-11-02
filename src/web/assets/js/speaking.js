import { S } from './state.js';

const meters = new Map();
const speech = new Map();

export function watchSpeaking(peerId, stream) {
  if (!S.audioCtx) return;
  const key = peerId + ':' + stream.id;
  if (meters.has(key)) return;
  try {
    const source = S.audioCtx.createMediaStreamSource(stream);
    const analyser = S.audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    meters.set(key, { peerId, source, analyser, buffer: new Uint8Array(analyser.fftSize) });
  } catch { }
}

export function tickMeters() {
  const now = performance.now();
  const levels = new Map();
  for (const meter of meters.values()) {
    meter.analyser.getByteTimeDomainData(meter.buffer);
    let sum = 0;
    for (const value of meter.buffer) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / meter.buffer.length);
    levels.set(meter.peerId, Math.max(levels.get(meter.peerId) || 0, rms));
  }
  for (const [id, value] of levels) {
    const state = speech.get(id) || { avg: 0, until: 0 };
    state.avg += (value - state.avg) * 0.35;
    if (value > 0.018 || state.avg > 0.025) state.until = now + 650;
    speech.set(id, state);
  }
}

export function isSpeaking(id) {
  const state = speech.get(id);
  return !!state && performance.now() < state.until;
}

export function removeSpeaking(peerId) {
  for (const [key, meter] of meters) {
    if (meter.peerId !== peerId) continue;
    meter.source.disconnect();
    meters.delete(key);
  }
  speech.delete(peerId);
}
