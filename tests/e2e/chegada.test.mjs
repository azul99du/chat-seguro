// Rede de segurança da chegada: se o tempo real do servidor perde um aviso (conexão que oscila, evento perdido), a mensagem aparece mesmo assim
// pela verificação periódica. Aqui o canal em tempo real de quem recebe é derrubado de propósito.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB;
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctxA = await browser.newContext({ viewport: { width: 1100, height: 800 } }), ctxB = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctxA.addInitScript(() => { try { localStorage.setItem("lacre:poll", "1500"); } catch {} }); // verificação a cada 1,5 s (o normal é 30 s) para o teste não demorar
  await ctxA.routeWebSocket(/\/realtime\//, (ws) => ws.close()); // quem recebe fica sem tempo real
  [A, B] = [await ctxA.newPage(), await ctxB.newPage()]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("sem tempo real, a mensagem do outro aparece na conversa aberta e a bolinha de não lida aparece na lista, só pela verificação periódica", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
  await B.waitForSelector(".msg:not(.mine) .vis:has-text('oi b')", { timeout: 30000 });
  await enviar(B, "oi a, de volta");
  await A.waitForSelector(".msg:not(.mine) .vis:has-text('oi a, de volta')", { timeout: 30000 });
  assert.equal(await A.locator(".msg:not(.mine) .vis:has-text('oi a, de volta')").count(), 1, "aparece uma vez só");
});
