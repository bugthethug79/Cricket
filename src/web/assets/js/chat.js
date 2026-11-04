import { S } from './state.js';
import { $, hue } from './dom.js';
import { playSound } from './sound.js';

let lastSender = null;

export async function sendChat(text) {
  const clean = text.slice(0, 2000);
  const ts = Date.now();
  const payload = JSON.stringify({ text: clean, ts });
  for (const peer of S.peers.values()) {
    if (!peer.chat || peer.chat.readyState !== 'open') continue;
    try { peer.chat.send(payload); } catch { }
  }
  addChat({ id: S.me, name: S.name, text: clean, ts, mine: true });
}

export function addRemoteChat(id, name, text, ts, color) {
  if (typeof text !== 'string' || !text) return;
  addChat({ id, name, text: text.slice(0, 2000), ts: Number(ts) || Date.now(), color });
}

export function chatVisible() {
  return !document.hidden && !$('#call').classList.contains('panel-hidden') && !$('#chat').hidden;
}

export function setUnread() {
  const text = S.unread > 9 ? '9+' : String(S.unread);
  for (const el of [$('#unread'), $('#tabUnread')]) {
    if (!el) continue;
    el.textContent = text;
    el.hidden = S.unread === 0;
  }
}

function appendMessage(el) {
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.append(el);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function addChat({ id, name, text, ts, mine, color }) {
  const el = document.createElement('div');
  const grouped = lastSender === id && lastSender !== null;
  const colored = !mine && S.peers.size + 1 > 2;
  el.className = 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (colored ? ' colored' : '');
  if (colored) el.style.setProperty('--h', typeof color === 'number' ? color : hue(name));
  if (!grouped) {
    const head = document.createElement('div');
    head.className = 'mhead';
    const author = document.createElement('b');
    author.textContent = mine ? 'You' : name;
    const time = document.createElement('time');
    time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(author, time);
    el.append(head);
  }
  const body = document.createElement('div');
  body.className = 'mbody';
  body.textContent = text;
  el.append(body);
  appendMessage(el);
  lastSender = id;
  if (!mine && !chatVisible()) {
    S.unread++;
    setUnread();
    playSound('notify');
  }
}

export function sysMsg(text) {
  const el = document.createElement('p');
  el.className = 'muted small sys';
  el.textContent = text;
  appendMessage(el);
  lastSender = null;
}

export function setTab(tab) {
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  $('#people').hidden = tab !== 'people';
  $('#chat').hidden = tab !== 'chat';
  if (tab === 'chat') {
    S.unread = 0;
    setUnread();
    if (innerWidth >= 900) $('#chatInput').focus();
  }
}
