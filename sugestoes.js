// Sugestões do que adicionar ao site: quadro público (só para quem tem conta), com data, nome opcional, curtidas e limite por dia.
// Funções puras (testadas em Node). O que vem do servidor só entra se tiver a forma certa.
export const MAX_SUGESTAO = 202; // média de 10 sugestões de exemplo, de simples a complexas (201,6 caracteres)
export const MAX_POR_DIA = 5, POR_PAGINA = 30, ORDENS = ["recentes", "curtidas"];
// Tira caracteres de controle e junta os espaços (o servidor faz o mesmo)
export const limpaSugestao = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
export const restantesHoje = (hoje, limite = MAX_POR_DIA) => Math.max(0, (Number.isFinite(limite) ? limite : MAX_POR_DIA) - (Number.isFinite(hoje) ? hoje : 0));
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
// "14 NOV 2026" no dia de Brasília (a mesma conta do limite diário no servidor)
export function dataCarimbo(iso) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "numeric", year: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${MESES[Number(p.month) - 1]} ${p.year}`;
}
export const corDaNota = (id) => Math.abs(Number(id) || 0) % 5;
const NOME_OK = /^[a-z0-9_]{3,20}$/;
// Linhas de sugestao_lista -> [{ id, texto, criado, autor (sem @, ou null = anônimo), curtidas, euCurti, minha }]
export function limpaSugestoes(rows) {
  const out = [], vistos = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object" || !Number.isSafeInteger(r.id) || vistos.has(r.id)) continue;
    const texto = limpaSugestao(r.texto).slice(0, MAX_SUGESTAO); if (!texto || !Number.isFinite(new Date(r.criado_em).getTime())) continue;
    vistos.add(r.id); out.push({ id: r.id, texto, criado: new Date(r.criado_em).toISOString(), autor: typeof r.autor === "string" && NOME_OK.test(r.autor) ? r.autor : null, curtidas: Number.isSafeInteger(r.curtidas) && r.curtidas > 0 ? r.curtidas : 0, euCurti: r.eu_curti === true, minha: r.minha === true });
  }
  return out;
}
export const erroSugestao = (e) => {
  const m = String(e?.message || ""), c = e?.code;
  if (/limite_diario/.test(m)) return `Você já mandou ${MAX_POR_DIA} sugestões hoje. Volte amanhã.`;
  if (/texto_invalido/.test(m)) return `Escreva a sugestão (até ${MAX_SUGESTAO} caracteres).`;
  if (/nao_existe/.test(m)) return "Essa sugestão não existe mais.";
  if (/aparelho_pendente/.test(m)) return "Aprove este aparelho antes de mandar sugestões.";
  if (c === "PT429" || /rate_limit|limite de uso/.test(m)) return "Muitas ações seguidas. Espere um pouco.";
  return "Não foi possível agora. Tente de novo.";
};
