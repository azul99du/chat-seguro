import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_SUGESTAO, MAX_POR_DIA, limpaSugestao, restantesHoje, dataCarimbo, corDaNota, limpaSugestoes, erroSugestao } from "../sugestoes.js";
import { readFileSync } from "node:fs";

describe("sugestões (funções puras)", () => {
  test("o limite de caracteres é a média das 10 sugestões de exemplo (201,6 → 202) e são 5 por dia", () => {
    const exemplos = [63, 54, 69, 187, 176, 167, 170, 324, 367, 439]; assert.equal(Math.round(exemplos.reduce((a, b) => a + b) / exemplos.length), MAX_SUGESTAO); assert.equal(MAX_SUGESTAO, 202); assert.equal(MAX_POR_DIA, 5);
    assert.match(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"), /char_length\(texto\) between 1 and 202/, "o banco usa o mesmo limite");
  });
  test("limpaSugestao tira controles e junta espaços", () => { assert.equal(limpaSugestao("  oi \n\n  tudo\tbem \u0007 "), "oi tudo bem"); assert.equal(limpaSugestao(null), ""); assert.equal(limpaSugestao("a‮b"), "a b"); });
  test("restantesHoje", () => { assert.equal(restantesHoje(0, 5), 5); assert.equal(restantesHoje(3, 5), 2); assert.equal(restantesHoje(9, 5), 0); assert.equal(restantesHoje(undefined, undefined), 5); });
  test("dataCarimbo usa o dia de Brasília", () => {
    assert.equal(dataCarimbo("2026-11-14T15:00:00Z"), "14 NOV 2026"); assert.equal(dataCarimbo("2026-11-15T02:30:00Z"), "14 NOV 2026", "23h30 em Brasília ainda é dia 14"); assert.equal(dataCarimbo("2026-11-15T03:00:00Z"), "15 NOV 2026"); assert.equal(dataCarimbo("2027-01-01T12:00:00Z"), "01 JAN 2027"); assert.equal(dataCarimbo("lixo"), "");
  });
  test("corDaNota fica entre 0 e 4", () => { for (const i of [0, 1, 4, 5, 99, -3, "x", null]) { const c = corDaNota(i); assert.ok(Number.isInteger(c) && c >= 0 && c <= 4, String(i)); } });
  test("limpaSugestoes só aceita linhas com a forma certa; autor anônimo vira null; texto é cortado no limite", () => {
    const ok = { id: 1, texto: "Oi", criado_em: "2026-11-14T15:00:00Z", autor: "azul_99", curtidas: 3, eu_curti: true, minha: true };
    const l = limpaSugestoes([ok, { ...ok, id: 1 }, { ...ok, id: 2, autor: null, curtidas: -4, eu_curti: "sim", minha: 1 }, { ...ok, id: 3, autor: "<img src=x>" }, { ...ok, id: 4, texto: "   " }, { ...ok, id: 5, criado_em: "x" }, { ...ok, id: "6" }, { ...ok, id: 7, texto: "x".repeat(500) }, null, 7]);
    assert.deepEqual(l.map((x) => x.id), [1, 2, 3, 7], "repetida, texto vazio, data ruim, id não inteiro e lixo ficam de fora");
    assert.deepEqual(l[0], { id: 1, texto: "Oi", criado: "2026-11-14T15:00:00.000Z", autor: "azul_99", curtidas: 3, euCurti: true, minha: true });
    assert.equal(l[1].autor, null); assert.equal(l[1].curtidas, 0); assert.equal(l[1].euCurti, false); assert.equal(l[1].minha, false); assert.equal(l[2].autor, null, "nome fora do formato não vira texto na tela"); assert.equal(l[3].texto.length, MAX_SUGESTAO); assert.deepEqual(limpaSugestoes(null), []);
  });
  test("erroSugestao traduz os erros do banco", () => {
    assert.match(erroSugestao({ message: "limite_diario" }), /5 sugestões hoje/); assert.match(erroSugestao({ message: "texto_invalido" }), /até 202/); assert.match(erroSugestao({ message: "nao_existe" }), /não existe mais/); assert.match(erroSugestao({ code: "PT429" }), /Espere/); assert.match(erroSugestao({ message: "aparelho_pendente" }), /Aprove/); assert.match(erroSugestao(null), /Tente de novo/);
  });
});
