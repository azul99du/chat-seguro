import { test } from "node:test";
import assert from "node:assert/strict";
import { regrasVazias, limpaRegras, igualRegras, algumaLigada, marcoNovo, ajustaCampo, frase, fraseTexto, frasesLigadas, previa, textoSelos, saldoLimpo, erroRegras, faixa, MAX_MARCOS } from "../selos.js";

test("cada grupo começa sem nenhuma regra (tudo desligado)", () => {
  const v = regrasVazias(); assert.equal(algumaLigada(v), false); assert.deepEqual(frasesLigadas(v), []);
  assert.equal(previa(v).total, 0);
});
test("o que vem do servidor é limpo: só chaves conhecidas e inteiros dentro dos limites", () => {
  const r = limpaRegras({ entrada: { on: true, valor: 20, extra: 1 }, dia_ativo: { on: true, valor: 1000, min: -1 }, mensagens: { on: "sim", valor: 1.5, a_cada: "10" }, hack: { on: true }, teto: { on: true, valor: 999 } });
  assert.deepEqual(r.entrada, { on: true, valor: 20 }); assert.deepEqual(r.dia_ativo, { on: true, valor: 1, min: 1 }, "fora do limite volta ao mínimo");
  assert.deepEqual(r.mensagens, { on: false, valor: 1, a_cada: 1 }); assert.equal("hack" in r, false); assert.deepEqual(r.teto, { on: true, valor: 999 });
  for (const lixo of [null, undefined, "x", 5, [], { sequencia: "oi" }]) assert.equal(algumaLigada(limpaRegras(lixo)), false);
});
test("marcos da sequência: sem repetir dias, em ordem, no máximo 10, valores nos limites", () => {
  const marcos = [{ dias: 7, valor: 30 }, { dias: 3, valor: 10 }, { dias: 7, valor: 99 }, { dias: 0, valor: 5 }, { dias: 366, valor: 5 }, { dias: 14, valor: 1000 }, null, { dias: 2.5, valor: 1 }];
  const r = limpaRegras({ sequencia: { on: true, marcos } });
  assert.deepEqual(r.sequencia.marcos, [{ dias: 3, valor: 10 }, { dias: 7, valor: 30 }, { dias: 14, valor: 1 }]);
  const muitos = Array.from({ length: 30 }, (_, i) => ({ dias: i + 1, valor: 1 })); assert.equal(limpaRegras({ sequencia: { on: true, marcos: muitos } }).sequencia.marcos.length, MAX_MARCOS);
});
test("marco novo: um número de dias que ainda não existe", () => {
  assert.deepEqual(marcoNovo([]), { dias: 3, valor: 1 }); assert.deepEqual(marcoNovo([{ dias: 3, valor: 1 }]), { dias: 7, valor: 1 });
  assert.equal(marcoNovo(Array.from({ length: MAX_MARCOS }, (_, i) => ({ dias: i + 1, valor: 1 }))), null);
  assert.equal(marcoNovo([3, 7, 14, 30, 60, 90, 180, 365].map((dias) => ({ dias, valor: 1 }))), null);
});
test("número digitado: só dígitos, dentro dos limites do campo", () => {
  assert.equal(ajustaCampo("valor", "20"), 20); assert.equal(ajustaCampo("valor", "5000"), 999); assert.equal(ajustaCampo("valor", "0"), 1); assert.equal(ajustaCampo("valor", "abc"), null);
  assert.equal(ajustaCampo("valor", "-7"), 7); assert.equal(ajustaCampo("dias", "400"), 365); assert.equal(ajustaCampo("min", ""), null); assert.equal(ajustaCampo("a_cada", "1e3"), 13, "só os dígitos valem");
  assert.deepEqual(faixa("dias"), [1, 365]);
});
test("frases das regras (singular e plural) e os números que dá para tocar", () => {
  const r = limpaRegras({ entrada: { on: true, valor: 20 }, dia_ativo: { on: true, valor: 5, min: 3 }, mensagens: { on: true, valor: 1, a_cada: 10 }, arquivos: { on: true, valor: 2, a_cada: 1 }, sequencia: { on: true, marcos: [{ dias: 3, valor: 10 }, { dias: 1, valor: 1 }] }, teto: { on: true, valor: 1 } });
  assert.equal(fraseTexto(frase("entrada", r)), "Ganha 20 Selos ao entrar no grupo");
  assert.equal(fraseTexto(frase("dia_ativo", r)), "Ganha 5 Selos em cada dia com pelo menos 3 mensagens");
  assert.equal(fraseTexto(frase("mensagens", r)), "Ganha 1 Selo a cada 10 mensagens enviadas");
  assert.equal(fraseTexto(frase("arquivos", r)), "Ganha 2 Selos a cada 1 arquivo enviado");
  assert.equal(fraseTexto(frase("sequencia", r, 0)), "Com 1 dia seguido, ganha 1 Selo", "marcos em ordem: 1 dia primeiro");
  assert.equal(fraseTexto(frase("sequencia", r, 1)), "Com 3 dias seguidos, ganha 10 Selos");
  assert.equal(fraseTexto(frase("teto", r)), "No máximo 1 Selo por pessoa em cada dia");
  assert.deepEqual(frase("sequencia", r, 9), []);
  const toques = frase("dia_ativo", r).filter((p) => typeof p !== "string"); assert.deepEqual(toques.map((p) => [p.campo, p.tipo, p.n]), [["valor", "s", 5], ["min", "q", 3]]);
  assert.equal(frasesLigadas(r).length, 7, "4 ações + 2 marcos + teto");
});
test("prévia de um dia comum, com e sem teto", () => {
  const r = limpaRegras({ dia_ativo: { on: true, valor: 5, min: 3 }, mensagens: { on: true, valor: 1, a_cada: 10 }, entrada: { on: true, valor: 99 } });
  assert.deepEqual(previa(r, 20), { total: 7, itens: [{ acao: "dia_ativo", qtd: 5 }, { acao: "mensagens", qtd: 2 }] }, "entrada e sequência não entram");
  assert.equal(previa(r, 2).total, 0, "poucas mensagens: nem dia ativo");
  assert.equal(previa({ ...r, teto: { on: true, valor: 6 } }, 20).total, 6);
  assert.equal(previa({ ...r, teto: { on: true, valor: 3 } }, 20).total, 3);
  assert.equal(previa(limpaRegras({ arquivos: { on: true, valor: 4, a_cada: 2 } }), 0, 5).total, 8);
});
test("igualdade de regras e textos", () => {
  assert.equal(igualRegras(regrasVazias(), { entrada: { on: false, valor: 1 } }), true); assert.equal(igualRegras(regrasVazias(), { entrada: { on: true, valor: 1 } }), false);
  assert.equal(textoSelos(1), "1 Selo"); assert.equal(textoSelos(0), "0 Selos"); assert.equal(textoSelos(12), "12 Selos");
  assert.deepEqual(saldoLimpo({ user_id: "u", confirmados: "12", pendentes: 5 }), { id: "u", saldo: 12 }, "vale o saldo do extrato");
  assert.deepEqual(saldoLimpo(null), { id: undefined, saldo: 0 }); assert.equal(saldoLimpo({ confirmados: 1e15 }).saldo, 1e9); assert.equal(saldoLimpo({ confirmados: -4 }).saldo, 0);
  assert.match(erroRegras({ code: "42501" }), /admin/); assert.match(erroRegras({ code: "22023" }), /999/); assert.match(erroRegras({}), /Não foi possível/);
});
