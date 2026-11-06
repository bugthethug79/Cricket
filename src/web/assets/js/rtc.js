import { S } from './state.js';
import { send } from './socket.js';
import { renderAll } from './ui.js';
import { watchSpeaking, removeSpeaking } from './speaking.js';
import { addRemoteChat } from './chat.js';

export function addPeer(info) {
  if (S.peers.has(info.id) || info.id === S.me) return;
  const pc = new RTCPeerConnection({
    iceServers: S.ice,
    iceTransportPolicy: S.forceRelay ? 'relay' : 'all',
  });
  const peer = {
    id: info.id, name: info.name, color: info.color, state: info.state || {}, joinedAt: info.joined_at,
    connected: info.connected !== false,
    pc, polite: S.me < info.id, makingOffer: false, ignoreOffer: false,
    senders: new Map(), streams: new Map(), queue: Promise.resolve(), chat: null,
    unhealthySince: 0, lastRestart: 0,
  };
  S.peers.set(peer.id, peer);

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(peer, { description: pc.localDescription });
    } catch (err) {
      console.warn('negotiation', err);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) sendSignal(peer, { candidate }); };
  pc.oniceconnectionstatechange = () => {
    renderAll();
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    if (!peer.streams.has(stream.id)) {
      peer.streams.set(stream.id, stream);
      stream.onaddtrack = () => renderAll();
      stream.onremovetrack = () => {
        if (!stream.getTracks().length) peer.streams.delete(stream.id);
        renderAll();
      };
    }
    track.onunmute = () => renderAll();
    track.onmute = () => renderAll();
    track.onended = () => renderAll();
    if (track.kind === 'audio') watchSpeaking(peer.id, stream);
    renderAll();
  };

  for (const track of S.local.main.getTracks()) peer.senders.set(track.id, pc.addTrack(track, S.local.main));
  if (S.local.screen) {
    for (const track of S.local.screen.getTracks()) peer.senders.set(track.id, pc.addTrack(track, S.local.screen));
  }

  if (S.me < peer.id) {
    peer.chat = pc.createDataChannel('chat', { ordered: true });
    bindChat(peer);
  } else {
    pc.ondatachannel = (event) => {
      if (event.channel.label !== 'chat') return;
      peer.chat = event.channel;
      bindChat(peer);
    };
  }
}

function bindChat(peer) {
  peer.chat.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    addRemoteChat(peer.id, peer.name, data.text, data.ts, peer.color);
  };
}

function sendSignal(peer, data) {
  send({ t: 'signal', to: peer.id, data });
}

export async function onSignal(peer, { description, candidate } = {}) {
  const pc = peer.pc;
  if (description) {
    const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      sendSignal(peer, { description: pc.localDescription });
    }
  } else if (candidate) {
    try { await pc.addIceCandidate(candidate); } catch (err) { if (!peer.ignoreOffer) throw err; }
  }
}

export function removePeer(peer) {
  try { peer.pc.close(); } catch { }
  removeSpeaking(peer.id);
  peer.chat = null;
  S.peers.delete(peer.id);
}

export function syncPeers(infos) {
  const seen = new Set();
  for (const info of infos) {
    seen.add(info.id);
    const peer = S.peers.get(info.id);
    if (!peer) {
      addPeer(info);
      continue;
    }
    peer.name = info.name;
    peer.color = info.color;
    peer.state = info.state || {};
    peer.connected = info.connected !== false;
    const pc = peer.pc;
    if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      try { pc.restartIce(); } catch { }
    }
  }
  for (const peer of [...S.peers.values()]) {
    if (!seen.has(peer.id)) removePeer(peer);
  }
}

export function addLocalTrack(track, stream) {
  for (const peer of S.peers.values()) {
    peer.senders.set(track.id, peer.pc.addTrack(track, stream));
  }
}

export function removeLocalTrack(track) {
  for (const peer of S.peers.values()) {
    const sender = peer.senders.get(track.id);
    if (!sender) continue;
    try { peer.pc.removeTrack(sender); } catch { }
    peer.senders.delete(track.id);
  }
}

export function replaceLocalTrack(oldTrack, track, stream) {
  for (const peer of S.peers.values()) {
    const sender = peer.senders.get(oldTrack.id);
    if (!sender) {
      peer.senders.set(track.id, peer.pc.addTrack(track, stream));
      continue;
    }
    try { sender.replaceTrack(track); } catch { }
    peer.senders.delete(oldTrack.id);
    peer.senders.set(track.id, sender);
  }
}

export function checkPeers() {
  const now = Date.now();
  for (const peer of S.peers.values()) {
    const state = peer.pc.iceConnectionState;
    if (peer.pc.connectionState === 'failed' || state === 'failed') {
      if (now - peer.lastRestart > 15000) {
        peer.lastRestart = now;
        try { peer.pc.restartIce(); } catch { }
      }
      peer.unhealthySince = 0;
    } else if (state === 'disconnected') {
      if (!peer.unhealthySince) peer.unhealthySince = now;
      if (now - peer.unhealthySince > 15000 && now - peer.lastRestart > 15000) {
        peer.lastRestart = now;
        peer.unhealthySince = 0;
        try { peer.pc.restartIce(); } catch { }
      }
    } else {
      peer.unhealthySince = 0;
    }
  }
}
