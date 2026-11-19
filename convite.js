// Convites de grupo: regras puras (testadas em Node). O app cuida do banco, do QR e das telas.
// O LINK carrega um segredo (que o servidor só conhece em forma de hash) e a chave do grupo, que abre só o NOME do grupo: vai depois do "#", parte que o navegador nunca envia a ninguém.
// Quem abre o link só PEDE para entrar; um admin aceita e entrega a chave de verdade (cifrada para a pessoa), como em qualquer entrada no grupo.
export const MAX_LINKS = 10; // links ligados por grupo (o banco confere de novo)
export const TAM_SEGREDO = 22; // 16 bytes em base64url
export const TAM_CHAVE = 43; // 32 bytes em base64url
export const VALIDADES = [{ id: "24h", horas: 24, rotulo: "24 horas" }, { id: "7d", horas: 168, rotulo: "7 dias" }, { id: "30d", horas: 720, rotulo: "30 dias" }, { id: "sem", horas: null, rotulo: "Sem fim" }];
export const LIMITES = [{ id: "1", max: 1, rotulo: "1 pessoa" }, { id: "10", max: 10, rotulo: "10 pessoas" }, { id: "sem", max: null, rotulo: "Sem limite" }];
export const VALIDADE_PADRAO = "7d", LIMITE_PADRAO = "10";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- base64 e base64url ----
const b64u = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); };
export const segredoNovo = (rand = (n) => crypto.getRandomValues(new Uint8Array(n))) => b64u(rand(16));
export async function hashSegredo(segredo) { // o que o servidor guarda (64 letras hex)
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lacre-convite|" + segredo)));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// a chave do grupo (base64 comum, 32 bytes) <-> o jeito de pôr num endereço (base64url sem "=")
export const chaveParaLink = (gk) => String(gk).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export const chaveDoLink = (s) => { const t = String(s).replaceAll("-", "+").replaceAll("_", "/"); return t + "=".repeat((4 - (t.length % 4)) % 4); };

// ---- o link ----
export const montarLink = (base, segredo, gk) => `${base}#convite=${segredo}.${chaveParaLink(gk)}`;
// Aceita o endereço inteiro, só a parte "#convite=..." ou o texto colado; devolve null se não for um convite bem formado
export function lerLink(texto) {
  const m = /convite=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(String(texto ?? "")); if (!m) return null;
  if (m[1].length !== TAM_SEGREDO || m[2].length !== TAM_CHAVE) return null;
  return { segredo: m[1], gk: chaveDoLink(m[2]) };
}

// ---- opções de criação ----
export const validadeDe = (id) => VALIDADES.find((v) => v.id === id) || VALIDADES.find((v) => v.id === VALIDADE_PADRAO);
export const limiteDe = (id) => LIMITES.find((l) => l.id === id) || LIMITES.find((l) => l.id === LIMITE_PADRAO);
export const NOME_PADRAO = "Link de convite";
export const limpaApelido = (t) => String(t ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || NOME_PADRAO;

// ---- o que vem do servidor (desconfiável) ----
export function limpaLinks(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.id !== "string" || !UUID.test(r.id) || !r.nome || typeof r.nome !== "object") continue;
    out.push({ id: r.id, nome: r.nome, criadoEm: Date.parse(r.criado_em) || 0, expiraEm: r.expira_em ? Date.parse(r.expira_em) || null : null, max: Number.isSafeInteger(r.max_usos) ? r.max_usos : null,
      usos: Number.isSafeInteger(r.usos) ? Math.max(0, r.usos) : 0, aprovar: r.aprovar !== false, vale: !!r.vale });
  }
  return out;
}
export function limpaPedidos(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.grupo_id !== "string" || !UUID.test(r.grupo_id) || typeof r.user_id !== "string" || !UUID.test(r.user_id) || typeof r.username !== "string" || !r.public_key || typeof r.public_key !== "object") continue;
    out.push({ grupo: r.grupo_id, user: r.user_id, username: r.username.slice(0, 40), public_key: r.public_key, avatar: typeof r.avatar === "string" ? r.avatar : null, convite: typeof r.convite_id === "string" ? r.convite_id : null, aprovar: r.aprovar !== false, vale: !!r.vale, em: Date.parse(r.criado_em) || 0 });
  }
  return out;
}
export const pedidosPorGrupo = (pedidos) => { const m = new Map(); for (const p of pedidos) { if (!m.has(p.grupo)) m.set(p.grupo, []); m.get(p.grupo).push(p); } return m; };
// Quais pedidos um aparelho de admin aceita sozinho: link que dispensa aprovação, ainda valendo
export const autoAceitar = (pedidos) => pedidos.filter((p) => p.aprovar === false && p.vale);

// ---- textos ----
export function rotuloLink(l, agora = Date.now()) {
  const partes = [];
  if (!l.vale) partes.push(l.max !== null && l.usos >= l.max ? "já usado" : l.expiraEm !== null && l.expiraEm <= agora ? "vencido" : "parado");
  else if (l.expiraEm === null) partes.push("sem fim");
  else { const h = Math.max(1, Math.round((l.expiraEm - agora) / 3600000)); partes.push(h >= 48 ? `vale ${Math.round(h / 24)} dias` : `vale ${h} h`); }
  partes.push(l.max === null ? "sem limite de pessoas" : `até ${l.max} ${l.max === 1 ? "pessoa" : "pessoas"}`);
  if (l.usos > 0) partes.push(`${l.usos} ${l.usos === 1 ? "entrou" : "entraram"}`);
  return partes.join(" · ");
}
export const textoPedido = (nome) => `@${nome} pediu para entrar pelo link`;
export function erroConvite(e) {
  const c = e?.code, m = String(e?.message ?? "");
  if (/convite_invalido/.test(m) || c === "P0001") return "Esse link não vale mais (foi desligado, venceu, lotou) ou não existe.";
  if (/grupo_cheio/.test(m)) return "O grupo está cheio.";
  if (/grupos_demais_dela|grupos_demais/.test(m)) return "Essa pessoa já está no máximo de grupos.";
  if (/convites_demais/.test(m)) return `Já existem ${MAX_LINKS} links ligados neste grupo. Desligue algum para criar outro.`;
  if (/pedidos_demais/.test(m)) return "Há pedidos demais esperando neste grupo agora. Tente de novo mais tarde.";
  if (/so_admin/.test(m)) return "Só quem administra o grupo pode fazer isso.";
  if (c === "PT429" || e?.status === 429 || /rate limit|too many|limite de/i.test(m)) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  return "Não foi possível agora. Verifique a conexão e tente de novo.";
}
