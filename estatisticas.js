// Estatísticas do grupo. Funções puras (testadas em Node): contam o que este aparelho tem guardado das mensagens do grupo.
// O servidor não vê o conteúdo, então tipo de mensagem, respostas e citações são contados aqui; só o tempo de tela vem do servidor.
import { mencionados } from "./grupo.js?v=49dcb55301";

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
export const diaLocal = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null; };
const somaDias = (dia, n) => { const [y, m, d] = dia.split("-").map(Number); return diaLocal(new Date(y, m - 1, d + n)); };

// Primeiro dia (inclusive) de cada período
export const PERIODOS = { hoje: 1, semana: 7, mes: 30 };
export const primeiroDia = (periodo, agora = new Date()) => somaDias(diaLocal(agora), 1 - (PERIODOS[periodo] || 1));

const vazio = () => ({ total: 0, texto: 0, foto: 0, video: 0, audio: 0, figurinha: 0, respostas: 0, citou: 0, citada: 0, dias: new Set() });
// entradas: [{ content, at, from }] (as minhas têm from = meu id). membros: [{ id, username }]. Conta só de "desde" (dia local, inclusive) em diante;
// os dias de atividade (para a sequência) contam desde sempre.
export function contar(entradas, membros, desde) {
  const r = new Map(membros.map((p) => [p.id, vazio()]));
  for (const e of entradas || []) {
    const t = tipoDe(e?.content), c = r.get(e?.from); if (!t || !c) continue;
    const dia = diaLocal(e.at); if (!dia) continue;
    c.dias.add(dia); if (desde && dia < desde) continue;
    c.total++; c[t]++;
    if (e.content.re) c.respostas++;
    if (t === "texto") for (const id of mencionados(String(e.content.text ?? ""), membros.filter((p) => p.id !== e.from))) { c.citou++; const o = r.get(id); if (o) o.citada++; }
  }
  return r;
}
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
