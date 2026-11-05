// Guarda de entrada: navegadores embutidos (Instagram etc.) e molduras são bloqueados ANTES do app carregar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir } from "./env.mjs";

let browser, srv; const skip = configurado ? false : motivoSemConfig;
const t = (nome, fn) => test(nome, { timeout: 60000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
before(async () => { if (skip) return; srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); });
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

const UAS = {
  "Instagram no Android (o do log real)": "Mozilla/5.0 (Linux; Android 14; moto g53 5G Build/U1TPS34.29-83-7-3-10-1-7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.31 Mobile Safari/537.36 Instagram 454.0.0.54.77 Android (34/14; 238dpi; 720x1600; motorola; moto g53 5G; penang; qcom; pt_BR; 1105698528; IABMV/1)",
  "Instagram no iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.35.108 (iPhone14,5; iOS 17_5; pt_BR; pt-BR; scale=3.00; 1170x2532; 551236730)",
  "Facebook no Android": "Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]",
  "Facebook no iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/123;FBDV/iPhone14,5]",
  "TikTok": "Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0 Mobile Safari/537.36 musical_ly_2022",
  "WebView genérica do Android": "Mozilla/5.0 (Linux; Android 11; Redmi Note 9 Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.0.0 Mobile Safari/537.36",
};
const OK = {
  "Chrome no Android (inclui o ícone da tela inicial)": "Mozilla/5.0 (Linux; Android 14; moto g53 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36",
  "Chrome no Windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
  "Safari no iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Firefox": "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
};
const bancos = (p) => p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));

for (const [nome, ua] of Object.entries(UAS)) {
  t(`bloqueia: ${nome}; o login some e nenhum banco local de chaves é criado`, async () => {
    const c = await browser.newContext({ userAgent: ua }), p = await c.newPage(); const erros = []; p.on("pageerror", (e) => erros.push(e.message));
    await p.goto(srv.url); await p.waitForSelector(".bloqueio", { timeout: 15000 });
    assert.match(await p.locator(".bloqueio h1").innerText(), /navegador de verdade/);
    assert.equal(await p.locator("#auth").count(), 0, "a tela de login foi removida"); assert.equal(await p.locator("#password").count(), 0);
    await p.waitForTimeout(800); assert.deepEqual(await bancos(p), [], "app.js nunca rodou: nada foi aberto"); assert.deepEqual(erros, []);
    if (/Android/.test(ua)) assert.match(await p.locator(".bloqueio a.botao").getAttribute("href"), /^intent:\/\/.+package=com\.android\.chrome/);
    await c.close();
  });
}
for (const [nome, ua] of Object.entries(OK)) {
  t(`NÃO bloqueia: ${nome}`, async () => {
    const c = await browser.newContext({ userAgent: ua }), p = await c.newPage();
    await p.goto(srv.url); await p.waitForSelector("#auth:not([hidden]) #password", { timeout: 15000 });
    assert.equal(await p.locator(".bloqueio").count(), 0); await c.close();
  });
}
t("dentro de moldura (iframe de outro site): bloqueia e oferece abrir de verdade", async () => {
  const c = await browser.newContext(), p = await c.newPage();
  await p.setContent(`<iframe id="f" src="${srv.url}" width="500" height="500"></iframe>`);
  const f = await (await p.waitForSelector("#f")).contentFrame(); await f.waitForSelector(".bloqueio", { timeout: 15000 });
  assert.match(await f.locator(".bloqueio h1").innerText(), /não roda dentro de outro site/); assert.equal(await f.locator("#password").count(), 0);
  assert.equal(await f.locator('.bloqueio a[target="_blank"]').count(), 1);
  const abriu = await f.evaluate(async () => { try { return (await indexedDB.databases()).length; } catch { return 0; } }); // o Chrome ainda nega banco em moldura de outro site
  assert.equal(abriu, 0, "nada foi aberto na moldura"); await c.close();
});
