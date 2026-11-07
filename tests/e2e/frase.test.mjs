// Frase-senha do backup da chave: mínimo de 16 caracteres, bloqueio de frases repetitivas e troca da frase.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, email; const NOVA = "cinco-palavras-sorteadas-novas";
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); email = novoEmail();
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });
const digitar = async (p, txt) => { await p.fill("#ask-input", txt); await p.click("#ask button[value=ok]"); };
const dica = (p) => p.locator("#ask-text").innerText();

t("cadastro: frases de 12 caracteres, curtas ou repetitivas são recusadas; 16+ variadas passam", async () => {
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("f")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 });
  await digitar(P, "doze-letras1"); await P.waitForFunction(() => /pelo menos 16/.test(document.getElementById("ask-text").textContent)); // 12 caracteres já não basta
  await digitar(P, "aaaaaaaaaaaaaaaaaaaa"); await P.waitForFunction(() => /repetir/.test(document.getElementById("ask-text").textContent));
  await digitar(P, "abababababababababab"); await P.waitForFunction(() => /repetir/.test(document.getElementById("ask-text").textContent)); // só 2 caracteres diferentes
  await digitar(P, FRASE); await P.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
});
t("trocar a frase: valida o tamanho, exige confirmação igual e não altera nada se as duas forem diferentes", async () => {
  await P.click("#sec-btn"); await P.waitForSelector("#mfa[open]"); assert.match(await P.locator("#mfa h2").innerText(), /Segurança da conta/);
  await P.click("#mfa-pass"); await P.waitForSelector("#ask[open]"); assert.match(await dica(P), /NOVA frase-senha/);
  await digitar(P, "curta"); await P.waitForFunction(() => /pelo menos 16/.test(document.getElementById("ask-text").textContent));
  await digitar(P, NOVA); await P.waitForFunction(() => /^Confirme/.test(document.getElementById("ask-title").textContent));
  await digitar(P, NOVA + "x"); await P.waitForFunction(() => /não são iguais/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 15000 });
  assert.equal(await P.locator("#ask[open]").count(), 0);
});
t("a frase antiga continua valendo depois da tentativa que não bateu", async () => {
  const c = await browser.newContext(), N = await c.newPage(); await N.goto(srv.url); await N.fill("#email", email); await N.fill("#password", SENHA); await N.click("#auth-submit");
  await N.waitForSelector("#ask[open]", { timeout: 30000 }); await digitar(N, FRASE); await N.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await c.close();
});
t("troca concluída: a frase NOVA abre num aparelho novo e a ANTIGA deixa de funcionar", async () => {
  await P.click("#mfa-pass"); await P.waitForSelector("#ask[open]"); await digitar(P, NOVA); await P.waitForFunction(() => /^Confirme/.test(document.getElementById("ask-title").textContent));
  await digitar(P, NOVA); await P.waitForFunction(() => /Frase-senha trocada/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 20000 });
  const c = await browser.newContext(), N = await c.newPage(); await N.goto(srv.url); await N.fill("#email", email); await N.fill("#password", SENHA); await N.click("#auth-submit");
  await N.waitForSelector("#ask[open]", { timeout: 30000 });
  await digitar(N, FRASE); await N.waitForFunction(() => /incorreta/.test(document.getElementById("ask-text").textContent), null, { timeout: 20000 }); // a antiga não abre mais
  await digitar(N, NOVA); await N.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await c.close();
});
