// Estatísticas do grupo. Funções puras (testadas em Node): contam o que este aparelho tem guardado das mensagens do grupo.
// O servidor não vê o conteúdo, então tipo de mensagem, respostas e citações são contados aqui; só o tempo de tela vem do servidor.
import { mencionados } from "./grupo.js?v=59e9a6f74b";

export const TIPOS = ["texto", "foto", "video", "audio", "figurinha"];
const por = (n, um, varios) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

// Que tipo de mensagem é (null = não conta: apagada, aviso, reação...)
export function tipoDe(c) {
  if (!c || typeof c !== "object") return null;
  if (c.type === "text") return "texto";
  if (c.type === "media") return { image: "foto", video: "video", audio: "audio", sticker: "figurinha" }[c.kind] || null;
  return null;
}
const pad = (n) => String(n).padStart(2, "0");
// O dia é sempre o de Brasília, o mesmo do servidor (que corta o tempo de tela e as provas por esse dia). Quem está em outro fuso vê o corte de Brasília.
const FORMATO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export const diaLocal = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? FORMATO.format(d) : null; };
const somaDias = (dia, n) => { const [y, m, d] = dia.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// Primeiro dia (inclusive) de cada período
export const PERIODOS = { hoje: 1, semana: 7, mes: 30 };
export const primeiroDia = (periodo, agora = new Date()) => somaDias(diaLocal(agora), 1 - (PERIODOS[periodo] || 1));

const CHAVES = ["texto", "foto", "video", "audio", "figurinha", "respostas", "citou"]; // o que cada pessoa publica sobre o que ELA enviou (o resto, como "citada", é só local)
const diaVazio = () => ({ texto: 0, foto: 0, video: 0, audio: 0, figurinha: 0, respostas: 0, citou: 0, citada: 0 });
// Conta por pessoa e por dia a partir do histórico deste aparelho. entradas: [{ content, at, from }]; membros: [{ id, username }]
export function porDia(entradas, membros) {
  const r = new Map(membros.map((p) => [p.id, new Map()]));
  for (const e of entradas || []) {
    const t = tipoDe(e?.content), m = r.get(e?.from); if (!t || !m) continue;
    const dia = diaLocal(e.at); if (!dia) continue;
    const d = m.get(dia) || m.set(dia, diaVazio()).get(dia); d[t]++;
    if (e.content.re) d.respostas++;
    if (t === "texto") for (const id of mencionados(String(e.content.text ?? ""), membros.filter((p) => p.id !== e.from))) {
      d.citou++; const o = r.get(id); if (o) { const od = o.get(dia) || o.set(dia, diaVazio()).get(dia); od.citada++; }
    }
  }
  return r;
}
// Só o que a própria pessoa enviou, nos últimos dias, para publicar no servidor: [{ dia, texto, foto, ... }]
export function publicavel(mapaDaPessoa, desde) {
  const out = [];
  for (const [dia, d] of mapaDaPessoa || []) if (dia >= desde) { const o = { dia }; for (const k of CHAVES) o[k] = d[k]; if (CHAVES.some((k) => o[k])) out.push(o); }
  return out.sort((a, b) => a.dia.localeCompare(b.dia));
}
// O servidor confere o que cada pessoa publica sobre si: o que ela diz ter enviado nunca passa do que o servidor viu. msgs = envios (lotes de linhas) naquele dia;
// arquivos = envios ao armazenamento naquele dia. Sem essas provas (resposta antiga ou ausente) o valor vale 0.
const inteiro = (v, max = 100000) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max ? v : 0);
export function limitar(env, msgs, arquivos) {
  const o = diaVazio(); if (!env || typeof env !== "object") return o;
  for (const k of CHAVES) o[k] = inteiro(env[k]);
  const m = inteiro(msgs, 1e7), f = inteiro(arquivos, 1e7), escala = (ks, teto) => { const t = ks.reduce((n, k) => n + o[k], 0); if (t > teto) for (const k of ks) o[k] = Math.floor((o[k] * teto) / t); };
  escala(["foto", "video", "audio"], f); escala(TIPOS, m);
  o.respostas = Math.min(o.respostas, m); o.citou = Math.min(o.citou, m);
  return o;
}
// Cada aparelho só conhece o que recebeu (o que eu mando de um aparelho não chega ao outro) e o servidor tem o que cada pessoa publicou, já limitado pelas provas.
// As duas contas só podem estar incompletas, nunca grandes demais (a do servidor é limitada): vale o maior valor de cada dia e tipo.
// remoto: [{ user_id, dia, env, msgs, arquivos }] (desconfiável)
export function mesclar(local, remoto) {
  const r = new Map([...local].map(([id, m]) => [id, new Map([...m].map(([dia, d]) => [dia, { ...d }]))]));
  for (const l of remoto || []) {
    const m = r.get(l?.user_id); if (!m || typeof l.dia !== "string") continue;
    const lim = limitar(l.env, l.msgs, l.arquivos), d = m.get(l.dia) || m.set(l.dia, diaVazio()).get(l.dia);
    for (const k of CHAVES) d[k] = Math.max(d[k], lim[k]);
  }
  return r;
}
// Soma de um período (desde = primeiro dia, inclusive); "dias" = dias com mensagem desde sempre (para a sequência)
export function resumir(mapa, desde) {
  const r = new Map();
  for (const [id, m] of mapa) {
    const c = { total: 0, texto: 0, foto: 0, video: 0, audio: 0, figurinha: 0, respostas: 0, citou: 0, citada: 0, dias: new Set() };
    for (const [dia, d] of m) {
      if (TIPOS.some((k) => d[k])) c.dias.add(dia);
      if (desde && dia < desde) continue;
      for (const k of TIPOS) { c[k] += d[k]; c.total += d[k]; }
      c.respostas += d.respostas; c.citou += d.citou; c.citada += d.citada;
    }
    r.set(id, c);
  }
  return r;
}
export const contar = (entradas, membros, desde) => resumir(porDia(entradas, membros), desde);
const vazio = () => resumir(new Map([["x", new Map()]])).get("x");
// Dias seguidos com mensagem, terminando hoje (ou ontem: o dia de hoje ainda não acabou)
export function sequencia(dias, hoje) {
  let d = dias.has(hoje) ? hoje : somaDias(hoje, -1), n = 0;
  while (dias.has(d)) { n++; d = somaDias(d, -1); }
  return n;
}
export const textoSequencia = (n) => (n < 1 ? "" : por(n, "dia seguido", "dias seguidos"));

export function tempoTexto(seg) {
  const s = Math.max(0, Math.round(Number(seg) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${pad(m)}min` : m ? `${m}min` : s ? "menos de 1min" : "0min";
}
// Segundos de tela por pessoa dentro do período. linhas: [{ user_id, dia, segundos }] (dia "AAAA-MM-DD", dia de Brasília)
export function somarTela(linhas, desde) {
  const r = new Map();
  for (const l of linhas || []) if (typeof l?.dia === "string" && (!desde || l.dia >= desde)) r.set(l.user_id, (r.get(l.user_id) || 0) + (Number(l.segundos) || 0));
  return r;
}
export function noGrupoHa(entrouEm, agora = new Date()) {
  const ini = diaLocal(entrouEm); if (!ini) return "";
  const hoje = diaLocal(agora), dias = Math.round((Date.parse(hoje + "T12:00:00Z") - Date.parse(ini + "T12:00:00Z")) / 864e5);
  if (dias <= 0) return "Entrou hoje";
  if (dias < 14) return "No grupo há " + por(dias, "dia", "dias");
  if (dias < 60) return "No grupo há " + por(Math.floor(dias / 7), "semana", "semanas");
  if (dias < 730) return "No grupo há " + por(Math.floor(dias / 30), "mês", "meses").replace("1 mês", "1 mês");
  return "No grupo há " + por(Math.floor(dias / 365), "ano", "anos");
}
// Quem mais falou primeiro; empate: mais tempo de tela, depois nome
export function ranking(membros, contagens, tela) {
  return membros.map((p) => ({ p, c: contagens.get(p.id) || vazio(), seg: tela.get(p.id) || 0 }))
    .sort((a, b) => b.c.total - a.c.total || b.seg - a.seg || a.p.username.localeCompare(b.p.username));
}
export const totalDe = (contagens) => [...contagens.values()].reduce((n, c) => n + c.total, 0);
