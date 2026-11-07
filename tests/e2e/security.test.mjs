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
// "skip" só é conhecido depois do before(): por isso a decisão é tomada dentro de cada teste
const t = (nome, fn) => test(nome, async (ctx) => (skip ? ctx.skip(skip) : fn(ctx)));

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

// ----- Limites de uso (anti-abuso). Cada teste usa uma conta própria para não afetar as outras. -----
const limitado = (r) => r.error?.code === "PT429" || /limite|lote grande|chaves demais/i.test(r.error?.message || "");
const msg = (to) => ({ ...base(to), v: 2, header: hdr() });

t("limite de mensagens: 60 por minuto por pessoa; a 61ª é recusada com 'espere um pouco'", async () => {
  const f = await usuario("f");
  for (let i = 0; i < 60; i++) { const r = await f.c.from("messages").insert(msg(b.id)); assert.ok(!r.error, `mensagem ${i + 1}: ${r.error?.message}`); }
  const r = await f.c.from("messages").insert(msg(b.id));
  assert.ok(limitado(r), "a 61ª deveria ser limitada: " + JSON.stringify(r.error));
});
t("pedido em lote: mais de 20 mensagens num só pedido é recusado (não dá para furar o limite)", async () => {
  const g = await usuario("g");
  assert.ok(limitado(await g.c.from("messages").insert(Array.from({ length: 21 }, () => msg(b.id)))), "lote de 21");
  assert.ok(!(await g.c.from("messages").insert(Array.from({ length: 3 }, () => msg(b.id)))).error, "(controle) lote pequeno passa");
});
// O limite é por janela de 1 minuto: se a janela virar no meio da sequência, passam mais do que o limite. Nesse caso (e só nele) repete com outra pessoa.
async function testaLimite(prefixo, max, chamada) {
  for (let tent = 0; tent < 3; tent++) {
    const u = await usuario(prefixo); let ok = 0, bloqueada = null;
    for (let n = 0; n <= max; n++) { const r = await chamada(u, n); if (r.error) { bloqueada = r; break; } ok++; }
    if (bloqueada && ok === max) { assert.ok(limitado(bloqueada), JSON.stringify(bloqueada?.error)); return; }
    assert.ok(!bloqueada || ok > max, `bloqueou cedo demais: depois de ${ok} chamadas (o limite é ${max})`);
  }
  assert.fail(`a janela de 1 minuto virou 3 vezes seguidas sem bloquear (limite ${max})`);
}
t("busca de usuário: 15 por minuto; a 16ª é recusada (enumeração fica lenta)", () => testaLimite("h", 15, (u, i) => u.c.rpc("find_user", { p_username: "naoexiste" + i })));
t("busca de prekey: 30 por minuto; a 31ª é recusada", () => testaLimite("i", 30, (u) => u.c.rpc("get_prekey", { p_user: a.id })));
t("prekeys: no máximo 30 por pessoa e 5 por pedido", async () => {
  const j = await usuario("j"), spk = { kty: "EC", crv: "P-256", x: "px", y: "py" };
  assert.ok(limitado(await j.c.from("prekeys").insert(Array.from({ length: 6 }, () => ({ id: hex(), public_key: spk })))), "lote de 6");
  for (let n = 0; n < 30; n++) assert.ok(!(await j.c.from("prekeys").insert({ id: hex(), public_key: spk })).error, `prekey ${n + 1}`);
  assert.ok(limitado(await j.c.from("prekeys").insert({ id: hex(), public_key: spk })), "a 31ª");
});
t("o contador de uso e a função de cota não são acessíveis pelo cliente", async () => {
  assert.ok((await x.c.from("limite_uso").select("*")).error, "tabela limite_uso");
  assert.ok((await x.c.rpc("consome", { p_funcao: "find_user", p_max_min: 999, p_max_hora: 999 })).error, "consome()");
  assert.ok((await anon.rpc("pode_enviar_arquivo")).error, "anônimo");
});

// ---------- avisos push ----------
const PUB = "B" + "x".repeat(86), AUTH = "a".repeat(22), ep = (n) => `https://push.example/${hex()}-${n}`;
t("push: a pessoa registra o aparelho, só ela vê, e os outros não leem nem apagam", async () => {
  const e = ep("um"); assert.ifError((await a.c.rpc("registrar_push", { p_endpoint: e, p_p256dh: PUB, p_auth: AUTH })).error);
  assert.equal((await a.c.from("push_subscriptions").select("endpoint").eq("endpoint", e)).data.length, 1);
  assert.equal((await b.c.from("push_subscriptions").select("endpoint").eq("endpoint", e)).data.length, 0, "outra conta não vê");
  assert.equal((await anon.from("push_subscriptions").select("endpoint")).data?.length ?? 0, 0, "sem login não vê");
  const apagou = await b.c.from("push_subscriptions").delete().eq("endpoint", e).select(); assert.equal(apagou.data?.length ?? 0, 0, "outra conta não apaga");
  assert.equal((await a.c.from("push_subscriptions").delete().eq("endpoint", e).select()).data.length, 1, "o dono apaga");
});
t("push: não dá para inserir direto na tabela, nem registrar sem login, nem com dados inválidos", async () => {
  assert.ok((await a.c.from("push_subscriptions").insert({ user_id: a.id, endpoint: ep("d"), p256dh: PUB, auth: AUTH })).error, "insert direto bloqueado");
  assert.ok((await anon.rpc("registrar_push", { p_endpoint: ep("s"), p_p256dh: PUB, p_auth: AUTH })).error, "anônimo bloqueado");
  assert.ok((await a.c.rpc("registrar_push", { p_endpoint: "http://inseguro.example/x", p_p256dh: PUB, p_auth: AUTH })).error, "só https");
  assert.ok((await a.c.rpc("registrar_push", { p_endpoint: ep("c"), p_p256dh: "curta", p_auth: AUTH })).error, "chave curta demais");
  assert.ok((await a.c.rpc("registrar_push", { p_endpoint: "https://x.example/" + "a".repeat(900), p_p256dh: PUB, p_auth: AUTH })).error, "endereço enorme");
});
t("push: no máximo 5 aparelhos por pessoa (os mais antigos saem) e o mesmo endereço muda de dono", async () => {
  const u = await usuario("p"), es = []; for (let i = 0; i < 7; i++) { es.push(ep("m" + i)); assert.ifError((await u.c.rpc("registrar_push", { p_endpoint: es[i], p_p256dh: PUB, p_auth: AUTH })).error); }
  const minhas = (await u.c.from("push_subscriptions").select("endpoint")).data.map((r) => r.endpoint); assert.equal(minhas.length, 5); assert.ok(!minhas.includes(es[0]) && minhas.includes(es[6]));
  assert.ifError((await b.c.rpc("registrar_push", { p_endpoint: es[6], p_p256dh: PUB, p_auth: AUTH })).error); // outro login no mesmo aparelho
  assert.equal((await b.c.from("push_subscriptions").select("endpoint").eq("endpoint", es[6])).data.length, 1); assert.equal((await u.c.from("push_subscriptions").select("endpoint").eq("endpoint", es[6])).data.length, 0, "saiu da conta anterior");
});
t("push: a configuração interna (chave privada de push) e a marca 'notificada' são inacessíveis para contas comuns", async () => {
  assert.ok((await a.c.from("push_config").select("*")).error, "logado não lê"); assert.ok((await anon.from("push_config").select("*")).error, "anônimo não lê");
  assert.ok((await a.c.from("push_config").insert({ chave: "vapid_private_jwk", valor: "x" })).error, "não escreve");
  assert.ok((await a.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), notificada: true })).error, "não marca como já avisada");
  assert.ok((await b.c.from("messages").update({ notificada: true }).eq("id", mid)).error, "não atualiza 'notificada'");
});
t("push: o remetente pode marcar avisar=false (mensagens invisíveis) e o padrão é avisar", async () => {
  const quieta = await a.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), avisar: false }).select("avisar").single(); assert.ifError(quieta.error); assert.equal(quieta.data.avisar, false);
  const normal = await a.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr() }).select("avisar").single(); assert.equal(normal.data.avisar, true);
});

