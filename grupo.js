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
// aDois: a linha é uma cópia por aparelho de conversa a dois (formato novo, com para_aparelho): aí a mensagem visível leva o identificador (mid), igual em todas as cópias.
export function conteudoBate(content, grupoDaLinha, { aDois = false } = {}) {
  const g = content?.g ?? null, linha = grupoDaLinha ?? null;
  if (g !== linha) return false;
  if (g === null) {
    if (!aDois) return content?.mid === undefined;
    if (!content) return false;
    return content.type === "text" || content.type === "media" ? ehMid(content.mid) : content.mid === undefined || ehMid(content.mid);
  }
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
    if (!g) m.set(l.grupo_id, (g = { id: l.grupo_id, nomeCifrado: l.nome, criadoEm: l.criado_em, membros: [], eu: null, foto: null }));
    g.membros.push({ id: l.user_id, username: l.username, public_key: l.public_key, avatar: l.avatar || null, admin: !!l.admin, sub: !!l.sub, cor: l.cor || null, entrou_em: l.entrou_em });
    if (!g.foto && l.foto) g.foto = l.foto;
    if (l.user_id === eu) g.eu = { admin: !!l.admin, sub: !!l.sub, entrouEm: l.entrou_em, chave: l.chave, por: l.por, porChave: l.por_chave };
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
    : a.tipo === "saiu" ? `${n} saiu do grupo` : a.tipo === "nome" ? `O grupo agora se chama “${a.nome}”`
    : a.tipo === "sub" ? `${n} agora é sub-admin` : a.tipo === "semsub" ? `${n} deixou de ser sub-admin` : a.tipo === "admin" ? `${n} agora é admin`
    : a.tipo === "foto" ? (a.removida ? "A foto do grupo foi removida" : "A foto do grupo foi alterada")
    : a.tipo === "selos" ? (a.eu ? "Você mudou as regras dos Selos" : `${n} mudou as regras dos Selos`)
    : a.tipo === "loja_titulo" ? `${a.eu ? "Você comprou" : `${n} comprou`} o título “${a.titulo || "novo"}”`
    : a.tipo === "loja_destaque" ? (a.eu ? "Você destacou uma mensagem" : `${n} destacou uma mensagem`)
    : a.tipo === "loja_silencio" ? (a.eu ? `Você silenciou @${a.alvoNome || "alguém"} por ${a.min || 5} minutos` : a.alvoEu ? `${n} silenciou você por ${a.min || 5} minutos` : `${n} silenciou @${a.alvoNome || "alguém"} por ${a.min || 5} minutos`)
    : a.tipo === "renomeou" ? `@${a.de || "alguém"} agora é @${a.nome || "alguém"}` : "";
}

// ---------- Cargos ----------
// admin (tudo) > sub-admin (só expulsa membros comuns) > membro. O banco confere tudo de novo; estas funções só decidem o que a tela mostra.
export const cargoDe = (p) => (p?.admin ? "admin" : p?.sub ? "sub" : "membro");
export const podeRemover = (meu, alvo) => meu === "admin" || (meu === "sub" && alvo === "membro");
export const podeDarCargo = (meu, alvo) => meu === "admin" && alvo !== "admin";
// Quem mudou de cargo desde a última vez. antes/agora: { id: cargo }. Só conta quem está nos dois (entrar e sair têm avisos próprios).
export function diferencaCargos(antes, agora) {
  const out = [];
  for (const [id, cargo] of Object.entries(agora)) if (id in antes && antes[id] !== cargo) out.push({ id, de: antes[id], para: cargo });
  return out;
}

// ---------- Foto do grupo (cifrada com a chave do grupo) ----------
const aadFoto = (grupoId) => enc.encode("lacre-grupo-foto|" + grupoId);
export async function cifrarFoto(gk, grupoId, bytes) {
  if (!ehGrupoId(grupoId)) throw new Error("grupo invalido");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadFoto(grupoId) }, await chaveAes(gk, ["encrypt"]), bytes);
  return { data: new Uint8Array(ct), iv: b64(iv) };
}
export async function abrirFoto(gk, grupoId, data, iv) { // lança erro se foi adulterada, é de outro grupo ou a chave não é a certa
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: aadFoto(grupoId) }, await chaveAes(gk, ["decrypt"]), data));
}
export const caminhoFotoOk = (p, grupoId) => ehGrupoId(grupoId) && typeof p === "string" && new RegExp(`^[0-9a-f-]{36}/${grupoId}/[0-9a-f-]{36}$`).test(p);
export function limpaFoto(f, grupoId) { // o que vem do servidor é desconfiável
  if (!f || typeof f !== "object" || !caminhoFotoOk(f.p, grupoId) || typeof f.iv !== "string" || f.iv.length > 40) return null;
  return { p: f.p, iv: f.iv };
}

// ---------- Citação (@nome) ----------
const RE_MENCAO = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;
// Parte o texto em pedaços: { t } comum, ou { t, id } quando é "@nome" de alguém do grupo (nomes que não são do grupo ficam como texto).
export function partirTexto(texto, membros) {
  const por = new Map(membros.map((m) => [m.username.toLowerCase(), m.id])), out = []; let ult = 0;
  for (const m of String(texto ?? "").matchAll(RE_MENCAO)) {
    const id = por.get(m[2].toLowerCase()); if (!id) continue;
    const ini = m.index + m[1].length, fim = ini + 1 + m[2].length;
    if (ini > ult) out.push({ t: texto.slice(ult, ini) });
    out.push({ t: texto.slice(ini, fim), id }); ult = fim;
  }
  if (ult < String(texto ?? "").length) out.push({ t: texto.slice(ult) });
  return out;
}
export const mencionados = (texto, membros) => [...new Set(partirTexto(texto, membros).filter((x) => x.id).map((x) => x.id))];
// O "@..." logo antes do cursor (o que a pessoa está digitando agora), ou null
export function tokenMencao(antes) {
  const m = /(^|[\s(])@([a-z0-9_]{0,20})$/i.exec(antes);
  return m ? { inicio: antes.length - m[2].length - 1, prefixo: m[2] } : null;
}
// Lista que aparece depois do "@": quem começa com o que foi digitado vem primeiro; eu não apareço
export function sugerirMembros(membros, prefixo, eu, max = 6) {
  const p = String(prefixo || "").toLowerCase(), outros = membros.filter((m) => m.id !== eu).sort((a, b) => a.username.localeCompare(b.username));
  return [...outros.filter((m) => m.username.toLowerCase().startsWith(p)), ...outros.filter((m) => !m.username.toLowerCase().startsWith(p) && m.username.toLowerCase().includes(p))].slice(0, max);
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
