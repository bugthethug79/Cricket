import { $, show, COLORS } from './dom.js';
import { store } from './storage.js';
import { b64u } from './crypto.js';
import { makeInvite } from './invite.js';
import { startCall } from './call.js';

export async function initLanding() {
  show('landing');
  try {
    const config = await (await fetch('/api/v1/config')).json();
    $('#tokenRow').hidden = !config.create_token_required;
  } catch { }

  const error = $('#landingErr');
  $('#createBtn').onclick = async () => {
    const button = $('#createBtn');
    button.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: $('#createToken').value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not create a room.');
      location.href = makeInvite(body.room, b64u.dec(body.key), body.host);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  };
}

async function roomStatus(room) {
  try {
    const response = await fetch(`/api/v1/rooms/${encodeURIComponent(room)}`);
    if (!response.ok) return 'unknown';
    const body = await response.json();
    return body.status || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function initPrejoin(invite) {
  const status = await roomStatus(invite.room);
  if (status === 'ended') {
    show('ended');
    $('#endedTitle').textContent = 'This call has ended';
    $('#endedMsg').textContent = 'Everyone has left this call.';
    $('#rejoinBtn').hidden = true;
    return;
  }
  if (status === 'invalid') {
    show('ended');
    $('#endedTitle').textContent = 'Invalid link';
    $('#endedMsg').textContent = 'This invite link is incomplete or malformed. Make sure you copied all of it.';
    $('#rejoinBtn').hidden = true;
    return;
  }
  show('prejoin');
  if (invite.host) store.set('host.' + invite.room, invite.host);
  try { history.replaceState(null, '', makeInvite(invite.room, invite.key)); } catch { }
  $('#nameInput').value = store.get('name') || '';
  $('#nameInput').focus();

  const saved = Number.parseInt(store.get('color') || '', 10);
  let color = Number.isInteger(saved) && saved >= 0 && saved < 360 ? saved : 210;
  const picker = $('#colorPicker');
  picker.replaceChildren();
  const swatches = COLORS.map((hue) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.hue = String(hue);
    button.style.setProperty('--h', hue);
    button.setAttribute('aria-label', `Avatar color ${hue}`);
    button.setAttribute('aria-pressed', String(hue === color));
    button.onclick = () => {
      color = hue;
      for (const swatch of swatches) {
        swatch.setAttribute('aria-pressed', String(Number(swatch.dataset.hue) === color));
      }
    };
    picker.append(button);
    return button;
  });

  $('#joinForm').onsubmit = (event) => {
    event.preventDefault();
    const name = $('#nameInput').value.trim().slice(0, 32) || 'Guest';
    store.set('name', name);
    store.set('color', String(color));
    startCall(invite, name, color).catch((err) => {
      $('#joinErr').textContent = err.message || String(err);
      $('#joinErr').hidden = false;
    });
  };
}
