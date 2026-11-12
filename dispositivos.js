// Aparelhos que RECEBEM mensagens da conta (etapa 1 de "vários aparelhos"): funções puras, testáveis sem navegador.
// O servidor é desconfiável: tudo que vem dele passa por "limpa" antes de ir para a tela.
export const MAX_APARELHOS = 5;
export const ID_RE = /^[0-9a-f]{32}$/;

export const idValido = (s) => typeof s === "string" && ID_RE.test(s);
// 16 bytes aleatórios em hexadecimal (32 caracteres). "bytes" só existe para os testes poderem fixar o sorteio.
export function novoId(bytes = crypto.getRandomValues(new Uint8Array(16))) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }

const REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ehRef = (s) => typeof s === "string" && REF_RE.test(s);
const txt = (v, n = 60) => (typeof v === "string" ? v.slice(0, n) : "");
// Linha vinda do servidor -> linha segura; descarta o que não tem o formato esperado.
export function limpa(l) {
  if (!l || typeof l !== "object" || typeof l.ref !== "string" || !REF_RE.test(l.ref) || !["pendente", "aprovado"].includes(l.estado)) return null;
  return { ref: l.ref, estado: l.estado, atual: l.atual === true, criado_em: txt(l.criado_em, 40), visto_em: txt(l.visto_em, 40), aprovado_em: txt(l.aprovado_em, 40) || null,
    navegador: txt(l.navegador), sistema: txt(l.sistema), tipo: ["celular", "tablet", "computador", "outro"].includes(l.tipo) ? l.tipo : "outro", pais_codigo: /^[A-Z]{2}$/.test(l.pais_codigo || "") ? l.pais_codigo : null, regiao: txt(l.regiao, 80) || null, cidade: txt(l.cidade, 80) || null,
    recuperacao_em: txt(l.recuperacao_em, 40) || null, vale_em: txt(l.vale_em, 40) || null, agora: txt(l.agora, 40) || null };
}
export const limpaLista = (lista) => (Array.isArray(lista) ? lista : []).map(limpa).filter(Boolean).slice(0, MAX_APARELHOS + 5);

// Resumo do que a tela precisa: qual é este aparelho, se ele pode decidir e quem está esperando.
export function resumo(lista) {
  const l = limpaLista(lista), eu = l.find((x) => x.atual) || null, pendentes = l.filter((x) => x.estado === "pendente" && !x.atual);
  const recuperacoes = pendentes.filter((x) => x.recuperacao_em && x.vale_em);
  return { lista: l, eu, souAprovado: eu?.estado === "aprovado", souPendente: eu?.estado === "pendente", pendentes, recuperacoes, cheio: l.length >= MAX_APARELHOS };
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

// ---------- Etapa 2: uma cópia cifrada por aparelho ----------
// A sessão de ratchet é uma por (pessoa, aparelho): o "peer" da sessão no armazenamento é "<id da pessoa>#<ref do aparelho>". Sem ref = formato antigo.
export const chaveSessao = (pessoaId, ref) => (ehRef(ref) ? `${pessoaId}#${ref}` : pessoaId);
// Chaves de recepção por aparelho vindas do servidor (desconfiável): só ref, id da chave e ponto da curva, sem repetir aparelho.
export function limpaPrekeys(rows) {
  const vistos = new Set(), out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r?.public_key;
    if (!ehRef(r?.ref) || vistos.has(r.ref) || typeof r.id !== "string" || !ID_RE.test(r.id) || typeof k?.x !== "string" || typeof k?.y !== "string" || k.x.length > 100 || k.y.length > 100) continue;
    vistos.add(r.ref); out.push({ ref: r.ref, id: r.id, public_key: { x: k.x, y: k.y } });
  }
  return out.slice(0, MAX_APARELHOS);
}
// Para onde vai uma mensagem a dois. amigo = aparelhos aprovados de quem recebe; proprios = meus OUTROS aparelhos aprovados.
// Sem aparelho registrado/aprovado aqui, ou o destinatário sem nenhum aparelho com chave: formato antigo (uma cópia só).
export function alvosDeEnvio({ deles, meus, meuRef }) {
  const amigo = limpaPrekeys(deles);
  if (!amigo.length || !ehRef(meuRef)) return { novo: false, amigo: [], proprios: [] };
  return { novo: true, amigo, proprios: limpaPrekeys(meus).filter((a) => a.ref !== meuRef) };
}
// Cópia para mim mesmo: só vale se a linha é de mim para mim, vinda de OUTRO aparelho meu, e o conteúdo diz de qual conversa é.
export function copiaPropriaValida(m, content, eu, meuRef) {
  return !!m && m.sender_id === eu && m.recipient_id === eu && !m.grupo_id && ehRef(m.de_aparelho) && m.de_aparelho !== meuRef && ehRef(m.para_aparelho)
    && !!content && typeof content.para === "string" && UUID_RE.test(content.para) && content.para !== eu && !content.g;
}
const UUID_RE = REF_RE;
// Minhas linhas numa conversa a dois viram uma mensagem só (uma linha por aparelho de quem recebeu, gravadas no mesmo instante).
// { id (o menor), ids, created_at, avisar, n, novo (formato por aparelho), read_at (a primeira leitura de algum aparelho) }
export function lotesDm(linhas, cortado = false) {
  const m = new Map();
  for (const l of linhas || []) {
    const k = l.created_at, a = m.get(k);
    if (a) { a.id = Math.min(a.id, l.id); a.ids.push(l.id); a.n++; a.avisar = a.avisar && l.avisar !== false; a.novo = a.novo || !!l.para_aparelho; if (l.read_at && (!a.read_at || l.read_at < a.read_at)) a.read_at = l.read_at; }
    else m.set(k, { id: l.id, ids: [l.id], created_at: l.created_at, avisar: l.avisar !== false, n: 1, novo: !!l.para_aparelho, read_at: l.read_at || null });
  }
  const out = [...m.values()].sort((a, b) => a.id - b.id);
  if (cortado && out.length) out.shift();
  return out;
}

// ---------- Recuperação ("não tenho mais acesso aos outros aparelhos") ----------
export const RECUPERACAO_HORAS = 24;
// milissegundos que faltam (relógio do banco: "agora" vem dele; sem ele, o do aparelho)
export function faltaMs(valeEm, agora, local = Date.now()) {
  const v = Date.parse(valeEm), a = Date.parse(agora);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, v - (Number.isFinite(a) ? a : local));
}
export function textoFalta(ms) {
  if (ms == null) return "";
  if (ms <= 0) return "agora";
  const min = Math.ceil(ms / 60000);
  if (min < 2) return "menos de 1 minuto";
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60), r = min % 60;
  return `${h} h${r ? ` ${r} min` : ""}`;
}
export const AVISO_RECUPERACAO = "Se o pedido não for recusado, este aparelho passa a valer e TODOS os outros aparelhos da conta são removidos e desconectados.";
