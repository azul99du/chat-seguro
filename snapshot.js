// "Foto" da tela inicial: o que a lista de conversas mostrava da última vez (nomes, horários, não lidas, miniaturas das fotos e os pontos vermelhos).
// Serve para pintar a lista NA HORA em que o site abre, antes de qualquer consulta ao servidor. Funções puras (testadas em Node).
// O que vem do armazenamento do navegador é tratado como não confiável: só passa o que tem a forma esperada, com tamanhos limitados.
export const SNAP_MAX = 40, SNAP_MINI_MAX = 12000; // no máximo 40 conversas; cada miniatura de foto até ~12 KB
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const texto = (v, max) => (typeof v === "string" ? [...v.replace(/[\u0000-\u001f\u007f]/g, "")].slice(0, max).join("") : "");
const caminho = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) ? v : null);
const mini = (v) => (typeof v === "string" && v.length <= SNAP_MINI_MAX && MINI.test(v) ? v : null);
const inteiro = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.trunc(v))) : 0);

export function limparSnapshot(o) {
  if (!o || typeof o !== "object" || o.v !== 1 || !o.eu || typeof o.eu !== "object" || !Array.isArray(o.itens)) return null;
  const itens = [];
  for (const x of o.itens) {
    if (itens.length >= SNAP_MAX) break;
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !UUID.test(x.id)) continue;
    const n = texto(x.n, 60); if (!n) continue;
    itens.push({ id: x.id.toLowerCase(), g: x.g === true, n, m: x.g === true ? inteiro(x.m, 1000) : 0, a: caminho(x.a), th: mini(x.th), t: inteiro(x.t, 8.64e15), nl: inteiro(x.nl, 100) });
  }
  const u = texto(o.eu.u, 40);
  return { v: 1, eu: { u, a: caminho(o.eu.a), th: mini(o.eu.th) }, ponto: { ap: o.ponto?.ap === true, mfa: o.ponto?.mfa === true }, itens };
}
export function lerSnapshot(textoJson) {
  if (typeof textoJson !== "string" || textoJson.length > 600000) return null;
  try { return limparSnapshot(JSON.parse(textoJson)); } catch { return null; }
}
// Monta o texto a guardar (já limpo). Se passar do espaço, solta as miniaturas e tenta de novo (o nome e a hora são o mais importante).
export function textoDoSnapshot(o, limite = 450000) {
  const s = limparSnapshot({ v: 1, ...o }); if (!s) return null;
  let t = JSON.stringify(s); if (t.length <= limite) return t;
  for (const i of s.itens) i.th = null; s.eu.th = null; t = JSON.stringify(s);
  return t.length <= limite ? t : null;
}
