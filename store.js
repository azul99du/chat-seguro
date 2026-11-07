// Armazenamento LOCAL do sigilo futuro: sessões, histórico e chaves de médio prazo (SPK).
// Tudo é cifrado com uma chave AES não extraível guardada no próprio navegador. Fica em outro banco
// ("lacre-sf") para não interferir nas chaves de identidade.
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open("lacre-sf", 3);
  r.onupgradeneeded = () => { for (const n of ["sessions", "history", "meta", "stickers", "blobs", "blobmeta"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (stores, mode) => (await dbp).transaction(stores, mode);
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function localKey(uid) {
  const t = await tx(["meta"], "readwrite"), s = t.objectStore("meta");
  let k = await req(s.get("lk:" + uid));
  if (!k) { k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); s.put(k, "lk:" + uid); }
  await done(t); return k;
}
async function seal(uid, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await localKey(uid), new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
async function unseal(uid, rec) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, await localKey(uid), unb64(rec.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
const sKey = (uid, peer, sid) => `${uid}|${peer}|${sid}`;
const hKey = (uid, peer, id) => `${uid}|${peer}|${String(id).padStart(12, "0")}`;
const range = (prefix) => IDBKeyRange.bound(prefix, prefix + "￿");

// Grava sessão + (opcionalmente) mensagem lida, tudo na MESMA transação: ou grava os dois ou nenhum.
// Isso evita perder uma mensagem depois de a chave dela já ter sido consumida.
export async function commit(uid, peer, { session, active, entryId, entry }) {
  const sealedS = session ? await seal(uid, session) : null, sealedH = entry ? await seal(uid, entry) : null;
  const t = await tx(["sessions", "history", "meta"], "readwrite");
  if (session) t.objectStore("sessions").put({ ...sealedS, t: Date.now() }, sKey(uid, peer, session.sid));
  if (active) t.objectStore("meta").put(active, `act:${uid}|${peer}`);
  if (entry) t.objectStore("history").put(sealedH, hKey(uid, peer, entryId));
  await done(t);
  if (session) await pruneSessions(uid, peer, active || session.sid);
}
export async function getSession(uid, peer, sid) {
  const r = await req((await tx(["sessions"], "readonly")).objectStore("sessions").get(sKey(uid, peer, sid)));
  return r ? unseal(uid, r) : null;
}
export async function getActive(uid, peer) { return req((await tx(["meta"], "readonly")).objectStore("meta").get(`act:${uid}|${peer}`)); }
export async function listSessions(uid, peer) {
  const t = await tx(["sessions"], "readonly"), s = t.objectStore("sessions"), rng = range(`${uid}|${peer}|`);
  const [keys, vals] = await Promise.all([req(s.getAllKeys(rng)), req(s.getAll(rng))]);
  const out = []; for (let i = 0; i < keys.length; i++) { try { out.push({ rec: vals[i], st: await unseal(uid, vals[i]) }); } catch {} }
  return out.sort((a, b) => b.rec.t - a.rec.t).map((x) => x.st);
}
async function pruneSessions(uid, peer, keep) { // no máximo 6 sessões por conversa (apaga as mais antigas)
  const t = await tx(["sessions"], "readwrite"), s = t.objectStore("sessions"), rng = range(`${uid}|${peer}|`);
  const [keys, vals] = await Promise.all([req(s.getAllKeys(rng)), req(s.getAll(rng))]);
  const rows = keys.map((k, i) => ({ k, t: vals[i].t })).filter((r) => !r.k.endsWith("|" + keep)).sort((a, b) => b.t - a.t);
  rows.slice(5).forEach((r) => s.delete(r.k)); await done(t);
}
export async function getHistory(uid, peer, id) {
  const r = await req((await tx(["history"], "readonly")).objectStore("history").get(hKey(uid, peer, id)));
  return r ? unseal(uid, r) : null;
}

// ---------- SPK (chave de médio prazo) ----------
export async function getSpks(uid) {
  const r = await req((await tx(["meta"], "readonly")).objectStore("meta").get("spk:" + uid));
  return r ? unseal(uid, r) : [];
}
async function putSpks(uid, list) { const s = await seal(uid, list); const t = await tx(["meta"], "readwrite"); t.objectStore("meta").put(s, "spk:" + uid); await done(t); }
export async function addSpk(uid, spk) { await putSpks(uid, [...(await getSpks(uid)), spk]); }
export async function removeSpk(uid, id) { await putSpks(uid, (await getSpks(uid)).filter((s) => s.id !== id)); }
export async function pruneSpks(uid, cutoff) { // apagar a chave privada é o que dá sigilo futuro à 1ª mensagem de cada sessão
  const list = await getSpks(uid), keep = list.filter((s) => s.created >= cutoff);
  if (keep.length !== list.length) await putSpks(uid, keep);
}

// ---------- Figurinhas (biblioteca pessoal, só neste aparelho, cifrada como o resto) ----------
const stKey = (uid, id) => `${uid}|${id}`;
export async function listStickers(uid) {
  const t = await tx(["stickers"], "readonly"), s = t.objectStore("stickers"), rng = range(uid + "|");
  const vals = await req(s.getAll(rng)), out = [];
  for (const v of vals) { try { const o = await unseal(uid, v); out.push({ ...o, bytes: unb64(o.b) }); } catch {} }
  return out;
}
export async function putSticker(uid, st) { // st: { id, mime, w, h, anim, t, u, bytes }
  const { bytes, ...resto } = st, rec = await seal(uid, { ...resto, b: b64(bytes) });
  const t = await tx(["stickers"], "readwrite"); t.objectStore("stickers").put(rec, stKey(uid, st.id)); await done(t);
}
export async function delSticker(uid, id) { const t = await tx(["stickers"], "readwrite"); t.objectStore("stickers").delete(stKey(uid, id)); await done(t); }

// ---------- Cache de arquivos baixados (áudio, foto, figurinha) ----------
// Guarda o arquivo CIFRADO do jeito que está no servidor (a chave de cada arquivo fica só dentro das mensagens, que já são guardadas cifradas aqui).
// Assim ouvir/ver de novo não baixa nada. Limite total com descarte dos menos usados.
export const BLOB_MAX = 150 * 1048576, BLOB_ARQUIVO_MAX = 8 * 1048576;
const bKey = (uid, path) => `${uid}|${path}`;
export async function getBlob(uid, path) {
  const r = await req((await tx(["blobs"], "readonly")).objectStore("blobs").get(bKey(uid, path)));
  if (!r) return null;
  tx(["blobmeta"], "readwrite").then((t) => t.objectStore("blobmeta").put({ t: Date.now(), n: r.byteLength }, bKey(uid, path))).catch(() => {}); // marca como usado agora
  return new Uint8Array(r);
}
export async function hasBlob(uid, path) { return (await req((await tx(["blobs"], "readonly")).objectStore("blobs").getKey(bKey(uid, path)))) !== undefined; }
export async function putBlob(uid, path, bytes) {
  if (bytes.byteLength > BLOB_ARQUIVO_MAX) return;
  const t = await tx(["blobs", "blobmeta"], "readwrite"), k = bKey(uid, path);
  t.objectStore("blobs").put(bytes.slice().buffer, k); t.objectStore("blobmeta").put({ t: Date.now(), n: bytes.byteLength }, k); await done(t);
  await pruneBlobs(uid);
}
export async function delBlob(uid, path) { const t = await tx(["blobs", "blobmeta"], "readwrite"), k = bKey(uid, path); t.objectStore("blobs").delete(k); t.objectStore("blobmeta").delete(k); await done(t); }
async function pruneBlobs(uid) { // passou do limite: apaga os usados há mais tempo até sobrar 80%
  const t = await tx(["blobs", "blobmeta"], "readwrite"), m = t.objectStore("blobmeta"), rng = range(uid + "|");
  const [keys, vals] = await Promise.all([req(m.getAllKeys(rng)), req(m.getAll(rng))]);
  let total = vals.reduce((a, v) => a + (v?.n || 0), 0); if (total <= BLOB_MAX) return done(t);
  const ordem = keys.map((k, i) => ({ k, t: vals[i]?.t || 0, n: vals[i]?.n || 0 })).sort((a, b) => a.t - b.t);
  for (const x of ordem) { if (total <= BLOB_MAX * 0.8) break; t.objectStore("blobs").delete(x.k); m.delete(x.k); total -= x.n; }
  await done(t);
}
export async function blobsUsados(uid) { const vals = await req((await tx(["blobmeta"], "readonly")).objectStore("blobmeta").getAll(range(uid + "|"))); return { arquivos: vals.length, bytes: vals.reduce((a, v) => a + (v?.n || 0), 0) }; }

// ---------- Limpeza e trava entre abas ----------
export async function wipeLocal(uid) {
  const t = await tx(["sessions", "history", "meta", "stickers", "blobs", "blobmeta"], "readwrite");
  for (const n of ["sessions", "history", "stickers", "blobs", "blobmeta"]) {
    const s = t.objectStore(n), keys = await req(s.getAllKeys(range(uid + "|"))); keys.forEach((k) => s.delete(k));
  }
  const m = t.objectStore("meta"); const mk = await req(m.getAllKeys());
  mk.filter((k) => String(k).includes(uid)).forEach((k) => m.delete(k));
  await done(t);
}
// Duas abas abertas não podem avançar a mesma sessão ao mesmo tempo
export const withLock = (name, fn) => (navigator.locks ? navigator.locks.request(name, fn) : fn());
