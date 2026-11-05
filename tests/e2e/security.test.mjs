// Tentativas de ataque contra o banco, feitas com contas comuns e sem login. Tudo precisa ser BLOQUEADO.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY, configurado, motivoSemConfig, cadastroFunciona, novoEmail, novoUsuario, SENHA } from "./env.mjs";

const mk = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const pk = (n) => ({ kty: "EC", crv: "P-256", x: "x" + n, y: "y" + n });
const base = (to) => ({ recipient_id: to, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==" });
const hdr = () => ({ sid: hex(), dh: { x: "x", y: "y" }, pn: 0, n: 0 });
const bloqueado = (r) => Boolean(r.error) || !(r.data?.length ?? (r.data ? 1 : 0));

let skip = configurado ? false : motivoSemConfig, a, b, x, anon, mid, mid2;
async function usuario(tag) {
  const c = mk(), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA });
  if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const r = await c.from("profiles").insert({ id: data.user.id, username: novoUsuario(tag), public_key: pk(tag) });
  if (r.error) throw r.error;
  return { c, id: data.user.id };
}
before(async () => {
  if (skip) return;
  const s = await cadastroFunciona();
  if (!s.ok) { skip = s.motivo; return; }
  [a, b, x] = [await usuario("a"), await usuario("b"), await usuario("c")]; // a e b conversam; x é o invasor
  anon = mk();
  mid = (await a.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr() }).select().single()).data.id;
  mid2 = (await x.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr() }).select().single()).data.id;
});
const t = (nome, fn) => test(nome, { skip: () => skip }, fn);

t("o invasor não lista os perfis de quem nunca contatou", async () => {
  const r = await x.c.from("profiles").select("id"); // x contatou só b
  assert.ok(!r.data.some((p) => p.id === a.id));
});
t("o backup cifrado da chave não é legível por outros", async () => {
  assert.ok((await x.c.from("profiles").select("key_backup")).error);
  assert.equal((await x.c.from("key_backups").select("*")).data.length, 0);
});
t("trocar a chave pública (própria ou alheia) é negado", async () => {
  assert.ok(bloqueado(await x.c.from("profiles").update({ public_key: pk("evil") }).eq("id", x.id).select()));
  assert.ok(bloqueado(await x.c.from("profiles").update({ public_key: pk("evil") }).eq("id", a.id).select()));
});
t("busca de usuário só por nome exato (curingas não listam ninguém)", async () => {
  const { data: perfil } = await a.c.from("profiles").select("username").eq("id", a.id).single();
  assert.equal((await x.c.rpc("find_user", { p_username: perfil.username })).data.length, 1);
  for (const q of ["%", "u%", "_", perfil.username.slice(0, 3) + "%"]) assert.equal((await x.c.rpc("find_user", { p_username: q })).data.length, 0, q);
});
t("não lê mensagens de outras conversas", async () => {
  const r = await x.c.from("messages").select("id").eq("id", mid);
  assert.equal(r.data.length, 0);
});
t("não envia mensagem fingindo ser outra pessoa", async () => {
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), sender_id: a.id })).error);
});
t("só entra mensagem com sigilo futuro: formato antigo, sem cabeçalho, cabeçalho gigante e versão desconhecida são recusados", async () => {
  assert.ok((await x.c.from("messages").insert(base(b.id))).error, "v=1");
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 1, header: hdr() })).error, "v=1 com cabeçalho");
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 2 })).error, "v=2 sem cabeçalho");
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 2, header: { ...hdr(), lixo: "A".repeat(3000) } })).error, "cabeçalho gigante");
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 3, header: hdr() })).error, "v=3");
});
t("não forja 'visto' nem data de envio; mensagem gigante é recusada", async () => {
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), read_at: new Date().toISOString() })).error);
  assert.ok((await x.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), created_at: "2001-01-01T00:00:00Z" })).error);
  assert.ok((await x.c.from("messages").insert({ recipient_id: b.id, ciphertext: "A".repeat(40000), iv: "aXZpdml2aXZpdg==", v: 2, header: hdr() })).error);
});
t("ninguém apaga mensagens; remetente não marca a própria como vista; destinatário não altera conteúdo nem cabeçalho", async () => {
  assert.ok(bloqueado(await x.c.from("messages").delete().eq("id", mid2).select()));
  assert.ok(bloqueado(await x.c.from("messages").update({ read_at: new Date().toISOString() }).eq("id", mid2).select()));
  assert.ok(bloqueado(await b.c.from("messages").update({ ciphertext: "aGFja2Vk" }).eq("id", mid).select()));
  assert.ok(bloqueado(await b.c.from("messages").update({ header: hdr() }).eq("id", mid).select()));
  assert.equal((await b.c.from("messages").update({ read_at: new Date().toISOString() }).eq("id", mid).select()).data.length, 1, "(controle) o destinatário pode marcar como vista");
});
t("tabela antiga de reações é só leitura", async () => {
  assert.ok((await b.c.from("reactions").insert({ message_id: mid, user_id: b.id, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==" })).error);
  assert.equal((await x.c.from("reactions").select("*").eq("message_id", mid)).data.length, 0);
});
t("prekeys: só a própria; em nome de outra pessoa, malformada e gigante são negadas; leitura direta de outros é vazia", async () => {
  const spk = { kty: "EC", crv: "P-256", x: "px", y: "py" };
  assert.ok(!(await a.c.from("prekeys").insert({ id: hex(), public_key: spk })).error, "(controle)");
  assert.ok((await a.c.from("prekeys").insert({ user_id: b.id, id: hex(), public_key: spk })).error, "em nome de b");
  assert.ok((await a.c.from("prekeys").insert({ id: "nao-e-hex", public_key: spk })).error, "id inválido");
  assert.ok((await a.c.from("prekeys").insert({ id: hex(), public_key: { ...spk, lixo: "A".repeat(600) } })).error, "gigante");
  assert.equal((await b.c.from("prekeys").select("*").eq("user_id", a.id)).data.length, 0);
  assert.ok(bloqueado(await b.c.from("prekeys").delete().eq("user_id", a.id).select()));
  const r = await b.c.rpc("get_prekey", { p_user: a.id });
  assert.equal(r.data.length, 1, "(controle) a busca da prekey mais recente funciona");
});
t("anônimo (só a chave pública do site) não lê, escreve nem usa funções", async () => {
  for (const tab of ["profiles", "messages", "reactions", "key_backups", "chat_backgrounds", "prekeys"]) assert.ok((await anon.from(tab).select("*")).error, tab);
  assert.ok((await anon.rpc("find_user", { p_username: "x" })).error);
  assert.ok((await anon.rpc("get_prekey", { p_user: a.id })).error);
  assert.ok((await anon.from("messages").insert({ ...base(b.id), v: 2, header: hdr() })).error);
});
t("storage: só a pasta própria; nome fora do padrão e HTML são recusados; outros não baixam nem apagam", async () => {
  const bin = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }), op = { contentType: "application/octet-stream" };
  const f1 = `${a.id}/${b.id}/${crypto.randomUUID()}`;
  assert.ok(!(await a.c.storage.from("media").upload(f1, bin, op)).error, "(controle) envio");
  assert.ok(!(await b.c.storage.from("media").download(f1)).error, "(controle) o destinatário baixa");
  assert.ok((await x.c.storage.from("media").download(f1)).error, "invasor baixa");
  assert.ok((await x.c.storage.from("media").upload(`${a.id}/${b.id}/${crypto.randomUUID()}`, bin, op)).error, "grava na pasta alheia");
  assert.ok((await x.c.storage.from("media").upload(`${x.id}/${b.id}/../../x`, bin, op)).error, "nome fora do padrão");
  assert.ok((await x.c.storage.from("media").upload(`${x.id}/${b.id}/${crypto.randomUUID()}`, new Blob(["<script>alert(1)</script>"], { type: "text/html" }), { contentType: "text/html" })).error, "HTML");
  await x.c.storage.from("media").remove([f1]);
  assert.ok(!(await b.c.storage.from("media").download(f1)).error, "o arquivo continua lá depois da tentativa de apagar");
  await a.c.storage.from("media").remove([f1]); // limpeza
});
