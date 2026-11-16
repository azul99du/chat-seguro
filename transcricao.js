// Transcrição de áudios: um modelo de voz (Whisper) roda no PRÓPRIO aparelho, num worker; o áudio e o texto nunca saem dele.
// Aqui ficam as partes puras (testadas em Node) e a lista de arquivos de cada modelo. Os arquivos moram em vendor/whisper/<modelo>/.
export const MAX_TRANSCRICAO_S = 300; // áudios de até 5 minutos
export const MAX_TEXTO = 6000;
export const MODELO_PADRAO = "base";
// tamanhos exatos (bytes) dos arquivos que o app baixa; "partes" = arquivo que passa de 100 MB e foi guardado em pedaços (.parte0, .parte1...)
export const MODELOS = {
  base: {
    id: "base", nome: "Base", dica: "Mais rápido, erra mais",
    arquivos: { "config.json": 2243, "generation_config.json": 3832, "preprocessor_config.json": 339, "tokenizer.json": 2480466, "tokenizer_config.json": 282682, "onnx/encoder_model_quantized.onnx": 23201314, "onnx/decoder_model_merged_quantized.onnx": 53693315 },
    partes: {}, fator: 1.5, // segundos de espera por segundo de áudio, em média, num celular (estimativa)
  },
  small: {
    id: "small", nome: "Melhor (Small)", dica: "Mais preciso, mais lento e mais pesado",
    arquivos: { "config.json": 2227, "generation_config.json": 3893, "preprocessor_config.json": 339, "tokenizer.json": 2480466, "tokenizer_config.json": 282683, "onnx/encoder_model_quantized.onnx": 92326160, "onnx/decoder_model_merged_quantized.onnx": 156750845 },
    partes: { "onnx/decoder_model_merged_quantized.onnx": 2 }, fator: 4,
  },
};
export const IDS_MODELOS = Object.keys(MODELOS);
export const limpaModelo = (id) => (Object.hasOwn(MODELOS, id) ? id : MODELO_PADRAO);
export const bytesDoModelo = (id) => Object.values(MODELOS[limpaModelo(id)].arquivos).reduce((a, b) => a + b, 0);
export const mbDoModelo = (id) => Math.round(bytesDoModelo(id) / 1048576);
// Endereços (relativos à pasta vendor/whisper/) que o app busca para um arquivo: um só, ou os pedaços
export const enderecosDoArquivo = (id, arquivo) => { const m = MODELOS[limpaModelo(id)], n = m.partes[arquivo]; return n ? Array.from({ length: n }, (_, i) => `${m.id}/${arquivo}.parte${i}`) : [`${m.id}/${arquivo}`]; };
// Mistura os canais em mono (média), em Float32 (é o que o modelo recebe, já em 16 kHz)
export function paraMono(canais) {
  const lista = Array.isArray(canais) ? canais.filter((c) => c && c.length) : []; if (!lista.length) return new Float32Array(0);
  const n = Math.min(...lista.map((c) => c.length)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of lista) s += c[i]; out[i] = s / lista.length; }
  return out;
}
// Texto que voltou do modelo: sem controles, espaços juntos, no máximo MAX_TEXTO
export const limpaTranscricao = (t) => String(t ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO);
// "uns 20 s" / "uns 2 min": estimativa grosseira para avisar a pessoa antes
export function estimativa(id, durS) {
  const s = Math.max(3, Math.ceil((Number(durS) || 0) * MODELOS[limpaModelo(id)].fator)); return s < 90 ? `uns ${s} s` : `uns ${Math.round(s / 60)} min`;
}
export const pesoLegivel = (bytes) => (bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export const CACHE_MODELOS = "lacre-whisper-v1";
