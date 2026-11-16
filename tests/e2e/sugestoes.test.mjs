// Sugestões: item no menu da foto, quadro público (só com conta), nome opcional, data, curtir, apagar as minhas, limite de 5 por dia (apagar não devolve) e de 202 caracteres.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, menuConta, SENHA, FRASE } from "./env.mjs";
import { dataCarimbo, MAX_SUGESTAO } from "../../sugestoes.js";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [], listas = [];
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const abrir = async (p) => { await menuConta(p, "#sug-btn"); await p.waitForSelector("#sugestoes[open]"); await p.waitForSelector("#sg-resumo:not(:empty)", { timeout: 20000 }); await p.waitForFunction(() => document.querySelector("#sg-quadro").children.length > 0 || !document.querySelector("#sg-vazio").hidden, null, { timeout: 20000 }); };
const fechar = async (p) => { await p.click("#sugestoes .pg-volta"); await p.waitForSelector("#sugestoes:not([open])", { state: "attached" }); };
const unico = () => `ideia ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nota = (p, texto) => p.locator(`#sg-quadro .sg-nota:has(p:text-is("${texto}"))`);
async function mandar(p, texto, { nome } = {}) { // nome: true/false força o botão do nome; indefinido deixa como está
  if (nome !== undefined && (await p.getAttribute("#sg-nome", "aria-pressed")) !== String(nome)) await p.click("#sg-nome");
  await p.fill("#sg-texto", texto); await p.click("#sg-enviar"); await p.waitForFunction((x) => !document.querySelector("#sg-texto").value, null, { timeout: 15000 }).catch(() => {});
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async () => { const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } }), p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(e.message)); p.on("response", async (r) => { if (r.url().includes("/rpc/sugestao_lista")) listas.push(await r.text().catch(() => "")); }); return p; };
  [A, B] = [await novo(), await novo()]; [nomeA, nomeB] = [novoUsuario("sa"), novoUsuario("sb")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a opção Sugestões fica no menu da foto e abre a tela; o botão do nome mostra o @ da pessoa; o campo limita a 202 caracteres", async () => {
  await menuConta(A); assert.equal(await A.locator("#sug-btn").isVisible(), true); assert.match(await A.locator("#sug-btn").innerText(), /Sugestões/);
  await A.click("#sug-btn"); await A.waitForSelector("#sugestoes[open]"); assert.equal(await A.locator("#menu-conta").isHidden(), true, "o menu fecha ao abrir a tela");
  assert.equal((await A.locator("#sugestoes h2").innerText()).trim(), "Sugestões"); await A.waitForSelector("#sg-resumo:not(:empty)", { timeout: 20000 }); assert.match(await A.locator("#sg-resumo").innerText(), /sugest.* públicas/);
  assert.equal(await A.getAttribute("#sg-nome", "aria-pressed"), "true"); assert.equal((await A.locator("#sg-nome").innerText()).trim(), "@" + nomeA, "por padrão o nome aparece");
  assert.equal(await A.getAttribute("#sg-texto", "maxlength"), String(MAX_SUGESTAO)); assert.equal(await A.isDisabled("#sg-enviar"), true, "vazio não envia");
  await A.fill("#sg-texto", "x".repeat(300)); assert.equal((await A.inputValue("#sg-texto")).length, MAX_SUGESTAO); assert.match(await A.locator("#sg-info").innerText(), /202\/202 · restam 5 hoje/); await A.fill("#sg-texto", ""); await fechar(A);
});
t("enviar com nome: a nota aparece no topo com a data de hoje e o @ de quem mandou; quem tem conta vê; anônima não mostra nem entrega o nome", async () => {
  const comNome = unico(), anonima = unico(); await abrir(A);
  await mandar(A, comNome, { nome: true }); await nota(A, comNome).waitFor({ timeout: 15000 });
  const hoje = dataCarimbo(new Date().toISOString()); assert.equal(await A.locator("#sg-quadro .sg-nota").first().locator("p").innerText(), comNome, "a mais nova vem primeiro");
  assert.equal((await nota(A, comNome).locator(".sg-carimbo").innerText()).trim(), hoje, "a data de envio é mostrada"); assert.equal((await nota(A, comNome).locator(".sg-por").innerText()).trim(), "— @" + nomeA);
  await mandar(A, anonima, { nome: false }); await nota(A, anonima).waitFor({ timeout: 15000 }); assert.match(await nota(A, anonima).locator(".sg-por").innerText(), /anônimo/); assert.equal(await A.getAttribute("#sg-nome", "aria-pressed"), "false");
  assert.match(await A.locator("#sg-info").innerText(), /restam 3 hoje/); assert.match(await A.locator("#sg-info").innerText(), /Anônimo/);
  await abrir(B); assert.equal((await nota(B, comNome).locator(".sg-por").innerText()).trim(), "— @" + nomeA, "outra pessoa com conta vê a sugestão e o nome"); assert.match(await nota(B, anonima).locator(".sg-por").innerText(), /anônimo/);
  assert.equal((await nota(B, anonima).locator(".sg-carimbo").innerText()).trim(), hoje); assert.equal(await nota(B, anonima).locator(".sg-apagar").count(), 0, "só quem mandou pode apagar");
  const linha = listas.flatMap((x) => { try { return JSON.parse(x); } catch { return []; } }).find((r) => r.texto === anonima); assert.ok(linha, "a resposta do servidor chegou"); assert.equal(linha.autor, null, "o servidor não entrega o nome de quem ficou anônimo");
  assert.equal(JSON.stringify(linha).includes(nomeA), false); assert.equal(Object.keys(linha).includes("user_id"), false, "nem o id");
  await fechar(B); await fechar(A);
});
t("curtir: uma curtida por pessoa, o total aparece para todos, tirar a curtida desfaz; fica salvo ao reabrir; a ordem 'Mais curtidas' põe a curtida primeiro", async () => {
  const x = unico(), y = unico(); await abrir(A); await mandar(A, x, { nome: true }); await nota(A, x).waitFor(); await mandar(A, y); await nota(A, y).waitFor(); await fechar(A);
  await abrir(B); const nx = nota(B, x); assert.equal(await nx.locator(".sg-like").getAttribute("aria-pressed"), "false"); assert.equal((await nx.locator(".sg-like span").innerText()).trim(), "0");
  await nx.locator(".sg-like").click(); await B.waitForFunction((tx) => [...document.querySelectorAll(".sg-nota")].find((n) => n.querySelector("p").textContent === tx)?.querySelector(".sg-like span").textContent === "1", x, { timeout: 15000 });
  assert.equal(await nx.locator(".sg-like").getAttribute("aria-pressed"), "true"); await fechar(B); await abrir(B); assert.equal(await nota(B, x).locator(".sg-like").getAttribute("aria-pressed"), "true", "a curtida ficou salva");
  assert.equal((await nota(B, x).locator(".sg-like span").innerText()).trim(), "1");
  await B.click('#sg-ordem button[data-ordem="curtidas"]'); await B.waitForFunction(() => document.querySelector('#sg-ordem button[data-ordem="curtidas"]').getAttribute("aria-pressed") === "true" && document.querySelector("#sg-quadro .sg-nota .sg-like span")?.textContent !== "0", null, { timeout: 15000 });
  assert.notEqual((await B.locator("#sg-quadro .sg-nota .sg-like span").first().innerText()).trim(), "0", "na ordem por curtidas, as curtidas vêm primeiro");
  await abrir(A); assert.equal((await nota(A, x).locator(".sg-like span").innerText()).trim(), "1", "quem mandou vê o total"); assert.equal(await nota(A, x).locator(".sg-like").getAttribute("aria-pressed"), "false", "mas a curtida é do B, não dela");
  await fechar(A); await B.click('#sg-ordem button[data-ordem="recentes"]'); await B.waitForFunction(() => document.querySelector('#sg-ordem button[data-ordem="recentes"]').getAttribute("aria-pressed") === "true");
  await nota(B, x).locator(".sg-like").click(); await B.waitForFunction((tx) => [...document.querySelectorAll(".sg-nota")].find((n) => n.querySelector("p").textContent === tx)?.querySelector(".sg-like span").textContent === "0", x, { timeout: 15000 }); await fechar(B);
});
t("apagar a própria sugestão pede confirmação (2 toques); apagar NÃO devolve o limite de 5 por dia; a 6ª é recusada com aviso", async () => {
  await abrir(A);
  const aviso = async () => (await A.locator("#sg-info").innerText()).replace(/\s+/g, " ");
  // A já mandou 4 hoje nos testes anteriores (com, anônima, x, y): resta 1
  assert.match(await aviso(), /restam 1 hoje/); const z = unico(); await mandar(A, z); await nota(A, z).waitFor(); assert.match(await aviso(), /restam 0 hoje/); assert.equal(await A.isDisabled("#sg-enviar"), true, "no limite o botão fica desligado");
  const ap = nota(A, z).locator(".sg-apagar"); await ap.click(); assert.match(await ap.innerText(), /Apagar mesmo\?/); assert.equal(await nota(A, z).count(), 1, "o primeiro toque só pede confirmação");
  await ap.click(); await nota(A, z).waitFor({ state: "detached", timeout: 15000 }); assert.match(await aviso(), /restam 0 hoje/, "apagar não devolve o limite");
  await A.fill("#sg-texto", "mais uma"); assert.equal(await A.isDisabled("#sg-enviar"), true);
  await A.fill("#sg-texto", ""); await fechar(A);
});
t("o banco recusa o 6º envio mesmo sem passar pela tela, e as tabelas não são lidas direto", async () => {
  const u = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  const tok = await A.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).access_token : null; });
  await A.waitForTimeout(62000); // (passa a janela de 1 minuto do limitador de ritmo, para o que recusa ser mesmo o limite do dia)
  assert.ok(tok, "o token da sessão está no aparelho"); const h = { apikey: key, Authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const env = await fetch(`${u}/rest/v1/rpc/sugestao_enviar`, { method: "POST", headers: h, body: JSON.stringify({ p_texto: "burlando o limite", p_mostrar_nome: true }) }); assert.equal(env.status >= 400, true, "6º envio recusado"); assert.match(await env.text(), /limite_diario/);
  const longo = await fetch(`${u}/rest/v1/rpc/sugestao_enviar`, { method: "POST", headers: h, body: JSON.stringify({ p_texto: "x".repeat(203), p_mostrar_nome: true }) }); assert.equal(longo.status >= 400, true);
  const direto = await fetch(`${u}/rest/v1/sugestoes?select=*`, { headers: h }); assert.equal(direto.status >= 400 || (await direto.clone().json()).length === 0, true, "a tabela não é lida direto (nem o user_id sai por ali)");
  const anon = await fetch(`${u}/rest/v1/rpc/sugestao_lista`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: "{}" }); assert.equal(anon.status >= 400, true, "sem conta, nada de lista");
});
t("nenhum erro de página", () => { assert.deepEqual(erros, []); });
