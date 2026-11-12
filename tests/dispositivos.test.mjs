import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { novoId, idValido, limpa, limpaLista, resumo, textoPendentes, nomeDoAparelho, erroAmigavel, MAX_APARELHOS, ehRef, chaveSessao, limpaPrekeys, alvosDeEnvio, copiaPropriaValida, lotesDm, faltaMs, textoFalta } from "../dispositivos.js";

const R = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const L = (n, estado, extra = {}) => ({ ref: R(n), estado, atual: false, criado_em: "2026-01-01T00:00:00Z", visto_em: "2026-01-01T00:00:00Z", aprovado_em: estado === "aprovado" ? "2026-01-01T00:00:00Z" : null, navegador: "Chrome", sistema: "Windows", tipo: "computador", ...extra });

describe("identificador do aparelho", () => {
  test("novoId: 32 hexadecimais, diferente a cada vez", () => { const a = novoId(), b = novoId(); assert.match(a, /^[0-9a-f]{32}$/); assert.notEqual(a, b); assert.equal(novoId(new Uint8Array(16)), "0".repeat(32)); });
  test("idValido recusa tamanho, maiúsculas e lixo", () => { assert.equal(idValido("a".repeat(32)), true); for (const x of ["a".repeat(31), "A".repeat(32), "g".repeat(32), "", null, 5, "a".repeat(32) + "\n"]) assert.equal(idValido(x), false, String(x)); });
});
describe("linhas do servidor (desconfiáveis)", () => {
  test("limpa aceita o formato certo e descarta estado/ref estranhos", () => {
    assert.equal(limpa(L(1, "aprovado")).estado, "aprovado");
    for (const x of [null, "x", {}, L(1, "hacker"), { ...L(1, "aprovado"), ref: "../../x" }, { ...L(1, "aprovado"), ref: 5 }]) assert.equal(limpa(x), null);
  });
  test("limpa corta textos enormes e normaliza tipo e país", () => {
    const o = limpa(L(1, "pendente", { navegador: "x".repeat(500), tipo: "<img>", pais_codigo: "brasil", cidade: "y".repeat(500) }));
    assert.equal(o.navegador.length, 60); assert.equal(o.tipo, "outro"); assert.equal(o.pais_codigo, null); assert.equal(o.cidade.length, 80); assert.equal(o.atual, false);
  });
  test("atual só vale com true de verdade", () => { assert.equal(limpa(L(1, "aprovado", { atual: "true" })).atual, false); assert.equal(limpa(L(1, "aprovado", { atual: true })).atual, true); });
  test("limpaLista tolera o que não é lista e limita o tamanho", () => { assert.deepEqual(limpaLista(null), []); assert.deepEqual(limpaLista({}), []); assert.equal(limpaLista(Array.from({ length: 50 }, () => L(1, "aprovado"))).length, MAX_APARELHOS + 5); });
});
describe("resumo", () => {
  test("aparelho aprovado com um pendente", () => { const r = resumo([L(1, "aprovado", { atual: true }), L(2, "pendente")]); assert.equal(r.souAprovado, true); assert.equal(r.souPendente, false); assert.equal(r.pendentes.length, 1); assert.equal(r.cheio, false); });
  test("aparelho pendente não conta a si mesmo como pendente a decidir", () => { const r = resumo([L(1, "aprovado"), L(2, "pendente", { atual: true })]); assert.equal(r.souPendente, true); assert.equal(r.souAprovado, false); assert.equal(r.pendentes.length, 0); });
  test("sem linha 'atual' (ainda não registrou): nem aprovado nem pendente", () => { const r = resumo([L(1, "aprovado")]); assert.equal(r.eu, null); assert.equal(r.souAprovado, false); assert.equal(r.souPendente, false); });
  test("cheio com 5", () => assert.equal(resumo(Array.from({ length: 5 }, (_, i) => L(i, "aprovado"))).cheio, true));
});
describe("textos", () => {
  test("textoPendentes", () => { assert.equal(textoPendentes(0), ""); assert.match(textoPendentes(1), /^Um aparelho novo/); assert.match(textoPendentes(3), /^3 aparelhos novos/); });
  test("nomeDoAparelho", () => { assert.equal(nomeDoAparelho({ navegador: "Chrome", sistema: "Android" }), "Chrome no Android"); assert.equal(nomeDoAparelho({}), "Aparelho sem nome"); });
  test("erroAmigavel", () => { assert.match(erroAmigavel({ message: "limite_de_aparelhos" }), /5 aparelhos/); assert.match(erroAmigavel({ message: "limite de uso atingido: espere um pouco" }), /Espere/); assert.match(erroAmigavel(null), /Tente de novo/); });
});

const K = (n, extra = {}) => ({ ref: R(n), id: String(n).padStart(32, "a"), public_key: { x: "x" + n, y: "y" + n }, ...extra });
describe("etapa 2: sessão por aparelho", () => {
  test("chaveSessao: com ref válido soma o aparelho; sem ref (ou ref malformado) é o formato antigo", () => {
    assert.equal(chaveSessao("pessoa", R(1)), `pessoa#${R(1)}`); assert.equal(chaveSessao("pessoa", null), "pessoa"); assert.equal(chaveSessao("pessoa", "../x"), "pessoa");
  });
  test("ehRef", () => { assert.ok(ehRef(R(1))); for (const x of [null, 5, "x", R(1) + "0", "../../" + R(1)]) assert.ok(!ehRef(x)); });
  test("limpaPrekeys: descarta o malformado, o repetido e o que passa do limite; nunca devolve campos extras", () => {
    const r = limpaPrekeys([K(1), K(1), K(2, { id: "curto" }), K(3, { public_key: { x: 1, y: "y" } }), { ...K(4), segredo: "x" }, null, "x", K(5, { ref: "nao" })]);
    assert.deepEqual(r.map((x) => x.ref), [R(1), R(4)]); assert.deepEqual(Object.keys(r[1]).sort(), ["id", "public_key", "ref"]);
    assert.equal(limpaPrekeys(Array.from({ length: 9 }, (_, i) => K(i))).length, MAX_APARELHOS); assert.deepEqual(limpaPrekeys(null), []);
  });
  test("alvosDeEnvio: um alvo por aparelho do destinatário e por OUTRO aparelho meu; sem aparelhos do destinatário, ou sem aparelho meu aprovado, é o formato antigo", () => {
    const r = alvosDeEnvio({ deles: [K(1), K(2)], meus: [K(3), K(4)], meuRef: R(3) });
    assert.equal(r.novo, true); assert.deepEqual(r.amigo.map((x) => x.ref), [R(1), R(2)]); assert.deepEqual(r.proprios.map((x) => x.ref), [R(4)], "eu mesmo fico de fora");
    assert.equal(alvosDeEnvio({ deles: [], meus: [K(3)], meuRef: R(3) }).novo, false); assert.equal(alvosDeEnvio({ deles: [K(1)], meus: [], meuRef: null }).novo, false);
    assert.equal(alvosDeEnvio({ deles: [K(1)], meus: [], meuRef: R(3) }).proprios.length, 0, "conta com um aparelho só: sem cópia própria");
    const max = alvosDeEnvio({ deles: Array.from({ length: 9 }, (_, i) => K(i + 1)), meus: Array.from({ length: 9 }, (_, i) => K(i + 11)), meuRef: R(5) }); assert.ok(max.amigo.length + max.proprios.length <= 9, "no máximo 5 + 4 linhas");
  });
  test("copiaPropriaValida: só de mim para mim, de OUTRO aparelho meu, com a conversa dentro do conteúdo", () => {
    const eu = R(7), outro = R(8), m = { sender_id: eu, recipient_id: eu, de_aparelho: R(1), para_aparelho: R(2), grupo_id: null }, c = { type: "text", para: outro };
    assert.ok(copiaPropriaValida(m, c, eu, R(2)));
    assert.ok(!copiaPropriaValida({ ...m, sender_id: outro }, c, eu, R(2)), "linha de outra pessoa"); assert.ok(!copiaPropriaValida({ ...m, recipient_id: outro }, c, eu, R(2)), "para outra pessoa");
    assert.ok(!copiaPropriaValida({ ...m, de_aparelho: null }, c, eu, R(2)), "sem aparelho de origem"); assert.ok(!copiaPropriaValida({ ...m, de_aparelho: R(2) }, c, eu, R(2)), "veio de mim mesmo");
    assert.ok(!copiaPropriaValida({ ...m, grupo_id: R(9) }, c, eu, R(2)), "grupo");
    for (const para of [undefined, "x", eu, 5, null]) assert.ok(!copiaPropriaValida(m, { type: "text", para }, eu, R(2)), "para = " + para);
    assert.ok(!copiaPropriaValida(m, { ...c, g: R(9) }, eu, R(2)), "com grupo"); assert.ok(!copiaPropriaValida(null, c, eu, R(2))); assert.ok(!copiaPropriaValida(m, null, eu, R(2)));
  });
  test("lotesDm: junta as linhas de uma mensagem (menor id, todos os ids, 'lida' = a primeira leitura de qualquer aparelho)", () => {
    const T1 = "2026-11-10T10:00:00.1+00:00", T2 = "2026-11-10T10:00:05.0+00:00";
    const r = lotesDm([{ id: 8, created_at: T2, avisar: true, para_aparelho: null, read_at: null }, { id: 6, created_at: T1, avisar: true, para_aparelho: R(1), read_at: null }, { id: 5, created_at: T1, avisar: true, para_aparelho: R(2), read_at: "2026-11-10T10:01:00+00:00" }]);
    assert.deepEqual(r.map((l) => [l.id, l.n, l.novo, l.read_at]), [[5, 2, true, "2026-11-10T10:01:00+00:00"], [8, 1, false, null]]); assert.deepEqual(r[0].ids.sort(), [5, 6]);
    assert.equal(lotesDm([{ id: 1, created_at: T1, avisar: false }, { id: 2, created_at: T1, avisar: true }])[0].avisar, false);
    assert.deepEqual(lotesDm([{ id: 9, created_at: T2 }, { id: 4, created_at: T1 }], true).map((l) => l.id), [9]); assert.deepEqual(lotesDm(null), []);
  });
});
describe("etapa 2: recuperação", () => {
  test("resumo e limpa trazem o pedido de recuperação dos outros aparelhos", () => {
    const r = resumo([L(1, "aprovado", { atual: true }), L(2, "pendente", { recuperacao_em: "2026-11-10T10:00:00Z", vale_em: "2026-11-11T10:00:00Z", agora: "2026-11-10T11:00:00Z" })]);
    assert.equal(r.recuperacoes.length, 1); assert.equal(r.recuperacoes[0].vale_em, "2026-11-11T10:00:00Z"); assert.equal(resumo([L(1, "aprovado", { atual: true })]).recuperacoes.length, 0);
  });
  test("faltaMs usa a hora do banco; textoFalta fala em minutos ou horas", () => {
    assert.equal(faltaMs("2026-11-11T10:00:00Z", "2026-11-11T09:00:00Z", 0), 3600000); assert.equal(faltaMs("2026-11-11T10:00:00Z", "2026-11-11T11:00:00Z"), 0); assert.equal(faltaMs("lixo", null), null);
    assert.equal(textoFalta(null), ""); assert.equal(textoFalta(0), "agora"); assert.equal(textoFalta(30000), "menos de 1 minuto"); assert.equal(textoFalta(25 * 60000), "25 minutos"); assert.equal(textoFalta(23.5 * 3600000), "23 h 30 min"); assert.equal(textoFalta(2 * 3600000), "2 h");
  });
});
