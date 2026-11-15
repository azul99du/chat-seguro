import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { norm, tokens, distancia, casaPalavra, pontuar, combinar, destaque, termosAmpliados, barrasDeOnda, urlBusca, capaGrande, limpaBusca, janelaDoTrecho, limpaMusica, textoMusica, mmssCurto, MAX_RESULTADOS } from "../musica.js";

const R = (id, extra = {}) => ({ wrapperType: "track", kind: "song", trackId: id, trackName: "Wind", artistName: "Akeboshi", previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/x/mzaf_1.m4a", artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/x/jacket.jpg/100x100bb.jpg", ...extra });
const G = "11111111-2222-4333-8444-555555555555", P = (n) => `${G}/${G}/${String(n).padStart(36, "a").slice(-36)}`;
const arq = (n, mime) => ({ path: P(n), key: "a".repeat(43) + "=", iv: "b".repeat(22) + "==", mime });
const MSG = (extra = {}) => ({ v: 1, type: "media", kind: "musica", ...arq(1, "audio/mp4"), size: 1000, capa: { ...arq(2, "image/jpeg"), size: 90 }, titulo: "Wind", artista: "Akeboshi", ini: 5, dur: 15, ...extra });

describe("música: busca na Apple", () => {
  test("o endereço da busca leva o termo codificado, o país e o limite", () => {
    const u = new URL(urlBusca("akeboshi wind & co")); assert.equal(u.origin, "https://itunes.apple.com"); assert.equal(u.searchParams.get("term"), "akeboshi wind & co"); assert.equal(u.searchParams.get("entity"), "song"); assert.equal(u.searchParams.get("limit"), String(MAX_RESULTADOS)); assert.equal(u.searchParams.get("country"), "BR");
    assert.equal(new URL(urlBusca("x".repeat(500))).searchParams.get("term").length, 100, "termo comprido é cortado");
  });
  test("a capa grande troca o tamanho no fim do endereço", () => {
    assert.equal(capaGrande("https://is1-ssl.mzstatic.com/a/b.jpg/100x100bb.jpg"), "https://is1-ssl.mzstatic.com/a/b.jpg/600x600bb.jpg"); assert.equal(capaGrande("https://is1-ssl.mzstatic.com/a/b.jpg/30x30bb.png", 300), "https://is1-ssl.mzstatic.com/a/b.jpg/300x300bb.jpg"); assert.equal(capaGrande(5), 5);
  });
  test("só entram músicas com trecho e capa dos endereços da Apple; sem repetidas; textos limpos e curtos", () => {
    const ok = limpaBusca({ results: [R(1), R(1), R(2, { trackName: "  Wi\u0000nd‮  ", artistName: "" }), R(3, { kind: "podcast" }), R(4, { previewUrl: "http://audio-ssl.itunes.apple.com/x.m4a" }), R(5, { previewUrl: "https://evil.example/x.m4a" }), R(6, { artworkUrl100: "https://evil.example/c.jpg" }), R(7, { trackId: "7" }), R(8, { trackName: "   " }), null, 5]});
    assert.deepEqual(ok.map((x) => x.id), [1, 2]); assert.equal(ok[1].titulo, "Wind"); assert.equal(ok[1].artista, "Artista desconhecido"); assert.match(ok[0].capaGrande, /600x600bb\.jpg$/);
    assert.equal(limpaBusca({ results: Array.from({ length: 50 }, (_, i) => R(i + 1)) }).length, MAX_RESULTADOS); assert.deepEqual(limpaBusca(null), []); assert.deepEqual(limpaBusca({ results: "x" }), []);
    assert.equal(limpaBusca({ results: [R(1, { trackName: "a".repeat(300) })] })[0].titulo.length, 80);
  });
});

describe("música: o trecho", () => {
  test("duração de 5 s até o tamanho do arquivo (no máximo 30); começo dentro do arquivo", () => {
    assert.deepEqual(janelaDoTrecho(30, 0, 15), { ini: 0, dur: 15 }); assert.deepEqual(janelaDoTrecho(30, 20, 15), { ini: 15, dur: 15 }, "o começo recua para caber"); assert.deepEqual(janelaDoTrecho(30, 0, 2), { ini: 0, dur: 5 }, "mínimo 5 s");
    assert.deepEqual(janelaDoTrecho(30, 0, 99), { ini: 0, dur: 30 }); assert.deepEqual(janelaDoTrecho(12, 5, 20), { ini: 0, dur: 12 }, "arquivo curto"); assert.deepEqual(janelaDoTrecho(3, 0, 10), { ini: 0, dur: 3 }, "menor que 5 s: usa tudo");
    assert.deepEqual(janelaDoTrecho(NaN, NaN, NaN), { ini: 0, dur: 15 }); assert.deepEqual(janelaDoTrecho(30, -4, 10), { ini: 0, dur: 10 }); assert.deepEqual(janelaDoTrecho(30, 12.34, 10.06), { ini: 12.3, dur: 10.1 }, "uma casa decimal");
  });
  test("tempos curtos para a tela", () => { assert.equal(mmssCurto(0), "0:00"); assert.equal(mmssCurto(65.4), "1:05"); assert.equal(mmssCurto(-3), "0:00"); assert.equal(mmssCurto("x"), "0:00"); });
});

describe("música: mensagem recebida", () => {
  test("uma mensagem bem formada vira o que se mostra", () => {
    const m = limpaMusica(MSG()); assert.equal(m.titulo, "Wind"); assert.equal(m.artista, "Akeboshi"); assert.equal(m.ini, 5); assert.equal(m.dur, 15); assert.equal(m.audio.mime, "audio/mp4"); assert.equal(m.capa.mime, "image/jpeg"); assert.equal(textoMusica(m), "Wind · Akeboshi");
    assert.equal(limpaMusica(MSG({ mime: "audio/mpeg" })).audio.mime, "audio/mpeg"); assert.equal(limpaMusica(MSG({ mime: "audio/wav" })).audio.mime, "audio/wav"); assert.equal(limpaMusica(MSG({ artista: "" })).artista, "Artista desconhecido");
  });
  test("o que a outra pessoa controla é conferido: tipo, caminhos, chaves, tipos de arquivo, tempos e textos", () => {
    for (const [nome, c] of [["nulo", null], ["outro kind", MSG({ kind: "audio" })], ["outro type", MSG({ type: "text" })], ["caminho ruim", MSG({ path: "../x" })], ["chave ruim", MSG({ key: "<b>" })], ["iv ruim", MSG({ iv: 5 })],
      ["som html", MSG({ mime: "text/html" })], ["sem capa", MSG({ capa: undefined })], ["capa svg", MSG({ capa: { ...arq(2, "image/svg+xml") } })], ["capa caminho ruim", MSG({ capa: { ...arq(2, "image/jpeg"), path: "x" } })], ["sem título", MSG({ titulo: "  " })],
      ["início negativo", MSG({ ini: -1 })], ["duração 0", MSG({ dur: 0 })], ["passa de 30 s", MSG({ ini: 20, dur: 20 })], ["tempo texto", MSG({ dur: "x" })]]) assert.equal(limpaMusica(c), null, nome);
    assert.equal(limpaMusica(MSG({ titulo: "a".repeat(300) })).titulo.length, 80);
  });
});

const It = (id, titulo, artista, extra = {}) => ({ id, titulo, artista, album: "", origem: "br", pos: 0, ...extra });
describe("música: busca que tolera acento e erro de digitação", () => {
  test("normaliza acento, maiúscula e pontuação", () => { assert.equal(norm("  Évidências — (Ao Vivo)! "), "evidencias ao vivo"); assert.deepEqual(tokens("Legião Urbana"), ["legiao", "urbana"]); assert.equal(norm(null), ""); });
  test("distância de edição: troca de letras vizinhas conta como um erro só, e corta cedo", () => {
    assert.equal(distancia("wind", "wind"), 0); assert.equal(distancia("wind", "wnd"), 1); assert.equal(distancia("wind", "wnid"), 1); assert.equal(distancia("akeboshi", "akeboshii"), 1); assert.ok(distancia("abc", "xyzxyz", 2) > 2);
  });
  test("uma palavra casa: igual 1, começo 0,9, com erro menos, longe 0", () => {
    assert.equal(casaPalavra("wind", "wind"), 1); assert.equal(casaPalavra("wi", "wind"), 0.9); assert.ok(casaPalavra("wnd", "wind") === 0, "palavra curta demais para aceitar erro");
    assert.ok(casaPalavra("akeboshii", "akeboshi") >= 0.6 && casaPalavra("akeboshii", "akeboshi") < 0.9); assert.ok(casaPalavra("legiao", "legiao") === 1); assert.equal(casaPalavra("banana", "maçã"), 0); assert.equal(casaPalavra("", "x"), 0);
  });
  test("a nota prefere título igual, depois artista; versões 'karaoke' e 'tribute' perdem pontos; sem acento casa com acento", () => {
    const a = pontuar("wind akeboshi", It(1, "Wind", "Akeboshi")), b = pontuar("wind akeboshi", It(2, "Wind", "Outro Artista")), c = pontuar("wind akeboshi", It(3, "Wind (Karaoke Version)", "Akeboshi Tribute"));
    assert.ok(a > b && a > c + 25, `${a} > ${b}, e a versão falsa perde pelo menos 25: ${c}`); assert.ok(pontuar("wind", It(10, "Wind (Karaoke Version)", "Akeboshi")) < pontuar("wind", It(11, "Wind", "Akeboshi")) - 20); assert.ok(pontuar("evidencias", It(4, "Evidências", "Chitãozinho & Xororó")) >= 80);
    assert.ok(pontuar("wind karaoke", It(5, "Wind (Karaoke)", "X")) > pontuar("wind", It(6, "Wind (Karaoke)", "X")), "quem pede karaoke não perde pontos"); assert.equal(pontuar("", It(7, "a", "b")), 0);
    assert.ok(pontuar("akeboshii wnd", It(8, "Wind", "Akeboshi")) > pontuar("akeboshii wnd", It(9, "Banana", "Maçã")) + 20, "erros de digitação ainda acham");
  });
  test("a ordem da loja, o país e a letra ajudam um pouco, mas não passam o que casa melhor", () => {
    const base = pontuar("wind", It(1, "Wind", "A", { pos: 0 })), depois = pontuar("wind", It(2, "Wind", "A", { pos: 15 })); assert.ok(base > depois);
    assert.ok(pontuar("wind", It(3, "Wind", "A", { origem: "us" })) < base); assert.ok(pontuar("wind", It(4, "Outra coisa", "B"), { naLetra: true }) < base);
  });
  test("combinar junta as lojas, tira repetidos (mesmo id ou mesmo título e artista), prefere a do Brasil e ordena pela nota", () => {
    const br = [It(1, "Wind", "Akeboshi", { pos: 0 }), It(2, "Wind Beneath My Wings", "Bette Midler", { pos: 1 })], us = [It(9, "Wind", "Akeboshi", { origem: "us", pos: 0 }), It(3, "Wind of Change", "Scorpions", { origem: "us", pos: 1 })];
    const l = combinar("wind akeboshi", [{ itens: br }, { itens: us }]); assert.deepEqual(l.map((x) => x.id), [1, 2, 3].filter((i) => l.some((x) => x.id === i)), "Wind (id 9, EUA) é o mesmo que o id 1"); assert.equal(l[0].id, 1); assert.ok(l.every((x, i) => i === 0 || l[i - 1].score >= x.score));
    assert.equal(combinar("x", [{ itens: Array.from({ length: 40 }, (_, i) => It(i + 1, "x" + i, "y")) }]).length, 20); assert.deepEqual(combinar("x", null), []); assert.ok(combinar("x", [{ itens: [It(1, "x", "y")], naLetra: true }])[0].score > combinar("x", [{ itens: [It(1, "x", "y")] }])[0].score);
  });
  test("o melhor resultado só vira destaque quando é bom e está bem à frente (ou é o único)", () => {
    assert.equal(destaque([{ score: 90 }, { score: 60 }]).score, 90); assert.equal(destaque([{ score: 90 }, { score: 85 }]), null, "parelho: sem destaque"); assert.equal(destaque([{ score: 70 }]).score, 70, "único bom"); assert.equal(destaque([{ score: 40 }]), null, "fraco demais"); assert.equal(destaque([]), null); assert.equal(destaque(null), null);
    assert.equal(destaque([{ score: 62 }, { score: 40 }]).score, 62, "62 contra 40: 1,5 vezes");
  });
  test("buscas de reserva: sem acento, só as palavras mais longas e a mais longa sem a última letra", () => {
    assert.deepEqual(termosAmpliados("Évidências Chitãozinho"), ["evidencias chitaozinho", "evidencias chitaozinh"]); assert.deepEqual(termosAmpliados("akeboshii"), ["akeboshi"]);
    assert.ok(termosAmpliados("rap do ben dez iron master").includes("iron master") === false && termosAmpliados("rap do ben dez iron master").length <= 3); assert.deepEqual(termosAmpliados(""), []); assert.deepEqual(termosAmpliados("wind"), []);
  });
});
describe("música: as ondas do trecho", () => {
  test("n barras entre 0 e 1, mais altas onde o som é mais forte; áudio vazio vira barras no meio", () => {
    const taxa = 100, c = new Float32Array(3000); for (let i = 1000; i < 2000; i++) c[i] = 0.8 * Math.sin(i); const b = barrasDeOnda([c], taxa, 30, 30);
    assert.equal(b.length, 30); assert.ok(b.every((x) => x >= 0.14 && x <= 1)); assert.ok(b[15] > 0.9 && b[2] < 0.2, "o miolo é o mais forte e as pontas ficam baixas");
    assert.deepEqual(barrasDeOnda([], 100, 4), [0.5, 0.5, 0.5, 0.5]); assert.deepEqual(barrasDeOnda(null, 100, 3), [0.5, 0.5, 0.5]);
  });
});
