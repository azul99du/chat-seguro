import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { initiate, accept, canSend, encrypt as ratchetEncrypt, decrypt as ratchetDecrypt, validHeader, genDH, randomHex, bytes as toBytes, text as toText } from "./ratchet.js";
import { montarFigurinhas } from "./figurinhas.js";
import { commit, getSession, getActive, listSessions, getHistory, getSpks, addSpk, removeSpk, pruneSpks, wipeLocal, withLock } from "./store.js";
import { citacao, limpaCitacao, exibir, rotulo } from "./reply.js";
import { cleanImage, cleanVideo, cleanAudio, sealBytes, openBytes } from "./media.js";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup, safetyCode, fingerprint, deleteLocalKeys } from "./crypto.js";

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
const contacts = new Map(); // id -> perfil
const unread = new Set();
let online = new Set(); // ids de quem está online agora
const msgs = new Map(), reactions = new Map(); // mensagens/reações da conversa aberta

// ---------- Diálogos ----------
function ask(title, text, { codigo = false } = {}) {
  const d = $("ask"), i = $("ask-input");
  $("ask-title").textContent = title; $("ask-text").textContent = text;
  i.type = codigo ? "text" : "password"; i.inputMode = codigo ? "numeric" : "text"; i.autocomplete = codigo ? "one-time-code" : "off";
  codigo ? (i.maxLength = 6) : i.removeAttribute("maxlength");
  i.value = ""; d.returnValue = ""; d.showModal(); i.focus();
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
      if (error) return msg(friendly(error.message));
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
  if (r === "wipe" && me) { await deleteLocalKeys(me.id); await wipeLocal(me.id); }
  await sb.auth.signOut(); location.reload();
};

// ---------- Início: perfil + chaves ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  if (await precisaDoisPassos() && !(await pedirCodigoLogin())) { await sb.auth.signOut(); return location.reload(); } // sem o código, nada abre
  const uid = session.user.id;
  let { data: prof } = await sb.from("profiles").select("id,username,public_key").eq("id", uid).maybeSingle();
  myKeys = await getLocalKeys(uid);

  if (!prof) { // primeiro acesso: gera chaves neste aparelho e publica só a chave pública
    const username = localStorage.getItem("pending-username");
    if (!username) { await sb.auth.signOut(); return note("Não achamos seu perfil. Crie a conta de novo na aba Criar conta."); }
    const publicKey = await createKeys(uid);
    myKeys = await getLocalKeys(uid);
    let pass, hint = "Ela recupera suas mensagens se você trocar de aparelho. Use algo diferente da senha de login (dica: cinco palavras sorteadas, como rio-lua-pedra-nuvem-cafe) e guarde bem: não dá para redefinir.";
    for (;;) {
      pass = await ask("Crie sua frase-senha", hint);
      if (pass === null) { await sb.auth.signOut(); return location.reload(); }
      const fraca = fraseFraca(pass); if (!fraca) break;
      hint = fraca;
    }
    const { error } = await sb.from("profiles").insert({ id: uid, username, public_key: publicKey });
    if (error) {
      await sb.auth.signOut();
      return note(error.code === "23505" ? "Esse nome de usuário já existe. Crie a conta de novo com outro nome." : "Não foi possível criar seu perfil: " + error.message);
    }
    localStorage.removeItem("pending-username");
    prof = { id: uid, username, public_key: publicKey };
    if (await saveBackup(uid, pass)) note("Não consegui salvar o backup da sua chave agora. Vou pedir de novo na próxima vez que você entrar.");
  } else if (!myKeys) {
    const { data: bk } = await sb.from("key_backups").select("backup").maybeSingle();
    if (!bk) { await sb.auth.signOut(); return note("Este aparelho não tem sua chave e não existe backup, então as mensagens antigas não podem ser lidas."); }
    let hint = "Para ler suas mensagens neste aparelho, digite a frase-senha que você criou no cadastro.";
    for (;;) {
      const pass = await ask("Aparelho novo", hint);
      if (pass === null) { await sb.auth.signOut(); return location.reload(); }
      try { await restoreBackup(uid, pass, bk.backup, prof.public_key); break; }
      catch { hint = "Frase-senha incorreta. Tente de novo."; }
    }
    myKeys = await getLocalKeys(uid);
  }

  ikJwk = await crypto.subtle.exportKey("jwk", myKeys.privateKey); // usada só em memória, para o acordo de chaves
  me = prof;
  const { data: hasBk } = await sb.from("key_backups").select("user_id").maybeSingle();
  if (!hasBk) await offerBackup(uid);
  $("me").textContent = "@" + me.username;
  $("auth").hidden = true; $("chat").hidden = false;
  ensureSpk();
  await loadContacts();
  atualizarAviso2fa();
  sb.channel("msgs", { config: { private: true } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => onIncoming(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${uid}` }, (p) => {
      const e = msgs.get(p.new.id); if (e) { e.m.read_at = p.new.read_at; setReceipt(e); }
    })
    .subscribe();

  // quem está online: presença em tempo real (some sozinha ao fechar o site)
  const pres = sb.channel("online", { config: { private: true, presence: { key: uid } } });
  pres.on("presence", { event: "sync" }, () => {
    online = new Set(Object.keys(pres.presenceState()));
    renderContacts(); updateStatus();
  }).subscribe(async (st) => { if (st === "SUBSCRIBED") await pres.track({ at: Date.now() }); });

  document.addEventListener("visibilitychange", markRead);
  addEventListener("focus", markRead);
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
async function atualizarAviso2fa() { $("mfa-nudge").hidden = !!(await ativo2fa()); }
async function desenharSeguranca() {
  const ativo = await ativo2fa(), msg = $("mfa-msg"); msg.textContent = ""; msg.className = "";
  $("mfa-enroll").hidden = !pendente2fa; $("mfa-off").hidden = !ativo || !!pendente2fa;
  $("mfa-go").hidden = !!ativo && !pendente2fa;
  $("mfa-go").textContent = pendente2fa ? "Confirmar código" : "Ativar";
  $("mfa-status").textContent = pendente2fa ? "Falta só confirmar: digite o código que o app mostra."
    : ativo ? "Ativada. Além da senha, o Lacre pede um código do seu app autenticador a cada novo login. Sem o código, ninguém abre a conta, mesmo sabendo a senha."
    : "Desativada. Com ela, uma senha descoberta não basta para entrar na sua conta.";
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

// ---------- Contatos ----------
async function loadContacts() {
  const { data } = await sb.from("messages").select("sender_id,recipient_id").order("created_at", { ascending: false }).limit(200);
  const ids = [...new Set((data || []).flatMap((m) => [m.sender_id, m.recipient_id]))].filter((i) => i !== me.id);
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("id,username,public_key").in("id", ids);
    ps.forEach((p) => contacts.set(p.id, p));
  }
  renderContacts();
}
function renderContacts() {
  $("inbox-empty").hidden = contacts.size > 0;
  $("contacts").replaceChildren(...[...contacts.values()].map((p) => {
    const li = document.createElement("li"), b = document.createElement("button");
    const av = document.createElement("span"), nm = document.createElement("span");
    av.className = "avatar" + (online.has(p.id) ? " on" : ""); av.textContent = p.username[0]; av.setAttribute("aria-hidden", "true");
    nm.className = "who"; nm.textContent = "@" + p.username;
    if (online.has(p.id)) { const st = document.createElement("small"); st.textContent = "online"; nm.append(st); }
    b.append(av, nm);
    if (unread.has(p.id)) { const u = document.createElement("i"); u.className = "unread"; u.title = "Mensagem nova"; b.append(u); }
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
  contacts.set(data.id, data); $("add-user").value = ""; open(data);
};

// ---------- Conversa ----------
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const hhmm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function updateStatus() { $("conv-status").hidden = !(active && online.has(active.id)); }

// "enviada" -> "vista 21:45" (só nas minhas mensagens)
function setReceipt(e) {
  if (!e.mine) return;
  e.rcpt.textContent = e.m.read_at ? "vista " + hhmm(new Date(e.m.read_at)) : "enviada";
  e.rcpt.classList.toggle("read", !!e.m.read_at);
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
  const { data, error } = await sb.storage.from("media").download(c.path);
  if (error) throw error;
  const bytes = await openBytes(new Uint8Array(await data.arrayBuffer()), c.key, c.iv);
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
  btn.type = "button"; btn.setAttribute("aria-label", "Tocar áudio"); barra.append(prog); box.append(btn, barra, tempo);
  const a = new Audio(url); a.preload = "metadata";
  const total = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : dur) || 0;
  const pinta = () => { const t = total(); prog.style.width = t ? Math.min(100, (a.currentTime / t) * 100) + "%" : "0%"; tempo.textContent = `${mmss(a.currentTime)} / ${mmss(t)}`; };
  a.ontimeupdate = pinta;
  a.onplay = () => { btn.classList.add("on"); btn.setAttribute("aria-label", "Pausar áudio"); };
  a.onpause = () => { btn.classList.remove("on"); btn.setAttribute("aria-label", "Tocar áudio"); };
  a.onended = () => { a.currentTime = 0; pinta(); if (tocando === a) tocando = null; };
  a.onerror = () => { tempo.textContent = "Este aparelho não toca este formato"; };
  const toca = () => { if (tocando && tocando !== a) tocando.pause(); tocando = a; return a.play().catch(() => { tempo.textContent = "Toque de novo para ouvir"; }); };
  btn.onclick = () => (a.paused ? toca() : a.pause());
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
      img.onclick = () => { $("viewer-img").src = url; $("viewer").showModal(); };
    }).catch(fail);
  } else if (c.kind === "sticker") {
    box.classList.add("sticker"); const ph = el("div", "ph", "…"); box.append(ph);
    loadMedia(c).then((url) => {
      const img = new Image(); img.alt = "Figurinha"; img.draggable = false;
      img.onload = () => { ph.replaceWith(img); if (!mine) box.append(botaoSalvarFigurinha(c.path)); }; img.onerror = fail; img.src = url;
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
    }
  } else {
    const btn = el("button", "ph", `Tocar para carregar o vídeo · ${sizeLabel(Number(c.size) || 0)}`); btn.type = "button";
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Carregando vídeo…";
      try {
        const v = document.createElement("video"); v.controls = true; v.playsInline = true; v.preload = "metadata";
        v.src = await loadMedia(c); btn.replaceWith(v);
      } catch { fail(); }
    };
    box.append(btn);
  }
  return box;
}

function addMessage(m, content, { err = false, animate = false, em = null } = {}) {
  if (typeof content === "string") content = { type: "text", text: content };
  const apagada = content.type === "deleted";
  const media = content.type === "media" && !err;
  const text = apagada ? "Mensagem apagada" : String(content.type === "media" ? content.caption ?? "" : content.text ?? "");
  const mine = m.sender_id === me.id, at = new Date(m.created_at);
  const wrap = el("div", "msg" + (mine ? " mine" : "")), line = el("div", "line");
  const b = el("div", "bubble" + (mine ? " mine" : "") + (err ? " err" : "") + (media ? " has-media" : "") + (media && content.kind === "sticker" ? " sticker" : "") + (apagada ? " apagada" : ""));
  const label = media ? (content.kind === "sticker" ? "Figurinha enviada. " : content.kind === "video" ? "Vídeo enviado. " : content.kind === "audio" ? "Áudio enviado. " : "Foto enviada. ") : "";
  const re = limpaCitacao(content.re), citado = re ? exibir(re, msgs.get(re.id), { me: me.id, peer: active?.id }) : null;
  const quemCitado = citado?.autor === "mine" ? "Você" : citado?.autor === "theirs" ? "@" + active.username : "Mensagem";
  const sr = el("span", "sr", (citado ? `Em resposta a ${quemCitado}: ${citado.rotulo}. ` : "") + label + text), vis = el("span", "vis", text), meta = el("div", "meta");
  vis.setAttribute("aria-hidden", "true");
  const tm = el("time", null, hhmm(at)); tm.dateTime = at.toISOString();
  const rcpt = el("span", "rcpt"); meta.append(tm, rcpt);
  if (citado) {
    const q = el("button", "quote" + (citado.original ? "" : " sem-original")); q.type = "button";
    q.append(el("span", "q-who", quemCitado), el("span", "q-text", citado.rotulo));
    q.setAttribute("aria-label", `Mensagem citada de ${quemCitado}: ${citado.rotulo}. Ir para a mensagem`);
    q.onclick = () => irPara(re.id); q.dataset.re = String(re.id);
    b.append(q);
  }
  if (media) b.append(mediaBlock(content, mine));
  b.append(sr, vis, meta); line.append(b);
  const rx = el("div", "rx");
  wrap.append(line, rx);
  if (!err) {
    const rb = el("button", "react-btn", "+"); rb.type = "button"; rb.setAttribute("aria-label", apagada ? "Opções desta mensagem apagada" : "Reagir, responder ou apagar esta mensagem");
    rb.onclick = () => togglePicker(wrap, m.id); line.append(rb);
  }
  if (em) em.replaceWith(wrap); else $("messages").append(wrap);
  const e = { m, mine, rcpt, rx, wrap, content: err ? null : content }; msgs.set(m.id, e); if (!apagada) setReceipt(e);
  if (animate && !err && text) { b.classList.add("deciphering"); reveal(vis, text, () => b.classList.remove("deciphering")); }
  $("messages").scrollTop = 1e9;
  return e;
}

// ---------- Reações (emoji cifrado com a chave da conversa) ----------
// ---------- Responder (citação) ----------
const citavel = (id) => !!msgs.get(id)?.content && !!citacao(id, msgs.get(id).m.sender_id, msgs.get(id).content);
const nomeAutor = (a) => (a === "mine" ? "você" : a === "theirs" ? "@" + active.username : "mensagem");
function mostrarResposta() {
  $("replybar").hidden = !replyTo;
  if (!replyTo) return;
  const v = exibir(replyTo, msgs.get(replyTo.id), { me: me.id, peer: active?.id });
  $("reply-who").textContent = "Respondendo a " + nomeAutor(v.autor); $("reply-text").textContent = v.rotulo;
}
function responder(id) {
  const e = msgs.get(id); if (!e || !active) return;
  const c = citacao(id, e.m.sender_id, e.content); if (!c) return;
  replyTo = c; mostrarResposta(); $("text").focus();
}
function cancelarResposta() { replyTo = null; mostrarResposta(); }
$("reply-x").onclick = () => { cancelarResposta(); $("text").focus(); };
$("text").addEventListener("keydown", (e) => { if (e.key === "Escape" && replyTo) { e.preventDefault(); cancelarResposta(); } });
function irPara(id) { // vai até a mensagem original e a destaca por um instante
  const e = msgs.get(id);
  if (!e) return note("A mensagem original não está mais nesta tela (é de muito tempo atrás).");
  e.wrap.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  e.wrap.classList.add("flash"); setTimeout(() => e.wrap.classList.remove("flash"), 1500);
}

function togglePicker(wrap, id) {
  const had = wrap.querySelector(".picker");
  document.querySelectorAll(".picker").forEach((p) => p.remove());
  if (had) return;
  const p = el("div", "picker"), linha = el("div", "emojis"), apagada = msgs.get(id)?.content?.type === "deleted";
  p.setAttribute("role", "group"); p.setAttribute("aria-label", apagada ? "Apagar" : "Reagir, responder ou apagar");
  for (const em of apagada ? [] : EMOJIS) {
    const b = el("button", null, em); b.type = "button"; b.setAttribute("aria-label", "Reagir com " + em);
    b.onclick = () => { p.remove(); react(id, em); }; linha.append(b);
  }
  if (!apagada) p.append(linha);
  if (citavel(id)) { const r = el("button", "responder", "Responder"); r.type = "button"; r.onclick = () => { p.remove(); responder(id); }; p.append(r); }
  const ap = el("button", "apagar", "Apagar…"); ap.type = "button"; ap.onclick = () => { p.remove(); perguntarApagar(id); }; p.append(ap);
  wrap.append(p); p.querySelector("button").focus();
}
document.addEventListener("click", (ev) => { if (!ev.target.closest(".picker,.react-btn")) document.querySelectorAll(".picker").forEach((p) => p.remove()); });

function renderRx(id) {
  const e = msgs.get(id); if (!e) return;
  e.rx.replaceChildren(); if (e.content?.type === "deleted") return;
  for (const [uid, emoji] of reactions.get(id) || []) {
    const mineChip = uid === me.id, c = el("button", "chip" + (mineChip ? " mine" : ""), emoji); c.type = "button";
    c.setAttribute("aria-label", mineChip ? `Sua reação ${emoji}. Toque para remover` : `Reação de @${active.username}: ${emoji}`);
    c.onclick = () => react(id, emoji); // tocar na sua remove; tocar na do amigo repete a mesma
    e.rx.append(c);
  }
}
async function react(id, emoji) {
  const peer = active, map = reactions.get(id) || new Map(); reactions.set(id, map);
  const prev = map.get(me.id), remove = emoji === prev;
  remove ? map.delete(me.id) : map.set(me.id, emoji); renderRx(id); // atualiza na hora
  try { await sendContent(peer, { type: "reaction", to: id, emoji: remove ? "" : emoji }); }
  catch (e) { prev ? map.set(me.id, prev) : map.delete(me.id); renderRx(id); note(sendError(e, peer)); }
}
function applyReaction(c, m) { // reação nova = mensagem cifrada (com sigilo futuro) com conteúdo "reaction"
  const id = Number(c.to); if (!Number.isFinite(id)) return;
  const map = reactions.get(id) || new Map(); reactions.set(id, map);
  const em = typeof c.emoji === "string" ? c.emoji.slice(0, 16) : "";
  em ? map.set(m.sender_id, em) : map.delete(m.sender_id); renderRx(id);
}
// ---------- Apagar mensagens ----------
// Para todos: vai uma mensagem cifrada {type:"delete"} para o amigo e, nos dois aparelhos, o texto guardado é trocado por "Mensagem apagada".
// Só para mim: o aparelho guarda que aquela mensagem ficou escondida. O aviso "Mensagem apagada" também pode ser apagado, só para mim.
function trocaPorApagada(id) {
  for (const q of document.querySelectorAll(`.quote[data-re="${Number(id)}"]`)) { const t = q.querySelector(".q-text"); if (t) t.textContent = "Mensagem apagada"; q.setAttribute("aria-label", "Mensagem citada apagada"); } // citações já na tela não guardam o texto antigo
  const e = msgs.get(id); if (!e) return; reactions.delete(id); addMessage(e.m, { type: "deleted" }, { em: e.wrap });
}
async function aplicarApagar(c, m) {
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
  e.wrap.remove(); msgs.delete(id); reactions.delete(id);
  if (!msgs.size && !$("msgs-empty")) { const p = el("p", "empty", "Nenhuma mensagem aqui."); p.id = "msgs-empty"; $("messages").append(p); }
}
async function apagarParaTodos(id) {
  const e = msgs.get(id), peer = active; if (!e || !peer || !e.mine || e.content?.type === "deleted") return;
  try { await sendContent(peer, { type: "delete", to: id }); } catch (err) { return note(sendError(err, peer)); }
  const c = e.content; // o arquivo cifrado de foto/vídeo/áudio sai do servidor (figurinha não: o mesmo arquivo é reaproveitado em outras mensagens)
  if (c?.type === "media" && c.kind !== "sticker" && typeof c.path === "string") { await sb.storage.from("media").remove([c.path]).catch(() => {}); const u = mediaCache.get(c.path); if (u) { URL.revokeObjectURL(u); mediaCache.delete(c.path); } }
  await commit(me.id, peer.id, { entryId: id, entry: { content: { type: "deleted", by: me.id }, at: e.m.created_at, mine: true } });
  trocaPorApagada(id);
}
async function perguntarApagar(id) {
  const e = msgs.get(id); if (!e || !active) return;
  const aviso = e.content?.type === "deleted", todos = e.mine && !aviso, nome = "@" + active.username;
  const r = await choose("Apagar mensagem?",
    aviso ? "O aviso some só da sua tela." : todos ? `Para todos: some também para ${nome}, e fica o aviso "Mensagem apagada". Só para mim: some só desta tela e ${nome} continua vendo.` : `Some só da sua tela. ${nome} não é avisado e continua com a mensagem.`,
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
  await sb.from("messages").update({ read_at: at }).in("id", ids).is("read_at", null);
}

// ---------- Sigilo futuro (mensagens v2: Double Ratchet) ----------
const lockName = (peer) => `lacre:${me.id}:${peer.id}`;
const SPK_ROTATE = 7 * 864e5, SPK_KEEP = 14 * 864e5;
const gone = (t) => ({ type: "unreadable", text: t });

// Chave de médio prazo: publicamos a parte pública; a privada fica só aqui e é apagada depois de 14 dias.
async function ensureSpk() {
  try {
    const now = Date.now(), list = await getSpks(me.id);
    const newest = list.reduce((a, k) => (k.created > (a?.created ?? 0) ? k : a), null);
    if (!newest || now - newest.created > SPK_ROTATE) {
      const k = await genDH(), id = randomHex(16);
      await addSpk(me.id, { id, priv: k.priv, created: now });
      const { error } = await sb.from("prekeys").insert({ id, public_key: { kty: "EC", crv: "P-256", x: k.pub.x, y: k.pub.y } });
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
  if (o && ["text", "media", "reaction", "hello", "delete"].includes(o.type)) { if (o.re !== undefined) o.re = limpaCitacao(o.re); return o; }
  throw new Error("conteudo invalido");
}
async function decryptV2(m, peer) {
  const h = m.header; if (!validHeader(h)) throw new Error("cabecalho invalido");
  let st = await getSession(me.id, peer.id, h.sid);
  if (!st) {
    const spk = h.init && (await getSpks(me.id)).find((k) => k.id === h.init.spk);
    if (!spk) throw Object.assign(new Error("sem sessao"), { code: "NO_SESSION" });
    st = await accept(ikJwk, peer.public_key, spk, h);
  }
  const { state, plaintext } = await ratchetDecrypt(st, m.sender_id, m.recipient_id, h, m.ciphertext);
  const content = parseContent(toText(plaintext));
  // sessão nova + mensagem lida na mesma transação: a chave já foi gasta, então não pode haver perda
  await commit(me.id, peer.id, { session: state, active: h.sid, entryId: m.id, entry: { content, at: m.created_at } });
  return content;
}
async function readV2(m, peer) {
  const cached = await getHistory(me.id, peer.id, m.id);
  if (cached) return cached.content;
  if (m.sender_id === me.id) return gone("Enviada por você de outro aparelho: o histórico novo fica só no aparelho que enviou.");
  if ((await pinStatus(peer)) === "changed") return gone("A chave desta pessoa mudou. Abra o código de segurança e confira com ela antes de continuar.");
  return withLock(lockName(peer), async () => {
    const again = await getHistory(me.id, peer.id, m.id); if (again) return again.content;
    try { return await decryptV2(m, peer); }
    catch (e) {
      if (e.code === "NO_SESSION") { sayHello(peer); return gone("Esta mensagem é de uma sessão que este aparelho não tem (por exemplo, você entrou neste aparelho depois). Pedi para refazer: as próximas chegam normais."); }
      return gone("Mensagem protegida que este aparelho não conseguiu decifrar.");
    }
  });
}
async function readRow(m, peer) {
  try {
    const ov = await getHistory(me.id, peer.id, m.id); // mensagem apagada (para todos ou só para mim): vale o que está guardado aqui, mesmo nas antigas
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
async function sendSession(peer) {
  const act = await getActive(me.id, peer.id);
  if (act) { const st = await getSession(me.id, peer.id, act); if (st && canSend(st)) return st; }
  for (const st of await listSessions(me.id, peer.id)) if (canSend(st)) return st;
  return newSession(peer);
}
async function sendContent(peer, content) {
  if ((await pinStatus(peer)) === "changed") throw Object.assign(new Error("chave mudou"), { code: "PIN" });
  return withLock(lockName(peer), async () => {
    const r = await ratchetEncrypt(await sendSession(peer), me.id, peer.id, toBytes(JSON.stringify(content)));
    await commit(me.id, peer.id, { session: r.state, active: r.state.sid }); // grava ANTES de enviar: uma chave nunca é usada duas vezes
    const { data, error } = await sb.from("messages").insert({ recipient_id: peer.id, ciphertext: r.ciphertext, iv: r.iv, v: 2, header: r.header }).select().single();
    if (error) throw error;
    await commit(me.id, peer.id, { entryId: data.id, entry: { content, at: data.created_at, mine: true } });
    return data;
  });
}
const limitado = (e) => e?.code === "PT429" || e?.status === 429 || /limite de/i.test(e?.message || "");
const sendError = (e, peer) => limitado(e) ? "Você fez muitas coisas em pouco tempo. Espere cerca de um minuto e tente de novo."
  : e?.code === "NO_PREKEY" ? `@${peer.username} ainda não abriu a versão nova do Lacre, então não dá para enviar com sigilo futuro. Peça para essa pessoa recarregar o site.`
  : e?.code === "PIN" ? `A chave de @${peer.username} mudou. Abra o código de segurança, confira com ela e reabra a conversa.`
  : "Não foi possível enviar. Verifique a conexão e tente de novo.";

async function show(m, peer, animate) {
  const c = await readRow(m, peer);
  if (c.type === "reaction") return applyReaction(c, m);
  if (c.type === "hello" || c.type === "hidden") return;
  if (c.type === "delete") return aplicarApagar(c, m);
  if (c.type === "unreadable") return addMessage(m, c.text, { err: true });
  addMessage(m, c, { animate });
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
  if (!active) return;
  $("safety-who").textContent = "@" + active.username;
  $("safety-code").replaceChildren(...(await safetyCode(me.public_key, active.public_key)).map((g) => el("span", null, g)));
  $("safety").showModal();
};
async function open(peer) {
  bandeja(false);
  if (!(await checkPin(peer))) return;
  active = peer; unread.delete(peer.id); renderContacts(); updateStatus();
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = "@" + peer.username;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("bg-btn").hidden = false; $("safety-btn").hidden = false; clearPending(); setBg(bgCache.get(peer.id) ?? null); applyBackground(peer);
  $("messages").replaceChildren(); msgs.clear(); reactions.clear(); cancelarResposta();
  const { data } = await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me.id})`)
    .order("id", { ascending: false }).limit(200); // as 200 mais NOVAS (e depois ficam em ordem de envio)
  if (active !== peer) return;
  const linhas = (data || []).reverse();
  await loadLegacyReactions(linhas, peer);
  for (const m of linhas) await show(m, peer, false);
  [...msgs.keys()].forEach(renderRx);
  if (!msgs.size) {
    const p = el("p", "empty", "Nenhuma mensagem ainda. Diga oi: só vocês dois vão ler."); p.id = "msgs-empty";
    $("messages").append(p);
  }
  $("text").focus({ preventScroll: true });
  markRead();
}
$("back").onclick = () => { $("chat").classList.remove("in-conv"); active = null; renderContacts(); updateStatus(); };

async function onIncoming(m) {
  if (!contacts.has(m.sender_id)) {
    const { data } = await sb.from("profiles").select("id,username,public_key").eq("id", m.sender_id).single();
    contacts.set(data.id, data);
  }
  const peer = contacts.get(m.sender_id);
  if (m.v === 2) { // decifra já (para andar a cadeia de chaves), mesmo com a conversa fechada
    const c = await readRow(m, peer);
    if (c.type === "reaction") { if (active?.id === peer.id) applyReaction(c, m); return; }
    if (c.type === "hello") return;
    if (c.type === "delete") { await aplicarApagar(c, m); return; }
  }
  if (active?.id === m.sender_id) { $("msgs-empty")?.remove(); await show(m, active, true); markRead(); }
  else unread.add(m.sender_id);
  renderContacts();
}

// ---------- Anexos: limpa os metadados ANTES de qualquer coisa sair do aparelho ----------
const MAX_VIDEO = 45 * 1048576, MAX_AUDIO = 20 * 1048576, MAX_GRAVACAO = 300; // 300 s = 5 min
let pending = null; // anexo pronto (ou {busy:true} enquanto limpa)
let gravador = null; // gravação de áudio em andamento
const niceErr = (e, fallback) => (/^(Não|Vídeo|Áudio|Formato)/.test(e?.message || "") ? e.message : fallback);
function showPending(name, info, ok = false) {
  $("pending").hidden = false; $("pending-name").textContent = name;
  const i = $("pending-info"); i.textContent = info; i.className = ok ? "ok" : "";
  atualizaBotao();
}
function clearPending(keepUrl) {
  if (gravador) { // cancelar: o botão do microfone volta ao normal na hora, sem esperar o navegador avisar que parou
    gravador.cancelado = true; try { gravador.rec.stop(); } catch {}
    $("mic").classList.remove("rec"); $("mic").setAttribute("aria-label", "Gravar áudio");
  }
  if (pending?.url && !keepUrl) URL.revokeObjectURL(pending.url);
  if (tocando) { tocando.pause(); tocando = null; }
  pending = null; atualizaBotao(); $("pending").hidden = true; $("pending-thumb").replaceChildren(); $("pending-thumb").classList.remove("gravando");
  $("pending-extra").replaceChildren(); $("pending-stop").hidden = true;
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
// Bandeja do "+" (foto/vídeo e figurinha) e botão que alterna entre microfone e enviar
const bandeja = (abrir) => { $("tray").classList.toggle("on", abrir); $("mais").setAttribute("aria-expanded", String(abrir)); for (const b of $("tray").querySelectorAll("button")) b.tabIndex = abrir ? 0 : -1; };
$("mais").onclick = () => bandeja(!$("tray").classList.contains("on"));
$("attach").onclick = () => { bandeja(false); $("file").click(); };
document.addEventListener("click", (e) => { if ($("tray").classList.contains("on") && !e.target.closest("#tray, #mais")) bandeja(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("tray").classList.contains("on")) { bandeja(false); $("mais").focus(); } });
// campo vazio e nada anexado = microfone; texto ou anexo pronto = enviar (durante a gravação continua o microfone, que para a gravação)
function atualizaBotao() { $("acao").dataset.modo = lerTexto().trim() !== "" || (pending && !pending.gravando) ? "send" : "mic"; }
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
      if (f.size > MAX_VIDEO) throw new Error("Vídeo grande demais. O limite é de 45 MB.");
      const mov = f.type === "video/quicktime" || /\.mov$/i.test(f.name);
      r = { kind: "video", bytes: cleanVideo(await f.arrayBuffer()), mime: mov ? "video/quicktime" : "video/mp4" };
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
    showPending(f.name, `${r.kind === "audio" && r.dur ? mmss(r.dur) + " · " : ""}${sizeLabel(r.bytes.length)} · metadados removidos` + (f.type === "image/gif" ? " · GIF vira imagem parada" : ""), true);
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
async function iniciarGravacao() {
  if (pedindoMic) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return note("Este navegador não grava áudio. Use o Chrome ou o Safari atualizado, ou anexe um arquivo de áudio.");
  clearPending(); pedindoMic = true;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return note("Não consegui usar o microfone. Permita o acesso ao microfone nas configurações do navegador e tente de novo."); }
  finally { pedindoMic = false; }
  const tipo = tipoGravacao(), rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
  const g = (gravador = { rec, stream, chunks: [], t0: Date.now(), cancelado: false, timer: 0 });
  pending = { busy: true, gravando: true };
  rec.ondataavailable = (e) => { if (e.data?.size) g.chunks.push(e.data); };
  rec.onstop = () => finalizarGravacao(g);
  rec.start(1000);
  $("mic").classList.add("rec"); $("mic").setAttribute("aria-label", "Parar gravação");
  $("pending-thumb").classList.add("gravando"); $("pending-thumb").replaceChildren(iconeMic()); $("pending-stop").hidden = false;
  showPending("Gravando…", "0:00");
  g.timer = setInterval(() => {
    const s = (Date.now() - g.t0) / 1000; $("pending-info").textContent = `${mmss(s)} (máx. ${mmss(MAX_GRAVACAO)})`;
    if (s >= MAX_GRAVACAO) pararGravacao();
  }, 250);
}
function pararGravacao() { if (gravador?.rec.state === "recording") gravador.rec.stop(); }
async function finalizarGravacao(g) {
  clearInterval(g.timer); g.stream.getTracks().forEach((t) => t.stop());
  $("mic").classList.remove("rec"); $("mic").setAttribute("aria-label", "Gravar áudio"); $("pending-stop").hidden = true; $("pending-thumb").classList.remove("gravando");
  if (gravador === g) gravador = null;
  if (g.cancelado) return;
  const dur = Math.round((Date.now() - g.t0) / 1000), token = pending;
  if (!g.chunks.length || dur < 1) { clearPending(); return note("A gravação ficou curta demais. Grave por pelo menos 1 segundo."); }
  showPending("Áudio gravado", "Removendo metadados…");
  try {
    const r = cleanAudio(await new Blob(g.chunks).arrayBuffer(), { gravado: true });
    if (pending !== token) return; // descartado enquanto limpava
    r.url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime })); r.kind = "audio"; r.dur = dur; pending = r;
    $("pending-thumb").replaceChildren(iconeMic()); $("pending-extra").replaceChildren(playerAudio(r.url, dur));
    showPending("Áudio gravado", `${mmss(dur)} · ${sizeLabel(r.bytes.length)} · metadados removidos`, true);
  } catch (e) { if (pending === token) clearPending(); note(niceErr(e, "Não foi possível preparar a gravação.")); }
}
$("mic").onclick = () => (gravador ? pararGravacao() : iniciarGravacao());
$("pending-stop").onclick = pararGravacao;

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
    const row = await sendContent(peer, content);
    if (!mediaCache.has(up.path)) mediaCache.set(up.path, URL.createObjectURL(new Blob([st.bytes], { type: st.mime })));
    if (active === peer) { $("msgs-empty")?.remove(); addMessage(row, content); }
    cancelarResposta();
  } catch (e) { throw new Error(sendError(e, peer)); }
}
$("sticker").onclick = () => { bandeja(false); if (active) figurinhas().abrir(); };

async function uploadSealed(bytes, path) {
  const sealed = await sealBytes(bytes);
  const { error } = await sb.storage.from("media").upload(path, new Blob([sealed.data], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
  if (error) throw error;
  return sealed;
}

$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  const text = lerTexto().trim(), peer = active;
  if (!peer || (!text && !pending)) return;
  if (pending?.gravando) return note("Pare a gravação antes de enviar.");
  if (pending?.busy) return note("Aguarde um instante: ainda estou limpando os metadados do arquivo.");
  const btn = e.submitter ?? e.target.querySelector(".primary"); btn.disabled = true;
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
      row = await sendContent(peer, content);
      mediaCache.set(path, p.url); clearPending(true); // reaproveita a prévia local, sem baixar de novo
    } else { content = { type: "text", text }; if (resp) content.re = resp; row = await sendContent(peer, content); }
    if (active === peer) { $("msgs-empty")?.remove(); addMessage(row, content); }
    btn.classList.add("voou"); setTimeout(() => btn.classList.remove("voou"), 650);
  } catch (e) {
    if (pending) showPending($("pending-name").textContent, "Falhou. Toque em Enviar para tentar de novo.");
    if (!lerTexto()) { $("text").textContent = text; atualizaBotao(); } // devolve o que a pessoa tinha digitado
    if (resp && !replyTo) { replyTo = resp; mostrarResposta(); }
    note(sendError(e, peer));
  } finally { btn.disabled = false; if (document.activeElement !== $("text")) $("text").focus(); }
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
$("bg-btn").onclick = () => $("bgdlg").showModal();
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
$("viewer").onclick = () => $("viewer").close();

start();
