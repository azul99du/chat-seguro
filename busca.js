// Buscar uma palavra dentro de uma conversa. A busca roda no PRÓPRIO aparelho, no histórico que ele guarda cifrado: o servidor nunca vê o que se procura.
// Aqui ficam as partes puras (testadas em Node); o app lê o histórico, desenha a barra e leva até a mensagem.
export const MIN_BUSCA = 2; // com menos de 2 letras não procura (acharia quase tudo)
export const MAX_RESULTADOS = 500;
export const CONTEXTO_ANTES = 20; // ao ir até uma mensagem antiga, traz também as 20 anteriores a ela

// minúsculas e sem acento: "Ação" acha "acao"
export const normaliza = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// O texto onde se procura: o texto da mensagem, a legenda da mídia, o título/artista da música; apagadas e coisas internas não entram
export function textoBuscavel(c) {
  if (!c || typeof c !== "object") return "";
  if (c.type === "text") return String(c.text ?? "");
  if (c.type === "media") return c.kind === "musica" ? [c.titulo, c.artista].filter((x) => typeof x === "string").join(" ") : String(c.caption ?? "");
  return "";
}

export const termoValido = (termo) => normaliza(termo).trim().length >= MIN_BUSCA;

// itens: [{ id, entry:{content} }] em qualquer ordem → ids das mensagens que têm o termo, do mais antigo para o mais novo (id cresce com o tempo)
export function achar(itens, termo) {
  const q = normaliza(termo).trim(); if (q.length < MIN_BUSCA) return [];
  const ids = [];
  for (const it of itens || []) { if (Number.isSafeInteger(it?.id) && normaliza(textoBuscavel(it.entry?.content)).includes(q)) ids.push(it.id); }
  return ids.sort((a, b) => a - b).slice(-MAX_RESULTADOS);
}

// Pedaços de um texto para pintar: [{ t:"vamos marcar a ", m:false }, { t:"viagem", m:true }, ...] (acha sem diferenciar maiúscula/acento, mas mostra o texto original)
export function partes(texto, termo) {
  const t = String(texto ?? ""), q = normaliza(termo).trim(); if (q.length < MIN_BUSCA) return [{ t, m: false }];
  // normalizar pode mudar o tamanho (ex.: "ﬁ"): mapeia posição a posição, caractere por caractere
  let norm = "", mapa = [];
  for (let i = 0; i < t.length; i++) { const n = normaliza(t[i]); for (let k = 0; k < n.length; k++) { norm += n[k]; mapa.push(i); } }
  const out = []; let de = 0, i = 0;
  while ((i = norm.indexOf(q, i)) !== -1) {
    const ini = mapa[i], fim = mapa[i + q.length - 1] + 1;
    if (ini < de) { i += 1; continue; }
    if (ini > de) out.push({ t: t.slice(de, ini), m: false });
    out.push({ t: t.slice(ini, fim), m: true }); de = fim; i += q.length;
  }
  if (de < t.length) out.push({ t: t.slice(de), m: false });
  return out.length ? out : [{ t, m: false }];
}

// "3 de 7" (posição entre os resultados, do mais antigo ao mais novo) ou "Nada achado"
export const contador = (pos, total) => (total > 0 ? `${Math.min(Math.max(1, pos + 1), total)} de ${total}` : "Nada achado");
// Seta para cima = mais antigo; para baixo = mais novo; dá a volta nas pontas
export const passo = (pos, total, dir) => (total <= 0 ? -1 : dir < 0 ? (pos <= 0 ? total - 1 : pos - 1) : (pos >= total - 1 ? 0 : pos + 1));
// Entre os itens locais mais antigos que a tela, quais trazer para mostrar a mensagem "id" com contexto (ids ascendentes de TODAS as guardadas, menores que o primeiro da tela)
export function antesDeMostrar(idsAnteriores, id, contexto = CONTEXTO_ANTES) {
  const lista = [...idsAnteriores].sort((a, b) => a - b), i = lista.indexOf(id); if (i < 0) return [];
  return lista.slice(Math.max(0, i - contexto)); // da mensagem de contexto mais antiga até a última guardada antes da tela
}
