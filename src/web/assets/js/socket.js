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
  let lastPong = 0;
  let heartbeat = 0;

  const onVisible = () => { if (!document.hidden) lastPong = Date.now(); };
  ws.onopen = () => {
    send({
      t: 'join',
      room: S.invite.room,
      auth: b64u.enc(S.auth),
      name: S.name,
      color: S.color,
      client_id: client_id(),
      host: S.host_token,
      state: myState(),
    });
    lastPong = Date.now();
    heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || document.hidden) return;
      if (Date.now() - lastPong > 30000) {
        ws.close();
        return;
      }
      send({ t: 'ping' });
    }, 10000);
  };
  ws.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.t === 'pong') {
      lastPong = Date.now();
      return;
    }
    onMessage(message);
  };
  document.addEventListener('visibilitychange', onVisible);
  ws.onclose = (event) => {
    clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVisible);
    onClose(event);
  };
}
