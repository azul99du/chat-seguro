// Convites de grupo: o admin cria links (nome, validade, limite, QR), quem tem conta abre e PEDE para entrar, um admin aceita (ou o link aceita sozinho), links se desligam e esgotam.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, D, E, nomeA, nomeB, nomeC, nomeD, nomeE, url1, url2; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 240000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const abrirLink = async (p, url) => { await p.goto("about:blank"); await p.goto(url); await p.waitForSelector("#convite-ver[open]", { timeout: 30000 }); };
const info = (p) => p.locator("#cvv-info").innerText();
const abrirLista = async (p) => { if (!(await p.locator("#grupo-info").evaluate((d) => d.open))) { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); } await p.click("#gi-convite"); await p.waitForSelector("#convites[open]"); await p.waitForTimeout(800); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } }), p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.setItem("lacre:cv-poll", "1000"); } catch {} }); p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`)); return p; };
  [A, B, C, D, E] = [await novo("A"), await novo("B"), await novo("C"), await novo("D"), await novo("E")];
  [nomeA, nomeB, nomeC, nomeD, nomeE] = ["ca", "cb", "cc", "cd", "ce"].map((p) => novoUsuario(p));
  for (const [p, n] of [[A, nomeA], [B, nomeB], [C, nomeC], [D, nomeD], [E, nomeE]]) await cadastrar(p, n);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg .vis");
  await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis"); await A.waitForTimeout(1500);
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Trio convite"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar");
  await A.waitForSelector(`#conv-title:text-is("Trio convite")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("só admin vê os links; criar um link mostra o endereço, o QR e as regras", async () => {
  await B.waitForSelector('#contacts button[data-grupo]', { timeout: 30000 }); await B.click('#contacts button[data-grupo]'); await B.waitForSelector(`#conv-title:text-is("Trio convite")`); await B.click("#grupo-btn"); await B.waitForSelector("#grupo-info[open]");
  assert.equal(await B.locator("#gi-convite").isHidden(), true, "quem não é admin não vê"); await B.keyboard.press("Escape");
  await A.click("#grupo-btn"); await A.waitForSelector("#grupo-info[open]"); assert.equal(await A.locator("#gi-convite").isVisible(), true); await A.click("#gi-convite"); await A.waitForSelector("#convites[open]");
  await A.click("#cv-novo"); await A.waitForSelector("#convite-novo[open]"); await A.fill("#cvn-nome", "Amigos"); assert.equal(await A.locator('#cvn-validade button[aria-pressed="true"]').innerText(), "7 dias"); assert.equal(await A.locator('#cvn-limite button[aria-pressed="true"]').innerText(), "10 pessoas");
  assert.equal(await A.locator("#cvn-aprovar").isChecked(), true); await A.click("#cvn-criar"); await A.waitForSelector("#convite-link[open]", { timeout: 20000 });
  url1 = (await A.locator("#cvl-url").innerText()).trim(); assert.match(url1, /#convite=[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/); assert.equal(await A.locator("#cvl-titulo").innerText(), "Amigos");
  assert.ok((await A.locator("#cvl-qr svg path").getAttribute("d")).length > 200, "o QR foi desenhado"); assert.match(await A.locator("#cvl-info").innerText(), /vale 7 dias · até 10 pessoas · um admin aprova cada pedido/);
  await A.keyboard.press("Escape"); await A.waitForSelector("#cv-lista .linha:has-text('Amigos')");
});
t("quem abre o link vê o nome do grupo e pede para entrar; o endereço fica limpo", async () => {
  await abrirLink(C, url1); await C.waitForFunction(() => document.querySelector("#cvv-nome").textContent === "Trio convite", null, { timeout: 15000 }); assert.equal(await C.locator("#cvv-titulo").innerText(), "Entrar no grupo?");
  assert.match(await info(C), /2 pessoas/); assert.equal(await C.locator("#cvv-pedir").isVisible(), true); assert.equal(await C.evaluate(() => location.hash), "", "a chave do link some do endereço");
  await C.click("#cvv-pedir"); await C.waitForFunction(() => /Pedido enviado/.test(document.querySelector("#cvv-info").textContent), null, { timeout: 15000 });
  await C.click("#cvv-fechar");
});
t("o admin vê o pedido no grupo, aceita, e a pessoa entra e conversa", async () => {
  await A.keyboard.press("Escape"); await A.keyboard.press("Escape"); await A.waitForTimeout(300);
  await A.waitForFunction((n) => !document.querySelector("#ped-barra").hidden && document.querySelector("#ped-texto").textContent.includes(`@${n} pediu para entrar pelo link`), nomeC, { timeout: 20000 });
  await A.click("#ped-ok");
  await C.waitForFunction(() => /Seu pedido foi aceito/.test(document.querySelector("#note-text")?.textContent || "") && document.querySelector("#note").open, null, { timeout: 30000 }); await C.click("#note button");
  await C.waitForSelector(`#conv-title:text-is("Trio convite")`, { timeout: 20000 }); await C.waitForSelector("#messages:not(.carregando)"); await enviar(C, "oi, entrei pelo link");
  await A.waitForSelector('.msg:not(.mine) .vis:text-is("oi, entrei pelo link")', { timeout: 30000 }); await B.click('#contacts button[data-grupo]'); await B.waitForSelector('.msg:not(.mine) .vis:text-is("oi, entrei pelo link")', { timeout: 30000 });
  await A.waitForFunction(() => document.querySelector("#ped-barra").hidden, null, { timeout: 10000 });
});
t("link de uso único e sem aprovação: entra sozinho e o link fica 'já usado'", async () => {
  await A.click("#grupo-btn"); await A.waitForSelector("#grupo-info[open]"); await A.click("#gi-convite"); await A.waitForSelector("#convites[open]"); await A.click("#cv-novo"); await A.waitForSelector("#convite-novo[open]");
  await A.fill("#cvn-nome", "Uso único"); await A.click('#cvn-limite button:has-text("1 pessoa")'); await A.uncheck("#cvn-aprovar"); await A.click("#cvn-criar"); await A.waitForSelector("#convite-link[open]", { timeout: 20000 });
  url2 = (await A.locator("#cvl-url").innerText()).trim(); assert.match(await A.locator("#cvl-info").innerText(), /até 1 pessoa · aceita sozinho/);
  await A.keyboard.press("Escape");
  await abrirLink(D, url2); await D.waitForFunction(() => document.querySelector("#cvv-nome").textContent === "Trio convite"); await D.click("#cvv-pedir");
  await D.waitForFunction(() => /Seu pedido foi aceito/.test(document.querySelector("#note-text")?.textContent || "") && document.querySelector("#note").open, null, { timeout: 40000 }); await D.click("#note button"); await D.waitForSelector(`#conv-title:text-is("Trio convite")`);
  await A.waitForTimeout(800); await A.waitForSelector("#cv-lista .linha:has-text('Uso único')"); await A.waitForFunction(() => /já usado/.test(document.querySelector("#cv-lista").textContent), null, { timeout: 15000 });
  await E.goto("about:blank"); await abrirLink(E, url2); await E.waitForFunction(() => /não está valendo agora/.test(document.querySelector("#cvv-info").textContent), null, { timeout: 15000 }); assert.equal(await E.locator("#cvv-pedir").isHidden(), true);
});
t("desligar um link: quem abre depois vê que não vale mais", async () => {
  await A.click("#cv-lista .linha:has-text('Amigos')"); await A.waitForSelector("#convite-link[open]"); await A.click("#cvl-desligar"); await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=sim]");
  await A.waitForFunction(() => !document.querySelector("#convite-link").open, null, { timeout: 15000 }); await A.waitForTimeout(500); assert.equal(await A.locator("#cv-lista .linha:has-text('Amigos')").count(), 0);
  await abrirLink(E, url1); await E.waitForFunction(() => /não está valendo agora/.test(document.querySelector("#cvv-info").textContent), null, { timeout: 15000 }); assert.equal(await E.locator("#cvv-pedir").isHidden(), true);
});
t("link torto ou de outro grupo não abre nada", async () => {
  await E.goto("about:blank"); await E.goto(srv.url.replace(/\/$/, "") + "/#convite=curto.curto"); await E.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await E.waitForTimeout(800); assert.equal(await E.locator("#convite-ver").evaluate((d) => d.open), false);
});
t("sem erros de página", () => assert.deepEqual(erros, []));
