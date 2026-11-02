import { b64u, te, td } from './crypto.js';

export function parseInvite() {
  const h = location.hash.slice(1);
  if (!h) return null;
  let obj = null;
  try { obj = JSON.parse(td.decode(b64u.dec(h))); } catch {
    try { obj = JSON.parse(decodeURIComponent(h)); } catch { return null; }
  }
  if (!obj || obj.v !== 1 || typeof obj.room !== 'string' || typeof obj.key !== 'string') return null;
  try {
    const key = b64u.dec(obj.key);
    return key.length >= 32
      ? { room: obj.room, key, host: typeof obj.h === 'string' ? obj.h : '' }
      : null;
  } catch { return null; }
}

export function makeInvite(room, key, host) {
  const obj = { v: 1, room, key: b64u.enc(key) };
  if (host) obj.h = host;
  return `${location.origin}/j#${b64u.enc(te.encode(JSON.stringify(obj)))}`;
}
