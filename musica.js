// Música nas conversas (estilo Instagram): busca no catálogo público da Apple (iTunes Search), trecho de até 30 s escolhido por quem envia.
// Funções puras (testadas em Node). O que vem da Apple e o que vem de OUTRA pessoa (conteúdo da mensagem) é desconfiável: só entra o que tem a forma certa.
// Privacidade: a busca e o trecho vêm direto da Apple (ela vê o IP e o que se digita na busca); o que vai para a conversa é cifrado como qualquer mídia.
export const MAX_TRECHO_S = 30, MIN_TRECHO_S = 5, PADRAO_TRECHO_S = 15, MAX_RESULTADOS = 20, PAGINA_RESULTADOS = 20, MAX_BUSCA = 200; // (a lista da busca mostra 20 de cada vez e vai soltando mais conforme se desce, até MAX_BUSCA)
const PREVIA_OK = /^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s"'<>]+$/, CAPA_OK = /^https:\/\/is[1-5]-ssl\.mzstatic\.com\/[^\s"'<>]+$/;
const PATH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/, B64 = /^[A-Za-z0-9+/=_-]{8,64}$/;
export const MIME_MUSICA = ["audio/mp4", "audio/mpeg", "audio/wav"]; // (os trechos da Apple são AAC em MP4; MP3 e WAV também tocam em qualquer aparelho)
const limpaTexto = (s, max = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export const urlBusca = (termo, pais = "BR", limite = MAX_RESULTADOS) => `https://itunes.apple.com/search?term=${encodeURIComponent(limpaTexto(termo, 100))}&media=music&entity=song&limit=${limite}&country=${pais}`;
// A Apple deixa trocar o tamanho no fim do endereço da capa (100x100bb -> 600x600bb)
export const capaGrande = (url, lado = 600) => (typeof url === "string" ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, `/${lado}x${lado}bb.jpg`) : url);
// Resposta da busca -> lista de { id, titulo, artista, previa, capa (pequena, para a lista), capaGrande }
export function limpaBusca(json, origem = "br", max = MAX_RESULTADOS) {
  const out = [], vistos = new Set();
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    if (!r || typeof r !== "object" || r.kind !== "song" || !Number.isSafeInteger(r.trackId) || vistos.has(r.trackId)) continue;
    if (typeof r.previewUrl !== "string" || !PREVIA_OK.test(r.previewUrl) || typeof r.artworkUrl100 !== "string" || !CAPA_OK.test(r.artworkUrl100)) continue;
    const titulo = limpaTexto(r.trackName), artista = limpaTexto(r.artistName); if (!titulo) continue;
    vistos.add(r.trackId); out.push({ id: r.trackId, titulo, artista: artista || "Artista desconhecido", album: limpaTexto(r.collectionName), genero: limpaTexto(r.primaryGenreName, 40), previa: r.previewUrl, capa: r.artworkUrl100, capaGrande: capaGrande(r.artworkUrl100), origem, pos: out.length });
    if (out.length >= max) break;
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

// ---------- Busca melhor: tolera acento, maiúscula e erro de digitação; ordena por quão bem casou; destaca o melhor resultado ----------
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
export const tokens = (s) => norm(s).split(" ").filter(Boolean);
// Distância de edição (com troca de letras vizinhas), cortada em `max` para ser rápida
export function distancia(a, b, max = 3) {
  if (a === b) return 0; if (Math.abs(a.length - b.length) > max) return max + 1;
  let ant2 = null, ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let min = i;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1; let v = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + c);
      if (ant2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ant2[j - 2] + 1);
      cur[j] = v; if (v < min) min = v;
    }
    if (min > max) return max + 1; ant2 = ant; ant = cur;
  }
  return ant[b.length];
}
// Quanto a palavra digitada casa com uma palavra do resultado: 1 igual; 0,9 começo da palavra; menos se tem erro de digitação (1 erro até 6 letras, 2 de 7 em diante)
export function casaPalavra(q, t) {
  if (!q || !t) return 0; if (q === t) return 1; if (q.length >= 2 && t.startsWith(q)) return 0.9;
  const lim = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0; if (!lim) return 0;
  const d = Math.min(distancia(q, t, lim), distancia(q, t.slice(0, q.length), lim)); return d <= lim ? Math.max(0.5, 0.78 - 0.14 * (d - 1)) : 0;
}
const VERSAO_FALSA = /\b(karaoke|tribute|cover|instrumental|ringtone|made famous|lullaby|8 bit|piano version|originally performed|type beat|gym music|nightcore|slowed|sped up|geek music|trap music now)\b/;
// Álbum de trilha sonora oficial ("Death Note Original Soundtrack", "... (Original Motion Picture Soundtrack)", "... OST", "Trilha Sonora Original")
const ALBUM_OFICIAL = /\b(original (soundtrack|score|motion picture|television|tv|series|anime|game|video game)|trilha sonora original|banda sonora original|bande originale)\b|\bo ?s ?t( vol \d+| \d+)?$/, ALBUM_OFICIAL_JP = /(オリジナル|ｵﾘｼﾞﾅﾙ)\s*[・･]?\s*(サウンドトラック|サントラ|スコア)|원본 사운드트랙|\bOST\b$/i;
export const albumOficial = (album) => ALBUM_OFICIAL.test(norm(album)) || ALBUM_OFICIAL_JP.test(String(album ?? "")); // (a Apple escreve a trilha do anime em japonês também; "OST" só vale no fim do nome: "(OST Drill Remix)" é remix)
// Nota de 0 a ~100 de um resultado para o que foi digitado. ctx: { naLetra, popular (0-100) }
export function pontuar(termo, r, ctx = {}) {
  const q = tokens(termo); if (!q.length || !r) return 0;
  const tt = tokens(r.titulo), ta = tokens(r.artista), tl = tokens(r.album), melhor = (x, lista) => lista.reduce((m, t) => Math.max(m, casaPalavra(x, t)), 0);
  const oficial = albumOficial(r.album); // (o nome da obra no álbum da trilha original vale quase como no título: "death note" acha o álbum "DEATH NOTE Original Soundtrack" inteiro)
  let nota = (q.reduce((s, x) => s + Math.max(melhor(x, tt), 0.85 * melhor(x, ta), (oficial ? 0.9 : 0.35) * melhor(x, tl)), 0) / q.length) * 70;
  const nq = norm(termo), nt = norm(r.titulo);
  if (nt === nq) nota += 22; else if (nt.startsWith(nq + " ") || nt.startsWith(nq)) nota += 12; else if ((nt + " " + norm(r.artista)).includes(nq)) nota += 8;
  if (!VERSAO_FALSA.test(nq) && VERSAO_FALSA.test(norm(`${r.titulo} ${r.album} ${r.artista}`))) nota -= 25;
  if (oficial && q.every((x) => melhor(x, tl) >= 0.9) && !VERSAO_FALSA.test(norm(`${r.titulo} ${r.artista} ${r.album}`))) nota += 45; // a trilha original da obra buscada passa na frente de músicas de outros artistas com o mesmo nome
  nota += Math.max(0, 12 - (Number.isFinite(r.pos) ? r.pos : 20) * 0.6); // a ordem que a própria loja deu
  if (r.origem === "br") nota += 3; if (ctx.naLetra) nota += 10; if (Number.isFinite(ctx.popular)) nota += Math.max(0, Math.min(100, ctx.popular)) * 0.08;
  return Math.max(0, Math.round(nota * 10) / 10);
}
// Junta resultados de várias fontes (loja do Brasil, dos EUA...), tira repetidos (mesmo id, ou mesmo título e artista) e ordena pela nota
export function combinar(termo, grupos, limite = MAX_RESULTADOS) {
  const porChave = new Map();
  for (const g of Array.isArray(grupos) ? grupos : []) for (const r of g?.itens || []) {
    const it = { ...r, score: pontuar(termo, r, { naLetra: !!r.naLetra || g.naLetra, popular: r.popular }) }, chaves = [`id:${r.id}`, `t:${norm(r.titulo)}|${norm(r.artista)}`];
    const antes = chaves.map((k) => porChave.get(k)).find(Boolean);
    if (antes) { if (it.score > antes.score) { Object.assign(antes, it); } continue; }
    for (const k of chaves) porChave.set(k, it);
  }
  return [...new Set(porChave.values())].sort((a, b) => b.score - a.score || a.pos - b.pos).slice(0, limite);
}
// O primeiro resultado vira "melhor resultado" quando é bom o bastante e bem à frente do segundo (ou é o único)
export function destaque(lista) {
  const [a, b] = Array.isArray(lista) ? lista : []; if (!a || a.score < 55) return null;
  return !b || a.score - b.score >= 15 || a.score >= 1.3 * b.score ? a : null;
}
// Busca extra, sempre junto da principal: acha a trilha original da obra ("death note" -> "death note original soundtrack"); vazio se a pessoa já pediu isso
export const termoTrilha = (termo) => { const n = norm(termo); return !n || n.length > 60 || ALBUM_OFICIAL.test(n) || /\b(soundtrack|trilha)\b/.test(n) ? "" : `${n} original soundtrack`; };
// Buscas de reserva quando a primeira não acha nada: sem acento, só as palavras mais longas, e a palavra mais longa sem a última letra (corrige "akeboshii")
export function termosAmpliados(termo) {
  const t = tokens(termo), original = String(termo ?? "").trim().toLowerCase(), out = [], poe = (x) => { x = x.trim(); if (x && x !== original && !out.includes(x)) out.push(x); };
  if (!t.length) return out; poe(t.join(" "));
  if (t.length >= 3) poe([...t].sort((a, b) => b.length - a.length).slice(0, 2).join(" "));
  const longo = [...t].sort((a, b) => b.length - a.length)[0]; if (longo.length >= 6) poe(t.map((x) => (x === longo ? x.slice(0, -1) : x)).join(" "));
  return out.slice(0, 3);
}
// As "ondas" do trecho: n barras (0 a 1) com a força do som ao longo dos primeiros `total` segundos (RMS por pedaço)
export function barrasDeOnda(canais, taxa, n = 60, total = MAX_TRECHO_S) {
  const len = canais?.[0]?.length || 0; if (!len || !taxa || n < 1) return Array(Math.max(1, n)).fill(0.5);
  const alvo = Math.min(len, Math.round(total * taxa)), passo = alvo / n, rms = [];
  for (let i = 0; i < n; i++) { const a = Math.floor(i * passo), b = Math.max(a + 1, Math.floor((i + 1) * passo)); let soma = 0, c = 0; for (let k = a; k < b && k < len; k += 3) { let m = 0; for (const ch of canais) m += ch[k] || 0; m /= canais.length; soma += m * m; c++; } rms.push(Math.sqrt(soma / Math.max(1, c))); }
  const max = Math.max(...rms, 1e-6); return rms.map((v) => Math.round((0.14 + 0.86 * Math.pow(v / max, 0.65)) * 1000) / 1000);
}
