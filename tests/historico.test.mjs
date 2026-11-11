import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarSenha, empacotar, abrir, variantes, validar } from "../historico.js";
const U = "123e4567-e89b-12d3-a456-426614174000", V = "123e4567-e89b-12d3-a456-426614174999", P = "123e4567-e89b-12d3-a456-426614174001";
const TEXTO = "mensagem-secreta-do-teste"; // (comprido de propósito: um texto de 2 letras como "oi" aparece por acaso no arquivo cifrado em ~4% das vezes, e o teste falhava à toa)
const itens = [{ p: P, i: 5, e: { content: { type: "text", text: TEXTO }, at: "2026-01-01T00:00:00Z", mine: true } }];
test("senha gerada: 20 símbolos em grupos, sem repetir entre chamadas", () => {
  const a = gerarSenha(), b = gerarSenha();
  assert.match(a, /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){4}$/); assert.notEqual(a, b);
});
test("ida e volta; aceita a senha gerada digitada com espaços/maiúsculas", async () => {
  const s = gerarSenha(), f = await empacotar(U, itens, s);
  assert.deepEqual(await abrir(U, f, s), itens);
  assert.deepEqual(await abrir(U, f, s.toUpperCase().replaceAll("-", " ")), itens);
  assert.ok(!f.includes(TEXTO) && !f.includes(P), "nada legível no arquivo");
});
test("senha errada, outra conta e arquivo alterado são recusados; lixo vira erro de formato", async () => {
  const s = gerarSenha(), f = await empacotar(U, itens, s);
  await assert.rejects(abrir(U, f, "senha-errada-qualquer"), /senha/);
  await assert.rejects(abrir(V, f, s), /senha/);
  const j = JSON.parse(f); j.data = j.data.slice(0, -8) + "AAAAAAA="; await assert.rejects(abrir(U, JSON.stringify(j), s), /senha/);
  for (const ruim of ["", "nao json", "{}", JSON.stringify({ formato: "lacre-historico", v: 2 })]) await assert.rejects(abrir(U, ruim, s), /formato/);
});
test("senha curta não gera arquivo; cada arquivo usa sal/iv novos", async () => {
  await assert.rejects(empacotar(U, itens, "curta"), /curta/);
  const s = gerarSenha(), [a, b] = [JSON.parse(await empacotar(U, itens, s)), JSON.parse(await empacotar(U, itens, s))];
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.data, b.data);
});
test("validar descarta itens malformados", () => {
  const bom = itens[0];
  assert.equal(validar([bom, { p: "x", i: 1, e: {} }, { ...bom, i: -3 }, { ...bom, e: { content: { type: 5 } } }, null]).length, 1);
  assert.throws(() => validar("x"), /formato/);
});
test("variantes da senha", () => assert.deepEqual(variantes(" ABCD EFGH JKMN PQRS TUVW "), ["ABCD EFGH JKMN PQRS TUVW", "abcd-efgh-jkmn-pqrs-tuvw"]));
