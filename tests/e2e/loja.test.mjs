// Loja de Selos: preços do admin, título ao lado do nome, mensagem em destaque, silenciar (vale contra admin), avisos ao grupo e travas do banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const fundo = (p, sel) => p.locator(sel).first().evaluate((e) => getComputedStyle(e.querySelector(".bubble")).backgroundColor);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
const cif = () => ({ ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==" }), baseMsg = (to) => ({ recipient_id: to, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: { sid: hex(), dh: { x: "x", y: "y" }, pn: 0, n: 0 } });
async function apiUser(tag) { // conta "de mentira" só pela API: chaves válidas, para o navegador conseguir conversar com ela
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag), pk = await jwk(); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: pk })).error); assert.ifError((await c.from("prekeys").insert({ id: hex(), public_key: await jwk() })).error);
  return { c, id: data.user.id, nome };
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B] = [await novo("A"), await novo("B")]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis:text-is('oi a')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Loja"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Loja")', { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector('#conv-title:text-is("Loja")'); await B.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });
const rpc = (p, fn, args) => p.evaluate(async ([f, a]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), gid = (await sb.rpc("meus_grupos")).data[0].grupo_id; const r = await sb.rpc(f, { p_grupo: gid, ...a }); return { code: r.error?.code || null, msg: r.error?.message || null, data: r.data }; }, [fn, args]);
const abrirSelos = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); await p.click("#gi-selos"); await p.waitForSelector("#selos[open]"); await p.waitForSelector("#sl-regras li", { timeout: 30000 }); };
const chip = (p, titulo, n = 0) => p.locator(`#sr-cards .sr-card:has(b:text-is("${titulo}")) .sr-n`).nth(n);
const chave = (p, titulo) => p.locator(`#sr-cards button.sr-sw[aria-label="${titulo}"]`);
const mudar = async (p, titulo, n, valor) => { await chip(p, titulo, n).click(); await p.waitForSelector("#selos-num[open]"); await p.fill("#sn-valor", String(valor)); await p.click("#sn-ok"); await p.waitForFunction(() => !document.querySelector("#selos-num").open); };

const uid = (p) => p.evaluate(async () => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"); return (await createClient(SUPABASE_URL, SUPABASE_KEY).auth.getUser()).data.user.id; });
const sair = async (p) => { await p.click("#selos .pg-volta"); await p.click("#grupo-info .pg-volta"); };
const cartao = (p, item) => p.locator(`#sl-loja .lj-cartao[data-item="${item}"]`);

t("o admin liga a loja e põe os preços (itens começam desligados); o saldo vem da regra de entrada", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]");
  assert.equal(await A.locator("#sr-loja .sr-card").count(), 4); assert.equal(await A.locator("#sr-loja .sr-n").count(), 0, "tudo desligado");
  await chave(A, "Entrar no grupo").click(); await mudar(A, "Entrar no grupo", 0, 200);
  for (const nome of ["Título ao lado do nome", "Mensagem em destaque", "Silenciar um membro"]) await A.locator(`#sr-loja button.sr-sw[aria-label="${nome}"]`).click();
  assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Silenciar um membro")) .sr-frase').innerText(), /Custa 80 Selos/);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 });
  await A.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "200", null, { timeout: 30000 });
  assert.equal(await A.locator("#sl-loja .lj-cartao").count(), 4); assert.equal(await cartao(A, "titulo").locator(".lj-bt").isDisabled(), false);
  await sair(A);
});
t("comprar um título: aparece ao lado do nome para todos, o grupo é avisado e o saldo cai", async () => {
  await abrirSelos(A); await cartao(A, "titulo").locator(".lj-bt").click(); await A.waitForSelector("#loja-folha[open] .lf-titulos button", { timeout: 30000 });
  assert.equal(await A.locator("#lf-ok").isDisabled(), true, "sem escolher não compra"); await A.click('#lf-corpo button[data-t="t01"]');
  assert.match(await A.locator("#lf-depois").innerText(), /200 → 150/); await A.click("#lf-ok"); await A.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await A.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "150", null, { timeout: 30000 });
  assert.match(await cartao(A, "titulo").innerText(), /Seu título agora: Lenda/); await sair(A);
  await A.waitForSelector('#messages .aviso-linha:has-text("Você comprou o título “Lenda”")', { timeout: 30000 });
  await B.waitForSelector(`#messages .aviso-linha:has-text("@${nomeA} comprou o título “Lenda”")`, { timeout: 30000 });
  await enviar(A, "oi com título"); await B.waitForSelector(".msg.grupo-msg:has(.vis:text-is('oi com título')) .autor .titulo-loja:text-is('Lenda')", { timeout: 30000 });
});
t("mensagem em destaque: borda dourada para todos; só a própria mensagem, uma vez", async () => {
  await enviar(A, "esta é importante"); await B.waitForSelector(".msg.grupo-msg:has(.vis:text-is('esta é importante'))", { timeout: 30000 });
  await A.waitForSelector(".msg.mine:has(.vis:text-is('esta é importante'))"); await A.locator(".msg.mine:has(.vis:text-is('esta é importante')) .bubble").click({ button: "right" });
  await A.click(".picker .destacar"); await A.waitForSelector("#loja-folha[open]"); await A.waitForFunction(() => !document.querySelector("#lf-ok").disabled, null, { timeout: 30000 });
  assert.match(await A.locator("#lf-depois").innerText(), /150 → 120/); await A.click("#lf-ok"); await A.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await A.waitForSelector(".msg.destaque-loja .selo-destaque", { timeout: 30000 });
  await B.waitForSelector(".msg.grupo-msg.destaque-loja:has(.vis:text-is('esta é importante'))", { timeout: 30000 });
  assert.equal(await B.locator(".msg.destaque-loja").count(), 1, "só uma mensagem em destaque");
  await B.waitForSelector(`#messages .aviso-linha:has-text("@${nomeA} destacou uma mensagem")`, { timeout: 30000 });
  await A.locator(".msg.mine:has(.vis:text-is('esta é importante')) .bubble").click({ button: "right" }); assert.equal(await A.locator(".picker .destacar").count(), 0, "já está em destaque"); await A.keyboard.press("Escape");
});
t("silenciar vale contra qualquer um (até o admin): o campo some, o servidor recusa, e volta sozinho", async () => {
  await abrirSelos(B); await cartao(B, "silenciar").locator(".lj-bt").click(); await B.waitForSelector("#loja-folha[open] .lf-pessoa", { timeout: 30000 });
  assert.equal(await B.locator("#lf-corpo .lf-pessoa").count(), 1, "só os outros membros"); assert.equal(await B.locator("#lf-ok").isDisabled(), true);
  await B.click("#lf-corpo .lf-pessoa"); assert.match(await B.locator("#lf-depois").innerText(), /200 → 120/); await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await A.waitForSelector("#send-form.silenciado #silencio-aviso:not([hidden])", { timeout: 30000 }); assert.match(await A.locator("#silencio-aviso").innerText(), /silenciado neste grupo até/);
  assert.equal(await A.locator("#text").isVisible(), false, "o campo de escrever some");
  await A.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} silenciou você")`, { timeout: 30000 }); await B.waitForSelector(`#messages .aviso-linha:has-text("Você silenciou @${nomeA}")`, { timeout: 30000 });
  assert.equal((await rpc(B, "selo_comprar", { p_item: "silenciar", p_alvo: await uid(A) })).msg, "ja_silenciado", "não dá para silenciar quem já está silenciado");
  await A.waitForSelector("#send-form:not(.silenciado)", { timeout: 40000 }); assert.equal(await A.locator("#text").isVisible(), true, "passou o tempo: volta a escrever");
  await enviar(A, "voltei"); await B.waitForSelector(".msg.grupo-msg .vis:text-is('voltei')", { timeout: 30000 });
  await sair(B);
});
t("travas do banco: saldo, itens, alvos, títulos e destaques inválidos, silêncio no envio, de fora e contas internas", async () => {
  const a = await uid(A), b = await uid(B), mid = hex();
  assert.equal((await rpc(B, "selo_comprar", { p_item: "titulo", p_detalhe: "t13" })).code, "22023", "título fora da lista");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "titulo", p_detalhe: "Lenda" })).code, "22023", "só id da lista, nunca texto");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "silenciar", p_alvo: b })).msg, "si_mesmo", "não silencia a si mesmo");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "brinde" })).code, "22023");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "destaque", p_detalhe: "nao-e-mid" })).code, "22023");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "titulo", p_detalhe: "t02" })).code, null, "B compra um título (50)"); // 120 → 70
  assert.equal((await rpc(B, "selo_comprar", { p_item: "silenciar", p_alvo: a })).msg, "saldo_insuficiente", "70 Selos não pagam um silêncio de 80");
  assert.equal((await rpc(B, "selo_comprar", { p_item: "destaque", p_detalhe: mid })).code, null, "B paga um destaque (30)"); // 70 → 40
  assert.equal((await rpc(A, "selo_comprar", { p_item: "destaque", p_detalhe: mid })).msg, "ja_destacada", "o mesmo destaque não se compra duas vezes");
  const x = await apiUser("x"), g = hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  assert.equal((await x.c.rpc("selo_comprar", { p_grupo: g, p_item: "titulo", p_detalhe: "t01" })).error?.code, "42501", "de fora não compra");
  assert.equal((await x.c.rpc("selo_loja_estado", { p_grupo: g })).data?.length || 0, 0, "de fora não vê a loja");
  assert.ok((await x.c.from("selo_compras").select("*")).error, "tabela das compras fechada para leitura"); assert.ok((await x.c.from("selo_compras").insert({ grupo_id: g, user_id: x.id, item: "titulo", preco: 1 })).error, "e para escrita");
  assert.ok((await x.c.rpc("silencio_duracao")).error, "duração é interna"); assert.ok((await x.c.rpc("bloqueia_silenciado")).error, "gatilho não se chama");
  const est = await rpc(A, "selo_loja_estado", {}); assert.ok(est.data.some((c) => c.item === "titulo" && c.detalhe === "t01") && est.data.some((c) => c.item === "silenciar"), "os membros veem as compras do grupo");
  const gj = await rpc(B, "selo_regras_ver", {}); assert.equal(gj.data[0].regras.loja_silenciar.on, true);
  assert.equal((await rpc(B, "selo_regras_mudar", { p_regras: { ...gj.data[0].regras, loja_titulo: { on: true, valor: 1000 } } })).code, "42501", "membro não muda preços");
  assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...gj.data[0].regras, loja_titulo: { on: true, valor: 1000 } } })).code, "22023", "preço máximo 999");
  assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { entrada: { on: true, valor: 200 } } })).code, null, "regras sem a loja não apagam os preços (site antigo)");
  assert.equal((await rpc(B, "selo_regras_ver", {})).data[0].regras.loja_silenciar.valor, 80, "os preços continuam");
});
t("silêncio no servidor: quem está silenciado não consegue inserir mensagem no grupo, nem por fora do app", async () => {
  await B.reload(); await pronto(B); await B.click("#contacts button[data-grupo]"); await B.waitForSelector('#conv-title:text-is("Loja")'); await B.waitForSelector("#messages:not(.carregando)");
  // A (dono de 200 − 50 − 30 = 120 Selos) silencia B e tenta enviar pelo servidor: o gatilho recusa
  assert.equal((await rpc(A, "selo_comprar", { p_item: "silenciar", p_alvo: await uid(B) })).code, null);
  const r = await A.evaluate(async ([alvo]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), gid = (await sb.rpc("meus_grupos")).data[0].grupo_id; return { gid, alvo }; }, [await uid(B)]);
  const tentar = await B.evaluate(async ([gid, a]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY); const e = await sb.from("messages").insert({ recipient_id: a, grupo_id: gid, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: { sid: "s", dh: { x: "x", y: "y" }, pn: 0, n: 0 }, avisar: true }); return e.error?.message || null; }, [r.gid, await uid(A)]);
  assert.match(String(tentar), /silenciado|header|violates|policy/i, "o envio não passa"); assert.match(String(tentar), /silenciado/, "e o motivo é o silêncio");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
