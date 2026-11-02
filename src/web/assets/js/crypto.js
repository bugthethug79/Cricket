export const te = new TextEncoder();
export const td = new TextDecoder();

export const b64u = {
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

export async function deriveKeys(key) {
  const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('cricket/v1'), info: te.encode(info) });
  const auth = new Uint8Array(await crypto.subtle.deriveBits(params('auth'), base, 256));
  const chatKey = await crypto.subtle.deriveKey(params('chat'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { auth, chatKey };
}

export async function encryptChat(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ text })),
  ));
  return { iv: b64u.enc(iv), ct: b64u.enc(ct) };
}

export async function decryptChat(key, data) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64u.dec(data.iv) }, key, b64u.dec(data.ct),
  );
  const { text } = JSON.parse(td.decode(plain));
  return text;
}
