// Novidades: item no menu da conta, ponto rosa enquanto houver atualização que a pessoa ainda não abriu, cartões por atualização com filtro por assunto.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const abrirMenu = async (p) => { await p.click("#eu-foto"); await p.waitForSelector("#menu-conta:not([hidden])"); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 420, height: 820 } })).newPage(); P.on("pageerror", (e) => erros.push(e.message)); await cadastrar(P, novoUsuario("n"));
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("quem nunca abriu vê o ponto rosa no avatar e no item do menu; abrir a tela apaga o ponto e marca o que é NOVO", async () => {
  assert.equal(await P.locator("#nov-ponto").isVisible(), true); await abrirMenu(P); assert.equal(await P.locator("#nov-aviso").isVisible(), true);
  await P.click("#nov-btn"); await P.waitForSelector("#novidades[open]"); assert.match(await P.locator("#nov-versao").innerText(), /Você está na versão [0-9a-f]{10}/);
  assert.ok((await P.locator("#nov-lista .nov-cd").count()) >= 1); assert.equal(await P.locator("#nov-lista .nov-cd").first().locator(".nov-novo").count(), 1, "a mais nova está marcada como NOVO");
  assert.equal(await P.locator("#nov-ponto").isVisible(), false, "o ponto some ao abrir");
  const salvo = await P.evaluate(() => localStorage.getItem("lacre:novidades")); assert.match(salvo, /^\d{4}-\d{2}-\d{2}-\d+$/);
});
t("cartões por atualização, organizados por assunto: subtítulos em 'Tudo', filtro por assunto e 'Ver atualizações antigas'", async () => {
  assert.ok((await P.locator("#nov-lista .nov-cd").count()) >= 4, "na primeira vez todas são NOVO e todas aparecem"); await P.click("#novidades .pg-volta"); await abrirMenu(P); await P.click("#nov-btn"); await P.waitForSelector("#novidades[open]");
  const n = await P.locator("#nov-lista .nov-cd").count(); assert.equal(n, 3, "já vista: só as 3 mais novas abertas");
  const mais = P.locator("#nov-mais"); assert.match(await mais.innerText(), /Ver atualizações antigas \(3\)/); await mais.click(); assert.equal(await P.locator("#nov-lista .nov-cd").count(), 6); assert.match(await P.locator("#nov-mais").innerText(), /Mostrar só as mais novas/); assert.ok((await P.locator("#nov-lista .nov-gr").count()) >= 2, "subtítulos de assunto dentro dos cartões que têm mais de um assunto");
  await P.locator('#nov-chips button[data-tema="selos"]').click(); assert.equal(await P.locator('#nov-chips button[aria-pressed="true"]').getAttribute("data-tema"), "selos");
  const ts = await P.locator("#nov-lista .nov-ln b").allInnerTexts(); assert.ok(ts.includes("Jumpscare na loja") && ts.includes("Loja de Selos"), "só itens de Selos"); assert.ok(!ts.includes("Tela inicial na hora")); assert.equal(await P.locator("#nov-lista .nov-gr").count(), 0, "no filtro não há subtítulo");
  await P.locator('#nov-chips button[data-tema="seguranca"]').click(); assert.deepEqual(await P.locator("#nov-lista .nov-ln b").allInnerTexts(), ["Vários aparelhos na mesma conta"]);
  await P.locator('#nov-chips button[data-tema="tudo"]').click(); assert.ok((await P.locator("#nov-lista .nov-cd").count()) >= 3);
  await P.click("#novidades .pg-volta");
});
t("depois de ver, o ponto não volta; uma atualização mais nova que a última vista traz o ponto de novo e marca só o que é novo", async () => {
  await P.reload(); await pronto(P); assert.equal(await P.locator("#nov-ponto").isVisible(), false); await abrirMenu(P); assert.equal(await P.locator("#nov-aviso").isVisible(), false); await P.keyboard.press("Escape");
  await P.evaluate(() => localStorage.setItem("lacre:novidades", "2026-11-13-1")); await P.reload(); await pronto(P); assert.equal(await P.locator("#nov-ponto").isVisible(), true, "há atualizações depois da última vista");
  await abrirMenu(P); await P.click("#nov-btn"); await P.waitForSelector("#novidades[open]"); assert.equal(await P.locator("#nov-lista .nov-novo").count(), 4, "as 4 mais novas são NOVO e todas aparecem, mesmo passando de 3"); assert.equal(await P.locator("#nov-lista .nov-cd").count(), 4); assert.equal(await P.locator("#nov-ponto").isVisible(), false);
  await P.evaluate(() => localStorage.setItem("lacre:novidades", "lixo<script>")); await P.reload(); await pronto(P); assert.equal(await P.locator("#nov-ponto").isVisible(), true, "valor estragado vale como nunca ter visto");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
