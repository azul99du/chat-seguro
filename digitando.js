// "Digitando…": um aviso avulso (broadcast) pelo canal em tempo real, sem gravar nada no servidor.
// O aviso é CIFRADO (só quem deve ver consegue abrir; os outros só enxergam um bloco embaralhado) e some sozinho se a pessoa para.
// Aqui ficam as partes puras (testadas em Node); o app cuida de cifrar, mandar e desenhar.
export const PARA_MS = 4000; // sem digitar por 4 s: o aviso é retirado
export const REENVIO_MS = 3000; // enquanto continua digitando, renova o aviso a cada 3 s
export const VALE_MS = 7000; // quem recebe confia no aviso por 7 s (se não for renovado, some)

export const IDADE_MAX_MS = 20000; // um aviso mais velho (ou do futuro) que isso é descartado: não vale copiar um aviso antigo
const UUID = /^[0-9a-f-]{36}$/;

// O que vai DENTRO do bloco cifrado: a conversa, quem digita, a hora e, se for o caso, "parou" (s)
export const conteudo = (conv, de, t, parou = false) => (parou ? { c: String(conv), u: String(de), t, s: 1 } : { c: String(conv), u: String(de), t });
export function limpaConteudo(x, agora) {
  if (!x || typeof x !== "object" || typeof x.c !== "string" || typeof x.u !== "string" || !UUID.test(x.c) || !UUID.test(x.u)) return null;
  if (!Number.isFinite(x.t) || Math.abs(agora - x.t) > IDADE_MAX_MS) return null;
  return { c: x.c, u: x.u, t: x.t, s: x.s === 1 };
}

// O que chega pelo canal é desconfiável: só aceita o formato esperado
export function limpaSinal(s) {
  if (!s || typeof s !== "object" || typeof s.u !== "string" || !UUID.test(s.u) || typeof s.c !== "string" || typeof s.i !== "string") return null;
  if (s.c.length < 8 || s.c.length > 400 || s.i.length < 8 || s.i.length > 40) return null;
  return { u: s.u, c: s.c, i: s.i };
}

// "Ana está digitando…" / "Ana e Bia estão digitando…" / "Ana, Bia e mais 2 estão digitando…"
export function textoDigitando(nomes) {
  const l = [...new Set((Array.isArray(nomes) ? nomes : []).map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (!l.length) return "";
  if (l.length === 1) return `${l[0]} está digitando…`;
  if (l.length === 2) return `${l[0]} e ${l[1]} estão digitando…`;
  return `${l[0]}, ${l[1]} e mais ${l.length - 2} estão digitando…`;
}

// Quem ainda vale (não passou do prazo) e quando conferir de novo
export function aindaDigitando(mapa, agora) {
  const vivos = [...mapa.values()].filter((x) => x.ate > agora);
  return { vivos, proximo: vivos.length ? Math.min(...vivos.map((x) => x.ate)) - agora : 0 };
}
