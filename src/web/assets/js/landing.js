import { $, show, COLORS } from './dom.js';
import { store } from './storage.js';
import { b64u, deriveKeys } from './crypto.js';
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
      const key = crypto.getRandomValues(new Uint8Array(64));
      const { auth } = await deriveKeys(key);
      const verifier = new Uint8Array(await crypto.subtle.digest('SHA-256', auth));
      const response = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifier: b64u.enc(verifier), token: $('#createToken').value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not create a room.');
      location.href = makeInvite(body.room, key, body.host);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  };
}

export function initPrejoin(invite) {
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
