import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { juntarLeituras, somarLeitura, resumoVistos, segmentos, textoVistos, textoLongoVistos, MAX_ARCOS } from "../visto.js";

const L = (recipient_id, read_at = null) => ({ recipient_id, read_at });
describe("quem viu a mensagem do grupo", () => {
  test("uma pessoa com vários aparelhos conta uma vez, pela primeira leitura de qualquer aparelho", () => {
    const q = juntarLeituras([L("b"), L("b", "2026-11-14T10:05:00Z"), L("b", "2026-11-14T10:01:00Z"), L("c")], "eu");
    assert.equal(q.size, 2); assert.equal(q.get("b"), "2026-11-14T10:01:00Z"); assert.equal(q.get("c"), null);
  });
  test("as cópias para mim mesmo e linhas sem destinatário não entram", () => {
    const q = juntarLeituras([L("eu", "2026-11-14T10:00:00Z"), L("b"), { read_at: "x" }, null, L(5)], "eu"); assert.deepEqual([...q.keys()], ["b"]);
  });
  test("somar leitura: só vale a mais cedo; pessoa nova entra; repetir não muda", () => {
    const q = new Map([["b", null]]);
    assert.equal(somarLeitura(q, "b", "2026-11-14T10:05:00Z"), true); assert.equal(somarLeitura(q, "b", "2026-11-14T10:09:00Z"), false); assert.equal(somarLeitura(q, "b", "2026-11-14T10:01:00Z"), true); assert.equal(q.get("b"), "2026-11-14T10:01:00Z");
    assert.equal(somarLeitura(q, "c", null), true); assert.equal(q.get("c"), null); assert.equal(somarLeitura(q, "c", null), false); assert.equal(somarLeitura(null, "x", null), false);
  });
  test("resumo: quem viu em ordem de leitura, quem falta, e se todos viram", () => {
    const r = resumoVistos(new Map([["c", "2026-11-14T10:09:00Z"], ["a", "2026-11-14T10:02:00Z"], ["d", null]]));
    assert.deepEqual(r.vistos.map((v) => v.id), ["a", "c"]); assert.deepEqual(r.faltam, ["d"]); assert.equal(r.n, 3); assert.equal(r.k, 2); assert.equal(r.todos, false);
    assert.equal(resumoVistos(new Map([["a", "2026-11-14T10:02:00Z"]])).todos, true); assert.equal(resumoVistos(new Map()).todos, false); assert.equal(resumoVistos(null).n, 0);
  });
  test("anel: uma parte por pessoa, preenchidas em ordem", () => {
    assert.deepEqual(segmentos(2, 4), [true, true, false, false]); assert.deepEqual(segmentos(0, 4), [false, false, false, false]); assert.deepEqual(segmentos(4, 4), [true, true, true, true]); assert.deepEqual(segmentos(1, 1), [true]);
  });
  test("anel de grupo grande: no máximo 8 partes, proporcional, nunca fecha sem todos e nunca fica vazio se alguém viu", () => {
    assert.equal(segmentos(5, 20).length, MAX_ARCOS); assert.equal(segmentos(5, 20).filter(Boolean).length, 2);
    assert.equal(segmentos(1, 40).filter(Boolean).length, 1, "alguém viu: ao menos uma parte"); assert.equal(segmentos(39, 40).filter(Boolean).length, MAX_ARCOS - 1, "faltando 1, não fecha");
    assert.equal(segmentos(40, 40).every(Boolean), true); assert.deepEqual(segmentos(0, 40), Array(MAX_ARCOS).fill(false));
  });
  test("entradas esquisitas não quebram", () => {
    assert.deepEqual(segmentos(3, 0), []); assert.deepEqual(segmentos(NaN, 3), [false, false, false]); assert.deepEqual(segmentos(9, 3), [true, true, true]); assert.deepEqual(segmentos(-2, 3), [false, false, false]);
  });
  test("textos: 'todos' só quando todos; senão k/n; texto longo em português", () => {
    assert.equal(textoVistos(4, 4), "todos"); assert.equal(textoVistos(2, 4), "2/4"); assert.equal(textoVistos(0, 4), "0/4");
    assert.equal(textoLongoVistos(4, 4), "Todos viram"); assert.equal(textoLongoVistos(1, 1), "A pessoa viu"); assert.equal(textoLongoVistos(2, 4), "2 de 4 viram"); assert.equal(textoLongoVistos(0, 4), "Ninguém viu ainda"); assert.equal(textoLongoVistos(0, 0), "");
  });
});
