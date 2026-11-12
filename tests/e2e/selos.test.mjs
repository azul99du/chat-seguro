// Selos: o admin define as regras (frases com números tocáveis), o saldo aparece a confirmar, o grupo é avisado da mudança e o banco recusa o que não é do admin ou está fora dos limites.
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
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Selos"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Selos")', { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector('#conv-title:text-is("Selos")'); await B.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

const abrirSelos = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); await p.click("#gi-selos"); await p.waitForSelector("#selos[open]"); await p.waitForSelector("#sl-regras li", { timeout: 30000 }); };
const chip = (p, titulo, n = 0) => p.locator(`#sr-cards .sr-card:has(b:text-is("${titulo}")) .sr-n`).nth(n);
const chave = (p, titulo) => p.locator(`#sr-cards button.sr-sw[aria-label="${titulo}"]`);
const mudar = async (p, titulo, n, valor) => { await chip(p, titulo, n).click(); await p.waitForSelector("#selos-num[open]"); await p.fill("#sn-valor", String(valor)); await p.click("#sn-ok"); await p.waitForFunction(() => !document.querySelector("#selos-num").open); };
const rpc = (p, fn, args) => p.evaluate(async ([f, a]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), gid = (await sb.rpc("meus_grupos")).data[0].grupo_id; const r = await sb.rpc(f, { p_grupo: gid, ...a }); return { code: r.error?.code || null, msg: r.error?.message || null, data: r.data }; }, [fn, args]);

t("sem regras: o membro vê que o admin ainda não definiu, e só o admin tem o botão de editar", async () => {
  await abrirSelos(B); assert.match(await B.locator("#sl-regras").innerText(), /O admin ainda não definiu como ganhar Selos/); assert.equal(await B.locator("#sl-editar").isVisible(), false);
  assert.equal(await B.locator("#sl-meu .n").first().innerText(), "0"); await B.click("#selos .pg-volta"); await B.click("#grupo-info .pg-volta");
  await abrirSelos(A); assert.match(await A.locator("#sl-regras").innerText(), /Ainda não há regras/); assert.equal(await A.locator("#sl-editar").isVisible(), true);
});
t("o admin liga as ações e muda os números tocando neles (frases, folha de edição, limites e prévia)", async () => {
  await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]");
  assert.equal(await A.locator("#sr-cards .sr-card").count(), 5); assert.equal(await A.locator("#sr-cards .sr-n").count(), 0, "tudo desligado: nenhuma frase");
  assert.equal(await A.locator("#sr-salvar").isDisabled(), true, "nada mudou: nada a salvar"); assert.match(await A.locator("#sr-previa").innerText(), /não rende Selos/);
  await chave(A, "Entrar no grupo").click(); assert.match(await A.locator('#sr-cards .sr-card:has(b:text-is("Entrar no grupo")) .sr-frase').innerText(), /Ganha 1 Selo ao entrar no grupo/);
  await mudar(A, "Entrar no grupo", 0, 7); assert.match(await A.locator('#sr-cards .sr-card:has(b:text-is("Entrar no grupo")) .sr-frase').innerText(), /Ganha 7 Selos ao entrar no grupo/);
  await chave(A, "Mensagens enviadas").click(); await mudar(A, "Mensagens enviadas", 0, 5000); assert.match(await A.locator('#sr-cards .sr-card:has(b:text-is("Mensagens enviadas")) .sr-frase').innerText(), /Ganha 999 Selos a cada 1 mensagem enviada/, "o máximo é 999");
  await mudar(A, "Mensagens enviadas", 0, 2); assert.match(await A.locator("#sr-previa").innerText(), /40 Selos em um dia comum/);
  await chip(A, "Mensagens enviadas", 0).click(); await A.click("#sn-mais"); assert.equal(await A.inputValue("#sn-valor"), "3"); await A.click("#sn-menos"); await A.click("#sn-menos"); assert.equal(await A.inputValue("#sn-valor"), "1"); assert.equal(await A.locator("#sn-menos").isDisabled(), true, "não passa do mínimo");
  await A.fill("#sn-valor", "2"); await A.keyboard.press("Enter"); await A.waitForFunction(() => !document.querySelector("#selos-num").open);
  await chave(A, "Sequência de dias").click(); assert.equal(await A.locator('#sr-cards .sr-card:has(b:text-is("Sequência de dias")) .sr-frase').count(), 1, "ligar a sequência já traz um marco");
  await A.click('#sr-cards .sr-add'); assert.equal(await A.locator('#sr-cards .sr-card:has(b:text-is("Sequência de dias")) .sr-frase').count(), 2);
  await A.locator('#sr-cards .sr-card:has(b:text-is("Sequência de dias")) .sr-x').nth(1).click(); assert.equal(await A.locator('#sr-cards .sr-card:has(b:text-is("Sequência de dias")) .sr-frase').count(), 1);
  assert.equal(await A.locator("#sr-salvar").isDisabled(), false);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 });
  await A.waitForFunction(() => document.querySelectorAll("#sl-regras li").length === 3 && !document.querySelector("#sl-regras li.vazio"), null, { timeout: 30000 });
  const frases = await A.locator("#sl-regras li").allInnerTexts(); assert.deepEqual(frases, ["Ganha 7 Selos ao entrar no grupo", "Ganha 2 Selos a cada 1 mensagem enviada", "Com 3 dias seguidos, ganha 1 Selo"]);
});
t("o grupo é avisado da mudança (quem mudou e quem vê), e quem só lê não vê o botão de editar", async () => {
  await A.click("#selos .pg-volta"); await A.click("#grupo-info .pg-volta");
  await A.waitForSelector('#messages .aviso-linha:has-text("Você mudou as regras dos Selos")', { timeout: 30000 });
  await B.waitForSelector(`#messages .aviso-linha:has-text("@${nomeA} mudou as regras dos Selos")`, { timeout: 30000 });
  await B.click("#grupo-btn"); await B.click("#gi-selos"); await B.waitForSelector("#selos[open]"); await B.waitForFunction(() => document.querySelectorAll("#sl-regras li").length === 3 && !document.querySelector("#sl-regras li.vazio"), null, { timeout: 30000 });
  assert.equal(await B.locator("#sl-editar").isVisible(), false);
});
t("o saldo do dia aparece como “a confirmar” (entrada + mensagens) e todos do grupo veem o de todos", async () => {
  await B.click("#selos .pg-volta"); await B.click("#grupo-info .pg-volta");
  for (const x of ["um", "dois", "três"]) await enviar(A, "selos " + x);
  await B.waitForSelector(".msg.grupo-msg .vis:text-is('selos três')", { timeout: 30000 });
  await A.click("#grupo-btn"); await A.click("#gi-selos"); await A.waitForSelector("#selos[open]");
  await A.waitForFunction(() => /\+13/.test(document.querySelector("#sl-meu")?.innerText || ""), null, { timeout: 30000 }); // 7 da entrada + 3 mensagens × 2
  assert.match(await A.locator("#sl-meu").innerText(), /a confirmar hoje/); assert.equal(await A.locator("#sl-meu .n").first().innerText(), "0", "nada confirmado: o dia ainda não acabou");
  const linhas = await A.locator("#sl-lista .sl-pessoa").allInnerTexts(); assert.equal(linhas.length, 2); assert.match(linhas[0], /\+13 a confirmar/); assert.match(linhas[1], /\+7 a confirmar/);
  await B.click("#grupo-btn"); await B.click("#gi-selos"); await B.waitForSelector("#selos[open]"); await B.waitForFunction(() => /\+7/.test(document.querySelector("#sl-meu")?.innerText || ""), null, { timeout: 30000 });
  assert.match(await B.locator("#sl-lista").innerText(), /\+13 a confirmar/, "B vê o saldo de A");
});
t("travas do banco: só o admin muda; valores fora do limite recusados; de fora não lê; tabelas e funções internas fechadas", async () => {
  const bom = { entrada: { on: true, valor: 7 } };
  assert.equal((await rpc(B, "selo_regras_mudar", { p_regras: bom })).code, "42501", "membro comum não muda as regras");
  for (const [nome, regras] of [["valor 1000", { entrada: { on: true, valor: 1000 } }], ["valor 0", { entrada: { on: true, valor: 0 } }], ["decimal", { entrada: { on: true, valor: 1.5 } }], ["texto", { entrada: { on: true, valor: "9" } }], ["on não booleano", { entrada: { on: "sim", valor: 1 } }],
    ["dias repetidos", { sequencia: { on: true, marcos: [{ dias: 3, valor: 1 }, { dias: 3, valor: 2 }] } }], ["dias 366", { sequencia: { on: true, marcos: [{ dias: 366, valor: 1 }] } }], ["11 marcos", { sequencia: { on: true, marcos: Array.from({ length: 11 }, (_, i) => ({ dias: i + 1, valor: 1 })) } }],
    ["não é objeto", [1, 2]], ["regra não é objeto", { entrada: 5 }]]) assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: regras })).code, "22023", nome);
  const ver = await rpc(B, "selo_regras_ver", {}); assert.equal(ver.data[0].regras.entrada.valor, 7, "as regras recusadas não mudaram nada"); assert.equal(ver.data[0].regras.entrada.desde.length, 10, "o servidor guarda desde quando cada regra vale");
  const x = await apiUser("x"), g = hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  for (const [f, a] of [["selo_saldo", { p_grupo: g }], ["selo_regras_ver", { p_grupo: g }], ["selo_regras_mudar", { p_grupo: g, p_regras: bom }]]) assert.equal((await x.c.rpc(f, a)).error?.code, "42501", f + " de fora");
  for (const tabela of ["selo_regras", "selo_apurado", "moedas_extrato"]) { assert.ok((await x.c.from(tabela).select("*")).error, tabela + " fechada para leitura"); assert.ok((await x.c.from(tabela).insert({ grupo_id: g })).error, tabela + " fechada para escrita"); }
  for (const [f, a] of [["selo_ganhos", { p_grupo: g, p_user: x.id, p_dia: "2026-01-01", p_regras: {} }], ["selo_apurar", { p_grupo: g }], ["selo_limpa", { novo: {}, velho: {}, hoje: "2026-01-01" }], ["selo_int", { p: {}, k: "a", minimo: 1, maximo: 2, padrao: 1 }]]) assert.ok((await x.c.rpc(f, a)).error, f + " é interna: ninguém chama");
  assert.deepEqual((await x.c.rpc("selos_resumo")).data, [], "de fora não vê nada");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
