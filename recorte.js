// Acabamento do recorte de figurinha (porte do notebook recortador_figurinhas_sam2: rampa de borda, miolo opaco, contorno branco).
// Funções puras sobre arrays: não dependem do navegador, por isso são testadas em Node.
import * as C from "./recorte-config.js?v=68bc0da43c";

export const sigmoide = (x) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

// Entre as 3 máscaras do SAM: a MAIOR entre as de nota >= notaMin; se nenhuma passar, a de maior nota. Devolve os logits (M*M).
// Com pontos [x, y, tipo] (x,y de 0 a 1; tipo 0 = vermelho/remover, 1 = verde/manter): máscaras que contêm um ponto vermelho são descartadas,
// e se der, ficam só as que contêm todos os verdes (se nenhuma servir, relaxa a regra em vez de ficar sem recorte).
export function escolherMascara(notas, logits, M, notaMin = C.NOTA_MINIMA, pontos = []) {
  const n = notas.length, areas = [], dentro = (j, [x, y]) => logits[j * M * M + Math.min(M - 1, Math.round(y * (M - 1))) * M + Math.min(M - 1, Math.round(x * (M - 1)))] > 0;
  for (let j = 0; j < n; j++) { let a = 0; for (let i = j * M * M; i < (j + 1) * M * M; i++) a += logits[i] > 0; areas.push(a); }
  const vermelhos = pontos.filter((p) => p[2] === 0), verdes = pontos.filter((p) => p[2] !== 0);
  let todos = [...Array(n).keys()];
  const semVermelho = todos.filter((j) => !vermelhos.some((p) => dentro(j, p))), completos = semVermelho.filter((j) => verdes.every((p) => dentro(j, p)));
  const cand = completos.length ? completos : semVermelho.length ? semVermelho : todos;
  let bons = cand.filter((j) => notas[j] >= notaMin);
  if (!bons.length) bons = [cand.reduce((a, b) => (notas[b] > notas[a] ? b : a))];
  const j = bons.reduce((a, b) => (areas[b] > areas[a] ? b : a));
  return logits.subarray(j * M * M, (j + 1) * M * M);
}

// Rampa da borda (mesma lógica do Instagram): <= mínimo vira 0, > máximo vira 1, no meio sobe aos poucos.
export function rampa(p, min = C.BORDA_MIN, max = C.BORDA_MAX) {
  const o = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) { const v = p[i]; o[i] = v <= min ? 0 : v > max ? 1 : Math.max(0, Math.min(1, (v - min) / (1 - min))); }
  return o;
}

// Logits M*M -> probabilidade (0..1) no tamanho W*H (interpolação bilinear dos logits, depois sigmoide).
export function ampliarLogits(lg, M, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(M - 1.001, Math.max(0, ((y + 0.5) * M) / H - 0.5)), y0 = Math.floor(fy), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(M - 1.001, Math.max(0, ((x + 0.5) * M) / W - 0.5)), x0 = Math.floor(fx), wx = fx - x0;
      const v = (lg[y0 * M + x0] * (1 - wx) + lg[y0 * M + x0 + 1] * wx) * (1 - wy) + (lg[(y0 + 1) * M + x0] * (1 - wx) + lg[(y0 + 1) * M + x0 + 1] * wx) * wy;
      out[y * W + x] = sigmoide(v);
    }
  }
  return out;
}

// Desfoque gaussiano separável (bordas repetidas).
export function gauss(a, W, H, sigma) {
  if (!(sigma > 0)) return Float32Array.from(a);
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let i = -r; i <= r; i++) v += a[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r]; t[y * W + x] = v; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let i = -r; i <= r; i++) v += t[Math.min(H - 1, Math.max(0, y + i)) * W + x] * k[i + r]; o[y * W + x] = v; }
  return o;
}

// Distância euclidiana ao quadrado até o pixel mais próximo cujo valor == alvo (Felzenszwalb). Sem nenhum: ~infinito.
const INF = 1e12;
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s; for (;;) { s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[k] = q; z[k] = -INF; z[k + 1] = INF; } else { k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
export function distancia2(bin, W, H, alvo) {
  const g = new Float64Array(W * H), n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < W * H; i++) g[i] = bin[i] === alvo ? 0 : INF;
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; dt1(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; dt1(f, W, d, v, z); for (let x = 0; x < W; x++) g[y * W + x] = d[x]; }
  return g;
}
// Dilatação/erosão com elemento circular de raio r.
export function dilatar(bin, W, H, r) { const d = distancia2(bin, W, H, 1), o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = d[i] <= r * r ? 1 : 0; return o; }
export function erodir(bin, W, H, r) { const d = distancia2(bin, W, H, 0), o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = bin[i] && d[i] > r * r ? 1 : 0; return o; }

// Preenche os buracos (fundo cercado pelo objeto) menores que maxFrac da área do objeto. Fundo ligado à borda da imagem nunca é buraco.
export function preencherBuracos(solida, W, H, maxFrac = C.BURACO_MAX) {
  let total = 0; for (let i = 0; i < solida.length; i++) total += solida[i];
  const comp = new Int32Array(W * H).fill(-1), fila = new Int32Array(W * H), out = Uint8Array.from(solida); let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (solida[s] || comp[s] >= 0) continue;
    let ini = 0, fim = 0, toca = false; fila[fim++] = s; comp[s] = n;
    while (ini < fim) {
      const p = fila[ini++], x = p % W, y = (p / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) toca = true;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !solida[q] && comp[q] < 0) { comp[q] = n; fila[fim++] = q; }
    }
    if (!toca && fim < maxFrac * total) for (let i = 0; i < fim; i++) out[fila[i]] = 1;
    n++;
  }
  return out;
}

// Reduz (média por área) ou amplia (bilinear) um plano com `c` canais intercalados.
function pesos(n, nn) {
  const out = [], s = n / nn;
  for (let i = 0; i < nn; i++) {
    if (nn <= n) { const a = i * s, b = (i + 1) * s, w = []; for (let j = Math.floor(a); j < Math.min(n, Math.ceil(b)); j++) w.push([j, Math.min(j + 1, b) - Math.max(j, a)]); out.push(w); }
    else { const f = Math.min(n - 1, Math.max(0, (i + 0.5) * s - 0.5)), j = Math.max(0, Math.min(Math.floor(f), n - 2)); out.push(n < 2 ? [[0, 1]] : [[j, 1 - (f - j)], [j + 1, f - j]]); }
  }
  return out;
}
export function reamostrar(src, w, h, c, nw, nh) {
  const px = pesos(w, nw), py = pesos(h, nh), t = new Float32Array(nw * h * c), o = new Float32Array(nw * nh * c);
  for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) { const ws = px[x], tot = ws.reduce((a, b) => a + b[1], 0); for (let k = 0; k < c; k++) { let v = 0; for (const [j, wt] of ws) v += src[(y * w + j) * c + k] * wt; t[(y * nw + x) * c + k] = v / tot; } }
  for (let y = 0; y < nh; y++) { const ws = py[y], tot = ws.reduce((a, b) => a + b[1], 0); for (let x = 0; x < nw; x++) for (let k = 0; k < c; k++) { let v = 0; for (const [j, wt] of ws) v += t[(j * nw + x) * c + k] * wt; o[(y * nw + x) * c + k] = v / tot; } }
  return o;
}

// Monta a figurinha final (TAMANHO x TAMANHO, RGBA) a partir da foto (RGBA) e da máscara alfa (0..1, já com rampa). null se não sobrou nada.
export function montarFigurinha(rgba, W, H, alfa0, cfg = C) {
  const T = cfg.TAMANHO;
  let alfa = cfg.SUAVIZAR > 0 ? gauss(alfa0, W, H, cfg.SUAVIZAR) : Float32Array.from(alfa0);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alfa[y * W + x] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, rgb = new Float32Array(cw * ch * 3), al = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = (y + y0) * W + x + x0, o = y * cw + x; rgb[o * 3] = rgba[s * 4]; rgb[o * 3 + 1] = rgba[s * 4 + 1]; rgb[o * 3 + 2] = rgba[s * 4 + 2]; al[o] = alfa[s]; }
  const espaco = cfg.CONTORNO_PX + cfg.MARGEM_PX, esc = (T - 2 * espaco) / Math.max(cw, ch), nw = Math.max(1, Math.round(cw * esc)), nh = Math.max(1, Math.round(ch * esc));
  const rgbN = reamostrar(rgb, cw, ch, 3, nw, nh), alN = reamostrar(al, cw, ch, 1, nw, nh);
  const cor = new Float32Array(T * T * 3); let a = new Float32Array(T * T);
  const ox = (T - nw) >> 1, oy = (T - nh) >> 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const d = (y + oy) * T + x + ox, s = y * nw + x; cor[d * 3] = rgbN[s * 3]; cor[d * 3 + 1] = rgbN[s * 3 + 1]; cor[d * 3 + 2] = rgbN[s * 3 + 2]; a[d] = alN[s]; }
  if (cfg.MIOLO_PX > 0) { // miolo opaco: o modelo às vezes fica em dúvida em áreas escuras ou translúcidas
    let solida = new Uint8Array(T * T); for (let i = 0; i < a.length; i++) solida[i] = a[i] > 0.15 ? 1 : 0;
    solida = preencherBuracos(solida, T, T, cfg.BURACO_MAX);
    const m = erodir(solida, T, T, cfg.MIOLO_PX); for (let i = 0; i < a.length; i++) if (m[i]) a[i] = 1;
  }
  if (cfg.CONTORNO_PX > 0) {
    const bin = new Uint8Array(T * T); for (let i = 0; i < bin.length; i++) bin[i] = a[i] > 0.5 ? 1 : 0;
    const dil = gauss(Float32Array.from(dilatar(bin, T, T, cfg.CONTORNO_PX)), T, T, 1.0), f = [cfg.COR_R, cfg.COR_G, cfg.COR_B];
    for (let i = 0; i < a.length; i++) { for (let k = 0; k < 3; k++) cor[i * 3 + k] = cor[i * 3 + k] * a[i] + f[k] * (1 - a[i]); a[i] = Math.max(a[i], dil[i]); }
  }
  const out = new Uint8ClampedArray(T * T * 4);
  for (let i = 0; i < T * T; i++) { out[i * 4] = cor[i * 3]; out[i * 4 + 1] = cor[i * 3 + 1]; out[i * 4 + 2] = cor[i * 3 + 2]; out[i * 4 + 3] = Math.round(a[i] * 255); }
  return { data: out, width: T, height: T };
}
