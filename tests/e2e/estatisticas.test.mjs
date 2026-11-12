// Estatísticas do grupo: contagem por pessoa e tipo, tempo de tela vindo do servidor e as travas do banco (tempo, extrato de moedas).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";
import { corValida, distanciaMinima } from "../../cores.js";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const fundo = (p, sel) => p.locator(sel).first().evaluate((e) => getComputedStyle(e.querySelector(".bubble")).backgroundColor);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
const cif = () => ({ ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==" }), baseMsg = (to) => ({ recipient_id: to, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: { sid: hex(), dh: { x: "x", y: "y" }, pn: 0, n: 0 } });
async function apiUser(tag) { // conta "de mentira" só pela API: chaves válidas, para o navegador conseguir conversar com ela
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag), pk = await jwk(); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: pk })).error); assert.ifError((await c.from("prekeys").insert({ id: hex(), public_key: await jwk() })).error);
  return { c, id: data.user.id, nome };
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B] = [await novo("A"), await novo("B")]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis:text-is('oi a')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Estat"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Estat")', { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector('#conv-title:text-is("Estat")'); await B.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a tela de estatísticas mostra quem falou mais, o tempo na tela e o aviso de que o grupo vê tudo", async () => {
  await enviar(B, "um do b"); await enviar(B, "dois do b"); await enviar(B, "três do b"); await enviar(A, "um do a");
  await A.waitForSelector(".msg.grupo-msg .vis:text-is('três do b')", { timeout: 30000 }); await B.waitForSelector(".msg.grupo-msg .vis:text-is('um do a')", { timeout: 30000 });
  await A.mouse.move(100, 100); await A.mouse.click(300, 300); await A.waitForTimeout(7000); // (o tempo só conta com a pessoa usando a tela)
  await A.click("#grupo-btn"); await A.waitForSelector("#grupo-info[open]"); await A.click("#gi-est"); await A.waitForSelector("#grupo-est[open]");
  await A.waitForSelector("#est-lista .est-pessoa", { timeout: 30000 });
  assert.match(await A.locator(".est-aviso").innerText(), /Todos do grupo veem/);
  const linhas = await A.locator("#est-lista .est-linha").allInnerTexts(); assert.equal(linhas.length, 2);
  assert.match(linhas[0], new RegExp("@" + nomeB)); assert.match(linhas[0], /\b3\b[\s\S]*mensagens/); assert.match(linhas[1], /@.*\(você\)/); assert.match(linhas[1], /\b1\b[\s\S]*mensagem/);
  assert.match(await A.locator("#est-resumo").innerText(), /4 mensagens hoje no grupo/);
  assert.match(linhas[1], /na tela/); assert.doesNotMatch(linhas[1], /^\s*2\s+0min/, "o meu tempo de tela já chegou ao servidor");
  await A.click("#est-lista .est-pessoa:first-child .est-linha"); const mais = await A.locator("#est-lista .est-mais").innerText(); assert.match(mais, /3 texto/); assert.match(mais, /0 fotos/); assert.match(mais, /Entrou hoje|há/);
  await A.click('.est-abas button[data-p="mes"]'); assert.match(await A.locator("#est-resumo").innerText(), /neste mês/);
});
t("o outro membro vê o meu tempo de tela (as estatísticas são do grupo todo)", async () => {
  await B.click("#grupo-btn"); await B.waitForSelector("#grupo-info[open]"); await B.click("#gi-est"); await B.waitForSelector("#grupo-est[open] #est-lista .est-pessoa", { timeout: 30000 });
  const linhaA = await B.locator("#est-lista .est-pessoa").filter({ hasNotText: "(você)" }).locator(".est-linha").innerText(); assert.match(linhaA, /menos de 1min na tela|\dmin na tela/);
});
t("travas do banco: de fora não soma nem lê; tabelas fechadas; ninguém escreve no extrato de moedas", async () => {
  const x = await apiUser("x"), g = hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  assert.equal((await x.c.rpc("grupo_tela", { p_grupo: g, p_segundos: 30 })).error?.code, "42501");
  assert.equal((await x.c.rpc("grupo_estatisticas", { p_grupo: g })).error?.code, "42501");
  assert.equal((await x.c.rpc("moedas_saldo", { p_grupo: g })).error?.code, "42501");
  assert.ok((await x.c.from("grupo_dia").select("*")).error, "tabela fechada para leitura direta");
  assert.ok((await x.c.from("grupo_dia").insert({ grupo_id: g, user_id: x.id, dia: "2026-01-01", segundos: 9999 })).error);
  assert.ok((await x.c.from("moedas_extrato").insert({ grupo_id: g, user_id: x.id, quantidade: 1000, motivo: "teste" })).error, "ninguém dá moeda a si mesmo");
  assert.ok((await x.c.from("moedas_extrato").select("*")).error);
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
