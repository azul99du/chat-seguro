// Worker da transcrição: carrega o Whisper (Transformers.js + ONNX Runtime Web, em WebAssembly, 1 thread) e transcreve áudio no próprio aparelho.
// Mensagens que recebe: { tipo: "transcrever", id, modelo, audio: Float32Array (mono, 16 kHz) }.  Mensagens que manda: progresso, estado, pronto, erro.
import { limpaModelo, limpaTranscricao, MODELOS } from "./transcricao.js?v=270f640f35";
import { baseVendor, arquivoDoModelo } from "./transcricao-arquivos.js?v=270f640f35";
let T = null, atual = null, fila = Promise.resolve(); const vendor = baseVendor();
const manda = (m) => postMessage(m);
async function lib() {
  if (T) return T;
  T = await import(new URL("transformers.min.js", vendor).href); const env = T.env;
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false; env.localModelPath = vendor.pathname; // (caminho, não endereço: é o que a biblioteca entende como "arquivo local")
  env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false; // 1 thread: o GitHub Pages não permite threads (sem COOP/COEP)
  env.backends.onnx.wasm.wasmPaths = { mjs: new URL("ort-wasm-simd-threaded.mjs", vendor).href, wasm: new URL("ort-wasm-simd-threaded.wasm", vendor).href };
  const original = env.fetch;
  env.fetch = (alvo, init) => { // os arquivos do modelo vêm do nosso carregador (cache no aparelho, partes juntadas, andamento do download)
    const u = new URL(typeof alvo === "string" ? alvo : alvo.url, self.location.href); if (u.origin === self.location.origin && u.pathname.startsWith(vendor.pathname)) {
      const [id, ...resto] = u.pathname.slice(vendor.pathname.length).split("/"); if (Object.hasOwn(MODELOS, id) && resto.length) return arquivoDoModelo(id, resto.join("/"), (n) => { baixado += n; manda({ tipo: "progresso", baixado, total }); });
    }
    return original(alvo, init);
  };
  return T;
}
let baixado = 0, total = 0;
async function carregar(id) {
  if (atual?.id === id) return atual.asr;
  if (atual) { try { await atual.asr.dispose(); } catch {} atual = null; }
  const { pipeline } = await lib(); baixado = 0; total = Object.values(MODELOS[id].arquivos).reduce((a, b) => a + b, 0);
  manda({ tipo: "estado", fase: "carregando" });
  const asr = await pipeline("automatic-speech-recognition", id, { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, device: "wasm" });
  atual = { id, asr }; return asr;
}
async function transcrever({ id, modelo, audio }) {
  try {
    modelo = limpaModelo(modelo); if (!(audio instanceof Float32Array) || audio.length < 1600) throw new Error("Esse áudio é curto demais para transcrever.");
    const asr = await carregar(modelo); manda({ tipo: "estado", fase: "transcrevendo" });
    const r = await asr(audio, { language: "portuguese", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
    manda({ tipo: "pronto", id, texto: limpaTranscricao(Array.isArray(r) ? r.map((x) => x.text).join(" ") : r?.text) });
  } catch (e) { manda({ tipo: "erro", id, mensagem: String(e?.message || e).slice(0, 200) }); }
}
onmessage = (e) => { if (e.data?.tipo === "transcrever") fila = fila.then(() => transcrever(e.data)); };
