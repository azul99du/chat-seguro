// Recorte por cliques: a pessoa toca nas partes que quer MANTER; o resto vira transparente.
// Cada toque cresce uma região de cores parecidas (varinha mágica) e entra num histórico que pode ser desfeito.
// Funções puras sobre { data: RGBA, width, height }, por isso são testadas em Node.
const dist = (d, i, r, g, b) => { const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b; return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.9); };

// Índices dos pixels ligados ao ponto tocado, com cor parecida (tol 1..100) e sem atravessar bordas fortes.
export function regiao(img, x, y, tol) {
  const { data: d, width: W, height: H } = img; x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return new Int32Array(0);
  const c0 = (y * W + x) * 4; if (d[c0 + 3] < 128) return new Int32Array(0); // tocou numa parte que já é transparente
  const T0 = Math.max(1, Math.min(100, tol)) * 2.2;
  let r = 0, g = 0, b = 0, n = 0; // cor de referência: média dos vizinhos parecidos com o ponto tocado (aguenta ruído e JPEG sem borrar detalhes pequenos)
  for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) { const p = (j * W + i) * 4; if (d[p + 3] >= 128 && dist(d, p, d[c0], d[c0 + 1], d[c0 + 2]) <= T0 * 0.3) { r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; } }
  r /= n; g /= n; b /= n;
  const T = T0, step = T * 0.55; // cor contra a referência / contra o vizinho
  const seen = new Uint8Array(W * H), fila = new Int32Array(W * H), out = []; let ini = 0, fim = 0;
  const s = y * W + x; seen[s] = 1; fila[fim++] = s;
  while (ini < fim) {
    const p = fila[ini++]; out.push(p); const px = p % W, py = (p / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = px + (k === 0) - (k === 1), ny = py + (k === 2) - (k === 3);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx; if (seen[q]) continue; seen[q] = 1;
      const qi = q * 4; if (d[qi + 3] < 128) continue;
      if (dist(d, qi, r, g, b) > T) continue;
      if (dist(d, qi, d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) > step) continue;
      fila[fim++] = q;
    }
  }
  return Int32Array.from(out);
}

export function criarRecorte(img) {
  const { width: W, height: H } = img, keep = new Uint8Array(W * H), hist = [];
  const aplica = (idx, v) => { const mudou = []; for (const p of idx) if (keep[p] !== v) { keep[p] = v; mudou.push(p); } return Int32Array.from(mudou); };
  return {
    width: W, height: H, keep,
    manter(x, y, tol) { const m = aplica(regiao(img, x, y, tol), 1); if (m.length) hist.push({ v: 1, m }); return m.length; },
    apagar(x, y, tol) { const idx = regiao(img, x, y, tol).filter((p) => keep[p]); const m = aplica(idx, 0); if (m.length) hist.push({ v: 0, m }); return m.length; },
    desfazer() { const h = hist.pop(); if (!h) return false; for (const p of h.m) keep[p] = h.v ? 0 : 1; return true; },
    recomecar() { keep.fill(0); hist.length = 0; },
    passos: () => hist.length,
    mantidos: () => { let n = 0; for (let i = 0; i < keep.length; i++) n += keep[i]; return n; },
  };
}

// Bordas sem serrilhado: suaviza a máscara e recua ~1 pixel, para não sobrar fiapo da cor do fundo.
export function alfaSuave(keep, W, H) {
  const a = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) s += keep[yy * W + xx]; }
    a[y * W + x] = Math.max(0, Math.min(255, ((s / 9 - 0.55) * 3.5 + 0.5) * 255));
  }
  return a;
}

// Aplica a máscara e corta na menor caixa que contém o que foi mantido. Devolve null se nada foi mantido.
export function finalizar(img, keep, { margem = 2 } = {}) {
  const { data: d, width: W, height: H } = img, alfa = alfaSuave(keep, W, H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alfa[y * W + x] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - margem); y0 = Math.max(0, y0 - margem); x1 = Math.min(W - 1, x1 + margem); y1 = Math.min(H - 1, y1 + margem);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y + y0) * W + x + x0, o = (y * w + x) * 4;
    out[o] = d[s * 4]; out[o + 1] = d[s * 4 + 1]; out[o + 2] = d[s * 4 + 2]; out[o + 3] = Math.round(alfa[s] * d[s * 4 + 3] / 255);
  }
  return { data: out, width: w, height: h };
}
