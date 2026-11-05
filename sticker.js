// Figurinhas animadas (GIF, WebP animado, APNG): remove metadados SEM recodificar, para não perder a animação.
// Funções puras (só bytes), por isso são testadas em Node. Figurinhas paradas passam pelo canvas, que descarta tudo.
export const MAX_ANIM_BYTES = 1_000_000, MAX_ANIM_SIDE = 1024;
const BAD = "Não consegui abrir essa figurinha animada. Use um GIF, WebP ou PNG animado válido.";
const fail = () => { throw new Error(BAD); };
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---------- PNG / APNG ----------
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "acTL", "fcTL", "fdAT"]); // o resto (texto, EXIF, data, perfil…) sai
function pngChunks(b) {
  if (b.length < 33 || PNG_SIG.some((v, i) => b[i] !== v)) fail();
  const out = []; let o = 8;
  while (o + 12 <= b.length) {
    const len = u32(b, o); if (len > b.length || o + 12 + len > b.length) fail();
    out.push({ type: tag(b, o + 4), start: o, end: o + 12 + len, len }); o += 12 + len;
    if (out[out.length - 1].type === "IEND") break;
  }
  if (!out.length || out[0].type !== "IHDR" || out[out.length - 1].type !== "IEND") fail();
  return out;
}
function infoPng(b) {
  const ch = pngChunks(b), ih = ch[0]; if (ih.len !== 13) fail();
  const idat = ch.findIndex((c) => c.type === "IDAT"), act = ch.findIndex((c) => c.type === "acTL");
  return { w: u32(b, ih.start + 8), h: u32(b, ih.start + 12), animado: act >= 0 && idat >= 0 && act < idat, ch };
}
function limpaPng(b) {
  const { ch } = infoPng(b);
  return concat([Uint8Array.from(PNG_SIG), ...ch.filter((c) => PNG_KEEP.has(c.type)).map((c) => b.subarray(c.start, c.end))]);
}

// ---------- GIF ----------
function gifWalk(b, onBlock) { // percorre os blocos; onBlock(tipo, ini, fim, info) decide o que fica
  if (b.length < 14 || !/^GIF8[79]a$/.test(tag(b, 0).slice(0, 4) + String.fromCharCode(b[4], b[5]))) fail();
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8); let o = 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 7) + 1) : 0);
  if (o > b.length) fail();
  const subs = (p) => { for (;;) { if (p >= b.length) fail(); const n = b[p]; p += 1 + n; if (!n) return p; } };
  let frames = 0;
  for (;;) {
    if (o >= b.length) fail(); const t = b[o];
    if (t === 0x3b) { onBlock("fim", o, o + 1); break; }
    if (t === 0x21) {
      const label = b[o + 1]; let id = "";
      if (label === 0xff) { const n = b[o + 2]; id = String.fromCharCode(...b.subarray(o + 3, o + 3 + n)); }
      const e = subs(o + 2); onBlock("ext", o, e, { label, id }); o = e;
    } else if (t === 0x2c) {
      if (o + 10 > b.length) fail(); let p = o + 10; if (b[o + 9] & 0x80) p += 3 * 2 ** ((b[o + 9] & 7) + 1);
      const e = subs(p + 1); frames++; onBlock("img", o, e); o = e;
    } else fail();
  }
  return { w, h, frames };
}
function limpaGif(b) {
  const parts = [b.subarray(0, 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 7) + 1) : 0))];
  gifWalk(b, (tipo, ini, fim, x) => {
    if (tipo === "ext") { // fica só o tempo dos quadros (0xF9) e o "repetir sempre" (NETSCAPE); comentários, XMP e texto saem
      const keep = x.label === 0xf9 || (x.label === 0xff && /^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(x.id));
      if (keep) parts.push(b.subarray(ini, fim));
    } else parts.push(b.subarray(ini, fim));
  });
  return concat(parts);
}
const infoGif = (b) => { const r = gifWalk(b, () => {}); return { w: r.w, h: r.h, animado: r.frames > 1 }; };

// ---------- WebP ----------
const WEBP_KEEP = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ANIM", "ANMF"]); // EXIF, XMP e perfil de cor (ICCP) saem
function webpChunks(b) {
  if (b.length < 20 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WEBP") fail();
  const total = Math.min(b.length, u32le(b, 4) + 8), out = []; let o = 12;
  while (o + 8 <= total) {
    const len = u32le(b, o + 4), fim = o + 8 + len + (len & 1); if (o + 8 + len > total) fail();
    out.push({ type: tag(b, o), start: o, end: Math.min(fim, total), len }); o = fim;
  }
  if (!out.length) fail(); return out;
}
function infoWebp(b) {
  const ch = webpChunks(b), x = ch.find((c) => c.type === "VP8X");
  if (!x || x.len < 10) return { w: 0, h: 0, animado: false };
  const d = x.start + 8;
  return { w: 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)), h: 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16)), animado: !!(b[d] & 2), ch };
}
function limpaWebp(b) {
  const ch = webpChunks(b), parts = [];
  for (const c of ch) {
    if (!WEBP_KEEP.has(c.type)) continue;
    const p = b.slice(c.start, c.end); if (c.type === "VP8X") p[8] &= ~(0x20 | 0x08 | 0x04); // desliga os avisos de "tem perfil/EXIF/XMP"
    if (p.length & 1) { const q = new Uint8Array(p.length + 1); q.set(p); parts.push(q); } else parts.push(p);
  }
  const body = concat(parts), head = new Uint8Array(12); head.set([82, 73, 70, 70]); head.set([87, 69, 66, 80], 8);
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return concat([head, body]);
}

// ---------- Interface ----------
// Descobre o formato pelos primeiros bytes (nunca pela extensão ou pelo tipo declarado) e diz se é animado.
export function detectar(b) {
  if (b.length > 12 && PNG_SIG.every((v, i) => b[i] === v)) return { tipo: "png", mime: "image/png", ...infoPng(b) };
  if (b.length > 12 && tag(b, 0).startsWith("GIF8")) return { tipo: "gif", mime: "image/gif", ...infoGif(b) };
  if (b.length > 20 && tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP") return { tipo: "webp", mime: "image/webp", ...infoWebp(b) };
  return null;
}
export function limparAnimada(b) {
  const d = detectar(b); if (!d || !d.animado) fail();
  if (b.length > MAX_ANIM_BYTES * 2) throw new Error("Figurinha animada grande demais. O limite é de 1 MB.");
  if (!d.w || !d.h || d.w > MAX_ANIM_SIDE || d.h > MAX_ANIM_SIDE) throw new Error(`Figurinha animada grande demais em largura/altura. O limite é de ${MAX_ANIM_SIDE} pixels.`);
  const out = d.tipo === "png" ? limpaPng(b) : d.tipo === "gif" ? limpaGif(b) : limpaWebp(b);
  if (out.length > MAX_ANIM_BYTES) throw new Error("Figurinha animada grande demais. O limite é de 1 MB.");
  return { bytes: out, mime: d.mime, w: d.w, h: d.h, anim: true };
}
