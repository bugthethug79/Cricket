import { S } from './state.js';
import { toast } from './dom.js';
import { sendState } from './socket.js';
import { renderAll } from './ui.js';
import { addLocalTrack, removeLocalTrack, replaceLocalTrack } from './rtc.js';
import { watchSpeaking } from './speaking.js';

const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

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

async function refreshCameras() {
  try {
    S.cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  } catch {
    S.cameras = [];
  }
  renderAll();
}

async function acquireCam() {
  const video = S.local.camId
    ? { deviceId: { exact: S.local.camId }, ...videoConstraints }
    : { facingMode: { ideal: S.local.facing }, ...videoConstraints };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video });
  } catch (err) {
    if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError') throw err;
    S.local.camId = '';
    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
  }
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('No video track');
  track.onended = stopCam;
  S.local.cam = track;
  S.local.main.addTrack(track);
  addLocalTrack(track, S.local.main);
  S.local.camId = track.getSettings().deviceId || S.local.camId;
  S.local.facing = track.getSettings().facingMode || S.local.facing;
  await refreshCameras();
}

export async function toggleMic() {
  if (S.local.hostMuted) {
    toast('The host muted you.');
    return;
  }
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

export async function flipCam() {
  const oldTrack = S.local.cam;
  if (!oldTrack) return;
  const cameras = S.cameras.filter((device) => device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications');
  const index = cameras.findIndex((device) => device.deviceId === S.local.camId);
  let deviceId = '';
  if (index >= 0 && cameras.length > 1) {
    deviceId = cameras[(index + 1) % cameras.length].deviceId;
  } else if (!matchMedia('(pointer: coarse)').matches) {
    toast('No other camera found');
    return;
  }
  const facing = S.local.facing === 'user' ? 'environment' : 'user';
  const video = deviceId
    ? { deviceId: { exact: deviceId }, ...videoConstraints }
    : { facingMode: { ideal: facing }, ...videoConstraints };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video });
  } catch {
    if (!deviceId) {
      toast('Could not switch camera');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing }, ...videoConstraints } });
    } catch {
      toast('Could not switch camera');
      return;
    }
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    toast('Could not switch camera');
    return;
  }
  oldTrack.onended = null;
  track.onended = stopCam;
  S.local.cam = track;
  S.local.main.addTrack(track);
  S.local.main.removeTrack(oldTrack);
  replaceLocalTrack(oldTrack, track, S.local.main);
  oldTrack.stop();
  S.local.camId = track.getSettings().deviceId || deviceId;
  S.local.facing = track.getSettings().facingMode || facing;
  await refreshCameras();
  sendState();
  renderAll();
}

export function toggleDeafen() {
  if (S.local.hostDeafened) {
    toast('The host deafened you.');
    return;
  }
  S.local.deafened = !S.local.deafened;
  sendState();
  renderAll();
}

export function applyModeration(action, on) {
  if (action === 'deafen') {
    S.local.hostDeafened = on;
    S.local.deafened = on;
    sendState();
    renderAll();
    return;
  }
  if (action !== 'mute') return;
  S.local.hostMuted = on;
  if (S.local.mic) {
    S.local.micOn = !on;
    S.local.mic.enabled = !on;
  }
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
