// Mensagens escritas sem internet: ficam numa fila neste aparelho (cifrada junto com o resto do que ele guarda) e saem sozinhas quando a conexão volta.
// Aqui ficam só as regras puras (testadas em Node); o app cuida de guardar, desenhar e enviar.
export const FILA_MAX = 30; // mensagens esperando ao mesmo tempo
export const FILA_VALIDADE_MS = 3 * 24 * 3600 * 1000; // passou de 3 dias esperando: desiste (a pessoa já não lembra mais do assunto)
export const MAX_TEXTO_FILA = 4000;

// O erro é falta de conexão (e não, por exemplo, "chave mudou")? Sem internet o navegador avisa sozinho; com sinal ruim o pedido some no meio do caminho.
export function ehFalhaDeRede(e, onLine = true) {
  if (onLine === false) return true;
  if (!e) return false;
  if (e.code || e.status) return false; // o servidor respondeu: não é a rede
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|internet disconnected|timeout|timed out|abort/i.test(String(e.message ?? e));
}

// Só texto (com ou sem citação) entra na fila; arquivos grandes não ficam esperando no aparelho.
export const podeEnfileirar = (c) => !!c && c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0;

export function novoItem(conv, content, agora = Date.now(), id = null) {
  const c = { type: "text", text: String(content.text).slice(0, MAX_TEXTO_FILA) };
  if (content.re && typeof content.re === "object") c.re = content.re;
  return { id: id ?? `${agora.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, conv: String(conv.id), grupo: !!conv.grupo, content: c, at: agora };
}

// Lê o que estava guardado: descarta o que não faz sentido e o que já venceu; limita o tamanho
export function limpaFila(x, agora = Date.now()) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const it of x) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || typeof it.conv !== "string" || !podeEnfileirar(it.content)) continue;
    const at = Number(it.at); if (!Number.isFinite(at) || agora - at > FILA_VALIDADE_MS) continue;
    out.push({ id: it.id.slice(0, 40), conv: it.conv.slice(0, 40), grupo: !!it.grupo, content: novoItem({ id: it.conv, grupo: it.grupo }, it.content, at, it.id).content, at });
  }
  return out.slice(-FILA_MAX);
}

export const cabeNaFila = (fila) => (Array.isArray(fila) ? fila.length : 0) < FILA_MAX;
export const daConversa = (fila, convId) => (Array.isArray(fila) ? fila : []).filter((i) => i.conv === String(convId));
export const semItem = (fila, id) => (Array.isArray(fila) ? fila : []).filter((i) => i.id !== id);
