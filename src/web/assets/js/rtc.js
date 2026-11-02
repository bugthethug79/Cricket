import { S } from './state.js';
import { send } from './socket.js';
import { renderAll } from './ui.js';
import { watchSpeaking, removeSpeaking } from './speaking.js';

export function addPeer(info) {
  if (S.peers.has(info.id) || info.id === S.me) return;
  const pc = new RTCPeerConnection({
    iceServers: S.ice,
    iceTransportPolicy: S.forceRelay ? 'relay' : 'all',
  });
  const peer = {
    id: info.id, name: info.name, color: info.color, state: info.state || {}, joinedAt: info.joined_at,
    pc, polite: S.me < info.id, makingOffer: false, ignoreOffer: false,
    senders: new Map(), streams: new Map(), queue: Promise.resolve(),
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
    if (pc.iceConnectionState === 'failed') pc.restartIce();
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
  S.peers.delete(peer.id);
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
