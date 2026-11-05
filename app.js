import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { createKeys, getLocalKeys, encrypt, decrypt, makeBackup, restoreBackup } from "./crypto.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
let me, myKeys, active, contacts = new Map(); // id -> perfil

// ---------- Auth ----------
let mode = "login";
document.querySelectorAll("#auth-form button").forEach((b) => (b.onclick = () => (mode = b.dataset.mode)));
$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("email").value, password = $("password").value;
  const msg = (t) => ($("auth-msg").textContent = t);
  if (mode === "signup") {
    if (!$("username").value) return msg("Escolha um nome de usuário.");
    localStorage.setItem("pending-username", $("username").value.toLowerCase());
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return msg(error.message);
    if (!data.session) return msg("Confirme o e-mail e depois entre.");
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return msg(error.message);
  }
  start();
};
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- Início: perfil + chaves ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const uid = session.user.id;
  let { data: prof } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  myKeys = await getLocalKeys(uid);

  if (!prof) { // primeiro acesso: gera chaves neste aparelho e publica a chave pública
    const username = localStorage.getItem("pending-username");
    if (!username) return alert("Perfil não encontrado. Cadastre-se de novo.");
    const publicKey = await createKeys(uid);
    myKeys = await getLocalKeys(uid);
    let pass;
    while (!pass || pass.length < 8) pass = prompt("Crie uma FRASE-SENHA (mín. 8 caracteres, diferente da senha de login). Ela recupera suas mensagens em outro aparelho e NÃO pode ser redefinida:");
    const key_backup = await makeBackup(uid, pass);
    const { error } = await sb.from("profiles").insert({ id: uid, username, public_key: publicKey, key_backup });
    if (error) return alert(error.message);
    prof = { id: uid, username, public_key: publicKey, key_backup };
  } else if (!myKeys) {
    if (!prof.key_backup) return alert("Sem chave neste aparelho e sem backup: mensagens antigas não podem ser lidas.");
    for (;;) {
      const pass = prompt("Novo aparelho: digite sua frase-senha para restaurar a chave (Cancelar para sair):");
      if (pass === null) return;
      try { await restoreBackup(uid, pass, prof.key_backup, prof.public_key); break; }
      catch { alert("Frase-senha incorreta."); }
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
  $("contacts").replaceChildren(...[...contacts.values()].map((p) => {
    const li = document.createElement("li");
    li.textContent = "@" + p.username;
    li.className = active?.id === p.id ? "active" : "";
    li.onclick = () => open(p);
    return li;
  }));
}
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("add-user").value.toLowerCase();
  const { data } = await sb.from("profiles").select("*").eq("username", name).maybeSingle();
  if (!data) return alert("Usuário não encontrado.");
  if (data.id === me.id) return alert("Esse é você.");
  contacts.set(data.id, data); $("add-user").value = ""; renderContacts(); open(data);
};

// ---------- Conversa ----------
function bubble(text, mine, err) {
  const d = document.createElement("div");
  d.className = "msg" + (mine ? " me" : "") + (err ? " err" : "");
  d.textContent = text; // textContent: nunca interpreta HTML
  $("messages").append(d); $("messages").scrollTop = 1e9;
}
async function show(m, peer) {
  const mine = m.sender_id === me.id;
  try { bubble(await decrypt(myKeys.privateKey, peer.public_key, m), mine); }
  catch { bubble("🔒 não foi possível decifrar", mine, true); }
}
async function open(peer) {
  active = peer; renderContacts();
  $("conv-title").textContent = "@" + peer.username; $("send-form").hidden = false;
  $("messages").replaceChildren();
  const { data } = await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${me.id})`)
    .order("created_at").limit(200);
  for (const m of data || []) await show(m, peer);
}
async function onIncoming(m) {
  if (!contacts.has(m.sender_id)) {
    const { data } = await sb.from("profiles").select("*").eq("id", m.sender_id).single();
    contacts.set(data.id, data); renderContacts();
  }
  if (active?.id === m.sender_id) show(m, active);
}
$("send-form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("text").value.trim(); if (!text || !active) return;
  const enc = await encrypt(myKeys.privateKey, active.public_key, text);
  const { error } = await sb.from("messages").insert({ recipient_id: active.id, ...enc });
  if (error) return alert(error.message);
  bubble(text, true); $("text").value = "";
};

start();
