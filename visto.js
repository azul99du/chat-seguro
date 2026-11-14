// "Quem viu" a minha mensagem no grupo (design "Lacre com anel"): funções puras, testadas em Node.
// `quem` = Map: id de quem recebeu -> instante (texto ISO) em que leu, ou null se ainda não leu. Vem das linhas que EU enviei (uma por aparelho de cada pessoa).
export const MAX_ARCOS = 8; // o anel tem no máximo 8 partes; em grupos maiores ele é proporcional
const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };

// Junta as linhas de uma mensagem (várias por pessoa: uma por aparelho) em "quem -> primeira leitura". Cópias para mim mesmo não contam.
export function juntarLeituras(linhas, eu) {
  const quem = new Map();
  for (const l of linhas || []) {
    const id = l?.recipient_id; if (typeof id !== "string" || id === eu) continue;
    const t = l.read_at ? l.read_at : null, ant = quem.get(id);
    if (!quem.has(id)) quem.set(id, t);
    else if (t && (!ant || ms(t) < ms(ant))) quem.set(id, t); // vale a primeira leitura de qualquer aparelho da pessoa
  }
  return quem;
}
// Soma leituras novas a um mapa que já existe (uma leitura só entra se for mais cedo ou se a pessoa ainda estava sem leitura)
export function somarLeitura(quem, id, lidaEm) {
  if (!(quem instanceof Map) || typeof id !== "string") return false;
  if (!quem.has(id)) { quem.set(id, lidaEm || null); return true; }
  const ant = quem.get(id); if (lidaEm && (!ant || ms(lidaEm) < ms(ant))) { quem.set(id, lidaEm); return true; }
  return false;
}
export function resumoVistos(quem) {
  const vistos = [], faltam = [];
  for (const [id, t] of quem || []) (t ? vistos : faltam).push(t ? { id, t } : id);
  vistos.sort((a, b) => ms(a.t) - ms(b.t) || (a.id < b.id ? -1 : 1));
  const n = vistos.length + faltam.length;
  return { n, k: vistos.length, todos: n > 0 && !faltam.length, vistos, faltam };
}
// As partes do anel: uma por pessoa (até MAX_ARCOS). Em grupo maior, proporcional; nunca mostra "cheio" sem todos terem visto.
export function segmentos(k, n, max = MAX_ARCOS) {
  if (!(n > 0)) return [];
  k = Math.max(0, Math.min(n, Math.trunc(k) || 0));
  const m = Math.min(n, max); let cheios = n <= max ? k : Math.round((k / n) * m);
  if (k > 0 && cheios === 0) cheios = 1;          // alguém viu: aparece ao menos uma parte
  if (k < n && cheios >= m) cheios = m - 1;       // faltam pessoas: nunca fecha o anel
  return Array.from({ length: m }, (_, i) => i < cheios);
}
export const textoVistos = (k, n) => (n > 0 && k >= n ? "todos" : `${k}/${n}`);
export const textoLongoVistos = (k, n) => (n <= 0 ? "" : k >= n ? (n === 1 ? "A pessoa viu" : "Todos viram") : k === 0 ? "Ninguém viu ainda" : `${k} de ${n} viram`);
