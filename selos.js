// Selos: a moeda de cada grupo. Funções puras (testadas em Node): regras, frases, limites e prévia.
// As regras valem no servidor (função selo_regras_mudar valida tudo de novo); aqui só se monta a tela e se confere o que vem do servidor, que é desconfiável.
export const MAX_SELOS = 999, MAX_DIAS = 365, MAX_MARCOS = 10;
export const ACOES = ["entrada", "dia_ativo", "mensagens", "arquivos", "sequencia"];
export const TITULOS = {
  entrada: ["Entrar no grupo", "Uma vez por pessoa"], dia_ativo: ["Dia ativo", "Por aparecer no dia"], mensagens: ["Mensagens enviadas", "Por conversar"],
  arquivos: ["Arquivos enviados", "Fotos, vídeos e áudios"], sequencia: ["Sequência de dias", "Bônus uma vez por marco"],
  loja_titulo: ["Título ao lado do nome", "Compra única: a pessoa escolhe um título"], loja_destaque: ["Mensagem em destaque", "Paga a cada mensagem destacada"],
  loja_silenciar: ["Silenciar um membro", "5 minutos sem poder escrever no grupo"],
};
// Preços da loja: ficam junto das regras. Começam desligados; o admin liga e põe o preço (1 a 999).
export const LOJA = ["loja_titulo", "loja_destaque", "loja_silenciar"];
const PRECO_PADRAO = { loja_titulo: 50, loja_destaque: 30, loja_silenciar: 80 };
const FAIXAS = { valor: [1, MAX_SELOS], min: [1, 999], a_cada: [1, 999], dias: [1, MAX_DIAS] };
export const faixa = (campo) => FAIXAS[campo] || [1, MAX_SELOS];
const inteiro = (v, campo, padrao) => (Number.isInteger(v) && v >= faixa(campo)[0] && v <= faixa(campo)[1] ? v : padrao);
const pl = (n, um, varios) => (n === 1 ? um : varios);

// Tudo desligado: cada grupo começa sem nenhuma regra e o admin liga o que quiser
export const regrasVazias = () => ({
  entrada: { on: false, valor: 1 }, dia_ativo: { on: false, valor: 1, min: 1 }, mensagens: { on: false, valor: 1, a_cada: 1 },
  arquivos: { on: false, valor: 1, a_cada: 1 }, sequencia: { on: false, marcos: [] }, teto: { on: false, valor: 1 },
  loja_titulo: { on: false, valor: PRECO_PADRAO.loja_titulo }, loja_destaque: { on: false, valor: PRECO_PADRAO.loja_destaque }, loja_silenciar: { on: false, valor: PRECO_PADRAO.loja_silenciar },
});
// O que vem do servidor (ou de uma versão antiga) é desconfiável: só chaves conhecidas, números inteiros nos limites
export function limpaRegras(r) {
  const v = regrasVazias(); if (!r || typeof r !== "object") return v;
  for (const k of ["entrada", "dia_ativo", "mensagens", "arquivos", "teto", ...LOJA]) {
    const o = r[k]; if (!o || typeof o !== "object") continue;
    v[k].on = o.on === true; v[k].valor = inteiro(o.valor, "valor", LOJA.includes(k) ? PRECO_PADRAO[k] : 1);
    if (k === "dia_ativo") v[k].min = inteiro(o.min, "min", 1);
    if (k === "mensagens" || k === "arquivos") v[k].a_cada = inteiro(o.a_cada, "a_cada", 1);
  }
  const s = r.sequencia;
  if (s && typeof s === "object") {
    v.sequencia.on = s.on === true; const vistos = new Set();
    for (const m of Array.isArray(s.marcos) ? s.marcos : []) {
      if (!m || typeof m !== "object" || !Number.isInteger(m.dias) || m.dias < 1 || m.dias > MAX_DIAS || vistos.has(m.dias) || v.sequencia.marcos.length >= MAX_MARCOS) continue;
      vistos.add(m.dias); v.sequencia.marcos.push({ dias: m.dias, valor: inteiro(m.valor, "valor", 1) });
    }
    v.sequencia.marcos.sort((a, b) => a.dias - b.dias);
  }
  return v;
}
export const igualRegras = (a, b) => JSON.stringify(limpaRegras(a)) === JSON.stringify(limpaRegras(b));
export const lojaLigada = (r, item) => limpaRegras(r)["loja_" + item]?.on === true;
export const precoDaLoja = (r, item) => (lojaLigada(r, item) ? limpaRegras(r)["loja_" + item].valor : null);
export const algumaLigada = (r) => { const x = limpaRegras(r); return ACOES.some((k) => x[k].on); };

// Um marco novo com um número de dias que ainda não existe (null se já há 10 ou nenhum sobrou)
export function marcoNovo(marcos) {
  if ((marcos || []).length >= MAX_MARCOS) return null;
  const usados = new Set((marcos || []).map((m) => m.dias)), dias = [3, 7, 14, 30, 60, 90, 180, 365].find((d) => !usados.has(d));
  return dias ? { dias, valor: 1 } : null;
}
// Número digitado → dentro dos limites do campo (null se não há número)
export function ajustaCampo(campo, texto) {
  const t = String(texto ?? "").replace(/\D/g, "").slice(0, 4); if (!t) return null;
  const [min, max] = faixa(campo); return Math.min(max, Math.max(min, Number(t)));
}

// A frase de uma regra: lista de pedaços, texto puro ou { n, campo, tipo, marco? } (um número que dá para tocar). tipo "s" = valor em Selos, "q" = quantidade a cumprir.
const S = (n, marco) => ({ n, campo: "valor", tipo: "s", ...(marco === undefined ? {} : { marco }) }), Q = (n, campo, marco) => ({ n, campo, tipo: "q", ...(marco === undefined ? {} : { marco }) });
export function frase(acao, r, marco) {
  const x = limpaRegras(r), a = x[acao];
  if (acao === "entrada") return ["Ganha ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")} ao entrar no grupo`];
  if (acao === "dia_ativo") return ["Ganha ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")} em cada dia com pelo menos `, Q(a.min, "min"), ` ${pl(a.min, "mensagem", "mensagens")}`];
  if (acao === "mensagens") return ["Ganha ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")} a cada `, Q(a.a_cada, "a_cada"), a.a_cada === 1 ? " mensagem enviada" : " mensagens enviadas"];
  if (acao === "arquivos") return ["Ganha ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")} a cada `, Q(a.a_cada, "a_cada"), a.a_cada === 1 ? " arquivo enviado" : " arquivos enviados"];
  if (LOJA.includes(acao)) return ["Custa ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")}`];
  if (acao === "teto") return ["No máximo ", S(a.valor), ` ${pl(a.valor, "Selo", "Selos")} por pessoa em cada dia`];
  if (acao === "sequencia") { const m = a.marcos[marco]; if (!m) return []; return ["Com ", Q(m.dias, "dias", marco), m.dias === 1 ? " dia seguido, ganha " : " dias seguidos, ganha ", S(m.valor, marco), ` ${pl(m.valor, "Selo", "Selos")}`]; }
  return [];
}
export const fraseTexto = (partes) => partes.map((p) => (typeof p === "string" ? p : String(p.n))).join("");
// Todas as frases das regras ligadas (para quem só lê)
export function frasesLigadas(r) {
  const x = limpaRegras(r), out = [];
  for (const k of ACOES) {
    if (!x[k].on) continue;
    if (k === "sequencia") x.sequencia.marcos.forEach((_, i) => out.push({ acao: k, texto: fraseTexto(frase(k, x, i)) }));
    else out.push({ acao: k, texto: fraseTexto(frase(k, x)) });
  }
  if (x.teto.on) out.push({ acao: "teto", texto: fraseTexto(frase("teto", x)) });
  return out;
}
// Quanto um dia comum rende (sem a entrada e a sequência, que são pontuais), com o teto se estiver ligado
export function previa(r, msgs = 20, arquivos = 0) {
  const x = limpaRegras(r); let resto = x.teto.on ? x.teto.valor : Infinity, total = 0; const itens = [];
  const soma = (acao, q) => { q = Math.min(q, resto); if (q > 0) { resto -= q; total += q; itens.push({ acao, qtd: q }); } };
  if (x.dia_ativo.on && msgs >= x.dia_ativo.min) soma("dia_ativo", x.dia_ativo.valor);
  if (x.mensagens.on) soma("mensagens", Math.floor(msgs / x.mensagens.a_cada) * x.mensagens.valor);
  if (x.arquivos.on) soma("arquivos", Math.floor(arquivos / x.arquivos.a_cada) * x.arquivos.valor);
  return { total, itens };
}
export const textoSelos = (n) => `${n} ${pl(n, "Selo", "Selos")}`;
// Saldo vindo do servidor (desconfiável). Os Selos valem na hora: o servidor soma no extrato conforme a pessoa ganha.
export const saldoLimpo = (l) => ({ id: l?.user_id, saldo: Math.max(0, Math.min(1e9, Number.isSafeInteger(Number(l?.confirmados)) ? Number(l.confirmados) : 0)) });
export const erroRegras = (e) => e?.code === "42501" ? "Só o admin do grupo pode mudar as regras dos Selos." : e?.code === "22023" ? "Algum valor está fora do limite (de 1 a 999)." : e?.code === "PT429" ? "Muitas mudanças seguidas. Espere um pouco." : "Não foi possível salvar agora. Tente de novo.";
