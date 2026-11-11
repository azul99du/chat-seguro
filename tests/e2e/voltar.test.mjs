// Botão "voltar" do celular/navegador: fecha a tela de cima (conversa, páginas, janelas, menus) em vez de sair do site, e nunca deixa "voltar" sobrando.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(p, nome) {
  await p.goto("about:blank"); await p.goto(srv.url); await p.click("#tab-signup"); await p.fill("#username", nome); await p.fill("#email", novoEmail()); await p.fill("#password", SENHA); await p.click("#auth-submit");
  await p.waitForSelector("#ask[open]", { timeout: 30000 }); await p.fill("#ask-input", FRASE); await p.click("#ask button[value=ok]"); await pronto(p);
}
const voltar = async (p) => { await p.goBack().catch(() => {}); await p.waitForTimeout(250); };
const naPagina = (p) => !p.url().startsWith("about:");
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async () => { const p = await (await browser.newContext({ viewport: { width: 390, height: 780 } })).newPage(); p.on("pageerror", (e) => erros.push(e.message)); return p; };
  A = await novo(); B = await novo(); nomeB = novoUsuario("b"); await cadastrar(B, nomeB); await cadastrar(A, novoUsuario("a"));
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("página de configurações: voltar fecha a página e continua no site; aberta e fechada pela setinha não deixa 'voltar' sobrando", async () => {
  await menuConta(A, "#sec-btn"); await A.waitForSelector("#mfa[open]");
  await voltar(A); assert.equal(await A.locator("#mfa[open]").count(), 0, "voltar fechou a página"); assert.ok(naPagina(A), "e não saiu do site"); assert.equal(await A.locator("#chat").isVisible(), true);
  await menuConta(A, "#sec-btn"); await A.waitForSelector("#mfa[open]"); await A.click("#mfa .pg-volta"); await A.waitForSelector("#mfa[open]", { state: "detached" }).catch(() => {});
  assert.equal(await A.locator("#mfa[open]").count(), 0); await A.waitForTimeout(300);
  // se a entrada tivesse sobrado, este voltar só a consumiria e o site continuaria aberto
  await voltar(A); assert.ok(!naPagina(A), "depois de abrir e fechar pela setinha, um voltar já sai do site (nada sobrou)");
  await A.goForward().catch(() => {}); await A.waitForTimeout(300); await pronto(A).catch(async () => { await A.goto(srv.url); await pronto(A); });
});
t("janela por cima de página (pergunta dentro de Segurança): cada voltar fecha uma camada", async () => {
  await menuConta(A, "#sec-btn"); await A.waitForSelector("#mfa[open]"); await A.click("#mfa-pass"); await A.waitForSelector("#ask[open]");
  await voltar(A); assert.equal(await A.locator("#ask[open]").count(), 0, "1º voltar fecha a pergunta"); assert.equal(await A.locator("#mfa[open]").count(), 1, "a página continua");
  await voltar(A); assert.equal(await A.locator("#mfa[open]").count(), 0, "2º voltar fecha a página"); assert.ok(naPagina(A));
});
t("menu da conta: voltar fecha o menu e não sai do site", async () => {
  await A.click("#eu-foto"); await A.waitForSelector("#menu-conta:not([hidden])");
  await voltar(A); assert.equal(await A.locator("#menu-conta").isHidden(), true); assert.ok(naPagina(A));
  await voltar(A).catch(() => {}); // (sem nada aberto, o voltar sai do site: este é o comportamento normal da lista)
  assert.ok(!naPagina(A), "da lista, voltar sai do site"); await A.goForward().catch(() => {}); await A.waitForTimeout(300); if (!naPagina(A)) await A.goto(srv.url); await pronto(A);
});
t("conversa: voltar volta para a lista; janela dentro da conversa fecha primeiro; abrir pela lista de novo funciona", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.fill("#text", "oi"); await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .bubble"); assert.ok(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")));
  await A.click("#safety-btn"); await A.waitForSelector("#safety[open]");
  await voltar(A); assert.equal(await A.locator("#safety[open]").count(), 0, "1º voltar fecha o código de segurança"); assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), true, "continua na conversa");
  await voltar(A); assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), false, "2º voltar volta para a lista"); assert.ok(naPagina(A)); assert.equal(await A.locator("#contacts button").first().isVisible(), true);
  await A.click("#contacts button"); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.click("#back");
  assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), false, "a setinha também volta"); await A.waitForTimeout(300);
  await voltar(A); assert.ok(!naPagina(A), "e não sobrou entrada: da lista, voltar sai do site");
  await A.goto(srv.url); await pronto(A);
});
t("menu da mensagem e bandeja do +: o primeiro voltar só fecha eles", async () => {
  await A.click("#contacts button"); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  await A.fill("#text", "uma mensagem"); await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .bubble");
  await A.locator(".msg.mine .bubble").first().click({ button: "right" }); await A.waitForSelector(".picker");
  await voltar(A); assert.equal(await A.locator(".picker").count(), 0, "fechou o menu da mensagem"); assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), true, "e continua na conversa");
  await A.click("#mais"); await A.waitForSelector("#tray.on"); await voltar(A); assert.equal(await A.locator("#tray.on").count(), 0); assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), true);
  await voltar(A); assert.equal(await A.evaluate(() => document.getElementById("chat").classList.contains("in-conv")), false, "agora sim volta para a lista");
});
t("recarregar a página não deixa 'voltar' preso: em poucos voltares sai do site (o navegador recarrega a página antiga uma vez)", async () => {
  await A.click("#contacts button"); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.reload(); await pronto(A);
  let n = 0; while (naPagina(A) && n < 3) { await A.waitForTimeout(500); await voltar(A); await A.waitForTimeout(500); n++; }
  assert.ok(!naPagina(A), `saiu do site em ${n} voltares (máximo 3)`);
  await A.goto(srv.url); await pronto(A);
});
t("nenhum erro de página", async () => { assert.deepEqual(erros, []); });
