import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { limparSnapshot, lerSnapshot, textoDoSnapshot, SNAP_MAX } from "../snapshot.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mini = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const base = { v: 1, eu: { u: "@ana", a: "ana/1.webp", th: mini }, ponto: { ap: true, mfa: false }, itens: [{ id: id(1), g: false, n: "@bia", a: "bia/2.webp", th: mini, t: 1700000000000, nl: 3 }, { id: id(2), g: true, n: "Grupo", m: 5, a: null, th: null, t: 1700000001000, nl: 0 }] };

describe("foto da tela inicial", () => {
  test("o que está certo passa inteiro, na mesma ordem", () => {
    const s = limparSnapshot(base);
    assert.deepEqual(s.itens.map((x) => x.id), [id(1), id(2)]); assert.equal(s.itens[0].th, mini); assert.equal(s.itens[1].m, 5); assert.equal(s.itens[0].nl, 3);
    assert.deepEqual(s.ponto, { ap: true, mfa: false }); assert.equal(s.eu.u, "@ana"); assert.equal(s.eu.th, mini);
  });
  test("forma errada vira nada (e nunca quebra)", () => {
    for (const x of [null, undefined, 5, "x", [], {}, { v: 2, eu: {}, itens: [] }, { v: 1, eu: null, itens: [] }, { v: 1, eu: {}, itens: "a" }]) assert.equal(limparSnapshot(x), null);
    assert.equal(lerSnapshot("{lixo"), null); assert.equal(lerSnapshot(null), null); assert.equal(lerSnapshot("x".repeat(700000)), null);
  });
  test("itens com id que não é identificador, sem nome ou de outro tipo são ignorados", () => {
    const s = limparSnapshot({ ...base, itens: [{ id: "../x", n: "a" }, { id: id(3), n: "" }, { id: id(4), n: "ok" }, null, 7, { id: 5, n: "a" }] });
    assert.deepEqual(s.itens.map((x) => x.id), [id(4)]);
  });
  test("miniatura só vale se for imagem em data: pequena; senão some (nunca vira endereço de rede)", () => {
    for (const th of ["https://x.com/a.png", "javascript:alert(1)", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:image/jpeg;base64," + "A".repeat(13000), 7, {}]) {
      const s = limparSnapshot({ ...base, itens: [{ id: id(1), n: "a", th }] }); assert.equal(s.itens[0].th, null, String(th).slice(0, 30));
    }
  });
  test("números são limitados e textos cortados, sem caracteres de controle", () => {
    const s = limparSnapshot({ ...base, itens: [{ id: id(1), g: true, n: "a\u0000b".repeat(50), m: 99999, t: -5, nl: 99999 }] });
    assert.ok(s.itens[0].n.length <= 60); assert.ok(!/[\u0000-\u001f]/.test(s.itens[0].n)); assert.equal(s.itens[0].m, 1000); assert.equal(s.itens[0].t, 0); assert.equal(s.itens[0].nl, 100);
  });
  test("no máximo SNAP_MAX conversas", () => {
    const itens = Array.from({ length: SNAP_MAX + 20 }, (_, i) => ({ id: id(i + 1), n: "x" + i })); assert.equal(limparSnapshot({ ...base, itens }).itens.length, SNAP_MAX);
  });
  test("o texto guardado volta igual ao ler; se passa do espaço, solta as miniaturas e guarda o resto", () => {
    const t = textoDoSnapshot(base); assert.deepEqual(lerSnapshot(t), limparSnapshot(base));
    const grande = { ...base, itens: Array.from({ length: SNAP_MAX }, (_, i) => ({ id: id(i + 1), n: "x" + i, th: "data:image/jpeg;base64," + "A".repeat(11000) })) };
    const t2 = textoDoSnapshot(grande, 100000); const s2 = lerSnapshot(t2); assert.equal(s2.itens.length, SNAP_MAX); assert.ok(s2.itens.every((x) => x.th === null)); assert.equal(textoDoSnapshot(grande, 10), null);
  });
  test("o que não é do formato (campos extras como script ou html) não chega ao resultado", () => {
    const s = limparSnapshot({ ...base, itens: [{ id: id(1), n: "a", html: "<img onerror=x>", __proto__: { x: 1 } }], extra: "<script>" }); assert.deepEqual(Object.keys(s.itens[0]).sort(), ["a", "g", "id", "m", "n", "nl", "t", "th"]); assert.equal(s.extra, undefined);
  });
});
