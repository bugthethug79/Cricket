import { S, myState } from './state.js';
import { b64u } from './crypto.js';
import { client_id } from './storage.js';

const terminal = new Set([1008, 4001, 4003, 4004, 4005]);

let handlers = null;
let socket = null;
let retryTimer = 0;
let attempts = 0;

export function send(message) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(message));
}

export function sendState() {
  send({ t: 'state', state: myState() });
}

export function connect(onMessage, onClose) {
  handlers = { onMessage, onClose };
  open();
}

function open() {
  clearTimeout(retryTimer);
  retryTimer = 0;

  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = ws;
  S.ws = ws;
  attempts++;

  ws.onopen = () => {
    attempts = 0;
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
  };

  ws.onmessage = (event) => {
    if (socket !== ws) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handlers.onMessage(message);
  };

  ws.onclose = (event) => {
    if (socket !== ws) return;
    if (S.left) return;
    if (terminal.has(event.code)) {
      handlers.onClose(event);
      return;
    }
    retry();
  };
}

function retry(delay = Math.min(10000, 1000 * 2 ** Math.min(Math.max(attempts - 1, 0), 4))) {
  if (retryTimer || S.left) return;
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    if (S.left || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
    open();
  }, delay);
}
