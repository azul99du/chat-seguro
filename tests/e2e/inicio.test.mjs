// Abertura do site: quem já estava logado vai direto para as conversas (sem piscar o login); sessão derrubada cai no login; conversa abre já no fim.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, ctx, A, B, emailA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const PRONTO = "#chat:not([hidden]):not(.preparando)";
// vigia, antes de o site rodar, se a tela de login chegou a aparecer
const vigiaLogin = `document.addEventListener("DOMContentLoaded", () => { const a = document.getElementById("auth"); if (!a) return; window.__loginVisto = !a.hidden; new MutationObserver(() => { if (!a.hidden) window.__loginVisto = true; }).observe(a, { attributes: true }); });`;
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }); await ctx.addInitScript(vigiaLogin); A = await ctx.newPage(); A.on("pageerror", (e) => erros.push(e.message));
  B = await (await browser.newContext()).newPage(); emailA = novoEmail(); nomeB = novoUsuario("b");
  await A.goto(srv.url); await A.click("#tab-signup"); await A.fill("#username", novoUsuario("a")); await A.fill("#email", emailA); await A.fill("#password", SENHA); await A.click("#auth-submit");
  await A.waitForSelector("#ask[open]", { timeout: 30000 }); await A.fill("#ask-input", FRASE); await A.click("#ask button[value=ok]"); await A.waitForSelector(PRONTO, { timeout: 30000 });
  await B.goto(srv.url); await B.click("#tab-signup"); await B.fill("#username", nomeB); await B.fill("#email", novoEmail()); await B.fill("#password", SENHA); await B.click("#auth-submit");
  await B.waitForSelector("#ask[open]", { timeout: 30000 }); await B.fill("#ask-input", FRASE); await B.click("#ask button[value=ok]"); await B.waitForSelector(PRONTO, { timeout: 30000 });
  await chamar(A, nomeB); await A.waitForSelector("#send-form:not([hidden])");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("já logado: ao atualizar o site vai direto para as conversas, sem a tela de login aparecer nem por um instante", async () => {
  await A.reload(); await A.waitForSelector(PRONTO, { timeout: 30000 });
  assert.equal(await A.evaluate(() => window.__loginVisto), false, "a tela de login não pode piscar");
  assert.equal(await A.locator("#abrindo").isHidden(), true); assert.equal(await A.locator("#auth").isHidden(), true);
});
t("enquanto abre: tela de abertura (sem login), e as conversas já aparecem antes de tudo estar pronto", async () => {
  await A.goto("about:blank"); await A.goto(srv.url, { waitUntil: "commit" });
  await A.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); // a estrutura aparece primeiro...
  assert.equal(await A.evaluate(() => window.__loginVisto), false); await A.waitForSelector(PRONTO, { timeout: 30000 }); // ...e só aceita toques quando está tudo pronto
});
t("nome do usuário aparece logo (guardado do último acesso)", async () => {
  await A.reload(); await A.waitForSelector("#chat:not([hidden])"); assert.match(await A.locator("#nome-txt").textContent(), /^@a/); assert.match(await A.locator("#eu-foto").innerText(), /^[A-Z0-9]$/i);
});
t("sessão derrubada em outro aparelho (ex.: senha trocada): ao abrir, cai no login", async () => {
  const c1 = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ifError((await c1.auth.signInWithPassword({ email: emailA, password: SENHA })).error); assert.ifError((await c1.auth.signOut({ scope: "others" })).error); // derruba as outras sessões
  await A.reload(); await A.waitForSelector("#auth:not([hidden])", { timeout: 30000 }); assert.equal(await A.locator("#chat").isHidden(), true);
});
t("sem sessão: abre direto no login", async () => {
  const c = await browser.newContext(); await c.addInitScript(vigiaLogin); const P = await c.newPage(); await P.goto(srv.url); await P.waitForSelector("#auth:not([hidden])", { timeout: 15000 });
  assert.equal(await P.locator("#abrindo").isHidden(), true); assert.equal(await P.locator("#chat").isHidden(), true); await c.close();
});
t("sem erros de script", () => assert.deepEqual(erros, []));
