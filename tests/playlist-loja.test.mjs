import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ITENS, INFO, limpaCompras, avisosNovos, erroLoja } from "../loja.js";
import { regrasVazias, limpaRegras, precoPlaylist, precoDaLoja, LOJA, frase, fraseTexto } from "../selos.js";
import { textoAviso } from "../grupo.js";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const L = (id, u, item, extra = {}) => ({ id, user_id: U(u), item, alvo: null, detalhe: null, criado_em: "2026-11-16T10:00:00Z", agora: "2026-11-16T10:00:05Z", silencio_s: 300, ...extra });

describe("playlist como item da loja do grupo", () => {
  test("é um item da loja, com nome e explicação; vem desligado e com preço por tempo (valor + extra)", () => {
    assert.ok(ITENS.includes("playlist")); assert.match(INFO.playlist.nome, /Playlist/); assert.match(INFO.playlist.desc, /só você controla/i); assert.match(INFO.playlist.desc, /não pode pôr músicas novas/i);
    assert.ok(LOJA.includes("loja_playlist")); const v = regrasVazias(); assert.equal(v.loja_playlist.on, false); assert.equal(v.loja_playlist.valor, 40); assert.equal(v.loja_playlist.extra, 10);
    const r = limpaRegras({ loja_playlist: { on: true, valor: 40, extra: 10 } }); assert.equal(precoPlaylist(r, 1), 40); assert.equal(precoPlaylist(r, 3), 60); assert.equal(precoPlaylist(r, 12), 150); assert.equal(precoPlaylist(r, 13), null); assert.equal(precoPlaylist(r, 0), null); assert.equal(precoPlaylist(regrasVazias(), 2), null, "desligada não tem preço");
    assert.equal(precoDaLoja(r, "playlist"), 40);
  });
  test("a frase do editor do admin diz o preço por tempo", () => {
    assert.equal(fraseTexto(frase("loja_playlist", limpaRegras({ loja_playlist: { on: true, valor: 40, extra: 10 } }))), "Custa 40 Selos pelos primeiros 5 minutos e 10 Selos a cada 5 minutos a mais");
  });
  test("compras de playlist: o detalhe é o número de passos de 5 minutos (1 a 12); outras coisas são descartadas", () => {
    assert.equal(limpaCompras([L(1, 1, "playlist", { detalhe: "3" })]).length, 1); for (const d of ["0", "13", "x", null, "1.5", "-2"]) assert.equal(limpaCompras([L(1, 1, "playlist", { detalhe: d })]).length, 0, String(d));
  });
  test("aviso no chat: quem comprou e por quantos minutos", () => {
    const est = { compras: limpaCompras([L(5, 1, "playlist", { detalhe: "3" })]) }, [a] = avisosNovos(est, 0, U(2)); assert.deepEqual([a.tipo, a.min, a.compra], ["loja_playlist", 15, 5]);
    assert.equal(textoAviso({ ...a, nome: "ana", eu: false }), "@ana pôs uma playlist para tocar no grupo por 15 minutos"); assert.equal(textoAviso({ ...a, nome: "ana", eu: true }), "Você pôs uma playlist para tocar no grupo por 15 minutos");
  });
  test("mensagem de erro de uma playlist já tocando", () => { assert.match(erroLoja({ message: "ja_com_playlist" }), /playlist tocando/); });
});
