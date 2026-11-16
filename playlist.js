// Playlists: minhas playlists (sincronizadas, cifradas) e o estado de uma playlist tocando numa conversa. Funções puras (testadas em Node).
// Uma música é do tipo "a" (trecho de 30 s da Apple) ou "y" (vídeo do YouTube, música inteira). O que vem do servidor ou de outra pessoa só entra se tiver a forma certa.
export const MAX_PLAYLISTS = 20, MAX_FAIXAS = 100, MAX_NOME = 40, MAX_TITULO = 100;
const PREVIA_OK = /^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s"'<>]+$/, CAPA_OK = /^https:\/\/is[1-5]-ssl\.mzstatic\.com\/[^\s"'<>]+$/, YT_ID = /^[A-Za-z0-9_-]{11}$/, LISTA_ID = /^[A-Za-z0-9_-]{6,40}$/;
const limpaTexto = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export const novoId = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 14); };
// ---------- Endereços do YouTube: só os do próprio YouTube, com o código de 11 caracteres ----------
const HOSTS_YT = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);
export function idYoutube(texto) {
  let t = String(texto ?? "").trim().replace(/^[(<\[“"']+/, "").replace(/[)>\].,;:!?”"']+$/, ""); if (!/^https?:\/\//i.test(t)) { if (YT_ID.test(t)) return null; t = "https://" + t; }
  let u; try { u = new URL(t); } catch { return null; } if (u.username || u.password || u.port || !HOSTS_YT.has(u.hostname.toLowerCase())) return null;
  let id = null; if (u.hostname.toLowerCase() === "youtu.be") id = u.pathname.split("/")[1]; else if (u.pathname === "/watch") id = u.searchParams.get("v"); else { const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname); id = m && m[1]; }
  return id && YT_ID.test(id) ? id : null;
}
export const capaYoutube = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const chaveFaixa = (f) => `${f.t}:${f.id}`;
// ---------- Música e playlist ----------
export function limpaFaixa(f) {
  if (!f || typeof f !== "object") return null; const ti = limpaTexto(f.ti, MAX_TITULO), ar = limpaTexto(f.ar, 80); if (!ti) return null;
  if (f.t === "a") { if (!Number.isSafeInteger(f.id) || typeof f.pr !== "string" || !PREVIA_OK.test(f.pr)) return null; return { t: "a", id: f.id, ti, ar, pr: f.pr, ...(typeof f.ca === "string" && CAPA_OK.test(f.ca) ? { ca: f.ca } : {}) }; }
  if (f.t === "y") { if (typeof f.id !== "string" || !YT_ID.test(f.id)) return null; return { t: "y", id: f.id, ti, ar, ...(Number.isFinite(f.du) && f.du > 0 && f.du < 36000 ? { du: Math.round(f.du) } : {}) }; }
  return null;
}
export function limpaPlaylist(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !LISTA_ID.test(p.id)) return null; const nome = limpaTexto(p.nome, MAX_NOME); if (!nome) return null;
  const vistos = new Set(), faixas = []; for (const x of Array.isArray(p.faixas) ? p.faixas : []) { const f = limpaFaixa(x); if (f && !vistos.has(chaveFaixa(f))) { vistos.add(chaveFaixa(f)); faixas.push(f); if (faixas.length >= MAX_FAIXAS) break; } }
  return { id: p.id, nome, faixas, mod: Number.isFinite(p.mod) && p.mod > 0 ? Math.round(p.mod) : 0 };
}
export const colecaoVazia = () => ({ v: 1, listas: [], apagadas: {} });
export function limpaColecao(c) {
  const out = colecaoVazia(); if (!c || typeof c !== "object") return out;
  for (const [id, t] of Object.entries(c.apagadas && typeof c.apagadas === "object" ? c.apagadas : {})) if (LISTA_ID.test(id) && Number.isFinite(t) && Object.keys(out.apagadas).length < 200) out.apagadas[id] = Math.round(t);
  const ids = new Set(); for (const x of Array.isArray(c.listas) ? c.listas : []) { const p = limpaPlaylist(x); if (p && !ids.has(p.id) && !(out.apagadas[p.id] >= p.mod)) { ids.add(p.id); out.listas.push(p); if (out.listas.length >= MAX_PLAYLISTS) break; } }
  return out;
}
// Junta duas coleções (a minha e a que veio de outro aparelho): por playlist vale a mais recente; uma apagada depois da última mudança continua apagada
export function mesclar(a, b) {
  a = limpaColecao(a); b = limpaColecao(b); const apagadas = { ...a.apagadas }; for (const [id, t] of Object.entries(b.apagadas)) apagadas[id] = Math.max(apagadas[id] || 0, t);
  const por = new Map(); for (const p of [...a.listas, ...b.listas]) { const o = por.get(p.id); if (!o || p.mod > o.mod) por.set(p.id, p); }
  return limpaColecao({ v: 1, apagadas, listas: [...por.values()].sort((x, y) => x.mod - y.mod) });
}
export const duracaoDaFaixa = (f) => (f?.t === "a" ? 30 : Number.isFinite(f?.du) ? f.du : null);
export const rotuloFaixa = (f) => `${f?.ti || "Música"}${f?.ar ? " · " + f.ar : ""}`;
// ---------- Estado de uma playlist tocando: f = faixa, p = segundos no momento em que foi gravado, t = tocando, a = aleatório, l = repetir esta, o = ordem sorteada ----------
export const estadoInicial = () => ({ f: 0, p: 0, t: true, a: false, l: false });
export function limpaEstado(e, n = 200) {
  if (!e || typeof e !== "object") return null; const tot = Math.max(1, Math.min(200, n));
  const f = Number.isSafeInteger(e.f) && e.f >= 0 && e.f < tot ? e.f : 0, p = Number.isFinite(e.p) && e.p >= 0 && e.p < 86400 ? e.p : 0, a = e.a === true, o = a && Array.isArray(e.o) && e.o.length === tot && new Set(e.o).size === tot && e.o.every((x) => Number.isSafeInteger(x) && x >= 0 && x < tot) ? e.o : undefined;
  const s = Number.isSafeInteger(e.s) && e.s > 0 && e.s < 1e9 ? e.s : 0;
  return { f, p, t: e.t !== false, a: a && o !== undefined ? true : false, l: e.l === true, ...(a && o ? { o } : {}), ...(s ? { s } : {}) };
}
// Ordem aleatória com a faixa atual primeiro
export function embaralhar(n, atual = 0, rnd = Math.random) {
  const r = Array.from({ length: n }, (_, i) => i).filter((i) => i !== atual); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return n ? [atual, ...r] : [];
}
// Segundos em que a faixa está AGORA (hora do servidor em ms): parada fica onde parou, tocando anda desde que o estado foi gravado
export const posicaoAgora = (e, agoraMs, emMs) => (e.t ? Math.max(0, e.p + (agoraMs - emMs) / 1000) : e.p);
function vizinha(e, n, dir) {
  if (n <= 0) return 0; if (e.a && e.o) { const k = e.o.indexOf(e.f); return e.o[(((k < 0 ? 0 : k) + dir) % n + n) % n]; } return (((e.f + dir) % n) + n) % n;
}
// A faixa acabou sozinha: repete a mesma (loop) ou vai para a próxima (na ordem, ou na sorteada)
export const fimNatural = (e, n) => ({ ...e, f: e.l ? e.f : vizinha(e, n, 1), p: 0, t: true });
// Pular para a próxima/anterior (o loop de uma música não impede de pular)
export const pular = (e, n, dir = 1) => ({ ...e, f: vizinha(e, n, dir < 0 ? -1 : 1), p: 0, t: true });
export const irPara = (e, i, n) => ({ ...e, f: Math.max(0, Math.min(n - 1, i | 0)), p: 0, t: true });
export const pausar = (e, agoraMs, emMs) => ({ ...e, p: posicaoAgora(e, agoraMs, emMs), t: false });
export const continuar = (e) => ({ ...e, t: true });
export function alternarAleatorio(e, n, rnd = Math.random) { const { o, ...r } = e; return e.a ? { ...r, a: false } : { ...r, a: true, o: embaralhar(n, e.f, rnd) }; }
export const alternarLoop = (e) => ({ ...e, l: !e.l });
// Avançar ou voltar o tempo da música: vai para `seg` e marca um "pulo" novo (s), que faz os outros aparelhos irem junto mesmo que a diferença seja pequena
export const buscar = (e, seg) => ({ ...e, p: Math.max(0, Math.min(86399, Number(seg) || 0)), s: (Number.isSafeInteger(e.s) ? e.s : 0) + 1 });
// Para mandar ao servidor: só os campos do estado
export const estadoParaServidor = (e) => ({ f: e.f, p: Math.round(e.p * 10) / 10, t: !!e.t, a: !!e.a, l: !!e.l, ...(e.a && e.o ? { o: e.o } : {}), ...(Number.isSafeInteger(e.s) && e.s > 0 ? { s: e.s } : {}) });
// Conteúdo cifrado de uma sessão: a playlist congelada de quando começou
export function limpaSessaoFaixas(c) {
  if (!c || typeof c !== "object") return null; const p = limpaPlaylist({ id: typeof c.pl === "string" && LISTA_ID.test(c.pl) ? c.pl : "sessao00", nome: c.nome || "Playlist", faixas: c.faixas, mod: 1 }); if (!p || !p.faixas.length) return null;
  return { pl: typeof c.pl === "string" && LISTA_ID.test(c.pl) ? c.pl : null, nome: p.nome, faixas: p.faixas };
}
// Hora do servidor: guarda a diferença entre o relógio dele e o deste aparelho
export const relogio = () => { let d = 0; return { acerta(agoraServidorMs, localMs = Date.now()) { if (Number.isFinite(agoraServidorMs)) d = agoraServidorMs - localMs; }, agora: (localMs = Date.now()) => localMs + d, dif: () => d }; };
export function erroPlaylist(e) {
  const m = String(e?.message || ""), c = e?.code;
  if (/conflito/.test(m)) return "Suas playlists mudaram em outro aparelho. Tentando juntar…";
  if (/saldo_insuficiente/.test(m)) return "Você não tem Selos suficientes para isso.";
  if (/item_desligado/.test(m)) return "O admin desligou esta vantagem.";
  if (/ja_com_playlist/.test(m)) return "Já há uma playlist tocando neste grupo. Espere acabar.";
  if (/sem_conversa/.test(m)) return "Só dá para tocar playlist com quem já conversou com você.";
  if (/sem_controle/.test(m)) return "Só quem iniciou a playlist controla, e no grupo só enquanto durar.";
  if (/aparelho_pendente/.test(m)) return "Aprove este aparelho antes.";
  if (c === "PT429" || /rate_limit|limite de uso/.test(m)) return "Muitas ações seguidas. Espere um pouco.";
  return "Não foi possível agora. Tente de novo.";
}
