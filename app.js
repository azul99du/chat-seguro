import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { cleanImage, cleanVideo, sealBytes, openBytes } from "./media.js";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup, safetyCode, fingerprint, deleteLocalKeys } from "./crypto.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
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
$("logout").onclick = async () => {
  const r = await choose("Sair", "Se este aparelho é compartilhado, apague também as chaves dele. Você as restaura depois com a sua frase-senha.", [
    { label: "Só sair", value: "keep", cls: "primary" },
    { label: "Sair e apagar chaves deste aparelho", value: "wipe", cls: "ghost" },
    { label: "Cancelar", value: "", cls: "ghost" }]);
  if (!r) return;
  if (r === "wipe" && me) await deleteLocalKeys(me.id);
  await sb.auth.signOut(); location.reload();
};

// ---------- Início: perfil + chaves ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const uid = session.user.id;
  let { data: prof } = await sb.from("profiles").select("id,username,public_key").eq("id", uid).maybeSingle();
  myKeys = await getLocalKeys(uid);

  if (!prof) { // primeiro acesso: gera chaves neste aparelho e publica só a chave pública
    const username = localStorage.getItem("pending-username");
    if (!username) { await sb.auth.signOut(); return note("Não achamos seu perfil. Crie a conta de novo na aba Criar conta."); }
    const publicKey = await createKeys(uid);
    myKeys = await getLocalKeys(uid);
    let pass, hint = "Ela recupera suas mensagens se você trocar de aparelho. Use algo diferente da senha de login (dica: 4 palavras aleatórias) e guarde bem: não dá para redefinir.";
    for (;;) {
      pass = await ask("Crie sua frase-senha", hint);
      if (pass === null) { await sb.auth.signOut(); return location.reload(); }
      if (pass.length >= 12) break;
      hint = "Use pelo menos 12 caracteres.";
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

  me = prof;
  const { data: hasBk } = await sb.from("key_backups").select("user_id").maybeSingle();
  if (!hasBk) await offerBackup(uid);
  $("me").textContent = "@" + me.username;
  $("auth").hidden = true; $("chat").hidden = false;
  await loadContacts();
  sb.channel("msgs", { config: { private: true } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => onIncoming(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${uid}` }, (p) => {
      const e = msgs.get(p.new.id); if (e) { e.m.read_at = p.new.read_at; setReceipt(e); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, onReaction)
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
    if (pass.length < 12) { hint = "Use pelo menos 12 caracteres."; continue; }
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
  const { data: found } = await sb.rpc("find_user", { p_username: name });
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
const packText = (t) => (t.startsWith("{") ? JSON.stringify({ v: 1, type: "text", text: t }) : t);
function unpack(s) {
  if (s.startsWith('{"v":1')) {
    try { const o = JSON.parse(s); if (o.type === "text") return { type: "text", text: String(o.text) }; if (o.type === "media") return o; } catch {}
  }
  return { type: "text", text: s };
}
const sizeLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

// baixa o arquivo cifrado, decifra e devolve uma URL local (nunca sai do navegador decifrado)
const mediaCache = new Map();
const OK_MIME = { image: ["image/jpeg", "image/png", "image/webp"], video: ["video/mp4", "video/quicktime"] };
const OK_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;
// o tipo vem da mensagem (quem enviou controla): só aceitamos tipos de imagem/vídeo, nunca text/html
const safeMime = (c) => { const l = OK_MIME[c.kind === "video" ? "video" : "image"]; return l.includes(c.mime) ? c.mime : l[0]; };
async function loadMedia(c) {
  if (typeof c.path !== "string" || !OK_PATH.test(c.path) || typeof c.key !== "string" || typeof c.iv !== "string") throw new Error("midia invalida");
  if (mediaCache.has(c.path)) return mediaCache.get(c.path);
  const { data, error } = await sb.storage.from("media").download(c.path);
  if (error) throw error;
  const bytes = await openBytes(new Uint8Array(await data.arrayBuffer()), c.key, c.iv);
  const url = URL.createObjectURL(new Blob([bytes], { type: safeMime(c) }));
  mediaCache.set(c.path, url); return url;
}
function mediaBlock(c) {
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

function addMessage(m, content, { err = false, animate = false } = {}) {
  if (typeof content === "string") content = { type: "text", text: content };
  const media = content.type === "media" && !err;
  const text = String(content.type === "media" ? content.caption ?? "" : content.text ?? "");
  const mine = m.sender_id === me.id, at = new Date(m.created_at);
  const wrap = el("div", "msg" + (mine ? " mine" : "")), line = el("div", "line");
  const b = el("div", "bubble" + (mine ? " mine" : "") + (err ? " err" : "") + (media ? " has-media" : ""));
  const label = media ? (content.kind === "video" ? "Vídeo enviado. " : "Foto enviada. ") : "";
  const sr = el("span", "sr", label + text), vis = el("span", "vis", text), meta = el("div", "meta");
  vis.setAttribute("aria-hidden", "true");
  const tm = el("time", null, hhmm(at)); tm.dateTime = at.toISOString();
  const rcpt = el("span", "rcpt"); meta.append(tm, rcpt);
  if (media) b.append(mediaBlock(content));
  b.append(sr, vis, meta); line.append(b);
  const rx = el("div", "rx");
  wrap.append(line, rx);
  if (!err) {
    const rb = el("button", "react-btn", "+"); rb.type = "button"; rb.setAttribute("aria-label", "Reagir a esta mensagem");
    rb.onclick = () => togglePicker(wrap, m.id); line.append(rb);
  }
  $("messages").append(wrap);
  const e = { m, mine, rcpt, rx }; msgs.set(m.id, e); setReceipt(e);
  if (animate && !err && text) { b.classList.add("deciphering"); reveal(vis, text, () => b.classList.remove("deciphering")); }
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
  const enc = await encrypt(myKeys.privateKey, active.public_key, remove ? "" : emoji); // "" = sem reação
  const { error } = await sb.from("reactions").upsert({ message_id: id, user_id: me.id, ...enc }, { onConflict: "message_id,user_id" });
  if (error) { prev ? map.set(me.id, prev) : map.delete(me.id); renderRx(id); note("Não foi possível reagir. Tente de novo."); }
}
async function onReaction(p) {
  const row = p.eventType === "DELETE" ? p.old : p.new;
  if (!active || !msgs.has(row.message_id)) return;
  const map = reactions.get(row.message_id) || new Map(); reactions.set(row.message_id, map);
  if (p.eventType === "DELETE") map.delete(row.user_id);
  else {
    try { const em = await decrypt(myKeys.privateKey, active.public_key, row); em ? map.set(row.user_id, em) : map.delete(row.user_id); } catch { return; }
  }
  renderRx(row.message_id);
}
async function loadReactions(ids, peer) {
  if (!ids.length) return;
  const { data } = await sb.from("reactions").select("*").in("message_id", ids);
  for (const r of data || []) {
    try {
      const map = reactions.get(r.message_id) || new Map(); reactions.set(r.message_id, map);
      const em = await decrypt(myKeys.privateKey, peer.public_key, r);
      if (em) map.set(r.user_id, em);
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
  try { addMessage(m, unpack(await decrypt(myKeys.privateKey, peer.public_key, m)), { animate }); }
  catch { addMessage(m, "Não foi possível decifrar esta mensagem.", { err: true }); }
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
  if (!(await checkPin(peer))) return;
  active = peer; unread.delete(peer.id); renderContacts(); updateStatus();
  $("chat").classList.add("in-conv");
  $("conv-title").textContent = "@" + peer.username;
  $("badge").hidden = false; $("conv-empty").hidden = true; $("send-form").hidden = false;
  $("bg-btn").hidden = false; $("safety-btn").hidden = false; clearPending(); setBg(bgCache.get(peer.id) ?? null); applyBackground(peer);
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
    const { data } = await sb.from("profiles").select("id,username,public_key").eq("id", m.sender_id).single();
    contacts.set(data.id, data);
  }
  if (active?.id === m.sender_id) { $("msgs-empty")?.remove(); await show(m, active, true); markRead(); }
  else unread.add(m.sender_id);
  renderContacts();
}
async function sendPlain(plain, peer) {
  const enc = await encrypt(myKeys.privateKey, peer.public_key, plain);
  const { data, error } = await sb.from("messages").insert({ recipient_id: peer.id, ...enc }).select().single();
  if (error) throw error;
  return data;
}

// ---------- Anexos: limpa os metadados ANTES de qualquer coisa sair do aparelho ----------
const MAX_VIDEO = 45 * 1048576;
let pending = null; // anexo pronto (ou {busy:true} enquanto limpa)
const niceErr = (e, fallback) => (/^(Não|Vídeo|Formato)/.test(e?.message || "") ? e.message : fallback);
function showPending(name, info, ok = false) {
  $("pending").hidden = false; $("pending-name").textContent = name;
  const i = $("pending-info"); i.textContent = info; i.className = ok ? "ok" : "";
}
function clearPending(keepUrl) {
  if (pending?.url && !keepUrl) URL.revokeObjectURL(pending.url);
  pending = null; $("pending").hidden = true; $("pending-thumb").replaceChildren();
}
$("pending-x").onclick = () => clearPending();
$("attach").onclick = () => $("file").click();
$("file").onchange = async () => { const f = $("file").files[0]; $("file").value = ""; if (f) await prepare(f); };

async function prepare(f) {
  clearPending(); const token = (pending = { busy: true });
  showPending(f.name, "Removendo metadados…");
  try {
    let r;
    if (f.type.startsWith("image/")) {
      const c = await cleanImage(f); r = { kind: "image", bytes: c.bytes, mime: c.mime, w: c.w, h: c.h };
    } else if (/\.(mp4|m4v|mov)$/i.test(f.name) || /^video\/(mp4|quicktime)$/.test(f.type)) {
      if (f.size > MAX_VIDEO) throw new Error("Vídeo grande demais. O limite é de 45 MB.");
      const mov = f.type === "video/quicktime" || /\.mov$/i.test(f.name);
      r = { kind: "video", bytes: cleanVideo(await f.arrayBuffer()), mime: mov ? "video/quicktime" : "video/mp4" };
    } else throw new Error("Formato não suportado. Envie foto (JPG, PNG, WebP) ou vídeo MP4/MOV.");
    if (pending !== token) return; // removido enquanto limpava
    r.url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime })); pending = r;
    const t = r.kind === "image" ? el("img") : el("video"); t.src = r.url; if (r.kind === "video") { t.muted = true; t.preload = "metadata"; }
    $("pending-thumb").replaceChildren(t);
    showPending(f.name, `${sizeLabel(r.bytes.length)} · metadados removidos` + (f.type === "image/gif" ? " · GIF vira imagem parada" : ""), true);
  } catch (e) {
    if (pending === token) clearPending();
    note(niceErr(e, "Não foi possível preparar este arquivo."));
  }
}

async function uploadSealed(bytes, path) {
  const sealed = await sealBytes(bytes);
  const { error } = await sb.storage.from("media").upload(path, new Blob([sealed.data], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
  if (error) throw error;
  return sealed;
}

$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("text").value.trim(), peer = active;
  if (!peer || (!text && !pending)) return;
  if (pending?.busy) return note("Aguarde um instante: ainda estou limpando os metadados do arquivo.");
  const btn = e.submitter ?? e.target.querySelector(".primary"); btn.disabled = true;
  try {
    let row, content;
    if (pending) {
      const p = pending; showPending($("pending-name").textContent, "Cifrando e enviando…");
      const path = `${me.id}/${peer.id}/${crypto.randomUUID()}`;
      const sealed = await uploadSealed(p.bytes, path);
      content = { v: 1, type: "media", kind: p.kind, path, key: sealed.key, iv: sealed.iv, mime: p.mime, w: p.w, h: p.h, size: p.bytes.length, caption: text };
      row = await sendPlain(JSON.stringify(content), peer);
      mediaCache.set(path, p.url); clearPending(true); // reaproveita a prévia local, sem baixar de novo
    } else { row = await sendPlain(packText(text), peer); content = { type: "text", text }; }
    if (active === peer) { $("msgs-empty")?.remove(); addMessage(row, content); }
    $("text").value = "";
  } catch {
    if (pending) showPending($("pending-name").textContent, "Falhou. Toque em Enviar para tentar de novo.");
    note("Não foi possível enviar. Verifique a conexão e tente de novo.");
  } finally { btn.disabled = false; $("text").focus(); }
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
