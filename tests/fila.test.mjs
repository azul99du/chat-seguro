import test from "node:test";
import assert from "node:assert/strict";
import { ehFalhaDeRede, podeEnfileirar, novoItem, limpaFila, cabeNaFila, daConversa, semItem, FILA_MAX, FILA_VALIDADE_MS, MAX_TEXTO_FILA } from "../fila.js";

test("falha de rede: sem internet é sempre rede; com resposta do servidor não é", () => {
  assert.equal(ehFalhaDeRede(null, false), true);
  assert.equal(ehFalhaDeRede(new TypeError("Failed to fetch"), true), true);
  assert.equal(ehFalhaDeRede({ message: "TypeError: NetworkError when attempting to fetch resource." }, true), true);
  assert.equal(ehFalhaDeRede({ message: "Load failed" }, true), true);
  assert.equal(ehFalhaDeRede({ code: "PIN", message: "chave mudou" }, true), false);
  assert.equal(ehFalhaDeRede({ status: 429, message: "limite de envios" }, true), false);
  assert.equal(ehFalhaDeRede({ code: "NO_PREKEY" }, true), false);
  assert.equal(ehFalhaDeRede(null, true), false);
});

test("só texto entra na fila", () => {
  assert.equal(podeEnfileirar({ type: "text", text: "oi" }), true);
  assert.equal(podeEnfileirar({ type: "text", text: "   " }), false);
  assert.equal(podeEnfileirar({ type: "media", kind: "image" }), false);
  assert.equal(podeEnfileirar(null), false);
});

test("novoItem guarda a citação e corta o texto enorme", () => {
  const it = novoItem({ id: "u1", grupo: false }, { type: "text", text: "a".repeat(MAX_TEXTO_FILA + 50), re: { mid: "x" }, lixo: 1 }, 1000);
  assert.equal(it.content.text.length, MAX_TEXTO_FILA); assert.deepEqual(it.content.re, { mid: "x" }); assert.equal(it.content.lixo, undefined);
  assert.equal(it.conv, "u1"); assert.equal(it.grupo, false); assert.ok(it.id.length > 4);
  assert.notEqual(novoItem({ id: "u1" }, { text: "oi" }, 1000).id, novoItem({ id: "u1" }, { text: "oi" }, 1000).id);
});

test("limpaFila: descarta lixo e o que venceu, mantém a ordem e o limite", () => {
  const agora = 10 * FILA_VALIDADE_MS;
  const bom = (i, at = agora - 1000) => ({ id: "i" + i, conv: "c", grupo: false, content: { type: "text", text: "t" + i }, at });
  assert.deepEqual(limpaFila("x", agora), []);
  const r = limpaFila([bom(1), null, { id: 5 }, bom(2, agora - FILA_VALIDADE_MS - 1), { ...bom(3), content: { type: "media" } }, bom(4)], agora);
  assert.deepEqual(r.map((i) => i.id), ["i1", "i4"]);
  const muitos = Array.from({ length: FILA_MAX + 5 }, (_, i) => bom(i));
  const l = limpaFila(muitos, agora); assert.equal(l.length, FILA_MAX); assert.equal(l.at(-1).id, "i" + (FILA_MAX + 4));
});

test("ajudantes da fila", () => {
  const f = [novoItem({ id: "a" }, { text: "1" }, 1, "x1"), novoItem({ id: "b", grupo: true }, { text: "2" }, 2, "x2")];
  assert.deepEqual(daConversa(f, "b").map((i) => i.id), ["x2"]);
  assert.deepEqual(semItem(f, "x1").map((i) => i.id), ["x2"]);
  assert.equal(cabeNaFila(f), true); assert.equal(cabeNaFila(new Array(FILA_MAX).fill(0)), false);
});
