// Quem viu a minha mensagem no grupo (selo com anel): "0/2" ao enviar, "1/2" quando um lê, "todos" quando os dois leem; tocar mostra quem viu e quando.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC;
const t = (nome, fn) => test(nome, { timeout: 200000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const selo = (p, txt) => p.locator(`.msg.mine:has(.vis:has-text("${txt}")) .rcpt`);
const textoSelo = (p, txt) => selo(p, txt).innerText().then((x) => x.trim());
const abrirGrupoDe = async (p) => {
  await p.click("#contacts button[data-grupo]");
  try { await p.waitForSelector('#conv-title:text-is("Vistos")', { timeout: 15000 }); } catch (e) { console.error("DIAG titulo:", await p.evaluate(() => [document.getElementById("conv-title")?.textContent, document.getElementById("chat")?.className, [...document.querySelectorAll("#contacts button")].map((b) => b.innerText.replace(/\s+/g, " "))])); throw e; }
  await p.waitForSelector("#messages:not(.carregando)");
};

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async () => (await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage());
  [A, B, C] = [await novo(), await novo(), await novo()]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { // só entra num grupo quem já respondeu: o B e o C respondem ao A
    await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome);
    await A.waitForSelector(`#contacts button:has-text("@${nome}") .unread, .msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 });
  }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Vistos");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar");
  try { await A.waitForSelector('#conv-title:text-is("Vistos")', { timeout: 30000 }); } catch (e) { console.error("DIAG A:", await A.evaluate(() => [document.getElementById("conv-title")?.textContent, document.getElementById("note")?.textContent, document.querySelector("#grupo-novo")?.open, document.getElementById("gn-msg")?.textContent])); throw e; }
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
  await abrirGrupoDe(B); // o B já está olhando o grupo (lê na hora); o C ainda não
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("ao enviar aparece o selo 0/2; quando só o B lê vira 1/2; quando o C também lê vira 'todos' (verde)", async () => {
  await enviar(A, "mensagem um");
  await A.waitForSelector('.msg.mine:has(.vis:has-text("mensagem um")) .rcpt.vistos', { timeout: 20000 });
  await A.waitForFunction(() => /1\/2/.test(document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent || ""), null, { timeout: 40000 }); // o B estava olhando: leu na hora
  assert.equal(await textoSelo(A, "mensagem um"), "1/2"); assert.equal(await selo(A, "mensagem um").evaluate((e) => e.classList.contains("todos")), false);
  await abrirGrupoDe(C); // agora o C lê
  await A.waitForFunction(() => document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() === "todos", null, { timeout: 40000 });
  assert.equal(await selo(A, "mensagem um").evaluate((e) => e.classList.contains("todos")), true, "verde quando todos viram");
});

t("tocar no selo abre quem viu (com a hora) e quem falta; o outro lado não vê nada disso nas mensagens dele", async () => {
  await B.click("#contacts button[data-grupo]"); // (B fica olhando o grupo; o C sai para a lista depois)
  await enviar(A, "mensagem dois"); await A.waitForSelector('.msg.mine:has(.vis:has-text("mensagem dois")) .rcpt.vistos', { timeout: 20000 });
  await C.evaluate(() => document.getElementById("back")?.click()); // o C sai do grupo: a próxima não será lida por ele
  await C.waitForTimeout(500);
  await enviar(A, "mensagem tres"); await A.waitForSelector('.msg.mine:has(.vis:has-text("mensagem tres")) .rcpt.vistos', { timeout: 20000 });
  await A.waitForFunction(() => /1\/2/.test(document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent || ""), null, { timeout: 40000 });
  await selo(A, "mensagem tres").click(); await A.waitForSelector("#visto-grupo[open]");
  const dlg = await A.locator("#visto-grupo").innerText();
  assert.match(dlg, /1 de 2 viram/); assert.match(dlg, new RegExp("@" + nomeB)); assert.match(dlg, /ainda não viram/i); assert.match(dlg, new RegExp("@" + nomeC)); assert.match(dlg, /ainda não/);
  assert.match(dlg, /\d{2}:\d{2}/, "a hora em que o B leu");
  await A.mouse.click(5, 5); await A.waitForFunction(() => !document.getElementById("visto-grupo").open); // fora da janela fecha
  assert.equal(await B.locator(".msg:not(.mine) .rcpt.vistos").count(), 0, "mensagens dos outros não mostram o selo");
});

t("depois de recarregar, o selo continua certo (vem do servidor) e uma mensagem lida por todos mostra 'Todos viram' na janela", async () => {
  await A.reload(); await pronto(A); await abrirGrupoDe(A);
  await A.waitForFunction(() => [...document.querySelectorAll(".msg.mine .rcpt")].some((r) => r.textContent.trim() === "todos"), null, { timeout: 30000 });
  assert.equal(await textoSelo(A, "mensagem um"), "todos"); assert.equal(await textoSelo(A, "mensagem tres"), "1/2");
  await selo(A, "mensagem um").click(); await A.waitForSelector("#visto-grupo[open]"); const d = await A.locator("#visto-grupo").innerText();
  assert.match(d, /Todos viram/); assert.doesNotMatch(d, /ainda não viram/i); assert.match(d, new RegExp("@" + nomeB)); assert.match(d, new RegExp("@" + nomeC));
  await A.keyboard.press("Escape"); await A.waitForFunction(() => !document.getElementById("visto-grupo").open);
});
