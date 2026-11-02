'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const te = new TextEncoder();
  const td = new TextDecoder();

  // ---------- small helpers ----------

  const b64u = {
    enc(bytes) {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
  };

  const store = {
    get(k) { try { return localStorage.getItem('cricket.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('cricket.' + k, v); } catch { /* private mode */ } },
  };

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const i = document.createElement('textarea');
      i.value = text;
      document.body.append(i);
      i.select();
      document.execCommand('copy');
      i.remove();
    }
    toast('Invite link copied');
  }

  function initial(name) {
    return ([...(name || '?').trim()][0] || '?').toUpperCase();
  }

  function hue(str) {
    let h = 0;
    for (const c of str || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }

  const ICONS = {
    mic: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>',
    micOff: '<svg viewBox="0 0 24 24"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3M3 3l18 18"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
    camOff: '<svg viewBox="0 0 24 24"><path d="M16 16v1a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1m4 0h5a1 1 0 0 1 1 1v3l5-3v10M3 3l18 18"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
    leave: '<svg viewBox="0 0 24 24"><path d="M10 17l-5-5 5-5M5 12h11M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></svg>',
  };

  // ---------- invite links ----------
  // Link format: https://host/j#<base64url(JSON {"v":1,"room":"…","key":"…"})>
  // Everything after '#' is never sent to the server, so it can't end up in
  // access logs, proxies or Referer headers.

  function parseInvite() {
    const h = location.hash.slice(1);
    if (!h) return null;
    let obj = null;
    try { obj = JSON.parse(td.decode(b64u.dec(h))); } catch {
      try { obj = JSON.parse(decodeURIComponent(h)); } catch { return null; }
    }
    if (!obj || obj.v !== 1 || typeof obj.room !== 'string' || typeof obj.key !== 'string') return null;
    try {
      const key = b64u.dec(obj.key);
      return key.length >= 32 ? { room: obj.room, key } : null;
    } catch { return null; }
  }

  function makeInvite(room, key) {
    const json = JSON.stringify({ v: 1, room, key: b64u.enc(key) });
    return `${location.origin}/j#${b64u.enc(te.encode(json))}`;
  }

  // The link key is split with HKDF into an auth token (sent to the server,
  // which only stores its hash) and a chat key the server never sees.
  async function deriveKeys(key) {
    const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const p = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('cricket/v1'), info: te.encode(info) });
    const auth = new Uint8Array(await crypto.subtle.deriveBits(p('auth'), base, 256));
    const chatKey = await crypto.subtle.deriveKey(p('chat'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { auth, chatKey };
  }

  // ---------- landing ----------

  async function initLanding() {
    show('landing');
    try {
      const c = await (await fetch('/api/config')).json();
      $('#tokenRow').hidden = !c.createTokenRequired;
    } catch { /* offline; creation will report the error */ }

    const err = $('#landingErr');
    $('#createBtn').onclick = async () => {
      const btn = $('#createBtn');
      btn.disabled = true;
      err.hidden = true;
      try {
        const key = crypto.getRandomValues(new Uint8Array(64));
        const { auth } = await deriveKeys(key);
        const verifier = new Uint8Array(await crypto.subtle.digest('SHA-256', auth));
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verifier: b64u.enc(verifier), token: $('#createToken').value }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not create a room.');
        // Go straight to the name prompt; the link is copyable from inside the call.
        location.href = makeInvite(body.room, key);
        return;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ---------- pre-join ----------

  function initPrejoin(invite) {
    show('prejoin');
    $('#nameInput').value = store.get('name') || '';
    $('#nameInput').focus();
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#nameInput').value.trim().slice(0, 32) || 'Guest';
      store.set('name', name);
      startCall(invite, name).catch((e) => {
        $('#joinErr').textContent = e.message || String(e);
        $('#joinErr').hidden = false;
      });
    };
  }

  // ---------- call state ----------

  const S = {
    invite: null, auth: null, chatKey: null, name: '',
    ws: null, me: null, joinedAt: 0, ice: [], forceRelay: false,
    peers: new Map(),
    local: { main: new MediaStream(), mic: null, micOn: false, cam: null, screen: null },
    left: false, errorMsg: '', audioCtx: null, pinned: null, unread: 0,
  };

  function send(m) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(m));
  }

  function myState() {
    return {
      mic: !!S.local.mic && S.local.micOn,
      cam: !!S.local.cam,
      screen: !!S.local.screen,
      screenStream: S.local.screen ? S.local.screen.id : '',
    };
  }

  function sendState() { send({ t: 'state', state: myState() }); }

  // Everyone joins muted with no camera. Device permission is only requested
  // when the user first presses the mic or camera button.
  async function startCall(invite, name) {
    if (!navigator.mediaDevices) throw new Error('Your browser does not support calls on this page.');
    S.invite = invite;
    S.name = name;
    const keys = await deriveKeys(invite.key);
    S.auth = keys.auth;
    S.chatKey = keys.chatKey;

    try { S.audioCtx = new AudioContext(); } catch { /* no speaking indicator */ }
    setInterval(tickMeters, 200);

    show('call');
    if (innerWidth < 900) $('#call').classList.add('panel-hidden');
    bindControls();
    renderAll();
    connect();
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    S.ws = ws;
    ws.onopen = () => send({ t: 'join', room: S.invite.room, auth: b64u.enc(S.auth), name: S.name, state: myState() });
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onMessage(m);
    };
    ws.onclose = () => {
      if (S.left) return;
      if (S.errorMsg) endCall('Unable to join', S.errorMsg);
      else endCall('Connection lost', 'You were disconnected from the room.');
    };
  }

  function onMessage(m) {
    switch (m.t) {
      case 'welcome':
        S.me = m.self.id;
        S.joinedAt = m.self.joinedAt;
        S.ice = m.ice || [];
        S.forceRelay = !!m.forceRelay;
        for (const p of m.peers) addPeer(p);
        renderAll();
        break;
      case 'peer-join':
        addPeer(m.peer);
        sysMsg(`${m.peer.name} joined`);
        renderAll();
        break;
      case 'peer-leave': {
        const p = S.peers.get(m.id);
        if (p) { sysMsg(`${p.name} left`); removePeer(p); }
        renderAll();
        break;
      }
      case 'peer-update': {
        const p = S.peers.get(m.peer.id);
        if (p) { p.name = m.peer.name; p.state = m.peer.state || {}; renderAll(); }
        break;
      }
      case 'signal': {
        const p = S.peers.get(m.from);
        // Serialize per peer: overlapping setRemoteDescription calls break negotiation.
        if (p) p.queue = p.queue.then(() => onSignal(p, m.data)).catch((e) => console.warn('signal', e));
        break;
      }
      case 'chat':
        onChat(m);
        break;
      case 'error':
        S.errorMsg = m.msg;
        break;
    }
  }

  // ---------- WebRTC mesh (perfect negotiation) ----------

  function addPeer(info) {
    if (S.peers.has(info.id) || info.id === S.me) return;
    const pc = new RTCPeerConnection({
      iceServers: S.ice,
      iceTransportPolicy: S.forceRelay ? 'relay' : 'all',
    });
    const p = {
      id: info.id, name: info.name, state: info.state || {}, joinedAt: info.joinedAt,
      pc, polite: S.me < info.id, makingOffer: false, ignoreOffer: false,
      senders: new Map(), streams: new Map(), queue: Promise.resolve(),
    };
    S.peers.set(p.id, p);

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(p, { description: pc.localDescription });
      } catch (e) {
        console.warn('negotiation', e);
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sendSignal(p, { candidate }); };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
      renderAll();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (!p.streams.has(stream.id)) {
        p.streams.set(stream.id, stream);
        stream.onaddtrack = () => renderAll();
        stream.onremovetrack = () => {
          if (!stream.getTracks().length) p.streams.delete(stream.id);
          renderAll();
        };
      }
      track.onunmute = () => renderAll();
      track.onmute = () => renderAll();
      track.onended = () => renderAll();
      if (track.kind === 'audio') watchSpeaking(p.id, stream);
      renderAll();
    };

    for (const t of S.local.main.getTracks()) p.senders.set(t.id, pc.addTrack(t, S.local.main));
    if (S.local.screen) {
      for (const t of S.local.screen.getTracks()) p.senders.set(t.id, pc.addTrack(t, S.local.screen));
    }
  }

  function sendSignal(p, data) { send({ t: 'signal', to: p.id, data }); }

  async function onSignal(p, { description, candidate } = {}) {
    const pc = p.pc;
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        sendSignal(p, { description: pc.localDescription });
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
    }
  }

  function removePeer(p) {
    try { p.pc.close(); } catch { /* already closed */ }
    for (const [k, m] of meters) if (m.peerId === p.id) { m.src.disconnect(); meters.delete(k); }
    S.peers.delete(p.id);
  }

  function addLocalTrack(track, stream) {
    for (const p of S.peers.values()) p.senders.set(track.id, p.pc.addTrack(track, stream));
  }

  function removeLocalTrack(track) {
    for (const p of S.peers.values()) {
      const s = p.senders.get(track.id);
      if (!s) continue;
      try { p.pc.removeTrack(s); } catch { /* pc closed */ }
      p.senders.delete(track.id);
    }
  }

  // ---------- local media ----------

  async function acquireMic() {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const t = s.getAudioTracks()[0];
    S.local.mic = t;
    S.local.micOn = true;
    S.local.main.addTrack(t);
    addLocalTrack(t, S.local.main);
    watchSpeaking('me', new MediaStream([t]));
  }

  async function acquireCam() {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const t = s.getVideoTracks()[0];
    t.onended = stopCam;
    S.local.cam = t;
    S.local.main.addTrack(t);
    addLocalTrack(t, S.local.main);
  }

  async function toggleMic() {
    if (!S.local.mic) {
      try { await acquireMic(); } catch { toast('Microphone permission denied'); return; }
    } else {
      S.local.micOn = !S.local.micOn;
      S.local.mic.enabled = S.local.micOn;
    }
    sendState();
    renderAll();
  }

  function stopCam() {
    const t = S.local.cam;
    if (!t) return;
    S.local.cam = null;
    removeLocalTrack(t);
    S.local.main.removeTrack(t);
    t.stop();
    sendState();
    renderAll();
  }

  async function toggleCam() {
    if (S.local.cam) return stopCam();
    try { await acquireCam(); } catch { toast('Camera unavailable'); return; }
    sendState();
    renderAll();
  }

  async function toggleScreen() {
    if (S.local.screen) return stopScreen();
    if (!navigator.mediaDevices.getDisplayMedia) { toast('Screen sharing is not supported on this device'); return; }
    let s;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    } catch { return; }
    const v = s.getVideoTracks()[0];
    if (v) { v.contentHint = 'detail'; v.onended = stopScreen; }
    S.local.screen = s;
    // State goes out first so peers know this stream id is a screen share.
    sendState();
    for (const t of s.getTracks()) addLocalTrack(t, s);
    renderAll();
  }

  function stopScreen() {
    const s = S.local.screen;
    if (!s) return;
    S.local.screen = null;
    for (const t of s.getTracks()) { removeLocalTrack(t); t.stop(); }
    sendState();
    renderAll();
  }

  // ---------- speaking indicator ----------

  const meters = new Map();

  function watchSpeaking(peerId, stream) {
    if (!S.audioCtx) return;
    const key = peerId + ':' + stream.id;
    if (meters.has(key)) return;
    try {
      const src = S.audioCtx.createMediaStreamSource(stream);
      const an = S.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      meters.set(key, { peerId, src, an, buf: new Uint8Array(an.fftSize) });
    } catch { /* stream without audio yet */ }
  }

  function tickMeters() {
    const level = new Map();
    for (const m of meters.values()) {
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (const v of m.buf) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / m.buf.length);
      level.set(m.peerId, Math.max(level.get(m.peerId) || 0, rms));
    }
    const speaking = (id) => (level.get(id) || 0) > 0.035;
    for (const [key, t] of tiles) {
      if (key.endsWith(':main')) t.el.classList.toggle('speaking', speaking(key.split(':')[0]));
    }
    for (const li of document.querySelectorAll('#people li')) {
      li.classList.toggle('speaking', speaking(li.dataset.id === S.me ? 'me' : li.dataset.id));
    }
  }

  // ---------- rendering ----------

  const tiles = new Map();

  function playSafe(video) {
    const p = video.play();
    if (p) p.catch(() => { if (!video.muted) $('#audioHint').hidden = false; });
  }

  function ensureTile(key, { muted = false, mirror = false, screen = false } = {}) {
    let t = tiles.get(key);
    if (t) return t;
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
    micEl.className = 'mic-off';
    micEl.innerHTML = ICONS.micOff;
    const nameEl = document.createElement('span');
    label.append(micEl, nameEl);
    el.append(video, avatar, label);
    el.title = 'Click to focus, double-click for fullscreen';
    el.onclick = () => { S.pinned = S.pinned === key ? null : key; renderAll(); };
    el.ondblclick = () => { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); };
    $('#tiles').append(el);
    t = { el, video, avatar, nameEl, micEl };
    tiles.set(key, t);
    return t;
  }

  function setTile(t, { stream, name, video, mic }) {
    if (t.video.srcObject !== stream) {
      t.video.srcObject = stream;
      if (stream) playSafe(t.video);
    }
    t.el.classList.toggle('novideo', !video);
    t.nameEl.textContent = name;
    t.micEl.hidden = mic !== false;
    if (t.avatar.dataset.name !== name) {
      t.avatar.dataset.name = name;
      t.avatar.textContent = initial(name);
      t.avatar.style.setProperty('--h', hue(name));
    }
  }

  const liveVideo = (stream) => !!stream && stream.getVideoTracks().some((tr) => tr.readyState === 'live' && !tr.muted);

  function renderAll() {
    if (S.left) return;
    const live = new Set();

    const me = ensureTile('me:main', { muted: true, mirror: true });
    setTile(me, { stream: S.local.cam ? S.local.main : null, name: `${S.name} (you)`, video: !!S.local.cam, mic: myState().mic });
    live.add('me:main');

    if (S.local.screen) {
      const st = ensureTile('me:screen', { muted: true, screen: true });
      setTile(st, { stream: S.local.screen, name: 'Your screen', video: true });
      live.add('me:screen');
    }

    for (const p of S.peers.values()) {
      const screenId = p.state.screen ? p.state.screenStream : '';
      let main = null;
      let screen = null;
      for (const [id, s] of p.streams) {
        if (id === screenId) screen = s;
        else if (!main || s.getTracks().length) main = s;
      }
      const t = ensureTile(p.id + ':main');
      setTile(t, { stream: main, name: p.name, video: p.state.cam && liveVideo(main), mic: !!p.state.mic });
      // 'new' just means nobody has sent media yet, which is fine.
      t.el.classList.toggle('connecting', ['checking', 'disconnected', 'failed'].includes(p.pc.iceConnectionState));
      live.add(p.id + ':main');

      if (screen && p.state.screen) {
        const st = ensureTile(p.id + ':screen', { screen: true });
        setTile(st, { stream: screen, name: `${p.name}'s screen`, video: true });
        live.add(p.id + ':screen');
      }
    }

    for (const [key, t] of tiles) {
      if (!live.has(key)) { t.video.srcObject = null; t.el.remove(); tiles.delete(key); }
    }
    if (S.pinned && !live.has(S.pinned)) S.pinned = null;
    for (const [key, t] of tiles) t.el.classList.toggle('pinned', key === S.pinned);
    const grid = $('#tiles');
    grid.classList.toggle('has-pin', !!S.pinned);
    grid.style.setProperty('--n', live.size);

    renderPeople();
    updateControls();
  }

  function renderPeople() {
    const list = [
      { id: S.me, name: S.name, state: myState(), joinedAt: S.joinedAt, you: true },
      ...S.peers.values(),
    ].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

    const ul = $('#people');
    ul.replaceChildren();
    for (const p of list) {
      const li = document.createElement('li');
      li.dataset.id = p.id || '';
      const av = document.createElement('span');
      av.className = 'avatar sm';
      av.textContent = initial(p.name);
      av.style.setProperty('--h', hue(p.name));
      const nm = document.createElement('span');
      nm.className = 'pname';
      nm.textContent = p.name + (p.you ? ' (you)' : '');
      const icons = document.createElement('span');
      icons.className = 'picons';
      const st = p.state || {};
      icons.innerHTML =
        (st.screen ? `<i class="on" title="Sharing screen">${ICONS.screen}</i>` : '') +
        (st.cam ? `<i class="on" title="Camera on">${ICONS.cam}</i>` : '') +
        (st.mic ? `<i title="Mic on">${ICONS.mic}</i>` : `<i class="off" title="Muted">${ICONS.micOff}</i>`);
      li.append(av, nm, icons);
      ul.append(li);
    }
    $('#peopleCount').textContent = list.length;
    $('#count').textContent = `${list.length} in call`;
  }

  function updateControls() {
    const st = myState();
    const set = (btn, on, icon, label) => {
      btn.classList.toggle('off', !on);
      btn.querySelector('.ic').innerHTML = icon;
      btn.querySelector('.lbl').textContent = label;
    };
    set($('#micBtn'), st.mic, st.mic ? ICONS.mic : ICONS.micOff, st.mic ? 'Mute' : 'Unmute');
    set($('#camBtn'), st.cam, st.cam ? ICONS.cam : ICONS.camOff, st.cam ? 'Stop video' : 'Start video');
    set($('#screenBtn'), true, ICONS.screen, st.screen ? 'Stop sharing' : 'Share screen');
    $('#screenBtn').classList.toggle('active', st.screen);
    $('#micBtn').classList.toggle('alert', !st.mic);
    $('#camBtn').classList.toggle('alert', !st.cam);
  }

  // ---------- chat (end-to-end encrypted) ----------

  async function sendChat(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, S.chatKey, te.encode(JSON.stringify({ text })),
    ));
    send({ t: 'chat', data: { iv: b64u.enc(iv), ct: b64u.enc(ct) } });
    addChat({ name: S.name, text, ts: Date.now(), mine: true });
  }

  async function onChat(m) {
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64u.dec(m.data.iv) }, S.chatKey, b64u.dec(m.data.ct),
      );
      const { text } = JSON.parse(td.decode(pt));
      if (typeof text === 'string' && text) addChat({ name: m.name, text: text.slice(0, 2000), ts: m.ts });
    } catch { /* not encrypted with this room's key: drop */ }
  }

  function chatVisible() {
    return !$('#call').classList.contains('panel-hidden') && !$('#chat').hidden;
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
    const n = document.createElement('b');
    n.textContent = mine ? 'You' : name;
    const time = document.createElement('time');
    time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(n, time);
    const body = document.createElement('div');
    body.className = 'mbody';
    body.textContent = text;
    el.append(head, body);
    appendMessage(el);
    if (!mine && !chatVisible()) {
      S.unread++;
      $('#unread').textContent = S.unread > 9 ? '9+' : S.unread;
      $('#unread').hidden = false;
    }
  }

  function sysMsg(text) {
    const el = document.createElement('p');
    el.className = 'muted small sys';
    el.textContent = text;
    appendMessage(el);
  }

  function setTab(tab) {
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
    $('#people').hidden = tab !== 'people';
    $('#chat').hidden = tab !== 'chat';
    if (tab === 'chat') {
      S.unread = 0;
      $('#unread').hidden = true;
      if (innerWidth >= 900) $('#chatInput').focus();
    }
  }

  // ---------- controls ----------

  let bound = false;
  function bindControls() {
    if (bound) return;
    bound = true;
    $('#panelBtn .ic').innerHTML = ICONS.chat;
    $('#leaveBtn .ic').innerHTML = ICONS.leave;
    $('#micBtn').onclick = toggleMic;
    $('#camBtn').onclick = toggleCam;
    $('#screenBtn').onclick = toggleScreen;
    $('#leaveBtn').onclick = () => endCall('You left the room', '');
    $('#copyLink').onclick = () => copy(location.href);
    $('#panelBtn').onclick = () => {
      const call = $('#call');
      const hidden = call.classList.toggle('panel-hidden');
      if (!hidden) setTab('chat');
    };
    $('#panelClose').onclick = () => $('#call').classList.add('panel-hidden');
    for (const b of document.querySelectorAll('.tab[data-tab]')) b.onclick = () => setTab(b.dataset.tab);
    $('#chatForm').onsubmit = (e) => {
      e.preventDefault();
      const text = $('#chatInput').value.trim();
      if (!text) return;
      $('#chatInput').value = '';
      sendChat(text.slice(0, 2000)).catch(() => toast('Message failed to send'));
    };
    $('#audioUnlock').onclick = () => {
      if (S.audioCtx) S.audioCtx.resume();
      for (const t of tiles.values()) t.video.play().catch(() => {});
      $('#audioHint').hidden = true;
    };
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey || $('#call').hidden) return;
      if (e.key === 'm') toggleMic();
      if (e.key === 'v') toggleCam();
    });
  }

  function endCall(title, msg) {
    if (S.left) return;
    S.left = true;
    for (const p of S.peers.values()) removePeer(p);
    for (const t of S.local.main.getTracks()) t.stop();
    if (S.local.screen) for (const t of S.local.screen.getTracks()) t.stop();
    if (S.ws) S.ws.close();
    if (S.audioCtx) S.audioCtx.close().catch(() => {});
    for (const t of tiles.values()) t.video.srcObject = null;
    $('#tiles').replaceChildren();
    tiles.clear();
    $('#endedTitle').textContent = title;
    $('#endedMsg').textContent = msg;
    $('#rejoinBtn').onclick = () => location.reload();
    show('ended');
  }

  // ---------- boot ----------

  if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
    show('ended');
    $('#endedTitle').textContent = 'HTTPS required';
    $('#endedMsg').textContent = 'Open this page over HTTPS (or on localhost). Browsers block camera, microphone and encryption on insecure pages.';
    $('#rejoinBtn').hidden = true;
    return;
  }

  window.addEventListener('hashchange', () => location.reload());
  const invite = parseInvite();
  if (invite) {
    initPrejoin(invite);
  } else if (location.pathname === '/j') {
    show('ended');
    $('#endedTitle').textContent = 'Invalid link';
    $('#endedMsg').textContent = 'This invite link is incomplete or malformed. Make sure you copied all of it.';
    $('#rejoinBtn').hidden = true;
  } else {
    initLanding();
  }
})();
