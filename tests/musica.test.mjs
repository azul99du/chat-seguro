import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { urlBusca, capaGrande, limpaBusca, janelaDoTrecho, limpaMusica, textoMusica, mmssCurto, MAX_RESULTADOS } from "../musica.js";

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
