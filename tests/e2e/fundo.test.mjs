// Foto de fundo do grupo: o admin define uma permanente (configuração normal); qualquer membro compra uma por um tempo (de 5 em 5 minutos), que vale para
// todos e SUBSTITUI a do admin enquanto durar; só uma por vez; ao acabar volta a do admin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";
import { tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, fotoAdmin, fotoAdmin2, fotoLoja; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 280000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
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
// PNG liso de w x h (o tamanho diferente de cada foto mostra QUAL fundo está aparecendo)
function png(w, h, cor = 0x9a) {
  const bloco = (tipo, dados) => { const b = Buffer.concat([Buffer.from(tipo), dados]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, cor)]), cru = Buffer.concat(Array.from({ length: h }, () => linha));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(cru)), bloco("IEND", Buffer.alloc(0))]);
}
// largura (em pixels) da foto que está de fundo na lista de mensagens, ou 0 se não há fundo
const larguraFundo = (p) => p.evaluate(async () => { const m = document.querySelector("#messages"), bg = getComputedStyle(m).backgroundImage, u = bg.match(/url\("?([^")]+)"?\)/)?.[1]; if (!u || !m.classList.contains("has-bg")) return 0; const im = new Image(); im.src = u; try { await im.decode(); } catch { return -1; } return im.naturalWidth; });
const esperaLargura = (p, w, ms = 30000) => p.waitForFunction(async (x) => { const m = document.querySelector("#messages"), bg = getComputedStyle(m).backgroundImage, u = bg.match(/url\("?([^")]+)"?\)/)?.[1]; if (!u || !m.classList.contains("has-bg")) return x === 0; const im = new Image(); im.src = u; try { await im.decode(); } catch { return false; } return im.naturalWidth === x; }, w, { timeout: ms, polling: 400 });
const abrirInfo = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); };
const fecharInfo = (p) => p.click("#grupo-info .pg-volta");
const ajusta = (p, sel, v) => p.evaluate(([s, x]) => { const i = document.querySelector(s); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
async function comprar(p, foto, passos) { await abrirSelos(p); await p.locator('#sl-loja .lj-cartao[data-item="fundo"] .lj-bt').click(); await p.waitForSelector("#loja-folha[open] #lf-foto", { state: "attached", timeout: 30000 }); assert.equal(await p.locator("#lf-ok").isDisabled(), true, "sem foto escolhida ainda não compra"); await p.setInputFiles("#lf-foto", foto); await p.waitForSelector("#lf-prev:not([hidden])", { timeout: 30000 }); await ajusta(p, "#lf-passos", passos); }

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  const d = tmp(); fotoAdmin = join(d, "admin.png"); fotoAdmin2 = join(d, "admin2.png"); fotoLoja = join(d, "loja.png"); writeFileSync(fotoAdmin, png(200, 100, 0x30)); writeFileSync(fotoAdmin2, png(220, 110, 0x50)); writeFileSync(fotoLoja, png(300, 150, 0xc0));
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Fundo");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Fundo")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Fundo")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
  await abrirGrupoDe(B); await abrirGrupoDe(C);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o admin define a foto de fundo do grupo como uma configuração normal (só ele vê o botão); aparece para todos", async () => {
  await abrirInfo(B); assert.equal(await B.locator("#gi-fundo").isVisible(), false, "membro comum não vê a configuração"); await fecharInfo(B);
  for (const p of [A, B, C]) assert.equal(await larguraFundo(p), 0, "começa sem fundo");
  await abrirInfo(A); assert.equal(await A.locator("#gi-fundo").isVisible(), true); assert.equal(await A.locator("#gi-fundo-rm").isVisible(), false);
  await A.setInputFiles("#gi-fundo-file", fotoAdmin); await A.waitForFunction(() => /Foto de fundo do grupo atualizada/.test(document.querySelector("#gi-msg").textContent), null, { timeout: 30000 }); assert.equal(await A.locator("#gi-fundo-rm").isVisible(), true); await fecharInfo(A);
  for (const p of [A, B, C]) await esperaLargura(p, 200);
});
t("a loja: o admin liga o item e dá Selos; B compra uma foto por 15 minutos; vale para TODOS e substitui a do admin", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]"); assert.equal(await A.locator("#sr-loja .sr-card").count(), 6);
  await chave(A, "Entrar no grupo").click(); await A.locator('#sr-cards .sr-card:has(b:text-is("Entrar no grupo")) .sr-n').first().click(); await A.waitForSelector("#selos-num[open]"); await A.fill("#sn-valor", "300"); await A.click("#sn-ok"); await A.waitForFunction(() => !document.querySelector("#selos-num").open);
  await A.locator('#sr-loja button.sr-sw[aria-label="Foto de fundo do grupo"]').click(); assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Foto de fundo do grupo")) .sr-frase').innerText(), /Custa 40 Selos pelos primeiros 5 minutos e 10 Selos a cada 5 minutos a mais/);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 }); await sair(A);
  await abrirSelos(B); await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "300", null, { timeout: 30000 });
  await B.locator('#sl-loja .lj-cartao[data-item="fundo"] .lj-bt').click(); await B.waitForSelector("#loja-folha[open] #lf-foto", { state: "attached" }); await B.setInputFiles("#lf-foto", fotoLoja); await B.waitForSelector("#lf-prev:not([hidden])", { timeout: 30000 });
  await ajusta(B, "#lf-passos", 3); assert.match(await B.locator("#lf-passos ~ .lf-mono").innerText(), /15 minutos · custa 60 Selos/); assert.match(await B.locator("#lf-depois").innerText(), /300 → 240/);
  globalThis.t0 = Date.now(); await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 }); await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "240", null, { timeout: 30000 }); await sair(B);
  for (const p of [A, B, C]) await esperaLargura(p, 300);
  await B.waitForSelector(`#messages .aviso-linha:has-text("Você pôs uma foto de fundo no grupo por 15 minutos")`, { timeout: 30000 }); await A.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} pôs uma foto de fundo no grupo por 15 minutos")`, { timeout: 30000 });
});
t("enquanto a da loja vale: ninguém compra outra (nem a tela nem o servidor); o admin ainda pode mudar a permanente, mas não aparece; ao acabar volta a do admin", async () => {
  await abrirSelos(C); await C.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "300", null, { timeout: 30000 }); const bt = C.locator('#sl-loja .lj-cartao[data-item="fundo"] .lj-bt'); assert.match(await bt.innerText(), /Em uso até/); assert.equal(await bt.isDisabled(), true); await sair(C);
  const fake = async (p) => ({ p: `${await uid(p)}/${(await rpc(p, "grupo_fundo_ver", {})).gid}/${hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5")}`, iv: "aXZpdml2aXZpdg==", t: "image/jpeg" });
  assert.equal((await rpc(C, "selo_fundo_comprar", { p_passos: 1, p_arquivo: await fake(C) })).msg, "ja_com_fundo", "o servidor também recusa");
  await abrirInfo(A); assert.match(await A.locator("#gi-fundo-sub").innerText(), /foto de fundo da loja vale até/); await A.setInputFiles("#gi-fundo-file", fotoAdmin2); await A.waitForFunction(() => /atualizada/.test(document.querySelector("#gi-msg").textContent), null, { timeout: 30000 }); await fecharInfo(A);
  assert.equal(await larguraFundo(A), 300, "a da loja continua valendo, até para o admin");
  await A.waitForTimeout(Math.max(0, globalThis.t0 + 20000 - Date.now())); // 3 passos de 6 s no banco de teste
  for (const p of [A, B, C]) await esperaLargura(p, 220); // voltou a (nova) foto do admin
});
t("depois que acaba, qualquer um pode comprar de novo; remover a foto do admin tira o fundo quando não há da loja", async () => {
  await comprar(C, fotoLoja, 1); assert.match(await C.locator("#lf-depois").innerText(), /300 → 260/); await C.click("#lf-ok"); await C.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 }); await sair(C);
  for (const p of [A, B, C]) await esperaLargura(p, 300); for (const p of [A, B, C]) await esperaLargura(p, 220, 40000); // 1 passo de 6 s: volta sozinha
  await abrirInfo(A); await A.click("#gi-fundo-rm"); await A.waitForFunction(() => /removida/.test(document.querySelector("#gi-msg").textContent), null, { timeout: 30000 }); assert.equal(await A.locator("#gi-fundo-rm").isVisible(), false); await fecharInfo(A);
  for (const p of [A, B, C]) await esperaLargura(p, 0);
});
t("travas do banco: só o admin muda a permanente; arquivos inválidos; passos; saldo; de fora; tabela fechada; preço", async () => {
  const x = await apiUser("x"), gid = (await rpc(A, "grupo_fundo_ver", {})).gid, novoId = () => hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const ok = async (p, tipo = "image/jpeg") => ({ p: `${await uid(p)}/${gid}/${novoId()}`, iv: "aXZpdml2aXZpdg==", t: tipo });
  assert.equal((await rpc(B, "grupo_fundo", { p_fundo: await ok(B) })).code, "42501", "membro comum não muda a permanente"); assert.equal((await rpc(B, "grupo_fundo", { p_fundo: null })).code, "42501");
  for (const [nome, arq] of [["tipo errado", await ok(A, "audio/wav")], ["sem tipo", { ...(await ok(A)), t: undefined }], ["pasta de outro grupo", { ...(await ok(A)), p: `${await uid(A)}/${novoId()}/${novoId()}` }], ["pasta de outra pessoa", await ok(B)], ["caminho ruim", { p: "x", iv: "y", t: "image/png" }]]) assert.equal((await rpc(A, "grupo_fundo", { p_fundo: arq })).code, "22023", nome);
  for (const passos of [0, 13, null]) assert.equal((await rpc(B, "selo_fundo_comprar", { p_passos: passos, p_arquivo: await ok(B) })).code, "22023", "passos " + passos);
  assert.equal((await rpc(B, "selo_fundo_comprar", { p_passos: 1, p_arquivo: null })).code, "22023", "sem arquivo"); assert.equal((await rpc(B, "selo_fundo_comprar", { p_passos: 1, p_arquivo: await ok(C) })).code, "22023", "o arquivo tem de ser de quem compra");
  const r0 = (await rpc(A, "selo_regras_ver", {})).data[0].regras; assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...r0, loja_fundo: { on: true, valor: 999, extra: 999 } } })).code, null);
  assert.equal((await rpc(B, "selo_fundo_comprar", { p_passos: 12, p_arquivo: await ok(B) })).msg, "saldo_insuficiente", "999 + 11 x 999 = 11988 Selos: acima do saldo"); assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...r0, loja_fundo: { on: true, valor: 1, extra: 1000 } } })).code, "22023", "cada preço no máximo 999");
  assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...r0, loja_fundo: { on: false, valor: 40, extra: 10 } } })).code, null); assert.equal((await rpc(B, "selo_fundo_comprar", { p_passos: 1, p_arquivo: await ok(B) })).msg, "item_desligado", "desligado não vende");
  const g = novoId(); assert.equal((await x.c.rpc("selo_fundo_comprar", { p_grupo: g, p_passos: 1, p_arquivo: { p: "x", iv: "y", t: "image/png" } })).error?.code, "42501", "de fora não compra"); assert.equal((await x.c.rpc("grupo_fundo", { p_grupo: g, p_fundo: null })).error?.code, "42501", "de fora não muda");
  assert.equal((await x.c.rpc("grupo_fundo_ver", { p_grupo: gid })).data?.length || 0, 0, "de fora não vê os fundos do grupo"); assert.ok((await x.c.from("selo_fundos").select("*")).error, "tabela fechada para leitura"); assert.ok((await x.c.from("selo_fundos").insert({ grupo_id: g })).error, "e para escrita"); assert.ok((await x.c.rpc("fundo_arquivo_ok", { a: {}, p_grupo: g, u: x.id })).error, "função interna");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
