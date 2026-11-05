// Responder a uma mensagem (citação). Funções puras: não dependem do navegador, então são testadas em Node.
// A citação viaja DENTRO da mensagem cifrada; o servidor nunca vê qual mensagem foi respondida.
const KINDS = ["text", "image", "video", "audio", "sticker"];
const UUID = /^[0-9a-f-]{36}$/;
export const MAX_PREVIEW = 80;
// corta com reticências, para não parecer que a frase terminou ali (idempotente: um texto já cortado não muda)
const corta = (t) => (t.length > MAX_PREVIEW ? t.slice(0, MAX_PREVIEW - 1).trimEnd() + "…" : t);
const dur = (n) => Math.max(0, Math.min(3600, Math.round(Number(n) || 0)));
export const mmss = (n) => `${Math.floor(dur(n) / 60)}:${String(dur(n) % 60).padStart(2, "0")}`;

// Resumo de uma mensagem para citar: tipo + um trecho curto do texto/legenda.
export function resumo(c) {
  if (!c) return null;
  if (c.type === "media") return { kind: KINDS.includes(c.kind) && c.kind !== "text" ? c.kind : "image", text: corta(String(c.caption ?? "")), dur: dur(c.dur) };
  if (c.type === "text") return { kind: "text", text: corta(String(c.text ?? "")), dur: 0 };
  return null;
}
export function citacao(id, sender, content) {
  const r = resumo(content);
  return r && { id, from: sender, ...r };
}

// Tudo o que chega de outra pessoa é desconfiável: só aceitamos campos conhecidos, com tipo e tamanho certos.
export function limpaCitacao(re) {
  if (!re || typeof re !== "object") return null;
  const id = re.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null; // só número de verdade (Number(true) seria 1; Number("5") seria 5)
  return {
    id,
    from: typeof re.from === "string" && UUID.test(re.from) ? re.from : null,
    kind: KINDS.includes(re.kind) ? re.kind : "text",
    text: typeof re.text === "string" ? corta(re.text) : "",
    dur: dur(re.dur),
  };
}

// Texto curto que descreve o que foi citado: "Foto · legenda", "Áudio · 0:23", ou o próprio texto.
export function rotulo(r) {
  const extra = r.text ? ` · ${r.text}` : "";
  if (r.kind === "sticker") return "Figurinha";
  if (r.kind === "image") return "Foto" + extra;
  if (r.kind === "video") return "Vídeo" + extra;
  if (r.kind === "audio") return `Áudio${r.dur ? " · " + mmss(r.dur) : ""}${extra}`;
  return r.text || "Mensagem";
}

// O que mostrar na citação. Se a mensagem original está na tela, ela MANDA (texto e autor vêm do que temos aqui):
// assim ninguém consegue forjar "você disse X". Sem a original, usamos o resumo recebido, marcado como não verificado.
//   local = { mine: boolean, content } | undefined      ids = { me, peer }
export function exibir(re, local, ids) {
  if (local) {
    const r = resumo(local.content);
    if (r) return { autor: local.mine ? "mine" : "theirs", rotulo: rotulo(r), original: true };
  }
  const autor = re.from === ids.me ? "mine" : re.from === ids.peer ? "theirs" : null;
  return { autor, rotulo: rotulo(re), original: false };
}
