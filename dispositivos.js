// Aparelhos que RECEBEM mensagens da conta (etapa 1 de "vários aparelhos"): funções puras, testáveis sem navegador.
// O servidor é desconfiável: tudo que vem dele passa por "limpa" antes de ir para a tela.
export const MAX_APARELHOS = 5;
export const ID_RE = /^[0-9a-f]{32}$/;

export const idValido = (s) => typeof s === "string" && ID_RE.test(s);
// 16 bytes aleatórios em hexadecimal (32 caracteres). "bytes" só existe para os testes poderem fixar o sorteio.
export function novoId(bytes = crypto.getRandomValues(new Uint8Array(16))) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }

const REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const txt = (v, n = 60) => (typeof v === "string" ? v.slice(0, n) : "");
// Linha vinda do servidor -> linha segura; descarta o que não tem o formato esperado.
export function limpa(l) {
  if (!l || typeof l !== "object" || typeof l.ref !== "string" || !REF_RE.test(l.ref) || !["pendente", "aprovado"].includes(l.estado)) return null;
  return { ref: l.ref, estado: l.estado, atual: l.atual === true, criado_em: txt(l.criado_em, 40), visto_em: txt(l.visto_em, 40), aprovado_em: txt(l.aprovado_em, 40) || null,
    navegador: txt(l.navegador), sistema: txt(l.sistema), tipo: ["celular", "tablet", "computador", "outro"].includes(l.tipo) ? l.tipo : "outro", pais_codigo: /^[A-Z]{2}$/.test(l.pais_codigo || "") ? l.pais_codigo : null, regiao: txt(l.regiao, 80) || null, cidade: txt(l.cidade, 80) || null };
}
export const limpaLista = (lista) => (Array.isArray(lista) ? lista : []).map(limpa).filter(Boolean).slice(0, MAX_APARELHOS + 5);

// Resumo do que a tela precisa: qual é este aparelho, se ele pode decidir e quem está esperando.
export function resumo(lista) {
  const l = limpaLista(lista), eu = l.find((x) => x.atual) || null, pendentes = l.filter((x) => x.estado === "pendente" && !x.atual);
  return { lista: l, eu, souAprovado: eu?.estado === "aprovado", souPendente: eu?.estado === "pendente", pendentes, cheio: l.length >= MAX_APARELHOS };
}
export const nomeDoAparelho = (a) => (a.navegador && a.sistema ? `${a.navegador} no ${a.sistema}` : "Aparelho sem nome");
export function textoPendentes(n) { return n <= 0 ? "" : n === 1 ? "Um aparelho novo pede permissão para entrar na sua conta." : `${n} aparelhos novos pedem permissão para entrar na sua conta.`; }
export const AVISO_PENDENTE = "Este aparelho aguarda a permissão de outro aparelho já conectado à sua conta. Abra o Lacre em um aparelho conectado e toque em Permitir.";
// Mensagem amigável para o erro do banco.
export function erroAmigavel(e) {
  const m = String(e?.message || e || "");
  if (/limite_de_aparelhos/.test(m)) return `A conta já tem ${MAX_APARELHOS} aparelhos. Remova um para conectar outro.`;
  if (/rate|limite de uso|espere/i.test(m)) return "Muitos pedidos. Espere um pouco e tente de novo.";
  return "Não foi possível agora. Tente de novo.";
}
