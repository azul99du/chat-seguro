// Trocar a senha de login: valida a atual, exige 12+ e confirmação, derruba outros aparelhos e respeita a verificação em dois passos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";
import { totp } from "../helpers/totp.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, email, outra; const NOVA = "uma-senha-nova-bem-longa";
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const cliente = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); email = novoEmail();
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });
const digitar = async (p, txt) => { await p.fill("#ask-input", txt); await p.click("#ask button[value=ok]"); };
const dica = (p) => p.locator("#ask-text").innerText();
const msg = (p, re) => p.waitForFunction((r) => new RegExp(r).test(document.getElementById("mfa-msg").textContent), re, { timeout: 20000 });
const abrir = async (p) => { await p.click("#mfa-senha"); await p.waitForSelector("#ask[open]"); };

t("cadastro e outro aparelho já conectado com a senha antiga", async () => {
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("s")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await digitar(P, FRASE); await P.waitForSelector("#chat:not([hidden])", { timeout: 30000 });
  outra = cliente(); const r = await outra.auth.signInWithPassword({ email, password: SENHA }); assert.ok(r.data.session, "outro aparelho entrou");
});
t("senha atual errada: recusa e não pede a nova", async () => {
  await P.click("#sec-btn"); await P.waitForSelector("#mfa[open]"); await abrir(P); await digitar(P, "senha-errada-qualquer");
  await msg(P, "atual está errada"); assert.equal(await P.locator("#ask[open]").count(), 0);
});
t("nova senha curta, igual à atual ou repetitiva é recusada; confirmação diferente não altera nada", async () => {
  await abrir(P); await digitar(P, SENHA); await P.waitForFunction(() => /NOVA senha/.test(document.getElementById("ask-text").textContent));
  await digitar(P, "curta123"); await P.waitForFunction(() => /pelo menos 12/.test(document.getElementById("ask-text").textContent));
  await digitar(P, SENHA); await P.waitForFunction(() => /diferente da atual/.test(document.getElementById("ask-text").textContent));
  await digitar(P, "aaaaaaaaaaaaaaaa"); await P.waitForFunction(() => /repetir/.test(document.getElementById("ask-text").textContent));
  await digitar(P, NOVA); await P.waitForFunction(() => /^Confirme/.test(document.getElementById("ask-title").textContent));
  await digitar(P, NOVA + "x"); await msg(P, "não são iguais");
  const c = cliente(); assert.ok((await c.auth.signInWithPassword({ email, password: SENHA })).data.session, "a senha antiga segue valendo");
  assert.ok((await outra.auth.getUser()).data.user, "o outro aparelho segue conectado");
});
t("troca concluída: nova senha entra, antiga é recusada e o outro aparelho é desconectado", async () => {
  await abrir(P); await digitar(P, SENHA); await P.waitForFunction(() => /NOVA senha/.test(document.getElementById("ask-text").textContent));
  await digitar(P, NOVA); await P.waitForFunction(() => /^Confirme/.test(document.getElementById("ask-title").textContent));
  await digitar(P, NOVA); await msg(P, "Senha trocada");
  assert.match(await P.locator("#mfa-msg").getAttribute("class") || "", /ok/);
  const velha = await cliente().auth.signInWithPassword({ email, password: SENHA }); assert.ok(velha.error, "senha antiga recusada");
  assert.ok((await cliente().auth.signInWithPassword({ email, password: NOVA })).data.session, "senha nova aceita");
  const r = await outra.auth.refreshSession(); assert.ok(r.error || !r.data.session, "sessão do outro aparelho foi revogada");
  await P.click("#mfa button[value=cancel]"); assert.equal(await P.locator("#chat").isVisible(), true, "este aparelho continua conectado");
});
t("aparelho novo entra com a senha nova (e a frase-senha de sempre)", async () => {
  const c = await browser.newContext(), N = await c.newPage(); await N.goto(srv.url); await N.fill("#email", email); await N.fill("#password", NOVA); await N.click("#auth-submit");
  await N.waitForSelector("#ask[open]", { timeout: 30000 }); await digitar(N, FRASE); await N.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); await c.close();
});
t("com 2 passos ativos: sessão só com senha não troca a senha; com o código troca", async () => {
  const em = novoEmail(), c = cliente(); assert.ok((await c.auth.signUp({ email: em, password: SENHA })).data.session);
  const en = await c.auth.mfa.enroll({ factorType: "totp" }); assert.ifError(en.error);
  const ch = await c.auth.mfa.challenge({ factorId: en.data.id }); const v = await c.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: totp(en.data.totp.secret) }); assert.ifError(v.error);
  const so = cliente(); await so.auth.signInWithPassword({ email: em, password: SENHA });
  const r1 = await so.auth.updateUser({ password: NOVA }); assert.ok(r1.error, "aal1 recusado"); assert.equal(r1.error.code, "insufficient_aal");
  assert.ok((await cliente().auth.signInWithPassword({ email: em, password: SENHA })).data.session, "senha não mudou");
  const ch2 = await so.auth.mfa.challenge({ factorId: en.data.id }); const v2 = await so.auth.mfa.verify({ factorId: en.data.id, challengeId: ch2.data.id, code: totp(en.data.totp.secret, Date.now() + 30000) }); assert.ifError(v2.error);
  assert.ifError((await so.auth.updateUser({ password: NOVA })).error);
  assert.ok((await cliente().auth.signInWithPassword({ email: em, password: NOVA })).data.session);
});
