// Foto de perfil: recorta quadrado (com arrastar e zoom), reduz para 256x256 e codifica leve (WebP; JPEG se o navegador não faz WebP).
// Ao redesenhar no canvas, todos os metadados (local, câmera, data) são descartados.
export const LADO = 256, MAX_BYTES = 100 * 1024, TIPOS_ENTRADA = /^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i;
export const CAMINHO_OK = /^[0-9a-f-]{36}\/[0-9]{10,16}\.(webp|jpg)$/;

export function enquadrar(w, h, zoom = 1, cx = 0.5, cy = 0.5) { // retângulo fonte (quadrado) dentro da imagem
  const base = Math.min(w, h), lado = base / Math.max(1, zoom);
  const x = Math.min(Math.max(cx * w - lado / 2, 0), w - lado), y = Math.min(Math.max(cy * h - lado / 2, 0), h - lado);
  return { x, y, lado };
}
export function desenhar(ctx, img, w, h, zoom, cx, cy, tam = LADO) {
  const r = enquadrar(w, h, zoom, cx, cy);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tam, tam); ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.lado, r.lado, 0, 0, tam, tam);
}
const paraBlob = (cv, tipo, q) => new Promise((ok) => cv.toBlob(ok, tipo, q));
export async function codificar(cv) {
  for (const tipo of ["image/webp", "image/jpeg"]) {
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const b = await paraBlob(cv, tipo, q);
      if (b && b.type === tipo && b.size <= MAX_BYTES) return b;
      if (b && b.type !== tipo) break; // o navegador não sabe este formato: tenta o próximo
    }
  }
  return null;
}
export const extensao = (blob) => (blob.type === "image/webp" ? "webp" : "jpg");
export function caminhoNovo(uid, blob, agora = Date.now()) { return `${uid}/${agora}.${extensao(blob)}`; }
