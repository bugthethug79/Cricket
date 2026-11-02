import { S, myState } from './state.js';
import { $, initial, hue, setIcon, ICONS } from './dom.js';
import { send } from './socket.js';

const tiles = new Map();

function playSafe(video) {
  const played = video.play();
  if (played) played.catch(() => { if (!video.muted) $('#audioHint').hidden = false; });
}

function ensureTile(key, { muted = false, mirror = false, screen = false } = {}) {
  let tile = tiles.get(key);
  if (tile) return tile;

  const el = document.createElement('div');
  el.className = 'tile' + (screen ? ' screen' : '') + (mirror ? ' mirror' : '');
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const label = document.createElement('div');
  label.className = 'label';
  const micEl = document.createElement('span');
  micEl.className = 'mic-off icon ' + ICONS.micOff;
  const nameEl = document.createElement('span');
  label.append(micEl, nameEl);
  el.append(video, avatar, label);
  el.title = 'Click to focus, double-click for fullscreen';
  el.onclick = () => { S.pinned = S.pinned === key ? null : key; renderAll(); };
  el.ondblclick = () => { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); };
  $('#tiles').append(el);
  tile = { el, video, avatar, nameEl, micEl };
  tiles.set(key, tile);
  return tile;
}

function setTile(tile, { stream, name, video, mic, color }) {
  if (tile.video.srcObject !== stream) {
    tile.video.srcObject = stream;
    if (stream) playSafe(tile.video);
  }
  tile.el.classList.toggle('novideo', !video);
  tile.nameEl.textContent = name;
  tile.micEl.hidden = mic !== false;
  if (tile.avatar.dataset.name !== name) {
    tile.avatar.dataset.name = name;
    tile.avatar.textContent = initial(name);
  }
  tile.avatar.style.setProperty('--h', typeof color === 'number' ? color : hue(name));
}

const liveVideo = (stream) => !!stream && stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);

export function renderAll() {
  if (S.left) return;
  const live = new Set();

  const me = ensureTile('me:main', { muted: true, mirror: true });
  setTile(me, { stream: S.local.cam ? S.local.main : null, name: `${S.name} (you)`, video: !!S.local.cam, mic: myState().mic, color: S.color });
  live.add('me:main');

  if (S.local.screen) {
    const screen = ensureTile('me:screen', { muted: true, screen: true });
    setTile(screen, { stream: S.local.screen, name: 'Your screen', video: true, color: S.color });
    live.add('me:screen');
  }

  for (const peer of S.peers.values()) {
    const screenId = peer.state.screen ? peer.state.screen_stream : '';
    let main = null;
    let screen = null;
    for (const [id, stream] of peer.streams) {
      if (id === screenId) screen = stream;
      else if (!main || stream.getTracks().length) main = stream;
    }
    const tile = ensureTile(peer.id + ':main');
    setTile(tile, { stream: main, name: peer.name, video: peer.state.cam && liveVideo(main), mic: !!peer.state.mic, color: peer.color });
    tile.el.classList.toggle('connecting', ['checking', 'disconnected', 'failed'].includes(peer.pc.iceConnectionState));
    live.add(peer.id + ':main');

    if (screen && peer.state.screen) {
      const screenTile = ensureTile(peer.id + ':screen', { screen: true });
      setTile(screenTile, { stream: screen, name: `${peer.name}'s screen`, video: true, color: peer.color });
      live.add(peer.id + ':screen');
    }
  }

  for (const [key, tile] of tiles) {
    if (live.has(key)) continue;
    tile.video.srcObject = null;
    tile.el.remove();
    tiles.delete(key);
  }
  if (S.pinned && !live.has(S.pinned)) S.pinned = null;
  for (const [key, tile] of tiles) tile.el.classList.toggle('pinned', key === S.pinned);

  const grid = $('#tiles');
  grid.classList.toggle('has-pin', !!S.pinned);
  const n = live.size;
  const fit = Math.max(1, Math.floor(grid.clientWidth / 180));
  const cols = Math.min(Math.ceil(Math.sqrt(n)), fit);
  const rows = Math.ceil(n / cols);
  grid.style.setProperty('--n', n);
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', rows);

  renderPeople();
  updateControls();
}

export function renderPeople() {
  const list = [
    { id: S.me, name: S.name, color: S.color, state: myState(), joinedAt: S.joinedAt, you: true },
    ...S.peers.values(),
  ].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

  const ul = $('#people');
  ul.replaceChildren();
  for (const person of list) {
    const li = document.createElement('li');
    li.dataset.id = person.id || '';
    const avatar = document.createElement('span');
    avatar.className = 'avatar sm';
    avatar.textContent = initial(person.name);
    avatar.style.setProperty('--h', typeof person.color === 'number' ? person.color : hue(person.name));
    const name = document.createElement('span');
    name.className = 'pname';
    const isHost = person.id === S.host_id;
    name.textContent = person.name + (person.you ? ' (you)' : '') + (isHost ? ' · Host' : '');
    const icons = document.createElement('span');
    icons.className = 'picons';
    const state = person.state || {};
    icons.innerHTML =
      (state.screen ? `<i class="on icon ${ICONS.screen}" title="Sharing screen"></i>` : '') +
      (state.cam ? `<i class="on icon ${ICONS.cam}" title="Camera on"></i>` : '') +
      (state.mic ? `<i class="icon ${ICONS.mic}" title="Mic on"></i>` : `<i class="off icon ${ICONS.micOff}" title="Muted"></i>`);
    li.append(avatar, name, icons);
    if (S.host_id === S.me && !person.you && person.id) {
      const kick = document.createElement('button');
      kick.className = 'kick-btn';
      kick.textContent = 'Kick';
      kick.title = `Disconnect ${person.name}`;
      kick.onclick = (event) => {
        event.stopPropagation();
        if (confirm(`Disconnect ${person.name}? They can rejoin.`)) send({ t: 'kick', to: person.id });
      };
      const ban = document.createElement('button');
      ban.className = 'ban-btn';
      ban.textContent = 'Ban';
      ban.title = `Ban ${person.name} from this room`;
      ban.onclick = (event) => {
        event.stopPropagation();
        if (confirm(`Ban ${person.name} from this room?`)) send({ t: 'ban', to: person.id });
      };
      li.append(kick, ban);
    }
    ul.append(li);
  }
  $('#count').textContent = `${list.length} in call`;
}

export function updateControls() {
  const state = myState();
  const set = (button, on, icon, label) => {
    button.classList.toggle('off', !on);
    setIcon(button.querySelector('.ic'), icon);
    button.querySelector('.lbl').textContent = label;
  };
  set($('#micBtn'), state.mic, state.mic ? ICONS.mic : ICONS.micOff, state.mic ? 'Mute' : 'Unmute');
  set($('#camBtn'), state.cam, state.cam ? ICONS.cam : ICONS.camOff, state.cam ? 'Stop video' : 'Start video');
  set($('#screenBtn'), true, ICONS.screen, state.screen ? 'Stop sharing' : 'Share screen');
  $('#screenBtn').classList.toggle('active', state.screen);
  $('#micBtn').classList.toggle('alert', !state.mic);
  $('#camBtn').classList.toggle('alert', !state.cam);
}

export function renderSpeaking(isSpeaking) {
  for (const [key, tile] of tiles) {
    if (key.endsWith(':main')) tile.el.classList.toggle('speaking', isSpeaking(key.split(':')[0]));
  }
  for (const li of document.querySelectorAll('#people li')) {
    li.classList.toggle('speaking', isSpeaking(li.dataset.id === S.me ? 'me' : li.dataset.id));
  }
}

export function clearTiles() {
  for (const tile of tiles.values()) tile.video.srcObject = null;
  $('#tiles').replaceChildren();
  tiles.clear();
}

export function unlockTiles() {
  for (const tile of tiles.values()) tile.video.play().catch(() => {});
}
