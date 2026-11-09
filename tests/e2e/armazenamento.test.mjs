// Armazenamento: mostra o que o aparelho guarda e o que a pessoa enviou; "Liberar espaço" só apaga o cache de arquivos (nunca mensagens).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, menuConta, chamar } from "./env.mjs";
import { hasFfmpeg, tmp, makeJpegWithExif } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, foto; const erros = [];
const t = (nome, fn, { ffmpeg = false } = {}) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
const abrirArm = async (p) => { await menuConta(p, "#arm-btn"); await p.waitForSelector("#armaz[open]"); await p.waitForFunction(() => !/Calculando/.test(document.getElementById("arm-srv-txt").textContent), null, { timeout: 15000 }); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  if (hasFfmpeg()) foto = makeJpegWithExif(tmp());
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  A = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); B = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage();
  for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  const nomeB = novoUsuario("b"); await cadastrar(A, novoUsuario("a")); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector("#send-form:not([hidden])");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("conta nova: tudo zerado, 'liberar espaço' desligado, e o resumo aparece no menu", async () => {
  await abrirArm(A);
  assert.match(await A.locator("#arm-cache-txt").innerText(), /^0 KB de no máximo 150 MB · 0 arquivos$/); assert.match(await A.locator("#arm-srv-txt").innerText(), /^0 KB de 400 MB · 0 arquivos$/);
  assert.equal(await A.locator("#arm-limpar").isDisabled(), true); assert.match(await A.locator("#arm-hist-txt").innerText(), /mensage/);
  await A.click("#armaz button[value=cancel]"); await menuConta(A); assert.match(await A.locator("#arm-resumo").innerText(), /neste aparelho/); await A.keyboard.press("Escape");
});
t("quem envia vê o tamanho no servidor; quem recebe e abre vê o cache; nenhum vê o do outro", async () => {
  await A.setInputFiles("#file", foto); await A.waitForSelector("#pending-info.ok", { timeout: 25000 }); await A.fill("#text", "foto de teste"); await A.click("#send-form .primary");
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 30000 });
  await A.waitForSelector(".msg.mine .media img", { timeout: 30000 }); await B.waitForTimeout(600);
  await abrirArm(A); const a = await A.locator("#arm-srv-txt").innerText(); assert.match(a, /· 1 arquivo$/); assert.ok(!/^0 KB/.test(a), "o servidor mostra o que A enviou: " + a);
  await A.click("#armaz button[value=cancel]");
  await abrirArm(B); assert.match(await B.locator("#arm-srv-txt").innerText(), /^0 KB de 400 MB · 0 arquivos$/, "B não enviou nada: não vê o arquivo de A");
  const c = await B.locator("#arm-cache-txt").innerText(); assert.ok(!/^0 KB/.test(c) && /· 1 arquivo$/.test(c), "B guardou a foto aberta: " + c);
  assert.equal(await B.locator("#arm-limpar").isDisabled(), false);
});
t("Liberar espaço: pede confirmação; cancelar não apaga; confirmar zera o cache e MANTÉM as mensagens", async () => {
  await B.click("#arm-limpar"); await B.waitForSelector("#choice[open]"); assert.match(await B.locator("#choice-text").innerText(), /Nenhuma mensagem será apagada/);
  await B.click('#choice button:has-text("Cancelar")'); await B.waitForFunction(() => !document.getElementById("choice").open); assert.match(await B.locator("#arm-cache-txt").innerText(), /· 1 arquivo$/, "cancelar não apagou nada");
  await B.click("#arm-limpar"); await B.waitForSelector("#choice[open]"); await B.click('#choice button[value="sim"]');
  await B.waitForFunction(() => /^0 KB de no máximo/.test(document.getElementById("arm-cache-txt").textContent), null, { timeout: 10000 });
  assert.match(await B.locator("#arm-msg").innerText(), /Pronto: .* liberados/); assert.equal(await B.locator("#arm-limpar").isDisabled(), true);
  await B.click("#armaz button[value=cancel]");
  assert.equal(await B.locator(".msg .vis", { hasText: "foto de teste" }).count(), 1, "a mensagem continua na conversa");
});
t("depois de liberar: recarregar mantém a mensagem e a foto baixa de novo (servidor intacto)", async () => {
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.click("#contacts button");
  await B.waitForSelector(".msg:not(.mine) .vis:has-text('foto de teste')", { timeout: 20000 }); await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 30000 });
  await abrirArm(B); assert.match(await B.locator("#arm-cache-txt").innerText(), /· 1 arquivo$/, "baixou e guardou de novo");
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
