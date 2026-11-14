import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { novoId, idValido, limpa, limpaLista, resumo, textoPendentes, nomeDoAparelho, erroAmigavel, MAX_APARELHOS, ehRef, chaveSessao, limpaPrekeys, alvosDeEnvio, copiaPropriaValida, lotesDm, faltaMs, textoFalta, copiaGrupoValida, lotesGrupo, loteDeOutroAparelho, trabalhosDeEnvio, emLevas, MAX_LINHAS_POR_PEDIDO } from "../dispositivos.js";

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
    // áudio: o maior trecho ouvido e "ouviu tudo" de qualquer aparelho de quem recebeu
    const au = lotesDm([{ id: 1, created_at: T1, read_at: "2026-11-10T10:01:00+00:00", ouvido_ate: 5, ouvido_em: "2026-11-10T10:02:00+00:00" }, { id: 2, created_at: T1, read_at: null, ouvido_ate: 30, ouvido_tudo: true, ouvido_em: "2026-11-10T10:03:00+00:00" }])[0];
    assert.deepEqual([au.read_at, au.ouvido_ate, au.ouvido_tudo, au.ouvido_em], ["2026-11-10T10:01:00+00:00", 30, true, "2026-11-10T10:03:00+00:00"]);
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

describe("etapa 3: grupos com uma cópia por aparelho", () => {
  const U = (n) => `10000000-0000-4000-8000-00000000000${n}`, G = "20000000-0000-4000-8000-000000000001", EU = U(1);
  const K = (n) => ({ ref: R(n), id: String(n).repeat(32), public_key: { x: "x" + n, y: "y" + n } });
  test("linhas do envio: por aparelho para quem usa aparelhos, uma cópia só para quem não usa, e as cópias para os meus outros aparelhos", () => {
    const pessoas = [{ id: U(2), aparelhos: [K(2), K(3)] }, { id: U(3), aparelhos: [] }, { id: U(4), aparelhos: [K(4)] }];
    const t = trabalhosDeEnvio({ pessoas, meus: [K(1), K(5)], meuRef: R(1), copias: true });
    assert.deepEqual(t.map((j) => [j.pessoaId, j.a?.ref ?? null, j.copia]), [[U(2), R(2), false], [U(2), R(3), false], [U(3), null, false], [U(4), R(4), false], [null, R(5), true]]);
    assert.equal(trabalhosDeEnvio({ pessoas, meus: [K(1), K(5)], meuRef: R(1), copias: false }).some((j) => j.copia), false, "toque sem grupo: sem cópia para mim");
    assert.deepEqual(trabalhosDeEnvio({ pessoas, meus: [K(1), K(5)], meuRef: null, copias: true }).map((j) => [j.pessoaId, j.a, j.copia]), [[U(2), null, false], [U(3), null, false], [U(4), null, false]], "este aparelho ainda não usa aparelhos: tudo no formato antigo");
    assert.equal(trabalhosDeEnvio({ pessoas: [{ id: U(2), aparelhos: [{ ref: "lixo" }, null, K(2), K(2)] }], meus: [], meuRef: R(1), copias: true }).length, 1, "lista vinda do servidor é limpa (sem repetir, sem lixo)");
    assert.deepEqual(trabalhosDeEnvio({ pessoas: [], meus: [K(1)], meuRef: R(1), copias: true }), [], "sozinho: nem cópia para o próprio aparelho");
  });
  test("o maior grupo cabe num pedido só; toques a muita gente vão em levas", () => {
    const pessoas = Array.from({ length: 19 }, (_, i) => ({ id: `10000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, aparelhos: Array.from({ length: 5 }, (_, k) => ({ ref: `30000000-0000-4000-8000-0000000${String(i).padStart(2, "0")}00${k}`, id: "a".repeat(32), public_key: { x: "x", y: "y" } })) }));
    const meus = Array.from({ length: 5 }, (_, k) => ({ ref: `40000000-0000-4000-8000-00000000000${k}`, id: "b".repeat(32), public_key: { x: "x", y: "y" } }));
    const t = trabalhosDeEnvio({ pessoas, meus, meuRef: meus[0].ref, copias: true });
    assert.equal(t.length, 99); assert.ok(t.length <= MAX_LINHAS_POR_PEDIDO);
    assert.deepEqual(emLevas(Array.from({ length: 250 }, (_, i) => i)).map((l) => l.length), [100, 100, 50]); assert.deepEqual(emLevas([]), []);
  });
  test("cópia de grupo vinda de outro aparelho meu: só de mim para mim, de outro aparelho, com o MESMO grupo na linha e no conteúdo", () => {
    const m = { sender_id: EU, recipient_id: EU, grupo_id: G, de_aparelho: R(2), para_aparelho: R(1) }, c = { type: "text", text: "oi", g: G, mid: "a".repeat(32) };
    assert.equal(copiaGrupoValida(m, c, EU, R(1)), true);
    assert.equal(copiaGrupoValida({ ...m, sender_id: U(2) }, c, EU, R(1)), false, "de outra pessoa");
    assert.equal(copiaGrupoValida({ ...m, de_aparelho: R(1) }, c, EU, R(1)), false, "a que este aparelho mesmo criou");
    assert.equal(copiaGrupoValida(m, { ...c, g: "20000000-0000-4000-8000-000000000002" }, EU, R(1)), false, "grupo do conteúdo diferente do da linha");
    assert.equal(copiaGrupoValida(m, { ...c, g: undefined }, EU, R(1)), false); assert.equal(copiaGrupoValida({ ...m, grupo_id: null }, c, EU, R(1)), false);
    assert.equal(copiaGrupoValida(m, { ...c, para: U(2) }, EU, R(1)), false, "cópia de grupo não leva 'para'");
    assert.equal(copiaGrupoValida({ ...m, de_aparelho: null }, c, EU, R(1)), false); assert.equal(copiaGrupoValida(null, c, EU, R(1)), false); assert.equal(copiaGrupoValida(m, null, EU, R(1)), false);
    assert.equal(copiaPropriaValida(m, { ...c, para: U(2) }, EU, R(1)), false, "e a regra da conversa a dois continua recusando linha de grupo");
  });
  test("minhas linhas no grupo viram uma mensagem; a enviada por OUTRO aparelho meu não aparece por aqui (aparece pela cópia)", () => {
    const linhas = [
      { id: 12, created_at: "t1", avisar: true, para_aparelho: R(3), de_aparelho: R(1) }, { id: 11, created_at: "t1", avisar: true, para_aparelho: R(4), de_aparelho: R(1) }, { id: 13, created_at: "t1", avisar: false, para_aparelho: R(2), de_aparelho: R(1) },
      { id: 20, created_at: "t2", avisar: true, para_aparelho: R(3), de_aparelho: R(2) }, { id: 21, created_at: "t2", avisar: false, para_aparelho: R(1), de_aparelho: R(2) },
      { id: 30, created_at: "t3", avisar: true, para_aparelho: null, de_aparelho: R(2) }, { id: 5, created_at: "t0", avisar: true }];
    const l = lotesGrupo(linhas);
    assert.deepEqual(l.map((x) => [x.id, x.n, x.novo, x.de]), [[5, 1, false, null], [11, 3, true, R(1)], [20, 2, true, R(2)], [30, 1, false, R(2)]]);
    assert.deepEqual(l.map((x) => loteDeOutroAparelho(x, R(1))), [false, false, true, false], "formato antigo de outro aparelho continua aparecendo (com o aviso de sempre)");
    assert.equal(l[1].avisar, false, "(como em lotes(): a leva só 'avisa' se todas as linhas avisam)");
    assert.deepEqual(lotesGrupo(linhas, true).map((x) => x.id), [11, 20, 30]); assert.deepEqual(lotesGrupo(null), []);
    // com "eu": cada mensagem leva para quem foi e quando leu (uma pessoa com 2 aparelhos conta uma vez; a cópia para mim não entra)
    const q = lotesGrupo([{ id: 1, created_at: "t1", recipient_id: "b", read_at: null }, { id: 2, created_at: "t1", recipient_id: "b", read_at: "2026-11-14T10:00:00Z" }, { id: 3, created_at: "t1", recipient_id: "c", read_at: null }, { id: 4, created_at: "t1", recipient_id: "eu", read_at: "2026-11-14T09:00:00Z" }], false, "eu");
    assert.deepEqual([...q[0].quem], [["b", { t: "2026-11-14T10:00:00Z", ate: null, tudo: false, em: null }], ["c", { t: null, ate: null, tudo: false, em: null }]]); assert.equal(q[0].linhas, undefined); assert.equal(lotesGrupo(linhas)[0].quem, undefined, "sem 'eu' continua como antes");
    assert.equal(loteDeOutroAparelho(null, R(1)), false);
  });
});
