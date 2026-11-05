import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup } from "./crypto.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let me, myKeys, active;
const contacts = new Map(); // id -> perfil
const unread = new Set();
let online = new Set(); // ids de quem está online agora
const msgs = new Map(), reactions = new Map(); // mensagens/reações da conversa aberta

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
  sb.channel("msgs")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => onIncoming(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${uid}` }, (p) => {
      const e = msgs.get(p.new.id); if (e) { e.m.read_at = p.new.read_at; setReceipt(e); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, onReaction)
    .subscribe();

  // quem está online: presença em tempo real (some sozinha ao fechar o site)
  const pres = sb.channel("online", { config: { presence: { key: uid } } });
  pres.on("presence", { event: "sync" }, () => {
    online = new Set(Object.keys(pres.presenceState()));
    renderContacts(); updateStatus();
  }).subscribe(async (st) => { if (st === "SUBSCRIBED") await pres.track({ at: Date.now() }); });

  document.addEventListener("visibilitychange", markRead);
  addEventListener("focus", markRead);
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
  const { data } = await sb.from("profiles").select("*").eq("username", name).maybeSingle();
  if (!data) return note(`Não encontramos @${name}. Confira se o nome está certinho com seu amigo.`);
  if (data.id === me.id) return note("Esse é você! Chame um amigo.");
  contacts.set(data.id, data); $("add-user").value = ""; open(data);
};

// ---------- Conversa ----------
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const hhmm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

function updateStatus() { $("conv-status").hidden = !(active && online.has(active.id)); }

// "enviada" -> "vista 21:45" (só nas minhas mensagens)
function setReceipt(e) {
  if (!e.mine) return;
  e.rcpt.textContent = e.m.read_at ? "vista " + hhmm(new Date(e.m.read_at)) : "enviada";
  e.rcpt.classList.toggle("read", !!e.m.read_at);
}

function addMessage(m, text, { err = false, animate = false } = {}) {
  const mine = m.sender_id === me.id, at = new Date(m.created_at);
  const wrap = el("div", "msg" + (mine ? " mine" : "")), line = el("div", "line");
  const b = el("div", "bubble" + (mine ? " mine" : "") + (err ? " err" : ""));
  const sr = el("span", "sr", text), vis = el("span", "vis", text), meta = el("div", "meta");
  vis.setAttribute("aria-hidden", "true");
  const tm = el("time", null, hhmm(at)); tm.dateTime = at.toISOString();
  const rcpt = el("span", "rcpt"); meta.append(tm, rcpt);
  b.append(sr, vis, meta); line.append(b);
  const rx = el("div", "rx");
  wrap.append(line, rx);
  if (!err) {
    const rb = el("button", "react-btn", "+"); rb.type = "button"; rb.setAttribute("aria-label", "Reagir a esta mensagem");
    rb.onclick = () => togglePicker(wrap, m.id); line.append(rb);
  }
  $("messages").append(wrap);
  const e = { m, mine, rcpt, rx }; msgs.set(m.id, e); setReceipt(e);
  if (animate && !err) { b.classList.add("deciphering"); reveal(vis, text, () => b.classList.remove("deciphering")); }
  $("messages").scrollTop = 1e9;
  return e;
}

// ---------- Reações (emoji cifrado com a chave da conversa) ----------
function togglePicker(wrap, id) {
  const had = wrap.querySelector(".picker");
  document.querySelectorAll(".picker").forEach((p) => p.remove());
  if (had) return;
  const p = el("div", "picker"); p.setAttribute("role", "group"); p.setAttribute("aria-label", "Escolha uma reação");
  for (const em of EMOJIS) {
    const b = el("button", null, em); b.type = "button"; b.setAttribute("aria-label", "Reagir com " + em);
    b.onclick = () => { p.remove(); react(id, em); }; p.append(b);
  }
  wrap.append(p); p.firstChild.focus();
}
document.addEventListener("click", (ev) => { if (!ev.target.closest(".picker,.react-btn")) document.querySelectorAll(".picker").forEach((p) => p.remove()); });

function renderRx(id) {
  const e = msgs.get(id); if (!e) return;
  e.rx.replaceChildren();
  for (const [uid, emoji] of reactions.get(id) || []) {
    const mineChip = uid === me.id, c = el("button", "chip" + (mineChip ? " mine" : ""), emoji); c.type = "button";
    c.setAttribute("aria-label", mineChip ? `Sua reação ${emoji}. Toque para remover` : `Reação de @${active.username}: ${emoji}`);
    c.onclick = () => react(id, emoji); // tocar na sua remove; tocar na do amigo repete a mesma
    e.rx.append(c);
  }
}
async function react(id, emoji) {
  const map = reactions.get(id) || new Map(); reactions.set(id, map);
  const prev = map.get(me.id), remove = emoji === prev;
  remove ? map.delete(me.id) : map.set(me.id, emoji); renderRx(id); // atualiza na hora
  let error;
  if (remove) ({ error } = await sb.from("reactions").delete().eq("message_id", id).eq("user_id", me.id));
  else {
    const enc = await encrypt(myKeys.privateKey, active.public_key, emoji);
    ({ error } = await sb.from("reactions").upsert({ message_id: id, user_id: me.id, ...enc }, { onConflict: "message_id,user_id" }));
  }
  if (error) { prev ? map.set(me.id, prev) : map.delete(me.id); renderRx(id); note("Não foi possível reagir. Tente de novo."); }
}
async function onReaction(p) {
  const row = p.eventType === "DELETE" ? p.old : p.new;
  if (!active || !msgs.has(row.message_id)) return;
  const map = reactions.get(row.message_id) || new Map(); reactions.set(row.message_id, map);
  if (p.eventType === "DELETE") map.delete(row.user_id);
  else { try { map.set(row.user_id, await decrypt(myKeys.privateKey, active.public_key, row)); } catch { return; } }
  renderRx(row.message_id);
}
async function loadReactions(ids, peer) {
  if (!ids.length) return;
  const { data } = await sb.from("reactions").select("*").in("message_id", ids);
  for (const r of data || []) {
    try {
      const map = reactions.get(r.message_id) || new Map(); reactions.set(r.message_id, map);
      map.set(r.user_id, await decrypt(myKeys.privateKey, peer.public_key, r));
    } catch {}
  }
  ids.forEach(renderRx);
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

async function show(m, peer, animate) {
  try { addMessage(m, await decrypt(myKeys.privateKey, peer.public_key, m), { animate }); }
  catch { addMessage(m, "Não foi possível decifrar esta mensagem.", { err: true }); }
}
async function open(peer) {
  active = peer; unread.delete(peer.id); renderContacts(); updateStatus();
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = "@" + peer.username;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("messages").replaceChildren(); msgs.clear(); reactions.clear();
  const { data } = await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me.id})`)
    .order("created_at").limit(200);
  if (active !== peer) return;
  for (const m of data || []) await show(m, peer, false);
  if (!data?.length) {
    const p = el("p", "empty", "Nenhuma mensagem ainda. Diga oi: só vocês dois vão ler."); p.id = "msgs-empty";
    $("messages").append(p);
  }
  $("text").focus({ preventScroll: true });
  markRead();
  loadReactions((data || []).map((m) => m.id), peer);
}
$("back").onclick = () => { $("chat").classList.remove("in-conv"); active = null; renderContacts(); updateStatus(); };

async function onIncoming(m) {
  if (!contacts.has(m.sender_id)) {
    const { data } = await sb.from("profiles").select("*").eq("id", m.sender_id).single();
    contacts.set(data.id, data);
  }
  if (active?.id === m.sender_id) { $("msgs-empty")?.remove(); await show(m, active, true); markRead(); }
  else unread.add(m.sender_id);
  renderContacts();
}
$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("text").value.trim(); if (!text || !active) return;
  const btn = e.submitter; btn.disabled = true;
  try {
    const enc = await encrypt(myKeys.privateKey, active.public_key, text);
    const { data, error } = await sb.from("messages").insert({ recipient_id: active.id, ...enc }).select().single();
    if (error) return note("Não foi possível enviar. Verifique a conexão e tente de novo.");
    $("msgs-empty")?.remove(); addMessage(data, text); $("text").value = "";
  } finally { btn.disabled = false; $("text").focus(); }
};

start();
