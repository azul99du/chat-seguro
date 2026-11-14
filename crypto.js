// E2EE com WebCrypto: ECDH P-256 -> chave AES-GCM compartilhada por par de usuarios.
// A chave privada fica no IndexedDB; so sai do aparelho cifrada por uma frase-senha (backup).
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ECDH = { name: "ECDH", namedCurve: "P-256" };

const dbp = new Promise((res, rej) => {
  const r = indexedDB.open("chat-seguro", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("keys");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const idb = async (mode, fn) => {
  const db = await dbp;
  return new Promise((res, rej) => {
    const req = fn(db.transaction("keys", mode).objectStore("keys"));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

export const getLocalKeys = (uid) => idb("readonly", (s) => s.get(uid));

// Gera o par de chaves. Privada nao extraivel; publica exportada em JWK para o banco.
export async function createKeys(uid) {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
  await idb("readwrite", (s) => s.put(pair, uid));
  return crypto.subtle.exportKey("jwk", pair.publicKey);
}

const sharedCache = new Map();
async function sharedKey(myPrivate, theirPublicJwk) {
  const id = JSON.stringify(theirPublicJwk);
  if (sharedCache.has(id)) return sharedCache.get(id);
  const pub = await crypto.subtle.importKey("jwk", theirPublicJwk, ECDH, false, []);
  const key = await crypto.subtle.deriveKey(
    { name: "ECDH", public: pub }, myPrivate,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  sharedCache.set(id, key);
  return key;
}

export async function encrypt(myPrivate, theirPublicJwk, text) {
  const key = await sharedKey(myPrivate, theirPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decrypt(myPrivate, theirPublicJwk, { ciphertext, iv }) {
  const key = await sharedKey(myPrivate, theirPublicJwk);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ciphertext));
  return new TextDecoder().decode(pt);
}

// ---------- Backup da chave privada, protegido por frase-senha ----------
async function passKey(pass, salt, usage) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, usage);
}

export async function makeBackup(uid, pass) {
  const { privateKey } = await getLocalKeys(uid);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await passKey(pass, salt, ["encrypt"]),
    new TextEncoder().encode(JSON.stringify(jwk)));
  return { salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

// Lanca erro se a frase-senha estiver errada.
export async function restoreBackup(uid, pass, backup, publicJwk) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(backup.iv) },
    await passKey(pass, unb64(backup.salt), ["decrypt"]), unb64(backup.data));
  const jwk = JSON.parse(new TextDecoder().decode(pt));
  // a chave restaurada precisa ser a MESMA que está publicada no perfil (evita backup trocado)
  if (jwk.x !== publicJwk.x || jwk.y !== publicJwk.y) throw new Error("backup nao corresponde ao perfil");
  const privateKey = await crypto.subtle.importKey("jwk", jwk, ECDH, true, ["deriveKey"]);
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, ECDH, true, []);
  await idb("readwrite", (st) => st.put({ privateKey, publicKey }, uid));
}

// ---------- Verificação de chaves (anti "homem no meio"): funções puras em verify.js ----------
export { fingerprint, safetyCode, mesmaChavePublica } from "./verify.js?v=5fd5270bfb";
export const deleteLocalKeys = (uid) => idb("readwrite", (s) => s.delete(uid));
