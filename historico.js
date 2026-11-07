// Arquivo de histórico para trocar de aparelho: tudo cifrado com uma senha própria (AES-256-GCM, chave derivada por PBKDF2-SHA256 com 1.000.000 de voltas).
// O arquivo só abre na MESMA conta (o id da conta entra como dado autenticado) e nunca vai para o servidor.
const ITER = 1_000_000, MAGIC = "lacre-historico", MAX_ARQUIVO = 50 * 1048576, MAX_ITENS = 200000;
const ALFA = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 símbolos, sem letras que se confundem (i, l, o, 0, 1)
export const MIN_SENHA_ARQUIVO = 16;
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = (s) => new TextEncoder().encode(s);

// 20 símbolos sorteados (~99 bits), em 5 grupos de 4: fácil de anotar e impossível de adivinhar.
export function gerarSenha() {
  let out = ""; const lim = 256 - (256 % ALFA.length);
  while (out.length < 20) for (const b of crypto.getRandomValues(new Uint8Array(32))) { if (b < lim && out.length < 20) out += ALFA[b % ALFA.length]; }
  return out.match(/.{4}/g).join("-");
}
// quem digita a senha gerada pode errar maiúsculas, espaços ou hífens
export function variantes(senha) {
  const a = String(senha).trim(), solta = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [...new Set([a, solta.length === 20 ? solta.match(/.{4}/g).join("-") : a])];
}
async function chave(senha, salt, uso) {
  const base = await crypto.subtle.importKey("raw", enc(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, uso);
}
const aad = (uid) => enc(`${MAGIC}|v1|${uid}`);

export async function empacotar(uid, itens, senha) {
  if (typeof senha !== "string" || senha.length < MIN_SENHA_ARQUIVO) throw new Error("senha curta");
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(uid) }, await chave(senha, salt, ["encrypt"]), enc(JSON.stringify(itens)));
  return JSON.stringify({ formato: MAGIC, v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
}
// Erros: "formato" (não é um arquivo nosso), "senha" (senha errada, arquivo de outra conta ou arquivo alterado)
export async function abrir(uid, texto, senha) {
  if (typeof texto !== "string" || texto.length > MAX_ARQUIVO * 1.4) throw new Error("formato");
  let f; try { f = JSON.parse(texto); } catch { throw new Error("formato"); }
  if (f?.formato !== MAGIC || f.v !== 1 || ![f.salt, f.iv, f.data].every((x) => typeof x === "string")) throw new Error("formato");
  let salt, iv, data; try { [salt, iv, data] = [unb64(f.salt), unb64(f.iv), unb64(f.data)]; } catch { throw new Error("formato"); }
  if (salt.length !== 16 || iv.length !== 12) throw new Error("formato");
  for (const s of variantes(senha)) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(uid) }, await chave(s, salt, ["decrypt"]), data);
      return validar(JSON.parse(new TextDecoder().decode(pt)));
    } catch (e) { if (e?.message === "formato") throw e; }
  }
  throw new Error("senha");
}
const UUID = /^[0-9a-f-]{36}$/;
// só entram itens bem formados (mesmo vindo de um arquivo nosso)
export function validar(itens) {
  if (!Array.isArray(itens) || itens.length > MAX_ITENS) throw new Error("formato");
  return itens.filter((x) => x && typeof x === "object" && UUID.test(x.p) && Number.isSafeInteger(x.i) && x.i > 0
    && x.e && typeof x.e === "object" && x.e.content && typeof x.e.content === "object" && typeof x.e.content.type === "string" && x.e.content.type.length <= 30
    && (x.e.at == null || typeof x.e.at === "string"));
}
