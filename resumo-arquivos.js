// Arquivos do modelo de resumo: baixados do Hugging Face (versão fixa), CONFERIDOS pela assinatura SHA-256 e guardados no aparelho (Cache API).
// Nada é usado antes de conferir: se o tamanho ou a assinatura não baterem, o arquivo é descartado e a pessoa é avisada. Usado pela tela e pelo worker.
import { MODELO, CACHE_RESUMO, urlDoArquivo, arquivoConhecido } from "./resumo.js?v=57186633d8";
import { Sha256 } from "./sha256.js?v=57186633d8";
const chave = (arquivo) => new URL(`/__lacre_resumo__/${MODELO.id}/${arquivo}`, self.location.href).href; // (endereço só nosso: o arquivo guardado não tem relação com o endereço de onde veio)
const tipoDe = (arquivo) => (arquivo.endsWith(".json") ? "application/json" : "application/octet-stream");
const tamanhoGuardado = (r) => Number(r.headers.get("content-length"));
export async function modeloResumoBaixado(manifesto = MODELO.arquivos) { // todos os arquivos guardados, cada um com o tamanho certo (a assinatura foi conferida quando entrou)
  try { const c = await caches.open(CACHE_RESUMO); for (const [a, f] of Object.entries(manifesto)) { const r = await c.match(chave(a)); if (!r || tamanhoGuardado(r) !== f.tam) return false; } return true; } catch { return false; }
}
export async function apagarModeloResumo() { try { await caches.delete(CACHE_RESUMO); } catch {} }
export async function arquivoGuardado(arquivo) { if (!arquivoConhecido(arquivo)) return null; try { return (await (await caches.open(CACHE_RESUMO)).match(chave(arquivo))) ?? null; } catch { return null; } }
export class ErroModelo extends Error { constructor(msg, codigo) { super(msg); this.codigo = codigo; } }
// Baixa o que falta. progresso(nBytesNovos). sinal: AbortSignal para cancelar. Se a rede cair no meio de um arquivo, ele recomeça do começo na próxima vez.
export async function baixarModeloResumo({ progresso = () => {}, sinal = undefined, buscar = (u, i) => fetch(u, i), manifesto = MODELO.arquivos, urlDe = urlDoArquivo } = {}) {
  const cache = await caches.open(CACHE_RESUMO);
  for (const [arquivo, f] of Object.entries(manifesto)) {
    const ja = await cache.match(chave(arquivo)); if (ja && tamanhoGuardado(ja) === f.tam) { progresso(f.tam); continue; }
    const r = await buscar(urlDe(arquivo), { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", cache: "no-store", signal: sinal });
    if (!r.ok || !r.body) throw new ErroModelo(`Não foi possível baixar ${arquivo} (erro ${r.status}).`, "rede");
    const tamAviso = Number(r.headers.get("content-length")); if (Number.isFinite(tamAviso) && tamAviso > 0 && tamAviso !== f.tam) throw new ErroModelo(`O arquivo ${arquivo} veio com tamanho diferente do esperado. Nada foi guardado.`, "tamanho");
    const hash = new Sha256(); let n = 0;
    const confere = new TransformStream({ transform(pedaco, ctl) { n += pedaco.byteLength; if (n > f.tam) throw new ErroModelo(`O arquivo ${arquivo} é maior que o esperado. Nada foi guardado.`, "tamanho"); hash.update(pedaco); progresso(pedaco.byteLength); ctl.enqueue(pedaco); } });
    try { await cache.put(chave(arquivo), new Response(r.body.pipeThrough(confere), { status: 200, headers: { "content-type": tipoDe(arquivo), "content-length": String(f.tam) } })); }
    catch (e) {
      await cache.delete(chave(arquivo)).catch(() => {});
      if (e instanceof ErroModelo || e?.name === "AbortError") throw e;
      if (e?.name === "QuotaExceededError" || /quota|storage|space/i.test(String(e?.message))) throw new ErroModelo("Não há espaço para guardar o modelo neste navegador (abas anônimas costumam ter pouquíssimo espaço). Libere espaço ou abra o Lacre numa aba normal.", "espaco");
      throw new ErroModelo(`O download foi interrompido (${String(e?.name || "erro")}). Tente de novo: ele recomeça deste arquivo.`, "rede");
    }
    if (n !== f.tam || hash.hex() !== f.sha) { await cache.delete(chave(arquivo)); throw new ErroModelo(`O arquivo ${arquivo} não passou na conferência de segurança (assinatura diferente da esperada). Ele foi descartado e nada foi usado.`, "assinatura"); }
  }
}
// Resposta para o carregador do Transformers.js (dentro do worker): só serve o que está guardado e conferido
export async function respostaDoArquivo(arquivo) { const r = await arquivoGuardado(arquivo); return r ? r : new Response(null, { status: 404 }); }
export { chave as chaveDoArquivo };
