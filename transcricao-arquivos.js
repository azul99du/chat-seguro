// Arquivos dos modelos de transcrição: baixados do próprio site (vendor/whisper/), juntados se estiverem em partes e guardados no aparelho (Cache API),
// para a segunda vez não baixar de novo. Usado pela tela (para saber se o modelo já está no aparelho) e pelo worker (para carregá-lo).
import { MODELOS, limpaModelo, enderecosDoArquivo, CACHE_MODELOS } from "./transcricao.js?v=c71ae3b8e0";
export const baseVendor = () => new URL("./vendor/whisper/", import.meta.url);
const chave = (id, arquivo) => new URL(`${id}/${arquivo}`, baseVendor()).href;
const tipoDe = (arquivo) => (arquivo.endsWith(".json") ? "application/json" : "application/octet-stream");
export async function modeloBaixado(id) {
  id = limpaModelo(id);
  try { const c = await caches.open(CACHE_MODELOS); for (const a of Object.keys(MODELOS[id].arquivos)) if (!(await c.match(chave(id, a)))) return false; return true; } catch { return false; }
}
export async function apagarModelo(id) {
  id = limpaModelo(id); try { const c = await caches.open(CACHE_MODELOS); for (const a of Object.keys(MODELOS[id].arquivos)) await c.delete(chave(id, a)); } catch {}
}
// Devolve uma Response com o arquivo inteiro. progresso(n): n bytes novos baixados (só quando não estava guardado).
export async function arquivoDoModelo(id, arquivo, progresso = () => {}) {
  id = limpaModelo(id); if (!Object.hasOwn(MODELOS[id].arquivos, arquivo)) return new Response(null, { status: 404 });
  let cache = null; try { cache = await caches.open(CACHE_MODELOS); const guardado = await cache.match(chave(id, arquivo)); if (guardado) return guardado; } catch {}
  const pedacos = [];
  for (const fim of enderecosDoArquivo(id, arquivo)) {
    const r = await fetch(new URL(fim, baseVendor()), { credentials: "omit", referrerPolicy: "no-referrer" }); if (!r.ok || !r.body) throw new Error(`Não foi possível baixar ${arquivo}.`);
    const leitor = r.body.getReader(); for (;;) { const { done, value } = await leitor.read(); if (done) break; pedacos.push(value); progresso(value.byteLength); }
  }
  const blob = new Blob(pedacos), resposta = () => new Response(blob, { status: 200, headers: { "content-type": tipoDe(arquivo), "content-length": String(blob.size) } });
  if (cache) { try { await cache.put(chave(id, arquivo), resposta()); } catch {} } // (sem espaço para guardar: usa só desta vez)
  return resposta();
}
