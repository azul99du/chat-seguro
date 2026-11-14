import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { limpaEfeitos, efeitoAtivoDe, mensagemRecente, atrasoSusto, limpaPendentes, limpaArquivoSusto, SUSTO_VIVO_S, SUSTOS_MAX, limpaCompras, estadoDaLoja, silenciadoAte, emDestaque, avisosNovos, erroLoja, eSilenciado, tituloTexto, TITULOS_LOJA, ITENS } from "../loja.js";
import { textoAviso } from "../grupo.js";
import { precoEfeito, minutosDoEfeito, passosOk, PASSOS_MAX, limpaRegras, regrasVazias, igualRegras, frase, fraseTexto, precoDaLoja, lojaLigada, LOJA } from "../selos.js";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, MID = (n) => String(n).padStart(32, "0").replace(/0/g, "a");
const T = (s) => `2026-11-14T12:00:${String(s).padStart(2, "0")}.000Z`;
const L = (id, user, item, extra = {}) => ({ id, user_id: U(user), item, alvo: null, detalhe: null, criado_em: T(id), agora: T(30), silencio_s: 300, ...extra });

describe("loja de Selos: regras e preços", () => {
  test("as regras começam com a loja DESLIGADA e com preços sugeridos", () => {
    const r = regrasVazias(); for (const k of LOJA) assert.equal(r[k].on, false); assert.deepEqual([r.loja_titulo.valor, r.loja_destaque.valor, r.loja_silenciar.valor], [50, 30, 80]);
  });
  test("o que vem do servidor é limpo: liga/desliga, preço de 1 a 999, valor ruim volta ao padrão, chaves desconhecidas somem", () => {
    const r = limpaRegras({ loja_titulo: { on: true, valor: 77 }, loja_destaque: { on: 1, valor: 5000 }, loja_silenciar: { on: true, valor: "x" }, loja_outra: { on: true, valor: 1 } });
    assert.deepEqual(r.loja_titulo, { on: true, valor: 77 }); assert.deepEqual(r.loja_destaque, { on: false, valor: 30 }); assert.deepEqual(r.loja_silenciar, { on: true, valor: 80 }); assert.equal(r.loja_outra, undefined);
  });
  test("preço só existe se a vantagem está ligada", () => {
    const r = { loja_titulo: { on: true, valor: 12 } }; assert.equal(precoDaLoja(r, "titulo"), 12); assert.equal(precoDaLoja(r, "silenciar"), null); assert.equal(lojaLigada(r, "titulo"), true); assert.equal(lojaLigada(r, "destaque"), false);
  });
  test("mudar um preço conta como mudança nas regras; a frase mostra o número tocável", () => {
    const a = { loja_titulo: { on: true, valor: 50 } }, b = { loja_titulo: { on: true, valor: 60 } }; assert.equal(igualRegras(a, a), true); assert.equal(igualRegras(a, b), false);
    assert.equal(fraseTexto(frase("loja_titulo", b)), "Custa 60 Selos"); assert.equal(fraseTexto(frase("loja_destaque", { loja_destaque: { on: true, valor: 1 } })), "Custa 1 Selo");
  });
});

describe("loja de Selos: o que o servidor diz", () => {
  test("linhas fora da forma são ignoradas (item, ids, título, mid, alvo)", () => {
    const ruins = [null, 5, {}, L(0, 1, "titulo", { detalhe: "t01" }), L(2, 1, "outro"), L(3, 1, "titulo", { detalhe: "t99" }), L(4, 1, "destaque", { detalhe: "xyz" }), L(5, 1, "silenciar", { alvo: "nao-e-id" }), { ...L(6, 1, "titulo", { detalhe: "t01" }), user_id: "x" }, { ...L(7, 1, "titulo", { detalhe: "t01" }), criado_em: "lixo" }];
    assert.deepEqual(limpaCompras(ruins), []); assert.deepEqual(limpaCompras(null), []);
    assert.equal(limpaCompras([L(1, 1, "titulo", { detalhe: "t02" }), L(2, 2, "destaque", { detalhe: MID(1) }), L(3, 3, "silenciar", { alvo: U(1) })]).length, 3);
  });
  test("título atual = o último que cada pessoa comprou; destaque vale só com o mid certo", () => {
    const e = estadoDaLoja([L(1, 1, "titulo", { detalhe: "t01" }), L(2, 2, "titulo", { detalhe: "t05" }), L(3, 1, "titulo", { detalhe: "t03" }), L(4, 2, "destaque", { detalhe: MID(1) })]);
    assert.equal(e.titulos.get(U(1)), "t03"); assert.equal(e.titulos.get(U(2)), "t05"); assert.equal(tituloTexto("t03"), "Mestre"); assert.equal(tituloTexto("zzz"), null);
    assert.equal(emDestaque(e, MID(1), U(2)), true); assert.equal(emDestaque(e, MID(1), U(1)), false, "outra pessoa não destaca a mensagem de quem pagou"); assert.equal(emDestaque(e, "nada", U(2)), false); assert.equal(emDestaque(e, null, U(2)), false);
  });
  test("silêncio: vale até a hora do SERVIDOR, mesmo com o relógio do aparelho adiantado ou atrasado", () => {
    const serv = Date.parse(T(30)); // o servidor diz que "agora" é 12:00:30; a compra foi 12:00:05 (silêncio de 5 min, até 12:05:05)
    const e1 = estadoDaLoja([L(5, 1, "silenciar", { alvo: U(2) })], serv); assert.equal(!!silenciadoAte(e1, U(2), serv + 1000), true); assert.equal(!!silenciadoAte(e1, U(2), serv + 270000), true); assert.equal(!!silenciadoAte(e1, U(2), serv + 276000), false, "5 min depois da compra (12:05:05) já acabou");
    const e2 = estadoDaLoja([L(5, 1, "silenciar", { alvo: U(2) })], serv + 3600000); // relógio do aparelho 1 h ADIANTADO
    assert.equal(!!silenciadoAte(e2, U(2), serv + 3600000 + 1000), true, "o desvio é corrigido"); assert.equal(silenciadoAte(e2, U(3), serv), null, "quem não foi silenciado");
  });
  test("a compra de silêncio mais nova de cada pessoa é a que vale", () => {
    const e = estadoDaLoja([L(1, 1, "silenciar", { alvo: U(2), silencio_s: 5 }), L(9, 3, "silenciar", { alvo: U(2), silencio_s: 5 })], Date.parse(T(30))); assert.equal(e.silencios.get(U(2)).por, U(3));
  });
  test("avisos do chat: uma linha por compra ainda não vista, do tipo certo", () => {
    const e = estadoDaLoja([L(1, 1, "titulo", { detalhe: "t01" }), L(2, 2, "destaque", { detalhe: MID(1) }), L(3, 3, "silenciar", { alvo: U(1) })]);
    assert.deepEqual(avisosNovos(e, 0).map((a) => a.tipo), ["loja_titulo", "loja_destaque", "loja_silencio"]); assert.deepEqual(avisosNovos(e, 2).map((a) => a.compra), [3]); assert.equal(avisosNovos(e, 3).length, 0); assert.equal(avisosNovos(e, 0)[0].titulo, "Lenda"); assert.equal(avisosNovos(e, 0)[2].alvo, U(1));
  });
  test("catálogo: 12 títulos com ids t01 a t12 e textos diferentes", () => {
    assert.equal(TITULOS_LOJA.length, 12); assert.deepEqual(TITULOS_LOJA.map(([i]) => i), Array.from({ length: 12 }, (_, i) => "t" + String(i + 1).padStart(2, "0"))); assert.equal(new Set(TITULOS_LOJA.map(([, t]) => t)).size, 12); assert.deepEqual(ITENS, ["titulo", "destaque", "silenciar", "jumpscare", "efeito"]);
  });
  test("erros do servidor viram frases em português", () => {
    for (const [m, re] of [["saldo_insuficiente", /Selos suficientes/], ["item_desligado", /desligou/], ["ja_silenciado", /já está silenciada/], ["ja_destacada", /já está em destaque/], ["si_mesmo", /outra pessoa/], ["alvo_fora", /não está mais/]]) assert.match(erroLoja({ message: m }), re);
    assert.match(erroLoja({ code: "PT429" }), /Muitas compras/); assert.match(erroLoja({ code: "42501" }), /neste grupo/); assert.match(erroLoja(null), /Não foi possível/);
    assert.equal(eSilenciado({ message: "silenciado" }), true); assert.equal(eSilenciado({ hint: "silenciado" }), true); assert.equal(eSilenciado({ message: "outro" }), false); assert.equal(eSilenciado(null), false);
  });
});

describe("jumpscare", () => {
  test("o preço sugerido é 60 e o item começa desligado; o aviso do jumpscare existe", () => {
    const r = regrasVazias(); assert.equal(r.loja_jumpscare.on, false); assert.equal(r.loja_jumpscare.valor, 60); assert.ok(LOJA.includes("loja_jumpscare"));
    assert.equal(limpaRegras({ loja_jumpscare: { on: true, valor: 9999 } }).loja_jumpscare.valor, 60, "valor fora do limite volta ao padrão");
    assert.equal(textoAviso({ tipo: "loja_jumpscare", nome: "ana" }), "@ana comprou um jumpscare"); assert.equal(textoAviso({ tipo: "loja_jumpscare", eu: true }), "Você comprou um jumpscare");
  });
  test("o atraso do susto fica entre 3 e 10 segundos", () => {
    assert.equal(atrasoSusto(() => 0), 3000); assert.equal(atrasoSusto(() => 1), 10000); assert.equal(atrasoSusto(() => 0.5), 6500);
    for (let i = 0; i < 200; i++) { const v = atrasoSusto(); assert.ok(v >= 3000 && v <= 10000, String(v)); }
  });
  test("pendentes: só linhas de forma certa; 'vivo' = compra recente; os 5 mais novos, em ordem", () => {
    const lin = (compra, idade, extra = {}) => ({ compra, user_id: U(compra), jumpscare: 7, criado_em: T(1), idade_s: idade, ...extra });
    assert.deepEqual(limpaPendentes([lin(3, 2), lin(1, SUSTO_VIVO_S + 1)]).map((x) => [x.compra, x.vivo]), [[1, false], [3, true]]);
    assert.deepEqual(limpaPendentes([null, 5, {}, lin(0, 1), lin(2, 1, { jumpscare: 0 }), lin(3, 1, { user_id: "x" }), lin(4, NaN)]).map((x) => [x.compra, x.vivo]), [[4, false]], "sem idade confiável não é 'vivo'");
    assert.equal(limpaPendentes(Array.from({ length: 9 }, (_, i) => lin(i + 1, 1))).length, SUSTOS_MAX); assert.deepEqual(limpaPendentes(null), []);
  });
  test("o arquivo cifrado só vale com caminho da pasta do grupo, iv curto e tipo permitido", () => {
    const g = "11111111-2222-4333-8444-555555555555", p = `${U(1)}/${g}/${U(2)}`;
    assert.deepEqual(limpaArquivoSusto({ p, iv: "abc", t: "image/png" }, g, "image"), { p, iv: "abc", t: "image/png" });
    assert.equal(limpaArquivoSusto({ p, iv: "abc", t: "audio/mpeg" }, g, "image"), null, "som onde se espera imagem");
    assert.equal(limpaArquivoSusto({ p, iv: "abc", t: "image/svg+xml" }, g, "image"), null, "svg não");
    assert.equal(limpaArquivoSusto({ p: `${U(1)}/${U(9)}/${U(2)}`, iv: "abc", t: "image/png" }, g, "image"), null, "pasta de outro grupo");
    assert.equal(limpaArquivoSusto({ p, iv: "x".repeat(41), t: "image/png" }, g, "image"), null); assert.equal(limpaArquivoSusto(null, g, "image"), null);
  });
  test("aviso da compra: quem comprou vê na hora; os outros não (só depois do susto deles); o servidor não diz qual foi sorteado", () => {
    const est = estadoDaLoja([L(1, 1, "jumpscare"), L(2, 2, "destaque", { detalhe: MID(2) })]);
    assert.deepEqual(avisosNovos(est, 0, U(1)).map((a) => [a.tipo, a.id === U(1)]), [["loja_jumpscare", true], ["loja_destaque", false]]);
    assert.deepEqual(avisosNovos(est, 0, U(3)).map((a) => a.tipo), ["loja_destaque"], "outra pessoa: sem aviso do jumpscare"); assert.deepEqual(avisosNovos(est, 0).map((a) => a.tipo), ["loja_destaque"]);
    assert.equal(limpaCompras([L(1, 1, "jumpscare", { detalhe: "5" })])[0].detalhe, null, "o número sorteado nunca fica no estado");
  });
  test("só a compra de SILENCIAR silencia: efeito sonoro e jumpscare (que também têm alvo/compra) nunca escondem o campo de escrever", () => {
    const agora = Date.parse(T(30)), est = estadoDaLoja([L(1, 1, "efeito", { alvo: U(2), detalhe: "2" }), L(2, 1, "efeito", { alvo: U(1), detalhe: "1" }), L(3, 1, "jumpscare")], agora);
    for (const u of [1, 2, 3]) assert.equal(silenciadoAte(est, U(u), agora), null, "ninguém está silenciado"); assert.equal(est.silencios.size, 0);
    const est2 = estadoDaLoja([L(1, 1, "efeito", { alvo: U(2), detalhe: "2" }), L(2, 3, "silenciar", { alvo: U(2) })], agora); assert.ok(silenciadoAte(est2, U(2), agora), "o silêncio de verdade continua valendo");
  });
  test("erros do servidor viram frases", () => {
    for (const [m, re] of [["sem_jumpscares", /não pôs jumpscares/], ["sem_alvos", /ninguém/], ["lista_cheia", /10 jumpscares/]]) assert.match(erroLoja({ message: m }), re);
  });
});

describe("efeito sonoro", () => {
  const R = (valor, extra, on = true) => ({ loja_efeito: { on, valor, extra } });
  test("regras: começa desligado, valor 30 e 10 a cada 5 minutos a mais; valores ruins voltam ao padrão; a frase tem os dois números tocáveis", () => {
    const r = regrasVazias(); assert.deepEqual(r.loja_efeito, { on: false, valor: 30, extra: 10 }); assert.ok(LOJA.includes("loja_efeito"));
    assert.deepEqual(limpaRegras({ loja_efeito: { on: true, valor: 40, extra: 5000 } }).loja_efeito, { on: true, valor: 40, extra: 10 });
    const f = frase("loja_efeito", R(40, 7)); assert.equal(fraseTexto(f), "Custa 40 Selos pelos primeiros 5 minutos e 7 Selos a cada 5 minutos a mais"); assert.deepEqual(f.filter((x) => typeof x === "object").map((x) => x.campo), ["valor", "extra"]);
    assert.equal(igualRegras(R(40, 7), R(40, 8)), false, "mudar o preço do tempo a mais conta como mudança");
  });
  test("preço = primeiros 5 minutos + (passos - 1) x preço de cada 5 minutos a mais; 1 a 12 passos; desligado não tem preço", () => {
    assert.equal(precoEfeito(R(30, 10), 1), 30); assert.equal(precoEfeito(R(30, 10), 2), 40); assert.equal(precoEfeito(R(30, 10), 12), 140);
    assert.equal(precoEfeito(R(999, 999), PASSOS_MAX), 999 * 12); for (const n of [0, 13, 1.5, "2", null]) assert.equal(precoEfeito(R(30, 10), n), null, String(n));
    assert.equal(precoEfeito(R(30, 10, false), 1), null); assert.equal(passosOk(12), true); assert.equal(passosOk(13), false); assert.equal(minutosDoEfeito(1), 5); assert.equal(minutosDoEfeito(12), 60);
  });
  test("compras de efeito: precisam de alvo e de 1 a 12 passos; viram aviso com os minutos; todos veem", () => {
    const ok = L(1, 1, "efeito", { alvo: U(2), detalhe: "3" });
    assert.deepEqual(limpaCompras([ok, L(2, 1, "efeito", { alvo: null, detalhe: "3" }), L(3, 1, "efeito", { alvo: U(2), detalhe: "0" }), L(4, 1, "efeito", { alvo: U(2), detalhe: "13" }), L(5, 1, "efeito", { alvo: U(2), detalhe: "x" })]).map((c) => c.id), [1]);
    const a = avisosNovos(estadoDaLoja([ok]), 0, U(9)); assert.deepEqual(a.map((x) => [x.tipo, x.id, x.alvo, x.min]), [["loja_efeito", U(1), U(2), 15]]);
    assert.equal(textoAviso({ tipo: "loja_efeito", nome: "ana", alvoNome: "bia", min: 15 }), "@ana pôs um efeito sonoro em @bia por 15 minutos"); assert.equal(textoAviso({ tipo: "loja_efeito", nome: "ana", alvoNome: "ana", mesmo: true, min: 5 }), "@ana pôs um efeito sonoro em si mesmo por 5 minutos");
    assert.equal(textoAviso({ tipo: "loja_efeito", nome: "ana", alvoEu: true, min: 5 }), "@ana pôs um efeito sonoro em você por 5 minutos"); assert.equal(textoAviso({ tipo: "loja_efeito", eu: true, alvoNome: "bia", min: 20 }), "Você pôs um efeito sonoro em @bia por 20 minutos"); assert.equal(textoAviso({ tipo: "loja_efeito", eu: true, alvoEu: true, min: 5 }), "Você pôs um efeito sonoro em você por 5 minutos");
    assert.match(erroLoja({ message: "ja_com_efeito" }), /já tem um efeito/);
  });
  const g = "11111111-2222-4333-8444-555555555555", arq = { p: `${U(1)}/${g}/${U(2)}`, iv: "abc", t: "audio/wav" };
  const E = (compra, alvo, t0, ate, extra = {}) => ({ compra, user_id: U(1), alvo: U(alvo), arquivo: arq, criado_em: new Date(t0).toISOString(), ate: new Date(ate).toISOString(), ...extra });
  test("efeitos ativos vindos do servidor: só forma certa (som WAV da pasta do grupo, janela válida)", () => {
    const bons = limpaEfeitos([E(2, 2, 1000, 5000), E(1, 3, 1000, 9000)], g); assert.deepEqual(bons.map((e) => [e.compra, e.alvo, e.t0, e.ate]), [[1, U(3), 1000, 9000], [2, U(2), 1000, 5000]]);
    const ruins = [null, 5, E(0, 2, 1, 2), E(3, 2, 5000, 1000), E(4, 2, 1000, 5000, { arquivo: { ...arq, t: "audio/mpeg" } }), E(5, 2, 1000, 5000, { arquivo: { ...arq, p: `${U(1)}/${U(9)}/${U(2)}` } }), E(6, 2, 1000, 5000, { criado_em: "x" }), E(7, 2, 1000, 5000, { alvo: "z" })];
    assert.deepEqual(limpaEfeitos(ruins, g), []); assert.deepEqual(limpaEfeitos(null, g), []);
  });
  test("quando toca: só para mensagem do alvo dentro da janela do efeito; depois de acabar não toca", () => {
    const l = limpaEfeitos([E(1, 2, 1000, 5000)], g); assert.equal(efeitoAtivoDe(l, U(2), 3000).compra, 1); assert.equal(efeitoAtivoDe(l, U(2), 1000).compra, 1); assert.equal(efeitoAtivoDe(l, U(2), 5000).compra, 1);
    assert.equal(efeitoAtivoDe(l, U(2), 5001), null, "acabou"); assert.equal(efeitoAtivoDe(l, U(2), 999), null, "antes de começar"); assert.equal(efeitoAtivoDe(l, U(3), 3000), null, "outra pessoa não toca"); assert.equal(efeitoAtivoDe(undefined, U(2), 3000), null);
  });
  test("só toca para mensagem de agora (não de histórico)", () => {
    const agora = Date.parse("2026-11-14T12:00:30.000Z"); assert.equal(mensagemRecente("2026-11-14T12:00:20.000Z", agora), true); assert.equal(mensagemRecente("2026-11-14T11:59:00.000Z", agora), false); assert.equal(mensagemRecente("lixo", agora), false); assert.equal(mensagemRecente("2026-11-14T12:05:00.000Z", agora), false, "do futuro distante não");
  });
});
