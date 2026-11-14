import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=55e49bd046";
import { initiate, accept, canSend, encrypt as ratchetEncrypt, decrypt as ratchetDecrypt, validHeader, genDH, randomHex, bytes as toBytes, text as toText } from "./ratchet.js?v=55e49bd046";
import { montarFigurinhas } from "./figurinhas.js?v=55e49bd046";
import { getBlob, hasBlob, putBlob, delBlob } from "./store.js?v=55e49bd046";
import { recentesDoHistorico, ultimosDoHistorico, todoHistorico, acharNoHistorico, metaGet, metaPut, usoLocal, limparBlobs, BLOB_MAX, blobsUsados, exportarHistorico, importarHistorico, commit, getSession, getActive, listSessions, getHistory, getSpks, addSpk, removeSpk, pruneSpks, wipeLocal, withLock } from "./store.js?v=55e49bd046";
import { citacao, citacaoGrupo, limpaCitacao, exibir, rotulo } from "./reply.js?v=55e49bd046";
import { comprimirVideo, suportaCompressao } from "./video.js?v=55e49bd046";
import { acharVideoLink } from "./videolink.js?v=55e49bd046";
import { rotuloHora, dataCompleta, rotuloNovas, textoNovas, contaOnline } from "./lista.js?v=55e49bd046";
import { DIAS_TROCA, limpaUsuario, dataLiberada } from "./usuario.js?v=55e49bd046";
import { PALETA, estilosDaCor, primeiraLivre, corMaisDiferente, nomeDaCor } from "./cores.js?v=55e49bd046";
import { cargoDe, podeRemover, podeDarCargo, diferencaCargos, limpaFoto, cifrarFoto, abrirFoto as abrirFotoCifrada, partirTexto, mencionados, tokenMencao, sugerirMembros, MAX_MEMBROS, MAX_NOME, ehMid, limpaNome, novaChave, cifrarNome, abrirNome, embrulho, abrirEmbrulho, conteudoBate, lotes, montarGrupos, diferencaMembros, textoAviso, resumoMembros, contagem, corDoAutor } from "./grupo.js?v=55e49bd046";
import { porDia, publicavel, mesclar, resumir, sequencia, textoSequencia, tempoTexto, somarTela, noGrupoHa, ranking, totalDe, primeiroDia, diaLocal } from "./estatisticas.js?v=55e49bd046";
import { ACOES, TITULOS, regrasVazias, limpaRegras, igualRegras, marcoNovo, ajustaCampo, faixa, frase, fraseTexto, frasesLigadas, previa, textoSelos, saldoLimpo, erroRegras } from "./selos.js?v=55e49bd046";
import { riscoDeLocal as riscoDe } from "./aparelhos.js?v=55e49bd046";
import { novoId, idValido, resumo as resumoDisp, textoPendentes, nomeDoAparelho, AVISO_PENDENTE, erroAmigavel as erroDisp, ehRef, chaveSessao, limpaPrekeys, alvosDeEnvio, copiaPropriaValida, lotesDm, faltaMs, textoFalta, AVISO_RECUPERACAO, copiaGrupoValida, lotesGrupo, loteDeOutroAparelho, trabalhosDeEnvio, emLevas } from "./dispositivos.js?v=55e49bd046";
import { cleanImage, cleanVideo, cleanAudio, sealBytes, openBytes } from "./media.js?v=55e49bd046";
import { gerarSenha, empacotar, abrir as abrirHistorico, MIN_SENHA_ARQUIVO } from "./historico.js?v=55e49bd046";
import { LADO, CAMINHO_OK, TIPOS_ENTRADA, desenhar, codificar, caminhoNovo } from "./avatar.js?v=55e49bd046";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup, safetyCode, mesmaChavePublica, fingerprint, deleteLocalKeys } from "./crypto.js?v=55e49bd046";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let me, myKeys, active, ikJwk;
// Frase-senha do backup da chave: é o que um invasor com a senha de login tentaria adivinhar FORA do site, sem limite de tentativas.
const MIN_FRASE = 16;
const fraseFraca = (p) => p.length < MIN_FRASE ? `Use pelo menos ${MIN_FRASE} caracteres.`
  : new Set(p).size < 8 ? "Evite repetir os mesmos caracteres: misture palavras diferentes." : "";
let replyTo = null; // mensagem que estou respondendo: { id, from, kind, text, dur }
const contacts = new Map(); // id -> perfil (conversas a dois)
const grupos = new Map(); // id -> grupo: { id, grupo: true, nome, membros: Map(id -> perfil), admin, gk }
const perfis = new Map(); // id -> perfil de qualquer pessoa conhecida (inclui quem só está num grupo comigo)
const ativ = new Map(); // id da conversa (pessoa ou grupo) -> hora da última atividade: a lista mostra as mais recentes primeiro
const midParaId = new Map(); // grupo aberto: identificador da mensagem (igual para todos) -> id dela neste aparelho
// Lista de conversas: mensagens novas (guardadas neste aparelho, com o id de cada uma para nunca contar duas vezes) e horário da última mensagem
const naoLidas = new Map(); // conversa (pessoa ou grupo) -> ids das mensagens novas
const ultima = new Map(), ultimaCerta = new Set(); // conversa -> hora da última mensagem; "certa" = vista aqui (a do servidor pode ser uma reação, que não dá para distinguir sem decifrar)
const chaveLS = (n) => `lacre:${n}:${me.id}`;
function lerLS(n) { try { return JSON.parse(localStorage.getItem(chaveLS(n)) || "null"); } catch { return null; } }
function gravarLS(n, v) { try { localStorage.setItem(chaveLS(n), JSON.stringify(v)); } catch {} }
const salvaNL = () => gravarLS("nl", Object.fromEntries(naoLidas));
let salvaUltT = 0;
const agendaUlt = () => { clearTimeout(salvaUltT); salvaUltT = setTimeout(() => gravarLS("ult", Object.fromEntries([...ultimaCerta].map((k) => [k, ultima.get(k)]))), 300); };
function carregarLista() {
  const nl = lerLS("nl"); if (nl && typeof nl === "object") for (const [k, v] of Object.entries(nl)) if (Array.isArray(v)) { const ids = v.filter(Number.isSafeInteger).slice(-100); if (ids.length) naoLidas.set(k, ids); }
  const u = lerLS("ult"); if (u && typeof u === "object") for (const [k, v] of Object.entries(u)) if (Number.isFinite(v)) { ultima.set(k, v); ultimaCerta.add(k); }
}
function contarNova(conv, msgId) { const l = naoLidas.get(conv) || []; if (l.includes(msgId)) return; l.push(msgId); naoLidas.set(conv, l.slice(-100)); salvaNL(); }
function limparNaoLidas(conv) { if (naoLidas.delete(conv)) salvaNL(); }
function marcaUltima(conv, quando) { // uma mensagem que de fato apareceu (ou chegou) aqui
  const t = typeof quando === "number" ? quando : Date.parse(quando); if (!(t > 0)) return;
  if (!ultimaCerta.has(conv)) { ultimaCerta.add(conv); ultima.set(conv, t); } else if (t > ultima.get(conv)) ultima.set(conv, t); else return;
  agendaUlt();
}
function ultimaDoServidor(conv, quando) { const t = Date.parse(quando); if (!ultimaCerta.has(conv) && t > (ultima.get(conv) || 0)) ultima.set(conv, t); }
// o teclado só sobe quando a pessoa toca no campo (celular); no computador, com mouse, o foco continua indo direto para o campo
const focoSeMouse = () => { try { if (matchMedia("(pointer: fine)").matches) $("text").focus({ preventScroll: true }); } catch {} };
let online = new Set(); // ids de quem está online agora
const msgs = new Map(), reactions = new Map(); // mensagens/reações da conversa aberta

// ---------- Diálogos ----------
function ask(title, text, { codigo = false, texto = false, valor = "", max = 0 } = {}) { // texto: campo comum, visível (ex.: nome de grupo); o padrão é campo de senha
  const d = $("ask"), i = $("ask-input");
  $("ask-title").textContent = title; $("ask-text").textContent = text;
  i.type = codigo || texto ? "text" : "password"; i.inputMode = codigo ? "numeric" : "text"; i.autocomplete = codigo ? "one-time-code" : "off";
  codigo ? (i.maxLength = 6) : max ? (i.maxLength = max) : i.removeAttribute("maxlength");
  i.value = valor; d.returnValue = ""; d.showModal(); i.focus();
  return new Promise((res) => { d.onclose = () => res(d.returnValue === "ok" ? i.value : null); });
}
function choose(title, text, options) {
  const d = $("choice"); $("choice-title").textContent = title; $("choice-text").textContent = text;
  $("choice-actions").replaceChildren(...options.map((o) => { const b = el("button", o.cls, o.label); b.value = o.value; return b; }));
  d.returnValue = ""; d.showModal();
  return new Promise((res) => { d.onclose = () => res(d.returnValue || null); });
}
function note(text) {
  $("note-text").textContent = text; $("note").showModal();
  return new Promise((res) => { $("note").onclose = res; });
}

// ---------- Efeito: mensagem chega embaralhada e se decifra ----------
const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789#%&@$*+=?";
const scramble = (t, done) => [...t].map((c, i) => (c === " " || i < done ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
function reveal(el, text, onEnd) {
  if (reduced) { el.textContent = text; onEnd?.(); return; }
  const steps = Math.min(18, Math.max(8, text.length)); let n = 0;
  el.textContent = scramble(text, 0);
  const t = setInterval(() => {
    n++; el.textContent = scramble(text, Math.floor((n / steps) * text.length));
    if (n >= steps) { clearInterval(t); el.textContent = text; onEnd?.(); }
  }, 45);
}

// vitrine da tela de entrada: decifra frases em loop
const demoPhrases = ["chegou aí?", "bora sábado?", "só nós dois lemos isso", "me liga depois"];
(function demo() {
  const el = $("demo-text"), c = $("demo-cipher"); let k = 0;
  const cipherLine = () => Array.from({ length: 34 }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]).join("");
  const tick = () => {
    const p = demoPhrases[k++ % demoPhrases.length]; c.textContent = cipherLine();
    reveal(el, p, () => setTimeout(tick, 2600));
  };
  if (reduced) { el.textContent = demoPhrases[0]; c.textContent = cipherLine(); } else tick();
})();

// ---------- Entrada / cadastro ----------
let mode = "login";
function setMode(m) {
  mode = m;
  $("tab-login").setAttribute("aria-selected", m === "login");
  $("tab-signup").setAttribute("aria-selected", m === "signup");
  $("username-row").hidden = m !== "signup";
  $("username").required = m === "signup";
  $("auth-submit").textContent = m === "signup" ? "Criar conta" : "Entrar";
  $("password").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("password").minLength = m === "signup" ? 12 : 1; // senha nova: 12+ caracteres; quem já tem senha mais curta ainda consegue entrar
  $("password").placeholder = m === "signup" ? "mínimo 12 caracteres" : "sua senha";
  $("auth-msg").textContent = "";
}
$("tab-login").onclick = () => setMode("login");
$("tab-signup").onclick = () => setMode("signup");

const friendly = (m) => ({
  "Invalid login credentials": "E-mail ou senha incorretos.",
  "User already registered": "Esse e-mail já tem conta. Use a aba Entrar.",
  "Email not confirmed": "Confirme seu e-mail pelo link que enviamos e tente entrar de novo.",
}[m] || (/rate limit|too many/i.test(m) ? "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." : m));

$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const msg = (t) => ($("auth-msg").textContent = t);
  const email = $("email").value.trim(), password = $("password").value;
  $("auth-submit").disabled = true; msg("");
  try {
    if (mode === "signup") {
      localStorage.setItem("pending-username", $("username").value.trim().toLowerCase());
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { localStorage.removeItem("pending-username"); return msg(friendly(error.message)); }
      if (!data.session) return msg("Conta criada! Confirme o e-mail que enviamos e depois entre.");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return msg(friendly(error.message));
    }
    await start();
  } finally { $("auth-submit").disabled = false; }
};
$("logout").onclick = async () => {
  const r = await choose("Sair", "Se este aparelho é compartilhado, apague também as chaves dele. Você restaura a chave com a frase-senha, mas o histórico novo (com sigilo futuro) fica só neste aparelho e será apagado de vez.", [
    { label: "Só sair", value: "keep", cls: "primary" },
    { label: "Sair e apagar chaves deste aparelho", value: "wipe", cls: "ghost" },
    { label: "Cancelar", value: "", cls: "ghost" }]);
  if (!r) return;
  await removerRegistroPush(); // este aparelho deixa de receber avisos desta conta
  if (r === "wipe" && me) { const ref = dispResumo.eu?.ref; if (ref) { try { await sb.rpc("remover_dispositivo", { p_ref: ref }); } catch {} } await deleteLocalKeys(me.id); await wipeLocal(me.id); } // apagar as chaves também tira este aparelho da lista da conta
  await sb.auth.signOut({ scope: "local" }); location.reload(); // só ESTE aparelho sai (antes o "Sair" desconectava a conta em todos os aparelhos)
};

// ---------- Início: perfil + chaves ----------
const mostrarLogin = () => { $("abrindo").hidden = true; $("chat").hidden = true; $("auth").hidden = false; };
const mostrarChat = () => { $("abrindo").hidden = true; $("auth").hidden = true; $("chat").hidden = false; $("chat").classList.add("preparando"); }; // "preparando": já aparece, mas só aceita toques quando as chaves e as conversas estiverem prontas
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();
  // com verificação em dois passos, nada abre antes do código (a tela de abertura fica por trás do pedido)
  if (await precisaDoisPassos() && !(await pedirCodigoLogin())) { await sb.auth.signOut({ scope: "local" }); return location.reload(); }
  // já estava logado: vai direto para a lista de contatos (sem piscar a tela de login)
  try { const n = localStorage.getItem("lacre:eu:" + session.user.id); if (n) { $("me").textContent = n; $("nome-txt").textContent = n; $("eu-foto").textContent = n.replace("@", "")[0] || ""; } } catch {}
  mostrarChat();
  // conferimos no servidor, em segundo plano, se a sessão ainda vale (ex.: a senha foi trocada em outro aparelho)
  sb.auth.getUser().then(({ error }) => { if (error && [401, 403].includes(error.status)) sb.auth.signOut({ scope: "local" }).finally(() => location.reload()); }).catch(() => {});
  const uid = session.user.id;
  let { data: prof, error: perr } = await sb.from("profiles").select("id,username,public_key,avatar").eq("id", uid).maybeSingle();
  // falha de leitura NÃO é "primeiro acesso": nunca gera chave nova nem mexe na identidade local por causa de um erro de rede
  if (perr) { mostrarLogin(); return note("Não consegui carregar seu perfil agora. Verifique a conexão e tente entrar de novo."); }
  myKeys = await getLocalKeys(uid);

  if (!prof) { // primeiro acesso: gera chaves neste aparelho e publica só a chave pública
    const username = localStorage.getItem("pending-username");
    if (!username) { await sb.auth.signOut({ scope: "local" }); mostrarLogin(); return note("Não achamos seu perfil. Crie a conta de novo na aba Criar conta."); }
    // se já existe uma chave neste aparelho para esta conta, reaproveita (nunca sobrescreve)
    const publicKey = myKeys ? await crypto.subtle.exportKey("jwk", myKeys.publicKey) : await createKeys(uid);
    myKeys = await getLocalKeys(uid);
    let pass, hint = "Ela recupera suas mensagens se você trocar de aparelho. Use algo diferente da senha de login (dica: cinco palavras sorteadas, como rio-lua-pedra-nuvem-cafe) e guarde bem: não dá para redefinir.";
    for (;;) {
      pass = await ask("Crie sua frase-senha", hint);
      if (pass === null) { await sb.auth.signOut({ scope: "local" }); return location.reload(); }
      const fraca = fraseFraca(pass); if (!fraca) break;
      hint = fraca;
    }
    const { error } = await sb.from("profiles").insert({ id: uid, username, public_key: publicKey });
    if (error) {
      await sb.auth.signOut({ scope: "local" }); mostrarLogin();
      return note(error.code === "23505" ? "Esse nome de usuário já existe. Crie a conta de novo com outro nome." : "Não foi possível criar seu perfil: " + error.message);
    }
    localStorage.removeItem("pending-username");
    prof = { id: uid, username, public_key: publicKey };
    if (await saveBackup(uid, pass)) note("Não consegui salvar o backup da sua chave agora. Vou pedir de novo na próxima vez que você entrar.");
  } else if (!myKeys) {
    const { data: bk } = await sb.from("key_backups").select("backup").maybeSingle();
    if (!bk) { await sb.auth.signOut({ scope: "local" }); mostrarLogin(); return note("Este aparelho não tem sua chave e não existe backup, então as mensagens antigas não podem ser lidas."); }
    let hint = "Para ler suas mensagens neste aparelho, digite a frase-senha que você criou no cadastro.";
    for (;;) {
      const pass = await ask("Aparelho novo", hint);
      if (pass === null) { await sb.auth.signOut({ scope: "local" }); return location.reload(); }
      try { await restoreBackup(uid, pass, bk.backup, prof.public_key); break; }
      catch { hint = "Frase-senha incorreta. Tente de novo."; }
    }
    myKeys = await getLocalKeys(uid);
  }

  // a chave pública do servidor precisa ser a MESMA deste aparelho; senão um servidor malicioso poderia forjar o código de segurança
  const minhaPub = await crypto.subtle.exportKey("jwk", myKeys.publicKey);
  if (!mesmaChavePublica(minhaPub, prof.public_key)) {
    const r = await choose("Chave não confere", "A chave guardada neste aparelho é diferente da chave publicada na sua conta. Por segurança, não vou abrir as conversas. Você pode sair, ou restaurar a chave certa com a frase-senha (isso apaga a chave local divergente).", [
      { label: "Restaurar com a frase-senha", value: "restore", cls: "primary" },
      { label: "Sair", value: "", cls: "ghost" }]);
    if (r === "restore") await deleteLocalKeys(uid);
    await sb.auth.signOut({ scope: "local" }); return location.reload();
  }
  ikJwk = await crypto.subtle.exportKey("jwk", myKeys.privateKey); // usada só em memória, para o acordo de chaves
  me = { ...prof, public_key: minhaPub };
  const { data: hasBk } = await sb.from("key_backups").select("user_id").maybeSingle();
  if (!hasBk) await offerBackup(uid);
  $("me").textContent = "@" + me.username; $("nome-txt").textContent = "@" + me.username; try { localStorage.setItem("lacre:eu:" + uid, "@" + me.username); } catch {}
  carregarLista();
  pintarMeu();
  mostrarChat();
  aparelhoPronto = registrarDispositivo(); // identifica este aparelho no servidor ANTES de publicar a chave de recepção (que leva a marca dele)
  await aparelhoPronto;
  if (dispResumo.souPendente) return iniciarEspera(); // aparelho pendente: não lê, não envia e não aparece para quem envia, até um aparelho permitido liberar
  ensureSpk();
  await loadContacts();
  atualizarAviso2fa();
  sb.channel("msgs", { config: { private: true } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => naFila(() => onIncoming(p.new)))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${uid}` }, (p) => {
      if (p.new.grupo_id || p.new.recipient_id === me.id) return; // em grupo não há "vista" (cada pessoa recebe a sua cópia); cópias para mim mesmo não contam
      marcarVistaDoEnvio(p.new);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => lidaEmOutroAparelho(p.new)) // li em outro aparelho meu: aqui some a bolinha de não lida
    .subscribe((st, err) => { if (st === "SUBSCRIBED") sincronizar(); else console.warn("canal de mensagens:", st, err?.message || ""); }); // a cada (re)conexão do canal busca o que chegou antes dela ficar ativa: nada se perde no intervalo
  sincronizar();

  // quem está online: presença em tempo real (some sozinha ao fechar o site)
  const pres = sb.channel("online", { config: { private: true, presence: { key: uid } } });
  pres.on("presence", { event: "sync" }, () => {
    online = new Set(Object.keys(pres.presenceState()));
    renderContacts(); updateStatus();
  }).subscribe(async (st) => { if (st === "SUBSCRIBED") await pres.track({ at: Date.now() }); });

  document.addEventListener("visibilitychange", () => { markRead(); if (!document.hidden) { loadContacts().catch(() => {}).then(sincronizar); conferirAparelhos(true); conferirDispositivos(); } });
  addEventListener("focus", () => { markRead(); conferirDispositivos(); });
  addEventListener("online", () => { loadContacts().catch(() => {}).then(sincronizar); }); // a internet voltou: busca o que chegou nesse meio-tempo
  $("chat").classList.remove("preparando"); document.body.dataset.pronto = "1";
  sincronizarNotificacoes(); conferirAparelhos(true, true); conferirDispositivos(true);
  setInterval(() => { if (!document.hidden) { conferirAparelhos(true); conferirDispositivos(); } }, 60000);
  // Rede de segurança: o tempo real do servidor não garante entregar todo aviso (uma conexão que oscila, um evento perdido). De tempos em tempos
  // (e só com a tela à vista) busca o que chegou desde a última conferência; quase sempre não há nada e é uma consulta pequena.
  let pollMs = 30000; try { const v = localStorage.getItem("lacre:poll"); if (v !== null && Number.isFinite(Number(v))) pollMs = Number(v); } catch {} // (os testes ajustam ou desligam)
  if (pollMs > 0) setInterval(() => { if (!document.hidden && !carregandoConversa) { sincronizar(); conferirVistas().catch(() => {}); } }, pollMs);
}

// ---------- Verificação em dois passos (código de app autenticador, TOTP) ----------
const erro2fa = (e) => /rate limit|too many/i.test(e?.message || "") ? "Muitas tentativas. Espere um pouco e tente de novo."
  : /invalid totp|invalid/i.test(e?.message || "") ? "Código incorreto ou vencido. Confira a hora do celular e digite o próximo código."
  : "Não foi possível verificar agora. Tente de novo.";
// Se o IP mudar entre pedir e conferir o desafio, o Supabase recusa: tentamos de novo uma vez.
async function verificarCodigo(factorId, code) {
  for (let i = 0; i < 2; i++) {
    const ch = await sb.auth.mfa.challenge({ factorId }); if (ch.error) return ch.error;
    const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    if (!v.error || !/ip addresses mismatch/i.test(v.error.message)) return v.error;
  }
  return new Error("mismatch");
}
async function precisaDoisPassos() {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}
async function pedirCodigoLogin() {
  const f = (await sb.auth.mfa.listFactors()).data?.totp?.[0]; if (!f) return false;
  let dica = "Abra o app autenticador e digite o código de 6 dígitos do Lacre.";
  for (;;) {
    const code = await ask("Verificação em dois passos", dica, { codigo: true });
    if (code === null) return false;
    const err = await verificarCodigo(f.id, code.trim()); if (!err) return true;
    dica = erro2fa(err);
  }
}
let pendente2fa = null; // fator cadastrado mas ainda não confirmado
async function ativo2fa() { return (await sb.auth.mfa.listFactors()).data?.totp?.[0] ?? null; }
async function atualizarAviso2fa() { const falta = !(await ativo2fa()); $("mfa-nudge").hidden = !falta; $("sec-aviso").hidden = !falta; }
async function desenharSeguranca() {
  const ativo = await ativo2fa(), msg = $("mfa-msg"); msg.textContent = ""; msg.className = "";
  $("mfa-enroll").hidden = !pendente2fa; $("mfa-off").hidden = !ativo || !!pendente2fa;
  $("mfa-go").hidden = !!ativo && !pendente2fa;
  $("mfa-go").textContent = pendente2fa ? "Confirmar código" : "Ativar verificação";
  const est = pendente2fa ? "pendente" : ativo ? "on" : "off";
  $("mfa-destaque").dataset.estado = est; $("mfa-chip").textContent = pendente2fa ? "Falta confirmar" : ativo ? "Ativada" : "Desativada";
  $("mfa-status").textContent = pendente2fa ? "Falta só confirmar: digite o código que o app mostra."
    : ativo ? "Ativada. Além da senha, o Lacre pede um código do seu app autenticador a cada novo login. Sem o código, ninguém abre a conta, mesmo sabendo a senha."
    : "Com ela, uma senha descoberta não basta para entrar na sua conta.";
}
async function limpar2faPendente() {
  if (!pendente2fa) return; const id = pendente2fa; pendente2fa = null;
  await sb.auth.mfa.unenroll({ factorId: id }).catch(() => {});
}
async function abrirSeguranca() { await limpar2faPendente(); await desenharSeguranca(); $("mfa").showModal(); }
async function trocarFrase() {
  const msg = $("mfa-msg"); msg.className = ""; msg.textContent = "";
  let hint = `Digite a NOVA frase-senha (${MIN_FRASE}+ caracteres; dica: cinco palavras sorteadas, como rio-lua-pedra-nuvem-cafe). Ela substitui a antiga.`, nova;
  for (;;) {
    nova = await ask("Trocar a frase-senha", hint); if (nova === null) return;
    const fraca = fraseFraca(nova); if (!fraca) break; hint = fraca;
  }
  const conf = await ask("Confirme a nova frase-senha", "Digite de novo, igualzinha. Se errar, você pode perder o acesso às mensagens num aparelho novo.");
  if (conf === null) return;
  if (conf !== nova) { msg.textContent = "As duas frases não são iguais. Nada foi alterado."; return; }
  if (await saveBackup(me.id, nova)) { msg.textContent = "Não foi possível salvar agora. A frase antiga continua valendo."; return; }
  msg.className = "ok"; msg.textContent = "Frase-senha trocada. A antiga deixou de funcionar.";
}
$("mfa-pass").onclick = trocarFrase;

// Senha de LOGIN (a da conta). Não confundir com a frase-senha do backup da chave.
const MIN_SENHA = 12; // o servidor aceita até 6; quem impõe 12 é o app, igual ao cadastro
async function trocarSenha() {
  const msg = $("mfa-msg"); msg.className = ""; msg.textContent = "";
  const atual = await ask("Trocar a senha", "Digite a senha ATUAL da sua conta."); if (atual === null) return;
  // confere a senha atual num cliente descartável, sem mexer na sessão que está aberta
  const { data: u } = await sb.auth.getUser(); const email = u?.user?.email;
  const tmp = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const chk = await tmp.auth.signInWithPassword({ email: email || "", password: atual });
  await tmp.auth.signOut({ scope: "local" }).catch(() => {});
  if (chk.error) { msg.textContent = limitado(chk.error) || /rate limit|too many/i.test(chk.error.message) ? "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." : "A senha atual está errada. Nada foi alterado."; return; }
  let hint = `Digite a NOVA senha (${MIN_SENHA}+ caracteres).`, nova;
  for (;;) {
    nova = await ask("Nova senha", hint); if (nova === null) return;
    if (nova.length < MIN_SENHA) hint = `Use pelo menos ${MIN_SENHA} caracteres.`;
    else if (nova === atual) hint = "A nova senha precisa ser diferente da atual.";
    else if (new Set(nova).size < 6) hint = "Evite repetir os mesmos caracteres.";
    else break;
  }
  const conf = await ask("Confirme a nova senha", "Digite de novo, igualzinha.");
  if (conf === null) return;
  if (conf !== nova) { msg.textContent = "As duas senhas não são iguais. Nada foi alterado."; return; }
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) {
    msg.textContent = error.code === "insufficient_aal" || /aal2|reauth/i.test(error.message) ? "Para trocar a senha, saia e entre de novo digitando o código do app autenticador."
      : error.code === "same_password" ? "A nova senha precisa ser diferente da atual."
      : error.code === "weak_password" ? "Essa senha foi recusada por ser fraca. Escolha outra."
      : limitado(error) || /rate limit|too many/i.test(error.message) ? "Muitas tentativas seguidas. Espere alguns minutos e tente de novo."
      : "Não foi possível trocar agora. A senha antiga continua valendo.";
    return;
  }
  await sb.auth.signOut({ scope: "others" }).catch(() => {}); // derruba os outros aparelhos: quem tinha a senha antiga sai
  msg.className = "ok"; msg.textContent = "Senha trocada. A antiga deixou de funcionar e os outros aparelhos foram desconectados.";
}
$("mfa-senha").onclick = trocarSenha;
// ---------- Histórico para outro aparelho ----------
const msgMfa = (t, ok) => { const m = $("mfa-msg"); m.textContent = t; m.className = ok ? "ok" : ""; };
async function exportarMeuHistorico() {
  msgMfa("");
  const modo = await choose("Exportar o histórico", "Cria um arquivo com as suas mensagens já lidas, trancado por uma senha só dele. Ele NÃO vai para o servidor. Use no aparelho novo (Importar histórico) e depois apague o arquivo.", [
    { value: "gerar", label: "Gerar uma senha forte (recomendado)", cls: "primary" }, { value: "minha", label: "Escolher minha própria senha", cls: "ghost" }, { value: "cancel", label: "Cancelar", cls: "ghost" }]);
  if (!modo || modo === "cancel") return;
  let senha;
  if (modo === "gerar") {
    senha = gerarSenha();
    const r = await choose("Anote esta senha", `${senha}\n\nSem ela o arquivo não abre, e ninguém consegue recuperá-la. Anote em papel ou no seu gerenciador de senhas.`, [{ value: "ok", label: "Anotei, continuar", cls: "primary" }, { value: "cancel", label: "Cancelar", cls: "ghost" }]);
    if (r !== "ok") return;
  } else {
    let dica = `Crie a senha do arquivo (${MIN_SENHA_ARQUIVO}+ caracteres). Ela é a única proteção do arquivo: use algo bem diferente das suas outras senhas.`;
    for (;;) {
      senha = await ask("Senha do arquivo", dica); if (senha === null) return;
      const fraca = senha.length < MIN_SENHA_ARQUIVO ? `Use pelo menos ${MIN_SENHA_ARQUIVO} caracteres.` : fraseFraca(senha);
      if (fraca) { dica = fraca; continue; }
      const c = await ask("Confirme a senha", "Digite a mesma senha de novo."); if (c === null) return;
      if (c === senha) break; dica = "As senhas não são iguais. Crie de novo.";
    }
  }
  msgMfa("Preparando o arquivo…", true);
  try {
    const itens = await exportarHistorico(me.id);
    const texto = await empacotar(me.id, itens, senha);
    const url = URL.createObjectURL(new Blob([texto], { type: "application/octet-stream" }));
    const a = el("a"); a.href = url; a.download = `lacre-historico-${new Date().toISOString().slice(0, 10)}.lacre`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    msgMfa(`Arquivo gerado com ${itens.length} mensagens. Guarde-o só onde você controla e apague depois de importar.`, true);
  } catch { msgMfa("Não foi possível gerar o arquivo."); }
}
async function importarMeuHistorico(arquivo) {
  msgMfa("");
  if (!arquivo) return;
  if (arquivo.size > 50 * 1048576) return msgMfa("Esse arquivo é grande demais para ser um histórico do Lacre.");
  const texto = await arquivo.text();
  const senha = await ask("Importar o histórico", "Digite a senha desse arquivo."); if (senha === null) return;
  msgMfa("Abrindo o arquivo…", true);
  try {
    const itens = await abrirHistorico(me.id, texto, senha);
    const r = await importarHistorico(me.id, itens);
    msgMfa(`Pronto: ${r.novos} mensagens importadas${r.jaExistiam ? ` (${r.jaExistiam} já estavam aqui)` : ""}. Você pode apagar o arquivo.`, true);
    if (active) open(active);
  } catch (e) { msgMfa(e?.message === "formato" ? "Esse arquivo não é um histórico do Lacre." : "Senha errada, arquivo de outra conta ou arquivo alterado. Nada foi importado."); }
}
$("mfa-exp").onclick = exportarMeuHistorico;
$("mfa-imp").onclick = () => $("mfa-file").click();
$("mfa-file").onchange = () => { const f = $("mfa-file").files[0]; $("mfa-file").value = ""; importarMeuHistorico(f); };
$("sec-btn").onclick = abrirSeguranca; $("mfa-nudge").onclick = abrirSeguranca;
$("mfa").addEventListener("close", async () => { await limpar2faPendente(); });
$("mfa-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("mfa-go").click(); } });
$("mfa-go").onclick = async () => {
  const msg = $("mfa-msg"); msg.className = ""; msg.textContent = "";
  if (!pendente2fa) {
    const { data: lista } = await sb.auth.mfa.listFactors(); // restos de tentativas anteriores
    for (const f of lista?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    const en = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Lacre " + new Date().toISOString().slice(0, 16) });
    if (en.error) { msg.textContent = "Não foi possível iniciar agora. Tente de novo."; return; }
    pendente2fa = en.data.id; $("mfa-qr").src = en.data.totp.qr_code; $("mfa-secret").textContent = en.data.totp.secret;
    await desenharSeguranca(); $("mfa-code").value = ""; $("mfa-code").focus(); return;
  }
  const err = await verificarCodigo(pendente2fa, $("mfa-code").value.trim());
  if (err) { msg.textContent = erro2fa(err); $("mfa-code").select(); return; }
  pendente2fa = null; await desenharSeguranca(); atualizarAviso2fa();
  $("mfa-msg").className = "ok"; $("mfa-msg").textContent = "Pronto! A verificação em dois passos está ativada.";
};
$("mfa-off").onclick = async () => {
  const r = await choose("Desativar a verificação em dois passos?", "Sua conta voltará a abrir só com e-mail e senha.", [
    { label: "Desativar", value: "sim", cls: "primary" }, { label: "Manter ativada", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  const f = await ativo2fa(); if (!f) return;
  const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
  if (error) { $("mfa-msg").textContent = "Não foi possível desativar agora. Tente de novo."; return; }
  await desenharSeguranca(); atualizarAviso2fa();
};

async function saveBackup(uid, pass) {
  const backup = await makeBackup(uid, pass);
  const { error } = await sb.from("key_backups").upsert({ user_id: uid, backup, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error;
}
async function offerBackup(uid) {
  let hint = "Você ainda não tem backup da sua chave. Crie uma frase-senha para recuperar as mensagens se trocar de aparelho.";
  for (;;) {
    const pass = await ask("Proteja suas mensagens", hint);
    if (pass === null) return;
    const fraca = fraseFraca(pass); if (fraca) { hint = fraca; continue; }
    if (!(await saveBackup(uid, pass))) return;
    hint = "Não foi possível salvar. Tente de novo.";
  }
}

// ---------- Menu da conta (toque na sua foto, no topo) ----------
function abrirMenu() {
  blobsUsados(me.id).then((u) => { $("arm-resumo").textContent = `${fmtBytes(u.bytes)} neste aparelho`; }).catch(() => {}); $("menu-fundo").hidden = false; $("menu-conta").hidden = false; $("eu-foto").setAttribute("aria-expanded", "true"); $("menu-conta").querySelector("button")?.focus({ preventScroll: true }); }
function fecharMenu(devolveFoco = true) {
  if ($("menu-conta").hidden) return;
  $("menu-conta").hidden = true; $("menu-fundo").hidden = true; $("eu-foto").setAttribute("aria-expanded", "false"); if (devolveFoco) $("eu-foto").focus({ preventScroll: true });
}
$("eu-foto").onclick = () => ($("menu-conta").hidden ? abrirMenu() : fecharMenu());
$("menu-fundo").onclick = () => fecharMenu();
$("menu-conta").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.matches("#notif-btn, #copiar-nome, #tema-btn")) fecharMenu(false); }); // copiar e notificações mostram o resultado ali mesmo
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("menu-conta").hidden && !document.querySelector("dialog[open]")) fecharMenu(); });

// ---------- Aparelhos conectados: onde e quando a conta entrou ----------
let ultimoRegistro = 0;
// Código deste navegador: aleatório, criado na 1ª vez e guardado só aqui (apagar os dados do site cria um novo). O servidor recebe apenas uma versão embaralhada dele.
function codigoAparelho() {
  try { let c = localStorage.getItem("lacre:disp"); if (!/^[0-9a-f]{32}$/.test(c || "")) { c = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("lacre:disp", c); } return c; } catch { return null; }
}
async function registrarAparelho(forca = false) { // avisa o servidor que ESTA sessão está em uso (ele guarda navegador, sistema e local aproximado; o IP não é guardado)
  if (!forca && Date.now() - ultimoRegistro < 300000) return; ultimoRegistro = Date.now();
  try { const t = (await sb.auth.getSession()).data.session?.access_token; if (t) await fetch(FN_APARELHO, { method: "POST", headers: { authorization: "Bearer " + t, apikey: SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify({ disp: codigoAparelho() }) }); } catch {}
}
const ICONES_APARELHO = { celular: ["M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M11 18h2"], tablet: ["M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M11 18h2"], computador: ["M4 5h16v11H4z", "M2 19h20"], outro: ["M4 5h16v11H4z", "M2 19h20"] };
function svgAparelho(tipo) { const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  for (const d of ICONES_APARELHO[tipo] || ICONES_APARELHO.outro) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.append(p); } return svg; }
const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
const nomePaisPt = (c) => { try { return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(c); } catch { return c; } };
const riscoDeLocal = (a, lista) => riscoDe(a, lista, nomePaisPt);
function localDe(a) {
  let pais = ""; try { pais = a.pais_codigo ? new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(a.pais_codigo) : ""; } catch { pais = a.pais_codigo || ""; }
  const partes = [a.cidade, a.regiao, pais].filter(Boolean); return partes.length ? partes.join(", ") + " (aproximado)" : "Local indisponível";
}
async function desenharAparelhos() {
  abrirDispositivos();
  const lista = $("aparelhos-lista"); lista.replaceChildren(el("p", "pg-dica sem-recuo", "Carregando…"));
  await registrarAparelho(true); // garante que ESTE aparelho já aparece na lista
  const { data, error } = await sb.rpc("meus_aparelhos");
  if (error) return lista.replaceChildren(el("p", "pg-dica sem-recuo", "Não foi possível ver agora. Tente de novo mais tarde."));
  if (!data?.length) return lista.replaceChildren(el("p", "pg-dica sem-recuo", "Ainda não há acessos registrados."));
  lista.replaceChildren(...data.map((a) => {
    const row = el("div", "linha info" + (a.atual ? " atual" : "")), ic = el("span", "ic"), tx = el("span", "tx"), tit = el("b", null, `${a.navegador} no ${a.sistema}`);
    ic.append(svgAparelho(a.tipo)); row.dataset.sessao = a.session_id;
    const selo = el("span", "selo-estado " + (a.atual ? "" : a.conectado ? "ativo" : "saiu"), a.atual ? "Este aparelho" : a.conectado ? "Sessão ativa" : "Saiu");
    const linhaTit = el("span", "ap-tit"); linhaTit.append(tit, selo);
    if (!a.atual && a.decisao === null) linhaTit.append(el("span", "selo-novo", "Novo"));
    if (a.decisao === "recusado") linhaTit.append(el("span", "selo-novo recusado", "Não reconhecido"));
    tx.append(linhaTit, el("small", null, localDe(a)), el("small", null, `Entrou em ${quando(a.entrou_em)}`), el("small", null, `Último acesso em ${quando(a.ultimo_acesso)}`));
    const risco = !a.atual && a.decisao === null ? riscoDeLocal(a, data) : null; if (risco) tx.append(el("small", "risco " + risco.nivel, "Atenção: " + risco.texto));
    if (!a.atual && a.decisao === null) { // ainda não conferido: dá para decidir aqui também
      const ac = el("span", "ap-acoes"), sim = el("button", "ghost", "Reconheço"), nao = el("button", "ghost perigo", "Não reconheço"); sim.type = nao.type = "button";
      sim.onclick = async () => { await decidirAparelho(a.session_id, "reconhecido"); desenharAparelhos(); };
      nao.onclick = async () => { await decidirAparelho(a.session_id, "recusado"); desenharAparelhos(); };
      ac.append(sim, nao); tx.append(ac);
    }
    row.append(ic, tx); return row;
  }));
}
// ---------- Aviso de aparelho novo: folha ao abrir o Lacre + ponto rosa na foto enquanto houver algo para conferir ----------
const dispensados = new Set(); let conferindoAparelhos = false, conferirDepois = null;
const pendentesAparelhos = (l) => l.filter((a) => !a.atual && (a.decisao === null || (a.decisao === "recusado" && a.conectado))); // novo, ou "não fui eu" que ainda está conectado
async function decidirAparelho(sessao, decisao) { try { await sb.rpc("decidir_aparelho", { p_sessao: sessao, p_decisao: decisao }); } catch {} conferirAparelhos(false); }
async function conferirAparelhos(mostrar = true, forcaRegistro = false) {
  if (!me) return;
  if (conferindoAparelhos) { conferirDepois = { mostrar: mostrar || !!conferirDepois?.mostrar, forcaRegistro: forcaRegistro || !!conferirDepois?.forcaRegistro }; return; } // já conferindo: repete logo depois (para o ponto nunca ficar velho)
  conferindoAparelhos = true;
  try {
    await registrarAparelho(forcaRegistro);
    const { data } = await sb.rpc("meus_aparelhos"); if (!data) return;
    const pend = pendentesAparelhos(data), novos = pend.filter((a) => a.decisao === null);
    $("ap-ponto").hidden = !pend.length; $("sec-aviso-ap").hidden = !pend.length;
    const t = $("mfa-ap-txt"); t.textContent = pend.length ? `● ${pend.length === 1 ? "1 aparelho para conferir" : pend.length + " aparelhos para conferir"}` : "Veja onde e quando sua conta entrou"; t.classList.toggle("aviso", pend.length > 0);
    const alvo = novos.find((a) => !dispensados.has(a.session_id));
    if (mostrar && alvo && !document.querySelector("dialog[open]")) mostrarAparelhoNovo(alvo, novos, data);
  } catch (e) { console.warn("conferir aparelhos:", e?.message || e); } finally { conferindoAparelhos = false; if (conferirDepois) { const p = conferirDepois; conferirDepois = null; conferirAparelhos(p.mostrar, p.forcaRegistro); } }
}
function mostrarAparelhoNovo(a, novos, lista = []) {
  const d = $("novo-aparelho"); d.dataset.sessao = a.session_id;
  $("na-aparelho").textContent = `${a.navegador} no ${a.sistema}`;
  const local = localDe(a); $("na-local").textContent = local.replace(" (aproximado)", ""); $("na-local-nota").textContent = local.includes("aproximado") ? "aproximado, pelo endereço de internet" : "";
  $("na-quando").textContent = quando(a.entrou_em);
  const risco = riscoDeLocal(a, lista); $("na-risco").hidden = !risco; $("na-risco").className = "risco-caixa " + (risco?.nivel || ""); $("na-risco").textContent = risco ? "Atenção: " + risco.texto : "";
  const mais = novos.length - 1; $("na-mais").hidden = mais < 1; $("na-mais").textContent = mais === 1 ? "Há mais 1 aparelho novo para conferir (em Aparelhos conectados)." : `Há mais ${mais} aparelhos novos para conferir (em Aparelhos conectados).`;
  d.showModal(); $("novo-nao").focus({ preventScroll: true });
}
{ const d = $("novo-aparelho");
  d.onclose = () => { if (d.dataset.sessao) dispensados.add(d.dataset.sessao); }; // fechou sem decidir: some por agora, e o ponto rosa continua lembrando
  d.addEventListener("click", (e) => { const r = d.getBoundingClientRect(); if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) d.close(); });
  $("novo-sim").onclick = async () => { const id = d.dataset.sessao; d.close(); await decidirAparelho(id, "reconhecido"); conferirAparelhos(true); };
  $("novo-nao").onclick = async () => { const id = d.dataset.sessao; d.close(); await decidirAparelho(id, "recusado"); await abrirSeguranca(); $("mfa-senha").click(); }; } // (abre a Segurança ANTES: senão a janela da senha ficaria escondida embaixo dela)
$("mfa-aparelhos").onclick = () => { $("aparelhos").showModal(); desenharAparelhos(); };
$("aparelhos-senha").onclick = () => { $("aparelhos").close(); $("mfa-senha").click(); };

// ---------- Aparelhos da conta (que recebem mensagens): este aparelho se identifica, o 1º entra permitido e os outros esperam um aparelho permitido liberar ----------
// Nesta etapa é só o estado e o aviso: o envio e o recebimento de mensagens não dependem disso.
let aparelhoPronto = Promise.resolve(), meuAparelhoId = null, dispResumo = resumoDisp([]), conferindoDisp = false, ultimaConfDisp = 0;
const cacheAparelhos = new Map(); // id da pessoa -> { t, lista }: aparelhos aprovados (com chave de recepção) de cada pessoa, guardados por pouco tempo
async function idDoAparelho() { // código aleatório deste navegador para esta conta; fica cifrado no aparelho e só some em "Sair e apagar chaves" (o servidor o guarda, mas nunca o devolve)
  return withLock(`lacre:aparelho:${me.id}`, async () => {
    const g = await metaGet(me.id, "aparelho"); if (g && idValido(g.id)) return g.id;
    const id = novoId(); await metaPut(me.id, "aparelho", { id }); return id;
  });
}
async function registrarDispositivo() {
  try {
    const id = await idDoAparelho(), { error } = await sb.rpc("registrar_dispositivo", { p_id: id });
    if (error) throw error; meuAparelhoId = id; await carregarDispositivos(); return true;
  } catch (e) { console.warn("registrar aparelho:", e?.message || e); return false; }
}
async function carregarDispositivos() {
  const { data, error } = await sb.rpc("dispositivos_conta"); if (error) throw error;
  dispResumo = resumoDisp(data); return dispResumo;
}
const meuRef = () => (dispResumo.souAprovado && ehRef(dispResumo.eu?.ref) ? dispResumo.eu.ref : null); // o código público deste aparelho, se ele já é permitido
const maisDeUmAparelho = () => dispResumo.lista.filter((a) => a.estado === "aprovado").length > 1;
const quandoCurto = (iso) => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; };
function pintarAvisoDispositivos() {
  const b = $("aviso-disp"), r = dispResumo;
  const rec = r.souAprovado ? r.recuperacoes[0] : null;
  const txt = r.souPendente ? "Aguardando permissão de outro aparelho da sua conta."
    : rec ? `Pedido de recuperação da conta: um aparelho novo vai assumir a conta e remover os outros em ${quandoCurto(rec.vale_em)}, se ninguém recusar. Toque para ver.`
    : r.souAprovado && r.pendentes.length ? textoPendentes(r.pendentes.length) + " Toque para ver." : "";
  b.hidden = !txt; b.textContent = txt; b.dataset.estado = r.souPendente ? "pendente" : rec ? "recuperacao" : "pedido";
}
// Recusar ou remover um aparelho encerra a sessão dele no servidor: ele percebe aqui e volta para o login (erro de rede NÃO conta: só sessão recusada ou ausente)
async function sessaoEncerrada() { try { const { error } = await sb.auth.getUser(); return !!error && ([401, 403].includes(error.status) || error.name === "AuthSessionMissingError"); } catch { return false; } } // (sessão apagada no servidor: o Supabase devolve "sessão ausente"; falha de rede é outro erro e não conta)
async function sairDeVez() { await sb.auth.signOut({ scope: "local" }).catch(() => {}); location.reload(); }
async function conferirDispositivos(forca = false) {
  if (!me || conferindoDisp || (!forca && Date.now() - ultimaConfDisp < 3000)) return;
  conferindoDisp = true; ultimaConfDisp = Date.now();
  try {
    await aparelhoPronto;
    let r = await carregarDispositivos();
    if (!r.eu) { // sessão nova (ou aparelho recusado/removido, que perdeu a sessão): registra de novo
      if (await registrarDispositivo()) { r = dispResumo; if (r.souPendente) return location.reload(); ensureSpk(); }
      else if (await sessaoEncerrada()) return sairDeVez();
    }
    cacheAparelhos.clear(); // (a lista de aparelhos de cada contato é refeita no próximo envio)
    pintarAvisoDispositivos(); if ($("aparelhos").open) desenharDispositivos();
  } catch (e) { console.warn("conferir aparelhos da conta:", e?.message || e); if (/42501|nao_autorizado|JWT/i.test(`${e?.code} ${e?.message}`) && await sessaoEncerrada()) return sairDeVez(); } finally { conferindoDisp = false; }
}
$("aviso-disp").onclick = () => { $("aparelhos").showModal(); desenharAparelhos(); };
function botaoDisp(txt, cls, fn) { const b = el("button", cls, txt); b.type = "button"; b.onclick = async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }; return b; }
async function decidirDisp(a, permitir) {
  const { data, error } = await sb.rpc("decidir_dispositivo", { p_ref: a.ref, p_permitir: permitir });
  if (error || data !== true) await note(error ? erroDisp(error) : "Não foi possível agora. Atualize a lista e tente de novo.");
  await conferirDispositivos(true);
}
async function removerDisp(a) {
  const eu = a.atual;
  const r = await choose(eu ? "Remover este aparelho?" : `Remover ${nomeDoAparelho(a)}?`,
    eu ? "Este aparelho sai da lista da conta e a sessão dele é encerrada aqui. Para voltar, entre de novo (ele pedirá permissão se a conta já tiver outro aparelho)." : "Ele sai da lista da conta e é desconectado agora. Para voltar, precisa entrar de novo com a senha e esperar uma nova permissão.",
    [{ label: "Remover", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  const { data, error } = await sb.rpc("remover_dispositivo", { p_ref: a.ref });
  if (error || data !== true) { await note(error ? erroDisp(error) : "Não foi possível agora. Atualize a lista e tente de novo."); return conferirDispositivos(true); }
  if (eu) { await removerRegistroPush(); try { await metaPut(me.id, "aparelho", null); } catch {} await sb.auth.signOut({ scope: "local" }); location.reload(); return; }
  await conferirDispositivos(true);
}
function desenharDispositivos() {
  const lista = $("dispositivos-lista"), r = dispResumo;
  $("disp-aviso").hidden = !r.souPendente; $("disp-aviso").textContent = r.souPendente ? AVISO_PENDENTE : "";
  const ped = $("disp-pedido"); ped.hidden = !(r.souAprovado && r.pendentes.length); ped.textContent = textoPendentes(r.pendentes.length);
  const rc = $("disp-recup"), rec = r.souAprovado ? r.recuperacoes[0] : null; rc.hidden = !rec;
  rc.textContent = rec ? `Pedido de recuperação da conta, feito em ${quandoCurto(rec.recuperacao_em)}. Se ninguém recusar, vale em ${quandoCurto(rec.vale_em)}: esse aparelho assume a conta e TODOS os outros (inclusive este) são removidos. Se não foi você, toque em Recusar.` : "";
  if (!r.lista.length) return lista.replaceChildren(el("p", "pg-dica sem-recuo", "Carregando…"));
  lista.replaceChildren(...r.lista.map((a) => {
    const row = el("div", "linha info" + (a.atual ? " atual" : "")), ic = el("span", "ic"), tx = el("span", "tx"), linhaTit = el("span", "ap-tit");
    ic.append(svgAparelho(a.tipo)); row.dataset.ref = a.ref; row.dataset.estado = a.estado;
    linhaTit.append(el("b", null, nomeDoAparelho(a)));
    if (a.atual) linhaTit.append(el("span", "selo-estado", "Este aparelho"));
    linhaTit.append(a.estado === "pendente" ? el("span", "selo-novo", "Aguardando permissão") : el("span", "selo-estado ativo", "Permitido"));
    tx.append(linhaTit, el("small", null, localDe(a)), el("small", null, `Entrou em ${quando(a.criado_em)}`));
    if (a.estado === "pendente" && a.recuperacao_em) tx.append(el("small", "recup", `Pediu a recuperação da conta; vale em ${quandoCurto(a.vale_em)}`));
    const ac = el("span", "ap-acoes");
    if (a.estado === "pendente" && !a.atual && r.souAprovado) ac.append(botaoDisp("Permitir", "ghost", () => decidirDisp(a, true)), botaoDisp("Recusar", "ghost perigo", async () => { if (await choose(`Recusar ${nomeDoAparelho(a)}?`, "O pedido é recusado e esse aparelho é desconectado. Para tentar de novo, ele precisa entrar com a senha outra vez.", [{ label: "Recusar", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]) === "sim") await decidirDisp(a, false); }));
    else if (a.atual || r.souAprovado) ac.append(botaoDisp(a.atual ? "Remover este aparelho" : "Remover", "ghost perigo", () => removerDisp(a)));
    if (ac.childElementCount) tx.append(ac);
    row.append(ic, tx); return row;
  }));
}
async function abrirDispositivos() { desenharDispositivos(); await conferirDispositivos(true); }

// ---------- Aparelho pendente: tela cheia "Aguardando permissão" (sem conversas, sem chaves de recepção, sem tempo real) ----------
let esperaQuando = 0;
function iniciarEspera() {
  $("chat").hidden = true; $("abrindo").hidden = true; $("espera").hidden = false; document.body.dataset.espera = "1";
  const confere = () => conferirEspera();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) confere(); }); addEventListener("focus", confere);
  setInterval(() => { if (!document.hidden) confere(); }, 8000); setInterval(pintarEspera, 1000);
  esperaQuando = Date.now(); pintarEspera(); registrarAparelho(true); confere(); // (o acesso desta sessão é registrado: é o que dá nome ao aparelho na lista e faz os outros aparelhos receberem o aviso de "aparelho novo")
}
async function conferirEspera() {
  if (conferindoDisp) return; conferindoDisp = true;
  try {
    registrarAparelho();
    let r = await carregarDispositivos();
    if (!r.eu) { if (await registrarDispositivo()) r = dispResumo; else if (await sessaoEncerrada()) return sairDeVez(); }
    if (r.souAprovado) return location.reload(); // foi permitido (ou concluiu a recuperação): entra sozinho
    esperaQuando = Date.now(); pintarEspera();
  } catch (e) { console.warn("espera:", e?.message || e); if (/42501|nao_autorizado|JWT/i.test(`${e?.code} ${e?.message}`) && await sessaoEncerrada()) return sairDeVez(); }
  finally { conferindoDisp = false; }
}
function pintarEspera() {
  const eu = dispResumo.eu; if (!eu || $("espera").hidden) return;
  const pedido = !!(eu.recuperacao_em && eu.vale_em), falta = pedido ? Math.max(0, faltaMs(eu.vale_em, eu.agora) - (Date.now() - esperaQuando)) : null;
  $("espera-caixa-pedido").hidden = !pedido; if (pedido) { $("espera-caixa-pedir").hidden = true; $("espera-perdi").hidden = true; }
  else $("espera-perdi").hidden = !$("espera-caixa-pedir").hidden;
  if (pedido) {
    $("espera-pedido-txt").textContent = falta > 0 ? `Pedido de recuperação feito em ${quandoCurto(eu.recuperacao_em)}. Faltam ${textoFalta(falta)} (vale em ${quandoCurto(eu.vale_em)}). ${AVISO_RECUPERACAO} Qualquer aparelho conectado pode recusar até lá.`
      : `Prazo cumprido. ${AVISO_RECUPERACAO} Toque em Concluir para assumir a conta.`;
    $("espera-concluir").disabled = falta > 0;
  }
}
$("espera-perdi").onclick = () => { $("espera-caixa-pedir").hidden = false; $("espera-perdi").hidden = true; };
$("espera-sair").onclick = () => sairDeVez();
$("espera-pedir").onclick = async () => {
  if (await choose("Pedir a recuperação da conta?", "Daqui a 24 horas, se nenhum aparelho conectado recusar, este aparelho passa a valer e todos os outros aparelhos da conta são removidos e desconectados.", [{ label: "Pedir recuperação", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]) !== "sim") return;
  const { data, error } = await sb.rpc("pedir_recuperacao");
  if (error || !data) await note(error ? erroDisp(error) : "Não foi possível agora. Tente de novo."); await conferirEspera();
};
$("espera-cancelar").onclick = async () => { const { error } = await sb.rpc("cancelar_recuperacao"); if (error) await note(erroDisp(error)); $("espera-caixa-pedir").hidden = true; await conferirEspera(); };
$("espera-concluir").onclick = async () => {
  if (await choose("Concluir a recuperação?", "Todos os outros aparelhos da conta serão removidos e desconectados agora, e este passa a ser o único aparelho permitido.", [{ label: "Concluir", value: "sim", cls: "primary" }, { label: "Agora não", value: "", cls: "ghost" }]) !== "sim") return;
  const { data, error } = await sb.rpc("concluir_recuperacao");
  if (error || data !== true) { await note(error ? erroDisp(error) : "Ainda não deu o prazo, ou o pedido foi recusado. Atualizei a tela."); return conferirEspera(); }
  location.reload();
};

// ---------- Armazenamento: o que este aparelho guarda e o que você já enviou ao servidor ----------
const MB = 1048576, LIMITE_SERVIDOR = 400 * MB; // (o mesmo limite por pessoa que o servidor aplica)
const fmtBytes = (n) => (n >= MB ? (n / MB).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : n > 0 && n < 1024 ? "< 1 KB" : Math.round(n / 1024) + " KB");
function pintaUso(id, bytes, limite) { const i = $(id); i.style.width = Math.min(100, Math.max(bytes > 0 ? 2 : 0, (bytes / limite) * 100)) + "%"; i.classList.toggle("cheio", bytes / limite >= 0.8); }
async function desenharArmazenamento() {
  try {
    const u = await usoLocal(me.id), c = u.cache;
    $("arm-cache-txt").textContent = `${fmtBytes(c.bytes)} de no máximo ${fmtBytes(BLOB_MAX)} · ${c.arquivos} ${c.arquivos === 1 ? "arquivo" : "arquivos"}`; pintaUso("arm-cache-bar", c.bytes, BLOB_MAX);
    $("arm-hist-txt").textContent = `${u.mensagens} ${u.mensagens === 1 ? "mensagem guardada" : "mensagens guardadas"}, só o texto e os dados, cifrados`; $("arm-hist-tam").textContent = fmtBytes(u.historicoBytes);
    $("arm-stk-txt").textContent = `${u.figurinhas} ${u.figurinhas === 1 ? "figurinha" : "figurinhas"}`; $("arm-stk-tam").textContent = fmtBytes(u.figurinhasBytes);
    $("arm-limpar").disabled = c.arquivos === 0; $("arm-resumo").textContent = `${fmtBytes(c.bytes)} neste aparelho`;
  } catch { $("arm-cache-txt").textContent = "Não foi possível ler agora."; }
  $("arm-srv-txt").textContent = "Calculando…"; pintaUso("arm-srv-bar", 0, 1);
  const { data, error } = await sb.rpc("meu_uso_arquivos");
  if (error || !data?.[0]) { $("arm-srv-txt").textContent = "Não foi possível ver agora. Tente de novo mais tarde."; return; }
  const n = Number(data[0].arquivos) || 0, bytes = Number(data[0].bytes) || 0;
  $("arm-srv-txt").textContent = `${fmtBytes(bytes)} de ${fmtBytes(LIMITE_SERVIDOR)} · ${n} ${n === 1 ? "arquivo" : "arquivos"}`; pintaUso("arm-srv-bar", bytes, LIMITE_SERVIDOR);
}
$("arm-btn").onclick = async () => { $("arm-msg").textContent = ""; $("arm-srv-txt").textContent = "Calculando…"; $("armaz").showModal(); await desenharArmazenamento(); }; // (limpa antes de abrir: nunca aparece o valor da vez anterior)
$("arm-limpar").onclick = async () => {
  const r = await choose("Liberar espaço?", "Apaga só as fotos, áudios, vídeos e figurinhas baixados neste aparelho. Nenhuma mensagem será apagada. Quando você abrir um arquivo de novo, ele baixa outra vez.", [
    { label: "Liberar espaço", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  try { const antes = (await blobsUsados(me.id)).bytes; await limparBlobs(me.id); $("arm-msg").textContent = `Pronto: ${fmtBytes(antes)} liberados.`; }
  catch { $("arm-msg").textContent = ""; await note("Não foi possível liberar o espaço agora. Tente de novo."); }
  await desenharArmazenamento();
};

// ---------- Aparência: automática (segue o aparelho), clara ou escura ----------
const TEMAS = ["auto", "claro", "escuro"], NOME_TEMA = { auto: "automática", claro: "clara", escuro: "escura" };
let tema = "auto"; try { const t = localStorage.getItem("lacre:tema"); if (TEMAS.includes(t)) tema = t; } catch {}
function aplicarTema() {
  const r = document.documentElement; if (tema === "auto") delete r.dataset.tema; else r.dataset.tema = tema;
  $("tema-estado").textContent = NOME_TEMA[tema]; $("tema-btn").setAttribute("aria-label", `Aparência: ${NOME_TEMA[tema]}. Tocar para trocar`);
}
$("tema-btn").onclick = () => { tema = TEMAS[(TEMAS.indexOf(tema) + 1) % TEMAS.length]; try { localStorage.setItem("lacre:tema", tema); } catch {} aplicarTema(); };
aplicarTema();

// ---------- Chamar um amigo (botão flutuante) ----------
$("chamar-fab").onclick = () => { $("chamar").showModal(); $("add-user").focus(); };

// ---------- Meu nome (o que os amigos digitam para me chamar) ----------
let nomeTimer = 0;
async function copiarTexto(txt, origem) { // área de transferência; se o navegador não deixar, seleciona o texto para copiar à mão
  try { await navigator.clipboard.writeText(txt); return true; } catch {}
  try { const r = document.createRange(); r.selectNodeContents(origem); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); const ok = document.execCommand("copy"); sel.removeAllRanges(); return ok; } catch { return false; }
}
$("copiar-nome").onclick = async () => {
  const nome = $("nome-txt").textContent; if (!nome) return;
  const ok = await copiarTexto(nome, $("nome-txt"));
  const t = $("nome-aviso"); t.textContent = ok ? "Copiado ✓" : "Não deu para copiar: segure no nome"; t.hidden = false; $("nome-rot").hidden = true;
  clearTimeout(nomeTimer); nomeTimer = setTimeout(() => { t.hidden = true; $("nome-rot").hidden = false; }, 2200);
};
// ----- trocar o nome de usuário (o banco confere tudo: formato, nome já existente ou reservado, e o prazo entre trocas) -----
const erroNome = (e) => { const m = e?.message || "";
  if (/nome_em_uso/.test(m) || e?.code === "23505") return "Esse nome já existe (ou é o nome antigo de alguém e ainda está reservado). Escolha outro.";
  if (/troca_cedo/.test(m)) { const d = dataLiberada(e.details); return d ? `Você já trocou o nome há pouco. Pode trocar de novo a partir de ${d.toLocaleDateString("pt-BR")}.` : "Você já trocou o nome há pouco. Tente de novo mais tarde."; }
  if (/nome_invalido/.test(m)) return "Use de 3 a 20 letras minúsculas sem acento, números ou _."; if (/mesmo_nome/.test(m)) return "Esse já é o seu nome.";
  return limitado(e) ? "Muitas tentativas seguidas. Espere um minuto." : "Não foi possível trocar agora. Tente de novo."; };
async function nomeTrocado(novo) {
  msgPerfil("Avisando seus contatos…", true); me.username = novo; try { localStorage.setItem("lacre:eu:" + me.id, "@" + novo); } catch {}
  await atualizarGrupos(true).catch(() => {});
  const gente = new Map(contacts); for (const g of grupos.values()) for (const p of g.membros.values()) gente.set(p.id, p); // avisa contatos e participantes de grupos: eles atualizam na hora
  // (espera o envio terminar: se a pessoa recarregar a página logo depois da troca, o aviso não pode se perder pelo caminho)
  await enviarVarios([...gente.values()].filter((p) => p.id !== me.id), { type: "hello", gr: 1, pf: 1 }, { avisar: false }).catch((e) => console.warn("aviso de troca de nome:", e?.code, e?.message || e));
  for (const id of ["me", "nome-txt", "perfil-nome"]) $(id).textContent = "@" + novo; pintarMeu(); msgPerfil(`Pronto: você agora é @${novo}.`, true);
}
$("perfil-trocar").onclick = async () => {
  msgPerfil("");
  let dica = `Digite o novo nome (3 a 20 letras minúsculas sem acento, números ou _). Só dá para trocar uma vez a cada ${DIAS_TROCA} dias, e o nome antigo fica reservado por ${DIAS_TROCA} dias.`, novo;
  for (;;) {
    const v = await ask("Trocar nome de usuário", dica, { texto: true, valor: "@" + me.username, max: 21 }); if (v === null) return;
    novo = limpaUsuario(v); if (!novo) { dica = "Use de 3 a 20 letras minúsculas sem acento, números ou _."; continue; }
    if (novo === me.username) { dica = "Esse já é o seu nome. Digite outro."; continue; } break;
  }
  const r = await choose(`Trocar para @${novo}?`, `Seus contatos veem o aviso "@${me.username} agora é @${novo}". O nome @${me.username} fica reservado só para você por ${DIAS_TROCA} dias, e você só poderá trocar de novo depois desse prazo.`, [{ label: "Trocar o nome", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  const { data, error } = await sb.rpc("trocar_nome", { p_novo: novo }); if (error) return msgPerfil(erroNome(error));
  await nomeTrocado(data || novo);
};
$("perfil-copiar").onclick = async () => msgPerfil(await copiarTexto($("perfil-nome").textContent, $("perfil-nome")) ? "Nome copiado ✓" : "Não deu para copiar: segure no nome", true);

// ---------- Foto de perfil ----------
const fotoCache = new Map(); // caminho -> blob: URL (o nome do arquivo muda a cada foto nova, então nunca fica velho)
async function fotoUrl(path) {
  if (typeof path !== "string" || !CAMINHO_OK.test(path)) return null;
  if (fotoCache.has(path)) return fotoCache.get(path);
  let bytes = await getBlob(me.id, "avatar:" + path).catch(() => null), tipo = path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  if (!bytes) {
    const { data, error } = await sb.storage.from("avatars").download(path);
    if (error) return null;
    bytes = new Uint8Array(await data.arrayBuffer()); if (bytes.byteLength > 150 * 1024) return null;
    putBlob(me.id, "avatar:" + path, bytes).catch(() => {});
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo })); fotoCache.set(path, url); return url;
}
// mostra a foto (ou a inicial do nome enquanto não há foto / carrega)
function pintarAvatar(node, p, abrivel = false) {
  node.classList.remove("grupo");
  node.replaceChildren(); node.textContent = p.username[0]; node.dataset.foto = p.avatar || "";
  if (abrivel) { node.onclick = null; node.classList.remove("abre"); node.removeAttribute("title"); if (node.tagName === "BUTTON") node.disabled = true; }
  if (!p.avatar) return;
  if (abrivel) { // tocar na foto abre ela grande (na lista, sem abrir a conversa junto)
    node.classList.add("abre"); node.title = "Ver a foto de @" + p.username; if (node.tagName === "BUTTON") node.disabled = false;
    node.onclick = (e) => { e.stopPropagation(); e.preventDefault(); abrirFoto(p, node); };
  }
  fotoUrl(p.avatar).then((url) => {
    if (!url || node.dataset.foto !== p.avatar) return;
    const im = el("img"); im.alt = ""; im.src = url; im.draggable = false; node.replaceChildren(im);
  }).catch(() => {});
}
// ---------- Foto ampliada (com animação: a foto "voa" do lugar onde está até o centro, e volta ao fechar) ----------
let origemViewer = null, fechandoViewer = false;
const EASE = "cubic-bezier(.2,.8,.2,1)";
function transformaDe(origem, im) { // do centro da foto grande até o lugar da miniatura
  const a = origem.getBoundingClientRect(), b = im.getBoundingClientRect();
  return `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})`;
}
function abrirViewer(url, alt, { perfil = false, origem = null } = {}) {
  const d = $("viewer"), im = $("viewer-img"); fechandoViewer = false; d.classList.remove("saindo");
  im.className = perfil ? "perfil" : ""; im.alt = alt; im.src = url; origemViewer = origem; d.showModal();
  if (reduced) return;
  if (origem?.isConnected) im.animate([{ transform: transformaDe(origem, im), borderRadius: "50%" }, { transform: "none", borderRadius: getComputedStyle(im).borderRadius }], { duration: 340, easing: EASE });
  else im.animate([{ transform: "scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: EASE });
}
async function fecharViewer() {
  const d = $("viewer"), im = $("viewer-img"); if (!d.open || fechandoViewer) return;
  if (reduced) return d.close();
  fechandoViewer = true; d.classList.add("saindo");
  const o = origemViewer?.isConnected ? origemViewer : null;
  const anim = o ? im.animate([{ transform: "none", borderRadius: getComputedStyle(im).borderRadius }, { transform: transformaDe(o, im), borderRadius: "50%" }], { duration: 260, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" })
    : im.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.92)", opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" });
  await anim.finished.catch(() => {});
  d.close(); d.classList.remove("saindo"); anim.cancel(); fechandoViewer = false;
}
// grupo: quadrado de cantos redondos com a inicial do nome (pessoas são círculos)
const fotoGrupoCache = new Map(); // caminho do arquivo -> blob: URL (o caminho muda a cada foto nova, então nunca fica velho)
async function fotoDoGrupo(g) { // baixa o arquivo cifrado, abre com a chave do grupo e devolve uma URL local
  const f = g.foto; if (!f || !g.gk) return null;
  if (fotoGrupoCache.has(f.p)) return fotoGrupoCache.get(f.p);
  let enc = await getBlob(me.id, f.p).catch(() => null);
  if (!enc) { const { data, error } = await sb.storage.from("media").download(f.p); if (error) return null; enc = new Uint8Array(await data.arrayBuffer()); if (enc.byteLength > 400 * 1024) return null; putBlob(me.id, f.p, enc).catch(() => {}); }
  let bytes; try { bytes = await abrirFotoCifrada(g.gk, g.id, enc, f.iv); } catch { delBlob(me.id, f.p).catch(() => {}); return null; }
  const tipo = bytes[8] === 0x57 ? "image/webp" : "image/jpeg"; // (WebP começa com "RIFF....WEBP")
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo })); fotoGrupoCache.set(f.p, url); return url;
}
function pintarAvatarGrupo(node, g, abreDados = false) {
  node.replaceChildren(); node.dataset.foto = g.foto?.p || ""; node.classList.add("grupo"); node.classList.remove("abre"); node.removeAttribute("title");
  node.textContent = [...(g.nome || "G")][0];
  if (node.tagName === "BUTTON") { node.disabled = !abreDados; node.onclick = abreDados ? () => abrirInfoGrupo(g) : null; }
  if (g.foto) fotoDoGrupo(g).then((url) => { if (!url || node.dataset.foto !== g.foto?.p) return; const im = el("img"); im.alt = ""; im.src = url; im.draggable = false; node.replaceChildren(im); }).catch(() => {});
}
function svgIcone(caminhos, tam = 22) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: tam, height: tam, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  for (const d of caminhos) { const pa = document.createElementNS(ns, "path"); pa.setAttribute("d", d); svg.append(pa); }
  return svg;
}
const pintarMeu = () => { pintarAvatar($("eu-foto"), me); pintarAvatar($("menu-av"), me); };
async function abrirFoto(p, origem) {
  const url = await fotoUrl(p.avatar).catch(() => null); if (!url) return;
  abrirViewer(url, "Foto de perfil de @" + p.username, { perfil: true, origem });
}
// ----- nomes de usuário que mudam -----
function guardaNomes() { const o = {}; for (const [id, p] of contacts) o[id] = p.username; gravarLS("nomes", o); }
async function aplicarNome(id, nome, de) { // um contato (ou participante de grupo) trocou o nome de usuário
  const c = contacts.get(id) || perfis.get(id); if (!c || typeof nome !== "string") return;
  const antes = de || c.username; c.username = nome; const o = perfis.get(id); if (o) o.username = nome;
  if (antes === nome) return;
  const k = "d:" + id, est = (await metaGet(me.id, k).catch(() => null)) || { avisos: [] };
  est.avisos = [...(est.avisos || []), { tipo: "renomeou", de: antes, nome, t: Date.now() }].slice(-30); await metaPut(me.id, k, est).catch(() => {}); // (o aviso fica na conversa, no lugar certo, mesmo depois de recarregar)
  renderContacts(); guardaNomes();
  if (active?.id === id && !active.grupo) { $("conv-title").textContent = "@" + nome; $("msgs-empty")?.remove(); addAviso(textoAviso({ tipo: "renomeou", de: antes, nome })); }
}
async function atualizarPerfisContatos() { // alguém avisou que o perfil mudou: busca os nomes e fotos atuais
  const ids = [...contacts.keys()]; if (!ids.length) return;
  const { data } = await sb.from("profiles").select("id,username,avatar").in("id", ids);
  for (const p of data || []) { const c = contacts.get(p.id); if (!c) continue; if (p.username !== c.username) await aplicarNome(p.id, p.username); if ((p.avatar || null) !== (c.avatar || null)) c.avatar = p.avatar; }
  renderContacts(); guardaNomes();
}
async function atualizaFotoDe(peer) { // pega a foto (e o nome) mais nova de quem estou conversando
  const { data } = await sb.from("profiles").select("avatar,username").eq("id", peer.id).maybeSingle();
  if (data?.username && data.username !== peer.username) await aplicarNome(peer.id, data.username);
  if (data && (data.avatar || null) !== (peer.avatar || null)) { peer.avatar = data.avatar; renderContacts(); if (active === peer) pintarAvatar($("conv-av"), peer, true); }
}
const perfil = { img: null, w: 0, h: 0, zoom: 1, cx: 0.5, cy: 0.5, novo: false };
function desenhaPerfil() {
  const cv = $("perfil-cv"), ctx = cv.getContext("2d");
  if (perfil.img) desenhar(ctx, perfil.img, perfil.w, perfil.h, perfil.zoom, perfil.cx, perfil.cy, LADO);
}
async function mostraFotoAtualNoPerfil() {
  const cv = $("perfil-cv"), ctx = cv.getContext("2d"); ctx.clearRect(0, 0, LADO, LADO);
  perfil.img = null; perfil.novo = false;
  const url = me.avatar ? await fotoUrl(me.avatar) : null;
  if (url) { const im = new Image(); im.src = url; await im.decode().catch(() => {}); ctx.drawImage(im, 0, 0, LADO, LADO); }
  else { ctx.fillStyle = "#3A3F9E"; ctx.fillRect(0, 0, LADO, LADO); ctx.fillStyle = "#fff"; ctx.font = "700 110px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(me.username[0].toUpperCase(), LADO / 2, LADO / 2 + 6); }
  $("perfil-zoom").hidden = true; $("perfil-salvar").hidden = true; $("perfil-remover").hidden = !me.avatar;
  $("perfil-escolher").setAttribute("aria-label", me.avatar ? "Trocar foto" : "Escolher foto"); $("perfil-nome").textContent = "@" + me.username;
}
function msgPerfil(t, ok) { const m = $("perfil-msg"); m.textContent = t; m.className = ok ? "ok" : ""; }
$("menu-foto").onclick = async () => { msgPerfil(""); $("perfil").showModal(); await mostraFotoAtualNoPerfil(); };
$("perfil-escolher").onclick = () => $("perfil-file").click();
$("perfil-file").onchange = async () => {
  const f = $("perfil-file").files[0]; $("perfil-file").value = ""; if (!f) return;
  if (!TIPOS_ENTRADA.test(f.type)) return msgPerfil("Escolha uma imagem (JPG, PNG ou WebP).");
  if (f.size > 20 * 1048576) return msgPerfil("Essa foto é grande demais (máximo 20 MB).");
  try {
    const bmp = await createImageBitmap(f);
    Object.assign(perfil, { img: bmp, w: bmp.width, h: bmp.height, zoom: 1, cx: 0.5, cy: 0.5, novo: true });
  } catch { return msgPerfil("Não consegui abrir essa imagem. Tente outra."); }
  msgPerfil("Arraste para enquadrar e use o zoom.", true);
  const z = $("perfil-zoom"); z.value = 1; z.hidden = false; $("perfil-salvar").hidden = false; $("perfil-remover").hidden = true; desenhaPerfil();
};
$("perfil-zoom").oninput = () => { perfil.zoom = Number($("perfil-zoom").value); desenhaPerfil(); };
{ // arrastar a foto dentro do círculo
  const cv = $("perfil-cv"); let ult = null;
  cv.onpointerdown = (e) => { if (!perfil.novo) return; ult = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => {
    if (!ult || !perfil.novo) return;
    const lado = Math.min(perfil.w, perfil.h) / perfil.zoom, k = lado / cv.getBoundingClientRect().width; // pixels da foto por pixel da tela
    perfil.cx = Math.min(1, Math.max(0, perfil.cx - ((e.clientX - ult.x) * k) / perfil.w));
    perfil.cy = Math.min(1, Math.max(0, perfil.cy - ((e.clientY - ult.y) * k) / perfil.h));
    ult = { x: e.clientX, y: e.clientY }; desenhaPerfil();
  };
  cv.onpointerup = cv.onpointercancel = () => { ult = null; };
}
async function trocarAvatar(novoPath, blob) { // envia, aponta o perfil para ele e só então apaga o antigo
  const velho = me.avatar;
  if (blob) {
    const up = await sb.storage.from("avatars").upload(novoPath, blob, { contentType: blob.type, upsert: false });
    if (up.error) throw up.error;
  }
  const { error } = await sb.from("profiles").update({ avatar: novoPath }).eq("id", me.id);
  if (error) { if (blob) sb.storage.from("avatars").remove([novoPath]).catch(() => {}); throw error; }
  me.avatar = novoPath;
  if (velho && velho !== novoPath) sb.storage.from("avatars").remove([velho]).catch(() => {});
}
$("perfil-salvar").onclick = async () => {
  const b = $("perfil-salvar"); b.disabled = true; msgPerfil("Salvando…", true);
  try {
    const blob = await codificar($("perfil-cv"));
    if (!blob) throw new Error("grande");
    await trocarAvatar(caminhoNovo(me.id, blob), blob);
    pintarMeu(); await mostraFotoAtualNoPerfil(); msgPerfil("Foto atualizada ✓", true);
  } catch (e) { msgPerfil(limitado(e) ? "Muitas tentativas seguidas. Espere um minuto." : "Não foi possível salvar a foto. Tente de novo."); }
  b.disabled = false;
};
$("perfil-remover").onclick = async () => {
  const b = $("perfil-remover"); b.disabled = true;
  try { await trocarAvatar(null, null); pintarMeu(); await mostraFotoAtualNoPerfil(); msgPerfil("Foto removida.", true); }
  catch { msgPerfil("Não foi possível remover agora. Tente de novo."); }
  b.disabled = false;
};

// ---------- Contatos ----------
function tocaAtiv(id, quando) { const t = typeof quando === "number" ? quando : Date.parse(quando); if (t > (ativ.get(id) || 0)) ativ.set(id, t); }
async function loadContacts() {
  // conversas a dois (as mensagens de grupo ficam de fora: estar num grupo com alguém não cria uma conversa com essa pessoa)
  const [{ data }, { data: doGrupo }] = await Promise.all([
    sb.from("messages").select("sender_id,recipient_id,created_at").is("grupo_id", null).eq("avisar", true).order("created_at", { ascending: false }).limit(200), // (avisar=false são toques automáticos, não conversa)
    sb.from("messages").select("grupo_id,created_at").not("grupo_id", "is", null).order("id", { ascending: false }).limit(200)]); // (as minhas e as dos outros)
  for (const m of data || []) { if (m.sender_id === m.recipient_id) continue; const c = m.sender_id === me.id ? m.recipient_id : m.sender_id; tocaAtiv(c, m.created_at); ultimaDoServidor(c, m.created_at); }
  for (const m of doGrupo || []) { tocaAtiv(m.grupo_id, m.created_at); ultimaDoServidor(m.grupo_id, m.created_at); }
  const ids = [...new Set((data || []).flatMap((m) => [m.sender_id, m.recipient_id]))].filter((i) => i !== me.id);
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("id,username,public_key,avatar").in("id", ids);
    const vistos = lerLS("nomes") || {}; // nomes que cada contato tinha da última vez: se mudou, aparece o aviso "@antigo agora é @novo"
    for (const p of ps || []) { const antigo = contacts.get(p.id)?.username ?? vistos[p.id]; contacts.set(p.id, p); perfis.set(p.id, p); if (antigo && antigo !== p.username) await aplicarNome(p.id, p.username, antigo); }
    guardaNomes();
  }
  await atualizarGrupos().catch(() => {});
  renderContacts();
}
$("busca").oninput = () => renderContacts();
const nomeConv = (c) => (c.grupo ? c.nome : c.username);
const listaConversas = () => [...contacts.values(), ...grupos.values()].map((c, i) => ({ c, i, t: ativ.get(c.id) || 0 })).sort((a, b) => b.t - a.t || a.i - b.i).map((x) => x.c); // a mais recente primeiro
function renderContacts() {
  const total = contacts.size + grupos.size;
  $("inbox-empty").hidden = total > 0;
  $("busca-box").hidden = total < 6; // a busca só aparece quando a lista já é grande
  const q = $("busca-box").hidden ? "" : $("busca").value.trim().replace(/^@/, "").toLowerCase();
  $("contacts").replaceChildren(...listaConversas().filter((p) => !q || nomeConv(p).toLowerCase().includes(q)).map((p) => {
    const li = document.createElement("li"), b = document.createElement("button");
    const av = document.createElement("span"), nm = document.createElement("span");
    nm.className = "who";
    if (p.grupo) { // grupo: inicial do nome num quadrado + quantas pessoas
      av.className = "avatar"; pintarAvatarGrupo(av, p); nm.textContent = p.nome; b.dataset.grupo = p.id;
      const st = document.createElement("small"); st.className = "sub"; st.textContent = "grupo · " + contagem(p.membros.size);
      const on = contaOnline([...p.membros.keys()], me.id, online); if (on) st.append(el("span", "on", ` · ${on} online`)); // quantos do grupo estão online agora
      nm.append(st);
    } else {
      av.className = "avatar" + (online.has(p.id) ? " on" : ""); pintarAvatar(av, p, true);
      nm.textContent = "@" + p.username;
      if (online.has(p.id)) { const st = document.createElement("small"); st.textContent = "online"; nm.append(st); }
    }
    b.append(av, nm);
    const t = ultima.get(p.id), n = naoLidas.get(p.id)?.length || 0, lado = el("span", "lado"); // à direita: horário da última mensagem e quantas são novas
    if (t) { const h = el("time", "hora", rotuloHora(t)); h.dateTime = new Date(t).toISOString(); h.title = dataCompleta(t); lado.append(h); }
    if (n) { const u = el("i", "unread num", rotuloNovas(n)); u.title = textoNovas(n); u.setAttribute("aria-label", textoNovas(n)); lado.append(u); b.classList.add("tem-novas"); }
    if (lado.childNodes.length) b.append(lado);
    if (active?.id === p.id) b.setAttribute("aria-current", "true");
    b.onclick = () => open(p);
    li.append(b); return li;
  }));
}
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("add-user").value.trim().replace(/^@/, "").toLowerCase();
  const { data: found, error: errBusca } = await sb.rpc("find_user", { p_username: name });
  if (errBusca) return note(limitado(errBusca) ? "Muitas buscas seguidas. Espere um minuto e tente de novo." : "Não foi possível buscar agora. Tente de novo.");
  const data = found?.[0];
  if (!data) return note(`Não encontramos @${name}. Confira se o nome está certinho com seu amigo.`);
  if (data.id === me.id) return note("Esse é você! Chame um amigo.");
  if (!contacts.has(data.id)) contacts.set(data.id, data); perfis.set(data.id, data); tocaAtiv(data.id, Date.now()); $("add-user").value = ""; $("chamar").close(); open(contacts.get(data.id));
};

// ---------- Conversa ----------
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const hhmm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function updateStatus() {
  const g = active?.grupo ? active : null;
  $("conv-status").hidden = !!g || !(active && online.has(active.id));
  $("conv-sub").hidden = !g; if (g) $("conv-sub").textContent = resumoMembros([...g.membros.values()], me.id); // grupo: quem participa
}
const nomeDe = (id) => (id === me.id ? me.username : (active?.grupo && active.membros.get(id)?.username) || perfis.get(id)?.username || contacts.get(id)?.username || "alguém");
const idDaRef = (re) => (re?.mid ? midParaId.get(re.mid) : re?.id); // a que mensagem DESTA tela uma citação/reação aponta

// "enviada" -> "vista 21:45" (só nas minhas mensagens)
function setReceipt(e) {
  if (!e.mine) return;
  const lida = !active?.grupo && !!e.m.read_at; // em grupo não há "vista"
  e.rcpt.textContent = lida ? "vista " + hhmm(new Date(e.m.read_at)) : "enviada";
  e.rcpt.classList.toggle("read", lida);
}

// Mensagens novas viajam como texto simples; só viram JSON quando precisam (mídia, ou texto que começa com "{")
function unpack(s) {
  if (s.startsWith('{"v":1')) {
    try { const o = JSON.parse(s); if (o.type === "text") return { type: "text", text: String(o.text) }; if (o.type === "media") return o; } catch {}
  }
  return { type: "text", text: s };
}
const sizeLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

// baixa o arquivo cifrado, decifra e devolve uma URL local (nunca sai do navegador decifrado)
const mediaCache = new Map(), stickerBytes = new Map();
const OK_MIME = { image: ["image/jpeg", "image/png", "image/webp"], sticker: ["image/png", "image/webp", "image/gif"], video: ["video/mp4", "video/quicktime"], audio: ["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm"] };
const OK_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;
// o tipo vem da mensagem (quem enviou controla): só aceitamos tipos de imagem/vídeo, nunca text/html
const safeMime = (c) => { const l = OK_MIME[c.kind === "video" ? "video" : c.kind === "audio" ? "audio" : c.kind === "sticker" ? "sticker" : "image"]; return l.includes(c.mime) ? c.mime : l[0]; };
async function loadMedia(c) {
  if (typeof c.path !== "string" || !OK_PATH.test(c.path) || typeof c.key !== "string" || typeof c.iv !== "string") throw new Error("midia invalida");
  if (mediaCache.has(c.path)) return mediaCache.get(c.path);
  let enc = await getBlob(me.id, c.path).catch(() => null), bytes = null, doCache = false;
  if (enc) { try { bytes = await openBytes(enc, c.key, c.iv); } catch { delBlob(me.id, c.path).catch(() => {}); enc = null; } } // cópia local estragada: baixa de novo
  if (!bytes) {
    const { data, error } = await sb.storage.from("media").download(c.path);
    if (error) throw error;
    enc = new Uint8Array(await data.arrayBuffer()); bytes = await openBytes(enc, c.key, c.iv); doCache = true; // (vídeos só entram no cache se couberem no limite por arquivo, de 8 MB)
  }
  if (doCache) putBlob(me.id, c.path, enc).catch(() => {}); // fica no aparelho: da próxima vez não baixa
  const url = URL.createObjectURL(new Blob([bytes], { type: safeMime(c) }));
  if (c.kind === "sticker") stickerBytes.set(c.path, bytes); // a política de segurança não deixa ler blob: por fetch; guardamos os bytes para "Salvar figurinha"
  mediaCache.set(c.path, url); return url;
}
// quem recebe uma figurinha pode guardá-la na própria lista
function botaoSalvarFigurinha(path) {
  const b = el("button", "stk-save", "Salvar figurinha"); b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      const bytes = stickerBytes.get(path); if (!bytes) throw new Error("sem bytes");
      const r = await figurinhas().salvarRecebida(bytes);
      b.textContent = r === "ok" ? "Salva ✓" : r === "repetida" ? "Você já tem" : r === "cheia" ? "Lista cheia" : "Não deu";
    } catch { b.textContent = "Não deu"; }
  };
  return b;
}
// ---------- Tocador de áudio (próprio: a duração vem da mensagem, porque gravações do navegador não trazem duração) ----------
let tocando = null;
const mmss = (n) => { n = Math.max(0, Math.round(Number(n) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
function playerAudio(url, dur, { auto = false } = {}) {
  const box = el("div", "player"), btn = el("button", "play"), barra = el("div", "barra"), prog = el("i"), tempo = el("span", "tempo", `0:00 / ${mmss(dur)}`);
  btn.type = "button"; btn.setAttribute("aria-label", "Tocar áudio");
  barra.append(prog); box.append(btn, barra, tempo);
  barra.tabIndex = 0; barra.setAttribute("role", "slider"); barra.setAttribute("aria-label", "Posição do áudio"); barra.setAttribute("aria-valuemin", "0");
  const a = new Audio(url); a.preload = "metadata";
  const total = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : dur) || 0;
  let arrasta = null; // posição (em segundos) enquanto o dedo está arrastando a barra
  const pinta = () => {
    const t = total(), atual = arrasta ?? a.currentTime;
    prog.style.width = t ? Math.min(100, (atual / t) * 100) + "%" : "0%"; tempo.textContent = `${mmss(atual)} / ${mmss(t)}`;
    barra.setAttribute("aria-valuemax", String(Math.round(t))); barra.setAttribute("aria-valuenow", String(Math.round(atual))); barra.setAttribute("aria-valuetext", `${mmss(atual)} de ${mmss(t)}`);
  };
  a.ontimeupdate = () => { if (arrasta === null) pinta(); };
  a.onplay = () => { btn.classList.add("on"); btn.setAttribute("aria-label", "Pausar áudio"); };
  a.onpause = () => { btn.classList.remove("on"); btn.setAttribute("aria-label", "Tocar áudio"); };
  a.onended = () => { a.currentTime = 0; pinta(); if (tocando === a) tocando = null; };
  a.onerror = () => { tempo.textContent = "Este aparelho não toca este formato"; };
  const toca = () => { if (tocando && tocando !== a) tocando.pause(); tocando = a; return a.play().catch(() => { tempo.textContent = "Toque de novo para ouvir"; }); };
  btn.onclick = () => (a.paused ? toca() : a.pause());
  // Gravações do navegador (WebM) chegam sem duração: o primeiro pulo "pergunta" a duração real ao navegador, antes de buscar.
  const prepara = () => new Promise((ok) => {
    if (Number.isFinite(a.duration)) return ok();
    const volta = a.currentTime, fim = () => { a.removeEventListener("durationchange", fim); a.currentTime = volta; ok(); };
    a.addEventListener("durationchange", fim); a.currentTime = 1e101; setTimeout(fim, 1500);
  });
  async function vaiPara(seg) { await prepara(); a.currentTime = Math.min(Math.max(0, seg), Math.max(0, total() - 0.05)); pinta(); }
  const secDoPonto = (e) => { const r = barra.getBoundingClientRect(); return total() * Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))); };
  barra.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); // arrastar a barra não é "responder" nem "segurar a mensagem"
    if (e.button > 0 || !total()) return;
    barra.setPointerCapture(e.pointerId); barra.classList.add("arrastando"); arrasta = secDoPonto(e); pinta();
  });
  barra.addEventListener("pointermove", (e) => { if (arrasta !== null) { arrasta = secDoPonto(e); pinta(); } });
  const solta = async (e) => {
    if (arrasta === null) return; const alvo = e.type === "pointercancel" ? null : secDoPonto(e);
    arrasta = null; barra.classList.remove("arrastando"); if (alvo !== null) await vaiPara(alvo); else pinta();
  };
  barra.addEventListener("pointerup", solta); barra.addEventListener("pointercancel", solta);
  barra.addEventListener("click", (e) => e.stopPropagation());
  barra.addEventListener("keydown", (e) => {
    const passo = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -15, PageUp: 15 }[e.key];
    if (passo !== undefined) { e.preventDefault(); vaiPara(a.currentTime + passo); }
    else if (e.key === "Home") { e.preventDefault(); vaiPara(0); } else if (e.key === "End") { e.preventDefault(); vaiPara(total()); }
  });
  pinta();
  if (auto) toca();
  return box;
}

function mediaBlock(c, mine) {
  const box = el("div", "media");
  const w = Number(c.w), h = Number(c.h), okDims = w > 0 && h > 0 && w < 20000 && h < 20000;
  box.style.setProperty("--ar", c.kind === "video" ? "16/9" : okDims ? `${Math.round(w)}/${Math.round(h)}` : "4/3");
  const fail = () => box.replaceChildren(el("div", "ph", "Não foi possível abrir este arquivo."));
  if (c.kind === "image") {
    const ph = el("div", "ph", "Carregando foto…"); box.append(ph);
    loadMedia(c).then((url) => {
      const img = new Image(); img.alt = c.caption || "Foto enviada";
      img.onload = () => ph.replaceWith(img); img.onerror = fail; img.src = url;
      img.onclick = () => abrirViewer(url, "Foto ampliada", { origem: img });
    }).catch(fail);
  } else if (c.kind === "sticker") {
    box.classList.add("sticker"); const ph = el("div", "ph", "…"); box.append(ph);
    const salvar = mine ? null : botaoSalvarFigurinha(c.path); if (salvar) { salvar.classList.add("stk-sem-imagem"); box.append(salvar); } // (o botão já ocupa o seu lugar, só invisível: a lista não muda de altura quando a figurinha carrega e a tela não "balança" enquanto se rola)
    loadMedia(c).then((url) => {
      const img = new Image(); img.alt = "Figurinha"; img.draggable = false;
      img.onload = () => { ph.replaceWith(img); salvar?.classList.remove("stk-sem-imagem"); }; img.onerror = fail; img.src = url;
    }).catch(fail);
  } else if (c.kind === "audio") {
    box.classList.add("audio");
    const dur = Math.min(3600, Math.max(0, Number(c.dur) || 0));
    if (!new Audio().canPlayType(safeMime(c))) box.append(el("div", "ph audio-ph", "Este aparelho não toca este formato de áudio."));
    else if (mediaCache.has(c.path)) box.append(playerAudio(mediaCache.get(c.path), dur));
    else {
      const btn = el("button", "ph audio-ph", `Ouvir áudio · ${mmss(dur)} · ${sizeLabel(Number(c.size) || 0)}`); btn.type = "button";
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = "Carregando áudio…";
        try { box.replaceChildren(playerAudio(await loadMedia(c), dur, { auto: true })); } catch { fail(); }
      };
      box.append(btn);
      // se o áudio já está guardado neste aparelho, o player aparece pronto: é só tocar (nada para baixar)
      if (typeof c.path === "string" && OK_PATH.test(c.path)) hasBlob(me.id, c.path).then(async (ok) => { if (ok && btn.isConnected) { try { const u = await loadMedia(c); if (btn.isConnected) box.replaceChildren(playerAudio(u, dur)); } catch {} } }).catch(() => {});
    }
  } else {
    const tam = sizeLabel(Number(c.size) || 0), btn = el("button", "ph", `Tocar para carregar o vídeo · ${tam}`); btn.type = "button";
    const abre = async () => {
      btn.disabled = true; btn.textContent = "Carregando vídeo…";
      try {
        const v = document.createElement("video"); v.controls = true; v.playsInline = true; v.preload = "metadata";
        v.src = await loadMedia(c); btn.replaceWith(v);
      } catch { fail(); }
    };
    btn.onclick = abre; box.append(btn);
    // se o vídeo já está guardado neste aparelho, ele aparece pronto quando chega à tela (nada para baixar, nem para tocar)
    if (typeof c.path === "string" && OK_PATH.test(c.path)) hasBlob(me.id, c.path).then((ok) => {
      if (!ok || !btn.isConnected || btn.disabled) return;
      btn.textContent = `Abrir o vídeo · ${tam}`;
      if ("IntersectionObserver" in window) { // só abre os que aparecem na tela (decifrar um vídeo grande custa memória)
        const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); if (btn.isConnected && !btn.disabled) abre(); } }, { rootMargin: "150px" });
        io.observe(btn);
      }
    }).catch(() => {});
  }
  return box;
}

// ---------- Vídeos curtos (YouTube Shorts, Instagram Reels, TikTok) ----------
// Nada é contatado enquanto a pessoa não tocar. Ao tocar, a rede vê o IP, o aparelho e qual vídeo foi aberto (nunca a conversa): por isso há um aviso na primeira vez de cada rede.
// O player roda numa moldura isolada: sem os cookies de login (credentialless), sem dizer de que página veio (referrer), sem permissões e sem acesso ao Lacre.
const lembrarVideo = (rede) => { try { return localStorage.getItem("lacre:video:" + rede) === "1"; } catch { return false; } };
function cartaoVideo(vl) {
  const b = el("button", "vcard " + vl.cor); b.type = "button"; b.setAttribute("aria-label", `Assistir o vídeo do ${vl.nome} aqui no Lacre`);
  const r = el("span", "rede"); r.append(el("i"), document.createTextNode(vl.nome));
  b.append(r, el("span", "vplay"), el("span", "vdica", "Toque para assistir aqui"));
  b.onclick = async (ev) => { ev.stopPropagation(); await abrirVideo(vl); };
  return b;
}
function quadroDoVideo(vl) {
  const f = document.createElement("iframe");
  f.setAttribute("credentialless", ""); f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox");
  f.setAttribute("referrerpolicy", vl.rede === "yt" ? "strict-origin" : "no-referrer"); // (o YouTube recusa o player sem saber o site; os outros não precisam)
  f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture"); f.setAttribute("allowfullscreen", ""); f.setAttribute("title", "Vídeo do " + vl.nome); f.setAttribute("loading", "eager"); f.src = vl.embed;
  return f;
}
async function abrirVideo(vl) {
  if (!lembrarVideo(vl.rede)) {
    const r = await choose(`Assistir aqui? O ${vl.site} vai ver`, `Ao assistir, o ${vl.site} vai ver o seu endereço de internet (IP), o seu aparelho e qual vídeo você abriu. Ele não vê a conversa, nem quem mandou o link, e não recebe o seu login. Se preferir, abra o link fora do Lacre.`, [
      { label: "Assistir aqui", value: "uma", cls: "primary" }, { label: `Assistir e não perguntar de novo para o ${vl.site}`, value: "sempre", cls: "ghost" }, { label: "Cancelar", value: "", cls: "ghost" }]);
    if (!r) return; if (r === "sempre") { try { localStorage.setItem("lacre:video:" + vl.rede, "1"); } catch {} }
  }
  const d = $("video-view"); $("vv-rede-txt").textContent = vl.nome; d.querySelector(".rede").className = "rede";
  $("vv-url").textContent = vl.url.replace(/^https:\/\/(www\.)?/, ""); $("vv-abrir").href = vl.url; $("vv-abrir-txt").textContent = "Abrir no " + vl.site;
  $("vv-quadro").replaceChildren(quadroDoVideo(vl)); d.showModal();
}
$("video-view").addEventListener("close", () => $("vv-quadro").replaceChildren()); // fechar para o vídeo (a moldura some)
$("vv-fechar").onclick = () => $("video-view").close();
$("video-view").addEventListener("click", (e) => { if (e.target === $("video-view")) $("video-view").close(); });

// ----- cor e foto de cada pessoa nas mensagens do grupo -----
function aplicarCor(wrap) {
  const st = estilosDaCor(active?.membros?.get(wrap.dataset.de)?.cor); if (!st) { wrap.classList.remove("cor"); return; }
  for (const [v, k] of [["--mc-bg", "bg"], ["--mc-bd", "bd"], ["--mc-n", "nome"], ["--mc-f", "forte"]]) { wrap.style.setProperty(v, st.claro[k]); wrap.style.setProperty(v + "-e", st.escuro[k]); }
  wrap.classList.add("cor");
}
function reavaliarAvatar(w) { // a foto só aparece na última mensagem seguida da mesma pessoa
  const slot = w?.querySelector?.(":scope > .line > .ava-slot"); if (!slot) return;
  const prox = w.nextElementSibling; slot.classList.toggle("oculto", !!(prox?.classList.contains("msg") && prox.dataset.de === w.dataset.de));
}
function repintarCoresGrupo() { // alguém trocou de cor, de foto ou entrou: as mensagens já na tela acompanham
  if (!active?.grupo) return;
  for (const w of $("messages").querySelectorAll(".msg.grupo-msg")) {
    if (!w.querySelector(".bubble.err")) aplicarCor(w);
    const av = w.querySelector(".ava-slot .avatar"), p = active.membros.get(w.dataset.de); if (av && p && (av.dataset.foto || "") !== (p.avatar || "")) pintarAvatar(av, p);
  }
}
function pintaMencoes(vis, text) {
  const pedacos = partirTexto(text, [...(active?.membros?.values() ?? [])]); if (!pedacos.some((x) => x.id)) return;
  vis.replaceChildren(...pedacos.map((x) => { if (!x.id) return document.createTextNode(x.t); const sp = el("span", "mencao" + (x.id === me.id ? " eu" : ""), x.t); return sp; }));
  if (pedacos.some((x) => x.id === me.id)) vis.closest(".bubble")?.classList.add("cita-eu");
}
function addMessage(m, content, { err = false, animate = false, em = null, descer = false } = {}) { // descer: a mensagem que EU acabei de enviar sempre leva a tela até ela; as outras só se a pessoa já estava perto do fim (senão a tela puxava de volta quem subia para reler)
  if (typeof content === "string") content = { type: "text", text: content };
  const apagada = content.type === "deleted";
  const media = content.type === "media" && !err;
  const text = apagada ? "Mensagem apagada" : String(content.type === "media" ? content.caption ?? "" : content.text ?? "");
  const mine = m.sender_id === me.id, at = new Date(m.created_at), emGrupo = !!active?.grupo;
  if (active) marcaUltima(active.id, m.created_at); // (a lista mostra a hora da última mensagem que aparece aqui)
  const wrap = el("div", "msg" + (mine ? " mine" : "")), line = el("div", "line"); wrap.dataset.de = m.sender_id;
  if (ehMid(content.mid) && !midParaId.has(content.mid)) midParaId.set(content.mid, m.id); // (grupo e conversa a dois no formato por aparelho: a mensagem se identifica pelo mid)
  const b = el("div", "bubble" + (mine ? " mine" : "") + (err ? " err" : "") + (media ? " has-media" : "") + (media && content.kind === "sticker" ? " sticker" : "") + (apagada ? " apagada" : ""));
  const label = media ? (content.kind === "sticker" ? "Figurinha enviada. " : content.kind === "video" ? "Vídeo enviado. " : content.kind === "audio" ? "Áudio enviado. " : "Foto enviada. ") : "";
  const re = limpaCitacao(content.re), alvo = re ? idDaRef(re) : undefined, original = alvo != null ? msgs.get(alvo) : undefined;
  const citado = re ? exibir(re, original, { me: me.id, peer: emGrupo ? (re.from && re.from !== me.id ? re.from : undefined) : active?.id }) : null;
  const quemCitado = citado?.autor === "mine" ? "Você" : citado?.autor === "theirs" ? "@" + (emGrupo ? nomeDe(original?.m.sender_id ?? re.from) : active.username) : "Mensagem";
  let autor = null; // em grupo: quem escreveu (só na primeira de uma sequência da mesma pessoa)
  if (emGrupo && !mine) { const ant = em ? em.previousElementSibling : $("messages").lastElementChild; if (!(ant?.classList.contains("msg") && ant.dataset.de === m.sender_id)) autor = el("span", "autor", "@" + nomeDe(m.sender_id)); }
  const sr = el("span", "sr", (emGrupo && !mine ? `@${nomeDe(m.sender_id)}: ` : "") + (citado ? `Em resposta a ${quemCitado}: ${citado.rotulo}. ` : "") + label + text), vis = el("span", "vis", text), meta = el("div", "meta");
  vis.setAttribute("aria-hidden", "true");
  const tm = el("time", null, hhmm(at)); tm.dateTime = at.toISOString();
  const rcpt = el("span", "rcpt"); meta.append(tm, rcpt);
  if (citado) {
    const q = el("button", "quote" + (citado.original ? "" : " sem-original")); q.type = "button";
    q.append(el("span", "q-who", quemCitado), el("span", "q-text", citado.rotulo));
    q.setAttribute("aria-label", `Mensagem citada de ${quemCitado}: ${citado.rotulo}. Ir para a mensagem`);
    q.onclick = () => irPara(alvo); q.dataset.re = String(alvo ?? "");
    b.append(q);
  }
  if (autor) { autor.setAttribute("aria-hidden", "true"); b.prepend(autor); }
  if (media) b.append(mediaBlock(content, mine));
  b.append(sr, vis, meta); line.append(b);
  if (!err && !apagada && content.type === "text") { const vl = acharVideoLink(content.text); if (vl) { b.classList.add("has-video"); b.insertBefore(cartaoVideo(vl), meta); } } // link de Shorts/Reels/TikTok: cartão que abre o vídeo aqui
  if (!err) { // botão "⌄" ao passar o mouse (só em aparelhos com mouse); fica fora do balão e não ocupa espaço
    const op = el("button", "msg-opcoes"); op.type = "button"; op.tabIndex = -1; op.setAttribute("aria-label", "Mais opções da mensagem");
    { const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
      const pa = document.createElementNS(ns, "path"); pa.setAttribute("d", "M6 9l6 6 6-6"); svg.append(pa); op.append(svg); }
    op.onclick = (ev) => { ev.stopPropagation(); abrirPicker(wrap, m.id); }; line.append(op);
  }
  const rx = el("div", "rx");
  wrap.append(line, rx);
  if (!err) gestosMensagem(wrap, line, b, m.id);
  const colar = !em && (descer || $("messages").classList.contains("carregando") || pertoDoFim()); // (medido ANTES de entrar: a própria mensagem nova já aumentaria a lista)
  if (em) em.replaceWith(wrap); else $("messages").append(wrap);
  if (emGrupo && !mine) { // em grupo: a foto de quem escreveu fica ao lado da ÚLTIMA mensagem de cada sequência, e o balão leva a cor da pessoa
    wrap.classList.add("grupo-msg"); const slot = el("span", "ava-slot oculto"), av = el("span", "avatar mini");
    pintarAvatar(av, active.membros.get(m.sender_id) || { username: nomeDe(m.sender_id), avatar: null }); slot.append(av); line.insertBefore(slot, b); if (!err) aplicarCor(wrap);
  }
  if (emGrupo) { reavaliarAvatar(wrap); if (wrap.previousElementSibling) reavaliarAvatar(wrap.previousElementSibling); }
  const e = { m, mine, rcpt, rx, wrap, content: err ? null : content }; msgs.set(m.id, e); if (!apagada) setReceipt(e);
  if (emGrupo && !err && !apagada && text) { // em grupo: "@nome" de quem está no grupo fica em destaque (o seu, mais forte)
    if (animate) { b.classList.add("deciphering"); reveal(vis, text, () => { b.classList.remove("deciphering"); pintaMencoes(vis, text); }); } else pintaMencoes(vis, text);
  } else if (animate && !err && text) { b.classList.add("deciphering"); reveal(vis, text, () => b.classList.remove("deciphering")); }
  if (colar) $("messages").scrollTop = 1e9; // (trocar uma mensagem por "Mensagem apagada" não puxa a tela para o fim, nem mensagem que chega com a pessoa lendo mais acima)
  return e;
}

// ---------- Reações (emoji cifrado com a chave da conversa) ----------
// ---------- Responder (citação) ----------
// citação de uma mensagem desta tela: a dois aponta para o id da linha; em grupo, para o identificador da mensagem (cada pessoa tem uma linha diferente)
const refCitacao = (id) => { const e = msgs.get(id); if (!e?.content) return null; return active?.grupo || ehMid(e.content.mid) ? citacaoGrupo(e.content.mid, e.m.sender_id, e.content) : citacao(id, e.m.sender_id, e.content); }; // (mensagem antiga a dois: pelo id da linha; com mid: pelo mid)
const citavel = (id) => !!refCitacao(id);
function mostrarResposta() {
  $("replybar").hidden = !replyTo;
  if (!replyTo) return;
  const alvo = idDaRef(replyTo), original = alvo != null ? msgs.get(alvo) : undefined, v = exibir(replyTo, original, { me: me.id, peer: active?.grupo ? replyTo.from : active?.id });
  const quem = v.autor === "mine" ? "você" : v.autor === "theirs" ? "@" + (active?.grupo ? nomeDe(original?.m.sender_id ?? replyTo.from) : active.username) : "mensagem";
  $("reply-who").textContent = "Respondendo a " + quem; $("reply-text").textContent = v.rotulo;
}
function responder(id) {
  if (!msgs.get(id) || !active) return;
  const c = refCitacao(id); if (!c) return;
  replyTo = c; mostrarResposta(); focoSeMouse();
}
function cancelarResposta() { replyTo = null; mostrarResposta(); }
$("reply-x").onclick = () => { cancelarResposta(); focoSeMouse(); };
$("text").addEventListener("keydown", (e) => { if (e.key === "Escape" && replyTo) { e.preventDefault(); cancelarResposta(); } });
function irPara(id) { // vai até a mensagem original e a destaca por um instante
  const e = msgs.get(id);
  if (!e) return note("A mensagem original não está mais nesta tela (é de muito tempo atrás).");
  e.wrap.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  e.wrap.classList.add("flash"); setTimeout(() => e.wrap.classList.remove("flash"), 1500);
}

// Menu da mensagem (reagir, responder, copiar, apagar): abre ao SEGURAR a mensagem (celular) ou com o botão direito (computador).
let aberturaPorToque = 0; // quando o menu foi aberto por segurar com o dedo (o navegador pode mandar um 'botão direito' logo em seguida: ignoramos)
// Menu da mensagem: aparece SOBREPOSTO (fora da lista), então as mensagens não mudam de lugar. As reações ficam acima do balão e as ações abaixo.
let aberturaMenu = 0;
function fecharPicker() { document.querySelectorAll(".picker").forEach((p) => p.remove()); }
function abrirPicker(wrap, id) {
  fecharPicker();
  const bubble = wrap.querySelector(".bubble"); if (!bubble) return;
  const p = el("div", "picker"), fundo = el("div", "p-fundo"), foco = el("div", "p-foco"), linha = el("div", "emojis"), acoes = el("div", "acoes");
  const e = msgs.get(id), apagada = e?.content?.type === "deleted";
  p.setAttribute("role", "group"); p.setAttribute("aria-label", apagada ? "Apagar" : "Reagir, responder, copiar ou apagar");
  for (const em of apagada ? [] : EMOJIS) {
    const b = el("button", null, em); b.type = "button"; b.setAttribute("aria-label", "Reagir com " + em);
    b.onclick = () => { fecharPicker(); react(id, em); }; linha.append(b);
  }
  if (citavel(id)) { const r = el("button", "responder", "Responder"); r.type = "button"; r.onclick = () => { fecharPicker(); responder(id); }; acoes.append(r); }
  const texto = e?.content?.type === "text" ? e.content.text : e?.content?.type === "media" ? e.content.caption : "";
  if (texto && navigator.clipboard?.writeText) { const c = el("button", "copiar", "Copiar"); c.type = "button"; c.onclick = () => { fecharPicker(); navigator.clipboard.writeText(String(texto)).catch(() => {}); }; acoes.append(c); }
  const ap = el("button", "apagar", "Apagar…"); ap.type = "button"; ap.onclick = () => { fecharPicker(); perguntarApagar(id); }; acoes.append(ap);
  fundo.onclick = (ev) => { if (ev.pointerType === "mouse" || Date.now() - aberturaMenu > 700) fecharPicker(); }; // (o dedo que acabou de segurar a mensagem não fecha o menu ao levantar)
  p.append(fundo, foco); if (!apagada) p.append(linha); p.append(acoes);
  p.style.visibility = "hidden"; document.body.append(p); aberturaMenu = Date.now();
  // posição: foco = o próprio balão (fica no lugar, o resto escurece); reações acima, ações abaixo; sempre dentro da tela
  const posiciona = () => {
    if (!bubble.isConnected) return fecharPicker();
    const r = bubble.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, M = 8, mine = wrap.classList.contains("mine");
    const topoLista = $("messages").getBoundingClientRect().top + 4;
    Object.assign(foco.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    const x = (w) => Math.min(Math.max(M, mine ? r.right - w : r.left), Math.max(M, vw - w - M));
    const eh = apagada ? 0 : linha.offsetHeight, ah = acoes.offsetHeight;
    let yEmoji = r.top - eh - M, yAcoes = r.bottom + M;
    if (!apagada && yEmoji < topoLista) { yEmoji = r.bottom + M; yAcoes = yEmoji + eh + M; } // sem espaço em cima: reações e ações ficam as duas abaixo
    yAcoes = Math.min(yAcoes, vh - ah - M);
    if (!apagada) Object.assign(linha.style, { left: x(linha.offsetWidth) + "px", top: Math.max(M, Math.min(yEmoji, vh - eh - M)) + "px" });
    Object.assign(acoes.style, { left: x(acoes.offsetWidth) + "px", top: Math.max(M, yAcoes) + "px" });
  };
  p._posiciona = posiciona; posiciona();
  p.style.visibility = ""; p.querySelector("button")?.focus({ preventScroll: true });
}
document.addEventListener("click", (ev) => {
  if (ev.target.closest(".picker, .msg-opcoes")) return;
  if (ev.pointerType && ev.pointerType !== "mouse" && Date.now() - aberturaMenu < 700) return; // o dedo que acabou de segurar a mensagem não fecha o menu ao levantar
  fecharPicker();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharPicker(); });
const reposiciona = () => requestAnimationFrame(() => document.querySelector(".picker")?._posiciona?.()); // a lista rolou (ou a janela mudou): o menu acompanha o balão
addEventListener("resize", reposiciona);
$("messages").addEventListener("scroll", reposiciona, { passive: true });
// Gestos na mensagem: segurar = menu; arrastar para a direita = responder
const LIM_RESPONDER = 60, SEGURAR_MS = 420;
function gestosMensagem(wrap, line, bubble, id) {
  bubble.tabIndex = 0;
  const ico = el("span", "resp-ico"); ico.setAttribute("aria-hidden", "true");
  { const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
    for (const d of ["M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 6 6v3"]) { const pa = document.createElementNS(ns, "path"); pa.setAttribute("d", d); svg.append(pa); } ico.append(svg); }
  line.prepend(ico);
  let st = null, suprime = false;
  const fim = () => { if (!st) return; clearTimeout(st.timer); removeEventListener("pointermove", mover); removeEventListener("pointerup", soltar); removeEventListener("pointercancel", soltar); line.classList.remove("arrastando"); line.style.removeProperty("--x"); line.style.removeProperty("--s"); st = null; };
  function mover(e) {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (!st.arrasta) {
      if (Math.hypot(dx, dy) > 10) clearTimeout(st.timer); // mexeu: não é mais "segurar"
      if (dx > 10 && dx > Math.abs(dy) * 1.5 && !st.longo) { st.arrasta = true; line.classList.add("arrastando"); }
      else return;
    }
    const x = Math.min(dx, 90); line.style.setProperty("--x", Math.max(0, x) + "px"); line.style.setProperty("--s", String(Math.min(1, Math.max(0, x) / LIM_RESPONDER)));
    const passou = x >= LIM_RESPONDER; if (passou !== st.passou) { st.passou = passou; line.classList.toggle("pronto", passou); if (passou) vibra(15); }
  }
  function soltar(e) {
    if (!st || e.pointerId !== st.id) return;
    const responderAgora = st.arrasta && st.passou && e.type !== "pointercancel", longo = st.longo; fim();
    if (longo) suprime = true;
    line.classList.remove("pronto");
    if (responderAgora && citavel(id)) responder(id);
  }
  bubble.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.isPrimary || st) return; // com o mouse: botão direito abre o menu
    st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, arrasta: false, longo: false, passou: false, timer: 0 };
    st.timer = setTimeout(() => { if (!st || st.arrasta) return; st.longo = true; vibra(15); aberturaPorToque = Date.now(); abrirPicker(wrap, id); }, SEGURAR_MS);
    addEventListener("pointermove", mover); addEventListener("pointerup", soltar); addEventListener("pointercancel", soltar);
  });
  bubble.addEventListener("click", (e) => { if (suprime) { suprime = false; e.stopPropagation(); e.preventDefault(); } }, true); // o dedo levantado depois de segurar não "clica" na mensagem
  bubble.addEventListener("contextmenu", (e) => { e.preventDefault(); if (Date.now() - aberturaPorToque < 900) return; abrirPicker(wrap, id); });
  bubble.addEventListener("keydown", (e) => { if (e.target === bubble && (e.key === "Enter" || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) { e.preventDefault(); abrirPicker(wrap, id); } });
}

function renderRx(id) {
  const e = msgs.get(id); if (!e) return;
  e.rx.replaceChildren(); if (e.content?.type === "deleted") return;
  if (active?.grupo) { // em grupo: um botão por emoji, com a contagem de quem reagiu
    const porEmoji = new Map(); for (const [uid, emoji] of reactions.get(id) || []) porEmoji.set(emoji, [...(porEmoji.get(emoji) || []), uid]);
    for (const [emoji, quem] of porEmoji) {
      const meu = quem.includes(me.id), c = el("button", "chip" + (meu ? " mine" : ""), quem.length > 1 ? `${emoji} ${quem.length}` : emoji); c.type = "button";
      const nomes = quem.map((u) => (u === me.id ? "você" : "@" + nomeDe(u))).join(", "); c.title = nomes;
      c.setAttribute("aria-label", `${emoji}: ${nomes}. Toque para ${meu ? "remover a sua" : "reagir igual"}`);
      c.onclick = () => react(id, emoji); e.rx.append(c);
    }
    return;
  }
  for (const [uid, emoji] of reactions.get(id) || []) {
    const mineChip = uid === me.id, c = el("button", "chip" + (mineChip ? " mine" : ""), emoji); c.type = "button";
    c.setAttribute("aria-label", mineChip ? `Sua reação ${emoji}. Toque para remover` : `Reação de @${active.username}: ${emoji}`);
    c.onclick = () => react(id, emoji); // tocar na sua remove; tocar na do amigo repete a mesma
    e.rx.append(c);
  }
}
async function react(id, emoji) {
  const peer = active, mid = msgs.get(id)?.content?.mid, alvo = peer.grupo || ehMid(mid) ? mid : id; if (peer.grupo && !ehMid(alvo)) return;
  const map = reactions.get(id) || new Map(); reactions.set(id, map);
  const prev = map.get(me.id), remove = emoji === prev;
  remove ? map.delete(me.id) : map.set(me.id, emoji); renderRx(id); // atualiza na hora
  try { await enviar(peer, { type: "reaction", to: alvo, emoji: remove ? "" : emoji }); }
  catch (e) { prev ? map.set(me.id, prev) : map.delete(me.id); renderRx(id); note(sendError(e, peer)); }
}
function applyReaction(c, m) { // reação nova = mensagem cifrada (com sigilo futuro) com conteúdo "reaction"
  const id = ehMid(c.to) ? midParaId.get(c.to) : Number(c.to); if (!Number.isFinite(id)) return; // (em grupo, e nas mensagens a dois por aparelho, a reação aponta para o identificador da mensagem)
  const map = reactions.get(id) || new Map(); reactions.set(id, map);
  const em = typeof c.emoji === "string" ? c.emoji.slice(0, 16) : "";
  em ? map.set(m.sender_id, em) : map.delete(m.sender_id); renderRx(id);
}
// ---------- Apagar mensagens ----------
// Para todos: vai uma mensagem cifrada {type:"delete"} para o amigo e, nos dois aparelhos, o texto guardado é trocado por "Mensagem apagada".
// Só para mim: o aparelho guarda que aquela mensagem ficou escondida. O aviso "Mensagem apagada" também pode ser apagado, só para mim.
function trocaPorApagada(id) {
  for (const q of document.querySelectorAll(`.quote[data-re="${Number(id)}"]`)) { const t = q.querySelector(".q-text"), sr = q.closest(".bubble")?.querySelector(".sr"); if (sr && t?.textContent) sr.textContent = sr.textContent.replace(t.textContent, "Mensagem apagada"); if (t) t.textContent = "Mensagem apagada"; q.setAttribute("aria-label", "Mensagem citada apagada"); } // (o texto para leitor de tela também não guarda o que foi apagado) // citações já na tela não guardam o texto antigo
  const e = msgs.get(id); if (!e) return; reactions.delete(id);
  const novo = { type: "deleted" }; if (e.content?.mid) novo.mid = e.content.mid; // (em grupo o identificador fica: respostas antigas continuam achando a mensagem)
  addMessage(e.m, novo, { em: e.wrap });
}
// Em grupo: acha a mensagem pelo identificador (na tela ou no que está guardado) e só aceita o pedido de quem a escreveu.
// conv: a conversa onde a mensagem está guardada (o grupo, ou a pessoa da conversa a dois)
async function aplicarApagarGrupo(c, m, conv = c.g) {
  if (!ehMid(c.to) || !conv) return;
  const aberto = active?.id === conv;
  let id = aberto ? midParaId.get(c.to) : undefined, cur = id != null ? await getHistory(me.id, conv, id) : null;
  if (cur && cur.content?.mid !== c.to) cur = null;
  if (!cur) { const r = await acharNoHistorico(me.id, conv, (e) => e.content?.mid === c.to); if (!r) return; id = r.id; cur = r.entry; }
  if (cur.content?.type === "hidden") return; // já apaguei só para mim
  if (cur.content?.type === "deleted") { if (aberto && msgs.get(id)?.content?.type !== "deleted") trocaPorApagada(id); return; }
  const autor = cur.mine ? me.id : (cur.from || (ehGrupoIdLocal(conv) ? null : conv)); // (conversa a dois: quem não sou eu é a própria pessoa)
  if (!autor || autor !== m.sender_id) return; // só quem escreveu a mensagem pode apagá-la para todos
  await commit(me.id, conv, { entryId: id, entry: { content: { type: "deleted", by: autor, mid: c.to }, at: cur.at || m.created_at, mine: autor === me.id, from: autor } });
  if (aberto) trocaPorApagada(id);
}
const ehGrupoIdLocal = (id) => grupos.has(id);
async function aplicarApagar(c, m, conv = null) {
  if (c.g) return aplicarApagarGrupo(c, m, c.g);
  if (ehMid(c.to)) return aplicarApagarGrupo(c, m, conv || (m.sender_id === me.id ? m.recipient_id : m.sender_id)); // conversa a dois no formato por aparelho
  const id = Number(c.to); if (!Number.isSafeInteger(id) || id <= 0) return;
  const peerId = m.sender_id === me.id ? m.recipient_id : m.sender_id, cur = await getHistory(me.id, peerId, id);
  if (cur?.content?.type === "deleted") { if (msgs.get(id)?.content?.type !== "deleted") trocaPorApagada(id); return; }
  let autor = msgs.get(id)?.m.sender_id;
  if (!autor) { const { data } = await sb.from("messages").select("sender_id").eq("id", id).maybeSingle(); autor = data?.sender_id; }
  if (!autor || autor !== m.sender_id) return; // só quem escreveu a mensagem pode apagá-la para todos
  await commit(me.id, peerId, { entryId: id, entry: { content: { type: "deleted", by: autor }, at: cur?.at || m.created_at, mine: autor === me.id } });
  trocaPorApagada(id);
}
async function apagarParaMim(id) {
  const e = msgs.get(id), peer = active; if (!e || !peer) return;
  await commit(me.id, peer.id, { entryId: id, entry: { content: { type: "hidden" }, at: e.m.created_at, mine: e.mine } });
  { const c = e.content; if (c?.type === "media" && c.kind !== "sticker" && typeof c.path === "string") delBlob(me.id, c.path).catch(() => {}); } // some também a cópia guardada
  const antes = e.wrap.previousElementSibling; e.wrap.remove(); if (antes) reavaliarAvatar(antes); msgs.delete(id); reactions.delete(id);
  if (!msgs.size && !$("msgs-empty")) { const p = el("p", "empty", "Nenhuma mensagem aqui."); p.id = "msgs-empty"; $("messages").append(p); }
}
async function apagarParaTodos(id) {
  const e = msgs.get(id), peer = active; if (!e || !peer || !e.mine || e.content?.type === "deleted") return;
  const alvo = peer.grupo || ehMid(e.content?.mid) ? e.content?.mid : id; if (peer.grupo && !ehMid(alvo)) return;
  try { await enviar(peer, { type: "delete", to: alvo }); } catch (err) { return note(sendError(err, peer)); }
  const c = e.content; // o arquivo cifrado de foto/vídeo/áudio sai do servidor (figurinha não: o mesmo arquivo é reaproveitado em outras mensagens)
  if (c?.type === "media" && c.kind !== "sticker" && typeof c.path === "string") { await sb.storage.from("media").remove([c.path]).catch(() => {}); delBlob(me.id, c.path).catch(() => {}); const u = mediaCache.get(c.path); if (u) { URL.revokeObjectURL(u); mediaCache.delete(c.path); } }
  await commit(me.id, peer.id, { entryId: id, entry: peer.grupo || ehMid(alvo) ? { content: { type: "deleted", by: me.id, mid: alvo }, at: e.m.created_at, mine: true, from: me.id } : { content: { type: "deleted", by: me.id }, at: e.m.created_at, mine: true } });
  trocaPorApagada(id);
}
async function perguntarApagar(id) {
  const e = msgs.get(id); if (!e || !active) return;
  const aviso = e.content?.type === "deleted", todos = e.mine && !aviso, emGrupo = !!active.grupo, nome = emGrupo ? "todo o grupo" : "@" + active.username;
  const r = await choose("Apagar mensagem?",
    aviso ? "O aviso some só da sua tela." : todos ? `Para todos: some também para ${nome}, e fica o aviso "Mensagem apagada". Só para mim: some só desta tela e ${emGrupo ? "o grupo" : nome} continua vendo.` : emGrupo ? "Some só da sua tela. O grupo não é avisado e continua com a mensagem." : `Some só da sua tela. ${nome} não é avisado e continua com a mensagem.`,
    [...(todos ? [{ label: "Apagar para todos", value: "todos", cls: "primary" }] : []), { label: "Apagar só para mim", value: "mim", cls: todos ? "ghost" : "primary" }, { label: "Cancelar", value: "nao", cls: "ghost" }]);
  if (r === "todos") await apagarParaTodos(id); else if (r === "mim") await apagarParaMim(id);
}
async function loadLegacyReactions(rows, peer) { // reações antigas (tabela, chave fixa) de mensagens antigas
  const ids = rows.filter((m) => m.v !== 2).map((m) => m.id);
  if (!ids.length) return;
  const { data } = await sb.from("reactions").select("*").in("message_id", ids);
  for (const r of data || []) {
    try {
      const em = await decrypt(myKeys.privateKey, peer.public_key, r);
      const map = reactions.get(r.message_id) || new Map(); reactions.set(r.message_id, map);
      if (em) map.set(r.user_id, em);
    } catch {}
  }
}

// ---------- Visto ----------
async function markRead() {
  if (!active || document.visibilityState !== "visible") return;
  const ids = [...msgs.values()].filter((e) => !e.mine && !e.m.read_at).map((e) => e.m.id);
  if (!ids.length) return;
  const at = new Date().toISOString();
  ids.forEach((id) => (msgs.get(id).m.read_at = at));
  await sb.rpc("marcar_lidas", { p_ids: ids.slice(0, 300) }); // o servidor marca também as cópias que chegaram aos meus outros aparelhos
}
// "vista" de uma mensagem minha (uma linha por aparelho de quem recebeu: vale a primeira leitura de qualquer um). Cópias para mim mesmo não entram.
function marcarVistaDoEnvio(row) {
  if (!row.read_at) return;
  let e = msgs.get(linhaParaMsg.get(row.id) ?? row.id);
  if (!e) { const t = Date.parse(row.created_at); for (const x of msgs.values()) if (x.mine && Date.parse(x.m.created_at) === t) { e = x; break; } } // (mensagem que veio de outro aparelho meu: acha pelo instante do envio)
  if (e && e.mine && !e.m.read_at) { e.m.read_at = row.read_at; setReceipt(e); }
}
// Rede de segurança das "vistas": se o aviso em tempo real de que o outro leu se perdeu, a conversa aberta confere no servidor o que ainda está sem "vista" (só consulta se há mensagem minha na tela sem ela)
async function conferirVistas() {
  const peer = active; if (!peer || peer.grupo || carregandoConversa) return;
  if (![...msgs.values()].some((e) => e.mine && !e.m.read_at)) return;
  const { data, error } = await sb.from("messages").select("id,created_at,read_at").eq("sender_id", me.id).eq("recipient_id", peer.id).not("read_at", "is", null).order("id", { ascending: false }).limit(100);
  if (error || active !== peer) return;
  for (const r of data || []) marcarVistaDoEnvio(r);
}
// Li esta conversa em outro aparelho meu: some a bolinha de não lida daqui
function lidaEmOutroAparelho(row) {
  if (!row?.read_at || row.sender_id === me.id) return;
  const conv = row.grupo_id || row.sender_id, l = naoLidas.get(conv);
  if (l?.includes(row.id)) { const resto = l.filter((x) => x !== row.id); resto.length ? naoLidas.set(conv, resto) : naoLidas.delete(conv); salvaNL(); renderContacts(); }
  const e = msgs.get(row.id); if (e && !e.m.read_at) e.m.read_at = row.read_at;
}

// ---------- Sigilo futuro (mensagens v2: Double Ratchet) ----------
const lockChave = (chave) => `lacre:${me.id}:${chave}`; // uma trava por sessão (pessoa + aparelho)
const lockName = (peer) => lockChave(peer.id);
const chaveDaLinha = (m, peer) => (m.para_aparelho && ehRef(m.de_aparelho) ? chaveSessao(peer.id, m.de_aparelho) : peer.id); // cópia por aparelho: a sessão é com o aparelho que enviou; formato antigo: com a pessoa
const SPK_ROTATE = 7 * 864e5, SPK_KEEP = 14 * 864e5;
const gone = (t) => ({ type: "unreadable", text: t });

// Chave de médio prazo: publicamos a parte pública; a privada fica só aqui e é apagada depois de 14 dias.
async function ensureSpk() {
  try {
    await aparelhoPronto; const ap = meuAparelhoId; // (sem aparelho registrado, a chave sai sem marca, como antes)
    const now = Date.now(), list = await getSpks(me.id);
    const newest = list.reduce((a, k) => (k.created > (a?.created ?? 0) ? k : a), null);
    if (!newest || now - newest.created > SPK_ROTATE || (ap && newest.ap !== ap)) { // (a chave sem a marca deste aparelho é trocada uma vez)
      const k = await genDH(), id = randomHex(16);
      await addSpk(me.id, { id, priv: k.priv, created: now, ...(ap ? { ap } : {}) });
      const { error } = await sb.from("prekeys").insert({ id, public_key: { kty: "EC", crv: "P-256", x: k.pub.x, y: k.pub.y }, ...(ap ? { aparelho: ap } : {}) });
      if (error) await removeSpk(me.id, id);
    }
    await pruneSpks(me.id, now - SPK_KEEP);
    await sb.from("prekeys").delete().eq("user_id", me.id).lt("created_at", new Date(now - SPK_KEEP).toISOString());
  } catch {}
}
async function pinStatus(peer) {
  const k = `pin:${me.id}:${peer.id}`, fp = await fingerprint(peer.public_key);
  let saved = null; try { saved = localStorage.getItem(k); } catch {}
  if (!saved) { try { localStorage.setItem(k, fp); } catch {} return "ok"; }
  return saved === fp ? "ok" : "changed";
}
function parseContent(s) {
  const o = JSON.parse(s);
  if (o && typeof o === "object" && ["text", "media", "reaction", "hello", "delete"].includes(o.type)) { if (o.re !== undefined) o.re = limpaCitacao(o.re); return o; }
  throw new Error("conteudo invalido");
}
async function decryptV2(m, peer) {
  const h = m.header; if (!validHeader(h)) throw new Error("cabecalho invalido");
  const chave = chaveDaLinha(m, peer);
  let st = await getSession(me.id, chave, h.sid);
  if (!st) {
    const spk = h.init && (await getSpks(me.id)).find((k) => k.id === h.init.spk);
    if (!spk) throw Object.assign(new Error("sem sessao"), { code: "NO_SESSION" });
    st = await accept(ikJwk, peer.public_key, spk, h);
  }
  const { state, plaintext } = await ratchetDecrypt(st, m.sender_id, m.recipient_id, h, m.ciphertext);
  const content = parseContent(toText(plaintext));
  // o grupo marcado na linha do servidor tem de ser o mesmo que está DENTRO da mensagem cifrada (o servidor não consegue mudar uma mensagem de lugar)
  if (!conteudoBate(content, m.grupo_id, { aDois: !!m.para_aparelho })) throw new Error("grupo nao confere");
  // sessão nova + mensagem lida na mesma transação: a chave já foi gasta, então não pode haver perda
  await commit(me.id, chave, { session: state, active: h.sid, entryId: m.id, entry: m.grupo_id ? { content, at: m.created_at, from: m.sender_id } : { content, at: m.created_at }, hist: m.grupo_id || peer.id });
  return content;
}
const histDe = (m, peer) => m.grupo_id || peer.id; // onde a mensagem fica guardada: na conversa com a pessoa, ou no grupo
async function readV2(m, peer) {
  const cached = (await getHistory(me.id, histDe(m, peer), m.id)) ?? (m.grupo_id ? await getHistory(me.id, peer.id, m.id) : null); // (2ª busca: uma versão antiga do app, sem grupos, guardou na conversa a dois)
  if (cached) return cached.content;
  if (m.sender_id === me.id) {
    if (m.avisar === false) return { type: "hello" }; // aviso automático (refazer sessão, apagar…) enviado por outro aparelho seu: nunca é uma mensagem de verdade, então some em vez de virar um balão de erro
    return gone("Enviada por você de outro navegador ou aparelho (como o computador). Para ver aqui: exporte o histórico de lá e importe aqui, em Segurança da conta.");
  }
  if ((await pinStatus(peer)) === "changed") return gone("A chave desta pessoa mudou. Abra o código de segurança e confira com ela antes de continuar.");
  return withLock(lockChave(chaveDaLinha(m, peer)), async () => {
    const again = await getHistory(me.id, histDe(m, peer), m.id); if (again) return again.content;
    try { return await decryptV2(m, peer); }
    catch (e) {
      // (cópia no formato antigo, com mais de um aparelho meu: só um deles tem a sessão; nos outros a linha some em silêncio, sem balão de erro nem pedido de refazer)
      if (e.code === "NO_SESSION" && !m.para_aparelho && maisDeUmAparelho()) return { type: "hello" };
      if (e.code === "NO_SESSION") { sayHello(peer); return gone("Esta mensagem é de uma sessão que este aparelho não tem (por exemplo, você entrou neste aparelho depois). Pedi para refazer: as próximas chegam normais."); }
      return gone("Mensagem protegida que este aparelho não conseguiu decifrar.");
    }
  });
}
async function readRow(m, peer) {
  try {
    const ov = await getHistory(me.id, histDe(m, peer), m.id); // mensagem apagada (para todos ou só para mim): vale o que está guardado aqui, mesmo nas antigas
    if (ov?.content?.type === "deleted" || ov?.content?.type === "hidden") return ov.content;
    return m.v === 2 ? await readV2(m, peer) : unpack(await decrypt(myKeys.privateKey, peer.public_key, m)); }
  catch { return gone("Não foi possível decifrar esta mensagem."); }
}
function sayHello(peer) { // refaz a sessão sozinho quando este aparelho não consegue ler o que o amigo mandou
  const k = `hello:${me.id}:${peer.id}`; let t = 0; try { t = +localStorage.getItem(k) || 0; } catch {}
  if (Date.now() - t < 10 * 60e3) return;
  try { localStorage.setItem(k, String(Date.now())); } catch {}
  sendContent(peer, { type: "hello" }).catch(() => {});
}
async function newSession(peer) {
  const { data, error } = await sb.rpc("get_prekey", { p_user: peer.id });
  const pk = data?.[0];
  if (error || !pk?.public_key?.x || !pk?.public_key?.y) throw Object.assign(new Error("sem prekey"), { code: "NO_PREKEY" });
  return initiate(ikJwk, peer.public_key, { id: pk.id, x: pk.public_key.x, y: pk.public_key.y });
}
// Sessão para enviar a uma pessoa (ref = null: formato antigo) ou a UM aparelho dela (ref + a chave de recepção que o servidor deu).
async function sendSession(peer, ref = null, prekey = null) {
  const chave = chaveSessao(peer.id, ref), act = await getActive(me.id, chave);
  if (act) { const st = await getSession(me.id, chave, act); if (st && canSend(st)) return st; }
  for (const st of await listSessions(me.id, chave)) if (canSend(st)) return st;
  if (prekey) return initiate(ikJwk, peer.public_key, { id: prekey.id, x: prekey.public_key.x, y: prekey.public_key.y });
  return newSession(peer);
}
// Formato antigo: UMA cópia para a pessoa (quem tiver a chave de recepção mais recente lê).
async function sendContentAntigo(peer, content) {
  return withLock(lockName(peer), async () => {
    const r = await ratchetEncrypt(await sendSession(peer), me.id, peer.id, toBytes(JSON.stringify(content)));
    await commit(me.id, peer.id, { session: r.state, active: r.state.sid }); // grava ANTES de enviar: uma chave nunca é usada duas vezes
    const { data, error } = await sb.from("messages").insert({ recipient_id: peer.id, ciphertext: r.ciphertext, iv: r.iv, v: 2, header: r.header, avisar: !["hello", "delete"].includes(content.type) }).select().single();
    if (error) throw error;
    await commit(me.id, peer.id, { entryId: data.id, entry: { content, at: data.created_at, mine: true } });
    return data;
  });
}
// Aparelhos aprovados (com chave de recepção) de uma pessoa: guardados por 60 s; forcar = ignora o que está guardado
async function aparelhosDe(pessoaId, forcar = false) {
  const c = cacheAparelhos.get(pessoaId);
  if (!forcar && c && Date.now() - c.t < 60000) return c.lista;
  const { data, error } = await sb.rpc("get_prekeys_aparelhos", { p_user: pessoaId });
  if (error) { if (limitado(error) && c) return c.lista; throw error; }
  const lista = limpaPrekeys(data); cacheAparelhos.set(pessoaId, { t: Date.now(), lista }); return lista;
}
// Grupo: os aparelhos de todos os participantes (e os meus) numa chamada só, guardados por 60 s como os de cada pessoa. Quem não tem aparelho fica com a lista vazia (formato antigo).
const cacheGrupoAparelhos = new Map(); // id do grupo -> quando foi buscado
async function aquecerAparelhosDoGrupo(grupoId, pessoas, forcar = false) {
  if (!forcar && Date.now() - (cacheGrupoAparelhos.get(grupoId) || 0) < 60000 && pessoas.every((p) => cacheAparelhos.has(p.id))) return;
  const { data, error } = await sb.rpc("get_prekeys_grupo", { p_grupo: grupoId }); if (error) { if (limitado(error)) return; throw error; } // (limite de uso: segue com o que já está guardado)
  const porPessoa = new Map([[me.id, []], ...pessoas.map((p) => [p.id, []])]);
  for (const r of Array.isArray(data) ? data : []) porPessoa.get(r?.user_id)?.push(r);
  const t = Date.now(); for (const [id, linhas] of porPessoa) cacheAparelhos.set(id, { t, lista: limpaPrekeys(linhas) });
  cacheGrupoAparelhos.set(grupoId, t);
}
async function alvosDoEnvio(peer, forcar = false) {
  const meu = meuRef(); if (!meu) return alvosDeEnvio({ deles: [], meus: [], meuRef: null });
  const [deles, meus] = await Promise.all([aparelhosDe(peer.id, forcar), aparelhosDe(me.id, forcar)]);
  return alvosDeEnvio({ deles, meus, meuRef: meu });
}
// Formato novo: a MESMA mensagem, cifrada à parte para cada aparelho aprovado de quem recebe e para cada OUTRO aparelho meu (cada um pela sua sessão),
// gravada num pedido só (uma mensagem a dois: no máximo 5 + 4 linhas). A cópia para mim leva "para" (de qual conversa é) dentro do conteúdo cifrado.
async function enviarPorAparelho(peer, content, alvos) {
  const meuPeer = { id: me.id, public_key: me.public_key }, proprias = content.type !== "hello"; // (refazer sessão só interessa a quem recebe)
  const trabalhos = [...alvos.amigo.map((a) => ({ pessoa: peer, a, texto: JSON.stringify(content), copia: false })), ...(proprias ? alvos.proprios.map((a) => ({ pessoa: meuPeer, a, texto: JSON.stringify({ ...content, para: peer.id }), copia: true })) : [])];
  const linhas = await Promise.all(trabalhos.map((j) => withLock(lockChave(chaveSessao(j.pessoa.id, j.a.ref)), async () => {
    let st; try { st = await sendSession(j.pessoa, j.a.ref, j.a); } catch (e) { throw Object.assign(e, { peer: j.pessoa }); }
    const r = await ratchetEncrypt(st, me.id, j.pessoa.id, toBytes(j.texto));
    await commit(me.id, chaveSessao(j.pessoa.id, j.a.ref), { session: r.state, active: r.state.sid }); // grava ANTES de enviar: uma chave nunca é usada duas vezes
    return { recipient_id: j.pessoa.id, para_aparelho: j.a.ref, ciphertext: r.ciphertext, iv: r.iv, v: 2, header: r.header, avisar: !j.copia && !["hello", "delete"].includes(content.type) };
  })));
  const { data, error } = await sb.from("messages").insert(linhas).select("id,created_at,recipient_id");
  if (error) throw error;
  const dele = data.filter((l) => l.recipient_id === peer.id), id = Math.min(...dele.map((l) => l.id)), at = dele[0].created_at;
  await commit(me.id, peer.id, { entryId: id, entry: { content, at, mine: true } });
  for (const l of dele) linhaParaMsg.set(l.id, id);
  return { id, created_at: at, sender_id: me.id, recipient_id: peer.id, grupo_id: null, read_at: null };
}
const linhaParaMsg = new Map(); // linha do servidor (uma por aparelho de quem recebeu) -> mensagem na tela, para a "vista" chegar na mensagem certa
async function sendContent(peer, content) {
  if ((await pinStatus(peer)) === "changed") throw Object.assign(new Error("chave mudou"), { code: "PIN" });
  let alvos = await alvosDoEnvio(peer);
  if (!alvos.novo) return sendContentAntigo(peer, content); // o destinatário (ou este aparelho) ainda não usa aparelhos: uma cópia só, como antes
  if ((content.type === "text" || content.type === "media") && !ehMid(content.mid)) content.mid = randomHex(16); // identificador da mensagem (cada aparelho recebe uma linha diferente)
  try { return await enviarPorAparelho(peer, content, alvos); }
  catch (e) {
    if (e?.code !== "42501") throw e;
    // o servidor recusou: a lista de aparelhos mudou (alguém foi removido ou permitido). Atualiza e tenta mais uma vez.
    cacheAparelhos.clear(); await conferirDispositivos(true).catch(() => {});
    alvos = await alvosDoEnvio(peer, true);
    if (!alvos.novo) { delete content.mid; return sendContentAntigo(peer, content); }
    return enviarPorAparelho(peer, content, alvos);
  }
}
// Cifra o MESMO conteúdo separadamente para cada pessoa e grava tudo num pedido só: ou chega para todos, ou para ninguém.
// Quem já usa aparelhos recebe uma cópia POR APARELHO aprovado (cada uma pela sua sessão); quem ainda não usa recebe uma cópia só, no formato antigo.
// copias = mandar também para os meus outros aparelhos (mensagens de grupo: o grupo vai na linha e dentro do conteúdo cifrado).
async function enviarVariosJa(pessoas, content, { grupoId = null, avisar = true, citados = null, copias = false } = {}) {
  for (const p of pessoas) if ((await pinStatus(p)) === "changed") throw Object.assign(new Error("chave mudou"), { code: "PIN", peer: p });
  const texto = toBytes(JSON.stringify(content)), meu = meuRef(), porId = new Map(pessoas.map((p) => [p.id, p])), meuPeer = { id: me.id, public_key: me.public_key };
  if (meu && grupoId) await aquecerAparelhosDoGrupo(grupoId, pessoas);
  const comAparelhos = meu ? await Promise.all(pessoas.map(async (p) => ({ id: p.id, aparelhos: await aparelhosDe(p.id).catch(() => []) }))) : pessoas.map((p) => ({ id: p.id, aparelhos: [] })); // (sem a lista: formato antigo)
  const trabalhos = trabalhosDeEnvio({ pessoas: comAparelhos, meus: meu && copias ? await aparelhosDe(me.id).catch(() => []) : [], meuRef: meu, copias });
  const linhas = await Promise.all(trabalhos.map((j) => {
    const p = j.copia ? meuPeer : porId.get(j.pessoaId), ref = j.a?.ref ?? null, chave = chaveSessao(p.id, ref);
    return withLock(ref ? lockChave(chave) : lockName(p), async () => {
      let st; try { st = await sendSession(p, ref, j.a); } catch (e) { throw Object.assign(e, { peer: p }); }
      const r = await ratchetEncrypt(st, me.id, p.id, texto);
      await commit(me.id, chave, { session: r.state, active: r.state.sid }); // grava ANTES de enviar: uma chave nunca é usada duas vezes
      // (para_aparelho e citado vão sempre, mesmo vazios: num pedido em lote todas as linhas precisam ter as mesmas colunas. Só a linha de quem foi citado leva a marca; cópia para mim nunca avisa.)
      return { recipient_id: p.id, para_aparelho: ref, ciphertext: r.ciphertext, iv: r.iv, v: 2, header: r.header, avisar: j.copia ? false : avisar, grupo_id: grupoId, citado: !j.copia && !!citados?.has(p.id) };
    });
  }));
  // mensagem de grupo: UM pedido (ou chega para todos, ou para ninguém; e conta como um envio só). Toques sem grupo (hello) podem ir em levas.
  const out = [];
  for (const leva of grupoId ? [linhas] : emLevas(linhas)) {
    const { data, error } = await sb.from("messages").insert(leva).select("id,created_at,recipient_id");
    if (error) throw error;
    out.push(...data);
  }
  return out;
}
async function enviarVarios(pessoas, content, opts = {}) {
  try { return await enviarVariosJa(pessoas, content, opts); }
  catch (e) {
    if (e?.code !== "42501") throw e;
    cacheAparelhos.clear(); cacheGrupoAparelhos.clear(); // o servidor recusou: a lista de aparelhos de alguém mudou (ou a de participantes do grupo, que quem chamou confere)
    if (opts.grupoId) throw e;
    return enviarVariosJa(pessoas, content, opts);
  }
}
// Mensagem para o grupo: uma cópia cifrada por aparelho de cada pessoa (ou por pessoa, no formato antigo) e para os meus outros aparelhos. Aqui fica guardada UMA vez (sob o id do grupo), com o menor id da leva.
const enviarAoGrupo = (g, content) => withLock(`lacre:g:${me.id}:${g.id}`, () => enviarAoGrupoJa(g, content)); // um envio por vez em cada grupo: as mensagens chegam na ordem em que foram escritas
async function enviarAoGrupoJa(g, content) {
  content.g = g.id; if (content.type === "text" || content.type === "media") content.mid = randomHex(16);
  const outros = () => [...g.membros.values()].filter((p) => p.id !== me.id);
  const texto = content.type === "text" ? content.text : content.type === "media" ? content.caption : "";
  const opts = { grupoId: g.id, copias: true, avisar: content.type !== "delete", citados: new Set(mencionados(String(texto ?? ""), [...g.membros.values()].filter((p) => p.id !== me.id))) };
  let linhas;
  if (!outros().length) throw Object.assign(new Error("grupo vazio"), { code: "SOZINHO" });
  try { linhas = await enviarVarios(outros(), content, opts); }
  catch (e) {
    if (e?.code !== "42501") throw e;
    await atualizarGrupos(true).catch(() => {}); await conferirDispositivos(true).catch(() => {}); // o servidor recusou: a lista de participantes mudou (alguém saiu, ou eu saí) ou a de aparelhos de alguém. Atualiza e tenta mais uma vez.
    if (!grupos.has(g.id)) throw Object.assign(e, { code: "FORA" });
    if (!outros().length) throw Object.assign(new Error("grupo vazio"), { code: "SOZINHO" });
    linhas = await enviarVarios(outros(), content, opts);
  }
  const id = Math.min(...linhas.map((l) => l.id)), at = linhas[0].created_at;
  await commit(me.id, g.id, { entryId: id, entry: { content, at, mine: true, from: me.id } });
  return { id, created_at: at, sender_id: me.id, recipient_id: null, grupo_id: g.id, read_at: null };
}
// Envia para a conversa aberta, seja uma pessoa ou um grupo. Devolve a "linha" para pôr na tela.
async function enviar(conv, content) {
  const row = conv.grupo ? await enviarAoGrupo(conv, content) : await sendContent(conv, content);
  if (content.type === "text" || content.type === "media") { const topo = listaConversas()[0]; tocaAtiv(conv.id, row.created_at); if (listaConversas()[0] !== topo) renderContacts(); } // a conversa sobe para o topo da lista
  return row;
}
const limitado = (e) => e?.code === "PT429" || e?.status === 429 || /limite de/i.test(e?.message || "");
const sendError = (e, conv) => { const quem = "@" + ((e?.peer || conv)?.username ?? "alguém");
  return limitado(e) ? "Você fez muitas coisas em pouco tempo. Espere cerca de um minuto e tente de novo."
  : e?.code === "NO_PREKEY" ? `${quem} ainda não abriu a versão nova do Lacre, então não dá para enviar com sigilo futuro. Peça para essa pessoa recarregar o site.`
  : e?.code === "PIN" ? (conv?.grupo ? `A chave de ${quem} mudou. Abra a conversa com ${quem}, confira o código de segurança e envie de novo.` : `A chave de ${quem} mudou. Abra o código de segurança, confira com ela e reabra a conversa.`)
  : e?.code === "SOZINHO" ? "Não há mais ninguém neste grupo."
  : e?.code === "FORA" ? "Você não participa mais deste grupo."
  : "Não foi possível enviar. Verifique a conexão e tente de novo."; };

function mostrar(m, c, animate) { // põe na tela um conteúdo já decifrado
  if (msgs.has(m.id)) return; // já está na tela (uma mensagem que chegou enquanto a conversa abria não aparece duas vezes)
  if (c.type === "reaction") return applyReaction(c, m);
  if (c.type === "hello" || c.type === "hidden") return;
  if (c.type === "delete") return aplicarApagar(c, m);
  if (c.type === "unreadable") return addMessage(m, c.text, { err: true });
  addMessage(m, c, { animate });
}
async function show(m, peer, animate) {
  if (msgs.has(m.id)) return;
  return mostrar(m, await readRow(m, peer), animate);
}
async function checkPin(peer) {
  const k = `pin:${me.id}:${peer.id}`, fp = await fingerprint(peer.public_key);
  let saved = null; try { saved = localStorage.getItem(k); } catch {}
  if (!saved) { try { localStorage.setItem(k, fp); } catch {} return true; }
  if (saved === fp) return true;
  const r = await choose(`A chave de @${peer.username} mudou`,
    "Isso pode ser só uma conta refeita, mas também pode ser alguém tentando se passar por essa pessoa. Confirme com ela por outro meio (veja o código de segurança) antes de continuar.",
    [{ label: "Não abrir esta conversa", value: "no", cls: "primary" }, { label: "Confio na nova chave", value: "yes", cls: "ghost" }]);
  if (r !== "yes") return false;
  try { localStorage.setItem(k, fp); } catch {}
  return true;
}
$("safety-btn").onclick = async () => {
  if (!active || active.grupo) return;
  $("safety-who").textContent = "@" + active.username;
  $("safety-code").replaceChildren(...(await safetyCode(me.public_key, active.public_key)).map((g) => el("span", null, g)));
  $("safety").showModal();
};
// Pintura imediata: o que este aparelho já guarda da conversa (as últimas 200) aparece na hora, sem esperar o servidor. O servidor confere em seguida e só acrescenta o que faltar
// (o que chegou com o app fechado e ainda não foi decifrado aqui). Devolve { tMax } (a hora da mais nova que foi pintada) ou null se não havia nada guardado.
async function pintarDoAparelho(conv, avisos) {
  const ult = await recentesDoHistorico(me.id, conv.id, 200).catch(() => []);
  const itens = ult.filter(({ entry }) => entry?.content && !["hidden", "hello", "reaction"].includes(entry.content.type) && Number.isFinite(Date.parse(entry.at)))
    .map(({ id, entry }) => ({ t: Date.parse(entry.at), id, entry }));
  // balões de aviso que o aparelho já mostrou antes ("não foi possível decifrar", "enviada de outro aparelho"): não ficam no histórico, então são lembrados à parte para entrarem junto com o resto
  const guardados = new Set(ult.map((u) => u.id));
  for (const x of ((await metaGet(me.id, "ph:" + conv.id).catch(() => null))?.itens || [])) {
    if (!Number.isSafeInteger(x?.id) || guardados.has(x.id) || typeof x.text !== "string" || typeof x.at !== "string" || !Number.isFinite(Date.parse(x.at))) continue;
    if (conv.grupo && !x.mine && typeof x.from !== "string") continue;
    itens.push({ t: Date.parse(x.at), id: x.id, entry: { content: { type: "unreadable", text: x.text.slice(0, 400) }, at: x.at, mine: !!x.mine, from: x.mine ? me.id : (conv.grupo ? x.from : conv.id) } });
  }
  itens.sort((a, b) => a.t - b.t || a.id - b.id);
  if (!itens.length) return null;
  const av = (avisos || []).filter((x) => ult.length < 200 || x.t >= itens[0].t); let tMax = 0, pintou = 0;
  const conhecidos = new Set([...ult.map((u) => u.id), ...itens.map((i) => i.id)]); // tudo o que o aparelho já decifrou (inclusive reações e toques que não viram balão): o servidor não precisa reler
  for (const it of itens) {
    const e = it.entry, minha = !!e.mine || e.from === me.id, quem = conv.grupo ? (minha ? me.id : e.from) : (minha ? me.id : conv.id);
    if (typeof quem !== "string") continue; // (grupo sem o autor guardado: fica para o servidor)
    while (av.length && av[0].t <= it.t) addAviso(textoAviso(av.shift()));
    const m = { id: it.id, sender_id: quem, recipient_id: minha ? (conv.grupo ? null : conv.id) : me.id, grupo_id: conv.grupo ? conv.id : null, created_at: e.at, read_at: null, v: 2 };
    mostrar(m, e.content, false); tMax = Math.max(tMax, it.t); pintou++;
  }
  for (const x of av) addAviso(textoAviso(x));
  // reações guardadas: os chips já aparecem junto com as mensagens (em ordem, a última de cada pessoa vale)
  for (const { id, entry } of ult) {
    if (entry?.content?.type !== "reaction") continue; const minha = !!entry.mine || entry.from === me.id, quem = conv.grupo ? (minha ? me.id : entry.from) : (minha ? me.id : conv.id);
    if (typeof quem === "string" && Number.isFinite(Date.parse(entry.at))) applyReaction(entry.content, { id, sender_id: quem, recipient_id: minha ? null : me.id, grupo_id: conv.grupo ? conv.id : null, created_at: entry.at, v: 2 });
  }
  if (pintou) [...msgs.keys()].forEach(renderRx);
  return pintou ? { tMax, conhecidos } : null;
}
// Lembra os balões de aviso que a conferência do servidor acabou de mostrar (a próxima abertura já os pinta junto com o resto, sem entrarem no meio da lista depois)
async function lembrarAvisosDaTela(conv, itens) {
  const novos = [];
  for (const it of itens) {
    const e = msgs.get(it.id); if (!e || e.content !== null || e.wrap.classList.contains("apagada")) continue; // (balão de aviso = mensagem com erro, sem conteúdo)
    novos.push({ id: it.id, at: e.m.created_at, mine: e.mine, from: e.m.sender_id, text: (e.wrap.querySelector(".vis")?.textContent || "").slice(0, 400) });
  }
  if (!novos.length) return;
  const velho = (await metaGet(me.id, "ph:" + conv.id).catch(() => null))?.itens || [], ids = new Set(novos.map((n) => n.id));
  await metaPut(me.id, "ph:" + conv.id, { itens: [...velho.filter((x) => !ids.has(x?.id)), ...novos].slice(-80) }).catch(() => {});
}
// O que já está na tela só atualiza "vista" (minhas) e "lida" (recebidas) com o que o servidor sabe; devolve se a mensagem já estava na tela
function atualizaNaTela(id, m, lote) {
  const ex = msgs.get(id); if (!ex) return false;
  if (lote?.ids) for (const l of lote.ids) linhaParaMsg.set(l, id); // (só as da conversa a dois têm a lista de linhas; no grupo não há "vista")
  const lida = lote ? lote.read_at : m?.read_at;
  if (lida && !ex.m.read_at) { ex.m.read_at = lida; setReceipt(ex); }
  return true;
}
// Uma mensagem minha sem texto guardado aqui (enviada de outro aparelho, no formato antigo) entra no lugar certo pela hora, sem refazer a lista
function posicionarPelaHora(id) {
  const e = msgs.get(id); if (!e) return; const t = Date.parse(e.m.created_at), todas = [...msgs.values()];
  for (const c of $("messages").children) {
    if (c === e.wrap || !c.classList.contains("msg")) continue;
    const o = todas.find((x) => x.wrap === c); if (!o) continue; const ot = Date.parse(o.m.created_at);
    if (ot > t || (ot === t && o.m.id > id)) { $("messages").insertBefore(e.wrap, c); return; }
  }
}
// Em grupo, depois de pôr uma mensagem no meio da lista: o nome de quem escreve só aparece na 1ª de uma sequência, e a foto só na última
function ajustarAutores(...wraps) {
  if (!active?.grupo) return;
  for (const w of wraps) {
    if (!w?.classList?.contains("msg") || w.classList.contains("mine")) continue;
    const prev = w.previousElementSibling, deve = !(prev?.classList.contains("msg") && prev.dataset.de === w.dataset.de), b = w.querySelector(".bubble"), tem = b?.querySelector(":scope > .autor");
    if (deve && !tem && b) { const x = el("span", "autor", "@" + nomeDe(w.dataset.de)); x.setAttribute("aria-hidden", "true"); b.prepend(x); } else if (!deve && tem) tem.remove();
    reavaliarAvatar(w);
  }
}
const pertoDoFim = () => { const L = $("messages"); return L.scrollHeight - L.scrollTop - L.clientHeight < 140; };
function revelarNoFim() { const L = $("messages"); L.scrollTop = L.scrollHeight; requestAnimationFrame(() => { L.scrollTop = L.scrollHeight; L.classList.remove("carregando"); }); }

async function open(peer) {
  if (peer.grupo) return abrirGrupo(peer);
  bandeja(false); fecharMencoes();
  if (!(await checkPin(peer))) return;
  active = peer; limparNaoLidas(peer.id); renderContacts(); updateStatus();
  pintarAvatar($("conv-av"), peer, true); $("conv-av").setAttribute("aria-label", "Ver foto de perfil"); atualizaFotoDe(peer).catch(() => {});
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = "@" + peer.username;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("bg-btn").hidden = false; $("safety-btn").hidden = false; $("grupo-btn").hidden = true; clearPending(); setBg(bgCache.get(peer.id) ?? null); applyBackground(peer);
  $("messages").replaceChildren(); msgs.clear(); reactions.clear(); midParaId.clear(); cancelarResposta();
  $("messages").classList.add("carregando"); // a lista só aparece pronta, já nas últimas mensagens (sem descer na frente da pessoa)
  carregandoConversa = peer; filaChegando = [];
  let local = null; // o que foi pintado do próprio aparelho antes de o servidor responder
  try {
  local = await pintarDoAparelho(peer, ((await metaGet(me.id, "d:" + peer.id).catch(() => null))?.avisos || []).slice());
  if (active !== peer) return;
  if (local) { revelarNoFim(); focoSeMouse(); } // já aparece (nas últimas mensagens) enquanto o servidor confere; no computador o foco já vai para o campo (no celular o teclado só sobe se a pessoa tocar nele)
  const base = (cols) => sb.from("messages").select(cols).is("grupo_id", null);
  const [antigas, recebidas, minhas, proprias] = await Promise.all([
    base("*").or(`and(sender_id.eq.${me.id},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me.id})`).is("para_aparelho", null).order("id", { ascending: false }).limit(200), // formato antigo (as 200 mais NOVAS; depois ficam em ordem de envio)
    base("*").eq("sender_id", peer.id).eq("recipient_id", me.id).not("para_aparelho", "is", null).order("id", { ascending: false }).limit(200), // cópias endereçadas a ESTE aparelho (o servidor só deixa ler as dele)
    base("id,created_at,avisar,para_aparelho,read_at").eq("sender_id", me.id).eq("recipient_id", peer.id).not("para_aparelho", "is", null).order("id", { ascending: false }).limit(1000), // o que EU enviei (uma linha por aparelho de quem recebeu)
    base("id,created_at").eq("sender_id", me.id).eq("recipient_id", me.id).order("id", { ascending: false }).limit(200)]); // o que outro aparelho meu enviou (cópias para mim)
  if (active !== peer) return;
  const linhas = (antigas.data || []).reverse();
  await loadLegacyReactions(linhas, peer);
  const meusLotes = lotesDm(minhas.data, (minhas.data || []).length === 1000), lotePorT = new Map(meusLotes.map((l) => [l.created_at, l]));
  const donas = (await Promise.all((proprias.data || []).map(async (r) => { const ix = await metaGet(me.id, "cp:" + r.id).catch(() => null); return ix?.para === peer.id ? r : null; }))).filter(Boolean);
  const itens = [
    ...linhas.map((m) => ({ t: Date.parse(m.created_at), id: m.id, m })),
    ...(recebidas.data || []).reverse().map((m) => ({ t: Date.parse(m.created_at), id: m.id, m })),
    ...meusLotes.map((l) => ({ t: Date.parse(l.created_at), id: l.id, lote: l })),
    ...donas.map((r) => { const l = lotePorT.get(r.created_at); if (l) for (const id of l.ids) linhaParaMsg.set(id, r.id); return { t: Date.parse(r.created_at), id: r.id, m: { id: r.id, sender_id: me.id, recipient_id: peer.id, grupo_id: null, created_at: r.created_at, read_at: l?.read_at || null, v: 2 } }; })].sort((a, b) => a.t - b.t || a.id - b.id);
  { // o que este aparelho guarda mas o servidor não deixa listar (ex.: histórico importado de outro aparelho: as mensagens recebidas eram endereçadas àquele aparelho): entra no lugar certo, dentro do período já listado
    const vistos = new Set(itens.flatMap((it) => (it.lote ? [it.id, ...it.lote.ids] : [it.id]))), minT = itens.length ? Math.min(...itens.map((it) => it.t)) : 0;
    for (const { id, entry } of await ultimosDoHistorico(me.id, peer.id, 600).catch(() => [])) {
      const t = Date.parse(entry?.at); if (vistos.has(id) || !(t >= minT) || !entry?.content || entry.content.type === "hidden") continue;
      itens.push({ t, id, m: { id, sender_id: entry.mine ? me.id : peer.id, recipient_id: entry.mine ? peer.id : me.id, grupo_id: null, created_at: entry.at, read_at: null, v: 2 } });
    }
    itens.sort((a, b) => a.t - b.t || a.id - b.id);
  }
  const faltam = [];
  if (local) { // o servidor só confere: o que já está na tela é atualizado, e só entra o que o aparelho ainda não tinha (nunca se apaga nem se refaz a lista)
    for (const it of itens) { if (atualizaNaTela(it.id, it.m, it.lote)) continue; if (!it.lote && local.conhecidos.has(it.id)) continue; faltam.push(it); }
    const perto = pertoDoFim(), topoAntes = $("messages").scrollTop;
    for (const it of faltam) { if (it.lote) await mostrarMeuLoteDm(peer, it.lote); else await show(it.m, peer, false); if (it.t <= local.tMax) posicionarPelaHora(it.id); } // (mais antiga que a já pintada: entra no lugar certo pela hora)
    if (perto && faltam.length && Math.abs($("messages").scrollTop - topoAntes) < 4) $("messages").scrollTop = $("messages").scrollHeight; // (só se a pessoa não mexeu na tela nesse meio-tempo)
    lembrarAvisosDaTela(peer, faltam).catch(() => {});
  } else {
    const avisosDm = ((await metaGet(me.id, "d:" + peer.id).catch(() => null))?.avisos || []).slice(); // avisos como "@antigo agora é @novo", cada um no seu lugar da conversa
    for (const it of itens) {
      while (avisosDm.length && avisosDm[0].t <= it.t) addAviso(textoAviso(avisosDm.shift()));
      if (it.lote) await mostrarMeuLoteDm(peer, it.lote); else await show(it.m, peer, false);
    }
    for (const a of avisosDm) addAviso(textoAviso(a));
    lembrarAvisosDaTela(peer, itens).catch(() => {});
  }
  [...msgs.keys()].forEach(renderRx);
  carregandoConversa = null; const fila = filaChegando; filaChegando = [];
  for (const m of fila) if (maisNovaQueATela(m)) await show(m, peer, false);
  if (!msgs.size) {
    const p = el("p", "empty", "Nenhuma mensagem ainda. Diga oi: só vocês dois vão ler."); p.id = "msgs-empty";
    $("messages").append(p);
  }
  } finally {
    if (carregandoConversa === peer) carregandoConversa = null; // (falhou no meio: não deixa mensagens novas presas na fila)
    if (active === peer && !local) revelarNoFim(); // (se a pessoa já abriu outra conversa, quem cuida da lista é a outra chamada; se já pintou do aparelho, a lista já está na tela e ninguém é puxado para baixo)
  }
  if (active !== peer) return;
  focoSeMouse(); // (no celular o teclado só sobe se a pessoa tocar no campo)
  markRead();
}
const voltarDaConversa = () => { fecharMencoes(); $("chat").classList.remove("in-conv"); active = null; renderContacts(); updateStatus(); };
$("back").onclick = voltarDaConversa;

let carregandoConversa = null, filaChegando = []; // mensagens que chegam enquanto open() ainda carrega
async function perfilDe(id) { // perfil de alguém que me escreveu (contato, participante de grupo, ou busca no servidor)
  const p = contacts.get(id) || perfis.get(id); if (p) return p;
  const { data } = await sb.from("profiles").select("id,username,public_key,avatar").eq("id", id).maybeSingle();
  if (data) perfis.set(id, data);
  return data || null;
}
// Tudo o que chega (ao vivo ou na sincronização) passa por UMA fila: as mensagens de cada pessoa são decifradas na ordem em que foram enviadas.
let filaEntrada = Promise.resolve();
const naFila = (fn) => (filaEntrada = filaEntrada.then(fn).catch((e) => console.warn("entrada:", e?.message || e)));
// Uma linha que não veio "ao vivo" só entra na tela se for mais nova do que tudo o que já está nela: a conversa aberta mostra as mensagens mais recentes,
// e uma mensagem mais antiga que essas (fora da janela) não pode aparecer no fim da lista.
const maisNovaQueATela = (m) => { for (const id of msgs.keys()) if (id >= m.id) return false; return true; };
// aoVivo = chegou agora pelo tempo real; false = veio da sincronização (chegou com o Lacre fechado)
async function onIncoming(m, aoVivo = true) {
  if (m.sender_id === me.id) return chegouCopiaPropria(m, aoVivo); // cópia do que enviei de outro aparelho meu
  const peer = await perfilDe(m.sender_id); if (!peer) return;
  if (m.grupo_id) return chegouDoGrupo(m, peer, aoVivo);
  if (m.v === 2) { // decifra já (para andar a cadeia de chaves), mesmo com a conversa fechada
    const c = await readRow(m, peer);
    if (c.type === "reaction") { if (active?.id === peer.id) applyReaction(c, m); return; }
    if (c.type === "hello") { if (c.gr) atualizarGrupos(true).catch(() => {}); if (c.pf) atualizarPerfisContatos().catch(() => {}); return; } // (gr: algo mudou num grupo em que estamos os dois; pf: alguém mudou de nome ou foto)
    if (c.type === "delete") { await aplicarApagar(c, m); return; }
  }
  if (!contacts.has(peer.id)) contacts.set(peer.id, peer);
  tocaAtiv(peer.id, m.created_at); marcaUltima(peer.id, m.created_at);
  if (active?.id === m.sender_id && carregandoConversa === active) filaChegando.push(m); // a conversa ainda está abrindo: entra na ordem certa quando terminar
  else if (active?.id === m.sender_id) { if (aoVivo || maisNovaQueATela(m)) { $("msgs-empty")?.remove(); await show(m, active, aoVivo); markRead(); } }
  else if (aoVivo || !m.read_at) contarNova(m.sender_id, m.id);
  renderContacts();
}
// Cópia cifrada que OUTRO aparelho meu mandou para este (de mim para mim). Só vale se vier de um aparelho meu e disser de qual conversa é (conteúdo cifrado).
// Fica guardada no histórico daquela conversa como mensagem minha; a anotação "cp:<linha>" diz de qual conversa é, para a lista da conversa achá-la e para nunca decifrar duas vezes.
async function lerCopiaPropria(m) {
  if (m.recipient_id !== me.id || m.v !== 2 || !ehRef(m.de_aparelho) || !ehRef(m.para_aparelho) || m.de_aparelho === meuRef()) return null; // (a que ESTE aparelho criou também chega pelo tempo real: é só o que ele mesmo enviou)
  const ja = await metaGet(me.id, "cp:" + m.id).catch(() => null); if (ja) return { content: null, para: ja.para, jaFeita: true };
  const eu = { id: me.id, public_key: me.public_key }, chave = chaveSessao(me.id, m.de_aparelho);
  return withLock(lockChave(chave), async () => {
    const outra = await metaGet(me.id, "cp:" + m.id).catch(() => null); if (outra) return { content: null, para: outra.para, jaFeita: true };
    const h = m.header; if (!validHeader(h)) return null;
    let st = await getSession(me.id, chave, h.sid);
    if (!st) { const spk = h.init && (await getSpks(me.id)).find((k) => k.id === h.init.spk); if (!spk) return null; st = await accept(ikJwk, eu.public_key, spk, h); }
    let state, plaintext; try { ({ state, plaintext } = await ratchetDecrypt(st, m.sender_id, m.recipient_id, h, m.ciphertext)); } catch { return null; }
    let content; try { content = parseContent(toText(plaintext)); } catch { return null; }
    // (a sessão não avança: nada de aceitar o que não confere). Conversa a dois: o conteúdo diz de qual conversa é ("para"). Grupo: o grupo da linha tem de ser o do conteúdo.
    const ok = m.grupo_id ? copiaGrupoValida(m, content, me.id, meuRef()) && conteudoBate(content, m.grupo_id) : copiaPropriaValida(m, content, me.id, meuRef()) && conteudoBate(content, null, { aDois: true });
    if (!ok) return null;
    const conv = m.grupo_id || content.para;
    await commit(me.id, chave, { session: state, active: h.sid, entryId: m.id, entry: { content, at: m.created_at, mine: true, from: me.id }, hist: conv, idx: { k: "cp:" + m.id, v: { para: conv } } });
    return { content, para: conv };
  });
}
async function chegouCopiaPropria(m, aoVivo) {
  const r = await lerCopiaPropria(m); if (!r || r.jaFeita) return;
  if (m.grupo_id) return chegouCopiaDoGrupo(m, r.content, aoVivo);
  const c = r.content, conv = r.para, peer = await perfilDe(conv); if (!peer) return;
  const m2 = { id: m.id, sender_id: me.id, recipient_id: conv, grupo_id: null, created_at: m.created_at, read_at: null, v: 2 };
  if (c.type === "hello") return;
  if (c.type === "delete") { await aplicarApagar(c, m2, conv); return; }
  if (c.type === "reaction") { if (active?.id === conv) applyReaction(c, m2); return; }
  if (!contacts.has(conv)) { contacts.set(conv, peer); perfis.set(conv, peer); }
  tocaAtiv(conv, m.created_at); marcaUltima(conv, m.created_at);
  if (active?.id === conv && carregandoConversa === active) filaChegando.push(m2);
  else if (active?.id === conv) { if (aoVivo || maisNovaQueATela(m2)) { $("msgs-empty")?.remove(); await show(m2, peer, false); } }
  renderContacts();
}
// O que outro aparelho meu mandou para um grupo: entra na conversa do grupo como mensagem minha (reagir e apagar também valem aqui)
async function chegouCopiaDoGrupo(m, c, aoVivo) {
  let g = grupos.get(m.grupo_id); if (!g) { await atualizarGrupos(true).catch(() => {}); g = grupos.get(m.grupo_id); } if (!g) return;
  const m2 = { id: m.id, sender_id: me.id, recipient_id: null, grupo_id: g.id, created_at: m.created_at, read_at: null, v: 2 };
  if (c.type === "hello") return;
  if (c.type === "delete") { await aplicarApagar(c, m2); return; }
  if (c.type === "reaction") { if (active === g) applyReaction(c, m2); return; }
  tocaAtiv(g.id, m.created_at); marcaUltima(g.id, m.created_at);
  if (active === g && carregandoConversa === g) filaChegando.push(m2);
  else if (active === g) { if (aoVivo || maisNovaQueATela(m2)) { $("msgs-empty")?.remove(); mostrar(m2, c, false); } }
  renderContacts();
}
async function chegouDoGrupo(m, peer, aoVivo) {
  let g = grupos.get(m.grupo_id);
  if (!g || !g.membros.has(m.sender_id)) { await atualizarGrupos(true).catch(() => {}); g = grupos.get(m.grupo_id); } // grupo novo para este aparelho, ou pessoa que acabou de entrar
  const c = await readRow(m, peer); // decifra sempre (anda a cadeia de chaves com essa pessoa), mesmo que eu já tenha saído do grupo
  if (!g) return;
  if (c.type === "reaction") { if (active === g) applyReaction(c, m); return; }
  if (c.type === "hello") return;
  if (c.type === "delete") { await aplicarApagar(c, m); return; }
  tocaAtiv(g.id, m.created_at); marcaUltima(g.id, m.created_at);
  if (active === g && carregandoConversa === g) filaChegando.push(m);
  else if (active === g) { if (aoVivo || maisNovaQueATela(m)) { $("msgs-empty")?.remove(); await mostrar(m, c, aoVivo); markRead(); } }
  else if (aoVivo || !m.read_at) contarNova(g.id, m.id);
  renderContacts();
}
// O que chegou com o Lacre fechado: decifra tudo, em ordem, logo ao abrir (sem isso, uma mensagem de grupo só seria lida quando eu abrisse a conversa a dois com quem a mandou).
// Bolinhas de não lida que já foram lidas em outro aparelho meu enquanto este estava fechado ou sem internet
async function reconciliarNaoLidas() {
  const ids = [...naoLidas.values()].flat().slice(-300); if (!ids.length) return;
  const { data } = await sb.from("messages").select("id,sender_id,grupo_id,read_at").in("id", ids).not("read_at", "is", null);
  for (const r of data || []) lidaEmOutroAparelho(r);
}
function sincronizar(tentativa = 0) {
  return naFila(async () => {
    const k = "lacre:sync:" + me.id; let desde = null; try { const v = localStorage.getItem(k); if (v !== null) desde = Number(v) || 0; } catch {}
    if (desde === null) { // primeira vez neste aparelho: começa de agora (o que veio antes é lido quando a conversa for aberta, como sempre foi)
      const { data, error } = await sb.from("messages").select("id").eq("recipient_id", me.id).order("id", { ascending: false }).limit(1);
      if (error) return "erro";
      try { localStorage.setItem(k, String(data?.[0]?.id ?? 0)); } catch {} // (sem mensagem nenhuma: 0, para a primeira que chegar, de qualquer número, ser buscada)
      return;
    }
    for (let pagina = 0; pagina < 20; pagina++) {
      const { data, error } = await sb.from("messages").select("*").eq("recipient_id", me.id).gt("id", desde).order("id").limit(500);
      if (error) return "erro"; // (503, rede caindo…): tenta de novo logo abaixo
      if (!data?.length) return;
      for (const m of data) { try { await onIncoming(m, false); } catch (e) { console.warn("sincronizar:", e?.message || e); } desde = m.id; }
      try { localStorage.setItem(k, String(desde)); } catch {}
      if (data.length < 500) return;
    }
  }).then((r) => {
    if (r === "erro" && tentativa < 6) setTimeout(() => sincronizar(tentativa + 1), 1500 * 2 ** tentativa); // a busca falhou: sem isso a mensagem só apareceria ao voltar para a aba
    return reconciliarNaoLidas();
  }).catch(() => {});
}

// ---------- Grupos ----------
// Aviso no meio da conversa ("@ana entrou no grupo")
function addAviso(texto) { if (!texto) return; const d = el("div", "aviso-linha"); d.append(el("span", null, texto)); const colar = $("messages").classList.contains("carregando") || pertoDoFim(); $("messages").append(d); if (colar) $("messages").scrollTop = 1e9; }
function sairDaConversa(aviso) { // fecha a conversa aberta e volta para a tela inicial
  fecharMencoes();
  $("chat").classList.remove("in-conv"); active = null; carregandoConversa = null; filaChegando = [];
  $("messages").replaceChildren(); msgs.clear(); reactions.clear(); midParaId.clear(); cancelarResposta(); clearPending(); setBg(null);
  $("conv-title").textContent = "Escolha um amigo"; $("conv-av").replaceChildren(); $("conv-av").disabled = true; $("conv-av").classList.remove("grupo");
  $("send-form").hidden = true; $("conv-empty").hidden = false; for (const id of ["badge", "bg-btn", "safety-btn", "grupo-btn"]) $(id).hidden = true;
  if ($("grupo-info").open) $("grupo-info").close();
  renderContacts(); updateStatus(); if (aviso) note(aviso);
}
// A chave do grupo (que abre só o NOME) chega embrulhada por quem me adicionou
const chavesGrupo = new Map(); // id do grupo -> { ref, gk }
async function chaveDoGrupo(n) {
  const ref = JSON.stringify(n.eu.chave), c = chavesGrupo.get(n.id); if (c?.ref === ref) return c.gk;
  const proprio = n.eu.por === me.id, pub = proprio ? me.public_key : n.eu.porChave; if (!pub) throw new Error("sem a chave de quem adicionou");
  if (!proprio && (await pinStatus({ id: n.eu.por, public_key: pub })) === "changed") throw new Error("a chave de quem adicionou mudou"); // não aceito um nome vindo de uma chave que não é a que eu conhecia
  const gk = abrirEmbrulho(await decrypt(myKeys.privateKey, pub, n.eu.chave), n.id);
  chavesGrupo.set(n.id, { ref, gk }); return gk;
}
// Este aparelho anota quem estava em cada grupo: se a lista mudar, aparece um aviso na conversa (ninguém entra num grupo sem os outros verem).
async function anotarMudancas(g, n) {
  const k = "g:" + g.id, agora = Object.fromEntries(n.membros.map((p) => [p.id, p.username])), cargos = Object.fromEntries(n.membros.map((p) => [p.id, cargoDe(p)])), foto = g.foto?.p || null, avisos = [];
  let est = await metaGet(me.id, k).catch(() => null), t = Date.now();
  if (!est) { // primeira vez que este aparelho vê o grupo
    avisos.push(n.eu.por === me.id ? { tipo: "criou" } : { tipo: "adicionado", nome: n.membros.find((p) => p.id === n.eu.por)?.username || "alguém" });
    est = { membros: agora, nome: g.semNome ? null : g.nome, cargos, foto, selos: n.selos?.atualizado_em || null, avisos: [] }; t = Date.parse(n.eu.entrouEm) || t;
  } else {
    const d = diferencaMembros(est.membros || {}, agora, me.id);
    for (const p of d.entraram) avisos.push({ tipo: "entrou", id: p.id, nome: p.nome });
    for (const p of d.sairam) avisos.push({ tipo: "saiu", id: p.id, nome: p.nome });
    for (const [id, nome] of Object.entries(agora)) if (id !== me.id && id in (est.membros || {}) && est.membros[id] !== nome) avisos.push({ tipo: "renomeou", id, de: est.membros[id], nome }); // trocou de nome de usuário
    if (!g.semNome && est.nome && est.nome !== g.nome) avisos.push({ tipo: "nome", nome: g.nome });
    if (est.cargos) for (const c of diferencaCargos(est.cargos, cargos)) avisos.push({ tipo: c.para === "sub" ? "sub" : c.para === "admin" ? "admin" : "semsub", id: c.id, nome: agora[c.id] });
    if ("foto" in est && est.foto !== foto) avisos.push({ tipo: "foto", removida: !foto });
    const selosAgora = n.selos?.atualizado_em || null;
    if (selosAgora && est.selos !== undefined && est.selos !== selosAgora) avisos.push({ tipo: "selos", id: n.selos.por, nome: agora[n.selos.por], eu: n.selos.por === me.id }); // (est.selos ainda não existe em quem já via o grupo antes dos Selos: só anota, sem aviso)
    const igual = JSON.stringify(est.cargos) === JSON.stringify(cargos) && est.foto === foto && est.selos === selosAgora;
    if (!avisos.length && igual && (g.semNome || est.nome === g.nome)) return;
    est.selos = selosAgora; est.membros = agora; est.cargos = cargos; est.foto = foto; if (!g.semNome) est.nome = g.nome;
  }
  for (const a of avisos) a.t = t;
  est.avisos = [...(est.avisos || []), ...avisos].slice(-60);
  await metaPut(me.id, k, est).catch(() => {});
  if (active === g && carregandoConversa !== g) { $("msgs-empty")?.remove(); for (const a of avisos) addAviso(textoAviso(a)); }
}
let carregandoGrupos = null;
// Busca no servidor os meus grupos e quem está em cada um. fresco = precisa refletir uma mudança que acabou de acontecer.
function atualizarGrupos(fresco = false) {
  if (carregandoGrupos) return fresco ? carregandoGrupos.then(() => atualizarGrupos()) : carregandoGrupos;
  return (carregandoGrupos = (async () => {
    try {
      const { data, error } = await sb.rpc("meus_grupos"); if (error) return;
      const selosPor = new Map(((await sb.rpc("selos_resumo")).data || []).map((x) => [x.grupo_id, x])); // quando as regras dos Selos de cada grupo mudaram (para o aviso no chat)
      const vistos = new Set();
      for (const n of montarGrupos(data, me.id)) {
        vistos.add(n.id);
        const g = grupos.get(n.id) || { id: n.id, grupo: true, nome: "Grupo", membros: new Map() };
        g.membros = new Map(n.membros.map((p) => [p.id, p])); g.admin = n.eu.admin; g.sub = n.eu.sub; g.entrouEm = n.eu.entrouEm; g.foto = limpaFoto(n.foto, n.id);
        for (const p of n.membros) if (p.id !== me.id) perfis.set(p.id, p);
        g.gk = await chaveDoGrupo(n).catch(() => null);
        const nome = g.gk ? await abrirNome(g.gk, n.id, n.nomeCifrado).catch(() => null) : null;
        g.nome = nome || "Grupo"; g.semNome = !nome;
        grupos.set(n.id, g); tocaAtiv(n.id, n.eu.entrouEm);
        n.selos = selosPor.get(n.id) || null; await anotarMudancas(g, n);
      }
      for (const [id, g] of [...grupos]) if (!vistos.has(id)) { // saí, fui removido, ou o grupo acabou
        grupos.delete(id); limparNaoLidas(id); ultima.delete(id); ultimaCerta.delete(id); agendaUlt(); chavesGrupo.delete(id);
        if (active === g) sairDaConversa(g.saindo ? "" : `Você não participa mais do grupo “${g.nome}”.`);
      }
      for (const [id, g] of grupos) if (!g.pintado || g.pintado !== g.nome + "|" + (g.foto?.p || "")) { g.pintado = g.nome + "|" + (g.foto?.p || ""); if (active === g) pintarAvatarGrupo($("conv-av"), g, true); }
      if (active?.grupo) { $("conv-title").textContent = active.nome; updateStatus(); repintarCoresGrupo(); }
      if ($("cor-folha").open) desenharCor();
      if ($("grupo-info").open) desenharInfoGrupo();
      renderContacts();
    } finally { carregandoGrupos = null; }
  })());
}
// Uma mensagem MINHA a dois no formato por aparelho (no servidor, uma linha por aparelho de quem recebeu). Só aparece aqui se ESTE aparelho a enviou (está no histórico);
// a que outro aparelho meu enviou chega como cópia para mim e aparece por ela.
async function mostrarMeuLoteDm(peer, l) {
  for (const id of l.ids) linhaParaMsg.set(id, l.id);
  const e = await getHistory(me.id, peer.id, l.id).catch(() => null); if (!e) return;
  mostrar({ id: l.id, sender_id: me.id, recipient_id: peer.id, grupo_id: null, created_at: l.created_at, read_at: l.read_at }, e.content, false);
}
async function mostrarMeuLote(g, l) { // uma mensagem MINHA no grupo (no servidor ela é uma linha por pessoa)
  const m = { id: l.id, sender_id: me.id, recipient_id: null, grupo_id: g.id, created_at: l.created_at, read_at: null };
  const e = await getHistory(me.id, g.id, l.id).catch(() => null);
  if (e) return mostrar(m, e.content, false);
  if (!l.avisar) return; // aviso automático (apagar…) enviado por outro aparelho meu
  addMessage(m, "Enviada por você de outro navegador ou aparelho (como o computador). Para ver aqui: exporte o histórico de lá e importe aqui, em Segurança da conta.", { err: true });
}
// Ao abrir o grupo: a cópia que outro aparelho meu mandou para este (já lida antes, ou lida agora) aparece como mensagem minha
async function mostrarCopiaDoGrupo(g, m) {
  const m2 = { id: m.id, sender_id: me.id, recipient_id: null, grupo_id: g.id, created_at: m.created_at, read_at: null, v: 2 };
  const r = await lerCopiaPropria(m).catch(() => null);
  if (r?.content && !r.jaFeita) { const c = r.content; if (c.type === "delete") return aplicarApagar(c, m2); if (c.type === "reaction") return applyReaction(c, m2); if (c.type !== "hello") mostrar(m2, c, false); return; }
  const e = await getHistory(me.id, g.id, m.id).catch(() => null); if (e) mostrar(m2, e.content, false);
}
async function abrirGrupo(g) {
  bandeja(false); fecharMencoes();
  active = g; limparNaoLidas(g.id); renderContacts(); updateStatus();
  pintarAvatarGrupo($("conv-av"), g, true); $("conv-av").setAttribute("aria-label", "Dados do grupo");
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = g.nome;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("bg-btn").hidden = true; $("safety-btn").hidden = true; $("grupo-btn").hidden = false; clearPending(); setBg(null);
  $("messages").replaceChildren(); msgs.clear(); reactions.clear(); midParaId.clear(); cancelarResposta();
  $("messages").classList.add("carregando");
  carregandoConversa = g; filaChegando = [];
  atualizarGrupos().catch(() => {}); // confere quem está no grupo agora
  let local = null; // o que foi pintado do próprio aparelho antes de o servidor responder
  try {
    local = await pintarDoAparelho(g, (await metaGet(me.id, "g:" + g.id).catch(() => null))?.avisos || []);
    if (active !== g) return;
    if (local) { revelarNoFim(); focoSeMouse(); } // já aparece (nas últimas mensagens) enquanto o servidor confere; no computador o foco já vai para o campo (no celular o teclado só sobe se a pessoa tocar nele)
    const [rec, meus, est] = await Promise.all([
      sb.from("messages").select("*").eq("grupo_id", g.id).eq("recipient_id", me.id).order("id", { ascending: false }).limit(200), // o que os outros mandaram (as 200 mais novas)
      sb.from("messages").select("id,created_at,avisar,para_aparelho,de_aparelho").eq("grupo_id", g.id).eq("sender_id", me.id).order("id", { ascending: false }).limit(1000), // o que eu mandei (uma linha por aparelho de cada pessoa)
      metaGet(me.id, "g:" + g.id).catch(() => null)]);
    if (active !== g) return;
    // (entre as linhas "para mim" vêm também as cópias que ESTE aparelho mandou aos meus outros aparelhos: essas não são para ler aqui)
    const recebidas = (rec.data || []).reverse().filter((m) => m.sender_id !== me.id || m.para_aparelho === meuRef()), cheio = (rec.data || []).length === 200, corte = cheio && recebidas.length ? recebidas[0].id : 0, corteT = cheio && recebidas.length ? Date.parse(recebidas[0].created_at) : 0;
    const itens = [
      ...recebidas.map((m) => ({ t: Date.parse(m.created_at), id: m.id, m })),
      ...lotesGrupo(meus.data, (meus.data || []).length === 1000).filter((l) => l.id >= corte && !loteDeOutroAparelho(l, meuRef())).map((l) => ({ t: Date.parse(l.created_at), id: l.id, lote: l })), // (o que OUTRO aparelho meu enviou aparece pela cópia que ele mandou para este)
      ...(est?.avisos || []).filter((a) => a.t >= corteT).map((a) => ({ t: a.t, id: 0, aviso: a }))].sort((a, b) => a.t - b.t || a.id - b.id);
    const colocar = async (it) => {
      if (it.aviso) addAviso(textoAviso(it.aviso));
      else if (it.lote) await mostrarMeuLote(g, it.lote);
      else if (it.m.sender_id === me.id) await mostrarCopiaDoGrupo(g, it.m);
      else { const p = await perfilDe(it.m.sender_id); if (p) await show(it.m, p, false); }
    };
    const faltam = [];
    if (local) { // o servidor só confere: o que já está na tela é atualizado, e só entra o que o aparelho ainda não tinha (nunca se apaga nem se refaz a lista)
      for (const it of itens) { if (it.aviso || atualizaNaTela(it.id, it.m, it.lote)) continue; if (!it.lote && local.conhecidos.has(it.id)) continue; faltam.push(it); }
      const perto = pertoDoFim(), topoAntes = $("messages").scrollTop;
      for (const it of faltam) { await colocar(it); if (it.t <= local.tMax) { posicionarPelaHora(it.id); const e = msgs.get(it.id); if (e) ajustarAutores(e.wrap.previousElementSibling, e.wrap, e.wrap.nextElementSibling); } } // (mais antiga que a já pintada: entra no lugar certo pela hora)
      if (perto && faltam.length && Math.abs($("messages").scrollTop - topoAntes) < 4) $("messages").scrollTop = $("messages").scrollHeight; // (só se a pessoa não mexeu na tela nesse meio-tempo)
      lembrarAvisosDaTela(g, faltam).catch(() => {});
    } else { for (const it of itens) await colocar(it); lembrarAvisosDaTela(g, itens.filter((it) => !it.aviso)).catch(() => {}); }
    [...msgs.keys()].forEach(renderRx);
    carregandoConversa = null; const fila = filaChegando; filaChegando = [];
    for (const m of fila) { if (!maisNovaQueATela(m)) continue; if (m.sender_id === me.id) { const e = await getHistory(me.id, g.id, m.id).catch(() => null); if (e) mostrar(m, e.content, false); } else { const p = await perfilDe(m.sender_id); if (p) await show(m, p, false); } }
    if (!$("messages").childElementCount) {
      const p = el("p", "empty", "Nenhuma mensagem ainda. Diga oi: só quem está no grupo vai ler."); p.id = "msgs-empty";
      $("messages").append(p);
    }
  } finally {
    if (carregandoConversa === g) carregandoConversa = null;
    if (active === g && !local) revelarNoFim(); // (já pintou do aparelho: a lista já está na tela e ninguém é puxado para baixo)
  }
  if (active !== g) return;
  focoSeMouse(); // (no celular o teclado só sobe se a pessoa tocar no campo)
  markRead();
}

// ----- criar, adicionar, remover, sair, mudar o nome -----
const embrulharPara = (gk, grupoId, p) => encrypt(myKeys.privateKey, p.public_key, embrulho(gk, grupoId)); // só essa pessoa (e eu) abrimos
const erroGrupo = (e) => { const m = e?.message || "", quem = (id) => "@" + (perfis.get(id)?.username || contacts.get(id)?.username || "essa pessoa");
  return /nao_conversou/.test(m) ? `${quem(e.details)} ainda não trocou mensagens com você. Só entra num grupo seu quem já conversou com você (e respondeu).`
    : /grupos_demais_dela/.test(m) ? `${quem(e.details)} já está em grupos demais.`
    : /grupos_demais/.test(m) ? "Você já está em 50 grupos. Saia de algum para criar outro."
    : /grupo_cheio|tamanho_do_grupo/.test(m) ? `Um grupo tem no máximo ${MAX_MEMBROS} pessoas.`
    : /so_admin/.test(m) ? "Só quem é admin do grupo pode fazer isso."
    : /sem_permissao/.test(m) ? "Você não tem permissão para fazer isso neste grupo."
    : /alvo_invalido/.test(m) ? "Não dá para dar esse cargo a essa pessoa."
    : /foto_invalida/.test(m) ? "Não foi possível usar essa foto. Tente outra."
    : /cor_em_uso/.test(m) ? "Essa cor acabou de ser escolhida por outra pessoa. Escolha outra."
    : /cor_invalida/.test(m) ? "Essa cor não é válida."
    : e?.code === "PIN" ? `A chave de @${e.peer?.username} mudou. Abra a conversa com essa pessoa e confira o código de segurança antes.`
    : limitado(e) ? "Muitas mudanças em pouco tempo. Espere um minuto e tente de novo."
    : "Não foi possível agora. Verifique a conexão e tente de novo."; };
// "Algo mudou no grupo": um toque cifrado (sem conteúdo) para o Lacre de cada pessoa atualizar a lista na hora
async function avisarMudanca(pessoas) {
  const l = [...new Map(pessoas.filter((p) => p.id !== me.id).map((p) => [p.id, p])).values()]; if (!l.length) return;
  try { await enviarVarios(l, { type: "hello", gr: 1 }, { avisar: false }); } catch {}
}
async function criarGrupo(nome, pessoas) {
  for (const p of pessoas) if ((await pinStatus(p)) === "changed") throw Object.assign(new Error("chave mudou"), { code: "PIN", peer: p });
  const id = crypto.randomUUID(), gk = novaChave();
  const [nomeCifrado, minha, membros] = await Promise.all([cifrarNome(gk, id, nome), embrulharPara(gk, id, me), Promise.all(pessoas.map(async (p) => ({ id: p.id, chave: await embrulharPara(gk, id, p) })))]);
  const { error } = await sb.rpc("criar_grupo", { p_id: id, p_nome: nomeCifrado, p_chave: minha, p_membros: membros });
  if (error) throw error;
  await atualizarGrupos(true); avisarMudanca(pessoas);
  return grupos.get(id);
}
async function adicionarAoGrupo(g, pessoas) {
  if (!g.gk) throw new Error("sem a chave do grupo");
  const antes = [...g.membros.values()];
  for (const p of pessoas) {
    if ((await pinStatus(p)) === "changed") throw Object.assign(new Error("chave mudou"), { code: "PIN", peer: p });
    const { error } = await sb.rpc("grupo_adicionar", { p_grupo: g.id, p_user: p.id, p_chave: await embrulharPara(g.gk, g.id, p) });
    if (error) { await atualizarGrupos(true).catch(() => {}); throw error; }
  }
  await atualizarGrupos(true); avisarMudanca([...antes, ...pessoas]);
}
async function removerDoGrupo(g, p) {
  const r = await choose(`Remover @${p.username}?`, `@${p.username} deixa de receber as mensagens de “${g.nome}”. O que essa pessoa já recebeu continua no aparelho dela.`, [
    { label: "Remover do grupo", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  const todos = [...g.membros.values()];
  const { error } = await sb.rpc("grupo_remover", { p_grupo: g.id, p_user: p.id });
  if (error) { msgGrupo(erroGrupo(error)); return; }
  await atualizarGrupos(true); avisarMudanca(todos);
}
// ----- tela "Dados do grupo" -----
let giGrupo = null;
const msgGrupo = (t, ok) => { const m = $("gi-msg"); m.textContent = t; m.className = "pg-msg" + (ok ? " ok" : ""); };
function abrirInfoGrupo(g) { giGrupo = g; msgGrupo(""); desenharInfoGrupo(); $("grupo-info").showModal(); atualizarGrupos().catch(() => {}); }
function desenharInfoGrupo() {
  const g = giGrupo && grupos.get(giGrupo.id); if (!g) { if ($("grupo-info").open) $("grupo-info").close(); return; }
  const meu = cargoDe({ admin: g.admin, sub: g.sub });
  pintarAvatarGrupo($("gi-av"), g); $("gi-nome").textContent = g.nome; $("gi-sub").textContent = "Grupo · " + contagem(g.membros.size);
  $("gi-foto-btn").hidden = !g.admin || !g.gk; $("gi-foto-rm").hidden = !g.admin || !g.foto;
  { const c = g.membros.get(me.id)?.cor, st = estilosDaCor(c); $("gi-cor-nome").textContent = nomeDaCor(c); $("gi-cor-sw").style.setProperty("--c", st?.claro.forte || "transparent"); }
  $("gi-renomear").hidden = !g.admin || !g.gk; $("gi-add").hidden = !g.admin || !g.gk || g.membros.size >= MAX_MEMBROS;
  $("gi-cont").textContent = `Participantes · ${g.membros.size} de ${MAX_MEMBROS}`;
  const ordem = [...g.membros.values()].sort((a, b) => (b.id === me.id) - (a.id === me.id) || b.admin - a.admin || b.sub - a.sub || a.username.localeCompare(b.username));
  $("gi-lista").replaceChildren(...ordem.map((p) => {
    const row = el("div", "linha info pessoa"), av = el("span", "avatar"), tx = el("span", "tx"), tit = el("span", "ap-tit"), eu = p.id === me.id, cargo = cargoDe(p);
    row.dataset.uid = p.id; pintarAvatar(av, p, true);
    tit.append(el("b", null, "@" + p.username + (eu ? " (você)" : ""))); if (cargo === "admin") tit.append(el("span", "selo-estado", "admin")); if (cargo === "sub") tit.append(el("span", "selo-estado sub", "sub-admin"));
    tx.append(tit); row.append(av, tx);
    const botao = (cls, rotulo, caminhos, fn) => { const b = el("button", "so-icone " + cls); b.type = "button"; b.setAttribute("aria-label", rotulo); b.title = rotulo; b.append(svgIcone(caminhos)); b.onclick = fn; row.append(b); };
    if (!eu) botao("conversar", "Conversar com @" + p.username, ["M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"], () => { $("grupo-info").close(); if (!contacts.has(p.id)) contacts.set(p.id, { id: p.id, username: p.username, public_key: p.public_key, avatar: p.avatar }); tocaAtiv(p.id, Date.now()); open(contacts.get(p.id)); });
    if (!eu && podeDarCargo(meu, cargo)) botao("cargo", cargo === "sub" ? "Tirar o cargo de sub-admin de @" + p.username : "Tornar @" + p.username + " sub-admin",
      cargo === "sub" ? ["M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z", "M9 9l6 6M15 9l-6 6"] : ["M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z", "M9 12l2 2 4-4"], () => mudarCargo(g, p, cargo !== "sub"));
    if (!eu && podeRemover(meu, cargo)) botao("perigo remover", "Remover @" + p.username + " do grupo", ["M6 6l12 12M18 6L6 18"], () => removerDoGrupo(g, p));
    return row;
  }));
}

// ---------- Estatísticas do grupo ----------
// Tempo de tela: conta de 5 em 5 s enquanto o chat DESTE grupo está aberto, a aba visível e a pessoa mexendo (toque, tecla, rolagem nos últimos 60 s); manda ao servidor a cada ~60 s.
let telaGrupo = null, telaSeg = 0, ultimoToque = Date.now();
for (const ev of ["pointerdown", "keydown", "scroll", "touchstart", "wheel"]) addEventListener(ev, () => { ultimoToque = Date.now(); }, { passive: true, capture: true });
async function enviarTela() {
  const g = telaGrupo, n = Math.min(120, telaSeg); if (!g || n < 1) return; telaSeg -= n;
  const { error } = await sb.rpc("grupo_tela", { p_grupo: g, p_segundos: n }); if (error && error.code !== "PT429" && error.code !== "42501") telaSeg += n; // (falha de rede: tenta de novo; limite ou saída do grupo: descarta)
}
setInterval(() => {
  const g = active?.grupo ? active.id : null;
  if (g !== telaGrupo) { const velho = telaGrupo; if (velho) { enviarTela().catch(() => {}); publicarDoHistorico(velho); } telaGrupo = g; telaSeg = 0; if (g) publicarDoHistorico(g); }
  if (g && document.visibilityState === "visible" && Date.now() - ultimoToque < 60000) { telaSeg += 5; if (telaSeg >= 60) enviarTela().catch(() => {}); }
}, 5000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") enviarTela().catch(() => {}); });

// O que eu enviei, por dia, vai para o servidor (só contagens): assim o outro aparelho meu e os dos outros membros mostram o mesmo número. No máximo 1 envio por minuto por grupo.
const enviadasEm = new Map();
async function publicarEnviadas(g, local, forcar = false) {
  if (!forcar && Date.now() - (enviadasEm.get(g.id) || 0) < 60000) return;
  const dias = publicavel(local.get(me.id), primeiroDia("mes", new Date(Date.now() - 5 * 864e5))); if (!dias.length) return;
  enviadasEm.set(g.id, Date.now()); await sb.rpc("grupo_enviadas", { p_grupo: g.id, p_dias: dias });
}
async function publicarDoHistorico(id) { const g = grupos.get(id); if (!g) return; const local = porDia(await todoHistorico(me.id, id).catch(() => []), [...g.membros.values()]); await publicarEnviadas(g, local).catch(() => {}); }
let estPeriodo = "hoje", estAberto = null, estGrupo = null, estDados = null;
const msgEst = (t) => { $("est-msg").textContent = t; };
async function abrirEstatisticas(g) {
  estGrupo = g; estDados = null; estAberto = null; msgEst(""); $("est-lista").replaceChildren(); $("est-resumo").textContent = "Carregando…"; $("grupo-est").showModal();
  if (telaGrupo === g.id) await enviarTela().catch(() => {}); // (o meu tempo de agora entra na conta)
  const hist = await todoHistorico(me.id, g.id).catch(() => []), local = porDia(hist, [...g.membros.values()]);
  await publicarEnviadas(g, local, true); // (o que eu enviei entra no servidor antes de eu ler: os outros aparelhos passam a contar igual)
  const tela = await sb.rpc("grupo_estatisticas", { p_grupo: g.id });
  if (estGrupo !== g) return;
  if (tela.error) msgEst("Não foi possível carregar o tempo na tela agora.");
  estDados = { local, tela: tela.data || [] }; desenharEstatisticas();
}
function desenharEstatisticas() {
  const g = estGrupo && grupos.get(estGrupo.id); if (!g || !estDados) return;
  const membros = [...g.membros.values()], desde = primeiroDia(estPeriodo), hoje = diaLocal(Date.now());
  const cont = resumir(mesclar(estDados.local, estDados.tela), desde), tela = somarTela(estDados.tela, desde), lista = ranking(membros, cont, tela);
  const total = totalDe(cont), nome = { hoje: "hoje", semana: "nesta semana", mes: "neste mês" }[estPeriodo];
  $("est-resumo").textContent = `${total === 1 ? "1 mensagem" : total + " mensagens"} ${nome} no grupo`;
  for (const b of $("grupo-est").querySelectorAll(".est-abas button")) b.setAttribute("aria-selected", String(b.dataset.p === estPeriodo));
  $("est-lista").replaceChildren(...lista.map(({ p, c, seg }, i) => {
    const eu = p.id === me.id, wrap = el("div", "est-pessoa" + (eu ? " eu" : "")), b = el("button", "est-linha"), av = el("span", "avatar"), nm = el("span", "est-nome"), n = el("span", "est-num");
    b.type = "button"; b.setAttribute("aria-expanded", String(estAberto === p.id)); pintarAvatar(av, p, false);
    const seq = sequencia(c.dias, hoje), sub = [tempoTexto(seg) + " na tela", seq > 1 ? "🔥 " + textoSequencia(seq) : ""].filter(Boolean).join(" · ");
    nm.append(el("b", null, "@" + p.username + (eu ? " (você)" : "")), el("small", null, sub));
    n.append(String(c.total), el("small", null, c.total === 1 ? "mensagem" : "mensagens")); { const st = estilosDaCor(p.cor); if (st) n.style.setProperty("--c", st.claro.forte); }
    b.append(el("span", "est-pos", String(i + 1)), av, nm, n); b.onclick = () => { estAberto = estAberto === p.id ? null : p.id; desenharEstatisticas(); };
    wrap.append(b);
    if (estAberto === p.id) {
      const mais = el("div", "est-mais"), chips = el("div", "est-chips"), ln = (r, v) => { const d = el("div", "est-ln"); d.append(el("span", null, r), el("b", null, String(v))); return d; };
      for (const [k, r] of [["texto", "texto"], ["foto", "fotos"], ["video", "vídeos"], ["audio", "áudios"], ["figurinha", "figurinhas"]]) chips.append(el("span", null, `${c[k]} ${r}`));
      mais.append(chips, ln("Respostas", c.respostas), ln("Citou (@) / foi citado", `${c.citou} / ${c.citada}`), ln("Sequência", seq ? textoSequencia(seq) : "—"), ln("No grupo", noGrupoHa(p.entrou_em).replace("No grupo há ", "há ")));
      wrap.append(mais);
    }
    return wrap;
  }));
}
$("gi-est").onclick = () => { if (giGrupo) abrirEstatisticas(giGrupo).catch(() => msgEst("Não foi possível abrir agora.")); };
for (const b of $("grupo-est").querySelectorAll(".est-abas button")) b.onclick = () => { estPeriodo = b.dataset.p; estAberto = null; desenharEstatisticas(); };
$("grupo-est").addEventListener("close", () => { estGrupo = null; estDados = null; });

// ---------- Selos ----------
// A moeda do grupo. O servidor calcula os ganhos (envios, arquivos, dias, entrada) pelas regras que o admin define; aqui só se mostra o saldo e se edita a regra.
const SVGNS = "http://www.w3.org/2000/svg";
function seloIcone(tam = 20, pendente = false) {
  const s = document.createElementNS(SVGNS, "svg"), u = document.createElementNS(SVGNS, "use");
  s.setAttribute("viewBox", "0 0 100 100"); s.setAttribute("width", String(tam)); s.setAttribute("height", String(tam)); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "selo-ico" + (pendente ? " pend" : ""));
  u.setAttribute("href", "#selo"); s.append(u); return s;
}
let slGrupo = null, slDados = null, srRascunho = null, srAntes = null;
const msgSelos = (t) => { $("sl-msg").textContent = t; };
async function abrirSelos(g) {
  slGrupo = g; slDados = null; msgSelos(""); $("sl-lista").replaceChildren(); $("sl-regras").replaceChildren(); $("sl-meu").replaceChildren(el("span", "t", "Carregando…")); $("sl-editar").hidden = true; $("selos").showModal();
  await carregarSelos(g);
}
async function carregarSelos(g) {
  const [s, r] = await Promise.all([sb.rpc("selo_saldo", { p_grupo: g.id }), sb.rpc("selo_regras_ver", { p_grupo: g.id })]);
  if (slGrupo !== g) return;
  if (s.error || r.error) { msgSelos("Não foi possível carregar os Selos agora."); $("sl-meu").replaceChildren(); return; }
  slDados = { regras: limpaRegras(r.data?.[0]?.regras), saldo: new Map((s.data || []).map(saldoLimpo).map((x) => [x.id, x])) }; desenharSelos();
}
function desenharSelos() {
  const g = slGrupo && grupos.get(slGrupo.id); if (!g || !slDados) return;
  const tem = (x) => slDados.saldo.get(x)?.saldo || 0, meu = tem(me.id);
  const n = el("span", "n", String(meu)), t = el("span", "t"); t.append(n, el("small", null, meu === 1 ? "Selo" : "Selos"));
  $("sl-meu").replaceChildren(seloIcone(48), t);
  const ordem = [...g.membros.values()].sort((a, b) => tem(b.id) - tem(a.id) || a.username.localeCompare(b.username));
  $("sl-lista").replaceChildren(...ordem.map((p) => {
    const eu = p.id === me.id, row = el("div", "sl-pessoa" + (eu ? " eu" : "")), av = el("span", "avatar"), nm = el("span", "nm"), sal = el("span", "sal");
    pintarAvatar(av, p, false); nm.append(el("b", null, "@" + p.username + (eu ? " (você)" : "")));
    sal.append(seloIcone(22), String(tem(p.id))); row.append(av, nm, sal); return row;
  }));
  const fs = frasesLigadas(slDados.regras);
  $("sl-regras").replaceChildren(...(fs.length ? fs.map((f) => el("li", null, f.texto)) : [el("li", "vazio", g.admin ? "Ainda não há regras. Toque em “Editar regras” para escolher como ganhar Selos." : "O admin ainda não definiu como ganhar Selos.")]));
  $("sl-editar").hidden = !g.admin;
}
$("gi-selos").onclick = () => { if (giGrupo) abrirSelos(giGrupo).catch(() => msgSelos("Não foi possível abrir agora.")); };
$("selos").addEventListener("close", () => { slGrupo = null; slDados = null; });
$("sl-editar").onclick = () => { if (slGrupo?.admin && slDados) abrirRegras(slGrupo); };

// Editor das regras (só admin): cada regra é uma frase; os números são tocáveis e abrem a folha de edição
function pedirNumero({ titulo, contexto, valor, campo, selos }) {
  return new Promise((ok) => {
    const [min, max] = faixa(campo), inp = $("sn-valor"), dlg = $("selos-num"); let atual = valor, fim = false;
    const fecha = (v) => { if (fim) return; fim = true; ok(v); if (dlg.open) dlg.close(); };
    const pinta = () => { $("sn-menos").disabled = atual <= min; $("sn-mais").disabled = atual >= max; };
    $("sn-titulo").textContent = titulo; $("sn-ctx").textContent = contexto; inp.value = String(atual); $("sn-ico").replaceChildren(...(selos ? [seloIcone(30)] : []));
    $("sn-atalhos").replaceChildren(...[1, 5, 10, 50, 100, 999].filter((x) => x >= min && x <= max).map((x) => { const b = el("button", null, String(x)); b.type = "button"; b.onclick = () => { atual = x; inp.value = String(x); pinta(); }; return b; }));
    $("sn-menos").onclick = () => { atual = Math.max(min, atual - 1); inp.value = String(atual); pinta(); };
    $("sn-mais").onclick = () => { atual = Math.min(max, atual + 1); inp.value = String(atual); pinta(); };
    inp.oninput = () => { const v = ajustaCampo(campo, inp.value); if (v !== null) { atual = v; if (String(v) !== inp.value) inp.value = String(v); } pinta(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); fecha(atual); } };
    $("sn-ok").onclick = () => fecha(atual);
    dlg.onclose = () => fecha(null); pinta(); dlg.showModal(); inp.focus(); inp.select();
  });
}
const TITULO_CAMPO = { valor: "Quantos Selos?", min: "Quantas mensagens, no mínimo?", a_cada: "A cada quantas?", dias: "Quantos dias seguidos?" };
async function editarNumero(acao, p) {
  const r = srRascunho, marco = p.marco, ctx = fraseTexto(frase(acao, r, marco));
  const v = await pedirNumero({ titulo: TITULO_CAMPO[p.campo] || "Quanto?", contexto: ctx, valor: p.n, campo: p.campo, selos: p.tipo === "s" }); if (v === null || !srRascunho) return;
  if (acao === "sequencia") {
    const m = r.sequencia.marcos[marco]; if (!m) return;
    if (p.campo === "dias") { if (r.sequencia.marcos.some((x, i) => i !== marco && x.dias === v)) { $("sr-msg").textContent = "Já existe um marco com " + v + " dias."; return; } m.dias = v; r.sequencia.marcos.sort((a, b) => a.dias - b.dias); }
    else m.valor = v;
  } else r[acao][p.campo] = v;
  $("sr-msg").textContent = ""; desenharRegras();
}
function fraseEl(acao, partes) {
  const d = el("div", "sr-frase");
  for (const p of partes) {
    if (typeof p === "string") { d.append(p); continue; }
    const b = el("button", "sr-n " + p.tipo, String(p.n)); b.type = "button"; b.setAttribute("aria-label", "Mudar o número " + p.n); b.onclick = () => editarNumero(acao, p).catch(() => {}); d.append(b);
  }
  return d;
}
function interruptor(on, rotulo, fn) { const b = el("button", "sr-sw" + (on ? " on" : "")); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-label", rotulo); b.onclick = fn; return b; }
function abrirRegras(g) {
  srAntes = limpaRegras(slDados.regras); srRascunho = limpaRegras(slDados.regras); $("sr-msg").textContent = ""; desenharRegras(); $("selos-regras").showModal();
}
function desenharRegras() {
  const r = srRascunho; if (!r) return;
  const cartao = (acao, titulo, desc, corpo) => {
    const c = el("div", "sr-card"), top = el("div", "sr-top"), tx = el("div"); tx.append(el("b", null, titulo), el("small", null, desc));
    top.append(tx, interruptor(r[acao].on, titulo, () => { r[acao].on = !r[acao].on; if (acao === "sequencia" && r[acao].on && !r.sequencia.marcos.length) r.sequencia.marcos.push(marcoNovo([])); desenharRegras(); }));
    c.append(top); if (r[acao].on) for (const x of corpo()) c.append(x); return c;
  };
  $("sr-cards").replaceChildren(...ACOES.map((acao) => cartao(acao, TITULOS[acao][0], TITULOS[acao][1], () => {
    if (acao !== "sequencia") return [fraseEl(acao, frase(acao, r))];
    const linhas = r.sequencia.marcos.map((_, i) => { const l = el("div", "sr-linha"), x = el("button", "sr-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Remover este marco"); x.onclick = () => { r.sequencia.marcos.splice(i, 1); desenharRegras(); }; l.append(fraseEl("sequencia", frase("sequencia", r, i)), x); return l; });
    const novo = marcoNovo(r.sequencia.marcos); if (novo) { const b = el("button", "sr-add", "+ Adicionar marco"); b.type = "button"; b.onclick = () => { r.sequencia.marcos.push(marcoNovo(r.sequencia.marcos)); r.sequencia.marcos.sort((a, b2) => a.dias - b2.dias); desenharRegras(); }; linhas.push(b); }
    return linhas;
  })));
  const teto = el("div", "sr-card"), top = el("div", "sr-top"), tx = el("div"); tx.append(el("b", null, "Limite de Selos por dia"), el("small", null, r.teto.on ? "Por pessoa, somando as regras do dia" : "Sem limite"));
  top.append(tx, interruptor(r.teto.on, "Limite de Selos por dia", () => { r.teto.on = !r.teto.on; desenharRegras(); })); teto.append(top); if (r.teto.on) teto.append(fraseEl("teto", frase("teto", r)));
  $("sr-mais").replaceChildren(teto);
  const p = previa(r, 20); $("sr-previa").replaceChildren(...(p.total ? [seloIcone(18), " ", el("b", null, textoSelos(p.total)), " em um dia comum (20 mensagens enviadas)"] : ["Com estas regras, um dia comum (20 mensagens enviadas) não rende Selos."]));
  $("sr-salvar").disabled = igualRegras(r, srAntes);
}
$("sr-salvar").onclick = async () => {
  const g = slGrupo; if (!g || !srRascunho || $("sr-salvar").disabled) return; $("sr-salvar").disabled = true; $("sr-msg").textContent = "";
  const { error } = await sb.rpc("selo_regras_mudar", { p_grupo: g.id, p_regras: limpaRegras(srRascunho) });
  if (error) { $("sr-msg").textContent = erroRegras(error); $("sr-salvar").disabled = false; return; }
  $("selos-regras").close(); await atualizarGrupos(true).catch(() => {}); avisarMudanca([...g.membros.values()]); await carregarSelos(g).catch(() => {});
};
$("selos-regras").addEventListener("close", () => { srRascunho = null; srAntes = null; });
async function mudarCargo(g, p, sub) {
  msgGrupo("");
  const { error } = await sb.rpc("grupo_cargo", { p_grupo: g.id, p_user: p.id, p_sub: sub });
  if (error) { msgGrupo(erroGrupo(error)); atualizarGrupos(true).catch(() => {}); return; }
  await atualizarGrupos(true); avisarMudanca([...g.membros.values()]);
  msgGrupo(sub ? `@${p.username} agora é sub-admin: pode remover membros.` : `@${p.username} deixou de ser sub-admin.`, true);
}
// ----- foto do grupo (só o admin): recortada no centro, cifrada com a chave do grupo e enviada UMA vez -----
async function trocarFotoGrupo(g, blob) {
  const { data, iv } = await cifrarFoto(g.gk, g.id, new Uint8Array(await blob.arrayBuffer()));
  const path = `${me.id}/${g.id}/${crypto.randomUUID()}`, velho = g.foto?.p;
  const up = await sb.storage.from("media").upload(path, new Blob([data], { type: "application/octet-stream" }), { contentType: "application/octet-stream" }); if (up.error) throw up.error;
  const { error } = await sb.rpc("grupo_foto", { p_grupo: g.id, p_foto: { p: path, iv } });
  if (error) { sb.storage.from("media").remove([path]).catch(() => {}); throw error; }
  if (velho?.startsWith(me.id + "/")) sb.storage.from("media").remove([velho]).catch(() => {}); // (a foto antiga sai do servidor, se fui eu que a enviei)
}
$("gi-foto-btn").onclick = () => $("gi-file").click();
$("gi-file").onchange = async () => {
  const f = $("gi-file").files[0]; $("gi-file").value = ""; const g = giGrupo && grupos.get(giGrupo.id); if (!f || !g?.gk || !g.admin) return;
  if (!TIPOS_ENTRADA.test(f.type)) return msgGrupo("Escolha uma imagem (JPG, PNG ou WebP).");
  if (f.size > 20 * 1048576) return msgGrupo("Essa foto é grande demais (máximo 20 MB).");
  msgGrupo("Enviando a foto…", true);
  try {
    const bmp = await createImageBitmap(f), cv = el("canvas"); cv.width = cv.height = LADO; desenhar(cv.getContext("2d"), bmp, bmp.width, bmp.height, 1, 0.5, 0.5, LADO);
    const blob = await codificar(cv); if (!blob) throw new Error("grande");
    await trocarFotoGrupo(g, blob); await atualizarGrupos(true); avisarMudanca([...g.membros.values()]); msgGrupo("Foto do grupo atualizada ✓", true);
  } catch (e) { msgGrupo(limitado(e) ? "Muitas tentativas seguidas. Espere um minuto." : /so_admin/.test(e?.message || "") ? erroGrupo(e) : "Não foi possível trocar a foto. Tente de novo."); }
};
$("gi-foto-rm").onclick = async () => {
  const g = giGrupo && grupos.get(giGrupo.id); if (!g?.admin || !g.foto) return;
  const velho = g.foto.p, { error } = await sb.rpc("grupo_foto", { p_grupo: g.id, p_foto: null });
  if (error) return msgGrupo(erroGrupo(error));
  if (velho.startsWith(me.id + "/")) sb.storage.from("media").remove([velho]).catch(() => {});
  await atualizarGrupos(true); avisarMudanca([...g.membros.values()]); msgGrupo("Foto removida.", true);
};
$("grupo-btn").onclick = () => { if (active?.grupo) abrirInfoGrupo(active); };
// ----- minha cor neste grupo: folha com cores prontas (as de outras pessoas aparecem com a FOTO de quem usa) e, se todas estão em uso, a cor aleatória -----
let cfGrupo = null, cfSel = null;
const coresDeOutros = (g) => { const m = new Map(); for (const p of g.membros.values()) if (p.cor && p.id !== me.id) m.set(p.cor, p); return m; };
function abrirCor(g) { cfGrupo = g; cfSel = g.membros.get(me.id)?.cor ?? null; $("cf-msg").textContent = ""; desenharCor(); $("cor-folha").showModal(); }
function desenharCor() {
  const g = cfGrupo && grupos.get(cfGrupo.id); if (!g) { if ($("cor-folha").open) $("cor-folha").close(); return; }
  const outros = coresDeOutros(g), meu = g.membros.get(me.id)?.cor ?? null, naoTemLivre = primeiraLivre([...outros.keys(), ...(meu ? [meu] : [])]) === null;
  if (cfSel && outros.has(cfSel)) cfSel = meu; // a cor que eu ia pegar acabou de ser escolhida por outra pessoa
  $("cf-grade").replaceChildren(...PALETA.map((c) => {
    const b = el("button", "cf-sw"), dono = outros.get(c.id), st = estilosDaCor(c.id); b.type = "button"; b.style.setProperty("--c", st.claro.forte); b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(cfSel === c.id));
    if (cfSel === c.id) b.classList.add("sel");
    if (dono) { b.disabled = true; b.classList.add("ocup"); const av = el("span", "avatar mini"); pintarAvatar(av, dono); b.append(av); b.title = `${c.nome}: usada por @${dono.username}`; b.setAttribute("aria-label", `${c.nome}, usada por @${dono.username}`); }
    else { b.title = c.nome; b.setAttribute("aria-label", c.nome); b.onclick = () => { cfSel = c.id; $("cf-msg").textContent = ""; desenharCor(); }; }
    return b;
  }));
  if (cfSel && cfSel[0] === "#") { const b = el("button", "cf-sw alea sel"), st = estilosDaCor(cfSel); b.type = "button"; b.style.setProperty("--c", st.claro.forte); b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "true"); b.setAttribute("aria-label", "Cor aleatória escolhida"); b.title = "Cor aleatória"; $("cf-grade").append(b); }
  $("cf-cheio").hidden = !naoTemLivre; $("cf-alea").hidden = !naoTemLivre; $("cf-dica").hidden = naoTemLivre || !outros.size;
  const st = estilosDaCor(cfSel); pintarAvatar($("cf-ava"), me); $("cf-ava").style.setProperty("--c", st?.claro.forte || "var(--ink-2)"); $("cf-bub-n").textContent = "@" + me.username;
  for (const [v, k] of [["--mc-bg", "bg"], ["--mc-bd", "bd"], ["--mc-n", "nome"]]) { $("cf-bub").style.setProperty(v, st?.claro[k] || (k === "bg" ? "var(--card)" : k === "bd" ? "var(--line)" : "var(--ink-2)")); $("cf-bub").style.setProperty(v + "-e", st?.escuro[k] || (k === "bg" ? "var(--card)" : k === "bd" ? "var(--line)" : "var(--mut)")); }
  $("cf-salvar").disabled = !cfSel || cfSel === meu;
}
$("gi-cor").onclick = () => { const g = giGrupo && grupos.get(giGrupo.id); if (g) abrirCor(g); };
$("cf-alea").onclick = () => { const g = cfGrupo && grupos.get(cfGrupo.id); if (!g) return; cfSel = corMaisDiferente([...coresDeOutros(g).keys()]); $("cf-msg").textContent = ""; desenharCor(); }; // a mais diferente de todas as que os outros usam
$("cf-cancelar").onclick = () => $("cor-folha").close();
$("cf-salvar").onclick = async () => {
  const g = cfGrupo && grupos.get(cfGrupo.id); if (!g || !cfSel) return; const b = $("cf-salvar"); b.disabled = true;
  const { error } = await sb.rpc("grupo_cor", { p_grupo: g.id, p_cor: cfSel });
  if (error) { $("cf-msg").className = "pg-msg"; $("cf-msg").textContent = erroGrupo(error); await atualizarGrupos(true).catch(() => {}); return desenharCor(); }
  $("cor-folha").close(); await atualizarGrupos(true); avisarMudanca([...g.membros.values()]); msgGrupo("Cor atualizada ✓", true);
};
$("gi-add").onclick = () => { const g = giGrupo && grupos.get(giGrupo.id); if (g) abrirSeletor({ tipo: "add", g }); };
$("gi-renomear").onclick = async () => {
  const g = giGrupo && grupos.get(giGrupo.id); if (!g?.gk) return;
  let dica = `Até ${MAX_NOME} caracteres. Só quem está no grupo vê o nome: ele fica cifrado no servidor.`, novo;
  for (;;) { const v = await ask("Nome do grupo", dica, { texto: true, valor: g.nome, max: MAX_NOME }); if (v === null) return; novo = limpaNome(v); if (novo) break; dica = `Digite um nome de 1 a ${MAX_NOME} caracteres.`; }
  if (novo === g.nome) return;
  const { error } = await sb.rpc("grupo_renomear", { p_grupo: g.id, p_nome: await cifrarNome(g.gk, g.id, novo) });
  if (error) return msgGrupo(erroGrupo(error));
  await atualizarGrupos(true); avisarMudanca([...g.membros.values()]);
};
$("gi-sair").onclick = async () => {
  const g = giGrupo && grupos.get(giGrupo.id); if (!g) return;
  const unico = g.membros.size === 1, soEuAdmin = g.admin && [...g.membros.values()].filter((p) => p.admin).length === 1;
  const r = await choose("Sair do grupo?", `Você deixa de receber as mensagens de “${g.nome}”.` + (unico ? " Você é a última pessoa: o grupo será apagado." : soEuAdmin ? " Você é admin: quem está há mais tempo no grupo assume." : ""), [
    { label: "Sair do grupo", value: "sim", cls: "primary" }, { label: "Cancelar", value: "", cls: "ghost" }]);
  if (r !== "sim") return;
  const outros = [...g.membros.values()];
  const { error } = await sb.rpc("grupo_remover", { p_grupo: g.id, p_user: me.id });
  if (error) return msgGrupo(erroGrupo(error));
  g.saindo = true; if ($("grupo-info").open) $("grupo-info").close();
  avisarMudanca(outros); await atualizarGrupos(true);
};
// ----- escolher pessoas: para um grupo novo, ou para entrar num grupo que já existe -----
let gnModo = null; // { tipo: "novo" } | { tipo: "add", g }
const marcados = () => [...$("gn-lista").querySelectorAll(".marca:checked")].map((c) => contacts.get(c.value)).filter(Boolean);
function estadoSeletor() {
  const n = marcados().length, add = gnModo?.tipo === "add", vagas = add ? MAX_MEMBROS - gnModo.g.membros.size : MAX_MEMBROS - 1, demais = n > vagas;
  $("gn-criar").disabled = n < 1 || demais || (!add && !limpaNome($("gn-nome").value));
  $("gn-quem").textContent = (add ? "Quem entra" : "Quem participa") + (n ? ` · ${n} ${n === 1 ? "pessoa escolhida" : "pessoas escolhidas"}` : "");
  const m = $("gn-msg"); if (demais) { m.className = "pg-msg"; m.textContent = `Um grupo tem no máximo ${MAX_MEMBROS} pessoas.`; } else if (/no máximo/.test(m.textContent)) m.textContent = "";
}
function abrirSeletor(modo) {
  gnModo = modo; const add = modo.tipo === "add";
  $("gn-titulo").textContent = add ? "Adicionar pessoas" : "Novo grupo"; $("gn-nome-box").hidden = add; $("gn-nome").value = ""; $("gn-msg").textContent = "";
  $("gn-criar").textContent = add ? "Adicionar ao grupo" : "Criar grupo";
  const cand = [...contacts.values()].filter((p) => !add || !modo.g.membros.has(p.id)).sort((a, b) => a.username.localeCompare(b.username));
  $("gn-vazio").hidden = cand.length > 0; $("gn-quem").hidden = !cand.length; $("gn-criar").hidden = !cand.length;
  $("gn-vazio").textContent = add ? "Todas as pessoas com quem você conversa já estão neste grupo." : "Você ainda não conversa com ninguém. Chame um amigo primeiro; depois dá para montar um grupo com ele.";
  $("gn-lista").replaceChildren(...cand.map((p) => {
    const row = el("label", "linha pessoa"), av = el("span", "avatar"), tx = el("span", "tx"), cb = el("input", "marca");
    cb.type = "checkbox"; cb.value = p.id; cb.setAttribute("aria-label", "@" + p.username); cb.onchange = estadoSeletor;
    pintarAvatar(av, p); tx.append(el("b", null, "@" + p.username)); row.append(av, tx, cb); return row;
  }));
  estadoSeletor(); $("grupo-novo").showModal(); if (!add && cand.length) $("gn-nome").focus();
}
$("gn-nome").oninput = estadoSeletor;
$("gn-nome").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!$("gn-criar").disabled) $("gn-criar").click(); } }); // (Enter não pode fechar a página)
$("gn-criar").onclick = async () => {
  const b = $("gn-criar"), pessoas = marcados(), modo = gnModo, m = $("gn-msg"); if (!pessoas.length || !modo) return;
  b.disabled = true; m.className = "pg-msg ok"; m.textContent = modo.tipo === "add" ? "Adicionando…" : "Criando o grupo…";
  try {
    if (modo.tipo === "add") { await adicionarAoGrupo(modo.g, pessoas); $("grupo-novo").close(); }
    else { const g = await criarGrupo(limpaNome($("gn-nome").value), pessoas); $("grupo-novo").close(); if (g) open(g); }
  } catch (e) { m.className = "pg-msg"; m.textContent = erroGrupo(e); estadoSeletor(); }
};
$("novo-grupo").onclick = () => { $("chamar").close(); abrirSeletor({ tipo: "novo" }); };

// ---------- Notificações (push) ----------
// O aviso é um toque sem texto: o servidor não vê nome nem conteúdo, e o navegador mostra "Você tem uma nova mensagem". Nada aparece com o Lacre aberto na tela.
{ const v = new URL(import.meta.url).searchParams.get("v"); const vs = document.getElementById("versao-site"); if (vs) vs.textContent = v ? "Versão do site: " + v : ""; } // (para saber qual versão está rodando, já que o navegador pode guardar a página por alguns minutos)
const FN_URL = SUPABASE_URL + "/functions/v1/notificar", FN_APARELHO = SUPABASE_URL + "/functions/v1/aparelho";
const suportaPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64uBytes = (t) => Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(t.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const bytesB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const flagNotif = () => "lacre:notif:" + me?.id;
let swReg = null;
async function registrarSW() { if (!("serviceWorker" in navigator)) return null; try { swReg ||= await navigator.serviceWorker.register("./sw.js"); await navigator.serviceWorker.ready; return swReg; } catch { return null; } }
async function inscricaoAtual() { const reg = await registrarSW(); return reg ? reg.pushManager.getSubscription() : null; }
async function salvarInscricao(sub) {
  const j = sub.toJSON(), { error } = await sb.rpc("registrar_push", { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth });
  if (error) throw error;
}
const notifLigado = () => { try { return localStorage.getItem(flagNotif()) === "1" && suportaPush() && Notification.permission === "granted"; } catch { return false; } };
function desenharSino() {
  const on = notifLigado(), b = $("notif-btn"); b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", on ? "Notificações: ligadas. Tocar para desligar" : "Notificações: desligadas. Tocar para ligar");
  $("notif-estado").textContent = on ? "ligadas" : "desligadas";
}
async function ligarNotificacoes() {
  if (!suportaPush()) {
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return note(iphone ? "No iPhone, as notificações só funcionam com o Lacre instalado na tela inicial: toque em Compartilhar e depois em “Adicionar à Tela de Início”, abra o Lacre por lá e ligue o sino de novo." : "Este navegador não tem notificações. Use o Chrome, o Edge ou o Firefox atualizado.");
  }
  if ((await Notification.requestPermission()) !== "granted") return note("As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone do cadeado ao lado do endereço) e toque no sino de novo.");
  const reg = await registrarSW(); if (!reg) throw new Error("sem service worker");
  const { chave } = await (await fetch(FN_URL)).json();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey && bytesB64u(sub.options.applicationServerKey) !== chave) { await sub.unsubscribe(); sub = null; } // a chave do servidor mudou
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(chave) });
  await salvarInscricao(sub); try { localStorage.setItem(flagNotif(), "1"); } catch {}
}
async function desligarNotificacoes() {
  const sub = await inscricaoAtual();
  if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe().catch(() => {}); }
  try { localStorage.removeItem(flagNotif()); } catch {}
}
async function removerRegistroPush() { try { const sub = await inscricaoAtual(); if (sub) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); } catch {} }
$("notif-btn").onclick = async () => {
  const b = $("notif-btn"); b.disabled = true;
  try { if (notifLigado()) await desligarNotificacoes(); else await ligarNotificacoes(); }
  catch { note("Não consegui mudar as notificações agora. Tente de novo em instantes."); }
  finally { b.disabled = false; desenharSino(); }
};
async function sincronizarNotificacoes() { // ao entrar: se estava ligado neste aparelho, garante que ele está registrado para ESTA conta
  registrarSW(); desenharSino();
  try {
    if (!suportaPush() || localStorage.getItem(flagNotif()) !== "1") return;
    if (Notification.permission !== "granted") { localStorage.removeItem(flagNotif()); return desenharSino(); }
    const sub = await inscricaoAtual(); if (sub) await salvarInscricao(sub); else await ligarNotificacoes();
  } catch {}
  desenharSino();
}

// ---------- Anexos: limpa os metadados ANTES de qualquer coisa sair do aparelho ----------
const MAX_VIDEO_ENTRADA = 300 * 1048576, MAX_VIDEO = 45 * 1048576, MAX_AUDIO = 20 * 1048576, MAX_GRAVACAO = 300; // 300 s = 5 min
let pending = null; // anexo pronto (ou {busy:true} enquanto limpa)
let gravador = null; // gravação de áudio em andamento
const niceErr = (e, fallback) => (/^(Não|Vídeo|Áudio|Formato)/.test(e?.message || "") ? e.message : fallback);
function showPending(name, info, ok = false) {
  $("pending").hidden = false; $("pending-name").textContent = name;
  const i = $("pending-info"); i.textContent = info; i.className = ok ? "ok" : "";
  atualizaBotao();
}
function clearPending(keepUrl) {
  if (gravador) cancelarGravacao(); // descartar o anexo também descarta uma gravação em andamento
  if (pending?.url && !keepUrl) URL.revokeObjectURL(pending.url);
  if (tocando) { tocando.pause(); tocando = null; }
  pending = null; atualizaBotao(); $("pending").hidden = true; $("pending-thumb").replaceChildren(); $("pending-thumb").classList.remove("gravando");
  $("pending-extra").replaceChildren();
}
// Campo de mensagem: <div contenteditable> (sem a barra de senhas/cartões/endereços do teclado do Android). Enter envia; sem quebra de linha.
const MAX_TEXTO = 4000;
const lerTexto = () => $("text").textContent.replace(/\u00a0/g, " ").replace(/\n/g, " ");
const limparTexto = () => { $("text").replaceChildren(); atualizaBotao(); };
{
  const t = $("text");
  if (t.contentEditable !== "plaintext-only") { // Firefox antigo: editável comum, colando só texto puro
    t.contentEditable = "true"; t.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\r?\n/g, " ")); });
  }
  t.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") { e.preventDefault(); $("send-form").requestSubmit(); return; } // Enter / "Ir" do teclado envia
    if (e.inputType.startsWith("insert") && e.data && t.textContent.length + e.data.length > MAX_TEXTO) e.preventDefault();
  });
  t.addEventListener("input", () => {
    if (t.textContent === "" || t.textContent === "\n") t.replaceChildren(); // deixa o :empty (texto de exemplo) funcionar
    if (t.textContent.length > MAX_TEXTO) { t.textContent = t.textContent.slice(0, MAX_TEXTO); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  });
  t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); $("send-form").requestSubmit(); } });
  // tocar em Enviar não pode tirar o foco do campo: foco perdido = teclado do celular some e volta
  const enviar = $("send-form").querySelector(".primary");
  for (const ev of ["pointerdown", "mousedown"]) enviar.addEventListener(ev, (e) => e.preventDefault());
}
$("pending-x").onclick = () => clearPending();
// ----- citar alguém do grupo: ao digitar "@" aparece a lista de participantes; vai filtrando conforme se digita -----
let mencSel = 0, mencItens = [];
function tokenAtual() { // o "@..." logo antes do cursor, dentro do campo de mensagem
  const sel = getSelection(); if (!sel?.isCollapsed || sel.anchorNode?.nodeType !== 3 || !$("text").contains(sel.anchorNode)) return null;
  const tk = tokenMencao(sel.anchorNode.data.slice(0, sel.anchorOffset)); return tk && { ...tk, no: sel.anchorNode, fim: sel.anchorOffset };
}
function fecharMencoes() { $("mencoes").hidden = true; mencItens = []; $("text").removeAttribute("aria-activedescendant"); }
function inserirMencao(nome) {
  const tk = tokenAtual(); if (!tk) return fecharMencoes();
  const r = document.createRange(); r.setStart(tk.no, tk.inicio); r.setEnd(tk.no, tk.fim); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.execCommand("insertText", false, "@" + nome + " "); fecharMencoes(); $("text").focus();
}
function desenharMencoes() {
  const caixa = $("mencoes");
  caixa.replaceChildren(...mencItens.map((p, i) => {
    const b = el("button", "opcao" + (i === mencSel ? " sel" : "")), av = el("span", "avatar peq"); b.type = "button"; b.id = "menc-" + i; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(i === mencSel)); b.tabIndex = -1;
    pintarAvatar(av, p); b.append(av, el("b", null, "@" + p.username));
    for (const ev of ["pointerdown", "mousedown"]) b.addEventListener(ev, (e) => e.preventDefault()); // não tira o foco do campo (o teclado do celular não some)
    b.onclick = () => inserirMencao(p.username); return b;
  }));
  $("text").setAttribute("aria-activedescendant", "menc-" + mencSel);
}
function atualizarMencoes() {
  const g = active?.grupo ? active : null, tk = g && tokenAtual();
  if (!tk) return fecharMencoes();
  const itens = sugerirMembros([...g.membros.values()], tk.prefixo, me.id); if (!itens.length) return fecharMencoes();
  if (itens.map((p) => p.id).join() !== mencItens.map((p) => p.id).join()) mencSel = 0;
  mencItens = itens; desenharMencoes();
  const caixa = $("mencoes"); caixa.hidden = false; caixa.style.setProperty("--base", Math.max(0, innerHeight - $("send-form").getBoundingClientRect().top + 6) + "px"); // fica logo acima da barra de mensagem
}
{
  const t = $("text");
  t.addEventListener("input", atualizarMencoes); t.addEventListener("click", atualizarMencoes); t.addEventListener("blur", () => setTimeout(fecharMencoes, 120));
  t.addEventListener("keydown", (e) => { // (em fase de captura, antes do Enter que envia a mensagem)
    if ($("mencoes").hidden || !mencItens.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); mencSel = (mencSel + (e.key === "ArrowDown" ? 1 : -1) + mencItens.length) % mencItens.length; desenharMencoes(); }
    else if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); inserirMencao(mencItens[mencSel].username); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fecharMencoes(); }
  }, true);
  t.addEventListener("beforeinput", (e) => { if (!$("mencoes").hidden && (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak")) e.stopImmediatePropagation(); }, true);
}
// Bandeja do "+" (foto/vídeo e figurinha) e botão que alterna entre microfone e enviar
const bandeja = (abrir) => { $("tray").classList.toggle("on", abrir); $("mais").setAttribute("aria-expanded", String(abrir)); for (const b of $("tray").querySelectorAll("button")) b.tabIndex = abrir ? 0 : -1; };
$("mais").onclick = () => bandeja(!$("tray").classList.contains("on"));
$("attach").onclick = () => { bandeja(false); $("file").click(); };
document.addEventListener("click", (e) => { if ($("tray").classList.contains("on") && !e.target.closest("#tray, #mais")) bandeja(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("tray").classList.contains("on")) { bandeja(false); $("mais").focus(); } });
// campo vazio e nada anexado = microfone; texto ou anexo pronto = enviar (durante a gravação continua o microfone, que para a gravação)
function atualizaBotao() { $("acao").dataset.modo = lerTexto().trim() !== "" || pending || gravador?.travado ? "send" : "mic"; }
$("text").addEventListener("input", atualizaBotao);
$("file").onchange = async () => { const f = $("file").files[0]; $("file").value = ""; if (f) await prepare(f); };

async function prepare(f) {
  clearPending(); const token = (pending = { busy: true });
  showPending(f.name, "Removendo metadados…");
  try {
    let r;
    if (f.type.startsWith("image/")) {
      const c = await cleanImage(f); r = { kind: "image", bytes: c.bytes, mime: c.mime, w: c.w, h: c.h };
    } else if (/^audio\//.test(f.type) || /\.(mp3|m4a|wav)$/i.test(f.name)) {
      if (f.size > MAX_AUDIO) throw new Error("Áudio grande demais. O limite é de 20 MB.");
      const c = cleanAudio(await f.arrayBuffer()); r = { kind: "audio", bytes: c.bytes, mime: c.mime };
    } else if (/\.(mp4|m4v|mov)$/i.test(f.name) || /^video\/(mp4|quicktime)$/.test(f.type)) {
      const mov = f.type === "video/quicktime" || /\.mov$/i.test(f.name);
      let comp = null;
      if (suportaCompressao()) { // comprime no aparelho (720p, ~2 Mbps) antes de cifrar; se der qualquer problema, segue com o original
        if (f.size > MAX_VIDEO_ENTRADA) throw new Error("Vídeo grande demais. O limite é de 300 MB.");
        showPending(f.name, "Comprimindo vídeo… 0%");
        try { comp = await comprimirVideo(f, { cancelado: () => pending !== token, onProgresso: (p) => { if (pending === token) showPending(f.name, `Comprimindo vídeo… ${Math.round(p * 100)}%`); } }); }
        catch (e) { if (e?.cancelado) return; comp = null; }
        if (pending !== token) return;
      }
      if (comp) {
        if (comp.bytes.length > MAX_VIDEO) throw new Error("Vídeo longo demais: mesmo comprimido passa de 45 MB. Envie um trecho menor.");
        r = { kind: "video", bytes: comp.bytes, mime: "video/mp4", original: f.size };
      } else {
        if (f.size > MAX_VIDEO) throw new Error("Vídeo grande demais. O limite é de 45 MB.");
        r = { kind: "video", bytes: cleanVideo(await f.arrayBuffer()), mime: mov ? "video/quicktime" : "video/mp4" };
      }
    } else throw new Error("Formato não suportado. Envie foto (JPG, PNG, WebP) ou vídeo MP4/MOV.");
    if (pending !== token) return; // removido enquanto limpava
    r.url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime })); pending = r;
    if (r.kind === "audio") {
      r.dur = await duracaoAudio(r.url);
      $("pending-thumb").replaceChildren(iconeMic()); $("pending-extra").replaceChildren(playerAudio(r.url, r.dur));
    } else {
      const t = r.kind === "image" ? el("img") : el("video"); t.src = r.url; if (r.kind === "video") { t.muted = true; t.preload = "metadata"; }
      $("pending-thumb").replaceChildren(t);
    }
    showPending(f.name, `${r.kind === "audio" && r.dur ? mmss(r.dur) + " · " : ""}${sizeLabel(r.bytes.length)}${r.original ? ` · comprimido de ${sizeLabel(r.original)}` : ""} · metadados removidos` + (f.type === "image/gif" ? " · GIF vira imagem parada" : ""), true);
  } catch (e) {
    if (pending === token) clearPending();
    note(niceErr(e, "Não foi possível preparar este arquivo."));
  }
}

// ---------- Gravar áudio (microfone) ----------
function iconeMic() {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  for (const d of ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M19 11a7 7 0 0 1-14 0M12 18v3"]) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.append(p); }
  return svg;
}
function duracaoAudio(url) { // lê a duração do arquivo; 0 se o formato não informar
  return new Promise((res) => { const a = new Audio(); const fim = (n) => { clearTimeout(t); res(Number.isFinite(n) && n > 0 && n < 36000 ? Math.round(n) : 0); };
    const t = setTimeout(() => fim(0), 4000); a.preload = "metadata"; a.onloadedmetadata = () => fim(a.duration); a.onerror = () => fim(0); a.src = url; });
}
// AAC em MP4 toca em todo lugar (inclusive iPhone); WebM/Opus é a alternativa para Chrome e Firefox
const tipoGravacao = () => ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? "";
let pedindoMic = false; // evita duas gravações se tocarem duas vezes enquanto o navegador pergunta pela permissão
const LIMITE_TOQUE = 250, LIM_TRAVAR = 70, LIM_CANCELAR = 100; // ms: abaixo disso é toque sem querer (nem dá tempo de falar); px de arrasto para travar / cancelar
let preparando = false, travarAoIniciar = false; // preparando = dedo já no botão, esperando o navegador abrir o microfone (a tela já reage)
let hold = null; // gesto em andamento: { id, x0, y0, soltou, cancelando }
const vibra = (n = 12) => { try { navigator.vibrate?.(n); } catch {} };
// Atualiza a barra de gravação, o microfone e o cadeado conforme o estado: sem gravação / segurando / travado
function uiGravacao() {
  const g = gravador, f = $("send-form"), ativo = !!g || preparando;
  if (g) f.dataset.rec = g.travado ? "travado" : "segurando"; else if (preparando) f.dataset.rec = "segurando"; else delete f.dataset.rec;
  $("rec-bar").hidden = !ativo; $("lock-pill").hidden = !ativo || !!g?.travado;
  $("mic").classList.toggle("rec", ativo); $("mic").setAttribute("aria-label", ativo ? "Parar gravação e enviar" : "Gravar áudio: segure o botão");
  if (ativo) { $("rec-dica-txt").textContent = hold?.cancelando ? "Solte para cancelar" : "Deslize para cancelar"; $("rec-tempo").textContent = mmss(g ? (Date.now() - g.t0) / 1000 : 0); }
  atualizaBotao();
}
let toastT = 0;
function dicaGravar(t) { const e = $("rec-toast"); e.textContent = t; e.hidden = false; e.classList.remove("some"); clearTimeout(toastT); toastT = setTimeout(() => { e.classList.add("some"); toastT = setTimeout(() => (e.hidden = true), 300); }, 2200); }
function encerrar(g) { // solta o microfone e para os relógios (pode ser chamada mais de uma vez)
  clearInterval(g.timer); clearInterval(g.ondaT); g.stream.getTracks().forEach((t) => t.stop()); if (g.ac) { g.ac.close().catch(() => {}); g.ac = null; }
  if (gravador === g) { gravador = null; uiGravacao(); }
}
function iniciarOnda(g) { // ondas de voz ao vivo (só aparecem com a gravação travada)
  const box = $("rec-onda"); box.replaceChildren(...Array.from({ length: 26 }, () => el("i")));
  try {
    const ac = (g.ac = new (window.AudioContext || window.webkitAudioContext)()), an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(g.stream).connect(an);
    const buf = new Uint8Array(an.fftSize), niveis = Array(26).fill(0.08);
    g.ondaT = setInterval(() => {
      an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2; niveis.push(Math.min(1, Math.sqrt(s / buf.length) / 40) * 0.92 + 0.08); niveis.shift();
      box.childNodes.forEach((b, i) => (b.style.height = Math.round(niveis[i] * 100) + "%"));
    }, 80);
  } catch { box.replaceChildren(); }
}
async function iniciarGravacao({ travado = false } = {}) {
  if (pedindoMic || gravador) return false;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { note("Este navegador não grava áudio. Use o Chrome ou o Safari atualizado, ou anexe um arquivo de áudio."); return false; }
  clearPending(); pedindoMic = true;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { note("Não consegui usar o microfone. Permita o acesso ao microfone nas configurações do navegador e tente de novo."); return false; }
  finally { pedindoMic = false; }
  const tipo = tipoGravacao(), rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
  const g = (gravador = { rec, stream, chunks: [], t0: Date.now(), cancelado: false, travado, enviar: false, timer: 0, ondaT: 0, ac: null });
  rec.ondataavailable = (e) => { if (e.data?.size) g.chunks.push(e.data); };
  rec.onstop = () => finalizarGravacao(g);
  rec.start(1000); preparando = false; uiGravacao(); vibra(); iniciarOnda(g);
  g.timer = setInterval(() => { const s = (Date.now() - g.t0) / 1000; $("rec-tempo").textContent = mmss(s); if (s >= MAX_GRAVACAO) pararGravacao(true); }, 250);
  return true;
}
function pararGravacao(enviar = false) { if (gravador?.rec.state === "recording") { gravador.enviar = enviar; gravador.rec.stop(); } }
function cancelarGravacao() { const g = gravador; if (!g) return; g.cancelado = true; encerrar(g); try { g.rec.stop(); } catch {} }
async function finalizarGravacao(g) {
  encerrar(g);
  if (g.cancelado) return;
  const ms = Date.now() - g.t0, dur = Math.max(1, Math.round(ms / 1000)); // áudio de menos de 1 s aparece como 0:01
  if (!g.chunks.length || ms < 300) return note("A gravação ficou curta demais. Segure o botão enquanto fala.");
  try {
    const r = cleanAudio(await new Blob(g.chunks).arrayBuffer(), { gravado: true }); // metadados removidos antes de qualquer envio
    r.url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime })); r.kind = "audio"; r.dur = dur; pending = r;
    showPending("Áudio gravado", `${mmss(dur)} · ${sizeLabel(r.bytes.length)} · metadados removidos`, true);
    if (g.enviar) $("send-form").requestSubmit(); // soltou o botão (ou tocou em enviar): manda na hora
  } catch (e) { clearPending(); note(niceErr(e, "Não foi possível preparar a gravação.")); }
}
// ----- gesto: segurar = gravar, soltar = enviar, arrastar para cima = travar, arrastar para o lado = cancelar -----
function moverGesto(e) {
  if (!hold || e.pointerId !== hold.id || (!gravador && !preparando) || gravador?.travado) return;
  const dx = Math.max(0, hold.x0 - e.clientX), dy = Math.max(0, hold.y0 - e.clientY), vertical = dy > dx, f = $("send-form");
  f.style.setProperty("--dx", "0px"); // o microfone só acompanha o dedo para cima (para o lado ele não desliza: não cobre o texto) f.style.setProperty("--dy", vertical ? -Math.min(dy, 110) + "px" : "0px");
  f.style.setProperty("--pt", String(vertical ? Math.min(1, dy / LIM_TRAVAR) : 0)); f.style.setProperty("--pc", String(vertical ? 0 : Math.min(1, dx / LIM_CANCELAR)));
  const cancelando = !vertical && dx >= LIM_CANCELAR;
  if (cancelando !== hold.cancelando) { hold.cancelando = cancelando; f.classList.toggle("cancelando", cancelando); $("rec-dica-txt").textContent = cancelando ? "Solte para cancelar" : "Deslize para cancelar"; if (cancelando) vibra(8); }
  if (vertical && dy >= LIM_TRAVAR) { if (gravador) gravador.travado = true; else travarAoIniciar = true; desfazGesto(); uiGravacao(); vibra(20); }
}
function desfazGesto() {
  removeEventListener("pointermove", moverGesto); removeEventListener("pointerup", fimGesto); removeEventListener("pointercancel", fimGesto);
  const f = $("send-form"); f.classList.remove("cancelando"); for (const v of ["--dx", "--dy", "--pt", "--pc"]) f.style.removeProperty(v);
  hold = null;
}
function soltar() {
  const g = gravador, cancelando = hold?.cancelando; desfazGesto();
  if (!g || g.travado) return;
  if (cancelando) return cancelarGravacao();
  if (Date.now() - g.t0 < LIMITE_TOQUE) { cancelarGravacao(); return dicaGravar("Segure o botão para gravar e solte para enviar."); }
  pararGravacao(true);
}
function fimGesto(e) {
  if (!hold || e.pointerId !== hold.id) return;
  if (e.type === "pointercancel") hold.cancelando = true; // o sistema tomou o toque: descarta
  hold.soltou = true; if (gravador) soltar();
}
const mic = $("mic");
mic.addEventListener("pointerdown", async (e) => {
  if (gravador || pedindoMic || preparando || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  hold = { id: e.pointerId, x0: e.clientX, y0: e.clientY, soltou: false, cancelando: false, t: Date.now() };
  addEventListener("pointermove", moverGesto); addEventListener("pointerup", fimGesto); addEventListener("pointercancel", fimGesto);
  preparando = true; travarAoIniciar = false; uiGravacao(); // a tela já reage ao toque; o microfone abre em seguida
  const ok = await iniciarGravacao();
  preparando = false;
  if (!ok) { desfazGesto(); uiGravacao(); return; }
  if (travarAoIniciar) { travarAoIniciar = false; gravador.travado = true; uiGravacao(); }
  if (hold?.soltou) { const demorou = Date.now() - hold.t > 900; soltar(); if (demorou) dicaGravar("Microfone liberado. Agora segure o botão para gravar e solte para enviar."); } // o dedo já saiu enquanto o navegador pedia o microfone
});
mic.addEventListener("click", (e) => { if (e.detail !== 0) return; gravador ? pararGravacao(true) : iniciarGravacao({ travado: true }); }); // teclado/leitor de tela: liga e desliga (grava travado)
mic.addEventListener("contextmenu", (e) => e.preventDefault());
$("rec-lixo").onclick = () => cancelarGravacao();

// ---------- Figurinhas ----------
let figs = null;
const figurinhas = () => (figs && figs.uid === me.id ? figs : (figs = montarFigurinhas({ $, el, uid: me.id, note, choose, enviar: enviarFigurinha })));
const subidas = new Map(); // figurinha+amigo -> arquivo já enviado (reaproveita; economiza o limite de uploads por hora)
async function enviarFigurinha(st) {
  const peer = active; if (!peer) throw new Error("Abra uma conversa primeiro.");
  try {
    const k = st.id + "|" + peer.id; let up = subidas.get(k);
    if (!up) { const path = `${me.id}/${peer.id}/${crypto.randomUUID()}`, sealed = await uploadSealed(st.bytes, path); up = { path, key: sealed.key, iv: sealed.iv }; subidas.set(k, up); }
    const content = { v: 1, type: "media", kind: "sticker", ...up, mime: st.mime, w: st.w, h: st.h, size: st.bytes.length, anim: !!st.anim };
    if (replyTo) content.re = replyTo;
    const row = await enviar(peer, content);
    if (!mediaCache.has(up.path)) mediaCache.set(up.path, URL.createObjectURL(new Blob([st.bytes], { type: st.mime })));
    if (active === peer) { $("msgs-empty")?.remove(); addMessage(row, content, { descer: true }); }
    cancelarResposta();
  } catch (e) { throw new Error(sendError(e, peer)); }
}
$("sticker").onclick = () => { bandeja(false); if (active) figurinhas().abrir(); };

async function uploadSealed(bytes, path) {
  const sealed = await sealBytes(bytes);
  const { error } = await sb.storage.from("media").upload(path, new Blob([sealed.data], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
  if (error) throw error;
  putBlob(me.id, path, sealed.data).catch(() => {}); // quem enviou também não precisa baixar de novo
  return sealed;
}

$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  if (gravador) { if (gravador.travado) pararGravacao(true); return; } // gravação travada: enviar = parar e mandar
  const text = lerTexto().trim(), peer = active;
  if (!peer || (!text && !pending)) return;
  if (pending?.busy) return note("Aguarde um instante: ainda estou limpando os metadados do arquivo.");
  const btn = e.submitter ?? e.target.querySelector(".primary"); btn.disabled = true; const tinhaFoco = document.activeElement === $("text"); // (se o teclado estava fechado — áudio, figurinha — ele não sobe ao enviar)
  // o campo e a citação são liberados já no início: dá para digitar a próxima mensagem enquanto esta ainda está indo (se falhar, o texto volta)
  const resp = replyTo; limparTexto(); cancelarResposta();
  try {
    let row, content;
    if (pending) {
      const p = pending; showPending($("pending-name").textContent, "Cifrando e enviando…");
      const path = `${me.id}/${peer.id}/${crypto.randomUUID()}`;
      const sealed = await uploadSealed(p.bytes, path);
      content = { v: 1, type: "media", kind: p.kind, path, key: sealed.key, iv: sealed.iv, mime: p.mime, w: p.w, h: p.h, dur: p.dur, size: p.bytes.length, caption: text };
      if (resp) content.re = resp;
      row = await enviar(peer, content);
      mediaCache.set(path, p.url); clearPending(true); // reaproveita a prévia local, sem baixar de novo
    } else { content = { type: "text", text }; if (resp) content.re = resp; row = await enviar(peer, content); }
    if (active === peer) { $("msgs-empty")?.remove(); addMessage(row, content, { descer: true }); }
    btn.classList.add("voou"); setTimeout(() => btn.classList.remove("voou"), 650);
  } catch (e) {
    console.warn("envio:", e?.code, e?.message || e);
    if (pending) showPending($("pending-name").textContent, "Falhou. Toque em Enviar para tentar de novo.");
    if (!lerTexto()) { $("text").textContent = text; atualizaBotao(); } // devolve o que a pessoa tinha digitado
    if (resp && !replyTo) { replyTo = resp; mostrarResposta(); }
    note(sendError(e, peer));
  } finally { btn.disabled = false; if (tinhaFoco && document.activeElement !== $("text")) $("text").focus(); }
};

// ---------- Fundo da conversa (pessoal, limpo de metadados e cifrado) ----------
const bgCache = new Map(), bgPath = new Map(); // peerId -> url|null / caminho no storage
function setBg(url) {
  $("messages").style.backgroundImage = url ? `linear-gradient(rgba(233,236,248,.5),rgba(233,236,248,.5)),url("${url}")` : "";
  $("messages").classList.toggle("has-bg", !!url);
}
async function applyBackground(peer) {
  if (bgCache.has(peer.id)) return;
  let url = null;
  const { data } = await sb.from("chat_backgrounds").select("*").eq("peer_id", peer.id).maybeSingle();
  if (data) {
    try {
      const c = JSON.parse(await decrypt(myKeys.privateKey, peer.public_key, data));
      url = await loadMedia(c); bgPath.set(peer.id, c.path);
    } catch {}
  }
  bgCache.set(peer.id, url);
  if (active === peer) setBg(url);
}
$("bg-btn").onclick = () => { if (active && !active.grupo) $("bgdlg").showModal(); };
$("bg-pick").onclick = () => $("bg-file").click();
$("bg-file").onchange = async () => {
  const f = $("bg-file").files[0], peer = active; $("bg-file").value = "";
  if (!f || !peer) return;
  $("bgdlg").close();
  try {
    const c = await cleanImage(f, 1600);
    const path = `${me.id}/${me.id}/bg-${crypto.randomUUID()}`;
    const sealed = await uploadSealed(c.bytes, path);
    const enc = await encrypt(myKeys.privateKey, peer.public_key, JSON.stringify({ path, key: sealed.key, iv: sealed.iv, mime: c.mime }));
    const { error } = await sb.from("chat_backgrounds").upsert({ user_id: me.id, peer_id: peer.id, ...enc, updated_at: new Date().toISOString() }, { onConflict: "user_id,peer_id" });
    if (error) throw error;
    const old = bgPath.get(peer.id); if (old) sb.storage.from("media").remove([old]);
    const url = URL.createObjectURL(new Blob([c.bytes], { type: c.mime }));
    mediaCache.set(path, url); bgPath.set(peer.id, path); bgCache.set(peer.id, url);
    if (active === peer) setBg(url);
  } catch (e) { note(niceErr(e, "Não foi possível salvar o fundo. Tente de novo.")); }
};
$("bg-clear").onclick = async () => {
  const peer = active; $("bgdlg").close(); if (!peer) return;
  await sb.from("chat_backgrounds").delete().eq("peer_id", peer.id);
  const old = bgPath.get(peer.id); if (old) sb.storage.from("media").remove([old]);
  bgPath.delete(peer.id); bgCache.set(peer.id, null); if (active === peer) setBg(null);
};
$("viewer").onclick = fecharViewer;
$("viewer").oncancel = (e) => { e.preventDefault(); fecharViewer(); }; // Esc também anima

// ---------- Botão "voltar" do celular (e do navegador) ----------
// Cada tela que se abre por cima (conversa, página de configurações, janela de pergunta, foto ampliada, menus) ganha uma entrada no histórico do navegador:
// "voltar" fecha a tela de cima em vez de sair do site. Se a tela é fechada pelo próprio app (setinha, Cancelar), a entrada é desfeita junto: nunca sobra "voltar" à toa.
const pilhaVoltar = []; let popsIgnorados = 0, marcasAdiadas = 0;
const marca = () => (popsIgnorados > 0 ? marcasAdiadas++ : history.pushState({ lacre: 1 }, "")); // (se um history.back() ainda está andando, a entrada nova espera ele terminar: senão o voltar desfaria a entrada nova)
function abrirEntrada(fechar) { marca(); const e = { fechar, ativo: true }; pilhaVoltar.push(e); return e; }
function fecharEntrada(e) { // a tela foi fechada pelo app
  if (!e.ativo) return; e.ativo = false;
  if (pilhaVoltar[pilhaVoltar.length - 1] === e) { pilhaVoltar.pop(); if (marcasAdiadas > 0) marcasAdiadas--; else { popsIgnorados++; history.back(); } } // (o popstate que isto causa não fecha mais nada)
  // se havia outra tela por cima, a entrada fica "morta" na pilha e é consumida no próximo voltar
}
addEventListener("popstate", (ev) => {
  if (popsIgnorados > 0) { popsIgnorados--; if (!popsIgnorados) for (; marcasAdiadas > 0; marcasAdiadas--) history.pushState({ lacre: 1 }, ""); return; }
  const e = pilhaVoltar.pop();
  if (e) { if (e.ativo) { e.ativo = false; e.fechar(); } return; } // (entrada "morta": a tela já tinha sido fechada pelo app; este voltar só a consome)
  if (ev.state?.lacre) history.back(); // entrada velha de antes de recarregar a página: pula até chegar no começo
});
function ligarVoltar(node, filtro, aberto, fechar) {
  let e = null;
  new MutationObserver(() => { const a = aberto(); if (a && !e) e = abrirEntrada(fechar); else if (!a && e) { const x = e; e = null; fecharEntrada(x); } }).observe(node, filtro);
}
for (const d of document.querySelectorAll("dialog")) ligarVoltar(d, { attributes: true, attributeFilter: ["open"] }, () => d.open, () => d.close()); // toda janela (páginas de configuração, perguntas, avisos, foto ampliada)
ligarVoltar($("chat"), { attributes: true, attributeFilter: ["class"] }, () => $("chat").classList.contains("in-conv"), voltarDaConversa); // a conversa aberta (no celular a lista some atrás dela)
ligarVoltar($("menu-conta"), { attributes: true, attributeFilter: ["hidden"] }, () => !$("menu-conta").hidden, () => fecharMenu(false));
ligarVoltar($("tray"), { attributes: true, attributeFilter: ["class"] }, () => $("tray").classList.contains("on"), () => bandeja(false));
ligarVoltar(document.body, { childList: true }, () => !!document.querySelector(".picker"), fecharPicker); // menu da mensagem (reagir, responder, apagar…)

start();

// Modo de diagnóstico (só com ?diag no endereço): mostra na tela o que mexe na rolagem da lista e se o tamanho dela muda, para achar o que "balança" a tela.
// Não guarda nem envia nada: as linhas ficam só na tela (e no botão "Copiar").
if (/[?&]diag\b/.test(location.search)) (() => {
  const linhas = [], t0 = performance.now(), box = document.createElement("div"), pre = document.createElement("pre"), bt = document.createElement("button");
  box.className = "diag"; bt.type = "button"; bt.textContent = "Copiar"; box.append(bt, pre); document.body.append(box);
  const log = (s) => { linhas.push(Math.round(performance.now() - t0) + " " + s); pre.textContent = linhas.slice(-16).join("\n"); };
  bt.onclick = async () => { try { await navigator.clipboard.writeText(linhas.join("\n")); bt.textContent = "Copiado (" + linhas.length + ")"; } catch { bt.textContent = "Não deu"; } };
  const onde = () => (new Error().stack || "").split("\n").slice(3, 6).map((l) => { const m = l.match(/([\w.-]+\.js)[^:]*:(\d+):\d+/); return m ? m[1] + ":" + m[2] : "?"; }).join("<");
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { if (this.id === "messages") log(`scrollTop=${Math.round(v)} (era ${Math.round(this.scrollTop)} de ${this.scrollHeight}) ${onde()}`); d.set.call(this, v); } });
  for (const nome of ["scrollTo", "scrollBy", "scrollIntoView"]) { const f = Element.prototype[nome]; Element.prototype[nome] = function (...x) { if (this.id === "messages" || this.closest?.("#messages")) log(`${nome} ${onde()}`); return f.apply(this, x); }; }
  let ult = 0, alt = 0, obs = false;
  document.addEventListener("scroll", (e) => { if (e.target?.id !== "messages") return; const t = e.target.scrollTop, dl = t - ult; ult = t; if (Math.abs(dl) >= 20) log(`rolou ${Math.round(t)} (${dl > 0 ? "+" : ""}${Math.round(dl)})`); }, true);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.value > 0.0005) log(`mudou de lugar ${e.value.toFixed(3)} ` + (e.sources || []).slice(0, 2).map((s) => (s.node?.className || s.node?.nodeName || "?") + " " + Math.round(s.previousRect.y) + "->" + Math.round(s.currentRect.y)).join(" | ")); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  const quadro = () => {
    const L = document.getElementById("messages");
    if (L) {
      if (!obs) { obs = true; new MutationObserver((ms) => { let a = 0, r = 0; for (const m of ms) { a += m.addedNodes.length; r += m.removedNodes.length; } log(`lista: +${a} -${r}`); }).observe(L, { childList: true }); }
      if (L.scrollHeight !== alt) { if (alt) log(`altura ${alt}->${L.scrollHeight}`); alt = L.scrollHeight; }
    }
    requestAnimationFrame(quadro);
  };
  requestAnimationFrame(quadro);
})();
