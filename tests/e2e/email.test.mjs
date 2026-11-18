// Trocar o e-mail da conta (Segurança): pede a senha, confere o formato, pede o novo e-mail duas vezes e usa a troca do servidor (imediata ou por link de confirmação).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, emailAntigo, nome; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
const responder = async (p, valor) => { await p.waitForSelector("#ask[open]"); await p.fill("#ask-input", valor); await p.click("#ask button[value=ok]"); await p.waitForSelector("#ask:not([open])", { state: "attached" }); };
const perguntaComo = (p, re) => p.waitForFunction((r) => document.querySelector("#ask").open && new RegExp(r).test(document.querySelector("#ask-text").textContent), re, { timeout: 10000 });
const msg = (p) => p.locator("#mfa-msg").innerText();
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 420, height: 820 } })).newPage(); P.on("pageerror", (e) => erros.push(e.message));
  nome = novoUsuario("em"); emailAntigo = novoEmail();
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", nome); await P.fill("#email", emailAntigo); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE); await P.click("#ask button[value=ok]"); await pronto(P);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a página Segurança mostra o e-mail atual e a opção de trocar", async () => {
  await menuConta(P, "#sec-btn"); await P.waitForSelector("#mfa[open]");
  assert.equal(await P.locator("#mfa-email").isVisible(), true); assert.match(await P.locator("#mfa-email").innerText(), /Trocar e-mail da conta/);
  await P.waitForFunction((e) => document.querySelector("#mfa-email-atual").textContent.includes(e), emailAntigo, { timeout: 10000 });
});
t("senha errada, e-mail inválido, igual ao atual e confirmação diferente: nada muda", async () => {
  await P.click("#mfa-email"); await responder(P, "senha-errada-123"); await P.waitForFunction(() => /senha está errada/.test(document.querySelector("#mfa-msg").textContent)); assert.match(await msg(P), /Nada foi alterado/);
  await P.click("#mfa-email"); await responder(P, SENHA); await responder(P, "isso-nao-e-email");
  await perguntaComo(P, "não parece válido"); await responder(P, emailAntigo); await perguntaComo(P, "já é o e-mail da conta");
  await responder(P, novoEmail()); await responder(P, novoEmail()); await P.waitForFunction(() => /não são iguais/.test(document.querySelector("#mfa-msg").textContent)); assert.match(await msg(P), /Nada foi alterado/);
  assert.match(await P.locator("#mfa-email-atual").innerText(), new RegExp(emailAntigo.replace(/[.+]/g, "\\$&")), "continua o antigo");
});
t("trocar: o servidor muda na hora ou espera o link; o texto diz qual dos dois aconteceu e dá para entrar com o e-mail certo", async () => {
  const novo = novoEmail(); await P.click("#mfa-email"); await responder(P, SENHA); await responder(P, novo.toUpperCase()); await responder(P, novo);
  await P.waitForFunction(() => /E-mail trocado|link de confirmação|não deu para saber/.test(document.querySelector("#mfa-msg").textContent), null, { timeout: 20000 });
  const m = await msg(P);
  if (/E-mail trocado/.test(m)) { // projeto sem confirmação por e-mail: valeu na hora
    assert.match(m, new RegExp(novo.replace(/[.+]/g, "\\$&"))); await P.waitForFunction((e) => document.querySelector("#mfa-email-atual").textContent.includes(e), novo);
    await P.keyboard.press("Escape"); await menuConta(P, "#logout"); await P.waitForSelector("#choice[open]"); await P.click("#choice button[value=wipe]"); await P.waitForSelector("#auth:not([hidden])");
    await P.fill("#email", emailAntigo); await P.fill("#password", SENHA); await P.click("#auth-submit"); await P.waitForFunction(() => /incorretos/.test(document.querySelector("#auth-msg").textContent), null, { timeout: 15000 });
    await P.fill("#email", novo); await P.click("#auth-submit"); await P.waitForSelector("#ask[open], #chat:not([hidden])", { timeout: 30000 });
  } else { // projeto com confirmação: fica esperando o link e o e-mail antigo continua valendo
    assert.match(m, /link de confirmação/); await P.waitForFunction(() => /esperando confirmação/.test(document.querySelector("#mfa-email-atual").textContent), null, { timeout: 10000 }); assert.match(await P.locator("#mfa-email-atual").innerText(), new RegExp(emailAntigo.replace(/[.+]/g, "\\$&")));
  }
});
t("sem erros de página", () => assert.deepEqual(erros, []));
