// Loja de Selos: funções puras (testadas em Node). O servidor valida tudo de novo (selo_comprar); aqui só se monta a tela e se confere o que vem dele, que é desconfiável.
// Vantagens: título ao lado do nome (compra única, da lista fixa), mensagem em destaque (por mensagem) e silenciar um membro (5 minutos, vale contra qualquer um).
export const ITENS = ["titulo", "destaque", "silenciar", "jumpscare"];
export const INFO = {
  titulo: { nome: "Título ao lado do nome", desc: "Escolha um título que aparece junto do seu nome nas mensagens deste grupo. Para trocar, compra de novo.", botao: "Comprar" },
  destaque: { nome: "Mensagem em destaque", desc: "Uma mensagem sua ganha borda e selo dourados que todos veem. Vale por mensagem: segure uma mensagem sua e toque em “Destacar”.", botao: "Como usar" },
  silenciar: { nome: "Silenciar um membro", desc: "A pessoa fica 5 minutos sem poder escrever no grupo (ela continua lendo). Vale contra qualquer membro.", botao: "Comprar" },
  jumpscare: { nome: "Jumpscare", desc: "Um susto sorteado da lista do admin aparece para os outros membros: na hora, para quem está com o app aberto, ou quando entrarem no grupo. Você não escolhe qual, e só descobrem que foi você depois do susto.", botao: "Comprar" },
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
    out.push({ id: l.id, user: l.user_id.toLowerCase(), item: l.item, alvo, detalhe: l.item === "silenciar" || l.item === "jumpscare" ? null : l.detalhe, t, agora: ms(l.agora), silencio_s: Number.isFinite(l.silencio_s) ? Math.max(1, Math.min(86400, Math.trunc(l.silencio_s))) : 300 });
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
// Avisos para o chat: uma linha por compra que este aparelho ainda não viu.
// Jumpscare: quem comprou vê o aviso na hora; os outros só DEPOIS do próprio susto (o app põe esse aviso quando o susto termina), então aqui ele não entra para eles.
export function avisosNovos(estado, visto, eu = null) {
  return (estado?.compras || []).filter((c) => c.id > visto && (c.item !== "jumpscare" || (eu !== null && c.user === eu))).map((c) => (c.item === "titulo" ? { tipo: "loja_titulo", id: c.user, titulo: tituloTexto(c.detalhe), t: c.t, compra: c.id } : c.item === "destaque" ? { tipo: "loja_destaque", id: c.user, t: c.t, compra: c.id } : c.item === "jumpscare" ? { tipo: "loja_jumpscare", id: c.user, t: c.t, compra: c.id } : { tipo: "loja_silencio", id: c.user, alvo: c.alvo, t: c.t, compra: c.id }));
}
// ----- Jumpscare: o que o servidor diz que falta para mim, e quando acontece -----
export const SUSTO_MIN_S = 3, SUSTO_MAX_S = 10, SUSTO_VIVO_S = 60, SUSTOS_MAX = 5, MAX_JUMPSCARES = 10;
// Atraso até o susto: sorteado entre 3 e 10 segundos (rand injetável para teste)
export const atrasoSusto = (rand = Math.random, min = SUSTO_MIN_S, max = SUSTO_MAX_S) => Math.round((min + rand() * (max - min)) * 1000);
// Linhas de jumpscare_pendentes -> só as de forma certa; "vivo" = a compra acabou de acontecer (pouca idade), senão o susto espera a pessoa entrar no grupo
export function limpaPendentes(linhas, vivoS = SUSTO_VIVO_S) {
  const out = [];
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l !== "object" || !Number.isSafeInteger(l.compra) || l.compra < 1 || !Number.isSafeInteger(l.jumpscare) || l.jumpscare < 1 || typeof l.user_id !== "string" || !UUID.test(l.user_id)) continue;
    const idade = Number.isFinite(l.idade_s) ? Math.max(0, l.idade_s) : 1e9;
    out.push({ compra: l.compra, de: l.user_id.toLowerCase(), jumpscare: l.jumpscare, vivo: idade <= vivoS });
  }
  return out.sort((a, b) => a.compra - b.compra).slice(-SUSTOS_MAX);
}
// O arquivo cifrado que veio do servidor (imagem ou som): caminho só da pasta DESTE grupo, iv curto e tipo de uma lista curta (kind: "image" ou "audio")
const TIPOS_SUSTO = ["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav"];
export function limpaArquivoSusto(a, grupoId, kind) {
  if (!a || typeof a !== "object" || typeof a.iv !== "string" || a.iv.length > 40 || typeof a.p !== "string" || !TIPOS_SUSTO.includes(a.t) || !a.t.startsWith(kind + "/")) return null;
  return new RegExp(`^[0-9a-f-]{36}/${String(grupoId).toLowerCase()}/[0-9a-f-]{36}$`).test(a.p) ? { p: a.p, iv: a.iv, t: a.t } : null;
}
export const erroLoja = (e) => {
  const m = String(e?.message || ""), c = e?.code;
  if (/saldo_insuficiente/.test(m)) return "Você não tem Selos suficientes para isso.";
  if (/item_desligado/.test(m)) return "O admin desligou esta vantagem.";
  if (/ja_silenciado/.test(m)) return "Essa pessoa já está silenciada. Espere acabar.";
  if (/ja_destacada/.test(m)) return "Essa mensagem já está em destaque.";
  if (/sem_jumpscares/.test(m)) return "O admin ainda não pôs jumpscares na lista do grupo.";
  if (/sem_alvos/.test(m)) return "Não há mais ninguém no grupo para levar o susto.";
  if (/lista_cheia/.test(m)) return "A lista já tem 10 jumpscares. Apague um para pôr outro.";
  if (/arquivo_invalido/.test(m)) return "Não foi possível guardar esse arquivo.";
  if (/si_mesmo/.test(m)) return "Escolha outra pessoa.";
  if (/alvo_fora/.test(m)) return "Essa pessoa não está mais no grupo.";
  if (c === "PT429") return "Muitas compras seguidas. Espere um minuto.";
  if (c === "42501") return "Não foi possível comprar neste grupo agora.";
  return "Não foi possível comprar agora. Tente de novo.";
};
export const eSilenciado = (e) => /silenciado/.test(String(e?.message || "")) || /silenciado/.test(String(e?.hint || ""));
export const horaFim = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
