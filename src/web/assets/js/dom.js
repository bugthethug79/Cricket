export const $ = (selector) => document.querySelector(selector);

export const COLORS = [210, 0, 25, 45, 90, 150, 190, 260, 300, 340];

export const ICONS = {
  mic: 'ic-mic',
  micOff: 'ic-mic-off',
  cam: 'ic-video',
  camOff: 'ic-camera-off',
  screen: 'ic-screen',
  chat: 'ic-chat',
  leave: 'ic-leave',
};

let toastTimer;

export function show(id) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== id;
}

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast('Invite link copied');
}

export function initial(name) {
  return ([...(name || '?').trim()][0] || '?').toUpperCase();
}

export function hue(str) {
  let h = 0;
  for (const c of str || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function setIcon(parent, name) {
  const el = document.createElement('span');
  el.className = 'icon ' + name;
  parent.replaceChildren(el);
}
