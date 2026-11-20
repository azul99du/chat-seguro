// Worker do resumo: carrega o modelo de linguagem (Transformers.js + ONNX Runtime Web, WebAssembly, 1 thread) a partir dos arquivos JÁ conferidos e guardados no aparelho
// e gera o resumo da transcrição. Recebe { tipo: "resumir", id, texto }. Manda: estado, pronto, erro. Nada sai do aparelho.
import { MODELO, MAX_TOKENS, mensagensDoPedido, recorteDaEntrada, limpaResumo } from "./resumo.js?v=57186633d8";
import { respostaDoArquivo, modeloResumoBaixado } from "./resumo-arquivos.js?v=57186633d8";
const vendor = new URL("./vendor/whisper/", import.meta.url), RAIZ = "/__lacre_resumo__/";
let T = null, gen = null, fila = Promise.resolve(); const manda = (m) => postMessage(m);
async function lib() {
  if (T) return T;
  T = await import(new URL("transformers.min.js", vendor).href); const env = T.env;
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false; env.localModelPath = RAIZ; // (nenhum pedido sai pela rede: tudo vem do que foi conferido e guardado)
  env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = { mjs: new URL("ort-wasm-simd-threaded.mjs", vendor).href, wasm: new URL("ort-wasm-simd-threaded.wasm", vendor).href };
  const original = env.fetch;
  env.fetch = (alvo, init) => { const u = new URL(typeof alvo === "string" ? alvo : alvo.url, self.location.href); if (u.origin === self.location.origin && u.pathname.startsWith(RAIZ + MODELO.id + "/")) return respostaDoArquivo(u.pathname.slice((RAIZ + MODELO.id + "/").length)); return original(alvo, init); };
  return T;
}
async function carregar() {
  if (gen) return gen; if (!(await modeloResumoBaixado())) throw new Error("O modelo de resumo não está no aparelho. Baixe-o de novo.");
  const { pipeline } = await lib(); manda({ tipo: "estado", fase: "carregando" });
  gen = await pipeline("text-generation", MODELO.id, { dtype: "q4", device: "wasm" }); return gen;
}
async function resumir({ id, texto }) {
  try {
    const { texto: entrada, cortou } = recorteDaEntrada(texto); if (entrada.length < 40) throw new Error("A transcrição é curta demais para resumir.");
    const g = await carregar(); manda({ tipo: "estado", fase: "resumindo" });
    const prompt = g.tokenizer.apply_chat_template(mensagensDoPedido(entrada), { add_generation_prompt: true, tokenize: false, enable_thinking: false }); // (sem o "pensamento" do Qwen3: gasta tempo e não ajuda)
    const r = await g(prompt, { max_new_tokens: MAX_TOKENS, do_sample: false, return_full_text: false });
    const saida = limpaResumo(Array.isArray(r) ? r[0]?.generated_text : r?.generated_text); if (!saida) throw new Error("O modelo não conseguiu resumir esse texto.");
    manda({ tipo: "pronto", id, resumo: saida, cortou });
  } catch (e) { gen = null; manda({ tipo: "erro", id, mensagem: String(e?.message || e).slice(0, 220) }); }
}
onmessage = (e) => { if (e.data?.tipo === "resumir") fila = fila.then(() => resumir(e.data)); };
