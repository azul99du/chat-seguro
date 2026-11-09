// Tela inicial enxuta: topo só com logo + foto; conta no menu da foto; "Chamar" é um botão flutuante que abre uma folha.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, nomeA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  A = await (await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage(); A.on("pageerror", (e) => erros.push(e.message));
  const B = await (await browser.newContext()).newPage(); nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("topo: só o logo e a foto; sino, escudo, Sair e o nome ficam fora da vista; aviso do 2FA é um ponto", async () => {
  for (const id of ["#notif-btn", "#sec-btn", "#logout", "#copiar-nome", "#add-form"]) assert.equal(await A.locator(id).isVisible(), false, id + " não aparece na tela inicial");
  assert.equal(await A.locator("#eu-foto").isVisible(), true); assert.equal(await A.locator("#chamar-fab").isVisible(), true);
  assert.equal(await A.locator("#mfa-nudge").isVisible(), true, "ponto de aviso (conta sem 2 passos)");
  const r = await A.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); return { wm: q("#inbox .wordmark").right, foto: q("#eu-foto").left }; });
  assert.ok(r.foto > r.wm, "a foto não passa por cima do logo");
});
t("tocar na foto abre o menu com nome, foto, notificações, segurança e sair; fundo e Esc fecham", async () => {
  await A.tap("#eu-foto"); await A.waitForSelector("#menu-conta:not([hidden])");
  assert.equal(await A.locator("#nome-txt").innerText(), "@" + nomeA); assert.equal(await A.locator("#eu-foto").getAttribute("aria-expanded"), "true");
  for (const id of ["#copiar-nome", "#menu-foto", "#notif-btn", "#sec-btn", "#logout"]) assert.equal(await A.locator(id).isVisible(), true, id);
  assert.equal(await A.locator("#sec-aviso").isVisible(), true, "o menu também avisa do 2FA");
  await A.tap("#menu-fundo", { position: { x: 20, y: 600 } }); await A.waitForSelector("#menu-conta", { state: "hidden" });
  await A.tap("#eu-foto"); await A.waitForSelector("#menu-conta:not([hidden])"); await A.keyboard.press("Escape"); await A.waitForSelector("#menu-conta", { state: "hidden" });
});
t("itens do menu funcionam: Segurança abre e fecha o menu", async () => {
  await menuConta(A, "#sec-btn"); await A.waitForSelector("#mfa[open]"); assert.equal(await A.locator("#menu-conta").isVisible(), false);
  await A.click("#mfa button[value=cancel]");
});
t("Chamar: botão flutuante abre a folha com o campo já focado; nome inválido é recusado; nome certo abre a conversa", async () => {
  await A.tap("#chamar-fab"); await A.waitForSelector("#chamar[open]"); assert.equal(await A.evaluate(() => document.activeElement?.id), "add-user");
  await A.fill("#add-user", "naoexiste123"); await A.click("#add-form button"); await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /Não encontramos/);
  await A.click("#note button"); await A.waitForSelector("#note", { state: "hidden" }); assert.equal(await A.locator("#chamar").evaluate((d) => d.open), true, "a folha continua aberta para corrigir");
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector("#send-form:not([hidden])"); assert.equal(await A.locator("#chamar").evaluate((d) => d.open), false);
});
t("Aparência: o menu alterna automática → clara → escura, muda as cores e lembra a escolha", async () => {
  await A.click("#back").catch(() => {}); // (a conversa do teste anterior está aberta: volta para a lista)
  const cor = () => A.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await menuConta(A); assert.equal(await A.locator("#tema-estado").innerText(), "automática");
  await menuConta(A, "#tema-btn"); assert.equal(await A.evaluate(() => document.documentElement.dataset.tema), "claro"); const clara = await cor();
  await menuConta(A, "#tema-btn"); assert.equal(await A.evaluate(() => document.documentElement.dataset.tema), "escuro"); const escura = await cor();
  assert.notEqual(clara, escura, "as cores mudam"); const [r, g, b] = escura.match(/\d+/g).map(Number); assert.ok(r + g + b < 150, "fundo escuro: " + escura);
  assert.equal(await A.evaluate(() => localStorage.getItem("lacre:tema")), "escuro");
  await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); assert.equal(await A.evaluate(() => document.documentElement.dataset.tema), "escuro", "continua escuro depois de recarregar");
  await menuConta(A, "#tema-btn"); assert.equal(await A.evaluate(() => document.documentElement.dataset.tema ?? "auto"), "auto"); await A.keyboard.press("Escape");
});
t("Segurança é uma página com a linha do 2FA em destaque; Perfil mostra o nome e copia", async () => {
  await menuConta(A, "#sec-btn"); await A.waitForSelector("#mfa[open]");
  assert.equal(await A.locator("#mfa-destaque").getAttribute("data-estado"), "off"); assert.equal(await A.locator("#mfa-chip").innerText(), "Desativada");
  const caixa = await A.locator("#mfa").boundingBox(); assert.ok(caixa.width >= 380 && caixa.height >= 700, "ocupa a tela toda no celular");
  for (const id of ["#mfa-go", "#mfa-senha", "#mfa-pass", "#mfa-exp", "#mfa-imp"]) assert.equal(await A.locator(id).isVisible(), true, id);
  await A.click("#mfa button[value=cancel]");
  await A.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await menuConta(A, "#menu-foto"); await A.waitForSelector("#perfil[open]"); assert.equal(await A.locator("#perfil-nome").innerText(), "@" + nomeA);
  await A.click("#perfil-copiar"); await A.waitForFunction(() => /copiado/i.test(document.getElementById("perfil-msg").textContent)); assert.equal(await A.evaluate(() => navigator.clipboard.readText()), "@" + nomeA);
  assert.equal(await A.locator("#perfil-escolher").isVisible(), true, "botão de câmera"); await A.click("#perfil button[value=cancel]");
});
t("com poucas conversas a busca não aparece; sem erros de JavaScript", async () => {
  await A.click("#back").catch(() => {}); assert.equal(await A.locator("#busca-box").isVisible(), false); assert.deepEqual(erros, []);
});
