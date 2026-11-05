// Sigilo futuro: acordo de chaves "3DH" (X3DH sem chaves de uso único) + Double Ratchet.
// Só WebCrypto. Todo o estado é JSON puro (chaves em JWK / base64), para guardar cifrado no aparelho.
//
// Ideia: cada mensagem usa uma chave NOVA, derivada da anterior por uma função de mão única, e a chave
// antiga é apagada. Quem roubar o estado de hoje não consegue decifrar mensagens de ontem (sigilo futuro)
// e, depois que os dois lados trocarem novas chaves DH, também não consegue ler as de amanhã (autocura).
const enc = new TextEncoder(), dec = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const MAX_SKIP = 500;          // quantas mensagens perdidas/fora de ordem toleramos por salto
const MAX_SKIPPED_STORED = 1000;
const ZERO = new Uint8Array(32);

export const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
export const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");

const privJwk = (j) => ({ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, ext: true }); // tira key_ops (a chave de identidade só tinha "deriveKey")
const pubJwk = (p) => ({ kty: "EC", crv: "P-256", x: p.x, y: p.y, ext: true });

export async function genDH() {
  const k = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const j = await crypto.subtle.exportKey("jwk", k.privateKey);
  return { pub: { x: j.x, y: j.y }, priv: privJwk(j) };
}
async function dh(priv, pub) {
  const k = await crypto.subtle.importKey("jwk", privJwk(priv), ECDH, false, ["deriveBits"]);
  const p = await crypto.subtle.importKey("jwk", pubJwk(pub), ECDH, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: p }, k, 256));
}
async function hkdf(ikm, salt, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) }, k, bytes * 8));
}
async function hmac(key, byte) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array([byte])));
}
async function kdfRK(rk, dhOut) { const o = await hkdf(dhOut, rk, "lacre/rk", 64); return { rk: o.slice(0, 32), ck: o.slice(32) }; }
async function kdfCK(ck) { return { mk: await hmac(ck, 1), ck: await hmac(ck, 2) }; }
async function msgKey(mk) {
  const o = await hkdf(mk, ZERO, "lacre/mk", 44);
  return { key: await crypto.subtle.importKey("raw", o.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]), iv: o.slice(32) };
}
const canon = (o) => Array.isArray(o) ? "[" + o.map(canon).join(",") + "]"
  : o && typeof o === "object" ? "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}" : JSON.stringify(o);
// Dados autenticados: liga a mensagem a quem envia, a quem recebe e ao cabeçalho (o servidor não pode redirecionar nem adulterar)
const aad = (from, to, header) => enc.encode(`lacre2|${from}|${to}|${canon(header)}`);
const dhId = (p) => p.x + "." + p.y;

// ---------- Início da sessão ----------
// Quem começa (A) usa a identidade de B (IKb) e a chave de médio prazo de B (SPKb) publicada no servidor.
// Mesmo que o servidor troque a SPK por outra, não consegue calcular DH(EKa, IKb): só B consegue.
export async function initiate(myIkPriv, peerIk, peerSpk) {
  const ek = await genDH();
  const sk = await hkdf(cat(await dh(myIkPriv, peerSpk), await dh(ek.priv, peerIk), await dh(ek.priv, peerSpk)), ZERO, "lacre/x3dh", 32);
  const dhs = await genDH();
  const { rk, ck } = await kdfRK(sk, await dh(dhs.priv, peerSpk));
  return {
    sid: randomHex(16), role: "i", rk: b64(rk), dhs, dhr: { x: peerSpk.x, y: peerSpk.y }, cks: b64(ck), ckr: null,
    ns: 0, nr: 0, pn: 0, skipped: [], init: { ek: ek.pub, spk: peerSpk.id }, created: Date.now(), // a privada de EK é descartada aqui
  };
}
export async function accept(myIkPriv, peerIk, spk, header) {
  const ek = header.init.ek;
  const sk = await hkdf(cat(await dh(spk.priv, peerIk), await dh(myIkPriv, ek), await dh(spk.priv, ek)), ZERO, "lacre/x3dh", 32);
  return {
    sid: header.sid, role: "r", rk: b64(sk), dhs: { pub: { x: spk.priv.x, y: spk.priv.y }, priv: spk.priv }, dhr: null, cks: null, ckr: null,
    ns: 0, nr: 0, pn: 0, skipped: [], init: null, created: Date.now(),
  };
}
export const canSend = (st) => !!st.cks;

// ---------- Cifrar ----------
export async function encrypt(st0, from, to, plaintext) {
  const st = structuredClone(st0);
  if (!st.cks) throw new Error("sessao sem cadeia de envio");
  const r = await kdfCK(unb64(st.cks)); st.cks = b64(r.ck);
  const header = { sid: st.sid, dh: { x: st.dhs.pub.x, y: st.dhs.pub.y }, pn: st.pn, n: st.ns };
  if (st.init) header.init = st.init;
  st.ns++;
  const { key, iv } = await msgKey(r.mk); // r.mk sai de escopo aqui: a chave da mensagem não é guardada
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(from, to, header) }, key, plaintext);
  return { state: st, header, ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

// ---------- Decifrar ----------
export function validHeader(h) {
  const hex = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
  const pt = (p) => p && typeof p.x === "string" && typeof p.y === "string" && p.x.length < 100 && p.y.length < 100;
  const int = (n) => Number.isInteger(n) && n >= 0 && n < 1e7;
  return h && hex(h.sid) && pt(h.dh) && int(h.n) && int(h.pn) && (h.init === undefined || (pt(h.init.ek) && hex(h.init.spk)));
}
async function skipTo(st, until) {
  if (!st.ckr) return;
  if (until - st.nr > MAX_SKIP) throw new Error("salto grande demais");
  while (st.nr < until) {
    const r = await kdfCK(unb64(st.ckr)); st.ckr = b64(r.ck);
    st.skipped.push({ dh: dhId(st.dhr), n: st.nr, mk: b64(r.mk) }); st.nr++;
  }
  if (st.skipped.length > MAX_SKIPPED_STORED) st.skipped.splice(0, st.skipped.length - MAX_SKIPPED_STORED);
}
async function dhRatchet(st, theirDh) {
  st.pn = st.ns; st.ns = 0; st.nr = 0; st.dhr = { x: theirDh.x, y: theirDh.y }; st.init = null;
  let r = await kdfRK(unb64(st.rk), await dh(st.dhs.priv, st.dhr)); st.rk = b64(r.rk); st.ckr = b64(r.ck);
  st.dhs = await genDH(); // chave DH nova a cada virada: é isso que "cura" o sigilo depois de um vazamento
  r = await kdfRK(unb64(st.rk), await dh(st.dhs.priv, st.dhr)); st.rk = b64(r.rk); st.cks = b64(r.ck);
}
// Só devolve o novo estado se a mensagem for autêntica; senão lança erro e o estado antigo continua valendo.
export async function decrypt(st0, from, to, header, ciphertext) {
  if (!validHeader(header)) throw new Error("cabecalho invalido");
  const st = structuredClone(st0), id = dhId(header.dh);
  const i = st.skipped.findIndex((s) => s.dh === id && s.n === header.n);
  let mk;
  if (i >= 0) { mk = unb64(st.skipped[i].mk); st.skipped.splice(i, 1); }
  else {
    if (!st.dhr || id !== dhId(st.dhr)) { await skipTo(st, header.pn); await dhRatchet(st, header.dh); }
    if (header.n < st.nr) throw new Error("mensagem repetida");
    await skipTo(st, header.n);
    const r = await kdfCK(unb64(st.ckr)); st.ckr = b64(r.ck); st.nr++; mk = r.mk;
  }
  const { key, iv } = await msgKey(mk);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(from, to, header) }, key, unb64(ciphertext));
  return { state: st, plaintext: new Uint8Array(pt) };
}
export const text = (u8) => dec.decode(u8);
export const bytes = (s) => enc.encode(s);
