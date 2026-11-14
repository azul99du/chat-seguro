// Abrir o site: a lista de conversas, as não lidas, a foto de perfil e os pontos vermelhos da última vez aparecem NA HORA (antes do servidor responder),
// e a troca pelos dados de verdade não pisca (a lista nunca fica vazia nem mostra "Ninguém por aqui" no meio do caminho).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, uidA;
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const guardada = () => A.evaluate((uid) => localStorage.getItem("lacre:snap:" + uid), uidA).then((s) => (s ? JSON.parse(s) : null));

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ca = await browser.newContext({ viewport: { width: 1000, height: 700 } }), cb = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  // vigia a lista a cada abertura: depois de ter conversas na tela, ela nunca pode ficar vazia nem mostrar "Ninguém por aqui"
  await ca.addInitScript(() => { window.__vigia = { vazia: 0, ninguem: 0, viu: false }; const L = () => document.getElementById("contacts"), E = () => document.getElementById("inbox-empty");
    const quadro = () => { const l = L(), e = E(); if (l) { if (l.childElementCount) window.__vigia.viu = true; else if (window.__vigia.viu) window.__vigia.vazia++; if (window.__vigia.viu && e && getComputedStyle(e).display !== "none") window.__vigia.ninguem++; } requestAnimationFrame(quadro); }; requestAnimationFrame(quadro); });
  [A, B] = [await ca.newPage(), await cb.newPage()]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  uidA = await A.evaluate(() => JSON.parse(localStorage[Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x))]).user.id);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('oi b')"); await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('oi a')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Rapido"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar");
  await A.waitForSelector('#conv-title:text-is("Rapido")', { timeout: 30000 });
  await enviar(B, "mensagem nova no dm"); // A está no grupo: a conversa a dois fica com 1 não lida
  await A.waitForSelector("#contacts button:not([data-grupo]) .unread", { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o aparelho guarda a lista (nomes, horário, não lidas) e os pontos vermelhos da última vez", async () => {
  await A.waitForFunction((uid) => { try { const s = JSON.parse(localStorage.getItem("lacre:snap:" + uid)); return s && s.itens.length === 2 && s.itens.some((i) => i.nl === 1) && s.ponto.mfa === true; } catch { return false; } }, uidA, { timeout: 20000 });
  const s = await guardada(); assert.deepEqual(s.itens.map((i) => i.n).sort(), ["Rapido", nomeB].sort()); assert.ok(s.itens.find((i) => !i.g).t > 0, "a conversa a dois guarda o horário da última mensagem"); assert.equal(s.eu.u, nomeA);
});

t("ao abrir com o servidor LENTO (4 s), a lista, a não lida, a foto de perfil e o ponto vermelho já estão na tela em menos de 1,5 s", async () => {
  // põe uma foto de teste (miniatura) na foto guardada do aparelho e na da conversa a dois, como se elas tivessem foto
  const mini = await A.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 40; const x = c.getContext("2d"); x.fillStyle = "#d22"; x.fillRect(0, 0, 40, 40); return c.toDataURL("image/jpeg", 0.8); });
  await A.evaluate(({ uid, mini }) => { const k = "lacre:snap:" + uid, s = JSON.parse(localStorage.getItem(k)); s.eu.a = "x/eu.jpg"; s.eu.th = mini; for (const i of s.itens) if (!i.g) { i.a = "x/dm.jpg"; i.th = mini; } localStorage.setItem(k, JSON.stringify(s)); }, { uid: uidA, mini });
  await A.route(/\/rest\/v1\//, async (route) => { await dorme(4000); route.continue().catch(() => {}); });
  const t0 = Date.now(); await A.reload({ waitUntil: "domcontentloaded" });
  await A.waitForSelector("#contacts li", { timeout: 1500 }); const ms = Date.now() - t0;
  assert.equal(await A.locator("#contacts li").count(), 2, "as duas conversas já aparecem"); assert.equal(await A.locator("#chat.preparando").count(), 1, "o servidor ainda não respondeu (o app ainda está preparando)");
  assert.equal(await A.locator("#contacts button:not([data-grupo]) .unread").innerText(), "1", "a não lida já aparece"); assert.equal(await A.locator("#contacts button[data-grupo] .who").innerText().then((x) => /Rapido/.test(x)), true);
  assert.equal(await A.locator("#contacts button:not([data-grupo]) .avatar img").count(), 1, "a foto da conversa já aparece (miniatura)"); assert.equal(await A.locator("#eu-foto img").count(), 1, "a foto de perfil já aparece");
  assert.equal(await A.locator("#mfa-nudge").isVisible(), true, "o ponto vermelho já aparece"); assert.equal(await A.locator("#inbox-empty").isVisible(), false, "sem 'Ninguém por aqui'");
  assert.ok(ms < 1500, `demorou ${ms} ms`);
  await A.unroute(/\/rest\/v1\//); await pronto(A); // o servidor responde: os dados de verdade entram
  assert.equal(await A.locator("#contacts li").count(), 2);
  const v = await A.evaluate(() => window.__vigia); assert.deepEqual({ vazia: v.vazia, ninguem: v.ninguem }, { vazia: 0, ninguem: 0 }, "a lista nunca ficou vazia nem mostrou 'Ninguém por aqui' na troca");
});

t("sem lista guardada (primeiro acesso neste aparelho): não aparece 'Ninguém por aqui' enquanto as conversas carregam", async () => {
  await A.evaluate((uid) => localStorage.removeItem("lacre:snap:" + uid), uidA);
  await A.route(/\/rest\/v1\//, async (route) => { await dorme(2500); route.continue().catch(() => {}); });
  await A.reload({ waitUntil: "domcontentloaded" }); await A.waitForSelector("#chat.preparando", { timeout: 5000 });
  assert.equal(await A.locator("#inbox-empty").isVisible(), false, "enquanto carrega, o aviso de lista vazia fica escondido"); assert.equal(await A.locator("#contacts li").count(), 0);
  await A.unroute(/\/rest\/v1\//); await pronto(A); await A.waitForSelector("#contacts li", { timeout: 15000 });
});

t("uma lista guardada adulterada (fora do formato) é ignorada: nada de HTML, e a lista vem do servidor", async () => {
  await A.evaluate((uid) => localStorage.setItem("lacre:snap:" + uid, JSON.stringify({ v: 1, eu: { u: "<img src=x onerror=window.__x=1>" }, ponto: {}, itens: [{ id: "<b>x</b>", n: "<img src=x onerror=window.__x=1>" }] })), uidA);
  await A.reload({ waitUntil: "domcontentloaded" }); await pronto(A); await A.waitForSelector("#contacts li", { timeout: 15000 });
  assert.equal(await A.evaluate(() => window.__x), undefined, "nenhum script rodou"); assert.equal(await A.locator("#contacts li").count(), 2);
});
