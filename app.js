import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup } from "./crypto.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let me, myKeys, active;
const contacts = new Map(); // id -> perfil
const unread = new Set();

// ---------- Diálogos ----------
function ask(title, text) {
  const d = $("ask"), i = $("ask-input");
  $("ask-title").textContent = title; $("ask-text").textContent = text;
  i.value = ""; d.returnValue = ""; d.showModal(); i.focus();
  return new Promise((res) => { d.onclose = () => res(d.returnValue === "ok" ? i.value : null); });
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
  $("auth-msg").textContent = "";
}
$("tab-login").onclick = () => setMode("login");
$("tab-signup").onclick = () => setMode("signup");

const friendly = (m) => ({
  "Invalid login credentials": "E-mail ou senha incorretos.",
  "User already registered": "Esse e-mail já tem conta. Use a aba Entrar.",
  "Email not confirmed": "Confirme seu e-mail pelo link que enviamos e tente entrar de novo.",
}[m] || m);

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
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- Início: perfil + chaves ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const uid = session.user.id;
  let { data: prof } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  myKeys = await getLocalKeys(uid);

  if (!prof) { // primeiro acesso: gera chaves neste aparelho e publica só a chave pública
    const username = localStorage.getItem("pending-username");
    if (!username) { await sb.auth.signOut(); return note("Não achamos seu perfil. Crie a conta de novo na aba Criar conta."); }
    const publicKey = await createKeys(uid);
    myKeys = await getLocalKeys(uid);
    let pass, hint = "Ela recupera suas mensagens se você trocar de aparelho. Use algo diferente da senha de login e guarde bem: não dá para redefinir.";
    for (;;) {
      pass = await ask("Crie sua frase-senha", hint);
      if (pass === null) { await sb.auth.signOut(); return location.reload(); }
      if (pass.length >= 8) break;
      hint = "Use pelo menos 8 caracteres.";
    }
    const key_backup = await makeBackup(uid, pass);
    const { error } = await sb.from("profiles").insert({ id: uid, username, public_key: publicKey, key_backup });
    if (error) {
      await sb.auth.signOut();
      return note(error.code === "23505" ? "Esse nome de usuário já existe. Crie a conta de novo com outro nome." : "Não foi possível criar seu perfil: " + error.message);
    }
    localStorage.removeItem("pending-username");
    prof = { id: uid, username, public_key: publicKey, key_backup };
  } else if (!myKeys) {
    if (!prof.key_backup) { await sb.auth.signOut(); return note("Este aparelho não tem sua chave e não existe backup, então as mensagens antigas não podem ser lidas."); }
    let hint = "Para ler suas mensagens neste aparelho, digite a frase-senha que você criou no cadastro.";
    for (;;) {
      const pass = await ask("Aparelho novo", hint);
      if (pass === null) { await sb.auth.signOut(); return location.reload(); }
      try { await restoreBackup(uid, pass, prof.key_backup, prof.public_key); break; }
      catch { hint = "Frase-senha incorreta. Tente de novo."; }
    }
    myKeys = await getLocalKeys(uid);
  }

  me = prof;
  $("me").textContent = "@" + me.username;
  $("auth").hidden = true; $("chat").hidden = false;
  await loadContacts();
  sb.channel("msgs").on("postgres_changes",
    { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` },
    (p) => onIncoming(p.new)).subscribe();
}

// ---------- Contatos ----------
async function loadContacts() {
  const { data } = await sb.from("messages").select("sender_id,recipient_id").order("created_at", { ascending: false }).limit(200);
  const ids = [...new Set((data || []).flatMap((m) => [m.sender_id, m.recipient_id]))].filter((i) => i !== me.id);
  if (ids.length) {
    const { data: ps } = await sb.from("profiles").select("*").in("id", ids);
    ps.forEach((p) => contacts.set(p.id, p));
  }
  renderContacts();
}
function renderContacts() {
  $("inbox-empty").hidden = contacts.size > 0;
  $("contacts").replaceChildren(...[...contacts.values()].map((p) => {
    const li = document.createElement("li"), b = document.createElement("button");
    const av = document.createElement("span"), nm = document.createElement("span");
    av.className = "avatar"; av.textContent = p.username[0]; av.setAttribute("aria-hidden", "true");
    nm.textContent = "@" + p.username;
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
  const { data } = await sb.from("profiles").select("*").eq("username", name).maybeSingle();
  if (!data) return note(`Não encontramos @${name}. Confira se o nome está certinho com seu amigo.`);
  if (data.id === me.id) return note("Esse é você! Chame um amigo.");
  contacts.set(data.id, data); $("add-user").value = ""; open(data);
};

// ---------- Conversa ----------
function bubble(text, mine, { err = false, animate = false, at = new Date() } = {}) {
  const d = document.createElement("div");
  d.className = "bubble" + (mine ? " mine" : "") + (err ? " err" : "");
  const sr = document.createElement("span"), vis = document.createElement("span"), tm = document.createElement("time");
  sr.className = "sr"; sr.textContent = text; vis.className = "vis"; vis.setAttribute("aria-hidden", "true"); vis.textContent = text;
  tm.dateTime = at.toISOString(); tm.textContent = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  d.append(sr, vis, tm); $("messages").append(d);
  if (animate && !err) { d.classList.add("deciphering"); reveal(vis, text, () => d.classList.remove("deciphering")); }
  $("messages").scrollTop = 1e9;
}
async function show(m, peer, animate) {
  const mine = m.sender_id === me.id, at = new Date(m.created_at);
  try { bubble(await decrypt(myKeys.privateKey, peer.public_key, m), mine, { animate, at }); }
  catch { bubble("Não foi possível decifrar esta mensagem.", mine, { err: true, at }); }
}
async function open(peer) {
  active = peer; unread.delete(peer.id); renderContacts();
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = "@" + peer.username;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("messages").replaceChildren();
  const { data } = await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me.id})`)
    .order("created_at").limit(200);
  if (active !== peer) return;
  for (const m of data || []) await show(m, peer, false);
  if (!data?.length) {
    const p = document.createElement("p"); p.className = "empty"; p.id = "msgs-empty";
    p.textContent = "Nenhuma mensagem ainda. Diga oi: só vocês dois vão ler.";
    $("messages").append(p);
  }
  $("text").focus({ preventScroll: true });
}
$("back").onclick = () => { $("chat").classList.remove("in-conv"); active = null; renderContacts(); };

async function onIncoming(m) {
  if (!contacts.has(m.sender_id)) {
    const { data } = await sb.from("profiles").select("*").eq("id", m.sender_id).single();
    contacts.set(data.id, data);
  }
  if (active?.id === m.sender_id) { $("msgs-empty")?.remove(); await show(m, active, true); }
  else unread.add(m.sender_id);
  renderContacts();
}
$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("text").value.trim(); if (!text || !active) return;
  const btn = e.submitter; btn.disabled = true;
  try {
    const enc = await encrypt(myKeys.privateKey, active.public_key, text);
    const { error } = await sb.from("messages").insert({ recipient_id: active.id, ...enc });
    if (error) return note("Não foi possível enviar. Verifique a conexão e tente de novo.");
    $("msgs-empty")?.remove(); bubble(text, true); $("text").value = "";
  } finally { btn.disabled = false; $("text").focus(); }
};

start();
