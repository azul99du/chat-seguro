// Verificação de chaves (anti "homem no meio"). Funções puras: não dependem do navegador, então são testadas em Node.
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function fingerprint(jwk) {
  const c = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c)));
}
// 12 grupos de 5 dígitos, iguais para os dois lados da conversa
export async function safetyCode(a, b) {
  const [fa, fb] = (await Promise.all([fingerprint(a), fingerprint(b)])).sort();
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fa + fb)));
  return Array.from({ length: 12 }, (_, i) => String(((h[2 * i] << 8) | h[2 * i + 1]) % 100000).padStart(5, "0"));
}
// compara duas chaves públicas JWK (P-256) pelas coordenadas
export const mesmaChavePublica = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
