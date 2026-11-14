// Aparelhos que RECEBEM mensagens da conta (etapa 1 de "vários aparelhos"): funções puras, testáveis sem navegador.
// O servidor é desconfiável: tudo que vem dele passa por "limpa" antes de ir para a tela.
import { juntarLeituras, juntarRecibo } from "./visto.js?v=ccbfb4296a";
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
    if (a) { a.id = Math.min(a.id, l.id); a.ids.push(l.id); a.n++; a.avisar = a.avisar && l.avisar !== false; a.novo = a.novo || !!l.para_aparelho; Object.assign(a, juntarRecibo(a, l)); } // (read_at, ouvido_ate, ouvido_tudo, ouvido_em: o que cada aparelho de quem recebeu já registrou)
    else m.set(k, { id: l.id, ids: [l.id], created_at: l.created_at, avisar: l.avisar !== false, n: 1, novo: !!l.para_aparelho, ...juntarRecibo(null, l) });
  }
  const out = [...m.values()].sort((a, b) => a.id - b.id);
  if (cortado && out.length) out.shift();
  return out;
}

// ---------- Etapa 3: grupos com uma cópia por aparelho ----------
// Cópia de uma mensagem de GRUPO que outro aparelho meu mandou para este: de mim para mim, com o grupo na linha e no conteúdo cifrado (os dois têm de bater), e sem "para".
export function copiaGrupoValida(m, content, eu, meuRef) {
  return !!m && m.sender_id === eu && m.recipient_id === eu && typeof m.grupo_id === "string" && UUID_RE.test(m.grupo_id) && ehRef(m.de_aparelho) && m.de_aparelho !== meuRef && ehRef(m.para_aparelho)
    && !!content && content.g === m.grupo_id && content.para === undefined;
}
// As minhas linhas num grupo (uma por aparelho de cada pessoa, mais as cópias para os meus aparelhos) viram uma mensagem só. "de" = aparelho que enviou;
// "novo" = formato por aparelho. Uma mensagem nova enviada por OUTRO aparelho meu não se mostra por aqui: quem a mostra é a cópia que ele mandou para este aparelho.
// Com `eu` (o id de quem enviou), cada mensagem leva também `quem`: para quem foi e quando leu (ver visto.js); sem `eu`, fica como antes.
export function lotesGrupo(linhas, cortado = false, eu = null) {
  const m = new Map();
  for (const l of linhas || []) {
    const k = l.created_at, a = m.get(k);
    if (a) { a.id = Math.min(a.id, l.id); a.n++; a.avisar = a.avisar && l.avisar !== false; a.novo = a.novo || !!l.para_aparelho; a.de = a.de || (ehRef(l.de_aparelho) ? l.de_aparelho : null); if (eu) a.linhas.push(l); }
    else m.set(k, { id: l.id, created_at: l.created_at, avisar: l.avisar !== false, n: 1, novo: !!l.para_aparelho, de: ehRef(l.de_aparelho) ? l.de_aparelho : null, linhas: eu ? [l] : null });
  }
  const out = [...m.values()].sort((a, b) => a.id - b.id);
  for (const x of out) { if (eu) x.quem = juntarLeituras(x.linhas, eu); delete x.linhas; }
  if (cortado && out.length) out.shift();
  return out;
}
export const loteDeOutroAparelho = (l, meuRef) => !!l && l.novo && !!l.de && l.de !== meuRef;
// Linhas de um envio a várias pessoas: por aparelho para quem já usa aparelhos, uma cópia só (formato antigo) para quem não usa; e as cópias para os meus outros aparelhos.
// pessoas: [{ id, aparelhos: [{ ref, id, public_key }] }]; devolve [{ pessoaId, a (aparelho ou null), copia }]
export function trabalhosDeEnvio({ pessoas, meus, meuRef, copias }) {
  const usaAparelhos = ehRef(meuRef), out = [];
  for (const p of pessoas || []) {
    const ap = usaAparelhos ? limpaPrekeys(p.aparelhos) : [];
    if (ap.length) for (const a of ap) out.push({ pessoaId: p.id, a, copia: false });
    else out.push({ pessoaId: p.id, a: null, copia: false });
  }
  if (usaAparelhos && copias) for (const a of limpaPrekeys(meus)) if (a.ref !== meuRef) out.push({ pessoaId: null, a, copia: true });
  return out;
}
export const MAX_LINHAS_POR_PEDIDO = 100; // (o mesmo limite do banco: grupo de 20 pessoas com 5 aparelhos cada = 19 × 5 + 4 cópias minhas = 99)
export function emLevas(lista, n = MAX_LINHAS_POR_PEDIDO) { const out = []; for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n)); return out; }


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
