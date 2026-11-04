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

export async function deriveAuth(key) {
  const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits']);
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('cricket/v1'), info: te.encode(info) });
  return new Uint8Array(await crypto.subtle.deriveBits(params('auth'), base, 256));
}
