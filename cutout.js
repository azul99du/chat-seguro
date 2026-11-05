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
  const { width: W, height: H, data: d } = img, keep = new Uint8Array(W * H), hist = [];
  let traco = null; // pincelada em andamento: índice -> valor anterior
  // toda alteração guarda o valor ANTERIOR dos pixels mexidos; desfazer é só devolver esses valores
  const muda = (idx, v, reg) => { for (const p of idx) if (keep[p] !== v) { if (!reg.has(p)) reg.set(p, keep[p]); keep[p] = v; } };
  const empurra = (reg) => { if (!reg.size) return 0; hist.push(reg); return reg.size; };
  return {
    width: W, height: H, keep,
    manter(x, y, tol) { const r = new Map(); muda(regiao(img, x, y, tol), 1, r); return empurra(r); },
    apagar(x, y, tol) { const r = new Map(); muda(regiao(img, x, y, tol).filter((p) => keep[p]), 0, r); return empurra(r); },
    // recorte automático do fundo: tudo que encosta nas bordas e tem cor parecida com elas sai; o que sobra é o assunto
    fundo(tol) {
      const r = new Map(), cand = new Uint8Array(W * H), passo = Math.max(4, Math.round(Math.max(W, H) / 60));
      for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] >= 128) cand[i] = 1;
      muda(cand.reduce((a, v, i) => (v ? (a.push(i), a) : a), []), 1, r);
      const semente = (x, y) => muda(regiao(img, x, y, tol), 0, r);
      for (let x = 0; x < W; x += passo) { semente(x, 0); semente(x, H - 1); }
      for (let y = 0; y < H; y += passo) { semente(0, y); semente(W - 1, y); }
      return empurra(r);
    },
    // pincel: v=1 mantém, v=0 apaga, dentro de um círculo de raio r (em pixels da imagem). Uma pincelada inteira = um passo.
    pincel(x, y, raio, v) {
      traco ||= new Map(); const r2 = raio * raio, x0 = Math.max(0, Math.floor(x - raio)), x1 = Math.min(W - 1, Math.ceil(x + raio)), y0 = Math.max(0, Math.floor(y - raio)), y1 = Math.min(H - 1, Math.ceil(y + raio));
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { const p = j * W + i; if ((i - x) ** 2 + (j - y) ** 2 <= r2 && keep[p] !== v && (v === 0 || d[p * 4 + 3] >= 128)) { if (!traco.has(p)) traco.set(p, keep[p]); keep[p] = v; } }
    },
    fimTraco() { const r = traco; traco = null; return r ? empurra(r) : 0; },
    desfazer() { const h = hist.pop(); if (!h) return false; for (const [p, v] of h) keep[p] = v; return true; },
    recomecar() { keep.fill(0); hist.length = 0; traco = null; },
    passos: () => hist.length,
    mantidos: () => { let n = 0; for (let i = 0; i < keep.length; i++) n += keep[i]; return n; },
  };
}

// Buracos: pedaços não mantidos que ficam totalmente cercados pelo que foi mantido (olhos, estampa, sombra) entram junto.
export function preencherBuracos(keep, img) {
  const { width: W, height: H, data: d } = img, fora = new Uint8Array(W * H), fila = new Int32Array(W * H); let ini = 0, fim = 0;
  const entra = (p) => { if (!keep[p] && !fora[p]) { fora[p] = 1; fila[fim++] = p; } };
  for (let x = 0; x < W; x++) { entra(x); entra((H - 1) * W + x); } for (let y = 0; y < H; y++) { entra(y * W); entra(y * W + W - 1); }
  while (ini < fim) { const p = fila[ini++], x = p % W, y = (p / W) | 0; if (x > 0) entra(p - 1); if (x < W - 1) entra(p + 1); if (y > 0) entra(p - W); if (y < H - 1) entra(p + W); }
  const out = Uint8Array.from(keep); for (let i = 0; i < out.length; i++) if (!keep[i] && !fora[i] && d[i * 4 + 3] >= 128) out[i] = 1;
  return out;
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
export function finalizar(img, keep, { margem = 2, buracos = true } = {}) {
  const { data: d, width: W, height: H } = img, alfa = alfaSuave(buracos ? preencherBuracos(keep, img) : keep, W, H);
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
