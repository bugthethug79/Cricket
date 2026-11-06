import { S, myState } from './state.js';
import { $, initial, hue, setIcon, ICONS } from './dom.js';
import { send } from './socket.js';

const tiles = new Map();
const menu = $('#contextMenu');
const coarsePointer = matchMedia('(pointer: coarse)');

function hideContextMenu() {
  if (menu) menu.hidden = true;
}

function showPersonMenu(event, person) {
  menu.replaceChildren();
  const title = document.createElement('div');
  title.className = 'context-title';
  title.textContent = person.name;
  menu.append(title);

  const item = (label, icon, danger, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-item' + (danger ? ' danger' : '');
    const glyph = document.createElement('span');
    glyph.className = 'icon ' + icon;
    const text = document.createElement('span');
    text.textContent = label;
    button.append(glyph, text);
    button.onclick = () => {
      hideContextMenu();
      action();
    };
    menu.append(button);
  };

  item('Make host', 'ic-user', false, () => {
    if (confirm(`Make ${person.name} the host? They will get host controls and you will lose yours.`)) {
      send({ t: 'promote', to: person.id });
    }
  });
  const separator = document.createElement('div');
  separator.className = 'context-separator';
  menu.append(separator);
  item('Kick', 'ic-leave', false, () => {
    if (confirm(`Disconnect ${person.name}? They can rejoin.`)) {
      send({ t: 'kick', to: person.id });
    }
  });
  item('Ban', 'ic-close', true, () => {
    if (confirm(`Ban ${person.name} from this room?`)) {
      send({ t: 'ban', to: person.id });
    }
  });

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8))}px`;
}

document.addEventListener('pointerdown', (event) => {
  if (menu && !menu.hidden && !menu.contains(event.target)) hideContextMenu();
});
document.addEventListener('contextmenu', (event) => {
  if (menu && !menu.hidden) hideContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideContextMenu();
});
addEventListener('scroll', hideContextMenu, true);
addEventListener('resize', hideContextMenu);

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

function setTile(tile, { stream, name, video, mic, color, muted = false }) {
  tile.video.muted = muted || S.local.deafened;
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

const mini = $('#mini');
const miniVideo = $('#miniVideo');
const miniName = $('#miniName');
const MINI_MARGIN = 12;
let miniDrag = null;
let miniPlaced = false;

function placeMini(left, top) {
  const width = mini.offsetWidth || 144;
  const height = mini.offsetHeight || 144;
  const maxLeft = Math.max(MINI_MARGIN, innerWidth - width - MINI_MARGIN);
  const maxTop = Math.max(MINI_MARGIN, innerHeight - height - MINI_MARGIN);
  mini.style.left = `${Math.min(Math.max(MINI_MARGIN, left), maxLeft)}px`;
  mini.style.top = `${Math.min(Math.max(MINI_MARGIN, top), maxTop)}px`;
}

function bindMiniDrag() {
  mini.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = mini.getBoundingClientRect();
    miniDrag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    try { mini.setPointerCapture(event.pointerId); } catch { }
    mini.classList.add('dragging');
    event.preventDefault();
  });
  mini.addEventListener('pointermove', (event) => {
    if (!miniDrag || miniDrag.id !== event.pointerId) return;
    placeMini(event.clientX - miniDrag.dx, event.clientY - miniDrag.dy);
  });
  const end = (event) => {
    if (!miniDrag || miniDrag.id !== event.pointerId) return;
    miniDrag = null;
    mini.classList.remove('dragging');
  };
  mini.addEventListener('pointerup', end);
  mini.addEventListener('pointercancel', end);
}

bindMiniDrag();

function miniTarget() {
  if (!S.pinned || S.left || innerWidth >= 900) return null;
  if ($('#call').hidden || $('#call').classList.contains('panel-hidden')) return null;
  const tile = tiles.get(S.pinned);
  if (!tile || tile.el.classList.contains('novideo')) return null;
  const stream = tile.video.srcObject;
  if (!liveVideo(stream)) return null;
  return { tile, stream };
}

export function updateMini() {
  const target = miniTarget();
  if (!target) {
    if (!mini.hidden) {
      mini.hidden = true;
      miniVideo.srcObject = null;
    }
    return;
  }
  const { tile, stream } = target;
  if (miniVideo.srcObject !== stream) {
    miniVideo.srcObject = stream;
    playSafe(miniVideo);
  }
  mini.classList.toggle('screen', tile.el.classList.contains('screen'));
  mini.classList.toggle('mirror', tile.el.classList.contains('mirror'));
  miniName.textContent = tile.nameEl.textContent;
  const wasHidden = mini.hidden;
  mini.hidden = false;
  if (wasHidden && !miniPlaced) {
    miniPlaced = true;
    const header = $('#panel .headerbar');
    const top = (header ? header.getBoundingClientRect().height : 0) + MINI_MARGIN;
    placeMini(MINI_MARGIN, top);
  } else if (mini.style.left && mini.style.top) {
    placeMini(parseFloat(mini.style.left), parseFloat(mini.style.top));
  }
}

export function renderAll() {
  if (S.left) return;
  const live = new Set();

  const me = ensureTile('me:main', { muted: true, mirror: true });
  setTile(me, { stream: S.local.cam ? S.local.main : null, name: `${S.name} (you)`, video: !!S.local.cam, mic: myState().mic, color: S.color, muted: true });
  live.add('me:main');

  if (S.local.screen) {
    const screen = ensureTile('me:screen', { muted: true, screen: true });
    setTile(screen, { stream: S.local.screen, name: 'Your screen', video: true, color: S.color, muted: true });
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
  updateMini();
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
    name.textContent = person.name + (person.you ? ' (you)' : '') + (isHost ? ' (Host)' : '');
    const icons = document.createElement('span');
    icons.className = 'picons';
    const state = person.state || {};
    const forcedMute = !!state.host_muted;
    const forcedDeafen = !!state.host_deafened;
    icons.innerHTML =
      (state.screen ? `<i class="on icon ${ICONS.screen}" title="Sharing screen"></i>` : '') +
      (state.cam ? `<i class="on icon ${ICONS.cam}" title="Camera on"></i>` : '') +
      (state.mic ? `<i class="icon ${ICONS.mic}" title="Mic on"></i>` : `<i class="${forcedMute ? 'off ' : ''}icon ${ICONS.micOff}" title="${forcedMute ? 'Muted by host' : 'Muted'}"></i>`);
    li.classList.toggle('moderated', forcedMute || forcedDeafen);
    li.title = forcedMute && forcedDeafen ? 'Muted and deafened by host' : forcedMute ? 'Muted by host' : forcedDeafen ? 'Deafened by host' : '';
    li.append(avatar, name, icons);
    if (S.host_id === S.me && !person.you && person.id) {
      const actions = document.createElement('span');
      actions.className = 'pactions';
      const action = (label, icon, danger, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'paction' + (danger ? ' danger' : '');
        button.title = label;
        button.setAttribute('aria-label', label);
        const glyph = document.createElement('span');
        glyph.className = 'icon ' + icon;
        button.append(glyph);
        button.onclick = (event) => {
          event.stopPropagation();
          hideContextMenu();
          run();
        };
        actions.append(button);
      };
      action('Make host', 'ic-user', false, () => {
        if (confirm(`Make ${person.name} the host? They will get host controls and you will lose yours.`)) {
          send({ t: 'promote', to: person.id });
        }
      });
      action(forcedMute ? 'Unmute' : 'Mute', forcedMute ? ICONS.mic : ICONS.micOff, forcedMute, () => {
        send({ t: 'moderate', to: person.id, action: 'mute', on: !forcedMute });
      });
      action(forcedDeafen ? 'Undeafen' : 'Deafen', forcedDeafen ? ICONS.deafenOff : ICONS.deafen, forcedDeafen, () => {
        send({ t: 'moderate', to: person.id, action: 'deafen', on: !forcedDeafen });
      });
      action('Kick', ICONS.leave, false, () => {
        if (confirm(`Disconnect ${person.name}? They can rejoin.`)) {
          send({ t: 'kick', to: person.id });
        }
      });
      action('Ban', 'ic-close', true, () => {
        if (confirm(`Ban ${person.name} from this room?`)) {
          send({ t: 'ban', to: person.id });
        }
      });
      li.classList.add('has-actions');
      li.append(actions);
      li.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        showPersonMenu(event, person);
      };
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
  const mic = $('#micBtn');
  mic.classList.toggle('off', !state.mic);
  mic.classList.toggle('locked', state.host_muted);
  setIcon(mic.querySelector('.ic'), state.mic ? ICONS.mic : ICONS.micOff);
  mic.querySelector('.lbl').textContent = state.host_muted ? 'Muted' : state.mic ? 'Mute' : 'Unmute';
  set($('#camBtn'), state.cam, state.cam ? ICONS.cam : ICONS.camOff, state.cam ? 'Stop video' : 'Start video');
  set($('#screenBtn'), true, ICONS.screen, state.screen ? 'Stop sharing' : 'Share screen');
  const deafen = $('#deafenBtn');
  deafen.classList.toggle('active', state.deafened && !state.host_deafened);
  deafen.classList.toggle('locked', state.host_deafened);
  setIcon(deafen.querySelector('.ic'), state.deafened ? ICONS.deafenOff : ICONS.deafen);
  deafen.querySelector('.lbl').textContent = state.host_deafened ? 'Deafened' : state.deafened ? 'Undeafen' : 'Deafen';
  $('#flipBtn').hidden = !state.cam || (S.cameras.length < 2 && !coarsePointer.matches);
  $('#screenBtn').classList.toggle('active', state.screen);
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
  updateMini();
}

export { hideContextMenu };

export function unlockTiles() {
  for (const tile of tiles.values()) tile.video.play().catch(() => {});
}
