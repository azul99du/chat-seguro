// Música nas conversas (estilo Instagram): busca no catálogo público da Apple (iTunes Search), trecho de até 30 s escolhido por quem envia.
// Funções puras (testadas em Node). O que vem da Apple e o que vem de OUTRA pessoa (conteúdo da mensagem) é desconfiável: só entra o que tem a forma certa.
// Privacidade: a busca e o trecho vêm direto da Apple (ela vê o IP e o que se digita na busca); o que vai para a conversa é cifrado como qualquer mídia.
export const MAX_TRECHO_S = 30, MIN_TRECHO_S = 5, PADRAO_TRECHO_S = 15, MAX_RESULTADOS = 20;
const PREVIA_OK = /^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s"'<>]+$/, CAPA_OK = /^https:\/\/is[1-5]-ssl\.mzstatic\.com\/[^\s"'<>]+$/;
const PATH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/, B64 = /^[A-Za-z0-9+/=_-]{8,64}$/;
export const MIME_MUSICA = ["audio/mp4", "audio/mpeg", "audio/wav"]; // (os trechos da Apple são AAC em MP4; MP3 e WAV também tocam em qualquer aparelho)
const limpaTexto = (s, max = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export const urlBusca = (termo, pais = "BR", limite = MAX_RESULTADOS) => `https://itunes.apple.com/search?term=${encodeURIComponent(limpaTexto(termo, 100))}&media=music&entity=song&limit=${limite}&country=${pais}`;
// A Apple deixa trocar o tamanho no fim do endereço da capa (100x100bb -> 600x600bb)
export const capaGrande = (url, lado = 600) => (typeof url === "string" ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, `/${lado}x${lado}bb.jpg`) : url);
// Resposta da busca -> lista de { id, titulo, artista, previa, capa (pequena, para a lista), capaGrande }
export function limpaBusca(json) {
  const out = [], vistos = new Set();
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    if (!r || typeof r !== "object" || r.kind !== "song" || !Number.isSafeInteger(r.trackId) || vistos.has(r.trackId)) continue;
    if (typeof r.previewUrl !== "string" || !PREVIA_OK.test(r.previewUrl) || typeof r.artworkUrl100 !== "string" || !CAPA_OK.test(r.artworkUrl100)) continue;
    const titulo = limpaTexto(r.trackName), artista = limpaTexto(r.artistName); if (!titulo) continue;
    vistos.add(r.trackId); out.push({ id: r.trackId, titulo, artista: artista || "Artista desconhecido", previa: r.previewUrl, capa: r.artworkUrl100, capaGrande: capaGrande(r.artworkUrl100) });
    if (out.length >= MAX_RESULTADOS) break;
  }
  return out;
}
// O trecho é uma janela dentro do arquivo (que tem até 30 s): duração entre 5 s e o tamanho do arquivo; começo entre 0 e (total - duração)
export function janelaDoTrecho(total, ini, dur) {
  const t = Number.isFinite(total) && total > 0 ? Math.min(total, MAX_TRECHO_S) : MAX_TRECHO_S, min = Math.min(MIN_TRECHO_S, t);
  const d = Math.max(min, Math.min(t, Number.isFinite(dur) ? dur : PADRAO_TRECHO_S)), i = Math.max(0, Math.min(t - d, Number.isFinite(ini) ? ini : 0));
  return { ini: Math.round(i * 10) / 10, dur: Math.round(d * 10) / 10 };
}
const arquivoOk = (a, mimes) => a && typeof a === "object" && typeof a.path === "string" && PATH_OK.test(a.path) && typeof a.key === "string" && B64.test(a.key) && typeof a.iv === "string" && B64.test(a.iv) && mimes.includes(a.mime);
// Conteúdo "kind: musica" que chegou numa mensagem (a pessoa que enviou controla tudo): devolve o que dá para mostrar, ou null
export function limpaMusica(c) {
  if (!c || typeof c !== "object" || c.type !== "media" || c.kind !== "musica" || !arquivoOk(c, MIME_MUSICA) || !arquivoOk(c.capa, ["image/jpeg"])) return null;
  const titulo = limpaTexto(c.titulo), artista = limpaTexto(c.artista); if (!titulo) return null;
  const ini = Number(c.ini), dur = Number(c.dur); if (!Number.isFinite(ini) || !Number.isFinite(dur) || ini < 0 || dur < 1 || ini + dur > MAX_TRECHO_S + 0.5) return null;
  return { titulo, artista: artista || "Artista desconhecido", ini, dur, audio: { path: c.path, key: c.key, iv: c.iv, mime: c.mime }, capa: { path: c.capa.path, key: c.capa.key, iv: c.capa.iv, mime: "image/jpeg" } };
}
export const textoMusica = (c) => `${limpaTexto(c?.titulo) || "Música"} · ${limpaTexto(c?.artista) || "Artista desconhecido"}`;
export const mmssCurto = (s) => { const n = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
