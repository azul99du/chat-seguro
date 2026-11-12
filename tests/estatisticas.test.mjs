import { test } from "node:test";
import assert from "node:assert/strict";
import { tipoDe, diaLocal, primeiroDia, contar, sequencia, tempoTexto, somarTela, noGrupoHa, ranking, totalDe, textoSequencia } from "../estatisticas.js";

const M = [{ id: "a", username: "ana" }, { id: "b", username: "beto" }, { id: "c", username: "caio" }];
const t = (d, h = 12) => new Date(2026, 10, d, h).getTime();
const txt = (from, d, text, extra = {}) => ({ from, at: t(d), content: { type: "text", text, ...extra } });
const med = (from, d, kind) => ({ from, at: t(d), content: { type: "media", kind } });

test("tipos de mensagem: só o que é mensagem de verdade conta", () => {
  assert.equal(tipoDe({ type: "text" }), "texto"); assert.equal(tipoDe({ type: "media", kind: "image" }), "foto");
  assert.equal(tipoDe({ type: "media", kind: "video" }), "video"); assert.equal(tipoDe({ type: "media", kind: "audio" }), "audio");
  assert.equal(tipoDe({ type: "media", kind: "sticker" }), "figurinha"); assert.equal(tipoDe({ type: "media", kind: "x" }), null);
  for (const x of [{ type: "deleted" }, { type: "hello" }, { type: "reaction" }, { type: "hidden" }, null, "oi", 3]) assert.equal(tipoDe(x), null);
});
test("dias e períodos (hoje, semana, mês)", () => {
  assert.equal(diaLocal(t(5)), "2026-11-05"); assert.equal(diaLocal("lixo"), null);
  const agora = new Date(2026, 10, 12, 10);
  assert.equal(primeiroDia("hoje", agora), "2026-11-12"); assert.equal(primeiroDia("semana", agora), "2026-11-06"); assert.equal(primeiroDia("mes", agora), "2026-10-14");
});
test("contagem por pessoa e tipo, só dentro do período", () => {
  const e = [txt("a", 12, "oi"), txt("a", 12, "oi 2"), med("a", 12, "image"), med("b", 12, "sticker"), med("b", 12, "video"), med("b", 12, "audio"), txt("a", 5, "velha"), txt("zzz", 12, "de fora"), { from: "a", at: t(12), content: { type: "deleted" } }];
  const r = contar(e, M, "2026-11-12");
  assert.deepEqual([r.get("a").total, r.get("a").texto, r.get("a").foto], [3, 2, 1]);
  assert.deepEqual([r.get("b").total, r.get("b").figurinha, r.get("b").video, r.get("b").audio], [3, 1, 1, 1]);
  assert.equal(r.get("c").total, 0); assert.equal(r.has("zzz"), false); assert.equal(totalDe(r), 6);
  assert.equal(contar(e, M).get("a").total, 4);
});
test("respostas e citações (@): quem citou e quem foi citado; ninguém se cita", () => {
  const e = [txt("a", 12, "oi @beto e @caio"), txt("b", 12, "@beto sou eu"), txt("b", 12, "ok", { re: { mid: "x" } }), txt("c", 12, "@ana oi")];
  const r = contar(e, M, "2026-11-12");
  assert.equal(r.get("a").citou, 2); assert.equal(r.get("b").citada, 1); assert.equal(r.get("c").citada, 1); assert.equal(r.get("b").citou, 0);
  assert.equal(r.get("b").respostas, 1); assert.equal(r.get("a").citada, 1);
});
test("sequência de dias seguidos", () => {
  const d = (...n) => new Set(n.map((x) => diaLocal(t(x))));
  assert.equal(sequencia(d(10, 11, 12), diaLocal(t(12))), 3);
  assert.equal(sequencia(d(9, 10, 11), diaLocal(t(12))), 3, "hoje ainda não acabou: ontem mantém a sequência");
  assert.equal(sequencia(d(8, 9), diaLocal(t(12))), 0); assert.equal(sequencia(d(), diaLocal(t(12))), 0);
  assert.equal(sequencia(d(1, 2, 4, 5), diaLocal(t(5))), 2, "dia faltando quebra a sequência");
  assert.equal(sequencia(new Set(["2026-02-27", "2026-02-28", "2026-03-01"]), "2026-03-01"), 3, "vira o mês");
  assert.equal(textoSequencia(1), "1 dia seguido"); assert.equal(textoSequencia(5), "5 dias seguidos"); assert.equal(textoSequencia(0), "");
});
test("tempo de tela: texto e soma por período", () => {
  assert.equal(tempoTexto(0), "0min"); assert.equal(tempoTexto(20), "menos de 1min"); assert.equal(tempoTexto(48 * 60), "48min"); assert.equal(tempoTexto(4320), "1h 12min"); assert.equal(tempoTexto("x"), "0min");
  const l = [{ user_id: "a", dia: "2026-11-12", segundos: 100 }, { user_id: "a", dia: "2026-11-10", segundos: 50 }, { user_id: "b", dia: "2026-11-12", segundos: 7 }, { user_id: "a", dia: 5, segundos: 9 }];
  assert.equal(somarTela(l, "2026-11-12").get("a"), 100); assert.equal(somarTela(l, "2026-11-01").get("a"), 150); assert.equal(somarTela(null).size, 0);
});
test("no grupo há…", () => {
  const ag = new Date(2026, 10, 12, 10);
  assert.equal(noGrupoHa(t(12), ag), "Entrou hoje"); assert.equal(noGrupoHa(t(11), ag), "No grupo há 1 dia"); assert.equal(noGrupoHa(t(2), ag), "No grupo há 10 dias");
  assert.equal(noGrupoHa(new Date(2026, 9, 1), ag), "No grupo há 6 semanas"); assert.equal(noGrupoHa(new Date(2026, 7, 1), ag), "No grupo há 3 meses");
  assert.equal(noGrupoHa(new Date(2024, 0, 1), ag), "No grupo há 2 anos"); assert.equal(noGrupoHa("lixo", ag), "");
});
test("ranking: mais mensagens primeiro; empate pelo tempo de tela, depois pelo nome", () => {
  const c = new Map([["a", { total: 3 }], ["b", { total: 5 }], ["c", { total: 3 }]]);
  assert.deepEqual(ranking(M, c, new Map([["c", 10]])).map((x) => x.p.id), ["b", "c", "a"]);
  assert.deepEqual(ranking(M, new Map(), new Map()).map((x) => x.p.id), ["a", "b", "c"]);
});
