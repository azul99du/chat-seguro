// Trocar o nome de usuário pela tela: valida, recusa nome existente e troca repetida, avisa os contatos (conversa a dois e grupo) e reserva o nome antigo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar, menuConta } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, novoA; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario, esperaPronto = true) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open], #auth-msg:not(:empty)", { timeout: 30000 }); if (!esperaPronto) return; await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const abrirPerfil = async (p) => { await menuConta(p, "#menu-foto"); await p.waitForSelector("#perfil[open]"); };
const trocar = async (p, nome) => { await p.click("#perfil-trocar"); await p.waitForSelector("#ask[open]"); await p.fill("#ask-input", nome); await p.click("#ask button[value=ok]"); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); novoA = novoUsuario("n");
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, novoUsuario("c"));
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 });
  await B.click("#contacts button"); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis:text-is('oi a')", { timeout: 30000 });
  // grupo criado ANTES da troca de nome (B e A já conversaram nos dois sentidos)
  await B.click("#chamar-fab"); await B.click("#novo-grupo"); await B.waitForSelector("#grupo-novo[open]"); await B.fill("#gn-nome", "Nomes"); await B.check(`#gn-lista label:has-text("@${nomeA}") .marca`); await B.click("#gn-criar"); await B.waitForSelector(`#conv-title:text-is("Nomes")`, { timeout: 30000 });
  await A.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#back").catch(() => {}); await B.click(`#contacts button:not([data-grupo]):has-text("@${nomeA}")`); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a tela valida o nome e o banco recusa nome que já existe; nada muda", async () => {
  await abrirPerfil(A); assert.equal(await A.locator("#perfil-nome").innerText(), "@" + nomeA);
  await trocar(A, "@ab"); await A.waitForFunction(() => /3 a 20 letras/.test(document.getElementById("ask-text").textContent)); await A.fill("#ask-input", "@" + nomeA); await A.click("#ask button[value=ok]");
  await A.waitForFunction(() => /já é o seu nome/.test(document.getElementById("ask-text").textContent)); await A.fill("#ask-input", "joão"); await A.click("#ask button[value=ok]"); await A.waitForFunction(() => /sem acento/.test(document.getElementById("ask-text").textContent));
  await A.fill("#ask-input", "@" + nomeB.toUpperCase()); await A.click("#ask button[value=ok]"); await A.waitForSelector("#choice[open]"); assert.match(await A.locator("#choice-text").innerText(), new RegExp(`${nomeA}.*agora é @${nomeB}`, "s")); await A.click('#choice-actions button[value="sim"]');
  await A.waitForFunction(() => /já existe/.test(document.getElementById("perfil-msg").textContent), null, { timeout: 20000 }); assert.equal(await A.locator("#perfil-nome").innerText(), "@" + nomeA, "continua com o nome antigo");
});
t("trocar para um nome livre: a conta, o menu e a tela mostram o novo; trocar de novo logo em seguida é recusado com a data", async () => {
  await trocar(A, "@" + novoA.toUpperCase()); await A.waitForSelector("#choice[open]"); assert.match(await A.locator("#choice-text").innerText(), /reservado só para você por 30 dias/); await A.click('#choice-actions button[value="sim"]');
  await A.waitForFunction((n) => document.getElementById("perfil-nome").textContent === "@" + n, novoA, { timeout: 30000 }); assert.match(await A.locator("#perfil-msg").innerText(), new RegExp(`agora é @${novoA}`));
  await A.click("#perfil .pg-volta"); assert.equal(await A.locator("#nome-txt").innerText(), "@" + novoA); await A.reload(); await pronto(A); await menuConta(A); assert.equal(await A.locator("#nome-txt").innerText(), "@" + novoA, "e continua depois de recarregar");
  await A.click("#menu-foto"); await A.waitForSelector("#perfil[open]"); await trocar(A, "outro" + novoA.slice(1, 8)); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="sim"]');
  await A.waitForFunction(() => /trocou o nome há pouco/.test(document.getElementById("perfil-msg").textContent), null, { timeout: 20000 }); assert.match(await A.locator("#perfil-msg").innerText(), /\d{2}\/\d{2}\/\d{4}/); await A.click("#perfil .pg-volta");
});
t("o contato vê o nome novo na hora (sem recarregar), com o aviso na conversa, que continua depois de recarregar", async () => {
  await B.waitForFunction((n) => [...document.querySelectorAll("#contacts button")].some((b) => b.innerText.includes("@" + n)), novoA, { timeout: 40000 });
  await B.waitForSelector(`#conv-title:text-is("@${novoA}")`, { timeout: 20000 }); await B.waitForFunction((t) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === t), `@${nomeA} agora é @${novoA}`, { timeout: 20000 });
  await B.reload(); await pronto(B); await B.click("#contacts button:not([data-grupo])"); await B.waitForSelector(`#conv-title:text-is("@${novoA}")`); await B.waitForSelector("#messages:not(.carregando)");
  assert.deepEqual(await B.locator(".aviso-linha").allInnerTexts(), [`@${nomeA} agora é @${novoA}`]); const ordem = await B.locator("#messages > *").evaluateAll((l) => l.map((x) => (x.classList.contains("aviso-linha") ? "aviso" : "msg")));
  assert.deepEqual(ordem, ["msg", "msg", "aviso"], "o aviso fica depois das mensagens que já existiam");
  await enviar(B, "te achei"); await A.waitForSelector("#contacts button:not([data-grupo]) .unread", { timeout: 30000 }); await A.click("#contacts button:not([data-grupo])"); await A.waitForSelector(".msg:not(.mine) .vis:text-is('te achei')", { timeout: 30000 }); assert.equal(await A.locator(".msg:not(.mine) .vis:text-is('te achei')").count(), 1, "a conversa continua funcionando com o nome novo");
});
t("grupo: quem já estava no grupo vê o aviso de troca de nome e a lista com o nome novo", async () => {
  await B.click("#contacts button[data-grupo]"); await B.waitForSelector(`#conv-title:text-is("Nomes")`); await B.waitForSelector("#messages:not(.carregando)");
  await B.waitForFunction((t) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === t), `@${nomeA} agora é @${novoA}`, { timeout: 30000 });
  await B.click("#grupo-btn"); await B.waitForSelector("#grupo-info[open]"); const lista = await B.locator("#gi-lista").innerText(); assert.ok(lista.includes("@" + novoA) && !lista.includes("@" + nomeA + "\n") && !lista.includes("@" + nomeA + " "), "a lista só tem o nome novo"); await B.click("#grupo-info .pg-volta");
  await B.reload(); await pronto(B); await B.click("#contacts button[data-grupo]"); await B.waitForSelector("#messages:not(.carregando)");
  assert.ok((await B.locator(".aviso-linha").allInnerTexts()).includes(`@${nomeA} agora é @${novoA}`), "o aviso continua depois de recarregar");
});
t("o nome antigo fica reservado: ninguém cria conta com ele, e o nome novo é achado pela busca", async () => {
  await C.goto(srv.url); await pronto(C).catch(() => {}); const ctx = await browser.newContext(); const N = await ctx.newPage(); N.on("pageerror", (e) => erros.push("N: " + e.message));
  await cadastrar(N, nomeA, false); await N.waitForFunction(() => /já existe/.test(document.getElementById("auth-msg").textContent) || document.querySelector("#ask[open]"), null, { timeout: 30000 });
  if (await N.locator("#ask[open]").count()) { await N.fill("#ask-input", FRASE); await N.click("#ask button[value=ok]"); await N.waitForFunction(() => /já existe/.test(document.getElementById("note-text")?.textContent || "") || /já existe/.test(document.getElementById("auth-msg").textContent), null, { timeout: 30000 }); }
  assert.match((await N.locator("#note-text").innerText().catch(() => "")) + (await N.locator("#auth-msg").innerText().catch(() => "")), /já existe/, "cadastro com o nome antigo é recusado");
  await ctx.close();
  await chamar(C, novoA); await C.waitForSelector(`#conv-title:text-is("@${novoA}")`, { timeout: 20000 });
  await C.click("#back").catch(() => {}); await chamar(C, nomeA); await C.waitForSelector("#note[open]", { timeout: 20000 }); assert.match(await C.locator("#note-text").innerText(), /Não encontramos/, "o nome antigo não acha ninguém");
});
t("nenhum erro de página", async () => { assert.deepEqual(erros, []); });
