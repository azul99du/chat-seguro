// Pop-up de mensagem nova no alto da tela: aparece para outra conversa (contato e grupo), toque abre, some sozinho, não aparece na conversa aberta nem quando desligado.
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
const quieto = (p) => p.waitForSelector("#pop-msg", { state: "hidden", timeout: 15000 });
const popVisivel = (p) => p.locator("#pop-msg:not([hidden]) .pop-cartao");
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n, init) => { const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }), p = await ctx.newPage(); if (init) await p.addInitScript(init); p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`)); return p; };
  [A, C] = [await novo("A"), await novo("C")]; B = await novo("B", () => { try { localStorage.setItem("lacre:pop-ms", "2500"); } catch {} });
  [nomeA, nomeB, nomeC] = [novoUsuario("pa"), novoUsuario("pb"), novoUsuario("pc")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await enviar(A, "oi b, é a"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 });
  await chamar(C, nomeB); await C.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await enviar(C, "oi b, é o c"); await B.waitForFunction(() => document.querySelectorAll("#contacts button").length >= 2, null, { timeout: 30000 });
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:has-text("@${nomeC}")`); await enviar(A, "oi c, é a"); await C.waitForFunction(() => document.querySelectorAll("#contacts button").length >= 1, null, { timeout: 30000 });
  await abrirPessoa(B, nomeA); await enviar(B, "oi a, é o b"); await abrirPessoa(C, nomeA); await enviar(C, "oi a, é o c"); await A.waitForTimeout(2500); // (grupo só aceita quem já respondeu)
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("mensagem de outra conversa: aparece o cartão com nome e prévia; tocar abre a conversa; some sozinho se ninguém toca", async () => {
  await abrirPessoa(B, nomeA); await ver(B, "oi b, é a");
  await abrirPessoa(C, nomeB); await quieto(B); await enviar(C, "pop do c"); const p = popVisivel(B); await p.waitFor({ timeout: 20000 });
  assert.match(await p.innerText(), new RegExp(`@${nomeC}[\\s\\S]*agora[\\s\\S]*pop do c`)); assert.equal(await B.locator("#pop-msg").getAttribute("role"), "status");
  await B.waitForSelector("#pop-msg", { state: "hidden", timeout: 12000 }); // some sozinho (2,5 s no teste)
  await quieto(B); await enviar(C, "pop do c 2"); await p.waitFor({ timeout: 20000 }); await p.click(); await B.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await ver(B, "pop do c 2");
  assert.equal(await B.locator("#pop-msg").isHidden(), true, "tocar fecha o aviso");
});
t("na conversa que já está aberta não aparece aviso", async () => {
  await abrirPessoa(A, nomeB); await abrirPessoa(B, nomeA); await enviar(A, "estou na conversa"); await ver(B, "estou na conversa"); await B.waitForTimeout(1200); assert.equal(await B.locator("#pop-msg").isHidden(), true);
});
t("grupo: o aviso mostra o nome do grupo e quem escreveu", async () => {
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Trio pop");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar");
  await A.waitForSelector(`#conv-title:text-is("Trio pop")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector('#contacts button[data-grupo]', { timeout: 30000 }); await abrirPessoa(B, nomeC);
  await quieto(B); await enviar(A, "oi grupo"); const p = popVisivel(B); await p.waitFor({ timeout: 20000 });
  assert.match(await p.innerText(), new RegExp(`Trio pop · @${nomeA}[\\s\\S]*oi grupo`));
  await p.click(); await B.waitForSelector(`#conv-title:text-is("Trio pop")`);
});
t("desligado (lacre:pop=0): nenhum aviso", async () => {
  await B.evaluate(() => localStorage.setItem("lacre:pop", "0")); await abrirPessoa(B, nomeC); await enviar(A, "sem aviso"); await B.waitForSelector('#contacts button[data-grupo] .unread', { timeout: 20000 }).catch(() => {});
  await B.waitForTimeout(1200); assert.equal(await B.locator("#pop-msg").isHidden(), true); await B.evaluate(() => localStorage.removeItem("lacre:pop"));
});
t("sem erros de página", () => assert.deepEqual(erros, []));
