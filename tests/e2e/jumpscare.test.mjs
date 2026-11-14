// Jumpscare (item da loja): o admin escolhe a lista (imagem + som, cifrados), quem compra não escolhe, quem estava online leva o susto na hora (3 a 10 s),
// quem não estava leva ao entrar no grupo, o aviso só aparece depois do susto, e o servidor esconde e confere tudo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";
import { hasFfmpeg, tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, png1, png2, mp3; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 280000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
async function apiUser(tag) { const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: await jwk() })).error); return { c, id: data.user.id, nome }; }
// PNG liso de w×h, feito aqui mesmo (sem ferramentas externas): o tamanho diferente de cada imagem mostra QUAL jumpscare apareceu
function png(w, h) {
  const bloco = (tipo, dados) => { const b = Buffer.concat([Buffer.from(tipo), dados]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9a)]), cru = Buffer.concat(Array.from({ length: h }, () => linha));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(cru)), bloco("IEND", Buffer.alloc(0))]);
}
const rpc = (p, fn, args) => p.evaluate(async ([f, a]) => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), gid = (await sb.rpc("meus_grupos")).data[0].grupo_id; const r = await sb.rpc(f, { p_grupo: gid, ...a }); return { code: r.error?.code || null, msg: r.error?.message || null, data: r.data, gid }; }, [fn, args]);
const uid = (p) => p.evaluate(async () => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"); return (await createClient(SUPABASE_URL, SUPABASE_KEY).auth.getUser()).data.user.id; });
const chip = (p, titulo, n = 0) => p.locator(`#sr-cards .sr-card:has(b:text-is("${titulo}")) .sr-n`).nth(n);
const chave = (p, titulo) => p.locator(`#sr-cards button.sr-sw[aria-label="${titulo}"]`);
const mudar = async (p, titulo, n, valor) => { await chip(p, titulo, n).click(); await p.waitForSelector("#selos-num[open]"); await p.fill("#sn-valor", String(valor)); await p.click("#sn-ok"); await p.waitForFunction(() => !document.querySelector("#selos-num").open); };
const abrirSelos = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); await p.click("#gi-selos"); await p.waitForSelector("#selos[open]"); await p.waitForFunction(() => document.querySelector("#sl-meu .n"), null, { timeout: 30000 }); };
const sair = async (p) => { await p.click("#selos .pg-volta"); await p.click("#grupo-info .pg-volta"); };
const aviso = (p) => p.locator(`#messages .aviso-linha:has-text("@${nomeB} comprou um jumpscare")`);
const largura = (p) => p.evaluate(() => document.getElementById("susto-img").naturalWidth);
const fechaSusto = async (p) => { await p.waitForTimeout(1400); if (await p.evaluate(() => document.querySelector("#susto").open)) await p.click("#susto", { timeout: 2000 }).catch(() => {}); /* (com som, ele já fechou sozinho ao fim do som) */ await p.waitForFunction(() => !document.querySelector("#susto").open, null, { timeout: 15000 }); };
const comprarJumpscare = async (p) => { await abrirSelos(p); await p.locator('#sl-loja .lj-cartao[data-item="jumpscare"] .lj-bt').click(); await p.waitForSelector("#loja-folha[open]"); await p.waitForFunction(() => !document.querySelector("#lf-ok").disabled || document.querySelector("#lf-msg").textContent, null, { timeout: 30000 }); };

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  const d = tmp(); png1 = join(d, "um.png"); png2 = join(d, "dois.png"); writeFileSync(png1, png(100, 100)); writeFileSync(png2, png(200, 120));
  if (hasFfmpeg()) { mp3 = join(d, "grito.mp3"); execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "libmp3lame", "-y", mp3]); }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async (n, vivo) => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } }); await ctx.addInitScript((v) => { try { localStorage.setItem("lacre:susto", "400"); localStorage.setItem("lacre:susto_vivo", v); } catch {} }, vivo); const p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A", "30"), await novo("B", "30"), await novo("C", "2")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Susto");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Susto")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Susto")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
  await abrirGrupoDe(B); await abrirGrupoDe(C);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o admin liga o jumpscare e dá Selos a todos; sem lista, comprar é recusado com um aviso claro", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]");
  assert.equal(await A.locator("#sr-loja .sr-card").count(), 4);
  await chave(A, "Entrar no grupo").click(); await mudar(A, "Entrar no grupo", 0, 200);
  await A.locator('#sr-loja button.sr-sw[aria-label="Jumpscare"]').click(); assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Jumpscare")) .sr-frase').innerText(), /Custa 60 Selos/);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 }); await sair(A);
  await abrirSelos(B); await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "200", null, { timeout: 30000 });
  assert.match(await B.locator('#sl-loja .lj-cartao[data-item="jumpscare"]').innerText(), /Jumpscare/); assert.equal(await B.locator("#sr-jumpscares").count(), 1, "o botão existe na página, mas só dentro do editor do admin");
  await B.locator('#sl-loja .lj-cartao[data-item="jumpscare"] .lj-bt').click(); await B.waitForSelector("#loja-folha[open]"); await B.waitForFunction(() => !document.querySelector("#lf-ok").disabled, null, { timeout: 30000 });
  assert.match(await B.locator("#lf-depois").innerText(), /200 → 140/); await B.click("#lf-ok"); await B.waitForFunction(() => /não pôs jumpscares/.test(document.querySelector("#lf-msg").textContent), null, { timeout: 30000 });
  assert.match(await B.locator("#lf-resumo").innerText(), /60/); await B.click("#lf-cancelar"); await sair(B);
});
t("só o admin gerencia a lista: imagens (e som) entram cifradas, aparecem como miniaturas e podem ser apagadas", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]"); await A.click("#sr-jumpscares"); await A.waitForSelector("#js-lista[open]"); await A.waitForSelector("#js-grade .js-vazio");
  await A.setInputFiles("#js-img", png1); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="nao"]'); await A.waitForSelector("#js-grade .js-item", { timeout: 30000 }); assert.equal(await A.locator("#js-grade .js-item").count(), 1);
  await A.waitForFunction(() => document.querySelector("#js-grade .js-item img")?.naturalWidth === 100, null, { timeout: 30000 });
  await A.setInputFiles("#js-img", png2); await A.waitForSelector("#choice[open]");
  if (mp3) { await A.click('#choice-actions button[value="som"]'); await A.setInputFiles("#js-som", mp3); } else await A.click('#choice-actions button[value="nao"]');
  await A.waitForFunction(() => document.querySelectorAll("#js-grade .js-item").length === 2, null, { timeout: 30000 }); if (mp3) assert.equal(await A.locator("#js-grade .js-som").count(), 1, "um deles tem som");
  await A.setInputFiles("#js-img", png1); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="nao"]'); await A.waitForFunction(() => document.querySelectorAll("#js-grade .js-item").length === 3, null, { timeout: 30000 });
  await A.locator("#js-grade .js-item").nth(2).locator(".js-x").click(); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="sim"]'); await A.waitForFunction(() => document.querySelectorAll("#js-grade .js-item").length === 2, null, { timeout: 30000 });
  await A.click("#js-lista .pg-volta"); await A.click("#selos-regras .pg-volta"); await sair(A);
  const lista = await rpc(B, "jumpscare_lista", {}); assert.equal(lista.data?.length || 0, 0, "quem não é admin não vê a lista (vem vazia)"); assert.equal((await rpc(A, "jumpscare_lista", {})).data.length, 2, "o admin vê as duas"); assert.equal((await rpc(B, "jumpscare_novo", { p_img: { p: "x", iv: "y" } })).code, "42501", "nem põe jumpscare");
});
t("comprar: o servidor sorteia e esconde; quem estava online leva o susto na hora, o aviso só vem depois do susto, e o comprador não leva nada", async () => {
  await C.goto("about:blank"); // C fecha o app
  await abrirSelos(B); await B.locator('#sl-loja .lj-cartao[data-item="jumpscare"] .lj-bt').click(); await B.waitForSelector("#loja-folha[open]"); await B.waitForFunction(() => !document.querySelector("#lf-ok").disabled, null, { timeout: 30000 });
  assert.match(await B.locator("#lf-corpo").innerText(), /sortear um jumpscare/); assert.equal(await B.locator("#lf-corpo button").count(), 0, "o comprador não escolhe");
  await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "140", null, { timeout: 30000 }); await sair(B);
  await B.waitForSelector(`#messages .aviso-linha:has-text("Você comprou um jumpscare")`, { timeout: 30000 });
  await A.waitForSelector("#susto[open]", { timeout: 30000 }); await A.waitForFunction(() => document.getElementById("susto-img").naturalWidth > 0, null, { timeout: 15000 });
  assert.equal(await aviso(A).count(), 0, "o aviso só aparece depois do susto"); globalThis.larguraA = await largura(A); assert.ok([100, 200].includes(globalThis.larguraA), "um da lista foi sorteado");
  await fechaSusto(A); await aviso(A).waitFor({ timeout: 30000 });
  assert.equal(await B.evaluate(() => document.querySelector("#susto").open), false, "quem comprou não leva o susto");
  const mia = await rpc(B, "selo_loja_estado", {}); const meu = mia.data.find((c) => c.item === "jumpscare"); assert.ok(meu, "o comprador vê a própria compra"); assert.equal(meu.detalhe, null, "mas não qual foi sorteado");
  assert.equal((await rpc(B, "jumpscare_obter", { p_id: 1 })).data?.length || 0, 0, "o comprador não espia o arquivo");
  assert.deepEqual((await rpc(A, "jumpscare_pendentes", {})).data, [], "depois do susto não falta nada");
});
t("quem estava offline leva o MESMO susto ao entrar no grupo (não antes), uma vez só, e o aviso vem depois", async () => {
  await C.goto(srv.url); await pronto(C); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
  const antes = await rpc(C, "selo_loja_estado", {}); assert.equal(antes.data.filter((c) => c.item === "jumpscare").length, 0, "a compra fica escondida até o susto");
  assert.equal((await rpc(C, "jumpscare_pendentes", {})).data.length, 1, "falta um susto para C");
  await C.waitForTimeout(3500); assert.equal(await C.evaluate(() => document.querySelector("#susto").open), false, "fora do grupo não acontece");
  await C.click("#contacts button[data-grupo]"); await C.waitForSelector('#conv-title:text-is("Susto")'); await C.waitForSelector("#susto[open]", { timeout: 30000 }); await C.waitForFunction(() => document.getElementById("susto-img").naturalWidth > 0, null, { timeout: 15000 });
  assert.equal(await aviso(C).count(), 0, "sem aviso antes do susto"); assert.equal(await largura(C), globalThis.larguraA, "é o mesmo jumpscare que os outros levaram");
  await fechaSusto(C); await aviso(C).waitFor({ timeout: 30000 });
  await C.waitForTimeout(2500); assert.equal(await C.evaluate(() => document.querySelector("#susto").open), false, "não repete");
  assert.deepEqual((await rpc(C, "jumpscare_pendentes", {})).data, []); assert.ok((await rpc(C, "selo_loja_estado", {})).data.some((c) => c.item === "jumpscare"), "agora a compra aparece para C");
  await C.reload(); await pronto(C); await C.click("#contacts button[data-grupo]"); await C.waitForSelector('#conv-title:text-is("Susto")'); await C.waitForSelector("#messages:not(.carregando)");
  await aviso(C).waitFor({ timeout: 30000 }); assert.equal(await aviso(C).count(), 1, "o aviso fica no histórico, uma vez só"); await C.waitForTimeout(2000); assert.equal(await C.evaluate(() => document.querySelector("#susto").open), false);
});
t("travas do banco: lista, arquivos inválidos, limite de 10, de fora, tabelas fechadas e sem alvo", async () => {
  const x = await apiUser("x"), gid = (await rpc(A, "jumpscare_lista", {})).gid, a = await uid(A), ok = (n) => ({ p: `${a}/${gid}/${hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5")}`, iv: "aXZpdml2aXZpdg==", t: "image/png" });
  assert.equal((await rpc(A, "jumpscare_novo", { p_img: { p: "../x", iv: "y" } })).code, "22023", "caminho inválido"); assert.equal((await rpc(A, "jumpscare_novo", { p_img: { p: `${a}/${a}/${a}`, iv: "y" } })).code, "22023", "pasta de outro grupo");
  assert.equal((await rpc(A, "jumpscare_novo", { p_img: ok(), p_som: { p: "x", iv: "y" } })).code, "22023", "som inválido");
  const ids = []; for (let i = 0; i < 8; i++) { const r = await rpc(A, "jumpscare_novo", { p_img: ok() }); assert.equal(r.code, null); ids.push(r.data); }
  assert.equal((await rpc(A, "jumpscare_novo", { p_img: ok() })).msg, "lista_cheia", "no máximo 10");
  for (const id of ids) assert.equal((await rpc(A, "jumpscare_apagar", { p_id: id })).code, null); assert.equal((await rpc(B, "jumpscare_apagar", { p_id: 1 })).code, "42501", "só o admin apaga");
  const g = hex().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  assert.equal((await x.c.rpc("jumpscare_lista", { p_grupo: g })).data?.length || 0, 0, "de fora a lista vem vazia");
  for (const [f, args] of [["jumpscare_novo", { p_grupo: g, p_img: ok() }], ["jumpscare_apagar", { p_grupo: g, p_id: 1 }], ["jumpscare_visto", { p_compra: 1 }]]) assert.ok((await x.c.rpc(f, args)).error, f + " de fora é recusada");
  assert.equal((await x.c.rpc("jumpscare_pendentes", { p_grupo: g })).data?.length || 0, 0); assert.equal((await x.c.rpc("jumpscare_obter", { p_grupo: g, p_id: 1 })).data?.length || 0, 0);
  for (const tab of ["jumpscares", "jumpscare_vistos"]) { assert.ok((await x.c.from(tab).select("*")).error, tab + " fechada para leitura"); assert.ok((await x.c.from(tab).insert({ grupo_id: g })).error, tab + " fechada para escrita"); }
  assert.equal(await B.evaluate(async () => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"); return (await createClient(SUPABASE_URL, SUPABASE_KEY).rpc("jumpscare_visto", { p_compra: 999999999 })).error?.code; }), "42501", "compra que não existe"); assert.equal((await rpc(A, "selo_comprar", { p_item: "jumpscare", p_alvo: await uid(B) })).code, "22023", "jumpscare não aceita alvo");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
