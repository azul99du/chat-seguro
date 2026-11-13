// Abrir uma conversa (a dois ou em grupo): as mensagens que o aparelho já guarda aparecem NA HORA, sem esperar o servidor responder (antes demorava 1 a 1,5 s).
// O servidor continua conferindo em seguida: não duplica nada, uma mensagem que chega durante a abertura entra uma vez só, e o que faltar entra no lugar certo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const meuId = (p) => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return JSON.parse(localStorage[k]).user.id; });

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const textos = (p) => p.locator(".msg .vis").allInnerTexts().then((l) => l.filter((x) => x.trim()));
const GRUPO = "Rapido";
// atrasa as respostas do servidor sobre mensagens (leitura) em "ms"; devolve o controle para saber se já responderam
async function atrasar(p, ms) {
  const c = { liberou: false, n: 0 };
  await p.route(/\/rest\/v1\/messages\?/, async (route) => { if (route.request().method() !== "GET") return route.continue(); c.n++; await dorme(ms); c.liberou = true; route.continue().catch(() => {}); });
  return c;
}
const recarregar = async (p) => { await p.unroute(/\/rest\/v1\/messages\?/).catch(() => {}); await p.reload(); await pronto(p); await p.waitForTimeout(1500); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B] = [await novo("A"), await novo("B")]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("partida: A e B conversam, e criam um grupo com mensagens dos dois", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  await enviar(A, "dm um do A"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('dm um do A')", { timeout: 30000 });
  await enviar(B, "dm dois do B"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('dm dois do B')", { timeout: 30000 });
  await enviar(A, "dm tres do A"); await enviar(B, "dm quatro do B"); await B.waitForSelector(".msg.mine .vis:has-text('dm quatro do B')"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('dm quatro do B')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", GRUPO); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`);
  await A.click("#gn-criar"); await A.waitForSelector(`#conv-title:text-is("${GRUPO}")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector(`#conv-title:text-is("${GRUPO}")`); await B.waitForSelector("#messages:not(.carregando)");
  await enviar(A, "grupo um do A"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('grupo um do A')", { timeout: 30000 });
  await enviar(B, "grupo dois do B"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('grupo dois do B')", { timeout: 30000 });
  await enviar(A, "grupo tres do A"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('grupo tres do A')", { timeout: 30000 });
});
t("conversa a dois: com o servidor LENTO (5 s), as mensagens já aparecem na hora, em ordem; ao responder, nada duplica e uma mensagem que chega durante a abertura entra uma vez só", async () => {
  await recarregar(A); const c = await atrasar(A, 5000);
  const t0 = Date.now(); await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`);
  await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 4000 }); const ms = Date.now() - t0;
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido quando a lista apareceu"); assert.ok(ms < 3500, `demorou ${ms} ms`);
  assert.deepEqual(await textos(A), ["dm um do A", "dm dois do B", "dm tres do A", "dm quatro do B"]);
  const L = await A.evaluate(() => { const m = document.getElementById("messages"); return m.scrollHeight - m.clientHeight - m.scrollTop; }); assert.ok(L <= 5, `abriu no fim (faltam ${L}px)`);
  await B.click(`#contacts button:not([data-grupo]):has-text("@${nomeA}")`); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.waitForSelector("#messages:not(.carregando)"); // (o B estava com o grupo aberto)
  await enviar(B, "dm chegou durante a abertura"); await dorme(1200);
  assert.equal((await textos(A)).includes("dm chegou durante a abertura"), false, "(enquanto o servidor confere, o que chega espera na fila: entra no fim, uma vez só)");
  await A.waitForFunction(() => document.querySelectorAll(".msg").length >= 5, null, { timeout: 15000 }); await A.waitForTimeout(800);
  assert.deepEqual(await textos(A), ["dm um do A", "dm dois do B", "dm tres do A", "dm quatro do B", "dm chegou durante a abertura"]);
  assert.equal(await A.locator(".bubble.err").count(), 0); assert.equal(c.liberou, true);
  await A.waitForSelector(".msg.mine .rcpt.read", { timeout: 15000 }); // o que o servidor sabe (B leu) chega à tela mesmo sem refazer a lista
});
t("grupo: com o servidor LENTO, as mensagens já aparecem na hora, em ordem; ao responder nada duplica", async () => {
  await recarregar(A); const c = await atrasar(A, 5000);
  const t0 = Date.now(); await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 4000 }); const ms = Date.now() - t0;
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido quando a lista apareceu"); assert.ok(ms < 3500, `demorou ${ms} ms`);
  assert.deepEqual(await textos(A), ["grupo um do A", "grupo dois do B", "grupo tres do A"]);
  assert.ok(await A.locator(".msg.mine").count() === 2 && await A.locator(".msg.grupo-msg").count() === 1, "minhas e dos outros, com a aparência de grupo");
  await dorme(5500);
  assert.equal(c.liberou, true); assert.deepEqual(await textos(A), ["grupo um do A", "grupo dois do B", "grupo tres do A"]); assert.equal(await A.locator(".bubble.err").count(), 0);
});
t("o servidor sabe de uma mensagem mais ANTIGA que a mais nova do aparelho: a lista é refeita e fica na ordem certa, sem duplicar", async () => {
  await recarregar(A); await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg"); await A.waitForTimeout(1500);
  const antes = (await textos(A)).length; assert.ok(antes >= 5);
  // o aparelho "esquece" a SEGUNDA mensagem guardada (como se tivesse chegado com o Lacre fechado e ainda não estivesse guardada aqui)
  const esquecida = await A.evaluate(([uid, peer]) => new Promise((ok, no) => {
    const r = indexedDB.open("lacre-sf"); r.onerror = () => no(r.error);
    r.onsuccess = () => { const tx = r.result.transaction("history", "readwrite"), s = tx.objectStore("history"), q = s.getAllKeys(IDBKeyRange.bound(`${uid}|${peer}|`, `${uid}|${peer}|\uffff`));
      q.onsuccess = () => { const alvo = q.result[1]; s.delete(alvo); tx.oncomplete = () => ok(String(alvo)); }; tx.onerror = () => no(tx.error); };
  }), [await meuId(A), await meuId(B)]);
  assert.match(esquecida, /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|\d{12}$/);
  await recarregar(A); await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 30000 });
  // a conferência do servidor (e a lista refeita, se preciso) leva um tempo que varia: espera a mensagem esquecida voltar em vez de um tempo fixo
  await A.waitForFunction((n) => [...document.querySelectorAll(".msg .vis")].filter((x) => x.textContent.trim()).length === n, antes, { timeout: 30000 }).catch(() => {}); await A.waitForTimeout(800);
  const l = await textos(A);
  assert.equal(l.length, antes, `a mensagem esquecida volta (decifrada ou como aviso de que não dá): antes ${antes}, depois ${l.length}`);
  for (const x of ["dm um do A", "dm quatro do B", "dm chegou durante a abertura"]) assert.equal(l.filter((y) => y === x).length, 1, x);
  const ordem = ["dm um do A", "dm tres do A", "dm quatro do B", "dm chegou durante a abertura"].map((x) => l.indexOf(x)); assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, "as que o aparelho guardava continuam em ordem");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
