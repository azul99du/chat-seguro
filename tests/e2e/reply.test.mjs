// Responder a mensagens (citação): texto, foto e áudio; barra "Respondendo a…"; ir até a original; persistir; cancelar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";
import { hasFfmpeg, tmp, makeAudio, makeJpegWithExif } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, dir; const erros = [], enviados = [];
const t = (nome, fn, { ffmpeg = false } = {}) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden])", { timeout: 30000 });
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome}: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const ver = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:has-text("${txt}")`, { timeout: 30000 });
// abre o menu da mensagem que contém `txt` e toca em Responder
async function responderA(p, seletorMsg) { const m = p.locator(seletorMsg).first(); await m.hover(); await m.locator(".react-btn").click(); await p.locator(".picker .responder").click(); }
const msgCom = (txt) => `.msg:has(.vis:text-is("${txt}"))`;

before(async () => {
  if (skip) return;
  const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const [ca, cb] = [await browser.newContext({ viewport: { width: 1100, height: 760 } }), await browser.newContext({ viewport: { width: 1100, height: 760 } })];
  A = await ca.newPage(); B = await cb.newPage(); vigiar("A", A); vigiar("B", B);
  nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await enviar(A, "qual o horário do jantar?"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await ver(B, "qual o horário do jantar?");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("o menu da mensagem tem os 6 emojis e o botão Responder", async () => {
  const m = B.locator(msgCom("qual o horário do jantar?")); await m.hover(); await m.locator(".react-btn").click();
  assert.equal(await B.locator(".picker .emojis button").count(), 6); assert.equal(await B.locator(".picker .responder").innerText(), "Responder");
  await B.keyboard.press("Escape"); await B.mouse.click(5, 5); await B.waitForSelector(".picker", { state: "detached" });
});
t("responder a um texto: aparece a barra 'Respondendo a…', e a citação chega nos dois lados", async () => {
  await responderA(B, msgCom("qual o horário do jantar?"));
  await B.waitForSelector("#replybar:not([hidden])");
  assert.equal(await B.locator("#reply-who").innerText(), `Respondendo a @${nomeA}`); assert.equal(await B.locator("#reply-text").innerText(), "qual o horário do jantar?");
  assert.equal(await B.evaluate(() => document.activeElement.id), "text", "o foco vai para o campo de mensagem");
  await enviar(B, "às 20h");
  await B.waitForSelector("#replybar", { state: "hidden" });                                    // a barra some depois de enviar
  const meu = B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote");                        // B vê a citação do que A escreveu
  assert.equal(await meu.locator(".q-who").innerText(), `@${nomeA}`); assert.equal(await meu.locator(".q-text").innerText(), "qual o horário do jantar?");
  await ver(A, "às 20h"); const dele = A.locator(".msg:not(.mine):has(.vis:text-is('às 20h')) .quote"); // A vê que respondeu à própria mensagem
  assert.equal(await dele.locator(".q-who").innerText(), "Você"); assert.equal(await dele.locator(".q-text").innerText(), "qual o horário do jantar?");
});
t("tocar na citação leva até a mensagem original e a destaca", async () => {
  for (let i = 0; i < 14; i++) { await enviar(A, "enchimento " + i); await ver(A, "enchimento " + i, { meu: true }); } await ver(B, "enchimento 13"); // espera cada envio terminar antes do próximo                // empurra a original para fora da tela
  await B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote").click();
  await B.waitForSelector(`${msgCom("qual o horário do jantar?")}.flash`, { timeout: 5000 });
  assert.equal(await B.locator(msgCom("qual o horário do jantar?")).evaluate((n) => { const r = n.getBoundingClientRect(), m = document.getElementById("messages").getBoundingClientRect(); return r.top >= m.top - 2 && r.bottom <= m.bottom + 2; }), true, "a original ficou visível");
  await B.waitForSelector(`${msgCom("qual o horário do jantar?")}.flash`, { state: "detached", timeout: 4000 });  // o destaque some sozinho
});
t("cancelar: pelo botão × e pela tecla Esc; a mensagem seguinte sai sem citação", async () => {
  await responderA(B, msgCom("enchimento 3")); await B.waitForSelector("#replybar:not([hidden])"); await B.click("#reply-x"); await B.waitForSelector("#replybar", { state: "hidden" });
  await responderA(B, msgCom("enchimento 4")); await B.waitForSelector("#replybar:not([hidden])"); await B.focus("#text"); await B.keyboard.press("Escape"); await B.waitForSelector("#replybar", { state: "hidden" });
  await enviar(B, "sem citação"); await ver(A, "sem citação");
  assert.equal(await B.locator(".msg.mine:has(.vis:text-is('sem citação')) .quote").count(), 0); assert.equal(await A.locator(".msg:not(.mine):has(.vis:text-is('sem citação')) .quote").count(), 0);
});
t("recarregar: as citações voltam do histórico do aparelho", async () => {
  await B.reload(); await B.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); await B.waitForSelector("#contacts button"); await B.click("#contacts button"); await ver(B, "às 20h", { meu: true });
  assert.equal(await B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote .q-text").innerText(), "qual o horário do jantar?");
});
t("responder a uma FOTO e a um ÁUDIO: a citação mostra 'Foto · legenda' e 'Áudio · duração'", async () => {
  await A.setInputFiles("#file", makeJpegWithExif(dir)); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await enviar(A, "praia"); await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 40000 });
  await responderA(B, ".msg:has(.media img)"); assert.equal(await B.locator("#reply-text").innerText(), "Foto · praia");
  await enviar(B, "que lindo!"); await ver(A, "que lindo!");
  assert.equal(await A.locator(".msg:not(.mine):has(.vis:text-is('que lindo!')) .quote .q-text").innerText(), "Foto · praia");
  await A.setInputFiles("#file", makeAudio(dir, "mp3")); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary");
  await B.waitForSelector(".msg:not(.mine) .media.audio", { timeout: 40000 });
  await responderA(B, ".msg:has(.media.audio)"); assert.match(await B.locator("#reply-text").innerText(), /^Áudio · 0:0[1-3]$/);
  await enviar(B, "ouvi, valeu"); await ver(A, "ouvi, valeu");
  assert.match(await A.locator(".msg:not(.mine):has(.vis:text-is('ouvi, valeu')) .quote .q-text").innerText(), /^Áudio · 0:0[1-3]$/);
}, { ffmpeg: true });
t("responder a uma resposta (cadeia): a citação mostra só a mensagem anterior, sem aninhar", async () => {
  await responderA(A, msgCom("ouvi, valeu")); await enviar(A, "de nada"); await ver(B, "de nada");
  const q = B.locator(".msg:not(.mine):has(.vis:text-is('de nada')) .quote"); assert.equal(await q.locator(".q-text").innerText(), "ouvi, valeu"); assert.equal(await q.locator(".quote").count(), 0);
}, { ffmpeg: true });
t("citação de uma mensagem que NÃO está na tela: mostra o resumo recebido, marca como não verificado e avisa ao tocar", async () => {
  await enviar(A, "alvo antigo"); await ver(B, "alvo antigo");
  await responderA(B, msgCom("alvo antigo")); await enviar(B, "resposta recente"); await ver(A, "resposta recente", { meu: false });
  // o histórico passa a trazer só a mensagem mais nova (como numa conversa com milhares de mensagens)
  await B.route("**/rest/v1/messages?*", async (route) => {
    if (route.request().method() !== "GET" || !/select=\*/.test(route.request().url())) return route.continue();
    const r = await route.fetch(), linhas = await r.json();
    await route.fulfill({ response: r, json: linhas.length ? [linhas.reduce((a, b) => (a.id > b.id ? a : b))] : [] });
  });
  await B.reload(); await B.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); await B.waitForSelector("#contacts button"); await B.click("#contacts button");
  await ver(B, "resposta recente", { meu: true });
  assert.equal(await B.locator(".msg .vis").count(), 1, "só a mensagem mais nova está na tela");
  const q = B.locator(".quote.sem-original"); await q.waitFor();
  assert.equal(await q.locator(".q-text").innerText(), "alvo antigo"); assert.equal(await q.locator(".q-who").innerText(), `@${nomeA}`);
  await q.click(); await B.waitForSelector("#note[open]"); assert.match(await B.locator("#note-text").innerText(), /não está mais nesta tela/);
  await B.click("#note button"); await B.unroute("**/rest/v1/messages?*");
});
t("nenhum erro de JavaScript nem violação da política de segurança", async () => { assert.deepEqual(erros, []); });
