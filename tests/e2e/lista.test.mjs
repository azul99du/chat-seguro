// Lista de conversas: mensagens novas com contagem (que continua depois de recarregar), horário da última mensagem, quantos do grupo estão online, e o teclado só sobe quando se toca no campo (celular).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const meuId = (p) => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return JSON.parse(localStorage[k]).user.id; });
const linha = (p, nome) => p.locator(`#contacts button:has-text("${nome}")`);
const SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("mensagens novas: a contagem sobe a cada mensagem, mostra a hora da última e some ao abrir a conversa", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  for (const x of ["um", "dois", "três"]) await enviar(A, "mensagem " + x);
  await B.waitForFunction((n) => document.querySelector("#contacts button .unread")?.textContent === n, "3", { timeout: 30000 });
  const l = linha(B, nomeA); assert.match(await l.locator(".hora").innerText(), /^\d{2}:\d{2}$/, "hoje: só a hora"); assert.equal(await l.locator(".unread").getAttribute("aria-label"), "3 mensagens novas");
  await enviar(A, "quatro"); await B.waitForFunction((n) => document.querySelector("#contacts button .unread")?.textContent === n, "4", { timeout: 30000 });
  await B.reload(); await pronto(B); await B.waitForSelector("#contacts button .unread", { timeout: 30000 });
  assert.equal(await linha(B, nomeA).locator(".unread").innerText(), "4", "depois de recarregar a contagem continua (e a mesma mensagem não é contada duas vezes)");
  assert.match(await linha(B, nomeA).locator(".hora").innerText(), /^\d{2}:\d{2}$/);
  await linha(B, nomeA).click(); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.waitForSelector("#messages:not(.carregando) .msg");
  assert.equal(await linha(B, nomeA).locator(".unread").count(), 0, "abriu: zerou"); assert.match(await linha(B, nomeA).locator(".hora").innerText(), /^\d{2}:\d{2}$/, "a hora fica");
  await B.reload(); await pronto(B); assert.equal(await linha(B, nomeA).locator(".unread").count(), 0, "e continua zerado depois de recarregar");
});
t("horário: hoje a hora; até 6 dias atrás o dia da semana; antes disso a data completa dia/mês/ano", async () => {
  const idA = await meuId(A), idB = await meuId(B), dia = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };
  for (const [n, esperado] of [[2, SEMANA[dia(2).getDay()]], [6, SEMANA[dia(6).getDay()]], [7, dia(7).toLocaleDateString("pt-BR")], [40, dia(40).toLocaleDateString("pt-BR")]]) {
    await B.evaluate(({ idB, idA, ms }) => localStorage.setItem(`lacre:ult:${idB}`, JSON.stringify({ [idA]: ms })), { idB, idA, ms: dia(n).getTime() });
    await B.reload(); await pronto(B); await B.waitForSelector("#contacts button .hora");
    const txt = await linha(B, nomeA).locator(".hora").innerText(); assert.equal(txt, esperado, `${n} dias atrás`); if (n >= 7) assert.match(txt, /^\d{2}\/\d{2}\/\d{4}$/);
    assert.ok((await linha(B, nomeA).locator(".hora").getAttribute("title")).length > 8, "ao parar o mouse aparece a data por extenso");
  }
});
t("grupo: quantos estão online aparece na lista, e as mensagens novas do grupo também são contadas", async () => {
  await abrirConversa(B, nomeA); await enviar(B, "oi a"); await A.waitForSelector(`#contacts button:has-text("${nomeB}")`);
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c"); await C.waitForSelector("#contacts button", { timeout: 30000 }); await abrirConversa(C, nomeA); await enviar(C, "oi a, aqui é o c"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('aqui é o c')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Lista teste");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector(`#conv-title:text-is("Lista teste")`, { timeout: 30000 });
  const g = A.locator("#contacts button[data-grupo]");
  await A.waitForFunction(() => /grupo · 3 pessoas · 2 online/.test(document.querySelector("#contacts button[data-grupo]")?.innerText.replace(/\s+/g, " ") || ""), null, { timeout: 40000 });
  assert.equal((await g.locator(".sub .on").innerText()).trim(), "· 2 online");
  await C.close().catch(() => {}); await C.context().close().catch(() => {});
  await A.waitForFunction(() => /· 1 online/.test(document.querySelector("#contacts button[data-grupo]")?.innerText.replace(/\s+/g, " ") || ""), null, { timeout: 60000 }); // (C saiu: sobra B)
  await enviar(A, "primeira do grupo"); await enviar(A, "segunda do grupo");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.waitForFunction(() => document.querySelector("#contacts button[data-grupo] .unread")?.textContent === "2", null, { timeout: 30000 });
  assert.match(await B.locator("#contacts button[data-grupo] .hora").innerText(), /^\d{2}:\d{2}$/);
  await B.locator("#contacts button[data-grupo]").click(); await B.waitForSelector("#messages:not(.carregando) .msg"); assert.equal(await B.locator("#contacts button[data-grupo] .unread").count(), 0);
  assert.equal(await A.locator("#contacts button[data-grupo] .unread").count(), 0, "as próprias mensagens não contam como novas");
});
async function abrirConversa(p, nome) { await p.click(`#contacts button:not([data-grupo]):has-text("@${nome}")`); await p.waitForSelector(`#conv-title:text-is("@${nome}")`); await p.waitForSelector("#messages:not(.carregando)"); }

t("teclado: no celular só sobe quando a pessoa toca no campo; com mouse (computador) o foco vai direto para o campo", async () => {
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }), M = await ctxM.newPage(); M.on("pageerror", (e) => erros.push("M: " + e.message));
  await cadastrar(M, novoUsuario("m"));
  assert.equal(await M.evaluate(() => matchMedia("(pointer: fine)").matches), false, "(o navegador de teste está simulando um celular)");
  await chamar(M, nomeA); await M.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await M.waitForSelector("#messages:not(.carregando)"); await M.waitForTimeout(600);
  assert.notEqual(await M.evaluate(() => document.activeElement?.id), "text", "abriu a conversa: teclado NÃO sobe sozinho");
  await M.tap("#text"); assert.equal(await M.evaluate(() => document.activeElement?.id), "text", "tocou no campo: agora sim");
  await M.fill("#text", "oi"); await M.tap("#send-form .primary"); await M.waitForSelector(".msg.mine .bubble"); assert.equal(await M.evaluate(() => document.activeElement?.id), "text", "enviou digitando: o campo continua com o foco (teclado aberto)");
  await M.locator("#text").evaluate((e) => e.blur()); await M.click("#back"); await M.waitForTimeout(300);
  await M.click("#contacts button"); await M.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await M.waitForTimeout(600); assert.notEqual(await M.evaluate(() => document.activeElement?.id), "text", "reabrir pela lista também não abre o teclado");
  await ctxM.close();
  await abrirConversa(B, nomeA); await B.waitForTimeout(400); assert.equal(await B.evaluate(() => document.activeElement?.id), "text", "no computador, com mouse, o foco continua indo direto para o campo");
});
t("nenhum erro de página", async () => { assert.deepEqual(erros, []); });
