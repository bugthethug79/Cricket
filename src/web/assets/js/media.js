import { S } from './state.js';
import { toast } from './dom.js';
import { sendState } from './socket.js';
import { renderAll } from './ui.js';
import { addLocalTrack, removeLocalTrack } from './rtc.js';
import { watchSpeaking } from './speaking.js';

async function acquireMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const track = stream.getAudioTracks()[0];
  S.local.mic = track;
  S.local.micOn = true;
  S.local.main.addTrack(track);
  addLocalTrack(track, S.local.main);
  watchSpeaking('me', new MediaStream([track]));
}

async function acquireCam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  const track = stream.getVideoTracks()[0];
  track.onended = stopCam;
  S.local.cam = track;
  S.local.main.addTrack(track);
  addLocalTrack(track, S.local.main);
}

export async function toggleMic() {
  if (!S.local.mic) {
    try { await acquireMic(); } catch { toast('Microphone permission denied'); return; }
  } else {
    S.local.micOn = !S.local.micOn;
    S.local.mic.enabled = S.local.micOn;
  }
  sendState();
  renderAll();
}

function stopCam() {
  const track = S.local.cam;
  if (!track) return;
  S.local.cam = null;
  removeLocalTrack(track);
  S.local.main.removeTrack(track);
  track.stop();
  sendState();
  renderAll();
}

export async function toggleCam() {
  if (S.local.cam) return stopCam();
  try { await acquireCam(); } catch { toast('Camera unavailable'); return; }
  sendState();
  renderAll();
}

export async function toggleScreen() {
  if (S.local.screen) return stopScreen();
  if (!navigator.mediaDevices.getDisplayMedia) { toast('Screen sharing is not supported on this device'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
  } catch { return; }
  const video = stream.getVideoTracks()[0];
  if (video) {
    video.contentHint = 'detail';
    video.onended = stopScreen;
  }
  S.local.screen = stream;
  sendState();
  for (const track of stream.getTracks()) addLocalTrack(track, stream);
  renderAll();
}

function stopScreen() {
  const stream = S.local.screen;
  if (!stream) return;
  S.local.screen = null;
  for (const track of stream.getTracks()) {
    removeLocalTrack(track);
    track.stop();
  }
  sendState();
  renderAll();
}
