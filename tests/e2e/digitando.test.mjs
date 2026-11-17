// "Digitando…": aparece para quem deve ver (conversa a dois e grupo), some sozinho quando a pessoa para ou envia, e NÃO aparece para quem não está na conversa.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const ver = (p, txt) => p.waitForSelector(`.msg .vis:text-is("${txt}")`, { timeout: 30000 });
const abrirPessoa = async (p, nome) => { await p.click(`#contacts button[data-id]:has-text("@${nome}")`); await p.waitForSelector(`#conv-title:text-is("@${nome}")`); await p.waitForSelector("#messages:not(.carregando)"); };
const status = (p) => p.locator("#conv-status").innerText().catch(() => "");
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }), p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("da"), novoUsuario("db"), novoUsuario("dc")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await abrirPessoa(B, nomeA); await ver(B, "oi b"); await enviar(B, "oi a"); await ver(A, "oi a");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:has-text("@${nomeC}")`); await enviar(A, "oi c"); await C.waitForSelector("#contacts button .unread", { timeout: 30000 }); await abrirPessoa(C, nomeA); await ver(C, "oi c"); await enviar(C, "oi a, é o c"); await ver(A, "oi a, é o c");
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Trio digitando");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar");
  await A.waitForSelector(`#conv-title:text-is("Trio digitando")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("conversa a dois: B vê 'digitando…' enquanto A digita; some quando A para; quem está de fora (C) não vê nada", async () => {
  await abrirPessoa(A, nomeB); await abrirPessoa(B, nomeA); await abrirPessoa(C, nomeA);
  await A.fill("#text", "estou escrevendo");
  await B.waitForFunction(() => /digitando…/.test(document.querySelector("#conv-status")?.textContent || "") && !document.querySelector("#conv-status").hidden, null, { timeout: 15000 });
  assert.match(await B.locator("#contacts button .who small.digitando").first().innerText(), /digitando…/, "também na lista");
  await C.waitForTimeout(1500); assert.doesNotMatch(await status(C), /digitando/, "C não é o destinatário"); assert.equal(await C.locator("#contacts .digitando").count(), 0);
  await B.waitForFunction(() => !/digitando/.test(document.querySelector("#conv-status")?.textContent || ""), null, { timeout: 20000 }); // A parou de mexer: o aviso some sozinho
  assert.match(await status(B), /online/);
});
t("enviar a mensagem também tira o 'digitando…' na hora", async () => {
  await A.fill("#text", "mais uma"); await B.waitForFunction(() => /digitando…/.test(document.querySelector("#conv-status")?.textContent || ""), null, { timeout: 15000 });
  await A.click("#send-form .primary"); await ver(B, "mais uma"); await B.waitForFunction(() => !/digitando/.test(document.querySelector("#conv-status")?.textContent || ""), null, { timeout: 8000 });
});
t("grupo: os outros veem quem está digitando", async () => {
  await B.click('#contacts button[data-grupo]'); await B.waitForSelector(`#conv-title:text-is("Trio digitando")`); await B.waitForSelector("#messages:not(.carregando)");
  await C.click('#contacts button[data-grupo]'); await C.waitForSelector(`#conv-title:text-is("Trio digitando")`); await C.waitForSelector("#messages:not(.carregando)");
  await A.click('#contacts button[data-grupo]'); await A.waitForSelector(`#conv-title:text-is("Trio digitando")`); await A.waitForSelector("#messages:not(.carregando)");
  await A.fill("#text", "escrevendo para o grupo");
  for (const P of [B, C]) await P.waitForFunction((n) => (document.querySelector("#conv-sub")?.textContent || "") === `${n} está digitando…`, nomeA, { timeout: 15000 });
  await A.fill("#text", ""); for (const P of [B, C]) await P.waitForFunction(() => !/digitando/.test(document.querySelector("#conv-sub")?.textContent || ""), null, { timeout: 15000 });
});
t("quem desliga o aviso (lacre:digitando=0) não aparece digitando", async () => {
  await A.evaluate(() => localStorage.setItem("lacre:digitando", "0")); await abrirPessoa(A, nomeB); await abrirPessoa(B, nomeA);
  await A.fill("#text", "em silêncio"); await B.waitForTimeout(2500); assert.doesNotMatch(await status(B), /digitando/);
  await A.evaluate(() => localStorage.removeItem("lacre:digitando")); await A.fill("#text", "");
});
t("sem erros de página", () => assert.deepEqual(erros, []));
