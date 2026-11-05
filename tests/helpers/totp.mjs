// Gerador de código TOTP (RFC 6238: HMAC-SHA1, 6 dígitos, passo de 30 s), igual ao de um app autenticador.
import { createHmac } from "node:crypto";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s) {
  let bits = "", out = [];
  for (const c of s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret, tempo = Date.now()) {
  const contador = Buffer.alloc(8); contador.writeBigUInt64BE(BigInt(Math.floor(tempo / 30000)));
  const h = createHmac("sha1", base32(secret)).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, "0");
}
