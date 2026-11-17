import test from "node:test";
import assert from "node:assert/strict";
import { limpaSinal, limpaConteudo, conteudo, textoDigitando, aindaDigitando, PARA_MS, REENVIO_MS, VALE_MS, IDADE_MAX_MS } from "../digitando.js";

test("prazos: renova antes de vencer e retira depois de parar", () => { assert.ok(REENVIO_MS < VALE_MS); assert.ok(PARA_MS > REENVIO_MS); });
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
test("limpaSinal só aceita o formato esperado", () => {
  assert.deepEqual(limpaSinal({ u: U1, c: "abcdefghij", i: "abcdefghijkl", x: 1 }), { u: U1, c: "abcdefghij", i: "abcdefghijkl" });
  for (const ruim of [null, "x", {}, { u: "x", c: "abcdefghij", i: "abcdefghijkl" }, { u: U1, c: 1, i: "abcdefghij" }, { u: U1, c: "curto", i: "abcdefghij" }, { u: U1, c: "a".repeat(401), i: "abcdefghij" }, { u: U1, c: "abcdefghij", i: "a".repeat(41) }]) assert.equal(limpaSinal(ruim), null);
});
test("conteudo e limpaConteudo: valem só dentro do prazo e com ids de verdade", () => {
  const agora = 1_000_000;
  assert.deepEqual(limpaConteudo(conteudo(U2, U1, agora), agora), { c: U2, u: U1, t: agora, s: false });
  assert.equal(limpaConteudo(conteudo(U2, U1, agora, true), agora).s, true, "parou");
  assert.equal(limpaConteudo(conteudo(U2, U1, agora - IDADE_MAX_MS - 1), agora), null, "velho demais (aviso copiado)");
  assert.equal(limpaConteudo(conteudo(U2, U1, agora + IDADE_MAX_MS + 1), agora), null, "do futuro");
  assert.equal(limpaConteudo({ c: "x", u: U1, t: agora }, agora), null); assert.equal(limpaConteudo(null, agora), null); assert.equal(limpaConteudo({ c: U2, u: U1, t: "agora" }, agora), null);
});
test("textoDigitando: um, dois, vários, vazio e repetidos", () => {
  assert.equal(textoDigitando([]), ""); assert.equal(textoDigitando(null), "");
  assert.equal(textoDigitando(["Ana"]), "Ana está digitando…");
  assert.equal(textoDigitando(["Ana", "Bia"]), "Ana e Bia estão digitando…");
  assert.equal(textoDigitando(["Ana", "Bia", "Caio", "Davi"]), "Ana, Bia e mais 2 estão digitando…");
  assert.equal(textoDigitando(["Ana", "Ana", " "]), "Ana está digitando…");
});
test("aindaDigitando separa quem venceu e diz quando conferir de novo", () => {
  const m = new Map([["a", { ate: 1500 }], ["b", { ate: 1200 }], ["c", { ate: 900 }]]);
  const r = aindaDigitando(m, 1000); assert.equal(r.vivos.length, 2); assert.equal(r.proximo, 200);
  assert.deepEqual(aindaDigitando(new Map(), 1000), { vivos: [], proximo: 0 });
});
