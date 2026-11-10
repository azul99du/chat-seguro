import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, safetyCode } from "../verify.js";
import { genDH } from "../ratchet.js";

test("código de segurança: 12 grupos de 5 dígitos, igual para os dois lados", async () => {
  const a = (await genDH()).pub, b = (await genDH()).pub;
  const k = (p) => ({ kty: "EC", crv: "P-256", ...p });
  const c1 = await safetyCode(k(a), k(b)), c2 = await safetyCode(k(b), k(a));
  assert.equal(c1.length, 12);
  assert.ok(c1.every((g) => /^\d{5}$/.test(g)));
  assert.deepEqual(c1, c2);
});
test("código muda se QUALQUER chave mudar (detecta troca de chave)", async () => {
  const k = (p) => ({ kty: "EC", crv: "P-256", ...p });
  const a = k((await genDH()).pub), b = k((await genDH()).pub), evil = k((await genDH()).pub);
  assert.notDeepEqual(await safetyCode(a, b), await safetyCode(a, evil));
});
test("fingerprint ignora campos extras do JWK e distingue chaves", async () => {
  const p = (await genDH()).pub, q = (await genDH()).pub;
  const f1 = await fingerprint({ kty: "EC", crv: "P-256", ...p }), f2 = await fingerprint({ kty: "EC", crv: "P-256", ...p, ext: true, key_ops: [] });
  assert.equal(f1, f2);
  assert.notEqual(f1, await fingerprint({ kty: "EC", crv: "P-256", ...q }));
  assert.match(f1, /^[0-9a-f]{64}$/);
});
import { mesmaChavePublica } from "../verify.js";
test("mesmaChavePublica: compara só x/y e recusa vazio ou chave diferente", async () => {
  const p = (await genDH()).pub, q = (await genDH()).pub;
  assert.ok(mesmaChavePublica({ kty: "EC", ...p }, { crv: "P-256", ...p }));
  assert.ok(!mesmaChavePublica(p, q));
  assert.ok(!mesmaChavePublica(p, null));
  assert.ok(!mesmaChavePublica(undefined, p));
});
