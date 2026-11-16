import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_FAIXAS, MAX_PLAYLISTS, idYoutube, capaYoutube, limpaFaixa, limpaPlaylist, limpaColecao, colecaoVazia, mesclar, duracaoDaFaixa, rotuloFaixa, limpaEstado, estadoInicial, embaralhar, posicaoAgora, fimNatural, pular, irPara, pausar, continuar, alternarAleatorio, alternarLoop, estadoParaServidor, limpaSessaoFaixas, relogio, erroPlaylist, chaveFaixa } from "../playlist.js";

const A = (id, ti = "Música " + id) => ({ t: "a", id, ti, ar: "Banda", pr: `https://audio-ssl.itunes.apple.com/x/${id}.m4a`, ca: `https://is1-ssl.mzstatic.com/x/${id}/100x100bb.jpg` });
const Y = (id = "dQw4w9WgXcQ", du = 214) => ({ t: "y", id, ti: "Vídeo " + id, ar: "", du });

describe("playlists (funções puras)", () => {
  test("idYoutube: só endereços do YouTube com o código de 11 caracteres", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube.com/watch?v=dQw4w9WgXcQ&t=30", "https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "(https://youtu.be/dQw4w9WgXcQ)."]) assert.equal(idYoutube(u), "dQw4w9WgXcQ", u);
    for (const u of ["https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=curto", "https://www.youtube.com/watch", "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "dQw4w9WgXcQ", "", null, "https://www.youtube.com:8080/watch?v=dQw4w9WgXcQ"]) assert.equal(idYoutube(u), null, String(u));
    assert.equal(capaYoutube("dQw4w9WgXcQ"), "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  });
  test("limpaFaixa: só entra o que tem a forma certa (prévia e capa da Apple; código do YouTube)", () => {
    assert.deepEqual(limpaFaixa(A(1)), A(1)); assert.deepEqual(limpaFaixa(Y()), Y()); assert.equal(limpaFaixa({ ...A(1), pr: "https://evil.example/x.m4a" }), null); assert.equal(limpaFaixa({ ...A(1), id: "1" }), null); assert.equal(limpaFaixa({ ...Y(), id: "curto" }), null);
    assert.equal(limpaFaixa({ ...A(1), ca: "https://evil.example/c.jpg" }).ca, undefined, "capa de fora some, a música fica"); assert.equal(limpaFaixa({ ...A(1), ti: "  " }), null); assert.equal(limpaFaixa({ t: "z", id: 1, ti: "x" }), null); assert.equal(limpaFaixa(null), null);
    assert.equal(limpaFaixa({ ...Y(), du: -5 }).du, undefined); assert.equal(limpaFaixa({ ...A(2), ti: "a‮b\n" + "x".repeat(300) }).ti.length, 100);
  });
  test("limpaPlaylist e limpaColecao: nome, repetidas, limites, apagadas", () => {
    const p = limpaPlaylist({ id: "abc123xyz", nome: "  Treino  ", faixas: [A(1), A(1), Y(), { lixo: 1 }], mod: 5 }); assert.equal(p.nome, "Treino"); assert.equal(p.faixas.length, 2, "repetida e lixo ficam de fora"); assert.equal(limpaPlaylist({ id: "a", nome: "x", faixas: [] }), null, "id curto"); assert.equal(limpaPlaylist({ id: "abc123xyz", nome: "", faixas: [] }), null);
    assert.equal(limpaPlaylist({ id: "abc123xyz", nome: "x", faixas: Array.from({ length: 150 }, (_, i) => A(i + 1)) }).faixas.length, MAX_FAIXAS);
    const c = limpaColecao({ v: 1, listas: Array.from({ length: 30 }, (_, i) => ({ id: "lista" + String(i).padStart(4, "0"), nome: "L" + i, faixas: [], mod: 1 })), apagadas: { lista0001: 9 } }); assert.equal(c.listas.length, MAX_PLAYLISTS); assert.ok(!c.listas.some((l) => l.id === "lista0001"), "apagada depois da última mudança continua apagada"); assert.deepEqual(limpaColecao(null), colecaoVazia());
  });
  test("mesclar: vale a mais recente por playlist; apagar vence se foi depois; as duas pontas ganham as playlists uma da outra", () => {
    const a = { v: 1, apagadas: {}, listas: [{ id: "lista0001", nome: "A velha", faixas: [A(1)], mod: 10 }, { id: "lista0002", nome: "Só aqui", faixas: [], mod: 3 }] };
    const b = { v: 1, apagadas: { lista0002: 50 }, listas: [{ id: "lista0001", nome: "A nova", faixas: [A(1), A(2)], mod: 20 }, { id: "lista0003", nome: "Só lá", faixas: [], mod: 4 }] };
    const m = mesclar(a, b); assert.deepEqual(m.listas.map((l) => [l.id, l.nome]).sort(), [["lista0001", "A nova"], ["lista0003", "Só lá"]]); assert.equal(m.apagadas.lista0002, 50); assert.deepEqual(mesclar(b, a), m, "a ordem não muda o resultado");
    const re = mesclar(m, { v: 1, apagadas: {}, listas: [{ id: "lista0002", nome: "Recriada", faixas: [], mod: 60 }] }); assert.ok(re.listas.some((l) => l.id === "lista0002"), "mexer depois de apagada traz de volta");
  });
  test("estado: início, limpaEstado e o que vai ao servidor", () => {
    assert.deepEqual(estadoInicial(), { f: 0, p: 0, t: true, a: false, l: false }); assert.deepEqual(limpaEstado({ f: 7, p: 5, t: false, a: false, l: true }, 3), { f: 0, p: 5, t: false, a: false, l: true }, "faixa fora da lista volta para 0"); assert.equal(limpaEstado(null), null);
    assert.equal(limpaEstado({ f: 1, p: -3, t: true, a: true, l: false, o: [0, 1, 2] }, 3).a, true); assert.equal(limpaEstado({ f: 1, p: 0, t: true, a: true, l: false, o: [0, 0, 2] }, 3).a, false, "ordem sorteada inválida desliga o aleatório"); assert.equal(limpaEstado({ f: 0, p: 1e9, t: true, a: false, l: false }, 3).p, 0);
    assert.deepEqual(estadoParaServidor({ f: 2, p: 12.345, t: true, a: true, l: false, o: [2, 0, 1], x: 9 }), { f: 2, p: 12.3, t: true, a: true, l: false, o: [2, 0, 1] });
  });
  test("sequência: avança em ordem e volta ao começo; pular para trás; irPara", () => {
    let e = estadoInicial(); e = fimNatural(e, 3); assert.equal(e.f, 1); e = fimNatural(fimNatural(e, 3), 3); assert.equal(e.f, 0, "depois da última volta à primeira"); assert.equal(pular(estadoInicial(), 3, -1).f, 2); assert.equal(pular(estadoInicial(), 3, 1).f, 1); assert.equal(irPara(estadoInicial(), 2, 3).f, 2); assert.equal(irPara(estadoInicial(), 9, 3).f, 2);
    assert.equal(fimNatural(estadoInicial(), 1).f, 0, "uma música só repete");
  });
  test("loop de uma música: no fim natural repete a mesma; pular ainda anda", () => {
    const e = alternarLoop({ ...estadoInicial(), f: 1 }); assert.equal(e.l, true); const f = fimNatural({ ...e, p: 20 }, 3); assert.equal(f.f, 1); assert.equal(f.p, 0); assert.equal(pular(e, 3, 1).f, 2, "o botão pular ignora o loop"); assert.equal(alternarLoop(e).l, false);
  });
  test("aleatório: ordem com a atual primeiro, todas aparecem uma vez por volta; desligar volta à ordem normal", () => {
    const o = embaralhar(6, 3, () => 0.5); assert.equal(o[0], 3); assert.deepEqual([...o].sort(), [0, 1, 2, 3, 4, 5]); const e = alternarAleatorio({ ...estadoInicial(), f: 3 }, 6, () => 0.3); assert.equal(e.a, true); assert.equal(e.o[0], 3);
    const vistos = new Set(); let x = e; for (let i = 0; i < 6; i++) { vistos.add(x.f); x = fimNatural(x, 6); } assert.equal(vistos.size, 6, "uma volta toca todas"); assert.equal(x.f, 3, "e fecha o ciclo");
    const off = alternarAleatorio(e, 6); assert.equal(off.a, false); assert.equal(off.o, undefined); assert.equal(fimNatural(off, 6).f, 4);
  });
  test("pausar guarda onde estava; continuar anda de novo; posição usa a hora do servidor", () => {
    const e = { ...estadoInicial(), p: 10 }, em = 1_000_000; assert.equal(posicaoAgora(e, em + 5000, em), 15); const p = pausar(e, em + 5000, em); assert.deepEqual([p.t, p.p], [false, 15]); assert.equal(posicaoAgora(p, em + 99999, em), 15, "parada não anda"); assert.equal(continuar(p).t, true); assert.equal(posicaoAgora({ ...e, p: 0 }, em - 500, em), 0, "nunca negativa");
  });
  test("duração, rótulo e conteúdo cifrado da sessão", () => {
    assert.equal(duracaoDaFaixa(A(1)), 30); assert.equal(duracaoDaFaixa(Y("dQw4w9WgXcQ", 214)), 214); assert.equal(duracaoDaFaixa({ t: "y", id: "dQw4w9WgXcQ", ti: "x" }), null); assert.equal(rotuloFaixa(A(1)), "Música 1 · Banda"); assert.equal(chaveFaixa(Y()), "y:dQw4w9WgXcQ");
    const s = limpaSessaoFaixas({ pl: "lista0001", nome: "Treino", faixas: [A(1), { lixo: 1 }, Y()] }); assert.equal(s.faixas.length, 2); assert.equal(s.pl, "lista0001"); assert.equal(limpaSessaoFaixas({ nome: "x", faixas: [] }), null); assert.equal(limpaSessaoFaixas(null), null);
  });
  test("relógio do servidor e mensagens de erro", () => {
    const r = relogio(); assert.equal(r.agora(1000), 1000); r.acerta(5000, 1000); assert.equal(r.agora(2000), 6000); r.acerta(NaN, 0); assert.equal(r.dif(), 4000);
    assert.match(erroPlaylist({ message: "saldo_insuficiente" }), /Selos/); assert.match(erroPlaylist({ message: "ja_com_playlist" }), /já há uma playlist/i); assert.match(erroPlaylist({ message: "sem_controle" }), /Só quem iniciou/); assert.match(erroPlaylist({ code: "PT429" }), /Espere/); assert.match(erroPlaylist(null), /Tente de novo/);
  });
});
