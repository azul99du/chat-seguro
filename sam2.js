// SAM 2.1 "tiny" (Meta, Apache 2.0) em ONNX, rodando no próprio aparelho (WebAssembly, em segundo plano para não travar a tela).
// A foto nunca sai do navegador. Arquivos em vendor/sam2/ (modelo) e vendor/ort/ (ONNX Runtime Web, MIT): a política de segurança só deixa carregar do próprio site.
const modelos = new URL("./vendor/sam2/", import.meta.url).href, ortBase = new URL("./vendor/ort/", import.meta.url).href;
const MEDIA = [0.485, 0.456, 0.406], DESVIO = [0.229, 0.224, 0.225];
let pronto = null, ortMod = null, cadeia = Promise.resolve(), embeddings = null;
// O ONNX Runtime Web não aceita duas execuções ao mesmo tempo: tudo entra numa fila única.
const serial = (fn) => (cadeia = cadeia.catch(() => {}).then(fn));
export function carregarSAM() {
  return (pronto ||= (async () => {
    const ort = (ortMod = await import(ortBase + "ort.wasm.min.mjs"));
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = true; ort.env.wasm.wasmPaths = ortBase; // 1 thread: o GitHub Pages não permite threads (sem COOP/COEP)
    const sessao = (nome) => ort.InferenceSession.create(modelos + nome + ".onnx", { executionProviders: ["wasm"], externalData: [{ path: nome + ".onnx_data", data: modelos + nome + ".onnx_data" }] });
    const enc = await sessao("vision_encoder_int8"), dec = await sessao("prompt_encoder_mask_decoder_int8"); // em sequência: criar as duas ao mesmo tempo troca as sessões no ONNX Runtime Web
    return { enc, dec };
  })().catch((e) => { pronto = null; throw e; }));
}
// Passo pesado, UMA vez por foto (a foto é esticada para 1024x1024, como o SAM 2 espera). Depois cada clique é rápido.
export function definirImagem(canvas) {
  const meu = serial(async () => {
    const { enc } = await carregarSAM(), c = document.createElement("canvas"); c.width = c.height = 1024;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(canvas, 0, 0, 1024, 1024); const d = g.getImageData(0, 0, 1024, 1024).data, N = 1024 * 1024, px = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) px[k * N + i] = (d[i * 4 + k] / 255 - MEDIA[k]) / DESVIO[k];
    const e = await enc.run({ pixel_values: new ortMod.Tensor("float32", px, [1, 3, 1024, 1024]) });
    // guardamos CÓPIAS: no modo em segundo plano o ONNX Runtime transfere (esvazia) os buffers de entrada a cada execução
    return [0, 1, 2].map((k) => ({ dados: Float32Array.from(e["image_embeddings." + k].data), dims: e["image_embeddings." + k].dims }));
  });
  embeddings = meu; return meu.then(() => true);
}
// Pontos (x,y de 0 a 1) sobre o que se quer recortar -> { notas[3], logits Float32Array(3*256*256) }. null se a foto trocou no meio.
export async function segmentar(pontos, aindaVale = () => true) {
  const meu = embeddings; if (!meu) throw new Error("sem imagem");
  const em = await meu; if (meu !== embeddings) return null;
  const { dec } = await carregarSAM(), n = pontos.length, T = ortMod.Tensor;
  const pts = new Float32Array(n * 2); pontos.forEach(([x, y], i) => { pts[i * 2] = x * 1024; pts[i * 2 + 1] = y * 1024; });
  const o = await serial(() => (aindaVale() ? dec.run({ input_points: new T("float32", pts, [1, 1, n, 2]), input_labels: new T("int64", BigInt64Array.from(pontos.map(() => 1n)), [1, 1, n]), input_boxes: new T("float32", new Float32Array(0), [1, 0, 4]), ...Object.fromEntries(em.map((x, k) => ["image_embeddings." + k, new T("float32", x.dados.slice(), x.dims)])) }) : null)); // toque que já foi substituído por outro não gasta tempo
  if (!o) return null;
  return { notas: Array.from(o.iou_scores.data), logits: o.pred_masks.data };
}
