// Aparelhos conectados: cada entrada na conta é registrada (navegador, sistema, local aproximado, datas), só a própria pessoa vê, e quem saiu aparece como "Saiu".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, P2, email; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = "#chat:not([hidden]):not(.preparando)";
const abrir = async (p) => { await menuConta(p, "#sec-btn"); await p.waitForSelector("#mfa[open]"); await p.click("#mfa-aparelhos"); await p.waitForSelector("#aparelhos[open]"); await p.waitForFunction(() => document.querySelectorAll("#aparelhos-lista .linha").length > 0, null, { timeout: 20000 }); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); P.on("pageerror", (e) => erros.push(e.message)); email = novoEmail();
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("d")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE); await P.click("#ask button[value=ok]"); await P.waitForSelector(pronto, { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a lista mostra ESTE aparelho com navegador, sistema, local e datas, e avisa que o IP não é guardado", async () => {
  await abrir(P); const itens = P.locator("#aparelhos-lista .linha"); assert.equal(await itens.count(), 1);
  const txt = await itens.first().innerText(); assert.match(txt, /Chrome no Linux|Chrome no /, txt); assert.match(txt, /Este aparelho/);
  assert.match(txt, /(aproximado|Local indisponível)/, "tem local (ou diz que não está disponível)"); assert.match(txt, /Entrou em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/); assert.match(txt, /Último acesso em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  assert.match(await P.locator("#aparelhos .pg-nota").innerText(), /não guarda o IP/);
});
t("segundo aparelho entra: aparece na lista do primeiro; quando ele sai, passa a 'Saiu'", async () => {
  P2 = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); P2.on("pageerror", (e) => erros.push(e.message));
  await P2.goto(srv.url); await P2.fill("#email", email); await P2.fill("#password", SENHA); await P2.click("#auth-submit");
  await P2.waitForSelector("#ask[open]", { timeout: 30000 }); await P2.fill("#ask-input", FRASE); await P2.click("#ask button[value=ok]"); await P2.waitForSelector(pronto, { timeout: 30000 });
  await P2.waitForTimeout(1500);
  await P.click("#aparelhos button[value=cancel]"); await P.click("#mfa button[value=cancel]"); await abrir(P);
  assert.equal(await P.locator("#aparelhos-lista .linha").count(), 2); assert.equal(await P.locator("#aparelhos-lista .linha.atual").count(), 1, "só um é 'Este aparelho'");
  assert.equal(await P.locator("#aparelhos-lista .linha:not(.atual) .selo-estado").first().innerText(), "Sessão ativa");
  await menuConta(P2, "#logout"); await P2.waitForSelector("#choice[open]"); await P2.click("#choice button[value=keep]"); await P2.waitForSelector("#auth:not([hidden])", { timeout: 15000 });
  await P.click("#aparelhos button[value=cancel]"); await P.click("#mfa button[value=cancel]"); await abrir(P);
  assert.equal(await P.locator("#aparelhos-lista .linha:not(.atual) .selo-estado").first().innerText(), "Saiu");
});
t("no servidor: ninguém lê a tabela direto, sem login a função recusa, e a lista de uma pessoa não mostra a de outra", async () => {
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await c.auth.signUp({ email: novoEmail(), password: SENHA }); assert.ok(s.data.session);
  assert.ok((await c.from("aparelhos").select("*")).error, "a tabela não é legível direto");
  const proprio = await c.rpc("meus_aparelhos"); assert.ifError(proprio.error); assert.deepEqual(proprio.data, [], "uma conta nova não vê os aparelhos de outra");
  const sem = await fetch(SUPABASE_URL + "/functions/v1/aparelho", { method: "POST", headers: { apikey: SUPABASE_KEY, "content-type": "application/json" }, body: "{}" }); assert.ok([401, 403].includes(sem.status), "sem login: " + sem.status);
  const anon = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }); assert.ok((await anon.rpc("meus_aparelhos")).error, "sem login a lista é recusada");
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
