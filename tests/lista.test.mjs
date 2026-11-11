import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rotuloHora, rotuloNovas, textoNovas, contaOnline, dataCompleta } from "../lista.js";

// "agora" = quarta-feira, 11/11/2026, 15:30 (horário local de quem roda o teste)
const agora = new Date(2026, 10, 11, 15, 30);
const em = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
describe("horário da última mensagem", () => {
  test("hoje: só a hora, com dois dígitos", () => {
    assert.equal(rotuloHora(em(2026, 11, 11, 15, 29), agora), "15:29"); assert.equal(rotuloHora(em(2026, 11, 11, 0, 5), agora), "00:05"); assert.equal(rotuloHora(em(2026, 11, 11, 9, 7), agora), "09:07");
  });
  test("virada do dia: 23:59 de ontem já é outro dia", () => {
    assert.equal(rotuloHora(em(2026, 11, 10, 23, 59), agora), "Terça"); assert.equal(rotuloHora(em(2026, 11, 11, 0, 0), agora), "00:00");
    const meiaNoite = new Date(2026, 10, 12, 0, 1); assert.equal(rotuloHora(em(2026, 11, 11, 23, 59), meiaNoite), "Quarta", "um minuto depois da meia-noite, ontem aparece como dia da semana");
  });
  test("outro dia, nos últimos 6 dias: o dia da semana", () => {
    assert.equal(rotuloHora(em(2026, 11, 10), agora), "Terça"); assert.equal(rotuloHora(em(2026, 11, 9), agora), "Segunda"); assert.equal(rotuloHora(em(2026, 11, 8), agora), "Domingo");
    assert.equal(rotuloHora(em(2026, 11, 7), agora), "Sábado"); assert.equal(rotuloHora(em(2026, 11, 6), agora), "Sexta"); assert.equal(rotuloHora(em(2026, 11, 5), agora), "Quinta");
  });
  test("a partir de 7 dias: a data completa dia/mês/ano (o nome do dia se repetiria e confundiria)", () => {
    assert.equal(rotuloHora(em(2026, 11, 4), agora), "04/11/2026", "mesma quarta, da semana passada"); assert.equal(rotuloHora(em(2026, 10, 31), agora), "31/10/2026"); assert.equal(rotuloHora(em(2025, 12, 1), agora), "01/12/2025"); assert.equal(rotuloHora(em(2024, 2, 29), agora), "29/02/2024");
  });
  test("virada de mês e de ano contam certo", () => {
    const ano = new Date(2027, 0, 2, 10, 0); assert.equal(rotuloHora(em(2026, 12, 31), ano), "Quinta"); assert.equal(rotuloHora(em(2026, 12, 25), ano), "25/12/2026"); assert.equal(rotuloHora(em(2027, 1, 2, 8, 0), ano), "08:00");
  });
  test("mudança de horário de verão não desloca o dia (diferença de dias é por data, não por 24 h)", () => {
    for (const [a, b] of [[new Date(2026, 9, 18, 12), new Date(2026, 9, 17, 23)], [new Date(2026, 1, 22, 12), new Date(2026, 1, 21, 23)]]) assert.ok(["Sábado", "Sexta", "Domingo", "Sábado"].includes(rotuloHora(b.getTime(), a)));
    assert.equal(rotuloHora(new Date(2026, 9, 17, 23).getTime(), new Date(2026, 9, 18, 12)), "Sábado");
  });
  test("relógio adiantado (mensagem 'do futuro') mostra a hora; dado ruim vira vazio", () => {
    assert.equal(rotuloHora(em(2026, 11, 12, 10, 0), agora), "10:00"); for (const x of [NaN, undefined, "lixo", {}]) assert.equal(rotuloHora(x, agora), "", String(x));
    assert.equal(rotuloHora(new Date(2026, 10, 11, 14, 0).toISOString(), agora), "14:00", "texto de data do servidor também serve");
  });
  test("data completa para o texto que aparece ao parar o dedo/mouse", () => { assert.match(dataCompleta(em(2026, 11, 11, 15, 29)), /2026/); assert.equal(dataCompleta("lixo"), ""); });
});
describe("mensagens novas e quem está online", () => {
  test("99+ e o texto no singular e no plural", () => { assert.equal(rotuloNovas(1), "1"); assert.equal(rotuloNovas(99), "99"); assert.equal(rotuloNovas(100), "99+"); assert.equal(textoNovas(1), "1 mensagem nova"); assert.equal(textoNovas(3), "3 mensagens novas"); });
  test("online no grupo: não conta a própria pessoa nem quem está fora", () => {
    const on = new Set(["eu", "ana", "beto"]); assert.equal(contaOnline(["eu", "ana", "caio", "beto"], "eu", on), 2); assert.equal(contaOnline(["eu", "caio"], "eu", on), 0); assert.equal(contaOnline([], "eu", on), 0);
  });
});
