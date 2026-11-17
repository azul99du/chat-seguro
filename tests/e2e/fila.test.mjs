// Mensagem escrita sem internet: fica esperando ("Aguardando conexão…"), sobrevive a recarregar, sai sozinha quando a conexão volta e dá para cancelar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, ctxA, nomeA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const verTexto = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:text-is("${txt}")`, { timeout: 30000 });
const naFila = (p, txt) => p.locator(`.msg.na-fila:has(.vis:text-is("${txt}"))`);
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctxA = await browser.newContext({ viewport: { width: 1100, height: 800 } }); const cb = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  A = await ctxA.newPage(); B = await cb.newPage(); for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  nomeA = novoUsuario("fa"); nomeB = novoUsuario("fb"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await enviar(A, "abrindo"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await verTexto(B, "abrindo");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("sem internet a mensagem espera; ao voltar a conexão ela sai sozinha, uma vez só, e chega para o outro lado", async () => {
  await ctxA.setOffline(true);
  await enviar(A, "escrita sem rede"); await naFila(A, "escrita sem rede").waitFor({ timeout: 20000 });
  assert.match(await naFila(A, "escrita sem rede").innerText(), /Aguardando conexão/); assert.equal(await A.inputValue("#text").catch(() => "") || await A.locator("#text").innerText(), "", "o campo fica livre para a próxima");
  await A.waitForTimeout(800); assert.equal(await B.locator('.msg .vis:text-is("escrita sem rede")').count(), 0, "ainda não chegou");
  await ctxA.setOffline(false); await A.evaluate(() => dispatchEvent(new Event("online")));
  await verTexto(B, "escrita sem rede"); await A.waitForFunction(() => !document.querySelector(".msg.na-fila"), null, { timeout: 30000 });
  await verTexto(A, "escrita sem rede", { meu: true }); assert.equal(await A.locator('.msg.mine .vis:text-is("escrita sem rede")').count(), 1); assert.equal(await B.locator('.msg .vis:text-is("escrita sem rede")').count(), 1, "sem duplicar");
});
t("a fila sobrevive a recarregar a página e sai quando a conexão volta; cancelar tira da fila", async () => {
  await ctxA.setOffline(true); await enviar(A, "vai esperar"); await naFila(A, "vai esperar").waitFor({ timeout: 20000 });
  await enviar(A, "vou cancelar"); await naFila(A, "vou cancelar").waitFor({ timeout: 20000 });
  await naFila(A, "vou cancelar").locator(".fila-cancelar").click(); await A.waitForFunction(() => ![...document.querySelectorAll(".msg.na-fila .vis")].some((v) => v.textContent === "vou cancelar"));
  await ctxA.setOffline(false); await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
  await verTexto(B, "vai esperar"); await B.waitForTimeout(1500); assert.equal(await B.locator('.msg .vis:text-is("vou cancelar")').count(), 0, "a cancelada nunca saiu");
  await A.waitForFunction(() => !document.querySelector(".msg.na-fila"), null, { timeout: 30000 });
});
t("sem erros de página", () => assert.deepEqual(erros, []));
