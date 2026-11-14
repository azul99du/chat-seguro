import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOVIDADES, TEMAS, limpaVisto, maisNovaId, novosDesde, temNovidade, dataCurta, temasPresentes, filtrar, agruparPorTema, problemas, temaNome } from "../novidades.js";

const L = [
  { id: "2026-11-14-2", data: "2026-11-14", itens: [{ tema: "selos", icone: "a", titulo: "t", texto: "x" }, { tema: "geral", icone: "b", titulo: "t", texto: "x" }] },
  { id: "2026-11-13-1", data: "2026-11-13", itens: [{ tema: "grupos", icone: "c", titulo: "t", texto: "x" }] },
];
describe("novidades", () => {
  test("a lista de verdade está em ordem (a mais nova primeiro), com ids únicos, datas, assuntos e textos válidos", () => {
    assert.deepEqual(problemas(NOVIDADES), []); assert.ok(NOVIDADES.length >= 1); assert.equal(maisNovaId(NOVIDADES), NOVIDADES[0].id);
  });
  test("o conferidor pega os erros mais comuns", () => {
    const ruim = [{ id: "x", data: "2026-13-40", itens: [] }, { id: "2026-11-14-1", data: "2026-11-14", itens: [{ tema: "inventado", icone: "", titulo: "", texto: "" }] }, { id: "2026-11-14-1", data: "2026-11-14", itens: [] }];
    const p = problemas(ruim).join("|"); for (const re of [/id ruim/, /data ruim/, /sem itens/, /assunto desconhecido/, /item incompleto/, /id repetido/, /fora de ordem/]) assert.match(p, re);
  });
  test("o ponto: quem nunca abriu vê tudo como novo; quem já abriu só vê o que veio depois; valor adulterado vale como nunca abriu", () => {
    assert.equal(novosDesde(L, null).length, 2); assert.equal(novosDesde(L, "2026-11-13-1").length, 1); assert.equal(novosDesde(L, "2026-11-14-2").length, 0);
    assert.equal(temNovidade(L, "2026-11-14-2"), false); assert.equal(temNovidade(L, "2026-11-13-1"), true); assert.equal(temNovidade(L, "lixo"), true); assert.equal(temNovidade(L, undefined), true);
    assert.equal(limpaVisto("2026-11-14-2"), "2026-11-14-2"); for (const x of [null, 5, "", "2026-11-14", "<script>", "2026-11-14-2 "]) assert.equal(limpaVisto(x), null);
  });
  test("datas curtas em português", () => { assert.equal(dataCurta("2026-11-14"), "14 nov"); assert.equal(dataCurta("2026-01-05"), "5 jan"); assert.equal(dataCurta("2026-13-01"), ""); assert.equal(dataCurta(null), ""); });
  test("os botões de filtro só mostram assuntos que existem, na ordem do app", () => {
    assert.deepEqual(temasPresentes(L).map((t) => t.tema), ["selos", "grupos", "geral"]); assert.equal(temaNome("seguranca"), "Segurança"); assert.equal(temaNome("x"), null); assert.equal(TEMAS.length, 5);
  });
  test("filtrar: 'tudo' não mexe; por assunto fica só o que é dele e atualizações vazias somem", () => {
    assert.equal(filtrar(L, "tudo"), L); assert.deepEqual(filtrar(L, "selos").map((e) => [e.id, e.itens.length]), [["2026-11-14-2", 1]]); assert.deepEqual(filtrar(L, "grupos").map((e) => e.id), ["2026-11-13-1"]); assert.deepEqual(filtrar(L, "seguranca"), []);
    assert.equal(L[0].itens.length, 2, "não altera a lista original");
  });
  test("dentro do cartão os itens ficam agrupados por assunto, na ordem do app", () => {
    const itens = [{ tema: "geral", titulo: "g" }, { tema: "selos", titulo: "s1" }, { tema: "selos", titulo: "s2" }];
    assert.deepEqual(agruparPorTema(itens).map((g) => [g.tema, g.itens.map((i) => i.titulo)]), [["selos", ["s1", "s2"]], ["geral", ["g"]]]);
  });
});
