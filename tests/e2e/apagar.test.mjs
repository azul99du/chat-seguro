// Apagar mensagens: para todos (vira "Mensagem apagada" nos dois lados), só para mim, e apagar o aviso só para mim. Persiste ao recarregar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";
import { hasFfmpeg, tmp, makeJpegWithExif } from "../helpers/fixtures.mjs";

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
const msg = (txt) => `.msg:has(.vis:text-is("${txt}"))`;
const verTexto = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:text-is("${txt}")`, { timeout: 30000 });
const apagadas = (p) => p.locator(".bubble.apagada").count();
// abre o menu da mensagem (o seletor deve achar UMA .msg) e escolhe Apagar…
const menuApagar = async (p, seletor) => { const m = p.locator(seletor).first(); await m.hover(); await m.locator(".react-btn").click(); await p.locator(".picker .apagar").click(); await p.waitForSelector("#choice[open]"); };
const opcoes = (p) => p.locator("#choice-actions button").evaluateAll((bs) => bs.map((b) => b.value));
const recarregar = async (p) => { await p.reload(); await p.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); await p.click("#contacts button"); await p.waitForSelector("#send-form:not([hidden])"); await p.waitForTimeout(1200); };

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp(); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const [ca, cb] = [await browser.newContext({ viewport: { width: 1100, height: 800 } }), await browser.newContext({ viewport: { width: 1100, height: 800 } })];
  A = await ca.newPage(); B = await cb.newPage(); vigiar("A", A); vigiar("B", B);
  nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await enviar(A, "abrindo a conversa"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await verTexto(B, "abrindo a conversa");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("mensagem recebida: só dá para apagar para mim (não aparece 'para todos'); o autor continua vendo", async () => {
  await enviar(A, "segredo um"); await verTexto(B, "segredo um");
  await menuApagar(B, msg("segredo um")); assert.deepEqual(await opcoes(B), ["mim", "nao"], "quem recebeu não pode apagar para todos");
  await B.click("#choice button[value=nao]"); await verTexto(B, "segredo um");
  await menuApagar(B, msg("segredo um")); await B.click("#choice button[value=mim]");
  await B.waitForSelector(msg("segredo um"), { state: "detached" }); assert.equal(await apagadas(B), 0, "só para mim: não deixa aviso");
  assert.equal(await A.locator(msg("segredo um")).count(), 1, "para o autor a mensagem continua");
});
t("só para mim persiste ao recarregar (sem balão de erro)", async () => {
  await recarregar(B); assert.equal(await B.locator(msg("segredo um")).count(), 0); assert.equal(await B.locator(".bubble.err").count(), 0);
  await verTexto(B, "abrindo a conversa");
});
t("mensagem própria: oferece as duas opções; 'para todos' vira 'Mensagem apagada' nos DOIS lados e o texto some", async () => {
  await enviar(A, "vou apagar para todos"); await verTexto(B, "vou apagar para todos");
  await menuApagar(A, msg("vou apagar para todos")); assert.deepEqual(await opcoes(A), ["todos", "mim", "nao"]);
  await A.click("#choice button[value=todos]");
  await A.waitForSelector(".msg.mine .bubble.apagada"); await B.waitForSelector(".msg:not(.mine) .bubble.apagada", { timeout: 30000 });
  assert.equal(await A.locator(".bubble.apagada .vis").innerText(), "Mensagem apagada"); assert.equal(await B.locator(".bubble.apagada .vis").innerText(), "Mensagem apagada");
  for (const p of [A, B]) assert.equal(await p.locator(msg("vou apagar para todos")).count(), 0, "o texto antigo não está mais na tela");
  assert.equal(await B.evaluate(() => document.body.innerText.includes("vou apagar para todos")), false);
});
t("o aviso persiste ao recarregar nos dois lados, sem o texto antigo", async () => {
  for (const p of [A, B]) { await recarregar(p); assert.equal(await apagadas(p), 1); assert.equal(await p.evaluate(() => document.body.innerText.includes("vou apagar para todos")), false); assert.equal(await p.locator(".bubble.err").count(), 0); }
});
t("o aviso 'Mensagem apagada' só pode ser apagado para mim, e some só de quem apagou", async () => {
  await menuApagar(B, ".msg:has(.bubble.apagada)"); assert.deepEqual(await opcoes(B), ["mim", "nao"]); assert.equal(await B.locator("#choice-text").innerText().then((x) => /só da sua tela/.test(x)), true);
  await B.click("#choice button[value=mim]"); await B.waitForSelector(".bubble.apagada", { state: "detached" });
  assert.equal(await apagadas(A), 1, "para quem apagou para todos o aviso continua");
  await menuApagar(A, ".msg:has(.bubble.apagada)"); assert.deepEqual(await opcoes(A), ["mim", "nao"], "nem o autor apaga o aviso para todos"); await A.click("#choice button[value=nao]");
  await recarregar(B); assert.equal(await apagadas(B), 0, "continua sumido depois de recarregar");
});
t("apagar para todos uma foto: o arquivo cifrado sai do servidor", async () => {
  const foto = makeJpegWithExif(dir, "foto.jpg"); await A.setInputFiles("#file", foto); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary");
  await A.waitForSelector(".msg.mine .media img", { timeout: 30000 }); const caminho = enviados[enviados.length - 1].path; await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 30000 });
  const ler = (p) => p.evaluate(async ({ c, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); const r = await fetch(`${url}/storage/v1/object/authenticated/media/${c}`, { cache: "no-store", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); return r.status; }, { c: caminho, url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.equal(await ler(B), 200, "antes: o arquivo existe");
  await menuApagar(A, ".msg.mine:has(.media img)"); await A.click("#choice button[value=todos]"); await A.waitForSelector(".msg.mine .media", { state: "detached" });
  await B.waitForSelector(".msg:not(.mine) .media", { state: "detached", timeout: 30000 });
  let st = 200; for (let i = 0; i < 20 && st === 200; i++) { st = await ler(A); if (st === 200) await A.waitForTimeout(500); } // confere no dono: o cache de borda do armazenamento (CDN) pode demorar a esquecer o arquivo para outras pessoas
  assert.notEqual(st, 200, "depois: o arquivo não está mais no servidor");
}, { ffmpeg: true });
t("responder a uma mensagem apagada mostra 'Mensagem apagada' na citação", async () => {
  await enviar(A, "pergunta"); await verTexto(B, "pergunta");
  const m = B.locator(msg("pergunta")).first(); await m.hover(); await m.locator(".react-btn").click(); await B.locator(".picker .responder").click(); await enviar(B, "resposta"); await verTexto(A, "resposta");
  await menuApagar(A, msg("pergunta")); await A.click("#choice button[value=todos]"); await A.waitForSelector(".msg.mine .bubble.apagada");
  await B.waitForFunction(() => [...document.querySelectorAll(".msg.mine .q-text")].some((q) => q.textContent === "Mensagem apagada"), null, { timeout: 30000 });
  assert.equal(await B.locator(".msg.mine:has(.vis:text-is('resposta')) .q-text").innerText(), "Mensagem apagada");
});
t("nenhum erro de script", () => assert.deepEqual(erros, []));
