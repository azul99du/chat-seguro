import test from "node:test";
import assert from "node:assert/strict";
import { segredoNovo, hashSegredo, chaveParaLink, chaveDoLink, montarLink, lerLink, validadeDe, limiteDe, limpaApelido, limpaLinks, limpaPedidos, pedidosPorGrupo, autoAceitar, rotuloLink, textoPedido, erroConvite, TAM_SEGREDO, TAM_CHAVE, NOME_PADRAO, VALIDADES, LIMITES } from "../convite.js";

const GK = Buffer.from(Array.from({ length: 32 }, (_, i) => 250 - i * 3)).toString("base64"); // 32 bytes com + e / possíveis
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", U3 = "33333333-3333-4333-8333-333333333333";

test("segredo: 22 letras seguras para endereço, diferente a cada vez; o hash tem 64 hex e muda com o segredo", async () => {
  const a = segredoNovo(), b = segredoNovo(); assert.match(a, /^[A-Za-z0-9_-]{22}$/); assert.equal(a.length, TAM_SEGREDO); assert.notEqual(a, b);
  const h = await hashSegredo(a); assert.match(h, /^[0-9a-f]{64}$/); assert.equal(await hashSegredo(a), h); assert.notEqual(await hashSegredo(b), h); assert.notEqual(h, a);
});
test("chave do grupo: vai e volta pelo endereço sem perder nada", () => {
  const l = chaveParaLink(GK); assert.equal(l.length, TAM_CHAVE); assert.doesNotMatch(l, /[+/=]/); assert.equal(chaveDoLink(l), GK);
});
test("link: monta e lê (endereço inteiro, só o # ou texto colado); recusa o que está torto", () => {
  const s = segredoNovo(), link = montarLink("https://x.github.io/lacre/", s, GK); assert.match(link, /^https:\/\/x\.github\.io\/lacre\/#convite=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(lerLink(link), { segredo: s, gk: GK }); assert.deepEqual(lerLink("#" + link.split("#")[1]), { segredo: s, gk: GK }); assert.deepEqual(lerLink(`olha: ${link} valeu`), { segredo: s, gk: GK });
  for (const ruim of [null, "", "https://x/#convite=curto.curto", `#convite=${s}`, `#convite=${s}.${"a".repeat(42)}`, `#convite=${"a".repeat(23)}.${"a".repeat(43)}`, "#outra=coisa"]) assert.equal(lerLink(ruim), null, String(ruim));
});
test("opções: padrões e ids desconhecidos voltam ao padrão; apelido limpo", () => {
  assert.equal(validadeDe("30d").horas, 720); assert.equal(validadeDe("x").id, "7d"); assert.equal(validadeDe("sem").horas, null); assert.equal(limiteDe("1").max, 1); assert.equal(limiteDe("?").id, "10"); assert.equal(limiteDe("sem").max, null);
  assert.equal(VALIDADES.length, 4); assert.equal(LIMITES.length, 3);
  assert.equal(limpaApelido("  Amigos   da escola "), "Amigos da escola"); assert.equal(limpaApelido(""), NOME_PADRAO); assert.equal(limpaApelido(null), NOME_PADRAO); assert.equal(limpaApelido("a".repeat(80)).length, 40);
});
test("limpaLinks e limpaPedidos: só aceitam o formato esperado", () => {
  const ok = { id: U1, nome: { c: "x", i: "y" }, criado_em: "2026-11-19T10:00:00Z", expira_em: null, max_usos: 10, usos: 4, aprovar: true, vale: true };
  const l = limpaLinks([ok, null, { ...ok, id: "x" }, { ...ok, nome: null }, { ...ok, id: U2, max_usos: null, usos: -3, aprovar: false }]);
  assert.equal(l.length, 2); assert.deepEqual([l[0].max, l[0].usos, l[0].aprovar, l[0].vale, l[0].expiraEm], [10, 4, true, true, null]); assert.deepEqual([l[1].max, l[1].usos, l[1].aprovar], [null, 0, false]); assert.deepEqual(limpaLinks("x"), []);
  const p = limpaPedidos([{ grupo_id: U1, user_id: U2, username: "carla", public_key: { kty: "EC" }, avatar: null, convite_id: U3, aprovar: false, vale: true, criado_em: "2026-11-19T10:00:00Z" }, { grupo_id: "x", user_id: U2, username: "a", public_key: {} }, { grupo_id: U1, user_id: U2, username: "a", public_key: null }]);
  assert.equal(p.length, 1); assert.deepEqual([p[0].grupo, p[0].user, p[0].username, p[0].aprovar, p[0].vale], [U1, U2, "carla", false, true]);
  assert.equal(pedidosPorGrupo([...p, { ...p[0], grupo: U3 }]).get(U1).length, 1);
  assert.equal(autoAceitar([{ aprovar: false, vale: true }, { aprovar: false, vale: false }, { aprovar: true, vale: true }]).length, 1, "só os que dispensam aprovação e ainda valem");
});
test("rotuloLink: validade, limite, quem entrou e estados parados", () => {
  const h = 3600000, agora = 1_000_000_000_000, base = { vale: true, expiraEm: null, max: null, usos: 0 };
  assert.equal(rotuloLink(base, agora), "sem fim · sem limite de pessoas");
  assert.equal(rotuloLink({ ...base, expiraEm: agora + 7 * 24 * h, max: 10, usos: 4 }, agora), "vale 7 dias · até 10 pessoas · 4 entraram");
  assert.equal(rotuloLink({ ...base, expiraEm: agora + 5 * h, max: 1, usos: 0 }, agora), "vale 5 h · até 1 pessoa");
  assert.equal(rotuloLink({ ...base, vale: false, max: 1, usos: 1 }, agora), "já usado · até 1 pessoa · 1 entrou");
  assert.equal(rotuloLink({ ...base, vale: false, expiraEm: agora - 1 }, agora).startsWith("vencido"), true);
  assert.equal(textoPedido("carla"), "@carla pediu para entrar pelo link");
});
test("erroConvite: frases claras", () => {
  assert.match(erroConvite({ message: "convite_invalido", code: "P0001" }), /não vale mais/); assert.match(erroConvite({ message: "grupo_cheio" }), /cheio/); assert.match(erroConvite({ message: "convites_demais" }), /10 links/);
  assert.match(erroConvite({ message: "so_admin" }), /administra/); assert.match(erroConvite({ status: 429 }), /Muitas tentativas/); assert.match(erroConvite(null), /conexão/);
});
