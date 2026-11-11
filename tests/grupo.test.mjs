import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_NOME, ehGrupoId, ehMid, limpaNome, novaChave, cifrarNome, abrirNome, embrulho, abrirEmbrulho, conteudoBate, lotes, montarGrupos, diferencaMembros, textoAviso, resumoMembros, contagem, corDoAutor } from "../grupo.js";

const G = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", G2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EU = "11111111-1111-4111-8111-111111111111", ANA = "22222222-2222-4222-8222-222222222222", BETO = "33333333-3333-4333-8333-333333333333";
const MID = "0123456789abcdef0123456789abcdef";

describe("nome do grupo", () => {
  test("limpa espaços e recusa vazio, longo demais e o que não é texto", () => {
    assert.equal(limpaNome("  Churrasco   de\n sábado "), "Churrasco de sábado");
    assert.equal(limpaNome(""), null); assert.equal(limpaNome("   "), null); assert.equal(limpaNome(null), null); assert.equal(limpaNome(42), null);
    assert.equal(limpaNome("x".repeat(MAX_NOME)), "x".repeat(MAX_NOME)); assert.equal(limpaNome("x".repeat(MAX_NOME + 1)), null);
    assert.equal(limpaNome("🎉".repeat(MAX_NOME)), "🎉".repeat(MAX_NOME), "emoji conta como um caractere");
  });
  test("caracteres invisíveis e de direção do texto não passam (não dá para disfarçar um nome)", () => {
    assert.equal(limpaNome("fam\u200bília"), "fam ília"); assert.equal(limpaNome("\u202Eoãçurtsni"), "oãçurtsni"); assert.equal(limpaNome("\u200b\u200d"), null);
  });
  test("cifra e abre com a chave do grupo; o servidor não vê o nome", async () => {
    const gk = novaChave(), c = await cifrarNome(gk, G, "Família");
    assert.deepEqual(Object.keys(c).sort(), ["c", "iv"]); assert.doesNotMatch(JSON.stringify(c), /Fam/);
    assert.equal(await abrirNome(gk, G, c), "Família");
    assert.notDeepEqual(await cifrarNome(gk, G, "Família"), c, "cada vez sai diferente (IV novo)");
  });
  test("não abre com outra chave, em outro grupo, adulterado ou malformado", async () => {
    const gk = novaChave(), c = await cifrarNome(gk, G, "Família");
    await assert.rejects(abrirNome(novaChave(), G, c), "outra chave");
    await assert.rejects(abrirNome(gk, G2, c), "o nome de um grupo não serve em outro");
    const mexido = { ...c, c: c.c.slice(0, -4) + (c.c.endsWith("AAAA") ? "BBBB" : "AAAA") }; await assert.rejects(abrirNome(gk, G, mexido), "adulterado");
    for (const ruim of [null, {}, { c: 1, iv: 2 }, "texto"]) await assert.rejects(abrirNome(gk, G, ruim));
    await assert.rejects(cifrarNome(gk, G, ""), "nome vazio"); await assert.rejects(cifrarNome(gk, "nao-e-uuid", "x")); await assert.rejects(cifrarNome("curta", G, "x"), "chave de tamanho errado");
  });
});

describe("embrulho da chave do grupo", () => {
  test("vai e volta; só vale para o grupo certo e no formato certo", () => {
    const gk = novaChave(), e = embrulho(gk, G);
    assert.equal(abrirEmbrulho(e, G), gk);
    assert.throws(() => abrirEmbrulho(e, G2), "de outro grupo");
    for (const ruim of ["", "nao-json", "{}", JSON.stringify({ lacre: "outra-coisa", g: G, k: gk }), JSON.stringify({ lacre: "grupo-chave", g: G, k: "curta" }), JSON.stringify({ lacre: "grupo-chave", g: G, k: 5 }), JSON.stringify({ lacre: "grupo-chave", g: G, k: "!!!não-base64!!!" })])
      assert.throws(() => abrirEmbrulho(ruim, G), ruim.slice(0, 30));
  });
});

describe("a mensagem cifrada e a linha do servidor precisam dizer o mesmo grupo", () => {
  test("conversa a dois: sem grupo dos dois lados", () => {
    assert.ok(conteudoBate({ type: "text", text: "oi" }, null)); assert.ok(conteudoBate({ type: "hello" }, undefined));
    assert.ok(!conteudoBate({ type: "text", text: "oi", mid: MID }, null), "mensagem a dois não tem identificador de grupo");
  });
  test("o servidor não consegue pôr uma mensagem particular num grupo, nem tirar do grupo, nem trocar de grupo", () => {
    assert.ok(!conteudoBate({ type: "text", text: "segredo a dois" }, G), "particular marcada como de grupo");
    assert.ok(!conteudoBate({ type: "text", text: "do grupo", g: G, mid: MID }, null), "de grupo entregue como particular");
    assert.ok(!conteudoBate({ type: "text", text: "do grupo", g: G, mid: MID }, G2), "de um grupo entregue em outro");
    assert.ok(conteudoBate({ type: "text", text: "do grupo", g: G, mid: MID }, G));
  });
  test("mensagem visível de grupo precisa de identificador válido; reação e apagar não precisam", () => {
    assert.ok(!conteudoBate({ type: "text", text: "x", g: G }, G)); assert.ok(!conteudoBate({ type: "media", g: G, mid: "curto" }, G));
    assert.ok(conteudoBate({ type: "reaction", to: MID, emoji: "👍", g: G }, G)); assert.ok(conteudoBate({ type: "delete", to: MID, g: G }, G));
    assert.ok(!conteudoBate({ type: "reaction", g: "nao-e-uuid" }, "nao-e-uuid"), "grupo malformado");
    assert.ok(!conteudoBate(null, G));
  });
  test("identificadores", () => {
    assert.ok(ehMid(MID)); for (const x of [MID.toUpperCase(), MID.slice(1), MID + "0", 5, null, undefined]) assert.ok(!ehMid(x), String(x));
    assert.ok(ehGrupoId(G)); for (const x of ["", "aaaa", G.toUpperCase(), G + "0", "-".repeat(36), null]) assert.ok(!ehGrupoId(x), String(x));
  });
});

describe("minhas mensagens no grupo: várias linhas no servidor viram uma só", () => {
  const T1 = "2026-11-10T10:00:00.123456+00:00", T2 = "2026-11-10T10:00:05.000001+00:00";
  test("agrupa pelo instante da gravação e usa o menor id", () => {
    const r = lotes([{ id: 12, created_at: T2, avisar: true }, { id: 7, created_at: T1, avisar: true }, { id: 5, created_at: T1, avisar: true }, { id: 6, created_at: T1, avisar: true }, { id: 11, created_at: T2, avisar: true }]);
    assert.deepEqual(r, [{ id: 5, created_at: T1, avisar: true, n: 3 }, { id: 11, created_at: T2, avisar: true, n: 2 }]);
  });
  test("leva de controle (sem aviso) continua marcada; consulta cortada descarta a leva mais antiga (pode estar incompleta)", () => {
    assert.equal(lotes([{ id: 1, created_at: T1, avisar: false }, { id: 2, created_at: T1, avisar: false }])[0].avisar, false);
    assert.deepEqual(lotes([{ id: 9, created_at: T2, avisar: true }, { id: 4, created_at: T1, avisar: true }], true).map((l) => l.id), [9]);
    assert.deepEqual(lotes(null), []); assert.deepEqual(lotes([], true), []);
  });
});

describe("participantes", () => {
  const linha = (g, u, nome, extra = {}) => ({ grupo_id: g, nome: { c: "x", iv: "y" }, criado_em: "2026-11-10T00:00:00Z", user_id: u, username: nome, public_key: { x: "1", y: "2" }, avatar: null, admin: false, entrou_em: "2026-11-10T00:00:00Z", chave: null, por: null, por_chave: null, ...extra });
  test("monta os grupos a partir das linhas do servidor e separa a minha parte (chave embrulhada, admin)", () => {
    const gs = montarGrupos([linha(G, EU, "eu", { admin: true, chave: { ciphertext: "c", iv: "i" }, por: EU }), linha(G, ANA, "ana"), linha(G2, ANA, "ana", { admin: true }), linha(G2, EU, "eu", { chave: { ciphertext: "d", iv: "j" }, por: ANA, por_chave: { x: "9", y: "8" } })], EU);
    assert.equal(gs.length, 2);
    const a = gs.find((g) => g.id === G), b = gs.find((g) => g.id === G2);
    assert.deepEqual(a.membros.map((p) => p.username), ["eu", "ana"]); assert.equal(a.eu.admin, true); assert.equal(a.eu.por, EU);
    assert.equal(b.eu.admin, false); assert.equal(b.eu.por, ANA); assert.deepEqual(b.eu.porChave, { x: "9", y: "8" });
  });
  test("ignora linhas malformadas e grupos em que eu não apareço", () => {
    assert.deepEqual(montarGrupos([linha(G, ANA, "ana"), linha("ruim", EU, "eu"), { grupo_id: G2 }, linha(G2, EU, 5)], EU), []);
    assert.deepEqual(montarGrupos(null, EU), []);
  });
  test("o que mudou desde a última vez: quem entrou e quem saiu (eu não conto)", () => {
    const d = diferencaMembros({ [EU]: "eu", [ANA]: "ana" }, { [EU]: "eu", [BETO]: "beto" }, EU);
    assert.deepEqual(d, { entraram: [{ id: BETO, nome: "beto" }], sairam: [{ id: ANA, nome: "ana" }] });
    assert.deepEqual(diferencaMembros({ [ANA]: "ana" }, { [ANA]: "ana", [EU]: "eu" }, EU), { entraram: [], sairam: [] });
  });
  test("textos dos avisos, resumo de quem participa e contagem", () => {
    assert.equal(textoAviso({ tipo: "criou" }), "Você criou o grupo"); assert.equal(textoAviso({ tipo: "adicionado", nome: "ana" }), "@ana adicionou você ao grupo");
    assert.equal(textoAviso({ tipo: "entrou", nome: "beto" }), "@beto entrou no grupo"); assert.equal(textoAviso({ tipo: "saiu", nome: "beto" }), "@beto saiu do grupo");
    assert.equal(textoAviso({ tipo: "nome", nome: "Novo" }), "O grupo agora se chama “Novo”"); assert.equal(textoAviso({ tipo: "outro" }), "");
    const ms = [{ id: EU, username: "eu" }, { id: ANA, username: "ana" }, { id: BETO, username: "beto" }, { id: G, username: "caio" }, { id: G2, username: "duda" }];
    assert.equal(resumoMembros(ms, EU), "você, @ana, @beto, @caio e mais 1"); assert.equal(resumoMembros(ms.slice(0, 2), EU), "você, @ana"); assert.equal(resumoMembros([ms[0]], EU), "você");
    assert.equal(contagem(1), "1 pessoa"); assert.equal(contagem(7), "7 pessoas");
  });
  test("a cor do nome é sempre a mesma para a mesma pessoa e cabe na paleta", () => {
    assert.equal(corDoAutor(ANA), corDoAutor(ANA)); for (const id of [EU, ANA, BETO, G, G2]) { const c = corDoAutor(id); assert.ok(Number.isInteger(c) && c >= 0 && c < 6); }
  });
});
