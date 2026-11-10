// Chave local x chave do servidor: se divergirem, o app não abre as conversas; erro de leitura do perfil não gera chave nova.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, email;
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); email = novoEmail();
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
const chaveLocal = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("chat-seguro", 1); r.onsuccess = () => { const q = r.result.transaction("keys").objectStore("keys").getAll(); q.onsuccess = async () => res(JSON.stringify(await crypto.subtle.exportKey("jwk", q.result[0].publicKey))); }; }));

t("cadastro normal funciona", async () => {
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("k")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE + "-comprida"); await P.click("#ask button[value=ok]"); await pronto(P);
});
t("falha ao ler o perfil não gera chave nova nem apaga a local", async () => {
  const antes = await chaveLocal(P);
  await P.route("**/rest/v1/profiles*", (r) => r.abort());
  await P.reload(); await P.waitForSelector("#auth:not([hidden])", { timeout: 30000 });
  await P.unroute("**/rest/v1/profiles*");
  assert.equal(await chaveLocal(P), antes);
});
t("chave local diferente da publicada: bloqueia e não abre as conversas", async () => {
  await P.evaluate(() => new Promise((res) => { const r = indexedDB.open("chat-seguro", 1); r.onsuccess = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const tx = r.result.transaction("keys", "readwrite"), st = tx.objectStore("keys"); const k = st.getAllKeys();
    k.onsuccess = () => { st.put(pair, k.result[0]); tx.oncomplete = () => res(); }; }; }));
  await P.reload();
  await P.waitForFunction(() => /Chave não confere/.test(document.body.innerText), null, { timeout: 30000 });
  assert.equal(await P.locator("#chat.preparando").count(), 1); // as conversas nunca ficaram liberadas
});
