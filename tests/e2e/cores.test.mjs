// Cor de cada pessoa no grupo: foto ao lado da última mensagem da sequência, balão colorido, seletor (com a foto de quem usa cada cor) e cor aleatória quando todas estão em uso.
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
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Cores"); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Cores")', { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector('#conv-title:text-is("Cores")'); await B.waitForSelector("#messages:not(.carregando)");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("cada pessoa tem a sua cor: o balão dos outros leva a cor deles, o seu continua azul-escuro, e a foto aparece só ao lado da última mensagem da sequência", async () => {
  await enviar(B, "primeira do b"); await enviar(B, "segunda do b");
  await A.waitForSelector(".msg.grupo-msg .vis:text-is('segunda do b')", { timeout: 30000 }); await enviar(A, "minha"); await B.waitForSelector(".msg.grupo-msg .vis:text-is('minha')", { timeout: 30000 });
  assert.equal(await fundo(A, ".msg.grupo-msg:has(.vis:text-is('primeira do b'))"), rgb("#DCE7FF"), "B é a 2ª pessoa: Azul"); assert.equal(await fundo(B, ".msg.grupo-msg:has(.vis:text-is('minha'))"), rgb("#FDE3EA"), "A criou o grupo: Rosa");
  const mine = await A.locator(".msg.mine .bubble").first().evaluate((e) => getComputedStyle(e).backgroundColor); assert.notEqual(mine, rgb("#FDE3EA")); assert.equal(await A.locator(".msg.mine.cor, .msg.mine .ava-slot").count(), 0, "minhas mensagens: sem cor de pessoa e sem foto");
  const vis = await A.locator(".msg.grupo-msg .ava-slot").evaluateAll((l) => l.map((x) => !x.classList.contains("oculto"))); assert.deepEqual(vis, [false, true], "foto só na última mensagem seguida do b");
  const nomeCor = await A.locator(".msg.grupo-msg:has(.vis:text-is('primeira do b')) .autor").evaluate((e) => getComputedStyle(e).color); assert.equal(nomeCor, rgb("#2B4FB8"), "o nome vem na cor da pessoa");
  await enviar(A, "outra minha"); await A.waitForSelector(".msg.mine .vis:text-is('outra minha')"); await enviar(B, "terceira do b"); await A.waitForSelector(".msg.grupo-msg .vis:text-is('terceira do b')", { timeout: 30000 });
  assert.deepEqual(await A.locator(".msg.grupo-msg .ava-slot").evaluateAll((l) => l.map((x) => !x.classList.contains("oculto"))), [false, true, true], "a foto 'anda' para a última mensagem da sequência; a do b que vem depois de uma minha ganha a sua");
});
t("seletor: mostra 'Rosa', as cores de outros ficam apagadas com a foto de quem usa, escolher uma livre atualiza a prévia e, ao salvar, os outros veem a nova cor na hora", async () => {
  await A.click("#grupo-btn"); await A.waitForSelector("#grupo-info[open]"); assert.equal(await A.locator("#gi-cor-nome").innerText(), "Rosa");
  await A.click("#gi-cor"); await A.waitForSelector("#cor-folha[open]"); assert.equal(await A.locator("#cf-grade .cf-sw").count(), 10);
  assert.equal(await A.locator("#cf-grade .cf-sw.ocup").count(), 1, "só a do B está em uso por outra pessoa"); const ocup = A.locator("#cf-grade .cf-sw.ocup"); assert.equal(await ocup.isDisabled(), true); assert.equal(await ocup.locator(".avatar").count(), 1, "mostra a foto/avatar de quem usa, não uma letra solta como identificação"); assert.match(await ocup.getAttribute("aria-label"), new RegExp(`Azul, usada por @${nomeB}`));
  assert.equal(await A.locator("#cf-cheio").isHidden(), true, "ainda há cores livres: sem opção aleatória"); assert.equal(await A.locator("#cf-alea").isHidden(), true); assert.equal(await A.locator("#cf-salvar").isDisabled(), true, "nada mudou ainda");
  await A.click('#cf-grade .cf-sw[aria-label="Laranja"]'); assert.equal(await A.locator("#cf-salvar").isDisabled(), false); assert.equal(await A.locator("#cf-bub").evaluate((e) => getComputedStyle(e).backgroundColor), rgb("#FFE2CC"), "a prévia já mostra o laranja");
  await A.click("#cf-salvar"); await A.waitForSelector("#cor-folha", { state: "hidden" }); await A.waitForFunction(() => document.getElementById("gi-cor-nome").textContent === "Laranja", null, { timeout: 20000 });
  await B.waitForFunction((c) => { const e = [...document.querySelectorAll(".msg.grupo-msg")].find((m) => m.querySelector(".vis")?.textContent === "minha"); return e && getComputedStyle(e.querySelector(".bubble")).backgroundColor === c; }, rgb("#FFE2CC"), { timeout: 40000 }); // o B vê as mensagens do A na cor nova sem recarregar
  await B.click("#grupo-btn"); await B.waitForSelector("#grupo-info[open]"); await B.click("#gi-cor"); await B.waitForSelector("#cor-folha[open]"); assert.equal(await B.locator('#cf-grade .cf-sw[aria-label^="Laranja"]').isDisabled(), true, "a cor que o A pegou aparece como usada para o B"); assert.equal(await B.locator('#cf-grade .cf-sw[aria-label="Rosa"]').isDisabled(), false, "e a que o A largou ficou livre");
  await B.click("#cf-cancelar"); await B.click("#grupo-info .pg-volta"); await A.click("#grupo-info .pg-volta");
});
t("todas as cores em uso: aparece a opção aleatória; a cor sorteada é a mais diferente de todas, ninguém repete, quem sai libera e quem entra pega a livre", async () => {
  const X = await apiUser("x"), F = []; for (let i = 0; i < 8; i++) F.push(await apiUser("f" + i));
  await chamar(A, X.nome); await A.waitForSelector(`#conv-title:text-is("@${X.nome}")`); await enviar(A, "oi x"); await A.waitForSelector(".msg.mine .vis:text-is('oi x')");
  const idA = await A.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return JSON.parse(localStorage[k]).user.id; });
  assert.ifError((await X.c.from("messages").insert(baseMsg(idA))).error);
  for (const f of F) { assert.ifError((await X.c.from("messages").insert(baseMsg(f.id))).error); assert.ifError((await f.c.from("messages").insert(baseMsg(X.id))).error); }
  const g = crypto.randomUUID(); assert.ifError((await X.c.rpc("criar_grupo", { p_id: g, p_nome: { c: "bm9tZQ==", iv: "aXZpdml2aXZpdg==" }, p_chave: cif(), p_membros: [idA, ...F.map((f) => f.id)].map((id) => ({ id, chave: cif() })) })).error);
  const cores = async () => Object.fromEntries((await X.c.rpc("meus_grupos")).data.filter((l) => l.grupo_id === g).map((l) => [l.user_id, l.cor])); const c0 = await cores();
  assert.equal(new Set(Object.values(c0)).size, 10, "dez pessoas, dez cores diferentes"); assert.deepEqual(Object.values(c0).sort(), ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
  await A.reload(); await pronto(A); await A.waitForSelector(`#contacts button[data-grupo][data-grupo="${g}"]`, { timeout: 30000 }); await A.click(`#contacts button[data-grupo="${g}"]`); await A.waitForSelector("#messages:not(.carregando)");
  await A.click("#grupo-btn"); await A.waitForSelector("#grupo-info[open]"); await A.click("#gi-cor"); await A.waitForSelector("#cor-folha[open]");
  assert.equal(await A.locator("#cf-cheio").isVisible(), true, "avisa que todas estão em uso"); assert.equal(await A.locator("#cf-alea").isVisible(), true); assert.equal(await A.locator("#cf-grade .cf-sw.ocup").count(), 9, "as 9 cores dos outros apagadas"); assert.equal(await A.locator("#cf-grade .cf-sw.ocup .avatar").count(), 9, "cada uma com o avatar de quem usa");
  await A.click("#cf-alea"); await A.waitForSelector("#cf-grade .cf-sw.alea.sel"); await A.click("#cf-salvar"); await A.waitForSelector("#cor-folha", { state: "hidden" }); await A.waitForFunction(() => document.getElementById("gi-cor-nome").textContent === "Cor aleatória", null, { timeout: 20000 });
  const c1 = await cores(), nova = c1[idA], outras = Object.entries(c1).filter(([u]) => u !== idA).map(([, c]) => c); assert.ok(corValida(nova) && nova[0] === "#", nova); assert.ok(!outras.includes(nova)); assert.ok(distanciaMinima(nova, outras) >= 10, "bem diferente de todas as outras: " + distanciaMinima(nova, outras));
  assert.deepEqual(outras.sort(), Object.entries(c0).filter(([u]) => u !== idA).map(([, c]) => c).sort(), "as dos outros não mudaram");
  const extra = await apiUser("f9"); assert.ifError((await X.c.from("messages").insert(baseMsg(extra.id))).error); assert.ifError((await extra.c.from("messages").insert(baseMsg(X.id))).error);
  assert.ifError((await X.c.rpc("grupo_adicionar", { p_grupo: g, p_user: extra.id, p_chave: cif() })).error); const c2 = await cores(); assert.equal(c2[extra.id], c0[idA], "quem entra pega a cor pronta que o A largou");
  assert.equal(new Set(Object.values(c2)).size, 11, "onze pessoas, nenhuma cor repetida");
});
t("nenhum erro de página", async () => { assert.deepEqual(erros, []); });
