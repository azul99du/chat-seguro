// Resumo de áudio com IA no próprio aparelho: um modelo de linguagem pequeno (Qwen3 0,6B, 4 bits) roda no navegador sobre a TRANSCRIÇÃO que já existe.
// O modelo NÃO vem junto com o site (são 876 MB): é um download opcional, só depois da pessoa aceitar, direto do Hugging Face, de uma versão FIXA e com
// cada arquivo conferido pela assinatura SHA-256 antes de ser usado. O áudio e o texto nunca saem do aparelho. Aqui ficam as partes puras (testadas em Node).
export const HOST_MODELO = "https://huggingface.co";
export const MODELO = {
  id: "qwen3-0.6b-q4", nome: "Qwen3 0,6B", licenca: "Apache 2.0", repo: "onnx-community/Qwen3-0.6B-ONNX",
  commit: "79346d370dfae34801d26993fda9ae2372900fd0", // versão exata (nunca "main"): o conteúdo desse endereço não muda
  arquivos: {
    "config.json": { tam: 912, sha: "8a04114ba59cc42b47d804d35d1d5c61d746ae4634f41f796768c6e302d39b9e" },
    "generation_config.json": { tam: 219, sha: "9e9e031ae8bca36eefcdcdd0b35d83c61baa01e31d68d5f5a961c9ca1a4b95bf" },
    "tokenizer.json": { tam: 9117040, sha: "e7a95fce95bf5b0946d0ddb3f9d7caa030b7e850bbe92b0edb26bcf563e9f3d5" },
    "tokenizer_config.json": { tam: 10369, sha: "7c5194eecfd95a4dcbd6b4b502af785d2541fd65a388d1cae7ad43693c67b802" },
    "onnx/model_q4.onnx": { tam: 919096585, sha: "d43d836fc5e240df9013733ccd214972c5d21bd9ec47e574e4f1e359cf90aed0" },
  },
};
export const CACHE_RESUMO = "lacre-resumo-v1";
export const urlDoArquivo = (arquivo) => `${HOST_MODELO}/${MODELO.repo}/resolve/${MODELO.commit}/${arquivo}`;
export const bytesTotais = () => Object.values(MODELO.arquivos).reduce((a, f) => a + f.tam, 0);
export const mbTotais = () => Math.round(bytesTotais() / 1048576);
export const arquivoConhecido = (a) => Object.hasOwn(MODELO.arquivos, a);

export const MIN_CHARS_RESUMO = 400; // só oferece o resumo quando a transcrição já é longa (um recado curto não precisa)
export const MAX_CHARS_ENTRADA = 4500; // o que entra no modelo (uns 5 minutos de fala); o resto é cortado, com aviso
export const MAX_TOKENS = 240;
export const MAX_RESUMO = 1400;
export const MEMORIA_MIN_GB = 4; // aparelhos que informam menos que isso (Chrome diz 0.25 a 8) não tentam

// ---- o pedido ao modelo ----
export const SISTEMA = "Você resume mensagens de voz transcritas. Responda SEMPRE em português do Brasil, com no máximo 5 tópicos curtos (um por linha, começando com \"- \"). Use SOMENTE informações que estão no texto. Copie datas, horários, valores e números exatamente como aparecem. Se algo não está no texto, não escreva.";
export function recorteDaEntrada(texto) {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= MAX_CHARS_ENTRADA) return { texto: t, cortou: false };
  const corte = t.slice(0, MAX_CHARS_ENTRADA), ponto = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
  return { texto: ponto > MAX_CHARS_ENTRADA * 0.6 ? corte.slice(0, ponto + 1) : corte, cortou: true };
}
export const mensagensDoPedido = (texto) => [{ role: "system", content: SISTEMA }, { role: "user", content: `Resuma esta mensagem de voz:\n\n${texto}` }];

// ---- a resposta ----
// Tira o "pensamento" (<think>), o negrito do markdown e linhas soltas; deixa só tópicos "- …"; se o texto foi cortado no meio de um tópico, descarta o pedaço
export function limpaResumo(saida) {
  let t = String(saida ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/\*\*/g, "").replace(/__/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");
  const linhas = t.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^(?:[-*•–]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 2);
  if (!linhas.length) return null;
  const ultima = linhas[linhas.length - 1];
  if (linhas.length > 1 && !/[.!?…)"”]$/.test(ultima) && ultima.length < 60) linhas.pop(); // (parou no meio da frase: o final cortado não é confiável)
  const fora = linhas.slice(0, 6).map((l) => (/[.!?…]$/.test(l) ? l : l + ".")).join("\n");
  return fora.slice(0, MAX_RESUMO).trim() || null;
}
export const topicos = (resumo) => String(resumo ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// ---- avisos para a pessoa ----
export function memoriaOk(deviceMemory) { // navigator.deviceMemory (só Chrome/Android/Edge); em Safari não existe: tenta, com aviso
  if (typeof deviceMemory !== "number" || !Number.isFinite(deviceMemory)) return { ok: true, aviso: "Este aparelho não informa quanta memória tem. Se a página fechar sozinha durante o resumo, ele é pesado demais para ele." };
  if (deviceMemory < MEMORIA_MIN_GB) return { ok: false, aviso: "Este aparelho tem pouca memória para o resumo com IA (o modelo precisa de uns 2 GB livres)." };
  return { ok: true, aviso: "" };
}
export function estimativaResumo(chars) { // segundos de espera "em média" num celular, só para avisar antes
  const s = Math.max(30, Math.round(40 + (Number(chars) || 0) / 12)); return s < 90 ? `uns ${s} s` : `uns ${Math.round(s / 60)} min`;
}
export const pesoLegivel = (bytes) => (bytes >= 1048576 ? `${Math.round(bytes / 1048576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export const ofereceResumo = (texto, min = MIN_CHARS_RESUMO) => String(texto ?? "").trim().length >= min;
