// Efeito sonoro (item da loja): o comprador escolhe uma pessoa (pode ser ele), um trecho de 1 ou 2 s de um áudio e por quanto tempo (de 5 em 5 minutos);
// enquanto durar, cada mensagem dessa pessoa toca o som no aparelho de todos. O admin define os dois preços; o servidor confere tudo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";
import { tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, wav; const erros = [];
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
const chipLoja = (p, titulo, n = 0) => p.locator(`#sr-loja .sr-card:has(b:text-is("${titulo}")) .sr-n`).nth(n);
const mudarLoja = async (p, titulo, n, valor) => { await chipLoja(p, titulo, n).click(); await p.waitForSelector("#selos-num[open]"); await p.fill("#sn-valor", String(valor)); await p.click("#sn-ok"); await p.waitForFunction(() => !document.querySelector("#selos-num").open); };
const tocou = (p) => p.evaluate(() => window.__tocou);
const zerar = (p) => p.evaluate(() => { window.__tocou = 0; });
const esperaTocar = (p, n) => p.waitForFunction((x) => window.__tocou >= x, n, { timeout: 20000 });
const ajusta = (p, sel, v) => p.evaluate(([s, x]) => { const i = document.querySelector(s); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
// WAV de 6 s (um tom que sobe), feito aqui mesmo
function onda(seg = 6, taxa = 22050) { const n = seg * taxa, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((i / taxa) * 2 * Math.PI * (300 + 100 * (i / taxa)))), 44 + i * 2); return b; }
// compra pela tela: pessoa, arquivo, início, tamanho (1 ou 2 s) e passos de 5 minutos
async function comprar(p, alvoNome, { passos = 1, dur = 1, inicio = 0 } = {}) {
  await abrirSelos(p); await p.locator('#sl-loja .lj-cartao[data-item="efeito"] .lj-bt').click(); await p.waitForSelector("#loja-folha[open] .lf-pessoas", { timeout: 30000 });
  await p.locator(`#lf-corpo .lf-pessoa:has-text("@${alvoNome}")`).click(); assert.equal(await p.locator("#lf-ok").isDisabled(), true, "sem som escolhido ainda não compra");
  await p.setInputFiles("#lf-arq", wav); await p.waitForSelector("#lf-inicio", { state: "visible", timeout: 30000 });
  await p.locator(`#lf-corpo .lf-dur button[data-d="${dur}"]`).click(); await ajusta(p, "#lf-inicio", inicio); await ajusta(p, "#lf-passos", passos);
}

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  const d = tmp(); wav = join(d, "tom.wav"); writeFileSync(wav, onda(6));
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }); await ctx.addInitScript(() => { const o = HTMLMediaElement.prototype.play; window.__tocou = 0; HTMLMediaElement.prototype.play = function () { if ((this.currentSrc || this.src || "").startsWith("blob:")) window.__tocou++; return o.call(this); }; }); const p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Efeito");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Efeito")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Efeito")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
  await abrirGrupoDe(B); await abrirGrupoDe(C);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o admin liga o efeito e põe dois preços: os primeiros 5 minutos e cada 5 minutos a mais", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]");
  assert.equal(await A.locator("#sr-loja .sr-card").count(), 6); await chave(A, "Entrar no grupo").click(); await A.locator('#sr-cards .sr-card:has(b:text-is("Entrar no grupo")) .sr-n').first().click(); await A.waitForSelector("#selos-num[open]"); await A.fill("#sn-valor", "300"); await A.click("#sn-ok"); await A.waitForFunction(() => !document.querySelector("#selos-num").open);
  await A.locator('#sr-loja button.sr-sw[aria-label="Efeito sonoro"]').click(); assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Efeito sonoro")) .sr-frase').innerText(), /Custa 30 Selos pelos primeiros 5 minutos e 10 Selos a cada 5 minutos a mais/);
  await mudarLoja(A, "Efeito sonoro", 1, 20); assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Efeito sonoro")) .sr-frase').innerText(), /e 20 Selos a cada 5 minutos a mais/);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 }); await sair(A);
  await abrirSelos(B); await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "300", null, { timeout: 30000 }); assert.match(await B.locator('#sl-loja .lj-cartao[data-item="efeito"]').innerText(), /a partir de 30/); await sair(B);
});
t("B compra um efeito para C: escolhe a pessoa, o trecho (2 s) e a duração (20 min); o preço sobe com o tempo e o grupo é avisado", async () => {
  await comprar(B, nomeC, { passos: 1, dur: 2, inicio: 1.5 }); assert.match(await B.locator("#lf-depois").innerText(), /300 → 270/); assert.match(await B.locator("#lf-passos ~ .lf-mono").innerText(), /5 minutos · custa 30 Selos/);
  await ajusta(B, "#lf-passos", 4); assert.match(await B.locator("#lf-depois").innerText(), /300 → 210/); assert.match(await B.locator("#lf-passos ~ .lf-mono").innerText(), /20 minutos · custa 90 Selos/); assert.match(await B.locator(".lf-trecho .lf-mono").innerText(), /dura 2 s/);
  assert.equal(await B.locator("#lf-ok").isDisabled(), false); await zerar(B); await B.click("#lf-ouvir"); await esperaTocar(B, 1); // a prévia toca o trecho
  globalThis.t0 = Date.now(); await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "210", null, { timeout: 30000 }); await sair(B);
  await B.waitForSelector(`#messages .aviso-linha:has-text("Você pôs um efeito sonoro em @${nomeC} por 20 minutos")`, { timeout: 30000 });
  await A.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} pôs um efeito sonoro em @${nomeC} por 20 minutos")`, { timeout: 30000 }); await C.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} pôs um efeito sonoro em você por 20 minutos")`, { timeout: 30000 });
});
t("enquanto durar, cada mensagem de C toca o som para TODOS (inclusive C); mensagem de outra pessoa não toca", async () => {
  for (const p of [A, B, C]) await zerar(p); await A.waitForTimeout(1500);
  await enviar(C, "mensagem do alvo"); for (const p of [A, B, C]) await esperaTocar(p, 1);
  for (const p of [A, B, C]) assert.equal(await tocou(p), 1, "toca uma vez por mensagem");
  for (const p of [A, B, C]) await zerar(p); await enviar(A, "mensagem de outra pessoa"); await B.waitForSelector(".msg.grupo-msg .vis:text-is('mensagem de outra pessoa')", { timeout: 30000 }); await B.waitForTimeout(1500);
  for (const p of [A, B, C]) assert.equal(await tocou(p), 0, "só o alvo aciona o som");
});
t("não dá para pôr outro efeito em quem já tem um ativo; depois que acaba, volta a poder; e o som para de tocar", async () => {
  await abrirSelos(B); await B.locator('#sl-loja .lj-cartao[data-item="efeito"] .lj-bt').click(); await B.waitForSelector("#loja-folha[open] .lf-pessoas"); await B.waitForSelector(`#lf-corpo .lf-pessoa:has-text("@${nomeC}")[disabled]`); assert.match(await B.locator(`#lf-corpo .lf-pessoa:has-text("@${nomeC}")`).innerText(), /tem efeito até/);
  await B.click("#lf-cancelar"); await sair(B);
  const fake = async (p) => ({ p: `${await uid(p)}/${(await rpc(p, "selo_efeitos_ativos", {})).gid}/${hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5")}`, iv: "aXZpdml2aXZpdg==", t: "audio/wav" });
  assert.equal((await rpc(B, "selo_efeito_comprar", { p_alvo: await uid(C), p_passos: 1, p_arquivo: await fake(B) })).msg, "ja_com_efeito", "o servidor também recusa");
  await B.waitForTimeout(Math.max(0, globalThis.t0 + 27000 - Date.now())); // 4 passos de 6 s no banco de teste
  for (const p of [A, B, C]) await zerar(p); await enviar(C, "depois do efeito"); await A.waitForSelector(".msg.grupo-msg .vis:text-is('depois do efeito')", { timeout: 30000 }); await A.waitForTimeout(1500);
  for (const p of [A, B, C]) assert.equal(await tocou(p), 0, "acabou: não toca mais");
  assert.equal((await rpc(B, "selo_efeitos_ativos", {})).data.length, 0, "o servidor não lista efeitos que acabaram");
});
t("o comprador pode pôr o efeito nele mesmo: toca para todos quando ELE escreve", async () => {
  await comprar(B, nomeB, { passos: 3, dur: 1, inicio: 3 }); assert.match(await B.locator("#lf-depois").innerText(), /210 → 140/); await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 }); await sair(B);
  await B.waitForTimeout(1500); assert.equal(await B.evaluate(() => document.querySelector("#send-form").classList.contains("silenciado")), false, "o efeito não silencia ninguém: o campo de escrever continua aí"); assert.equal(await B.locator("#text").isVisible(), true);
  await B.waitForSelector(`#messages .aviso-linha:has-text("Você pôs um efeito sonoro em você por 15 minutos")`, { timeout: 30000 }); await A.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} pôs um efeito sonoro em si mesmo")`, { timeout: 30000 }); await A.waitForTimeout(1500);
  for (const p of [A, B, C]) await zerar(p); await enviar(B, "mensagem de quem comprou"); for (const p of [A, B, C]) await esperaTocar(p, 1);
  for (const p of [A, B, C]) await zerar(p); await enviar(C, "C de novo, sem efeito"); await A.waitForSelector(".msg.grupo-msg .vis:text-is('C de novo, sem efeito')", { timeout: 30000 }); await A.waitForTimeout(1500); assert.equal(await tocou(A), 0, "C já não tem efeito");
});
t("travas do banco: passos, arquivo, saldo, alvo, de fora, preços e tabela fechada", async () => {
  const x = await apiUser("x"), gid = (await rpc(A, "selo_efeitos_ativos", {})).gid, novoId = () => hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const ok = async (p) => ({ p: `${await uid(p)}/${gid}/${novoId()}`, iv: "aXZpdml2aXZpdg==", t: "audio/wav" }), alvo = await uid(C), arq = await ok(A);
  for (const passos of [0, 13, null]) assert.equal((await rpc(A, "selo_efeito_comprar", { p_alvo: alvo, p_passos: passos, p_arquivo: arq })).code, "22023", "passos " + passos);
  assert.equal((await rpc(A, "selo_efeito_comprar", { p_alvo: alvo, p_passos: 1, p_arquivo: { ...arq, t: "audio/mpeg" } })).code, "22023", "só WAV"); assert.equal((await rpc(A, "selo_efeito_comprar", { p_alvo: alvo, p_passos: 1, p_arquivo: await ok(B) })).code, "22023", "o arquivo tem de estar na pasta de quem compra");
  assert.equal((await rpc(A, "selo_efeito_comprar", { p_alvo: alvo, p_passos: 1, p_arquivo: { p: "x", iv: "y", t: "audio/wav" } })).code, "22023", "caminho inválido");
  assert.equal((await rpc(A, "selo_efeito_comprar", { p_alvo: x.id, p_passos: 1, p_arquivo: arq })).msg, "alvo_fora", "o alvo tem de ser do grupo");
  assert.equal((await rpc(B, "selo_efeito_comprar", { p_alvo: alvo, p_passos: 12, p_arquivo: await ok(B) })).msg, "saldo_insuficiente", "30 + 11 x 20 = 250 Selos; B só tem 140");
  const g = novoId(); assert.equal((await x.c.rpc("selo_efeito_comprar", { p_grupo: g, p_alvo: x.id, p_passos: 1, p_arquivo: arq })).error?.code, "42501", "de fora não compra");
  assert.equal((await x.c.rpc("selo_efeitos_ativos", { p_grupo: g })).data?.length || 0, 0, "de fora não vê os efeitos"); assert.ok((await x.c.from("selo_efeitos").select("*")).error, "tabela fechada para leitura"); assert.ok((await x.c.from("selo_efeitos").insert({ grupo_id: g })).error, "e para escrita"); assert.ok((await x.c.rpc("efeito_passo")).error, "a duração do passo é interna");
  const ver = (await rpc(A, "selo_regras_ver", {})).data[0].regras; assert.deepEqual([ver.loja_efeito.valor, ver.loja_efeito.extra], [30, 20]);
  assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { ...ver, loja_efeito: { on: true, valor: 30, extra: 1000 } } })).code, "22023", "preço de cada 5 minutos no máximo 999"); assert.equal((await rpc(B, "selo_regras_mudar", { p_regras: { ...ver, loja_efeito: { on: true, valor: 1, extra: 1 } } })).code, "42501", "só o admin mexe nos preços");
  assert.equal((await rpc(A, "selo_regras_mudar", { p_regras: { entrada: { on: true, valor: 300 } } })).code, null); assert.equal((await rpc(B, "selo_regras_ver", {})).data[0].regras.loja_efeito.extra, 20, "regras sem a loja (site antigo) não apagam os preços");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
