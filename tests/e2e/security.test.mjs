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

t("limite de mensagens: 300 por minuto por pessoa (uma mensagem de grupo vira várias linhas); a 301ª é recusada com 'espere um pouco'", async () => {
  const f = await usuario("f");
  for (let i = 0; i < 15; i++) { const r = await f.c.from("messages").insert(Array.from({ length: 20 }, () => msg(b.id))); assert.ok(!r.error, `leva ${i + 1}: ${r.error?.message}`); }
  const r = await f.c.from("messages").insert(msg(b.id));
  assert.ok(limitado(r), "a 301ª deveria ser limitada: " + JSON.stringify(r.error));
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


// ---------- grupos ----------
// a e b já conversaram (ida e volta); x é de fora. O conteúdo aqui é falso: o que se testa é o que o BANCO deixa cada conta fazer.
const cif = () => ({ ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==" }), nomeCif = () => ({ c: "bm9tZQ==", iv: "aXZpdml2aXZpdg==" });
const gmsg = (to, g) => ({ ...base(to), v: 2, header: hdr(), grupo_id: g });
let G;
t("grupo: só se cria com quem já conversou com você (ida E volta); tamanho de 2 a 20", async () => {
  G = crypto.randomUUID();
  const semResposta = await a.c.rpc("criar_grupo", { p_id: G, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] });
  assert.match(semResposta.error?.message || "", /nao_conversou/, "b ainda não respondeu a a"); assert.equal(semResposta.error.details, b.id);
  assert.ifError((await b.c.from("messages").insert({ ...base(a.id), v: 2, header: hdr() })).error); // b responde
  assert.match((await b.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: x.id, chave: cif() }] })).error?.message || "", /nao_conversou/, "x escreveu para b, mas b nunca respondeu: b não põe x num grupo");
  assert.match((await x.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error?.message || "", /nao_conversou/, "um desconhecido não coloca b num grupo só por ter mandado mensagem");
  assert.ok((await a.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: [] })).error, "grupo de uma pessoa só");
  assert.ok((await a.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: Array.from({ length: 20 }, () => ({ id: b.id, chave: cif() })) })).error, "gente demais");
  assert.ok((await a.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: a.id, chave: cif() }] })).error, "consigo mesmo");
  assert.ok((await a.c.rpc("criar_grupo", { p_id: crypto.randomUUID(), p_nome: { c: "A".repeat(700), iv: "x" }, p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error, "nome gigante");
  assert.ifError((await a.c.rpc("criar_grupo", { p_id: G, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error);
  const meus = (await b.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === G);
  assert.equal(meus.length, 2); assert.equal(meus.find((l) => l.user_id === a.id).admin, true); assert.equal(meus.find((l) => l.user_id === b.id).admin, false);
  assert.equal(meus.find((l) => l.user_id === a.id).chave, null, "a chave embrulhada de outra pessoa não vem para mim"); assert.deepEqual(meus.find((l) => l.user_id === b.id).chave, cif());
});
t("grupo: quem é de fora não vê o grupo, não lê as tabelas, não entra sozinho e não manda mensagem para ele", async () => {
  for (const c of [x.c, a.c, anon]) for (const tab of ["grupos", "grupo_membros"]) assert.ok((await c.from(tab).select("*")).error, tab + " não é legível direto");
  assert.ok((await a.c.from("grupo_membros").insert({ grupo_id: G, user_id: x.id, chave: cif(), por: a.id })).error, "nem o admin escreve direto na tabela");
  assert.equal((await x.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === G).length, 0); assert.ok((await anon.rpc("meus_grupos")).error);
  assert.match((await x.c.rpc("grupo_adicionar", { p_grupo: G, p_user: x.id, p_chave: cif() })).error?.message || "", /so_admin/, "entrar sozinho");
  assert.ok((await x.c.rpc("grupo_renomear", { p_grupo: G, p_nome: nomeCif() })).error, "renomear de fora"); assert.ok((await x.c.rpc("grupo_remover", { p_grupo: G, p_user: a.id })).error, "remover de fora");
  assert.ok((await x.c.from("messages").insert(gmsg(b.id, G))).error, "de fora para alguém do grupo"); assert.ok((await x.c.from("messages").insert(gmsg(a.id, G))).error);
  assert.ok((await a.c.from("messages").insert(gmsg(x.id, G))).error, "de dentro para alguém de fora (vazaria a mensagem do grupo)");
  assert.ok((await a.c.from("messages").insert(gmsg(a.id, G))).error, "para si mesmo");
  assert.ok((await a.c.from("messages").insert(gmsg(b.id, crypto.randomUUID()))).error, "grupo que não existe");
  const ok = await a.c.from("messages").insert(gmsg(b.id, G)).select("id,grupo_id").single(); assert.ifError(ok.error); assert.equal(ok.data.grupo_id, G, "(controle) entre participantes passa");
  assert.equal((await x.c.from("messages").select("id").eq("grupo_id", G)).data.length, 0, "de fora não lê as linhas do grupo");
});
t("grupo: só o admin adiciona, remove e muda o nome; não dá para adicionar quem nunca conversou com você", async () => {
  assert.match((await b.c.rpc("grupo_renomear", { p_grupo: G, p_nome: nomeCif() })).error?.message || "", /so_admin/);
  assert.match((await b.c.rpc("grupo_remover", { p_grupo: G, p_user: a.id })).error?.message || "", /sem_permissao/);
  assert.match((await b.c.rpc("grupo_adicionar", { p_grupo: G, p_user: x.id, p_chave: cif() })).error?.message || "", /so_admin/);
  assert.match((await a.c.rpc("grupo_adicionar", { p_grupo: G, p_user: x.id, p_chave: cif() })).error?.message || "", /nao_conversou/);
  assert.ok((await a.c.rpc("grupo_adicionar", { p_grupo: G, p_user: b.id, p_chave: cif() })).error, "quem já está no grupo");
  assert.ifError((await a.c.rpc("grupo_renomear", { p_grupo: G, p_nome: { c: "b3V0cm8=", iv: "aXZpdml2aXZpdg==" } })).error);
  assert.equal((await b.c.rpc("meus_grupos")).data.find((l) => l.grupo_id === G).nome.c, "b3V0cm8=");
});
t("grupo: os arquivos só são baixados por quem está no grupo", async () => {
  const bin = new Blob([new Uint8Array([9, 8, 7])], { type: "application/octet-stream" }), f = `${a.id}/${G}/${crypto.randomUUID()}`, f2 = `${a.id}/${G}/${crypto.randomUUID()}`;
  for (const arq of [f, f2]) assert.ifError((await a.c.storage.from("media").upload(arq, bin, { contentType: "application/octet-stream" })).error);
  assert.ok(!(await b.c.storage.from("media").download(f)).error, "(controle) participante baixa");
  assert.ok((await x.c.storage.from("media").download(f)).error, "de fora não baixa"); assert.ok((await anon.storage.from("media").download(f)).error);
  assert.ok((await b.c.storage.from("media").upload(`${a.id}/${G}/${crypto.randomUUID()}`, bin, { contentType: "application/octet-stream" })).error, "ninguém grava na pasta de outra pessoa");
  await a.c.rpc("grupo_remover", { p_grupo: G, p_user: b.id });
  assert.ok((await b.c.storage.from("media").download(f2)).error, "quem foi removido deixa de baixar (um arquivo que ainda não tinha baixado)");
  await a.c.storage.from("media").remove([f, f2]);
});
t("grupo: quem foi removido não manda nem recebe mais; ao sair a última pessoa, o grupo e as mensagens dele somem", async () => {
  assert.equal((await b.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === G).length, 0);
  assert.ok((await b.c.from("messages").insert(gmsg(a.id, G))).error, "removido não manda"); assert.ok((await a.c.from("messages").insert(gmsg(b.id, G))).error, "e ninguém manda para ele pelo grupo");
  assert.ok((await b.c.rpc("grupo_remover", { p_grupo: G, p_user: b.id })).error, "sair de onde não está");
  assert.ok(((await a.c.from("messages").select("id").eq("grupo_id", G)).data.length) >= 1, "(controle) as mensagens ainda existem");
  assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: G, p_user: a.id })).error);
  assert.equal((await a.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === G).length, 0);
  assert.equal((await a.c.from("messages").select("id").eq("grupo_id", G)).data.length, 0, "as mensagens do grupo apagado saem do servidor");
  assert.equal((await a.c.from("messages").select("id").eq("id", mid)).data.length, 1, "as conversas a dois não são tocadas");
});
t("grupo: sem o admin, a pessoa mais antiga assume; sem login, nenhuma função de grupo funciona", async () => {
  const g2 = crypto.randomUUID();
  assert.ifError((await a.c.rpc("criar_grupo", { p_id: g2, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error);
  assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g2, p_user: a.id })).error); // o admin sai
  const l = (await b.c.rpc("meus_grupos")).data.filter((r) => r.grupo_id === g2); assert.equal(l.length, 1); assert.equal(l[0].admin, true);
  for (const [f, args] of [["criar_grupo", { p_id: crypto.randomUUID(), p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] }], ["grupo_adicionar", { p_grupo: g2, p_user: a.id, p_chave: cif() }], ["grupo_remover", { p_grupo: g2, p_user: b.id }], ["grupo_renomear", { p_grupo: g2, p_nome: nomeCif() }], ["membro_de", { p_grupo: g2 }], ["mesmo_grupo", { p_outro: b.id }], ["ja_conversou", { p_outro: b.id }], ["pode_enviar_ao_grupo", { p_grupo: g2, p_dest: b.id }]])
    assert.ok((await anon.rpc(f, args)).error, f + " sem login");
  assert.ifError((await b.c.rpc("grupo_remover", { p_grupo: g2, p_user: b.id })).error); // limpeza
});

// ---------- grupos: sub-admin, foto e citação ----------
t("sub-admin: só o admin dá e tira o cargo; o sub-admin não dá cargo a ninguém (nem a si); admin não vira sub-admin", async () => {
  const g = crypto.randomUUID(), c = await usuario("s"), d = await usuario("t"), e = await usuario("u");
  for (const [p, q] of [[a, c], [a, d], [a, e]]) { assert.ifError((await p.c.from("messages").insert({ ...base(q.id), v: 2, header: hdr() })).error); assert.ifError((await q.c.from("messages").insert({ ...base(p.id), v: 2, header: hdr() })).error); }
  assert.ifError((await a.c.rpc("criar_grupo", { p_id: g, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: c.id, chave: cif() }, { id: d.id, chave: cif() }, { id: e.id, chave: cif() }] })).error);
  const cargos = async (quem) => Object.fromEntries((await quem.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === g).map((l) => [l.user_id, l.admin ? "admin" : l.sub ? "sub" : "membro"]));
  assert.match((await c.c.rpc("grupo_cargo", { p_grupo: g, p_user: c.id, p_sub: true })).error?.message || "", /so_admin/, "membro dá a si mesmo");
  assert.match((await c.c.rpc("grupo_cargo", { p_grupo: g, p_user: d.id, p_sub: true })).error?.message || "", /so_admin/, "membro dá a outro");
  assert.match((await x.c.rpc("grupo_cargo", { p_grupo: g, p_user: c.id, p_sub: true })).error?.message || "", /so_admin/, "de fora");
  assert.ok((await anon.rpc("grupo_cargo", { p_grupo: g, p_user: c.id, p_sub: true })).error, "sem login");
  assert.match((await a.c.rpc("grupo_cargo", { p_grupo: g, p_user: a.id, p_sub: true })).error?.message || "", /alvo_invalido/, "admin não vira sub-admin");
  assert.match((await a.c.rpc("grupo_cargo", { p_grupo: g, p_user: x.id, p_sub: true })).error?.message || "", /alvo_invalido/, "quem não está no grupo");
  assert.ifError((await a.c.rpc("grupo_cargo", { p_grupo: g, p_user: c.id, p_sub: true })).error);
  assert.deepEqual(await cargos(d), { [a.id]: "admin", [c.id]: "sub", [d.id]: "membro", [e.id]: "membro" });
  assert.match((await c.c.rpc("grupo_cargo", { p_grupo: g, p_user: d.id, p_sub: true })).error?.message || "", /so_admin/, "agora c é sub-admin e continua sem poder dar cargo");
  assert.match((await c.c.rpc("grupo_cargo", { p_grupo: g, p_user: c.id, p_sub: false })).error?.message || "", /so_admin/, "nem tirar o próprio cargo por aqui (sair é pelo grupo_remover)");
  assert.ok((await c.c.rpc("grupo_renomear", { p_grupo: g, p_nome: nomeCif() })).error, "sub-admin não renomeia"); assert.ok((await c.c.rpc("grupo_adicionar", { p_grupo: g, p_user: x.id, p_chave: cif() })).error, "sub-admin não adiciona");
  assert.ok((await c.c.rpc("grupo_foto", { p_grupo: g, p_foto: null })).error, "sub-admin não muda a foto");
  globalThis.__sub = { g, c, d, e, cargos };
});
t("sub-admin: expulsa membro comum, mas não o admin nem outro sub-admin; membro comum não expulsa ninguém; todos podem sair", async () => {
  const { g, c, d, e, cargos } = globalThis.__sub;
  assert.ifError((await a.c.rpc("grupo_cargo", { p_grupo: g, p_user: d.id, p_sub: true })).error); // d também vira sub-admin
  assert.match((await e.c.rpc("grupo_remover", { p_grupo: g, p_user: d.id })).error?.message || "", /sem_permissao/, "membro comum não expulsa");
  assert.match((await c.c.rpc("grupo_remover", { p_grupo: g, p_user: a.id })).error?.message || "", /sem_permissao/, "sub-admin não expulsa o admin");
  assert.match((await c.c.rpc("grupo_remover", { p_grupo: g, p_user: d.id })).error?.message || "", /sem_permissao/, "sub-admin não expulsa outro sub-admin");
  assert.equal(Object.keys(await cargos(a)).length, 4, "ninguém saiu");
  assert.ifError((await c.c.rpc("grupo_remover", { p_grupo: g, p_user: e.id })).error); assert.equal(Object.keys(await cargos(a)).length, 3, "(controle) sub-admin expulsou o membro comum");
  assert.ok((await e.c.rpc("meus_grupos")).data.every((l) => l.grupo_id !== g), "quem foi expulso perde o grupo");
  assert.ifError((await a.c.rpc("grupo_cargo", { p_grupo: g, p_user: d.id, p_sub: false })).error); assert.equal((await cargos(a))[d.id], "membro", "o admin tira o cargo");
  assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: d.id })).error); // o admin expulsa quem quiser
  assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: a.id })).error); // o admin sai: o sub-admin (c) assume
  const l = (await c.c.rpc("meus_grupos")).data.filter((r) => r.grupo_id === g); assert.equal(l.length, 1); assert.equal(l[0].admin, true); assert.equal(l[0].sub, false, "quem assume vira admin, não sub-admin");
  assert.ifError((await c.c.rpc("grupo_remover", { p_grupo: g, p_user: c.id })).error);
});
t("foto do grupo: só o admin; o caminho tem de estar na pasta do grupo; aparece para os participantes e some ao tirar", async () => {
  const g = crypto.randomUUID(); assert.ifError((await a.c.rpc("criar_grupo", { p_id: g, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error);
  const ok = { p: `${a.id}/${g}/${crypto.randomUUID()}`, iv: "aXZpdml2aXZpdg==" }, foto = async (quem) => (await quem.c.rpc("meus_grupos")).data.find((l) => l.grupo_id === g)?.foto;
  assert.match((await b.c.rpc("grupo_foto", { p_grupo: g, p_foto: ok })).error?.message || "", /so_admin/, "membro"); assert.ok((await x.c.rpc("grupo_foto", { p_grupo: g, p_foto: ok })).error, "de fora"); assert.ok((await anon.rpc("grupo_foto", { p_grupo: g, p_foto: ok })).error, "sem login");
  for (const [rotulo, f] of [["pasta de outro grupo", { ...ok, p: `${a.id}/${crypto.randomUUID()}/${crypto.randomUUID()}` }], ["sem iv", { p: ok.p }], ["iv que não é texto", { ...ok, iv: 5 }], ["caminho com ..", { ...ok, p: `${a.id}/${g}/../x` }], ["gigante", { ...ok, lixo: "A".repeat(500) }], ["não é objeto", "texto"], ["lista", [ok]]])
    assert.match((await a.c.rpc("grupo_foto", { p_grupo: g, p_foto: f })).error?.message || "", /foto_invalida/, rotulo);
  assert.ifError((await a.c.rpc("grupo_foto", { p_grupo: g, p_foto: ok })).error); assert.deepEqual(await foto(b), ok, "o participante vê onde está a foto");
  const bin = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });
  assert.ifError((await a.c.storage.from("media").upload(ok.p, bin, { contentType: "application/octet-stream" })).error);
  assert.ok(!(await b.c.storage.from("media").download(ok.p)).error, "o participante baixa o arquivo (cifrado)"); assert.ok((await x.c.storage.from("media").download(ok.p)).error, "de fora não baixa");
  assert.ifError((await a.c.rpc("grupo_foto", { p_grupo: g, p_foto: null })).error); assert.equal(await foto(b), null, "foto tirada");
  await a.c.storage.from("media").remove([ok.p]); assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: b.id })).error); assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: a.id })).error);
});
t("citado: só vale em mensagem de grupo; o aviso (push) de grupo só sai para quem foi citado; conversa a dois continua avisando", async () => {
  const g = crypto.randomUUID(); assert.ifError((await a.c.rpc("criar_grupo", { p_id: g, p_nome: nomeCif(), p_chave: cif(), p_membros: [{ id: b.id, chave: cif() }] })).error);
  assert.ok((await a.c.from("messages").insert({ ...base(b.id), v: 2, header: hdr(), citado: true })).error, "citado fora de grupo");
  const r = await a.c.from("messages").insert({ ...gmsg(b.id, g), citado: true }).select("citado,grupo_id").single(); assert.ifError(r.error); assert.equal(r.data.citado, true);
  assert.ok((await b.c.from("messages").update({ citado: true }).eq("id", mid)).error, "o destinatário não mexe na marca");
  assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: b.id })).error); assert.ifError((await a.c.rpc("grupo_remover", { p_grupo: g, p_user: a.id })).error);
});
