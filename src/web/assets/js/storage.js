import { b64u } from './crypto.js';

export const store = {
  get(key) { try { return sessionStorage.getItem('cricket.' + key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem('cricket.' + key, value); } catch { } },
};

export function client_id() {
  let id = store.get('client_id');
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = b64u.enc(crypto.getRandomValues(new Uint8Array(18)));
    store.set('client_id', id);
  }
  return id;
}
