// Verificação em dois passos: no site (QR, código, login, aparelho novo, desativar) e no banco (sessão só com senha trancada).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";
import { totp } from "../helpers/totp.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, ctx, P, email, usuario, segredo, ultimo = "";
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const cliente = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// o app autenticador gera um código novo a cada 30 s; se o atual já foi usado, usamos o do passo seguinte (o servidor aceita ±1 passo)
const codigo = () => { let c = totp(segredo); if (c === ultimo) c = totp(segredo, Date.now() + 30000); ultimo = c; return c; };
const BASE = { kty: "EC", crv: "P-256", x: "x", y: "y" };

before(async () => {
  if (skip) return;
  const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } }); P = await ctx.newPage();
  email = novoEmail(); usuario = novoUsuario("m");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("cadastro e aviso: conta nova sem verificação mostra o convite para ativar", async () => {
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", usuario); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE); await P.click("#ask button[value=ok]");
  await P.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
  await P.waitForSelector("#mfa-nudge:not([hidden])", { timeout: 15000 });
});
t("ativar: QR e chave aparecem; código errado é recusado; código certo ativa e some o convite", async () => {
  await menuConta(P, "#sec-btn"); await P.waitForSelector("#mfa[open]"); await P.click("#mfa-go");
  await P.waitForSelector("#mfa-enroll:not([hidden])"); segredo = (await P.locator("#mfa-secret").innerText()).trim();
  assert.match(segredo, /^[A-Z2-7]{16,}$/, "chave em base32");
  assert.match(await P.locator("#mfa-qr").getAttribute("src"), /^data:image\/svg\+xml/);
  await P.fill("#mfa-code", "000000"); await P.click("#mfa-go");
  await P.waitForFunction(() => /incorreto/i.test(document.getElementById("mfa-msg").textContent), null, { timeout: 15000 });
  await P.fill("#mfa-code", codigo()); await P.click("#mfa-go");
  await P.waitForFunction(() => /ativada/i.test(document.getElementById("mfa-status").textContent), null, { timeout: 20000 });
  assert.equal(await P.locator("#mfa-off").isVisible(), true);
  await P.click("#mfa button[value=cancel]"); await P.waitForSelector("#mfa-nudge", { state: "hidden" });
});
t("recarregar mantém a sessão (já passou pelo 2º passo): não pede código de novo", async () => {
  await P.reload(); await P.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
  assert.equal(await P.locator("#ask[open]").count(), 0);
});
t("novo login: senha certa NÃO basta; código errado é recusado; código certo abre", async () => {
  await menuConta(P, "#logout"); await P.waitForSelector("#choice[open]"); await P.click("#choice button[value=keep]"); await P.waitForSelector("#auth:not([hidden])", { timeout: 15000 });
  await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 });
  assert.match(await P.locator("#ask-title").innerText(), /dois passos/i);
  assert.equal(await P.locator("#chat").isHidden(), true, "o chat não abre antes do código");
  await P.fill("#ask-input", "123456"); await P.click("#ask button[value=ok]");
  await P.waitForFunction(() => /incorreto/i.test(document.getElementById("ask-text").textContent), null, { timeout: 15000 });
  await P.fill("#ask-input", codigo()); await P.click("#ask button[value=ok]");
  await P.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
});
t("cancelar o código volta para o login e não abre o chat", async () => {
  const c2 = await browser.newContext(), Q = await c2.newPage();
  await Q.goto(srv.url); await Q.fill("#email", email); await Q.fill("#password", SENHA); await Q.click("#auth-submit");
  await Q.waitForSelector("#ask[open]", { timeout: 30000 }); await Q.click("#ask button[value=cancel]");
  await Q.waitForSelector("#auth:not([hidden])", { timeout: 15000 }); assert.equal(await Q.locator("#chat").isHidden(), true); await c2.close();
});
t("aparelho novo: primeiro o código do 2º passo, depois a frase-senha da chave", async () => {
  const c3 = await browser.newContext(), N = await c3.newPage();
  await N.goto(srv.url); await N.fill("#email", email); await N.fill("#password", SENHA); await N.click("#auth-submit");
  await N.waitForSelector("#ask[open]", { timeout: 30000 }); assert.match(await N.locator("#ask-title").innerText(), /dois passos/i);
  await N.fill("#ask-input", codigo()); await N.click("#ask button[value=ok]");
  await N.waitForFunction(() => /aparelho novo/i.test(document.getElementById("ask-title").textContent), null, { timeout: 30000 });
  await N.fill("#ask-input", FRASE); await N.click("#ask button[value=ok]"); await N.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await c3.close();
});
t("NO BANCO: sessão só com senha fica trancada (nem sem o site); com o código, libera", async () => {
  const c = cliente(); assert.ok(!(await c.auth.signInWithPassword({ email, password: SENHA })).error);
  const a = (await c.auth.mfa.getAuthenticatorAssuranceLevel()).data; assert.deepEqual([a.currentLevel, a.nextLevel], ["aal1", "aal2"]);
  const me = (await c.auth.getUser()).data.user.id;
  assert.equal((await c.from("profiles").select("*")).data.length, 0, "perfil");
  assert.equal((await c.from("key_backups").select("*")).data.length, 0, "backup da chave");
  assert.ok((await c.from("messages").insert({ recipient_id: me, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: { sid: "a".repeat(32), dh: { x: "x", y: "y" }, pn: 0, n: 0 } })).error, "enviar");
  assert.ok((await c.rpc("find_user", { p_username: usuario })).error, "buscar usuário");
  assert.ok((await c.rpc("get_prekey", { p_user: me })).error, "buscar chave");
  assert.ok((await c.from("prekeys").insert({ id: "a".repeat(32), public_key: BASE })).error, "publicar chave");
  assert.equal((await c.storage.from("media").list(me)).data?.length ?? 0, 0, "arquivos");
  assert.ok((await c.auth.mfa.unenroll({ factorId: (await c.auth.mfa.listFactors()).data.totp[0].id })).error, "desativar exige o 2º passo");
  const f = (await c.auth.mfa.listFactors()).data.totp[0];
  for (let i = 0; i < 2; i++) { const ch = await c.auth.mfa.challenge({ factorId: f.id }); const v = await c.auth.mfa.verify({ factorId: f.id, challengeId: ch.data.id, code: codigo() }); if (!v.error) break; if (!/mismatch/i.test(v.error.message)) assert.fail(v.error.message); }
  assert.equal((await c.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel, "aal2");
  assert.equal((await c.from("profiles").select("*")).data.length, 1, "com o código o perfil aparece");
  assert.ok(!(await c.rpc("find_user", { p_username: usuario })).error, "e a busca funciona");
});
t("desativar: pede confirmação, volta a abrir só com a senha, e o banco libera", async () => {
  await menuConta(P, "#sec-btn"); await P.waitForSelector("#mfa[open]"); await P.click("#mfa-off");
  await P.waitForSelector("#choice[open]"); await P.click("#choice button[value=sim]");
  await P.waitForFunction(() => /desativada/i.test(document.getElementById("mfa-status").textContent), null, { timeout: 20000 });
  await P.click("#mfa button[value=cancel]");
  const c = cliente(); await c.auth.signInWithPassword({ email, password: SENHA });
  assert.equal((await c.auth.mfa.getAuthenticatorAssuranceLevel()).data.nextLevel, "aal1");
  assert.equal((await c.from("profiles").select("*")).data.length, 1, "só com a senha, o banco libera de novo");
});
