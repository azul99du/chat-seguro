// Buscar dentro da conversa: lupa no alto, barra com contador e setas, palavras marcadas (sem diferenciar acento/maiúscula), mensagens antigas trazidas na hora, e nada sai do aparelho.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [], pedidos = [];
const t = (nome, fn) => test(nome, { timeout: 240000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const ver = (p, txt) => p.waitForSelector(`.msg .vis:text-is("${txt}"), .msg .vis:has(mark)`, { timeout: 30000 });
const contador = (p) => p.locator("#busca-ct").innerText();
const buscar = async (p, q) => { await p.fill("#busca-q", q); await p.waitForTimeout(500); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }), p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`)); p.on("request", (r) => pedidos.push(`${r.method()} ${r.url()} ${r.postData() || ""}`)); return p; };
  [A, B] = [await novo("A"), await novo("B")]; [nomeA, nomeB] = [novoUsuario("ba"), novoUsuario("bb")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await enviar(A, "alvo-antigo-xyz primeira de todas"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg .vis");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a lupa abre a barra; acha sem diferenciar acento/maiúscula; contador, setas, marcas e fechar", async () => {
  for (const x of ["vamos marcar a VIAGEM pra julho", "Ação rápida agora", "outra coisa qualquer", "a viagem acabou"]) { await enviar(A, x); await B.waitForSelector(`.msg:not(.mine) .vis:text-is("${x}")`, { timeout: 30000 }); }
  assert.equal(await B.locator("#busca-btn").isVisible(), true); assert.equal(await B.locator("#busca-conv").isHidden(), true);
  await B.click("#busca-btn"); await B.waitForSelector("#busca-conv:not([hidden])"); assert.equal(await B.locator("#conv > header.bar").isHidden(), true, "a barra de busca ocupa o lugar do alto");
  assert.equal(await B.evaluate(() => document.activeElement.id), "busca-q", "o campo já está pronto para digitar");
  await buscar(B, "v"); assert.equal(await contador(B), "", "uma letra só não busca");
  await buscar(B, "viagem"); assert.equal(await contador(B), "2 de 2", "começa pelo mais novo");
  assert.equal(await B.locator(".bubble mark").count(), 2); assert.equal(await B.locator(".bubble mark.at").count(), 1);
  assert.match(await B.locator(".msg.busca-atual").innerText(), /a viagem acabou/); assert.equal((await B.locator(".bubble mark").first().innerText()).toUpperCase(), "VIAGEM", "mostra o texto original, só marca");
  await B.click("#busca-cima"); assert.equal(await contador(B), "1 de 2"); await B.waitForSelector(".msg.busca-atual:has-text('marcar a VIAGEM')");
  await B.click("#busca-cima"); assert.equal(await contador(B), "2 de 2", "dá a volta");
  await buscar(B, "acao"); assert.equal(await contador(B), "1 de 1"); assert.equal(await B.locator(".bubble mark").first().innerText(), "Ação"); assert.equal(await B.locator("#busca-cima").isDisabled(), true, "um resultado só: sem setas");
  await buscar(B, "zzzz"); assert.equal(await contador(B), "Nada achado"); assert.equal(await B.locator(".bubble mark").count(), 0);
  await buscar(B, "viagem"); await B.press("#busca-q", "Enter"); assert.equal(await contador(B), "1 de 2", "Enter vai ao anterior");
  await B.press("#busca-q", "Escape"); await B.waitForSelector("#busca-conv", { state: "hidden" }); assert.equal(await B.locator("#conv > header.bar").isVisible(), true);
  assert.equal(await B.locator(".bubble mark").count(), 0, "fechar tira as marcas"); assert.equal(await B.locator(".msg.busca-atual").count(), 0);
  assert.equal(await B.locator('.msg .vis:text-is("vamos marcar a VIAGEM pra julho")').count(), 1, "o texto volta ao normal");
});
t("nada do que se procura sai do aparelho: nenhum pedido de rede leva a palavra", async () => {
  const antes = pedidos.length; await B.click("#busca-btn"); await buscar(B, "secretissima"); await B.press("#busca-q", "Escape");
  assert.equal(pedidos.slice(antes).filter((p) => /secretissima/i.test(p)).length, 0);
});
t("mensagem mais antiga que a tela: a busca traz ela (e o contexto) na hora", async () => {
  const total = 204; for (let i = 1; i <= total; i++) { await A.fill("#text", `enchimento ${i}`); await A.click("#send-form .primary"); if (i % 25 === 0) await A.waitForTimeout(400); }
  await B.waitForSelector(`.msg:not(.mine) .vis:text-is("enchimento ${total}")`, { timeout: 60000 });
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(`.msg .vis:text-is("enchimento ${total}")`, { timeout: 30000 });
  assert.equal(await B.locator('.msg .vis:text-is("alvo-antigo-xyz primeira de todas")').count(), 0, "a primeira mensagem já saiu da tela");
  const antes = await B.locator("#messages .msg").count();
  await B.click("#busca-btn"); await buscar(B, "alvo-antigo"); await B.waitForSelector(".msg.busca-atual", { timeout: 15000 });
  assert.equal(await contador(B), "1 de 1"); assert.match(await B.locator(".msg.busca-atual").innerText(), /alvo-antigo-xyz primeira de todas/);
  const depois = await B.locator("#messages .msg").count(); assert.ok(depois > antes, `trouxe mensagens antigas (${antes} -> ${depois})`);
  const textos = await B.locator("#messages .msg .vis").allInnerTexts(); assert.ok(textos.indexOf("alvo-antigo-xyz primeira de todas") === 0 || textos[0].startsWith("alvo-antigo"), "a mais antiga fica no topo, na ordem certa");
  await B.press("#busca-q", "Escape");
});
t("sem erros de página", () => assert.deepEqual(erros, []));
