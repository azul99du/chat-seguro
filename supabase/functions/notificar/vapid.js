// VAPID (RFC 8292): identifica o servidor perante os serviços de push do navegador (Google, Mozilla, Apple).
// Só usa WebCrypto, por isso roda igual no Deno (função do Supabase) e no Node (testes).
export const b64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); };
export const desb64u = (t) => Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(t.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const txt = (o) => b64u(new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o)));

// Par de chaves P-256: a pública (65 bytes, base64url) vai para o navegador; a privada (JWK) fica só no servidor.
export async function gerarChaves() {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publica: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey))), privadaJwk: await crypto.subtle.exportKey("jwk", par.privateKey) };
}

// Token JWT (ES256) válido por no máximo 24 h, para UM serviço de push (audiência = origem do endereço da inscrição).
export async function jwtVapid(privadaJwk, endpoint, assunto, agora = Date.now(), validadeSeg = 12 * 3600) {
  if (!/^https:\/\//.test(assunto) && !/^mailto:/.test(assunto)) throw new Error("assunto invalido");
  const aud = new URL(endpoint).origin, corpo = `${txt({ typ: "JWT", alg: "ES256" })}.${txt({ aud, exp: Math.floor(agora / 1000) + Math.min(validadeSeg, 24 * 3600 - 60), sub: assunto })}`;
  const chave = await crypto.subtle.importKey("jwk", privadaJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, new TextEncoder().encode(corpo))); // já vem em r||s (64 bytes), como o JWT pede
  return `${corpo}.${b64u(assinatura)}`;
}
export const cabecalhoVapid = (jwt, publica) => `vapid t=${jwt}, k=${publica}`;
