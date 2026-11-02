import { S } from './state.js';
import { $, show, setIcon, ICONS, copy, toast } from './dom.js';
import { store } from './storage.js';
import { deriveKeys } from './crypto.js';
import { makeInvite } from './invite.js';
import { send, connect as openSocket } from './socket.js';
import { addPeer, onSignal, removePeer } from './rtc.js';
import { toggleMic, toggleCam, toggleScreen } from './media.js';
import { renderAll, clearTiles, unlockTiles, renderSpeaking } from './ui.js';
import { sysMsg, onChat, sendChat, setTab, setUnread, chatVisible } from './chat.js';
import { tickMeters, isSpeaking } from './speaking.js';
import { playSound } from './sound.js';

let bound = false;

export async function startCall(invite, name, color) {
  if (!navigator.mediaDevices) throw new Error('Your browser does not support calls on this page.');
  S.invite = invite;
  S.name = name;
  S.color = color;
  S.host_token = store.get('host.' + invite.room) || '';
  const keys = await deriveKeys(invite.key);
  S.auth = keys.auth;
  S.chatKey = keys.chatKey;

  try { S.audioCtx = new AudioContext(); } catch { }
  setInterval(() => { tickMeters(); renderSpeaking(isSpeaking); }, 200);

  show('call');
  if (innerWidth < 900) $('#call').classList.add('panel-hidden');
  bindControls();
  renderAll();
  connect();
}

function connect() {
  openSocket(onMessage, onClose);
}

function onMessage(message) {
  switch (message.t) {
    case 'welcome':
      S.me = message.self.id;
      S.joinedAt = message.self.joined_at;
      playSound('join');
      if (typeof message.self.color === 'number') S.color = message.self.color;
      S.host_id = message.host || '';
      S.ice = message.ice || [];
      S.forceRelay = !!message.force_relay;
      for (const peer of message.peers) addPeer(peer);
      renderAll();
      break;
    case 'peer-join':
      addPeer(message.peer);
      playSound('join');
      sysMsg(`${message.peer.name} joined`);
      renderAll();
      break;
    case 'peer-leave': {
      const peer = S.peers.get(message.id);
      if (peer) {
        playSound('leave');
        sysMsg(`${peer.name} left`);
        removePeer(peer);
      }
      if (S.host_id === message.id) S.host_id = '';
      renderAll();
      break;
    }
    case 'peer-update': {
      const peer = S.peers.get(message.peer.id);
      if (peer) {
        peer.name = message.peer.name;
        peer.color = message.peer.color;
        peer.state = message.peer.state || {};
        renderAll();
      }
      break;
    }
    case 'host':
      S.host_id = message.id || '';
      renderAll();
      break;
    case 'signal': {
      const peer = S.peers.get(message.from);
      if (peer) {
        peer.queue = peer.queue
          .then(() => onSignal(peer, message.data))
          .catch((err) => console.warn('signal', err));
      }
      break;
    }
    case 'chat':
      onChat(message);
      break;
    case 'error':
      S.errorMsg = message.msg;
      break;
  }
}

function onClose(event) {
  if (S.left) return;
  if (event.code === 4001) {
    playSound('leave');
    endCall('Removed from room', 'The host disconnected you from this call. You can rejoin.');
    return;
  }
  if (event.code === 4002) {
    playSound('leave');
    endCall('Room ended', 'The host left the room.');
    return;
  }
  if (event.code === 4003) {
    endCall('Room ended', 'The room expired before the host joined.');
    return;
  }
  if (event.code === 4004) {
    playSound('leave');
    endCall('Banned from room', 'The host banned you from this room.');
    return;
  }
  if (S.errorMsg) endCall('Unable to join', S.errorMsg);
  else endCall('Connection lost', 'You were disconnected from the room.');
}

function bindControls() {
  if (bound) return;
  bound = true;
  setIcon($('#panelBtn .ic'), ICONS.chat);
  setIcon($('#leaveBtn .ic'), ICONS.leave);
  $('#micBtn').onclick = toggleMic;
  $('#camBtn').onclick = toggleCam;
  $('#screenBtn').onclick = toggleScreen;
  $('#leaveBtn').onclick = () => {
    playSound('leave');
    if (S.host_id === S.me) send({ t: 'end' });
    endCall('You left the room', '');
  };
  $('#copyLink').onclick = () => copy(makeInvite(S.invite.room, S.invite.key));
  $('#panelBtn').onclick = () => {
    const call = $('#call');
    const hidden = call.classList.toggle('panel-hidden');
    if (!hidden) setTab('chat');
    renderAll();
  };
  $('#panelClose').onclick = () => {
    $('#call').classList.add('panel-hidden');
    renderAll();
  };
  addEventListener('resize', () => { if (!S.left) renderAll(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && chatVisible()) {
      S.unread = 0;
      setUnread();
    }
  });
  for (const button of document.querySelectorAll('.tab[data-tab]')) {
    button.onclick = () => setTab(button.dataset.tab);
  }
  $('#chatForm').onsubmit = (event) => {
    event.preventDefault();
    const text = $('#chatInput').value.trim();
    if (!text) return;
    $('#chatInput').value = '';
    sendChat(text.slice(0, 2000)).catch(() => toast('Message failed to send'));
  };
  $('#audioUnlock').onclick = () => {
    if (S.audioCtx) S.audioCtx.resume();
    unlockTiles();
    $('#audioHint').hidden = true;
  };
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea') || event.ctrlKey || event.metaKey || event.altKey || $('#call').hidden) return;
    if (event.key === 'm') toggleMic();
    if (event.key === 'v') toggleCam();
  });
}

function endCall(title, message) {
  if (S.left) return;
  S.left = true;
  for (const peer of S.peers.values()) removePeer(peer);
  for (const track of S.local.main.getTracks()) track.stop();
  if (S.local.screen) for (const track of S.local.screen.getTracks()) track.stop();
  if (S.ws) S.ws.close();
  if (S.audioCtx) S.audioCtx.close().catch(() => {});
  clearTiles();
  $('#endedTitle').textContent = title;
  $('#endedMsg').textContent = message;
  $('#rejoinBtn').onclick = () => location.reload();
  show('ended');
}
