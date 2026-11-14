// "Quem viu / quem ouviu" a minha mensagem (design "Lacre com anel"): funções puras, testadas em Node.
// `quem` = Map: id de quem recebeu -> { t: instante em que leu (texto ISO) ou null, ate: segundos ouvidos (áudio) ou null, tudo: ouviu até o fim?, em: quando ouviu }.
// Os dados vêm das linhas que EU enviei (uma por aparelho de cada pessoa): o banco guarda read_at e, nos áudios, ouvido_ate / ouvido_tudo / ouvido_em.
export const MAX_ARCOS = 8; // o anel tem no máximo 8 partes; em grupos maiores ele é proporcional
const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };
const novo = () => ({ t: null, ate: null, tudo: false, em: null });
const mais = (a, b) => (b && (!a || ms(b) > ms(a)) ? b : a);   // o instante mais recente
const antes = (a, b) => (b && (!a || ms(b) < ms(a)) ? b : a);  // o instante mais cedo

// Soma ao mapa o que UMA linha do servidor diz sobre quem recebeu. Devolve se algo mudou. Vale a primeira leitura, o maior trecho ouvido, e "ouviu tudo" se qualquer aparelho ouviu.
export function somarLinha(quem, l, eu = null) {
  const id = l?.recipient_id; if (!(quem instanceof Map) || typeof id !== "string" || id === eu) return false;
  const p = quem.get(id) || null, n = p ? { ...p } : novo();
  n.t = antes(n.t, l.read_at || null);
  const ate = Number.isFinite(l.ouvido_ate) ? Math.max(0, Math.trunc(l.ouvido_ate)) : null; if (ate !== null) n.ate = Math.max(n.ate ?? 0, ate);
  if (l.ouvido_tudo === true) n.tudo = true;
  n.em = mais(n.em, l.ouvido_em || null);
  if (p && p.t === n.t && p.ate === n.ate && p.tudo === n.tudo && p.em === n.em) return false;
  quem.set(id, n); return true;
}
// Junta todas as linhas de uma mensagem (várias por pessoa: uma por aparelho). Cópias para mim mesmo não contam.
export function juntarLeituras(linhas, eu) { const q = new Map(); for (const l of linhas || []) somarLinha(q, l, eu); return q; }

// Estado de uma pessoa: "tudo" (ouviu tudo), "parte" (ouviu só um trecho), "viu" (viu a mensagem), "nao". Só áudio tem "tudo" e "parte".
export function estadoDe(p, audio = false) {
  if (!p) return "nao";
  if (audio && p.tudo) return "tudo";
  if (audio && p.ate > 0) return "parte";
  return p.t || p.ate > 0 || p.tudo ? "viu" : "nao";
}
export function resumoVistos(quem, audio = false) {
  const r = { n: 0, k: 0, todos: false, vistos: [], tudo: [], parte: [], viu: [], faltam: [] };
  for (const [id, p] of quem || []) {
    r.n++; const e = estadoDe(p, audio);
    if (e === "nao") { r.faltam.push(id); continue; }
    r.vistos.push({ id, t: p.t || p.em });
    if (e === "tudo") r.tudo.push({ id, t: p.em || p.t }); else if (e === "parte") r.parte.push({ id, ate: p.ate, t: p.em || p.t }); else r.viu.push({ id, t: p.t });
  }
  const porT = (a, b) => ms(a.t) - ms(b.t) || (a.id < b.id ? -1 : 1);
  r.vistos.sort(porT); r.tudo.sort(porT); r.parte.sort(porT); r.viu.sort(porT);
  r.k = audio ? r.tudo.length + r.parte.length : r.vistos.length;               // áudio: quantos OUVIRAM (inteiro ou em parte); texto: quantos viram
  r.todos = r.n > 0 && (audio ? r.tudo.length === r.n : !r.faltam.length);        // áudio: todos ouviram tudo; texto: todos viram
  return r;
}
const ORDEM = ["tudo", "parte", "viu", "nao"];
// As partes do anel, em ordem de "mais completo" para "menos": uma por pessoa (até `max`); em grupo maior, proporcional.
// Alguém em cada estado aparece ao menos uma vez, e o anel só fecha por completo quando TODOS terminaram.
export function arcosDoAnel(r, max = MAX_ARCOS) {
  const cont = { tudo: r.tudo.length, parte: r.parte.length, viu: r.viu.length, nao: r.faltam.length }, n = r.n;
  if (!(n > 0)) return [];
  const m = Math.min(n, max); let q;
  if (n <= max) q = { ...cont };
  else {
    q = {}; let soma = 0; const resto = [];
    for (const e of ORDEM) { const x = (cont[e] / n) * m; q[e] = Math.floor(x); soma += q[e]; resto.push([x - q[e], e]); }
    resto.sort((a, b) => b[0] - a[0]); for (let i = 0; soma < m; i++, soma++) q[resto[i % resto.length][1]]++;
    for (const e of ORDEM) if (cont[e] > 0 && q[e] === 0) { const maior = ORDEM.filter((x) => q[x] > 1).sort((a, b) => q[b] - q[a])[0]; if (maior) { q[maior]--; q[e] = 1; } } // quem existe aparece
    if (cont.nao + cont.viu + cont.parte > 0 && q.tudo >= m) { q.tudo = m - 1; q.nao++; }                                                         // nunca fecha sem todos
  }
  const out = []; for (const e of ORDEM) for (let i = 0; i < q[e]; i++) out.push(e); return out.slice(0, m);
}
export const textoVistos = (r) => (r.todos ? "todos" : `${r.k}/${r.n}`);
export function textoLongoVistos(r, audio = false) {
  if (!(r.n > 0)) return "";
  if (audio) return r.todos ? (r.n === 1 ? "A pessoa ouviu" : "Todos ouviram") : r.k === 0 ? "Ninguém ouviu ainda" : `${r.k} de ${r.n} ouviram`;
  return r.todos ? (r.n === 1 ? "A pessoa viu" : "Todos viram") : r.k === 0 ? "Ninguém viu ainda" : `${r.k} de ${r.n} viram`;
}
// Conversa a dois: o texto ao lado da hora. `audio`: se a mensagem é um áudio. hora(t) e tempo(seg) formatam para a tela.
export function reciboDm(m, audio, hora, tempo) {
  if (audio && m?.ouvido_tudo) return { texto: "ouvida " + hora(m.ouvido_em || m.read_at), classe: "read" };
  if (audio && m?.ouvido_ate > 0) return { texto: "ouviu até " + tempo(m.ouvido_ate), classe: "parte" };
  if (m?.read_at) return { texto: "vista " + hora(m.read_at), classe: "read" };
  return { texto: "enviada", classe: "" };
}
// Junta as linhas de uma conversa a dois (uma por aparelho de quem recebeu) num só "recibo": primeira leitura, maior trecho ouvido, "tudo" se qualquer aparelho ouviu.
export function juntarRecibo(atual, l) {
  const r = { read_at: atual?.read_at || null, ouvido_ate: atual?.ouvido_ate ?? null, ouvido_tudo: !!atual?.ouvido_tudo, ouvido_em: atual?.ouvido_em || null };
  r.read_at = antes(r.read_at, l?.read_at || null);
  if (Number.isFinite(l?.ouvido_ate)) r.ouvido_ate = Math.max(r.ouvido_ate ?? 0, Math.trunc(l.ouvido_ate));
  if (l?.ouvido_tudo === true) r.ouvido_tudo = true;
  r.ouvido_em = mais(r.ouvido_em, l?.ouvido_em || null); return r;
}

// ---------- Quem OUVE: mede quanto da gravação a pessoa realmente ouviu ----------
// Só conta o que tocou de verdade e seguido: pular para o fim não vale como "ouviu". `ate` = até onde chegou ouvindo; `tudo` = ouviu (quase) tudo.
export const MIN_OUVIDO = 1;       // menos de 1 s ouvido não é registrado (toque sem querer)
export class Escuta {
  constructor(dur) { this.dur = Number.isFinite(dur) && dur > 0 ? dur : 0; this.ouvido = 0; this.ate = 0; this.ultimo = null; this.fimOk = false; }
  tempo(t) { if (!Number.isFinite(t)) return; if (this.ultimo !== null) { const d = t - this.ultimo; if (d > 0 && d <= 1.5) { this.ouvido += d; this.ate = Math.max(this.ate, t); } } this.ultimo = t; }
  salto() { this.ultimo = null; }
  fim() { if (this.ultimo !== null) { const falta = this.dur ? this.dur - this.ultimo : 0; if (falta >= 0 && falta <= 1.5) { this.ouvido += falta; this.ate = Math.max(this.ate, this.dur); } } this.fimOk = this.ultimo !== null; this.ultimo = null; }
  get tudo() { return this.dur > 0 ? this.ouvido >= this.dur * 0.9 : this.fimOk && this.ouvido >= MIN_OUVIDO; }
  // O que contar ao servidor, ou null se ainda não vale (ouviu pouco). `ate` em segundos inteiros, e sempre a duração toda quando ouviu tudo.
  relato() { if (this.ouvido < MIN_OUVIDO) return null; const tudo = this.tudo; return { ate: tudo && this.dur ? Math.ceil(this.dur) : Math.floor(this.ate), tudo }; }
}
