// Recorte inteligente: o MediaPipe "Magic Touch" (Google, Apache 2.0) devolve o contorno do objeto tocado.
// Roda TODO no aparelho (WebAssembly): a imagem nunca sai do navegador. Os arquivos ficam em vendor/mediapipe/ (a política de segurança só deixa carregar do próprio site).
const base = new URL("./vendor/mediapipe/", import.meta.url).href;
let pronto = null;
export function carregarIA() {
  return (pronto ||= (async () => {
    const { FilesetResolver, InteractiveSegmenter } = await import(base + "vision_bundle.mjs");
    const arquivos = { wasmLoaderPath: base + "wasm/vision_wasm_internal.js", wasmBinaryPath: base + "wasm/vision_wasm_internal.wasm" };
    return InteractiveSegmenter.createFromOptions(arquivos, { baseOptions: { modelAssetPath: base + "interactive_segmentation.task", delegate: "CPU" } });
  })().catch((e) => { pronto = null; throw e; }));
}
// Passo pesado, feito UMA vez por imagem; depois cada toque é rápido.
export async function definirImagem(canvas) { (await carregarIA()).setImage(canvas); }
// Toque em (x,y), em pixels do canvas informado em definirImagem -> { w, h, conf }: confiança 0..1 do objeto tocado.
export async function segmentar(x, y, W, H) {
  const seg = await carregarIA(), m = seg.segment([{ brushMode: 1, isCompleted: true, point: [{ x: x / W, y: y / H }] }]);
  try {
    const f = m.hasFloat32Array?.() || m.getAsFloat32Array ? m.getAsFloat32Array() : null;
    return { w: m.width, h: m.height, conf: f };
  } finally { m.close?.(); }
}
