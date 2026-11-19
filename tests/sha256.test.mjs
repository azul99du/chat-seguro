import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Sha256, sha256Hex } from "../sha256.js";
const ref = (b) => createHash("sha256").update(b).digest("hex");

test("valores conhecidos", () => {
  assert.equal(sha256Hex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(new TextEncoder().encode("a".repeat(1000000))), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});
test("igual ao do Node para tamanhos de borda (0, 55, 56, 63, 64, 65, 119, 120, 128, 1000)", () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) { const b = randomBytes(n); assert.equal(sha256Hex(b), ref(b), `n=${n}`); }
});
test("em pedaços de qualquer tamanho dá o mesmo resultado que de uma vez", () => {
  const b = randomBytes(300000), esperado = ref(b);
  for (const passo of [1, 7, 63, 64, 65, 1000, 4096, 65536, 299999]) { const s = new Sha256(); for (let i = 0; i < b.length; i += passo) s.update(b.subarray(i, Math.min(b.length, i + passo))); assert.equal(s.hex(), esperado, `passo=${passo}`); }
});
test("hex() pode ser pedido duas vezes; depois de terminar não aceita mais dados", () => {
  const s = new Sha256().update(new TextEncoder().encode("abc")); const a = s.hex(); assert.equal(s.hex(), a); assert.throws(() => s.update(new Uint8Array(1)), /já terminou/);
});
test("aceita Uint8Array, Buffer e visões de ArrayBuffer", () => {
  const b = randomBytes(1000); assert.equal(sha256Hex(new Uint8Array(b)), ref(b)); assert.equal(sha256Hex(b), ref(b)); assert.equal(sha256Hex(new Uint8Array(b.buffer, b.byteOffset + 10, 500)), ref(b.subarray(10, 510)));
});
test("velocidade: 64 MB em tempo razoável (o modelo tem 876 MB)", () => {
  const b = randomBytes(64 * 1048576), t0 = performance.now(); const h = sha256Hex(b), ms = performance.now() - t0; assert.equal(h, ref(b)); assert.ok(ms < 8000, `demorou ${Math.round(ms)} ms`);
});
