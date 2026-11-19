import test from "node:test";
import assert from "node:assert/strict";
import { MODELO, urlDoArquivo, bytesTotais, mbTotais, arquivoConhecido, recorteDaEntrada, mensagensDoPedido, limpaResumo, topicos, memoriaOk, estimativaResumo, ofereceResumo, MAX_CHARS_ENTRADA, MIN_CHARS_RESUMO, HOST_MODELO, SISTEMA } from "../resumo.js";

test("modelo: versão fixa (commit de 40 letras, nunca main), 5 arquivos, tamanho e assinatura de cada um", () => {
  assert.match(MODELO.commit, /^[0-9a-f]{40}$/); assert.doesNotMatch(urlDoArquivo("config.json"), /\/main\//);
  assert.equal(urlDoArquivo("onnx/model_q4.onnx"), `https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/${MODELO.commit}/onnx/model_q4.onnx`);
  assert.equal(Object.keys(MODELO.arquivos).length, 5); for (const [nome, f] of Object.entries(MODELO.arquivos)) { assert.match(f.sha, /^[0-9a-f]{64}$/, nome); assert.ok(Number.isSafeInteger(f.tam) && f.tam > 0, nome); }
  assert.equal(bytesTotais(), 919096585 + 9117040 + 10369 + 912 + 219); assert.equal(mbTotais(), 885); assert.equal(arquivoConhecido("onnx/model_q4.onnx"), true); assert.equal(arquivoConhecido("../x"), false); assert.equal(HOST_MODELO, "https://huggingface.co");
});
test("recorte da entrada: texto curto passa; comprido é cortado no fim de uma frase, com aviso", () => {
  assert.deepEqual(recorteDaEntrada("  oi   tudo\nbem "), { texto: "oi tudo bem", cortou: false });
  const longo = "Uma frase de teste com tamanho razoável. ".repeat(300), r = recorteDaEntrada(longo); assert.equal(r.cortou, true); assert.ok(r.texto.length <= MAX_CHARS_ENTRADA); assert.ok(r.texto.endsWith("."), "termina numa frase inteira");
  assert.equal(recorteDaEntrada("x".repeat(MAX_CHARS_ENTRADA + 50)).texto.length, MAX_CHARS_ENTRADA, "sem ponto: corta no limite");
});
test("pedido: sistema + texto; o sistema manda usar só o que está no texto e copiar números", () => {
  const m = mensagensDoPedido("texto aqui"); assert.equal(m.length, 2); assert.equal(m[0].role, "system"); assert.match(m[1].content, /texto aqui$/); assert.match(SISTEMA, /SOMENTE informações que estão no texto/); assert.match(SISTEMA, /Copie datas/);
});
test("limpaResumo: tira negrito, pensamento e numeração; corta pedaço final incompleto; no máximo 6 tópicos", () => {
  assert.equal(limpaResumo("- **Data:** a viagem é dia 15 de julho.\n- **Preço:** R$ 1.200 em 6 parcelas."), "Data: a viagem é dia 15 de julho.\nPreço: R$ 1.200 em 6 parcelas.");
  assert.equal(limpaResumo("<think>pensando...</think>\n1. Primeiro tópico completo.\n2) Segundo tópico também."), "Primeiro tópico completo.\nSegundo tópico também.");
  assert.equal(limpaResumo("- Tópico inteiro e completo aqui.\n- O ônibus sai às"), "Tópico inteiro e completo aqui.", "o final cortado no meio sai");
  assert.equal(limpaResumo("<think>sem fechar"), null); assert.equal(limpaResumo(""), null); assert.equal(limpaResumo(null), null); assert.equal(limpaResumo("- \n-\n"), null);
  assert.equal(limpaResumo(Array.from({ length: 9 }, (_, i) => `- Tópico número ${i + 1} completo.`).join("\n")).split("\n").length, 6);
  assert.equal(limpaResumo("Um tópico sem ponto final").endsWith("."), true); assert.ok(limpaResumo("- " + "a ".repeat(2000)).length <= 1401);
  assert.deepEqual(topicos("a.\n\nb."), ["a.", "b."]);
});
test("memória: Chrome informa; Safari não informa (tenta com aviso); pouca memória não tenta", () => {
  assert.equal(memoriaOk(8).ok, true); assert.equal(memoriaOk(8).aviso, ""); assert.equal(memoriaOk(4).ok, true); assert.equal(memoriaOk(2).ok, false); assert.match(memoriaOk(0.5).aviso, /pouca memória/);
  assert.equal(memoriaOk(undefined).ok, true); assert.match(memoriaOk(undefined).aviso, /não informa/); assert.equal(memoriaOk(NaN).ok, true);
});
test("estimativa, peso e quando oferecer", () => {
  assert.match(estimativaResumo(300), /^uns \d+ s$/); assert.match(estimativaResumo(4500), /min$/); assert.equal(estimativaResumo(undefined), "uns 40 s");
  assert.equal(ofereceResumo("a".repeat(MIN_CHARS_RESUMO)), true); assert.equal(ofereceResumo("a".repeat(MIN_CHARS_RESUMO - 1)), false); assert.equal(ofereceResumo("   "), false); assert.equal(ofereceResumo("curto", 3), true);
});
