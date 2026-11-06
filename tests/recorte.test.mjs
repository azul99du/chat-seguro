// Acabamento do recorte de figurinhas (porte do notebook recortador_figurinhas_sam2): máscara, rampa, miolo opaco, contorno.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { escolherMascara, rampa, ampliarLogits, gauss, distancia2, dilatar, erodir, preencherBuracos, reamostrar, montarFigurinha, sigmoide } from "../recorte.js";

const CFG = { TAMANHO: 128, MARGEM_PX: 4, CONTORNO_PX: 6, MIOLO_PX: 2, BURACO_MAX: 0.15, SUAVIZAR: 1, COR_R: 255, COR_G: 255, COR_B: 255 };

describe("escolha da máscara do SAM", () => {
  const M = 4, lg = new Float32Array(3 * M * M); // 3 máscaras: áreas 2, 8, 16
  for (let i = 0; i < 2; i++) lg[i] = 1; for (let i = 0; i < 8; i++) lg[M * M + i] = 1; for (let i = 0; i < 16; i++) lg[2 * M * M + i] = 1;
  test("a MAIOR entre as de nota >= mínimo", () => { const m = escolherMascara([0.9, 0.7, 0.95], lg, M, 0.6); assert.equal(m.filter((v) => v > 0).length, 16); });
  test("a maior com nota boa, não a maior de todas", () => { const m = escolherMascara([0.9, 0.7, 0.3], lg, M, 0.6); assert.equal(m.filter((v) => v > 0).length, 8); });
  test("se nenhuma passar, a de maior nota", () => { const m = escolherMascara([0.2, 0.5, 0.1], lg, M, 0.6); assert.equal(m.filter((v) => v > 0).length, 8); });
});
describe("rampa de borda e sigmoide", () => {
  test("<= mínimo = 0, > máximo = 1, no meio sobe aos poucos", () => {
    const r = rampa(Float32Array.from([0, 0.35, 0.5, 0.9, 0.95, 1]), 0.35, 0.9);
    assert.equal(r[0], 0); assert.equal(r[1], 0); assert.ok(Math.abs(r[2] - (0.5 - 0.35) / 0.65) < 1e-6); assert.ok(r[3] > 0.84 && r[3] < 0.86, "no máximo exato ainda é rampa"); assert.equal(r[4], 1); assert.equal(r[5], 1);
  });
  test("sigmoide limita valores extremos", () => { assert.equal(sigmoide(0), 0.5); assert.ok(sigmoide(1000) <= 1 && sigmoide(-1000) >= 0); });
  test("ampliar logits: tamanho certo e valor constante vira a sigmoide", () => { const o = ampliarLogits(new Float32Array(16).fill(2), 4, 10, 7); assert.equal(o.length, 70); assert.ok(Math.abs(o[33] - sigmoide(2)) < 1e-6); });
});
describe("desfoque, distância e morfologia", () => {
  test("gauss mantém plano constante e soma de um ponto", () => {
    assert.ok(gauss(new Float32Array(100).fill(0.4), 10, 10, 1).every((v) => Math.abs(v - 0.4) < 1e-5));
    const a = new Float32Array(400); a[10 * 20 + 10] = 1; const g = gauss(a, 20, 20, 1.5); assert.ok(Math.abs(g.reduce((x, y) => x + y, 0) - 1) < 1e-4); assert.ok(g[210] < 1 && g[210] > g[211]);
    assert.deepEqual([...gauss(Float32Array.from([1, 0]), 2, 1, 0)], [1, 0], "sigma 0 = sem desfoque");
  });
  test("distância euclidiana confere com força bruta", () => {
    const W = 13, H = 9, b = new Uint8Array(W * H); for (const [x, y] of [[2, 2], [10, 6], [6, 0]]) b[y * W + x] = 1;
    const d = distancia2(b, W, H, 1); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = Infinity; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (b[j * W + i]) m = Math.min(m, (x - i) ** 2 + (y - j) ** 2); assert.equal(d[y * W + x], m, `${x},${y}`); }
  });
  test("dilatar e erodir com disco de raio r", () => {
    const W = 21, H = 21, b = new Uint8Array(W * H); b[10 * W + 10] = 1;
    const d = dilatar(b, W, H, 3); assert.equal(d[10 * W + 13], 1); assert.equal(d[10 * W + 14], 0); assert.equal(d[13 * W + 13], 0, "diagonal fora do círculo"); assert.equal(d.reduce((a, v) => a + v, 0), 29, "disco de raio 3");
    const q = new Uint8Array(W * H); for (let y = 4; y <= 16; y++) for (let x = 4; x <= 16; x++) q[y * W + x] = 1;
    const e = erodir(q, W, H, 2); assert.equal(e[10 * W + 10], 1); assert.equal(e[4 * W + 10], 0); assert.equal(e[6 * W + 10], 1); assert.equal(e[5 * W + 10], 0);
    assert.ok(erodir(new Uint8Array(25).fill(1), 5, 5, 2).every((v) => v === 1), "tudo preenchido não erode (borda da imagem não conta)");
  });
});
describe("buracos", () => {
  const anel = (W, H, buraco) => { const s = new Uint8Array(W * H); for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) s[y * W + x] = 1; for (const [x, y] of buraco) s[y * W + x] = 0; return s; };
  test("buraco pequeno e cercado é preenchido", () => { const s = anel(20, 20, [[10, 10], [11, 10]]); const o = preencherBuracos(s, 20, 20, 0.15); assert.equal(o[10 * 20 + 10], 1); assert.equal(o[10 * 20 + 11], 1); });
  test("buraco grande demais fica", () => { const b = []; for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) b.push([x, y]); const o = preencherBuracos(anel(20, 20, b), 20, 20, 0.15); assert.equal(o[10 * 20 + 10], 0); });
  test("fundo ligado à borda da imagem nunca é buraco", () => { const o = preencherBuracos(anel(20, 20, []), 20, 20, 0.99); assert.equal(o[0], 0); assert.equal(o[1 * 20 + 1], 0); });
});
describe("reamostrar", () => {
  test("reduzir faz a média por área e ampliar interpola", () => {
    assert.deepEqual([...reamostrar(Float32Array.from([0, 2, 4, 6]), 4, 1, 1, 2, 1)], [1, 5]);
    const a = reamostrar(Float32Array.from([0, 10]), 2, 1, 1, 4, 1); assert.ok(a[0] === 0 && a[3] === 10 && a[1] > 0 && a[1] < a[2]);
    assert.ok(reamostrar(new Float32Array(30 * 20 * 3).fill(7), 30, 20, 3, 11, 5).every((v) => Math.abs(v - 7) < 1e-4));
  });
});
describe("montar a figurinha", () => {
  const W = 200, H = 120, rgba = new Uint8ClampedArray(W * H * 4), alfa = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; rgba.set([30, 140, 60, 255], i * 4); if ((x - 100) ** 2 + (y - 60) ** 2 < 45 * 45) alfa[i] = 1; }
  for (let y = 55; y < 65; y++) for (let x = 95; x < 105; x++) alfa[y * W + x] = 0; // furo no meio (a IA ficou em dúvida)
  const px = (f, x, y) => [...f.data.slice((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)];
  test("sai TAMANHO x TAMANHO, objeto centralizado, furo fechado e canto transparente", () => {
    const f = montarFigurinha(rgba, W, H, alfa, CFG); assert.equal(f.width, 128); assert.equal(f.height, 128);
    assert.deepEqual(px(f, 64, 64), [30, 140, 60, 255], "furo do miolo ficou opaco, com a cor da foto"); assert.equal(px(f, 0, 0)[3], 0);
    assert.ok(px(f, 64, 12)[3] > 0, "o objeto (e o contorno) quase toca a margem"); assert.ok(px(f, 4, 4)[3] === 0);
  });
  test("contorno branco fora do objeto; sem contorno não há branco", () => {
    const f = montarFigurinha(rgba, W, H, alfa, CFG); let branco = 0, fora = 0;
    for (let x = 0; x < 128; x++) { const p = px(f, x, 64); if (p[3] === 255 && p[0] > 240 && p[1] > 240 && p[2] > 240) branco++; if (p[3] > 0 && p[3] < 255) fora++; }
    assert.ok(branco >= 4, `faixa branca opaca de ~6 px (achei ${branco})`);
    const g = montarFigurinha(rgba, W, H, alfa, { ...CFG, CONTORNO_PX: 0 }); let b2 = 0; for (let x = 0; x < 128; x++) { const p = px(g, x, 64); if (p[3] === 255 && p[0] > 240 && p[1] > 240) b2++; } assert.equal(b2, 0);
    assert.ok(fora >= 1, "borda suave");
  });
  test("cor do contorno configurável", () => {
    const f = montarFigurinha(rgba, W, H, alfa, { ...CFG, COR_R: 255, COR_G: 0, COR_B: 0 }); let verm = 0; for (let x = 0; x < 128; x++) { const p = px(f, x, 64); if (p[3] === 255 && p[0] > 240 && p[1] < 20) verm++; } assert.ok(verm >= 4);
  });
  test("nada mantido = sem figurinha", () => assert.equal(montarFigurinha(rgba, W, H, new Float32Array(W * H), CFG), null));
});
