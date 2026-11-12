// Cor de cada pessoa nos grupos. Funções puras (testadas em Node). O banco guarda só 'p0'..'p9' (cores prontas) ou '#rrggbb' (cor aleatória) e impede repetir cor no mesmo grupo.
// Todo estilo vem DAQUI: um '#rrggbb' recebido de outra pessoa nunca vai direto para a tela; vira um tom de fundo/borda/nome legível (luminosidade fixada), então ninguém consegue
// mandar uma cor que atrapalhe a leitura (texto invisível, por exemplo).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (c) => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}
function rgb2lab(c) { // CIE Lab (D65): distância entre cores parecida com a que o olho percebe
  const lin = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047, y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 10 cores prontas: claro = [fundo do balão, borda, nome]; escuro = o mesmo para o modo escuro; forte = cor da bolinha/foto
const P = (id, nome, c, e) => ({ id, nome, claro: { bg: c[0], bd: c[1], nome: c[2], forte: c[2] }, escuro: { bg: e[0], bd: e[1], nome: e[2], forte: c[2] } });
export const PALETA = [
  P("p0", "Rosa", ["#FDE3EA", "#F4B9C8", "#B81E45"], ["#42182F", "#6D2A4B", "#FF8AA6"]), P("p1", "Azul", ["#DCE7FF", "#B3C8F5", "#2B4FB8"], ["#1C2A5E", "#2E4390", "#9DB6FF"]),
  P("p2", "Verde", ["#DAF2E2", "#A9DDBA", "#0C6B43"], ["#14382A", "#22603F", "#6FE0A0"]), P("p3", "Amarelo", ["#FFEFCF", "#F2D08B", "#8A5A00"], ["#40300F", "#6B5319", "#F2C46D"]),
  P("p4", "Lilás", ["#EBDDFA", "#CDB1EE", "#6A2FA0"], ["#34214F", "#573A82", "#C9A1F5"]), P("p5", "Laranja", ["#FFE2CC", "#F5B88A", "#A34A00"], ["#44240F", "#7A4219", "#FFAA66"]),
  P("p6", "Ciano", ["#D5F1F5", "#9CD6DE", "#0B6E8C"], ["#0F3A42", "#1B6773", "#6FD6E8"]), P("p7", "Coral", ["#FFD9D4", "#F2A59B", "#B03A2E"], ["#45201B", "#7A3A32", "#FF9A8C"]),
  P("p8", "Lima", ["#EAF5C9", "#C6DF85", "#4C6800"], ["#2D3A0E", "#506619", "#C4E26B"]), P("p9", "Grafite", ["#E3E5EC", "#BFC3D1", "#424866"], ["#2A2E45", "#454B6E", "#B6BBD6"]),
];
export const RE_COR = /^(p[0-9]|#[0-9a-f]{6})$/;
export const corValida = (c) => typeof c === "string" && RE_COR.test(c);
export const nomeDaCor = (c) => (!corValida(c) ? "Sem cor" : c[0] === "p" ? PALETA[Number(c[1])].nome : "Cor aleatória");

const hex = (h, s, l) => rgb2hex(hsl2rgb(h, s, l));
// Estilo de uma cor (ou null se não for uma cor válida). Para '#rrggbb' só o MATIZ é usado: saturação e luminosidade são limitadas.
export function estilosDaCor(cor) {
  if (!corValida(cor)) return null;
  if (cor[0] === "p") { const p = PALETA[Number(cor[1])]; return { claro: { ...p.claro }, escuro: { ...p.escuro } }; }
  const [h, s0] = rgb2hsl(hex2rgb(cor)), s = clamp(s0, 0.45, 0.85);
  const forte = hex(h, s, 0.36);
  return { claro: { bg: hex(h, 0.75, 0.92), bd: hex(h, 0.6, 0.8), nome: hex(h, s, 0.24), forte }, escuro: { bg: hex(h, 0.4, 0.19), bd: hex(h, 0.4, 0.31), nome: hex(h, 0.85, 0.76), forte } };
}
// A primeira cor pronta que ninguém usa (ou null se as 10 estão em uso). usadas: lista de cores em uso
export function primeiraLivre(usadas) { const u = new Set(usadas); return PALETA.find((p) => !u.has(p.id))?.id ?? null; }
// A cor aleatória: entre muitas candidatas, a que está MAIS LONGE da mais parecida entre as já usadas (distância Lab entre as cores fortes). Nunca devolve uma cor já usada.
const CAND = (() => { const o = []; for (let h = 0; h < 360; h += 5) for (const s of [0.6, 0.85]) for (const l of [0.34, 0.44]) o.push(hex(h, s, l)); return [...new Set(o)]; })();
export function corMaisDiferente(usadas) {
  const u = new Set((usadas || []).filter(corValida)), fortes = [...u].map((c) => rgb2lab(hex2rgb(estilosDaCor(c).claro.forte)));
  let melhor = null, dist = -1;
  for (const c of CAND) {
    if (u.has(c)) continue;
    const lab = rgb2lab(hex2rgb(estilosDaCor(c).claro.forte)), d = fortes.length ? Math.min(...fortes.map((f) => deltaE(lab, f))) : 99;
    if (d > dist + 1e-9) { dist = d; melhor = c; }
  }
  return melhor;
}
export const distanciaMinima = (cor, usadas) => { const lab = rgb2lab(hex2rgb(estilosDaCor(cor).claro.forte)), fs = (usadas || []).filter(corValida).map((c) => rgb2lab(hex2rgb(estilosDaCor(c).claro.forte))); return fs.length ? Math.min(...fs.map((f) => deltaE(lab, f))) : Infinity; };
