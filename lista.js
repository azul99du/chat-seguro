// Rótulos da lista de conversas. Funções puras: não dependem do navegador, então são testadas em Node.
const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const dois = (n) => String(n).padStart(2, "0");
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
// Hoje: a hora (14:05). Nos 6 dias anteriores: o dia da semana (o nome nunca é ambíguo). Antes disso: a data completa (03/11/2026).
export function rotuloHora(t, agora = new Date()) {
  const d = new Date(t); if (!Number.isFinite(d.getTime())) return "";
  const dias = Math.round((inicioDia(agora) - inicioDia(d)) / 864e5); // (relógio do aparelho um pouco adiantado do servidor: "amanhã" vale como hoje)
  if (dias <= 0) return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  if (dias < 7) return SEMANA[d.getDay()];
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export const dataCompleta = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }) : ""; };
export const rotuloNovas = (n) => (n > 99 ? "99+" : String(n));
export const textoNovas = (n) => (n === 1 ? "1 mensagem nova" : `${n} mensagens novas`);
// Quantos participantes do grupo (sem contar a própria pessoa) estão online agora
export const contaOnline = (ids, eu, online) => ids.filter((id) => id !== eu && online.has(id)).length;
