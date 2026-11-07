import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resumo, citacao, limpaCitacao, rotulo, exibir, MAX_PREVIEW } from "../reply.js";

const ME = "11111111-1111-1111-1111-111111111111", PEER = "22222222-2222-2222-2222-222222222222";

describe("resumo e citação", () => {
  test("texto: guarda só um trecho curto", () => {
    const r = resumo({ type: "text", text: "a".repeat(500) });
    assert.equal(r.kind, "text"); assert.equal(r.text.length, MAX_PREVIEW); assert.ok(r.text.endsWith("…"), "mostra que foi cortado");
    assert.equal(resumo({ type: "text", text: "curto" }).text, "curto", "texto curto não muda");
    assert.equal(resumo({ type: "text", text: "x".repeat(MAX_PREVIEW) }).text.endsWith("…"), false, "exatamente no limite cabe inteiro");
    assert.equal(limpaCitacao({ id: 1, text: r.text }).text, r.text, "cortar de novo não muda nada");
  });
  test("mídia: tipo e legenda; sem tipo conhecido vira foto", () => {
    assert.deepEqual(resumo({ type: "media", kind: "audio", dur: 23, caption: "oi" }), { kind: "audio", text: "oi", dur: 23 });
    assert.equal(resumo({ type: "media", kind: "qualquer-coisa" }).kind, "image");
    assert.equal(resumo({ type: "media", kind: "video" }).text, "");
  });
  test("reação, controle e vazio não são citáveis", () => {
    assert.equal(resumo({ type: "reaction", to: 1, emoji: "x" }), null); assert.equal(resumo({ type: "hello" }), null); assert.equal(resumo(null), null);
    assert.equal(citacao(5, ME, { type: "hello" }), null);
  });
  test("citacao() junta id, autor e resumo", () => {
    assert.deepEqual(citacao(7, ME, { type: "text", text: "oi" }), { id: 7, from: ME, kind: "text", text: "oi", dur: 0 });
  });
});

describe("limpaCitacao: o que chega de outra pessoa é desconfiável", () => {
  test("aceita o formato normal", () => {
    assert.deepEqual(limpaCitacao({ id: 12, from: PEER, kind: "audio", text: "x", dur: 5 }), { id: 12, from: PEER, kind: "audio", text: "x", dur: 5 });
  });
  test("recusa id inválido (negativo, zero, texto, objeto, enorme)", () => {
    for (const id of [0, -3, "abc", "5", [5], {}, [], NaN, Infinity, 1e30, 1.5, null, undefined, true, false]) assert.equal(limpaCitacao({ id, kind: "text", text: "x" }), null, String(id));
    assert.equal(limpaCitacao(null), null); assert.equal(limpaCitacao("texto"), null); assert.equal(limpaCitacao(42), null);
  });
  test("tipo desconhecido vira texto; autor que não é uuid some; texto enorme é cortado; campos extras são descartados", () => {
    const r = limpaCitacao({ id: 1, kind: "<script>", from: "<img onerror=x>", text: "t".repeat(9999), dur: "999999", extra: "lixo", html: "<b>" });
    assert.equal(r.kind, "text"); assert.equal(r.from, null); assert.equal(r.text.length, MAX_PREVIEW); assert.equal(r.dur, 3600);
    assert.deepEqual(Object.keys(r).sort(), ["dur", "from", "id", "kind", "text"]);
  });
  test("texto não-string vira vazio", () => { assert.equal(limpaCitacao({ id: 1, text: { a: 1 } }).text, ""); });
});

describe("rotulo", () => {
  test("cada tipo tem um nome claro", () => {
    assert.equal(rotulo({ kind: "text", text: "bora?", dur: 0 }), "bora?");
    assert.equal(rotulo({ kind: "text", text: "", dur: 0 }), "Mensagem");
    assert.equal(rotulo({ kind: "image", text: "", dur: 0 }), "Foto");
    assert.equal(rotulo({ kind: "image", text: "praia", dur: 0 }), "Foto · praia");
    assert.equal(rotulo({ kind: "video", text: "", dur: 0 }), "Vídeo");
    assert.equal(rotulo({ kind: "audio", text: "", dur: 83 }), "Áudio · 1:23");
    assert.equal(rotulo({ kind: "audio", text: "", dur: 0 }), "Áudio");
  });
});

describe("exibir: a original local manda sobre o resumo recebido (anti-forja)", () => {
  const ids = { me: ME, peer: PEER };
  test("com a original na tela, o texto e o autor vêm dela, mesmo que o resumo diga outra coisa", () => {
    const forjada = { id: 9, from: ME, kind: "text", text: "EU AUTORIZO A TRANSFERÊNCIA", dur: 0 }; // o amigo diz que "você" escreveu isto
    const v = exibir(forjada, { mine: false, content: { type: "text", text: "bom dia" } }, ids);
    assert.deepEqual(v, { autor: "theirs", rotulo: "bom dia", original: true });
  });
  test("original minha: autor 'mine'", () => {
    assert.equal(exibir({ id: 1, from: PEER, kind: "text", text: "x", dur: 0 }, { mine: true, content: { type: "text", text: "oi" } }, ids).autor, "mine");
  });
  test("original de mídia usa o rótulo local (foto/áudio com duração)", () => {
    assert.equal(exibir({ id: 1, from: null, kind: "text", text: "", dur: 0 }, { mine: false, content: { type: "media", kind: "audio", dur: 12 } }, ids).rotulo, "Áudio · 0:12");
  });
  test("sem a original, usa o resumo recebido e marca como não verificado", () => {
    const v = exibir({ id: 1, from: PEER, kind: "image", text: "praia", dur: 0 }, undefined, ids);
    assert.deepEqual(v, { autor: "theirs", rotulo: "Foto · praia", original: false });
    assert.equal(exibir({ id: 1, from: ME, kind: "text", text: "x", dur: 0 }, undefined, ids).autor, "mine");
    assert.equal(exibir({ id: 1, from: null, kind: "text", text: "x", dur: 0 }, undefined, ids).autor, null, "autor desconhecido não é atribuído a ninguém");
  });
  test("original local que não é citável (reação) cai no resumo recebido", () => {
    assert.equal(exibir({ id: 1, from: PEER, kind: "text", text: "x", dur: 0 }, { mine: false, content: { type: "reaction" } }, ids).original, false);
  });
});

test("citar mensagem apagada para todos mostra 'Mensagem apagada', não o texto antigo", () => {
  const e = exibir({ id: 5, from: "a", kind: "text", text: "segredo antigo", dur: 0 }, { mine: true, content: { type: "deleted", by: "a" } }, { me: "a", peer: "b" });
  assert.equal(e.rotulo, "Mensagem apagada"); assert.equal(e.autor, "mine"); assert.equal(e.original, true);
  assert.equal(resumo({ type: "deleted" }), null, "mensagem apagada não pode ser citada");
});
