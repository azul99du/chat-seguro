// Grupos. Funções puras: não dependem da tela nem da rede, então são testadas em Node.
//
// Como um grupo funciona no Lacre:
//  - Cada mensagem do grupo vai CIFRADA SEPARADAMENTE para cada pessoa, pela mesma sessão com sigilo futuro das conversas a dois.
//    Não existe uma "chave do grupo" que abra as mensagens: quem sai (ou é removido) simplesmente deixa de receber cópias.
//  - O servidor sabe QUEM está em cada grupo (precisa, para recusar quem não é do grupo e liberar os arquivos),
//    mas não lê as mensagens nem o NOME do grupo: o nome é cifrado com uma chave que só os participantes têm.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const MAX_MEMBROS = 20, MAX_NOME = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ehGrupoId = (s) => typeof s === "string" && UUID.test(s);
export const ehMid = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s); // identificador da mensagem dentro do grupo (cada pessoa recebe uma linha diferente no servidor)

// Nome do grupo: 1 a 40 caracteres, sem quebras de linha nem espaços repetidos. Devolve null se não servir.
export function limpaNome(s) {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim(); // (sem caracteres invisíveis ou de direção: não dá para "disfarçar" um nome)
  return t.length >= 1 && [...t].length <= MAX_NOME ? t : null;
}

// ---------- Chave do grupo (serve SÓ para o nome) ----------
export const novaChave = () => b64(crypto.getRandomValues(new Uint8Array(32)));
async function chaveAes(gk, usos) {
  const raw = unb64(gk); if (raw.length !== 32) throw new Error("chave do grupo invalida");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usos);
}
const aadNome = (grupoId) => enc.encode("lacre-grupo-nome|" + grupoId); // o nome fica preso ao grupo: o servidor não consegue trocar nomes entre grupos
export async function cifrarNome(gk, grupoId, nome) {
  const limpo = limpaNome(nome); if (!limpo || !ehGrupoId(grupoId)) throw new Error("nome invalido");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadNome(grupoId) }, await chaveAes(gk, ["encrypt"]), enc.encode(limpo));
  return { c: b64(new Uint8Array(ct)), iv: b64(iv) };
}
// Lança erro se o nome foi adulterado, é de outro grupo ou a chave não é a certa.
export async function abrirNome(gk, grupoId, rec) {
  if (!rec || typeof rec.c !== "string" || typeof rec.iv !== "string") throw new Error("nome invalido");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv), additionalData: aadNome(grupoId) }, await chaveAes(gk, ["decrypt"]), unb64(rec.c));
  const nome = limpaNome(dec.decode(pt)); if (!nome) throw new Error("nome invalido");
  return nome;
}
// A chave do grupo chega a cada pessoa "embrulhada": este texto vai dentro da cifra a dois (entre quem adicionou e quem entrou).
// O texto diz para que serve e de qual grupo é, então não dá para reaproveitar o embrulho em outro lugar.
export const embrulho = (gk, grupoId) => JSON.stringify({ lacre: "grupo-chave", g: grupoId, k: gk });
export function abrirEmbrulho(texto, grupoId) {
  let o; try { o = JSON.parse(texto); } catch { throw new Error("embrulho invalido"); }
  if (o?.lacre !== "grupo-chave" || o.g !== grupoId || typeof o.k !== "string") throw new Error("embrulho invalido");
  let n = 0; try { n = unb64(o.k).length; } catch {}
  if (n !== 32) throw new Error("embrulho invalido");
  return o.k;
}

// ---------- Mensagens ----------
// A linha do servidor diz de qual grupo é (ou nenhum); o conteúdo cifrado diz a mesma coisa. Os dois precisam bater:
// assim o servidor não consegue jogar uma mensagem particular dentro de um grupo, nem levar uma mensagem de um grupo para outro.
export function conteudoBate(content, grupoDaLinha) {
  const g = content?.g ?? null, linha = grupoDaLinha ?? null;
  if (g !== linha) return false;
  if (g === null) return content?.mid === undefined;
  if (!ehGrupoId(g)) return false;
  if (content.type === "text" || content.type === "media") return ehMid(content.mid); // toda mensagem visível de grupo tem identificador
  return content.mid === undefined || ehMid(content.mid);
}

// Minhas mensagens num grupo viram VÁRIAS linhas no servidor (uma por pessoa), todas gravadas no mesmo instante.
// Aqui elas voltam a ser uma mensagem só: { id (o menor da leva), created_at, avisar, n }. Se a consulta foi cortada, a leva mais antiga pode estar incompleta e sai.
export function lotes(linhas, cortado = false) {
  const m = new Map();
  for (const l of linhas || []) {
    const k = l.created_at, a = m.get(k);
    if (a) { a.id = Math.min(a.id, l.id); a.n++; a.avisar = a.avisar && l.avisar !== false; }
    else m.set(k, { id: l.id, created_at: l.created_at, avisar: l.avisar !== false, n: 1 });
  }
  const out = [...m.values()].sort((a, b) => a.id - b.id);
  if (cortado && out.length) out.shift();
  return out;
}

// ---------- Participantes ----------
// Linhas de meus_grupos() (uma por grupo+pessoa) -> lista de grupos com os participantes.
export function montarGrupos(linhas, eu) {
  const m = new Map();
  for (const l of linhas || []) {
    if (!ehGrupoId(l.grupo_id) || !ehGrupoId(l.user_id) || typeof l.username !== "string") continue;
    let g = m.get(l.grupo_id);
    if (!g) m.set(l.grupo_id, (g = { id: l.grupo_id, nomeCifrado: l.nome, criadoEm: l.criado_em, membros: [], eu: null }));
    g.membros.push({ id: l.user_id, username: l.username, public_key: l.public_key, avatar: l.avatar || null, admin: !!l.admin, entrou_em: l.entrou_em });
    if (l.user_id === eu) g.eu = { admin: !!l.admin, entrouEm: l.entrou_em, chave: l.chave, por: l.por, porChave: l.por_chave };
  }
  return [...m.values()].filter((g) => g.eu); // (só grupos em que estou de verdade)
}
// O que mudou desde a última vez que este aparelho viu o grupo: quem entrou e quem saiu. antes/agora: { id: nome }
export function diferencaMembros(antes, agora, eu) {
  const entraram = [], sairam = [];
  for (const [id, nome] of Object.entries(agora)) if (id !== eu && !(id in antes)) entraram.push({ id, nome });
  for (const [id, nome] of Object.entries(antes)) if (id !== eu && !(id in agora)) sairam.push({ id, nome });
  return { entraram, sairam };
}
export function textoAviso(a) {
  const n = "@" + (a.nome || "alguém");
  return a.tipo === "criou" ? "Você criou o grupo" : a.tipo === "adicionado" ? `${n} adicionou você ao grupo` : a.tipo === "entrou" ? `${n} entrou no grupo`
    : a.tipo === "saiu" ? `${n} saiu do grupo` : a.tipo === "nome" ? `O grupo agora se chama “${a.nome}”` : "";
}
// "você, @ana, @beto e mais 2"
export function resumoMembros(membros, eu, max = 3) {
  const outros = membros.filter((p) => p.id !== eu).map((p) => "@" + p.username), mostra = outros.slice(0, max), resto = outros.length - mostra.length;
  return ["você", ...mostra].join(", ") + (resto > 0 ? ` e mais ${resto}` : "");
}
export const contagem = (n) => (n === 1 ? "1 pessoa" : `${n} pessoas`);
// Cor do nome de quem escreveu (sempre a mesma para a mesma pessoa)
export function corDoAutor(id, cores = 6) {
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % cores;
}
