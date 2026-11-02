import { S } from './state.js';
import { $ } from './dom.js';
import { encryptChat, decryptChat } from './crypto.js';
import { send } from './socket.js';
import { playSound } from './sound.js';

export async function sendChat(text) {
  const data = await encryptChat(S.chatKey, text);
  send({ t: 'chat', data });
  addChat({ name: S.name, text, ts: Date.now(), mine: true });
}

export async function onChat(message) {
  try {
    const text = await decryptChat(S.chatKey, message.data);
    if (typeof text === 'string' && text) {
      addChat({ name: message.name, text: text.slice(0, 2000), ts: message.ts });
    }
  } catch { }
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

function addChat({ name, text, ts, mine }) {
  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '');
  const head = document.createElement('div');
  head.className = 'mhead';
  const author = document.createElement('b');
  author.textContent = mine ? 'You' : name;
  const time = document.createElement('time');
  time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  head.append(author, time);
  const body = document.createElement('div');
  body.className = 'mbody';
  body.textContent = text;
  el.append(head, body);
  appendMessage(el);
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
