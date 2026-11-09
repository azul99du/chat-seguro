// Trocar de aparelho: o aparelho novo não lê as mensagens antigas (sigilo futuro); exportar + importar traz o histórico de volta.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta, chamar, compartilhaCodigo } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, A2, emailA, nomeA, nomeB, arquivo, senhaArq; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = "#chat:not([hidden]):not(.preparando)";
async function cadastrar(page, usuario, email) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", email); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector(pronto, { timeout: 30000 });
}
const ver = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:has-text("${txt}")`, { timeout: 30000 });
const abrirSeg = async (p) => { await menuConta(p, "#sec-btn"); await p.waitForSelector("#mfa[open]"); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async () => (await (await browser.newContext({ viewport: { width: 1100, height: 780 }, acceptDownloads: true })).newPage());
  A = await novo(); B = await novo(); for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  emailA = novoEmail(); nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA, emailA); await cadastrar(B, nomeB, novoEmail());
  await chamar(A, nomeB); await A.waitForSelector("#send-form:not([hidden])");
  await A.fill("#text", "mensagem-antiga-1"); await A.click("#send-form .primary"); await ver(A, "mensagem-antiga-1", { meu: true });
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await ver(B, "mensagem-antiga-1");
  await B.fill("#text", "resposta-antiga-2"); await B.click("#send-form .primary"); await ver(A, "resposta-antiga-2");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("aparelho novo da mesma conta NÃO lê o que já foi trocado (o motivo da exportação)", async () => {
  const c2 = await browser.newContext({ viewport: { width: 1100, height: 780 }, acceptDownloads: true }); await compartilhaCodigo(c2, A); A2 = await c2.newPage(); A2.on("pageerror", (e) => erros.push(`A2: ${e.message}`));
  await A2.goto(srv.url); await A2.fill("#email", emailA); await A2.fill("#password", SENHA); await A2.click("#auth-submit");
  await A2.waitForSelector("#ask[open]", { timeout: 30000 }); await A2.fill("#ask-input", FRASE); await A2.click("#ask button[value=ok]"); await A2.waitForSelector(pronto, { timeout: 30000 });
  await A2.waitForSelector("#contacts button", { timeout: 30000 }); await A2.click("#contacts button"); await A2.waitForSelector("#messages .msg", { timeout: 30000 });
  assert.equal(await A2.locator('.msg .vis:has-text("mensagem-antiga-1")').count(), 0); assert.equal(await A2.locator('.msg .vis:has-text("resposta-antiga-2")').count(), 0);
});
t("exportar com senha gerada: baixa um arquivo sem nada legível", async () => {
  await abrirSeg(A); await A.click("#mfa-exp"); await A.waitForSelector("#choice[open]");
  await A.click('#choice-actions button[value="gerar"]'); await A.waitForFunction(() => /Anote esta senha/.test(document.getElementById("choice-title").textContent));
  senhaArq = (await A.locator("#choice-text").innerText()).match(/[a-z2-9]{4}(-[a-z2-9]{4}){4}/)[0];
  const [d] = await Promise.all([A.waitForEvent("download", { timeout: 60000 }), A.click('#choice-actions button[value="ok"]')]);
  assert.match(d.suggestedFilename(), /^lacre-historico-\d{4}-\d{2}-\d{2}\.lacre$/);
  arquivo = join(tmpdir(), `lacre-hist-${Date.now()}.lacre`); await d.saveAs(arquivo);
  const txt = readFileSync(arquivo, "utf8"); assert.ok(!txt.includes("mensagem-antiga-1") && !txt.includes("resposta-antiga-2"), "texto não aparece no arquivo");
  await A.waitForFunction(() => /Arquivo gerado com \d+ mensagens/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
});
t("importar com senha errada: recusa e não traz nada; arquivo qualquer: recusa", async () => {
  await abrirSeg(A2);
  await A2.setInputFiles("#mfa-file", arquivo); await A2.waitForSelector("#ask[open]"); await A2.fill("#ask-input", "senha-errada-qualquer-1"); await A2.click("#ask button[value=ok]");
  await A2.waitForFunction(() => /Senha errada/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
  const lixo = join(tmpdir(), `lixo-${Date.now()}.lacre`); writeFileSync(lixo, "isto nao e um historico");
  await A2.setInputFiles("#mfa-file", lixo); await A2.waitForSelector("#ask[open]"); await A2.fill("#ask-input", senhaArq); await A2.click("#ask button[value=ok]");
  await A2.waitForFunction(() => /não é um histórico/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
});
t("importar com a senha certa: as mensagens antigas aparecem", async () => {
  await A2.setInputFiles("#mfa-file", arquivo); await A2.waitForSelector("#ask[open]"); await A2.fill("#ask-input", senhaArq.toUpperCase().replaceAll("-", " ")); await A2.click("#ask button[value=ok]");
  await A2.waitForFunction(() => /Pronto: \d+ mensagens importadas/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
  await A2.click("#mfa button[value=cancel]");
  await ver(A2, "mensagem-antiga-1", { meu: true }); await ver(A2, "resposta-antiga-2");
});
t("importar de novo não duplica; arquivo de outra conta é recusado", async () => {
  await abrirSeg(A2); await A2.setInputFiles("#mfa-file", arquivo); await A2.waitForSelector("#ask[open]"); await A2.fill("#ask-input", senhaArq); await A2.click("#ask button[value=ok]");
  await A2.waitForFunction(() => /Pronto: 0 mensagens importadas/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
  await A2.click("#mfa button[value=cancel]"); await ver(A2, "mensagem-antiga-1", { meu: true }); assert.equal(await A2.locator('.msg .vis:has-text("mensagem-antiga-1")').count(), 1);
  await abrirSeg(B); await B.setInputFiles("#mfa-file", arquivo); await B.waitForSelector("#ask[open]"); await B.fill("#ask-input", senhaArq); await B.click("#ask button[value=ok]");
  await B.waitForFunction(() => /Senha errada, arquivo de outra conta/.test(document.getElementById("mfa-msg").textContent), null, { timeout: 60000 });
});
t("escolher a própria senha: curta é recusada e confirmação diferente também", async () => {
  await A.click("#mfa button[value=cancel]"); await abrirSeg(A); await A.click("#mfa-exp"); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="minha"]'); await A.waitForSelector("#ask[open]");
  await A.fill("#ask-input", "curta"); await A.click("#ask button[value=ok]"); await A.waitForFunction(() => /pelo menos 16/.test(document.getElementById("ask-text").textContent));
  await A.fill("#ask-input", "uma-senha-propria-bem-longa"); await A.click("#ask button[value=ok]"); await A.waitForFunction(() => /^Confirme/.test(document.getElementById("ask-title").textContent));
  await A.fill("#ask-input", "outra-coisa-bem-diferente"); await A.click("#ask button[value=ok]"); await A.waitForFunction(() => /não são iguais/.test(document.getElementById("ask-text").textContent));
  await A.click("#ask button[value=cancel]").catch(() => {});
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
