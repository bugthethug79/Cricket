import { S, myState } from './state.js';
import { b64u } from './crypto.js';
import { client_id } from './storage.js';

export function send(message) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(message));
}

export function sendState() {
  send({ t: 'state', state: myState() });
}

export function connect(onMessage, onClose) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => send({
    t: 'join',
    room: S.invite.room,
    auth: b64u.enc(S.auth),
    name: S.name,
    color: S.color,
    client_id: client_id(),
    host: S.host_token,
    state: myState(),
  });
  ws.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    onMessage(message);
  };
  ws.onclose = onClose;
}
