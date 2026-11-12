import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PALETA, corValida, nomeDaCor, estilosDaCor, primeiraLivre, corMaisDiferente, distanciaMinima, deltaE } from "../cores.js";

const TODAS = PALETA.map((p) => p.id);
describe("cores das pessoas no grupo", () => {
  test("são 10 cores prontas, todas diferentes entre si, com fundo claro, escuro e nome", () => {
    assert.equal(PALETA.length, 10); assert.equal(new Set(PALETA.map((p) => p.id)).size, 10); assert.equal(new Set(PALETA.map((p) => p.claro.forte)).size, 10); assert.equal(new Set(PALETA.map((p) => p.nome)).size, 10);
    for (const p of PALETA) for (const m of ["claro", "escuro"]) for (const k of ["bg", "bd", "nome", "forte"]) assert.match(p[m][k], /^#[0-9a-f]{6}$/i, p.id + m + k);
  });
  test("o formato aceito é o mesmo do banco: p0..p9 ou #rrggbb minúsculo", () => {
    for (const c of ["p0", "p9", "#a1b2c3", "#000000"]) assert.ok(corValida(c), c);
    for (const c of ["p10", "p", "P1", "#ABCDEF", "#abc", "#12345g", "red", "", null, undefined, 5, {}, "#a1b2c3 ", "javascript:1"]) assert.ok(!corValida(c), String(c));
  });
  test("nomes: pronta tem o nome, hexadecimal é 'Cor aleatória', o resto é 'Sem cor'", () => { assert.equal(nomeDaCor("p4"), "Lilás"); assert.equal(nomeDaCor("#a1b2c3"), "Cor aleatória"); assert.equal(nomeDaCor(null), "Sem cor"); assert.equal(nomeDaCor("lixo"), "Sem cor"); });
  test("estilo de cor pronta vem da tabela; de cor inválida é null", () => {
    assert.equal(estilosDaCor("p0").claro.bg, "#FDE3EA"); assert.equal(estilosDaCor("p9").escuro.nome, "#B6BBD6"); for (const c of [null, "", "x", "#ABC", 3]) assert.equal(estilosDaCor(c), null);
  });
  test("cor aleatória: o estilo mantém a luminosidade fixa, então o texto continua legível mesmo com uma cor ruim (preto, branco, cinza)", () => {
    for (const c of ["#000000", "#ffffff", "#808080", "#ffff00", "#0000ff", "#fefefe"]) {
      const s = estilosDaCor(c); for (const m of ["claro", "escuro"]) for (const k of ["bg", "bd", "nome", "forte"]) assert.match(s[m][k], /^#[0-9a-f]{6}$/);
      const L = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
      const contraste = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      assert.ok(contraste(s.claro.bg, "#15174A") >= 7, `texto escuro sobre o fundo claro de ${c}`); assert.ok(contraste(s.escuro.bg, "#E9ECF8") >= 7, `texto claro sobre o fundo escuro de ${c}`);
      assert.ok(contraste(s.claro.nome, s.claro.bg) >= 4.5, `nome legível (claro) ${c}`); assert.ok(contraste(s.escuro.nome, s.escuro.bg) >= 4.5, `nome legível (escuro) ${c}`);
    }
  });
  test("as cores prontas também têm texto legível nos dois modos", () => {
    const L = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
    const c = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const p of PALETA) { assert.ok(c(p.claro.bg, "#15174A") >= 7, p.id); assert.ok(c(p.escuro.bg, "#E9ECF8") >= 7, p.id); assert.ok(c(p.claro.nome, p.claro.bg) >= 4.5, p.id + " nome claro"); assert.ok(c(p.escuro.nome, p.escuro.bg) >= 4.5, p.id + " nome escuro"); }
  });
});
describe("escolher cor", () => {
  test("a primeira cor pronta livre, na ordem; null quando as 10 estão em uso", () => {
    assert.equal(primeiraLivre([]), "p0"); assert.equal(primeiraLivre(["p0", "p1"]), "p2"); assert.equal(primeiraLivre(["p1", "p2"]), "p0"); assert.equal(primeiraLivre(["#aabbcc", "p0"]), "p1", "cor aleatória de alguém não ocupa uma pronta");
    assert.equal(primeiraLivre(TODAS), null); assert.equal(primeiraLivre([...TODAS.slice(0, 9)]), "p9");
  });
  test("a cor aleatória nunca é uma já usada, é válida e fica longe das outras", () => {
    const c = corMaisDiferente(TODAS); assert.ok(corValida(c) && c[0] === "#", c); assert.ok(!TODAS.includes(c));
    assert.ok(distanciaMinima(c, TODAS) >= 12, "bem diferente de todas as 10 prontas: " + distanciaMinima(c, TODAS));
    for (const p of PALETA) assert.ok(distanciaMinima(c, TODAS) >= 12);
  });
  test("é a MELHOR entre as candidatas: nenhuma cor de uma varredura fica mais longe das usadas", () => {
    const hsl = (h, sat, l) => { const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2, [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join(""); };
    for (const usadas of [["p0", "p1", "p3", "p6"], TODAS, ["p2"], ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "#2a7fb5"]]) {
      const c = corMaisDiferente(usadas), d = distanciaMinima(c, usadas);
      for (let h = 0; h < 360; h += 5) for (const sat of [0.6, 0.85]) for (const l of [0.34, 0.44]) assert.ok(d >= distanciaMinima(hsl(h, sat, l), usadas) - 1e-6 || usadas.includes(hsl(h, sat, l)), `${usadas.length} usadas: ${c} (${d.toFixed(1)}) perdeu para ${hsl(h, sat, l)}`);
    }
    assert.ok(distanciaMinima(corMaisDiferente(["p0", "p1", "p3", "p6"]), ["p0", "p1", "p3", "p6"]) > 20, "com poucas usadas dá para ficar bem longe");
  });
  test("cada nova aleatória é diferente da anterior (sucessivas: nunca repete e continua longe)", () => {
    let usadas = [...TODAS]; const vistas = new Set();
    for (let i = 0; i < 6; i++) { const c = corMaisDiferente(usadas); assert.ok(corValida(c)); assert.ok(!usadas.includes(c) && !vistas.has(c), "repetiu " + c); vistas.add(c); usadas = [...usadas, c]; }
  });
  test("sem ninguém usando, devolve uma cor válida; lixo na lista é ignorado; não quebra com lista nula", () => {
    assert.ok(corValida(corMaisDiferente([]))); assert.ok(corValida(corMaisDiferente(null))); assert.ok(corValida(corMaisDiferente([null, "x", 5, "#ZZZZZZ", "p1"])));
  });
  test("distância de cor: 0 para a mesma, positiva para diferentes", () => { assert.equal(deltaE([1, 2, 3], [1, 2, 3]), 0); assert.ok(deltaE([0, 0, 0], [3, 4, 0]) === 5); assert.equal(distanciaMinima("p0", ["p0"]), 0); assert.ok(distanciaMinima("p0", ["p1"]) > 20); assert.equal(distanciaMinima("p0", []), Infinity); });
});
