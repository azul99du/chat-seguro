// Campo de mensagem: não perde o foco ao enviar (no celular o teclado não pode sumir e voltar), Enter envia, sem preenchimento automático de senhas/cartões.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const foco = (p) => p.evaluate(() => document.activeElement?.id);
const ver = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:has-text("${txt}")`, { timeout: 30000 });
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const [ca, cb] = [await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true }), await browser.newContext({ viewport: { width: 1100, height: 760 } })];
  A = await ca.newPage(); B = await cb.newPage(); for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  const nomeB = novoUsuario("b"); await cadastrar(A, novoUsuario("a")); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector("#send-form:not([hidden])");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o campo é um div editável de texto puro (não um <input>), com texto de exemplo", async () => {
  const i = await A.locator("#text").evaluate((e) => ({ tag: e.tagName, ce: e.contentEditable, ph: getComputedStyle(e, "::before").content }));
  assert.equal(i.tag, "DIV"); assert.match(i.ce, /true|plaintext-only/); assert.match(i.ph, /Escreva uma mensagem/);
});
t("tocar em Enviar mantém o foco no campo (o teclado do celular não some) e limpa o texto", async () => {
  await A.fill("#text", "primeira"); await A.focus("#text"); assert.equal(await foco(A), "text");
  await A.tap("#send-form .primary"); await ver(A, "primeira", { meu: true }); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await ver(B, "primeira");
  assert.equal(await foco(A), "text", "o foco continua no campo"); assert.equal(await A.locator("#text").evaluate((e) => e.textContent), "");
});
t("Enter envia e não deixa quebra de linha; espaços e texto grande são tratados", async () => {
  await A.focus("#text"); await A.keyboard.type("segunda"); await A.keyboard.press("Enter"); await ver(B, "segunda");
  assert.equal(await foco(A), "text"); assert.equal(await A.locator("#text").evaluate((e) => e.textContent), "");
  await A.fill("#text", "x".repeat(4100)); assert.ok((await A.locator("#text").evaluate((e) => e.textContent.length)) <= 4000, "limite de 4000 caracteres");
  await A.fill("#text", "");
});
t("campo vazio: Enter não envia nada", async () => {
  const antes = await A.locator(".msg.mine").count(); await A.focus("#text"); await A.keyboard.press("Enter"); await A.waitForTimeout(500); assert.equal(await A.locator(".msg.mine").count(), antes);
});
t("botão redondo: microfone com o campo vazio, enviar com texto, e volta ao microfone", async () => {
  const vis = async (sel) => A.locator(sel).isVisible();
  assert.equal(await A.locator("#acao").getAttribute("data-modo"), "mic"); assert.equal(await vis("#mic"), true); assert.equal(await vis("#send-form .primary"), false);
  await A.fill("#text", "oi"); await A.waitForFunction(() => document.getElementById("acao").dataset.modo === "send");
  await A.waitForFunction(() => getComputedStyle(document.querySelector("#send-form .primary")).visibility === "visible"); await A.waitForSelector("#mic", { state: "hidden" });
  await A.fill("#text", ""); await A.waitForFunction(() => document.getElementById("acao").dataset.modo === "mic"); await A.waitForSelector("#mic", { state: "visible" });
});
t("bandeja do +: abre, fecha com Esc e com toque fora, e a figurinha abre a gaveta", async () => {
  assert.equal(await A.locator("#tray .tile").first().isVisible(), false, "fechada: tiles escondidos");
  await A.click("#mais"); assert.equal(await A.locator("#mais").getAttribute("aria-expanded"), "true"); await A.waitForSelector("#tray .tile >> nth=1", { state: "visible" });
  await A.keyboard.press("Escape"); await A.waitForFunction(() => !document.getElementById("tray").classList.contains("on")); assert.equal(await A.locator("#mais").getAttribute("aria-expanded"), "false");
  await A.click("#mais"); await A.waitForSelector("#tray .tile >> nth=0", { state: "visible" }); await A.mouse.click(200, 150); await A.waitForFunction(() => !document.getElementById("tray").classList.contains("on"));
  await A.click("#mais"); await A.click("#sticker"); await A.waitForSelector("#stk[open]"); assert.equal(await A.locator("#tray.on").count(), 0, "a bandeja fecha ao escolher"); await A.click("#stk-close");
});
t("'Foto ou vídeo' abre o seletor de arquivos", async () => {
  await A.click("#mais"); await A.waitForSelector("#attach", { state: "visible" });
  const [fc] = await Promise.all([A.waitForEvent("filechooser"), A.click("#attach")]); assert.ok(fc.isMultiple() === false);
  await A.waitForFunction(() => !document.getElementById("tray").classList.contains("on"));
});
t("digitar a próxima mensagem enquanto a anterior está indo não apaga o que foi digitado", async () => {
  await A.fill("#text", "mensagem um"); await A.click("#send-form .primary"); await A.fill("#text", "mensagem dois");
  await ver(A, "mensagem um", { meu: true }); assert.equal(await A.locator("#text").evaluate((e) => e.textContent), "mensagem dois");
  await A.click("#send-form .primary"); await ver(A, "mensagem dois", { meu: true }); assert.equal(await A.locator("#text").evaluate((e) => e.textContent), "");
});
t("sem erros de script", () => assert.deepEqual(erros, []));
