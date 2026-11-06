import { S } from './state.js';
import { $, show, setIcon, ICONS, copy, toast } from './dom.js';
import { store } from './storage.js';
import { deriveAuth } from './crypto.js';
import { makeInvite } from './invite.js';
import { connect as openSocket } from './socket.js';
import { addPeer, onSignal, removePeer, checkPeers } from './rtc.js';
import { toggleMic, toggleCam, toggleScreen, toggleDeafen, flipCam, applyModeration } from './media.js';
import { renderAll, clearTiles, unlockTiles, renderSpeaking, hideContextMenu } from './ui.js';
import { sysMsg, sendChat, setTab, setUnread, chatVisible } from './chat.js';
import { tickMeters, isSpeaking } from './speaking.js';
import { playSound } from './sound.js';

let bound = false;

export async function startCall(invite, name, color) {
  if (!navigator.mediaDevices) throw new Error('Your browser does not support calls on this page.');
  S.invite = invite;
  S.name = name;
  S.color = color;
  S.host_token = store.get('host.' + invite.room) || '';
  S.auth = await deriveAuth(invite.key);

  try { S.audioCtx = new AudioContext(); } catch { }
  setInterval(() => { tickMeters(); renderSpeaking(isSpeaking); }, 200);
  setInterval(checkPeers, 5000);

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
    case 'moderate':
      applyModeration(message.action, !!message.on);
      break;
    case 'host':
      hideContextMenu();
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
  if (event.code === 4003) {
    endCall('This call has ended', 'The room expired before it was opened.', false);
    return;
  }
  if (event.code === 4004) {
    playSound('leave');
    endCall('Banned from room', 'The host banned you from this room.', false);
    return;
  }
  if (event.code === 4005) {
    endCall('This call has ended', 'Everyone has left this call.', false);
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
  setIcon($('#deafenBtn .ic'), ICONS.deafen);
  setIcon($('#flipBtn .ic'), ICONS.cam);
  $('#micBtn').onclick = toggleMic;
  $('#deafenBtn').onclick = toggleDeafen;
  $('#camBtn').onclick = toggleCam;
  $('#flipBtn').onclick = flipCam;
  $('#screenBtn').onclick = toggleScreen;
  $('#leaveBtn').onclick = () => {
    if (S.host_id === S.me) {
      const message = S.peers.size
        ? 'You are the host. Leaving will pass host controls to another participant. Leave anyway?'
        : 'You are the host. Leaving will end this call and the invite link will stop working. Leave anyway?';
      if (!confirm(message)) return;
      S.left = true;
      location.replace('/');
      return;
    }
    playSound('leave');
    endCall('You left the room', '');
  };
  addEventListener('beforeunload', (event) => {
    if (S.left || S.host_id !== S.me) return;
    event.preventDefault();
    event.returnValue = '';
  });
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

function endCall(title, message, allowRejoin = true) {
  if (S.left) return;
  S.left = true;
  for (const peer of S.peers.values()) removePeer(peer);
  for (const track of S.local.main.getTracks()) track.stop();
  if (S.local.screen) for (const track of S.local.screen.getTracks()) track.stop();
  if (S.ws) S.ws.close();
  if (S.audioCtx) S.audioCtx.close().catch(() => {});
  hideContextMenu();
  clearTiles();
  $('#endedTitle').textContent = title;
  $('#endedMsg').textContent = message;
  $('#rejoinBtn').hidden = !allowRejoin;
  $('#rejoinBtn').onclick = () => location.reload();
  show('ended');
}
