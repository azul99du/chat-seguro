import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { somarLinha, juntarLeituras, estadoDe, resumoVistos, arcosDoAnel, textoVistos, textoLongoVistos, reciboDm, juntarRecibo, Escuta, MAX_ARCOS } from "../visto.js";

const L = (recipient_id, read_at = null, extra = {}) => ({ recipient_id, read_at, ...extra });
const T = (m) => `2026-11-14T10:${String(m).padStart(2, "0")}:00Z`;
const hora = (t) => "H" + String(t).slice(14, 16), tempo = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

describe("quem viu a mensagem do grupo", () => {
  test("uma pessoa com vários aparelhos conta uma vez: primeira leitura, maior trecho ouvido, 'ouviu tudo' se algum aparelho ouviu", () => {
    const q = juntarLeituras([L("b"), L("b", T(5), { ouvido_ate: 3, ouvido_em: T(6) }), L("b", T(1), { ouvido_ate: 20, ouvido_tudo: false, ouvido_em: T(9) }), L("c"), L("b", null, { ouvido_tudo: true, ouvido_ate: 20, ouvido_em: T(10) })], "eu");
    assert.equal(q.size, 2); assert.deepEqual(q.get("b"), { t: T(1), ate: 20, tudo: true, em: T(10) }); assert.deepEqual(q.get("c"), { t: null, ate: null, tudo: false, em: null });
  });
  test("as cópias para mim mesmo e linhas esquisitas não entram", () => {
    const q = juntarLeituras([L("eu", T(0)), L("b"), { read_at: "x" }, null, L(5)], "eu"); assert.deepEqual([...q.keys()], ["b"]);
  });
  test("somar linha: devolve se mudou; leitura mais cedo vale; ouvir mais avança; repetir não muda; progresso nunca volta", () => {
    const q = new Map(); assert.equal(somarLinha(q, L("b")), true); assert.equal(somarLinha(q, L("b")), false);
    assert.equal(somarLinha(q, L("b", T(5))), true); assert.equal(somarLinha(q, L("b", T(9))), false); assert.equal(somarLinha(q, L("b", T(1))), true);
    assert.equal(somarLinha(q, L("b", T(1), { ouvido_ate: 10, ouvido_em: T(2) })), true); assert.equal(somarLinha(q, L("b", T(1), { ouvido_ate: 4, ouvido_em: T(2) })), false, "ouvir menos não faz voltar");
    assert.equal(q.get("b").ate, 10); assert.equal(somarLinha(null, L("x")), false); assert.equal(somarLinha(q, L(7)), false);
  });
  test("estado de cada pessoa: texto só 'viu' ou 'não'; áudio também 'em parte' e 'tudo'", () => {
    const nao = { t: null, ate: null, tudo: false, em: null }, viu = { ...nao, t: T(1) }, parte = { t: T(1), ate: 12, tudo: false, em: T(2) }, tudo = { t: T(1), ate: 30, tudo: true, em: T(3) };
    assert.deepEqual([nao, viu, parte, tudo].map((p) => estadoDe(p, true)), ["nao", "viu", "parte", "tudo"]); assert.deepEqual([nao, viu, parte, tudo].map((p) => estadoDe(p, false)), ["nao", "viu", "viu", "viu"]); assert.equal(estadoDe(null), "nao");
  });
  test("resumo de texto: quem viu em ordem de leitura e quem falta", () => {
    const r = resumoVistos(new Map([["c", { t: T(9), ate: null, tudo: false, em: null }], ["a", { t: T(2), ate: null, tudo: false, em: null }], ["d", { t: null, ate: null, tudo: false, em: null }]]));
    assert.deepEqual(r.vistos.map((v) => v.id), ["a", "c"]); assert.deepEqual(r.faltam, ["d"]); assert.equal(r.n, 3); assert.equal(r.k, 2); assert.equal(r.todos, false);
    assert.equal(resumoVistos(new Map([["a", { t: T(2), ate: null, tudo: false, em: null }]])).todos, true); assert.equal(resumoVistos(new Map()).todos, false); assert.equal(resumoVistos(null).n, 0);
  });
  test("resumo de áudio: ouviram tudo, em parte, só viram e faltam; 'todos' só se todos ouviram TUDO", () => {
    const q = new Map([["a", { t: T(1), ate: 30, tudo: true, em: T(3) }], ["b", { t: T(2), ate: 12, tudo: false, em: T(4) }], ["c", { t: T(5), ate: null, tudo: false, em: null }], ["d", { t: null, ate: null, tudo: false, em: null }]]);
    const r = resumoVistos(q, true);
    assert.deepEqual(r.tudo.map((x) => x.id), ["a"]); assert.deepEqual(r.parte.map((x) => [x.id, x.ate]), [["b", 12]]); assert.deepEqual(r.viu.map((x) => x.id), ["c"]); assert.deepEqual(r.faltam, ["d"]);
    assert.equal(r.k, 2, "ouviram = inteiro + em parte"); assert.equal(r.todos, false);
    assert.equal(resumoVistos(new Map([["a", { t: T(1), ate: 30, tudo: true, em: T(3) }], ["b", { t: T(1), ate: 30, tudo: true, em: T(4) }]]), true).todos, true);
    assert.equal(resumoVistos(new Map([["a", { t: T(1), ate: 30, tudo: true, em: T(3) }], ["b", { t: T(1), ate: 5, tudo: false, em: T(4) }]]), true).todos, false);
  });
  test("anel de grupo pequeno: uma parte por pessoa, do mais completo para o menos", () => {
    const q = new Map([["a", { t: T(1), ate: 30, tudo: true, em: T(3) }], ["b", { t: T(2), ate: 12, tudo: false, em: T(4) }], ["c", { t: T(5), ate: null, tudo: false, em: null }], ["d", { t: null, ate: null, tudo: false, em: null }]]);
    assert.deepEqual(arcosDoAnel(resumoVistos(q, true)), ["tudo", "parte", "viu", "nao"]); assert.deepEqual(arcosDoAnel(resumoVistos(q, false)), ["viu", "viu", "viu", "nao"]); assert.deepEqual(arcosDoAnel(resumoVistos(new Map())), []);
  });
  test("anel de grupo grande: no máximo 8 partes, cada estado que existe aparece, e nunca fecha sem todos", () => {
    const mk = (tudo, parte, viu, nao) => { const q = new Map(); let i = 0; const add = (n, p) => { for (let k = 0; k < n; k++) q.set("p" + i++, p); }; add(tudo, { t: T(1), ate: 9, tudo: true, em: T(2) }); add(parte, { t: T(1), ate: 4, tudo: false, em: T(2) }); add(viu, { t: T(1), ate: null, tudo: false, em: null }); add(nao, { t: null, ate: null, tudo: false, em: null }); return resumoVistos(q, true); };
    for (const [a, b, c, d] of [[5, 5, 5, 5], [1, 0, 0, 39], [39, 0, 0, 1], [0, 1, 38, 1], [20, 0, 0, 0], [30, 5, 3, 2], [2, 2, 2, 2]]) {
      const r = mk(a, b, c, d), s = arcosDoAnel(r); assert.ok(s.length <= MAX_ARCOS && s.length === Math.min(r.n, MAX_ARCOS), `${a},${b},${c},${d}: ${s.length}`);
      for (const [e, v] of [["tudo", a], ["parte", b], ["viu", c], ["nao", d]]) if (v > 0 && r.n > MAX_ARCOS) assert.ok(s.includes(e), `${a},${b},${c},${d} sem ${e}: ${s}`);
      if (!r.todos) assert.ok(s.some((x) => x !== "tudo"), "anel fechado sem todos: " + s);
    }
    assert.ok(arcosDoAnel(mk(20, 0, 0, 0)).every((x) => x === "tudo"), "todos ouviram tudo: anel cheio");
  });
  test("textos do selo e da janela, de texto e de áudio", () => {
    const rt = resumoVistos(new Map([["a", { t: T(1), ate: null, tudo: false, em: null }], ["b", { t: null, ate: null, tudo: false, em: null }]]));
    assert.equal(textoVistos(rt), "1/2"); assert.equal(textoLongoVistos(rt), "1 de 2 viram");
    const ra = resumoVistos(new Map([["a", { t: T(1), ate: 9, tudo: true, em: T(2) }], ["b", { t: T(1), ate: 4, tudo: false, em: T(2) }]]), true);
    assert.equal(textoVistos(ra), "2/2"); assert.equal(textoLongoVistos(ra, true), "2 de 2 ouviram", "ouviram em parte contam como ouviram, mas o anel não fecha");
    const rf = resumoVistos(new Map([["a", { t: T(1), ate: 9, tudo: true, em: T(2) }]]), true); assert.equal(textoVistos(rf), "todos"); assert.equal(textoLongoVistos(rf, true), "A pessoa ouviu");
    assert.equal(textoLongoVistos(resumoVistos(new Map([["a", { t: T(1), ate: null, tudo: false, em: null }]]), true), true), "Ninguém ouviu ainda"); assert.equal(textoLongoVistos({ n: 0 }), "");
  });
  test("conversa a dois: enviada → vista → ouviu até → ouvida (só áudio ouve)", () => {
    assert.deepEqual(reciboDm({}, true, hora, tempo), { texto: "enviada", classe: "" }); assert.deepEqual(reciboDm({ read_at: T(4) }, true, hora, tempo), { texto: "vista H04", classe: "read" });
    assert.deepEqual(reciboDm({ read_at: T(4), ouvido_ate: 75 }, true, hora, tempo), { texto: "ouviu até 1:15", classe: "parte" }); assert.deepEqual(reciboDm({ read_at: T(4), ouvido_ate: 75, ouvido_tudo: true, ouvido_em: T(7) }, true, hora, tempo), { texto: "ouvida H07", classe: "read" });
    assert.deepEqual(reciboDm({ read_at: T(4), ouvido_ate: 75 }, false, hora, tempo), { texto: "vista H04", classe: "read" }, "texto não tem 'ouvida'");
  });
  test("recibo da conversa a dois junta os aparelhos de quem recebeu", () => {
    let r = null; for (const l of [{ read_at: T(5) }, { read_at: T(2), ouvido_ate: 3, ouvido_em: T(3) }, { read_at: null, ouvido_ate: 40, ouvido_tudo: true, ouvido_em: T(9) }, { read_at: T(8) }]) r = juntarRecibo(r, l);
    assert.deepEqual(r, { read_at: T(2), ouvido_ate: 40, ouvido_tudo: true, ouvido_em: T(9) });
  });
});

describe("quanto a pessoa realmente ouviu", () => {
  const toca = (e, de, ate, passo = 0.5) => { for (let t = de; t <= ate + 1e-9; t += passo) e.tempo(+t.toFixed(3)); };
  test("ouvir seguido até o fim conta tudo, e relata a duração inteira", () => {
    const e = new Escuta(10); toca(e, 0, 10); e.fim(); assert.equal(e.tudo, true); assert.deepEqual(e.relato(), { ate: 10, tudo: true });
  });
  test("ouvir só um trecho relata até onde chegou, sem 'tudo'", () => {
    const e = new Escuta(30); toca(e, 0, 12); assert.equal(e.tudo, false); assert.deepEqual(e.relato(), { ate: 12, tudo: false });
  });
  test("pular para perto do fim não conta como ouvir: dá pra relatar só o trecho realmente ouvido", () => {
    const e = new Escuta(60); toca(e, 0, 5); e.salto(); toca(e, 58, 60); e.fim();
    assert.equal(e.tudo, false, "pulou quase tudo"); assert.ok(e.ouvido < 8);
  });
  test("menos de 1 s ouvido não é registrado; arrastar a barra não soma tempo", () => {
    const e = new Escuta(30); toca(e, 0, 0.6, 0.2); assert.equal(e.relato(), null); const f = new Escuta(30); f.tempo(0); f.tempo(20); f.tempo(40); assert.equal(f.ouvido, 0, "saltos grandes não contam"); assert.equal(f.relato(), null);
  });
  test("ouviu 90% já conta como tudo (e o último pedacinho não precisa tocar)", () => {
    const e = new Escuta(20); toca(e, 0, 18.2); assert.equal(e.tudo, true); const g = new Escuta(20); toca(e, 0, 0); toca(g, 0, 17); assert.equal(g.tudo, false);
  });
  test("duração desconhecida: só vale 'tudo' se chegou ao fim tocando", () => {
    const e = new Escuta(0); toca(e, 0, 6); assert.equal(e.tudo, false); assert.deepEqual(e.relato(), { ate: 6, tudo: false }); e.fim(); assert.equal(e.tudo, true);
  });
  test("valores esquisitos não quebram", () => { const e = new Escuta(NaN); e.tempo(NaN); e.tempo(undefined); e.fim(); assert.equal(e.relato(), null); });
});
