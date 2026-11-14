// Loja de Selos: funções puras (testadas em Node). O servidor valida tudo de novo (selo_comprar); aqui só se monta a tela e se confere o que vem dele, que é desconfiável.
// Vantagens: título ao lado do nome (compra única, da lista fixa), mensagem em destaque (por mensagem) e silenciar um membro (5 minutos, vale contra qualquer um).
export const ITENS = ["titulo", "destaque", "silenciar"];
export const INFO = {
  titulo: { nome: "Título ao lado do nome", desc: "Escolha um título que aparece junto do seu nome nas mensagens deste grupo. Para trocar, compra de novo.", botao: "Comprar" },
  destaque: { nome: "Mensagem em destaque", desc: "Uma mensagem sua ganha borda e selo dourados que todos veem. Vale por mensagem: segure uma mensagem sua e toque em “Destacar”.", botao: "Como usar" },
  silenciar: { nome: "Silenciar um membro", desc: "A pessoa fica 5 minutos sem poder escrever no grupo (ela continua lendo). Vale contra qualquer membro.", botao: "Comprar" },
};
// Os títulos ficam num catálogo do app: o servidor guarda só qual foi escolhido (t01 a t12), nunca um texto.
export const TITULOS_LOJA = [["t01", "Lenda"], ["t02", "Chefe"], ["t03", "Mestre"], ["t04", "Craque"], ["t05", "Mito"], ["t06", "Gênio"], ["t07", "Fera"], ["t08", "Veterano"], ["t09", "Fiel"], ["t10", "Sábio"], ["t11", "Raiz"], ["t12", "Estrela"]];
const TEXTO = new Map(TITULOS_LOJA);
export const tituloTexto = (id) => TEXTO.get(id) || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, MID = /^[0-9a-f]{32}$/;
const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };

// Linhas de selo_loja_estado -> só as que têm a forma certa
export function limpaCompras(linhas) {
  const out = [];
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l !== "object" || !Number.isSafeInteger(l.id) || l.id < 1 || !ITENS.includes(l.item) || typeof l.user_id !== "string" || !UUID.test(l.user_id)) continue;
    const t = ms(l.criado_em); if (t === null) continue;
    const alvo = typeof l.alvo === "string" && UUID.test(l.alvo) ? l.alvo.toLowerCase() : null;
    if (l.item === "titulo" && !TEXTO.has(l.detalhe)) continue;
    if (l.item === "destaque" && !(typeof l.detalhe === "string" && MID.test(l.detalhe))) continue;
    if (l.item === "silenciar" && !alvo) continue;
    out.push({ id: l.id, user: l.user_id.toLowerCase(), item: l.item, alvo, detalhe: l.item === "silenciar" ? null : l.detalhe, t, agora: ms(l.agora), silencio_s: Number.isFinite(l.silencio_s) ? Math.max(1, Math.min(86400, Math.trunc(l.silencio_s))) : 300 });
  }
  return out.sort((a, b) => a.id - b.id);
}
// O que a loja já mudou no grupo: título atual de cada pessoa, mensagens em destaque (mid -> quem comprou) e silêncios. `recebidoEm` = hora do aparelho
// quando a resposta chegou: serve para corrigir a diferença entre o relógio do aparelho e o do servidor (o silêncio acaba na hora do servidor).
export function estadoDaLoja(linhas, recebidoEm = Date.now()) {
  const compras = limpaCompras(linhas), titulos = new Map(), destaques = new Map(), silencios = new Map();
  const agoraServ = compras.find((c) => c.agora !== null)?.agora ?? null, desvio = agoraServ === null ? 0 : agoraServ - recebidoEm;
  for (const c of compras) {
    if (c.item === "titulo") titulos.set(c.user, c.detalhe);
    else if (c.item === "destaque") destaques.set(c.detalhe, { por: c.user, id: c.id });
    else { const ate = c.t + c.silencio_s * 1000 - desvio; const ant = silencios.get(c.alvo); if (!ant || c.id > ant.id) silencios.set(c.alvo, { ate, por: c.user, id: c.id }); }
  }
  return { compras, titulos, destaques, silencios, ultimo: compras.length ? compras.at(-1).id : 0 };
}
export function silenciadoAte(estado, id, agora = Date.now()) { const s = estado?.silencios?.get(id); return s && s.ate > agora ? s : null; }
// Mensagem em destaque só vale se quem a mandou foi quem pagou (senão alguém poderia "destacar" a mensagem de outra pessoa)
export const emDestaque = (estado, mid, remetente) => { const d = typeof mid === "string" ? estado?.destaques?.get(mid) : null; return !!d && d.por === remetente; };
// Avisos para o chat: uma linha por compra que este aparelho ainda não viu
export function avisosNovos(estado, visto) {
  return (estado?.compras || []).filter((c) => c.id > visto).map((c) => (c.item === "titulo" ? { tipo: "loja_titulo", id: c.user, titulo: tituloTexto(c.detalhe), t: c.t, compra: c.id } : c.item === "destaque" ? { tipo: "loja_destaque", id: c.user, t: c.t, compra: c.id } : { tipo: "loja_silencio", id: c.user, alvo: c.alvo, t: c.t, compra: c.id }));
}
export const erroLoja = (e) => {
  const m = String(e?.message || ""), c = e?.code;
  if (/saldo_insuficiente/.test(m)) return "Você não tem Selos suficientes para isso.";
  if (/item_desligado/.test(m)) return "O admin desligou esta vantagem.";
  if (/ja_silenciado/.test(m)) return "Essa pessoa já está silenciada. Espere acabar.";
  if (/ja_destacada/.test(m)) return "Essa mensagem já está em destaque.";
  if (/si_mesmo/.test(m)) return "Escolha outra pessoa.";
  if (/alvo_fora/.test(m)) return "Essa pessoa não está mais no grupo.";
  if (c === "PT429") return "Muitas compras seguidas. Espere um minuto.";
  if (c === "42501") return "Não foi possível comprar neste grupo agora.";
  return "Não foi possível comprar agora. Tente de novo.";
};
export const eSilenciado = (e) => /silenciado/.test(String(e?.message || "")) || /silenciado/.test(String(e?.hint || ""));
export const horaFim = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
