import test from "node:test";
import assert from "node:assert/strict";
import { normaliza, textoBuscavel, termoValido, achar, partes, contador, passo, antesDeMostrar, MIN_BUSCA, MAX_RESULTADOS } from "../busca.js";

test("normaliza tira acento e maiúscula", () => { assert.equal(normaliza("Ação, ÁGUA çedilha"), "acao, agua cedilha"); assert.equal(normaliza(null), ""); });
test("texto buscável: texto, legenda, música; o resto não", () => {
  assert.equal(textoBuscavel({ type: "text", text: "oi" }), "oi"); assert.equal(textoBuscavel({ type: "media", kind: "image", caption: "praia" }), "praia");
  assert.equal(textoBuscavel({ type: "media", kind: "musica", titulo: "Death Note", artista: "Hideki" }), "Death Note Hideki");
  for (const c of [{ type: "reaction" }, { type: "deleted" }, { type: "hello" }, null, "x"]) assert.equal(textoBuscavel(c), "");
});
test("termoValido: pelo menos 2 letras (espaços e acento não contam à toa)", () => { assert.equal(MIN_BUSCA, 2); assert.equal(termoValido("a"), false); assert.equal(termoValido("  a "), false); assert.equal(termoValido("ab"), true); assert.equal(termoValido("é "), false); });
test("achar: sem diferenciar acento/maiúscula, em ordem do mais antigo, e ignora o que não é texto", () => {
  const itens = [{ id: 30, entry: { content: { type: "text", text: "Viagem pra julho" } } }, { id: 10, entry: { content: { type: "text", text: "a VIAGEM é longa" } } }, { id: 20, entry: { content: { type: "text", text: "nada" } } },
    { id: 40, entry: { content: { type: "media", kind: "image", caption: "fotos da viagem" } } }, { id: 50, entry: { content: { type: "reaction" } } }, { id: "x", entry: { content: { type: "text", text: "viagem" } } }];
  assert.deepEqual(achar(itens, "viagem"), [10, 30, 40]); assert.deepEqual(achar(itens, "VIÁGEM"), [10, 30, 40]); assert.deepEqual(achar(itens, "v"), []); assert.deepEqual(achar(null, "viagem"), []);
  assert.equal(achar(Array.from({ length: MAX_RESULTADOS + 20 }, (_, i) => ({ id: i + 1, entry: { content: { type: "text", text: "abc" } } })), "abc").length, MAX_RESULTADOS);
});
test("partes: marca todas as ocorrências mantendo o texto original", () => {
  assert.deepEqual(partes("Vamos marcar a Viagem, a viagem!", "viagem"), [{ t: "Vamos marcar a ", m: false }, { t: "Viagem", m: true }, { t: ", a ", m: false }, { t: "viagem", m: true }, { t: "!", m: false }]);
  assert.deepEqual(partes("Ação rápida", "acao"), [{ t: "Ação", m: true }, { t: " rápida", m: false }]);
  assert.deepEqual(partes("nada aqui", "xyz"), [{ t: "nada aqui", m: false }]); assert.deepEqual(partes("abc", "a"), [{ t: "abc", m: false }], "termo curto não marca");
  assert.equal(partes("aaaa", "aa").filter((p) => p.m).length, 2, "sem sobrepor"); assert.equal(partes("x viagem y", "viagem").map((p) => p.t).join(""), "x viagem y");
});
test("contador e passo (setas dão a volta)", () => {
  assert.equal(contador(2, 7), "3 de 7"); assert.equal(contador(0, 0), "Nada achado"); assert.equal(contador(99, 3), "3 de 3");
  assert.equal(passo(3, 7, -1), 2); assert.equal(passo(0, 7, -1), 6, "do mais antigo volta ao mais novo"); assert.equal(passo(6, 7, 1), 0); assert.equal(passo(2, 7, 1), 3); assert.equal(passo(0, 0, 1), -1);
});
test("antesDeMostrar: traz a mensagem e 20 de contexto antes dela, até o começo da tela", () => {
  const ids = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 são mais antigas que a tela
  const r = antesDeMostrar(ids, 50); assert.equal(r[0], 30); assert.equal(r.at(-1), 100); assert.equal(r.length, 71);
  assert.equal(antesDeMostrar(ids, 5)[0], 1); assert.deepEqual(antesDeMostrar(ids, 500), []);
});
