// Figurinhas: limpeza de animadas (GIF/WebP/APNG) sem recodificar e recorte por cliques.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectar, limparAnimada, MAX_ANIM_BYTES } from "../sticker.js";
import { regiao, criarRecorte, alfaSuave, finalizar } from "../cutout.js";
import { limpaCitacao, rotulo, resumo } from "../reply.js";

const B = (...p) => Buffer.concat(p.map((x) => (typeof x === "string" ? Buffer.from(x, "latin1") : Buffer.from(x))));
const has = (buf, txt) => Buffer.from(buf).includes(Buffer.from(txt));

// ---- GIF com 2 quadros, comentário e XMP escondidos ----
const sub = (s) => B([s.length], s, [0]);
const gif = (extras = true) => B("GIF89a", [2, 0, 2, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255],
  extras ? B([0x21, 0xfe], sub("SEGREDO-GPS-23.55"), [0x21, 0xff, 11], "XMP DataXMP", sub("<x>SEGREDO-XMP</x>")) : [],
  [0x21, 0xff, 11], "NETSCAPE2.0", [3, 1, 0, 0, 0],
  [0x21, 0xf9, 4, 0, 10, 0, 0, 0], [0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0], [2, 2, 0x44, 0x01, 0],
  [0x21, 0xf9, 4, 0, 10, 0, 0, 0], [0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0], [2, 2, 0x44, 0x01, 0], [0x3b]);
describe("GIF animado", () => {
  test("detecta formato e animação pelos bytes", () => { const d = detectar(gif()); assert.equal(d.tipo, "gif"); assert.equal(d.animado, true); assert.equal(d.w, 2); });
  test("remove comentário e XMP, mantém quadros, tempos e repetição", () => {
    const o = limparAnimada(gif()); assert.ok(!has(o.bytes, "SEGREDO")); assert.ok(has(o.bytes, "NETSCAPE2.0"));
    assert.deepEqual(detectar(o.bytes).animado, true); assert.equal(o.bytes.filter((v) => v === 0x2c).length >= 2, true); assert.equal(o.mime, "image/gif");
    assert.deepEqual([...limparAnimada(gif(false)).bytes], [...gif(false)], "sem extras nada muda");
  });
  test("GIF de um quadro só não é animado; lixo é recusado", () => {
    const um = gif(false).subarray(0, 0); void um;
    assert.throws(() => limparAnimada(B("GIF89a", [1, 2, 3])), /animada/);
    assert.throws(() => limparAnimada(B("GIF89a", [2, 0, 2, 0, 0, 0, 0], [0x99, 0, 0])), /animada/);
  });
});

// ---- WebP animado (cargas falsas: o parser só mexe nos contêineres) ----
const le = (n, b = 4) => { const x = Buffer.alloc(b); x.writeUIntLE(n, 0, b); return x; };
const ch = (t, d) => B(t, le(d.length), d, d.length & 1 ? [0] : []);
const webp = (flags = 0x02 | 0x08 | 0x04 | 0x20) => { const body = B("WEBP", ch("VP8X", B([flags, 0, 0, 0], le(99, 3), le(49, 3))), ch("ICCP", B("SEGREDO-ICC")), ch("ANIM", B([0, 0, 0, 0, 0, 0])), ch("ANMF", B(le(0, 3), le(0, 3), le(99, 3), le(49, 3), le(40, 3), [0], "frame-data-x")), ch("EXIF", B("SEGREDO-EXIF")), ch("XMP ", B("SEGREDO-XMP"))); return B("RIFF", le(body.length), body); };
describe("WebP animado", () => {
  test("detecta, remove EXIF/XMP/ICC, limpa os avisos do VP8X e acerta o tamanho", () => {
    const d = detectar(webp()); assert.equal(d.tipo, "webp"); assert.equal(d.animado, true); assert.deepEqual([d.w, d.h], [100, 50]);
    const o = limparAnimada(webp()); assert.ok(!has(o.bytes, "SEGREDO")); assert.ok(has(o.bytes, "frame-data-x"));
    assert.equal(o.bytes.readUInt32LE?.(4) ?? Buffer.from(o.bytes).readUInt32LE(4), o.bytes.length - 8);
    assert.equal(o.bytes[20] & (0x20 | 0x08 | 0x04), 0); assert.equal(o.bytes[20] & 0x02, 0x02);
  });
  test("WebP parado não é tratado como animado", () => { assert.equal(detectar(webp(0x10)).animado, false); assert.throws(() => limparAnimada(webp(0x10)), /animada/); });
  test("tamanho de contêiner mentiroso é recusado", () => { const w = Buffer.from(webp()); w.writeUInt32LE(0xfffffff0, 16 + 4 * 0 + 0); assert.throws(() => limparAnimada(w.subarray(0, 40)), /animada|WebP|/); });
});

// ---- APNG ----
const pc = (t, d) => B(le(d.length).reverse(), t, d, [0, 0, 0, 0]);
const sig = [137, 80, 78, 71, 13, 10, 26, 10];
const png = (anim) => B(sig, pc("IHDR", B([0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0, 0, 0])), pc("tEXt", B("Author\0SEGREDO-PNG")), pc("eXIf", B("SEGREDO-EXIF")), anim ? pc("acTL", B([0, 0, 0, 2, 0, 0, 0, 0])) : [], anim ? pc("fcTL", B(new Uint8Array(26))) : [], pc("IDAT", B("dados")), anim ? pc("fdAT", B("mais")) : [], pc("IEND", []));
describe("APNG", () => {
  test("detecta animação, mantém quadros e tira texto/EXIF", () => {
    assert.equal(detectar(png(true)).animado, true); assert.equal(detectar(png(false)).animado, false);
    const o = limparAnimada(png(true)); assert.ok(!has(o.bytes, "SEGREDO")); assert.ok(has(o.bytes, "fdAT")); assert.ok(has(o.bytes, "acTL")); assert.equal(detectar(o.bytes).animado, true);
  });
  test("PNG parado é recusado aqui (vai pelo canvas)", () => assert.throws(() => limparAnimada(png(false)), /animada/));
  test("limites: lado grande demais e arquivo grande demais", () => {
    const grande = B(sig, pc("IHDR", B([0, 0, 8, 0, 0, 0, 0, 3, 8, 6, 0, 0, 0])), pc("acTL", B([0, 0, 0, 2, 0, 0, 0, 0])), pc("IDAT", B("x")), pc("IEND", []));
    assert.throws(() => limparAnimada(grande), /pixels/);
    assert.throws(() => limparAnimada(B(png(true), Buffer.alloc(MAX_ANIM_BYTES * 2))), /1 MB/);
  });
  test("formato desconhecido", () => assert.equal(detectar(B("nada a ver com imagem")), null));
});

// ---- Recorte por cliques ----
// imagem 20x10: fundo azul; "boneco" vermelho no meio (x 6..13, y 2..7); pele clara dentro do boneco (x 9..10, y 3..4)
function cena() {
  const W = 20, H = 10, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = [30, 60, 200]; if (x >= 6 && x <= 13 && y >= 2 && y <= 7) c = [200, 30, 30]; if (x >= 9 && x <= 10 && y >= 3 && y <= 4) c = [240, 200, 170];
    data.set([...c, 255], (y * W + x) * 4);
  }
  return { data, width: W, height: H };
}
describe("recorte por cliques", () => {
  test("um toque no boneco pega só a região de cor parecida, não o fundo", () => {
    const r = regiao(cena(), 7, 5, 30); assert.equal(r.length, 8 * 6 - 4); assert.ok(!r.includes(0));
  });
  test("tolerância maior engole as cores vizinhas parecidas; fora do limite não mexe", () => {
    assert.equal(regiao(cena(), -1, 0, 30).length, 0);
    assert.ok(regiao(cena(), 7, 5, 100).length >= 8 * 6 - 4);
  });
  test("manter soma regiões; desfazer volta passo a passo; recomeçar zera", () => {
    const rc = criarRecorte(cena()); assert.equal(rc.mantidos(), 0);
    rc.manter(7, 5, 30); const a = rc.mantidos(); assert.equal(a, 44);
    rc.manter(9, 3, 30); assert.equal(rc.mantidos(), 48); assert.equal(rc.passos(), 2);
    assert.equal(rc.manter(9, 3, 30), 0, "tocar de novo no que já está mantido não cria passo"); assert.equal(rc.passos(), 2);
    assert.ok(rc.desfazer()); assert.equal(rc.mantidos(), 44); assert.ok(rc.desfazer()); assert.equal(rc.mantidos(), 0); assert.equal(rc.desfazer(), false);
    rc.manter(7, 5, 30); rc.recomecar(); assert.equal(rc.mantidos(), 0); assert.equal(rc.passos(), 0);
  });
  test("apagar tira só o que estava mantido e também se desfaz", () => {
    const rc = criarRecorte(cena()); rc.manter(7, 5, 30); rc.manter(9, 3, 30); const antes = rc.mantidos();
    rc.apagar(9, 3, 30); assert.equal(rc.mantidos(), antes - 4); assert.equal(rc.apagar(0, 0, 30), 0, "o fundo não estava mantido");
    rc.desfazer(); assert.equal(rc.mantidos(), antes);
  });
  test("finalizar corta na caixa do que foi mantido e deixa o resto transparente", () => {
    const img = cena(), rc = criarRecorte(img); rc.manter(7, 5, 30); rc.manter(9, 3, 30);
    const o = finalizar(img, rc.keep, { margem: 1 }); assert.ok(o.width <= 8 + 2 && o.width >= 8 && o.height >= 6 && o.height <= 8, `${o.width}x${o.height}`);
    const mid = (Math.floor(o.height / 2) * o.width + Math.floor(o.width / 2)) * 4; assert.equal(o.data[mid + 3], 255, "centro opaco");
    assert.equal(o.data[3], 0, "canto transparente");
    assert.equal(finalizar(img, new Uint8Array(200)), null, "nada mantido = sem figurinha");
  });
  test("alfa suave: interior 255, longe 0, borda intermediária", () => {
    const rc = criarRecorte(cena()); rc.manter(7, 5, 30); const a = alfaSuave(rc.keep, 20, 10);
    assert.equal(a[5 * 20 + 9], 255); assert.equal(a[0], 0); assert.ok(a.some((v) => v > 0 && v < 255));
  });
  test("pixel já transparente na origem não é pego", () => {
    const img = cena(); for (let x = 0; x < 20; x++) img.data[x * 4 + 3] = 0; assert.equal(regiao(img, 5, 0, 100).length, 0);
  });
});

// ---- Citar figurinha ----
describe("responder a figurinha", () => {
  test("vira um tipo próprio, com rótulo e validação", () => {
    assert.equal(resumo({ type: "media", kind: "sticker" }).kind, "sticker");
    assert.equal(rotulo({ kind: "sticker", text: "", dur: 0 }), "Figurinha");
    assert.equal(limpaCitacao({ id: 3, kind: "sticker" }).kind, "sticker");
    assert.equal(limpaCitacao({ id: 3, kind: "hack" }).kind, "text");
  });
});
