// Notificações push: sino liga/desliga, registro do aparelho, service worker (sem conteúdo; quieto com o site aberto), flag de aviso nas mensagens.
// O serviço de push real (Google/Apple/Mozilla) não existe no navegador de teste: a inscrição é simulada; o resto (sw.js, banco, função) é real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, ctx, A, B, emailA, nomeB, endpointFalso; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const PRONTO = "#chat:not([hidden]):not(.preparando)";
// inscrição de push simulada (o navegador de teste não fala com o Google): mesma forma da real
const falsa = `(() => {
  const rnd = () => Math.random().toString(36).slice(2, 10), b = (n) => "B" + "x".repeat(n - 1);
  const guard = () => { try { return JSON.parse(localStorage.getItem("__sub") || "null"); } catch { return null; } };
  const monta = (d) => ({ endpoint: d.endpoint, options: { applicationServerKey: Uint8Array.from(d.chave).buffer }, toJSON() { return { endpoint: d.endpoint, keys: { p256dh: b(87), auth: "a".repeat(22) } }; }, async unsubscribe() { localStorage.removeItem("__sub"); return true; } });
  if (window.PushManager) {
    PushManager.prototype.getSubscription = async function () { const d = guard(); return d ? monta(d) : null; };
    PushManager.prototype.subscribe = async function (o) { const d = { endpoint: "https://push.example/" + rnd() + rnd(), chave: Array.from(new Uint8Array(o.applicationServerKey)) }; localStorage.setItem("__sub", JSON.stringify(d)); return monta(d); };
  }
})();`;
const linhas = (p) => p.evaluate(async ({ url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), tk = JSON.parse(localStorage[k]).access_token;
  const r = await fetch(`${url}/rest/v1/push_subscriptions?select=endpoint`, { headers: { Authorization: "Bearer " + tk, apikey: key } }); return (await r.json()).map((x) => x.endpoint); }, { url: SUPABASE_URL, key: SUPABASE_KEY });
const ultimas = (p, n = 2) => p.evaluate(async ({ url, key, n }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), tk = JSON.parse(localStorage[k]).access_token;
  const r = await fetch(`${url}/rest/v1/messages?select=id,avisar,notificada&order=id.desc&limit=${n}`, { headers: { Authorization: "Bearer " + tk, apikey: key } }); return r.json(); }, { url: SUPABASE_URL, key: SUPABASE_KEY, n });
async function cadastrar(page, usuario, email) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", email); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector(PRONTO, { timeout: 30000 });
}
const swDe = async () => { for (let i = 0; i < 50; i++) { const w = ctx.serviceWorkers().find((x) => x.url().endsWith("/sw.js")); if (w) return w; await new Promise((r) => setTimeout(r, 200)); } throw new Error("sem service worker"); };

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); // notificações exigem o Chromium completo ("novo headless"): o "headless shell" padrão do Playwright recusa a permissão de notificações
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" });
  ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, permissions: ["notifications"] }); await ctx.addInitScript(falsa);
  A = await ctx.newPage(); A.on("pageerror", (e) => erros.push(e.message));
  B = await (await browser.newContext()).newPage(); emailA = novoEmail(); nomeB = novoUsuario("b");
  await cadastrar(A, novoUsuario("a"), emailA); await cadastrar(B, nomeB, novoEmail());
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o sino começa desligado; ligar pede permissão, registra o aparelho no banco e fica ligado", async () => {
  assert.equal(await A.locator("#notif-btn").getAttribute("aria-pressed"), "false"); assert.deepEqual(await linhas(A), []);
  await menuConta(A, "#notif-btn"); await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "true", null, { timeout: 30000 });
  const l = await linhas(A); assert.equal(l.length, 1); assert.match(l[0], /^https:\/\/push\.example\//); endpointFalso = l[0];
  assert.match(await A.locator("#notif-btn").getAttribute("aria-label"), /ligadas/);
});
t("recarregar mantém ligado e o aparelho continua registrado (sem duplicar)", async () => {
  await A.reload(); await A.waitForSelector(PRONTO, { timeout: 30000 }); await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "true");
  await A.waitForTimeout(800); assert.deepEqual(await linhas(A), [endpointFalso]);
});
t("service worker: com o Lacre aberto na tela NÃO mostra notificação", async () => {
  const sw = await swDe();
  await sw.evaluate(async () => { for (const n of await self.registration.getNotifications()) n.close(); self.dispatchEvent(new PushEvent("push")); });
  await A.waitForTimeout(900); assert.equal(await sw.evaluate(async () => (await self.registration.getNotifications()).length), 0);
});
t("service worker: com o Lacre fechado mostra um aviso genérico, sem nome nem conteúdo; tocar nele abre o Lacre", async () => {
  const sw = await swDe(); await A.goto("about:blank");
  await sw.evaluate(() => { self.dispatchEvent(new PushEvent("push")); });
  await new Promise((ok) => setTimeout(ok, 1200));
  const n = await sw.evaluate(async () => (await self.registration.getNotifications()).map((x) => ({ title: x.title, body: x.body, tag: x.tag, data: x.data })));
  assert.equal(n.length, 1); assert.equal(n[0].title, "Lacre"); assert.equal(n[0].body, "Você tem uma nova mensagem"); assert.equal(n[0].tag, "lacre"); assert.doesNotMatch(JSON.stringify(n[0]), /@|[0-9a-f]{8}-[0-9a-f]{4}/, "nada de nomes nem ids");
  // tocar no aviso: fecha o aviso e tenta abrir/focar o Lacre (abrir janela de verdade exige um toque real, que o teste não tem)
  await sw.evaluate(async () => { const [x] = await self.registration.getNotifications(); self.dispatchEvent(new NotificationEvent("notificationclick", { notification: x })); });
  await new Promise((ok) => setTimeout(ok, 800)); assert.equal(await sw.evaluate(async () => (await self.registration.getNotifications()).length), 0, "o aviso some depois de tocar");
  await A.goto(srv.url); await A.waitForSelector(PRONTO, { timeout: 30000 });
});
t("mensagem normal pede aviso; apagar para todos e 'hello' NÃO pedem (o servidor não avisa de coisa invisível)", async () => {
  await chamar(B, await A.evaluate(() => document.getElementById("nome-txt").textContent.replace("@", ""))); await B.waitForSelector("#send-form:not([hidden])");
  await B.fill("#text", "ping"); await B.click("#send-form .primary"); await B.waitForSelector('.msg.mine .vis:text-is("ping")'); await B.waitForTimeout(800);
  const [m] = await ultimas(B, 1); assert.equal(m.avisar, true);
  await B.locator('.msg:has(.vis:text-is("ping")) .bubble').first().click({ button: "right" }); await B.locator(".picker .apagar").click(); await B.click("#choice button[value=todos]"); await B.waitForSelector(".bubble.apagada"); await B.waitForTimeout(800);
  const [ap] = await ultimas(B, 1); assert.equal(ap.avisar, false, "o pedido de apagar não gera aviso");
});
t("a função do servidor responde com a chave pública (65 bytes) e recusa pedidos que não são de uma mensagem real", async () => {
  const r = await (await fetch(`${SUPABASE_URL}/functions/v1/notificar`)).json(); assert.equal(Buffer.from(r.chave.replaceAll("-", "+").replaceAll("_", "/"), "base64").length, 65);
  const f = await (await fetch(`${SUPABASE_URL}/functions/v1/notificar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensagem: 1, destinatario: "00000000-0000-0000-0000-000000000000" }) })).json(); assert.equal(f.ok, false);
  const r2 = await fetch(`${SUPABASE_URL}/functions/v1/notificar`, { method: "POST", headers: { "content-type": "application/json" }, body: "lixo" }); assert.equal(r2.status, 400);
});
t("desligar o sino apaga o registro do aparelho", async () => {
  await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "true"); await menuConta(A, "#notif-btn");
  await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "false", null, { timeout: 30000 }); assert.deepEqual(await linhas(A), []);
});
t("sair da conta tira o aparelho da lista (outra pessoa que entrar aqui não recebe os avisos desta)", async () => {
  await menuConta(A, "#notif-btn"); await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "true", null, { timeout: 30000 }); assert.equal((await linhas(A)).length, 1);
  await menuConta(A, "#logout"); await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=keep]"); await A.waitForSelector("#auth:not([hidden])", { timeout: 20000 });
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); assert.ifError((await c.auth.signInWithPassword({ email: emailA, password: SENHA })).error);
  assert.equal((await c.from("push_subscriptions").select("endpoint")).data.length, 0);
  await A.fill("#email", emailA); await A.fill("#password", SENHA); await A.click("#auth-submit"); // (as chaves continuam neste aparelho: não pede a frase-senha)
  await A.waitForSelector(PRONTO, { timeout: 30000 }); await A.waitForFunction(() => document.getElementById("notif-btn").getAttribute("aria-pressed") === "true");
  await A.waitForTimeout(1000); assert.equal((await linhas(A)).length, 1, "ao entrar de novo, o aparelho volta para a lista sozinho");
});
t("iPhone sem o app instalado: explica como instalar em vez de falhar", async () => {
  const c = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  await c.addInitScript(() => { delete window.PushManager; }); const P = await c.newPage();
  await cadastrar(P, novoUsuario("i"), novoEmail()); await menuConta(P, "#notif-btn"); await P.waitForSelector("#note[open]"); assert.match(await P.locator("#note-text").innerText(), /tela inicial/i); await c.close();
});
t("a página aponta o manifesto e o service worker é válido (escopo do site)", async () => {
  const m = await A.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return { href: l.getAttribute("href"), j: await r.json() }; });
  assert.equal(m.href, "manifest.webmanifest"); assert.equal(m.j.display, "standalone"); assert.ok(m.j.icons.some((i) => i.purpose === "maskable") && m.j.icons.some((i) => i.sizes === "192x192"));
  for (const i of m.j.icons) assert.equal((await A.evaluate(async (u) => (await fetch(u)).status, i.src)), 200, i.src);
});
t("sem erros de script", () => assert.deepEqual(erros, []));
