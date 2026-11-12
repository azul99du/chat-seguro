import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { novoId, idValido, limpa, limpaLista, resumo, textoPendentes, nomeDoAparelho, erroAmigavel, MAX_APARELHOS } from "../dispositivos.js";

const R = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const L = (n, estado, extra = {}) => ({ ref: R(n), estado, atual: false, criado_em: "2026-01-01T00:00:00Z", visto_em: "2026-01-01T00:00:00Z", aprovado_em: estado === "aprovado" ? "2026-01-01T00:00:00Z" : null, navegador: "Chrome", sistema: "Windows", tipo: "computador", ...extra });

describe("identificador do aparelho", () => {
  test("novoId: 32 hexadecimais, diferente a cada vez", () => { const a = novoId(), b = novoId(); assert.match(a, /^[0-9a-f]{32}$/); assert.notEqual(a, b); assert.equal(novoId(new Uint8Array(16)), "0".repeat(32)); });
  test("idValido recusa tamanho, maiúsculas e lixo", () => { assert.equal(idValido("a".repeat(32)), true); for (const x of ["a".repeat(31), "A".repeat(32), "g".repeat(32), "", null, 5, "a".repeat(32) + "\n"]) assert.equal(idValido(x), false, String(x)); });
});
describe("linhas do servidor (desconfiáveis)", () => {
  test("limpa aceita o formato certo e descarta estado/ref estranhos", () => {
    assert.equal(limpa(L(1, "aprovado")).estado, "aprovado");
    for (const x of [null, "x", {}, L(1, "hacker"), { ...L(1, "aprovado"), ref: "../../x" }, { ...L(1, "aprovado"), ref: 5 }]) assert.equal(limpa(x), null);
  });
  test("limpa corta textos enormes e normaliza tipo e país", () => {
    const o = limpa(L(1, "pendente", { navegador: "x".repeat(500), tipo: "<img>", pais_codigo: "brasil", cidade: "y".repeat(500) }));
    assert.equal(o.navegador.length, 60); assert.equal(o.tipo, "outro"); assert.equal(o.pais_codigo, null); assert.equal(o.cidade.length, 80); assert.equal(o.atual, false);
  });
  test("atual só vale com true de verdade", () => { assert.equal(limpa(L(1, "aprovado", { atual: "true" })).atual, false); assert.equal(limpa(L(1, "aprovado", { atual: true })).atual, true); });
  test("limpaLista tolera o que não é lista e limita o tamanho", () => { assert.deepEqual(limpaLista(null), []); assert.deepEqual(limpaLista({}), []); assert.equal(limpaLista(Array.from({ length: 50 }, () => L(1, "aprovado"))).length, MAX_APARELHOS + 5); });
});
describe("resumo", () => {
  test("aparelho aprovado com um pendente", () => { const r = resumo([L(1, "aprovado", { atual: true }), L(2, "pendente")]); assert.equal(r.souAprovado, true); assert.equal(r.souPendente, false); assert.equal(r.pendentes.length, 1); assert.equal(r.cheio, false); });
  test("aparelho pendente não conta a si mesmo como pendente a decidir", () => { const r = resumo([L(1, "aprovado"), L(2, "pendente", { atual: true })]); assert.equal(r.souPendente, true); assert.equal(r.souAprovado, false); assert.equal(r.pendentes.length, 0); });
  test("sem linha 'atual' (ainda não registrou): nem aprovado nem pendente", () => { const r = resumo([L(1, "aprovado")]); assert.equal(r.eu, null); assert.equal(r.souAprovado, false); assert.equal(r.souPendente, false); });
  test("cheio com 5", () => assert.equal(resumo(Array.from({ length: 5 }, (_, i) => L(i, "aprovado"))).cheio, true));
});
describe("textos", () => {
  test("textoPendentes", () => { assert.equal(textoPendentes(0), ""); assert.match(textoPendentes(1), /^Um aparelho novo/); assert.match(textoPendentes(3), /^3 aparelhos novos/); });
  test("nomeDoAparelho", () => { assert.equal(nomeDoAparelho({ navegador: "Chrome", sistema: "Android" }), "Chrome no Android"); assert.equal(nomeDoAparelho({}), "Aparelho sem nome"); });
  test("erroAmigavel", () => { assert.match(erroAmigavel({ message: "limite_de_aparelhos" }), /5 aparelhos/); assert.match(erroAmigavel({ message: "limite de uso atingido: espere um pouco" }), /Espere/); assert.match(erroAmigavel(null), /Tente de novo/); });
});
