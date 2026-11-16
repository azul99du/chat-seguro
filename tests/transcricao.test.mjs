import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { statSync, existsSync, readFileSync } from "node:fs";
import { MODELOS, IDS_MODELOS, MODELO_PADRAO, MAX_TRANSCRICAO_S, MAX_TEXTO, limpaModelo, bytesDoModelo, mbDoModelo, enderecosDoArquivo, paraMono, limpaTranscricao, estimativa, pesoLegivel } from "../transcricao.js";

describe("transcrição de áudios (funções puras)", () => {
  test("os dois modelos: Base e Melhor (Small); desconhecido vira o padrão", () => {
    assert.deepEqual(IDS_MODELOS, ["base", "small"]); assert.equal(MODELO_PADRAO, "base"); assert.equal(limpaModelo("small"), "small"); assert.equal(limpaModelo("grande"), "base"); assert.equal(limpaModelo(null), "base"); assert.equal(limpaModelo("__proto__"), "base"); assert.equal(limpaModelo("toString"), "base");
    assert.equal(MODELOS.small.nome, "Melhor (Small)"); assert.ok(mbDoModelo("small") > mbDoModelo("base") * 2); assert.equal(mbDoModelo("base"), 76); assert.equal(mbDoModelo("small"), 240);
  });
  test("a lista de arquivos bate com o que está em vendor/whisper (tamanho exato), e o que passa de 100 MB está em partes", () => {
    for (const id of IDS_MODELOS) for (const [arq, bytes] of Object.entries(MODELOS[id].arquivos)) {
      const fins = enderecosDoArquivo(id, arq), tam = fins.reduce((s, f) => { const p = new URL(`../vendor/whisper/${f}`, import.meta.url); assert.ok(existsSync(p), `${f} existe`); const n = statSync(p).size; assert.ok(n <= 95_000_000, `${f} cabe no limite de 100 MB do GitHub`); return s + n; }, 0);
      assert.equal(tam, bytes, `${id}/${arq}`);
    }
    assert.deepEqual(enderecosDoArquivo("small", "onnx/decoder_model_merged_quantized.onnx"), ["small/onnx/decoder_model_merged_quantized.onnx.parte0", "small/onnx/decoder_model_merged_quantized.onnx.parte1"]); assert.deepEqual(enderecosDoArquivo("base", "config.json"), ["base/config.json"]);
    assert.equal(bytesDoModelo("base"), Object.values(MODELOS.base.arquivos).reduce((a, b) => a + b, 0));
  });
  test("paraMono: média dos canais; vazio e canais de tamanhos diferentes não quebram", () => {
    assert.deepEqual([...paraMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 0, 1)])], [0.5, 0, 0]); assert.deepEqual([...paraMono([Float32Array.of(0.25, 0.5)])], [0.25, 0.5]); assert.equal(paraMono([]).length, 0); assert.equal(paraMono(null).length, 0); assert.equal(paraMono([Float32Array.of(1, 2, 3), Float32Array.of(1)]).length, 1);
  });
  test("limpaTranscricao: tira controles, junta espaços e corta no limite", () => {
    assert.equal(limpaTranscricao("  Oi,\n\n tudo\tbem?  \u0007 "), "Oi, tudo bem?"); assert.equal(limpaTranscricao(null), ""); assert.equal(limpaTranscricao("a‮b"), "a b"); assert.equal(limpaTranscricao("x".repeat(MAX_TEXTO + 50)).length, MAX_TEXTO);
  });
  test("estimativa e peso legível", () => {
    assert.equal(estimativa("base", 10), "uns 15 s"); assert.equal(estimativa("small", 10), "uns 40 s"); assert.equal(estimativa("small", 60), "uns 4 min"); assert.equal(estimativa("base", 0), "uns 3 s"); assert.equal(MAX_TRANSCRICAO_S, 300);
    assert.equal(pesoLegivel(5 * 1048576), "5 MB"); assert.equal(pesoLegivel(2048), "2 KB");
  });
  test("a nota de licenças existe e os modelos vêm de fontes MIT/Apache", () => {
    const n = readFileSync(new URL("../vendor/whisper/NOTICE.md", import.meta.url), "utf8"); assert.match(n, /MIT/); assert.match(n, /Apache 2\.0/); assert.ok(existsSync(new URL("../vendor/whisper/LICENSE-transformers.txt", import.meta.url)));
  });
});
