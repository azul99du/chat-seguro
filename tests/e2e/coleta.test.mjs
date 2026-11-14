// Coleta diária: o admin liga; uma vez por dia (dia de Brasília) cada membro coleta a média arredondada dos preços dos itens ligados na loja.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 200000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
async function apiUser(tag) { const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: await jwk() })).error); return { c, id: data.user.id, nome }; }
const rpc = (p, fn, args) => p.evaluate(async ([f, a]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), gid = (await sb.rpc("meus_grupos")).data[0].grupo_id; const r = await sb.rpc(f, { p_grupo: gid, ...a }); return { code: r.error?.code || null, msg: r.error?.message || null, data: r.data, gid }; }, [fn, args]);
const uid = (p) => p.evaluate(async () => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"); return (await createClient(SUPABASE_URL, SUPABASE_KEY).auth.getUser()).data.user.id; });
const chave = (p, titulo) => p.locator(`#sr-cards button.sr-sw[aria-label="${titulo}"]`);
const abrirSelos = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); await p.click("#gi-selos"); await p.waitForSelector("#selos[open]"); await p.waitForFunction(() => document.querySelector("#sl-meu .n"), null, { timeout: 30000 }); };
const sair = async (p) => { await p.click("#selos .pg-volta"); await p.click("#grupo-info .pg-volta"); };
const regras = (p) => rpc(p, "selo_regras_ver", {}).then((r) => r.data[0].regras);
const mudar = (p, novo) => rpc(p, "selo_regras_mudar", { p_regras: novo });
const loja = (o) => Object.fromEntries(Object.entries(o).map(([k, [on, valor]]) => ["loja_" + k, { on, valor, ...(k === "efeito" ? { extra: 10 } : {}) }]));

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Coleta");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Coleta")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Coleta")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
  await abrirGrupoDe(B); await abrirGrupoDe(C);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o admin liga a coleta e dois itens da loja: o cartão do editor mostra quanto cada membro coletaria", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]");
  const card = A.locator('#sr-mais .sr-card:has(b:text-is("Coleta diária da loja"))'); assert.equal(await card.count(), 1); assert.equal(await card.locator(".sr-frase").count(), 0, "desligada: sem texto");
  await A.locator('#sr-mais button.sr-sw[aria-label="Coleta diária da loja"]').click(); assert.match(await card.locator(".sr-frase").innerText(), /Ligue algum item na loja/);
  for (const nome of ["Título ao lado do nome", "Silenciar um membro"]) await A.locator(`#sr-loja button.sr-sw[aria-label="${nome}"]`).click();
  assert.match(await card.locator(".sr-frase").innerText(), /coletaria 65 Selos/, "média de 50 e 80");
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 });
  await A.waitForFunction(() => !document.querySelector("#sl-coleta").hidden, null, { timeout: 30000 }); assert.match(await A.locator("#sl-coleta").innerText(), /65/); await sair(A);
});
t("cada membro coleta UMA vez por dia: o saldo sobe, o botão vira 'Coletado hoje' e o servidor recusa a segunda", async () => {
  await abrirSelos(B); await B.waitForFunction(() => !document.querySelector("#sl-coleta").hidden, null, { timeout: 30000 }); assert.equal(await B.locator("#sl-meu .n").first().innerText(), "0");
  assert.match(await B.locator("#sl-coletar").innerText(), /Coletar 65/); await B.click("#sl-coletar");
  await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "65", null, { timeout: 30000 }); assert.match(await B.locator("#sl-msg").innerText(), /Você coletou 65 Selos/);
  assert.match(await B.locator("#sl-coletar").innerText(), /Coletado hoje/); assert.equal(await B.locator("#sl-coletar").isDisabled(), true); assert.match(await B.locator("#sl-coleta").innerText(), /Volte amanhã/);
  assert.equal((await rpc(B, "selo_coletar", {})).msg, "ja_coletou", "a segunda no mesmo dia é recusada"); assert.equal((await rpc(B, "selo_coleta_hoje", {})).data, true);
  assert.equal(await B.locator("#sl-meu .n").first().innerText(), "65", "o saldo não mudou"); await sair(B);
  await abrirSelos(A); await A.click("#sl-coletar"); await A.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "65", null, { timeout: 30000 }); await sair(A);
});
t("a média é arredondada: 50 e 55 dão 52,5 e vira 53; só entram os itens ligados", async () => {
  const r = await regras(A); assert.equal((await mudar(A, { ...r, ...loja({ titulo: [true, 50], destaque: [true, 55], silenciar: [false, 999], jumpscare: [false, 5], efeito: [false, 5] }), coleta: { on: true } })).code, null);
  assert.equal((await rpc(C, "selo_coleta_hoje", {})).data, false); assert.equal((await rpc(C, "selo_coletar", {})).data, 53, "52,5 sobe para 53");
  assert.equal((await rpc(C, "selo_coletar", {})).msg, "ja_coletou"); await abrirSelos(C); assert.equal(await C.locator("#sl-meu .n").first().innerText(), "53"); await sair(C);
});
t("desligada ou sem itens: nada para coletar (o cartão some ou avisa) e o servidor recusa", async () => {
  const r = await regras(A); assert.equal((await mudar(A, { ...r, coleta: { on: false } })).code, null); assert.equal((await rpc(B, "selo_coletar", {})).msg, "coleta_desligada");
  await abrirSelos(B); assert.equal(await B.locator("#sl-coleta").isHidden(), true, "desligada: o cartão some"); await sair(B);
  assert.equal((await mudar(A, { ...r, ...loja({ titulo: [false, 50], destaque: [false, 50], silenciar: [false, 50], jumpscare: [false, 50], efeito: [false, 50] }), coleta: { on: true } })).code, null);
  const novaC = await apiUser("zz"); assert.ok((await novaC.c.rpc("selo_coletar", { p_grupo: (await rpc(A, "selo_coleta_hoje", {})).gid })).error, "de fora não coleta");
  assert.equal((await rpc(A, "selo_coletar", {})).msg, "sem_itens", "sem itens ligados não há o que coletar");
  await abrirSelos(A); await A.waitForFunction(() => /Sem itens/.test(document.querySelector("#sl-coletar")?.textContent || ""), null, { timeout: 30000 }); assert.equal(await A.locator("#sl-coletar").isDisabled(), true); await sair(A);
});
t("travas do banco: só o admin liga, site antigo não desliga, de fora e tabela fechada", async () => {
  const x = await apiUser("x"), g = hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5"), r = await regras(A);
  assert.equal((await mudar(B, { ...r, coleta: { on: true } })).code, "42501", "membro comum não liga a coleta"); assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...r, coleta: { on: "sim" } } })).code, "22023", "valor ruim");
  assert.equal((await mudar(A, { ...r, coleta: { on: true } })).code, null); const { coleta, ...semColeta } = await regras(A); assert.equal((await mudar(A, semColeta)).code, null, "um site antigo (sem a chave) salvando regras...");
  assert.equal((await regras(B)).coleta.on, true, "...não desliga a coleta");
  assert.equal((await x.c.rpc("selo_coletar", { p_grupo: g })).error?.code, "42501", "de fora não coleta"); assert.equal((await x.c.rpc("selo_coleta_hoje", { p_grupo: g })).data, false); assert.ok((await x.c.rpc("selo_coleta_valor", { reg: {} })).error, "função interna");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
