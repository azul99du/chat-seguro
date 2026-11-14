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

const logsA = [];
let listaFinal = []; // (o que a conversa mostrava depois do teste da mensagem esquecida)
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const textos = (p) => p.locator(".msg .vis").allInnerTexts().then((l) => l.filter((x) => x.trim()));
const GRUPO = "Rapido";
// atrasa as respostas do servidor sobre mensagens (leitura) em "ms"; devolve o controle para saber se já responderam
async function atrasar(p, ms) {
  const c = { liberou: false, n: 0 };
  await p.route(/\/rest\/v1\/messages\?/, async (route) => { if (route.request().method() !== "GET") return route.continue(); c.n++; await dorme(ms); c.liberou = true; route.continue().catch(() => {}); });
  return c;
}
// "Piscar": depois que a lista já está na tela, nenhuma mensagem pode ser APAGADA dela e ela não pode voltar a ficar escondida (era o que acontecia: aparecia, sumia por 1 s e reaparecia)
const vigiarPiscada = (p) => p.evaluate(() => {
  const m = document.getElementById("messages"), ini = new WeakSet([...m.children]); window.__piscou = { apagou: 0, escondeu: 0 };
  new MutationObserver((ls) => { for (const r of ls) { if (r.type === "childList") for (const n of r.removedNodes) if (ini.has(n)) window.__piscou.apagou++; if (r.type === "attributes" && m.classList.contains("carregando")) window.__piscou.escondeu++; } }).observe(m, { childList: true, attributes: true, attributeFilter: ["class"] });
});
const piscou = (p) => p.evaluate(() => window.__piscou);
const recarregar = async (p) => { await p.unroute(/\/rest\/v1\/messages\?/).catch(() => {}); await p.reload(); await pronto(p); await p.waitForTimeout(1500); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }); await ctx.addInitScript(() => { try { localStorage.setItem("lacre:poll", "0"); } catch {} }); const p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); if (n === "A") p.on("console", (m) => logsA.push(m.type() + ": " + m.text().slice(0, 200))); return p; };
  [A, B] = [await novo("A"), await novo("B")]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("partida: A e B conversam, e criam um grupo com mensagens dos dois", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  await enviar(A, "dm um do A"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('dm um do A')", { timeout: 30000 });
  await enviar(B, "dm dois do B");
  try { await A.waitForSelector(".msg:not(.mine) .vis:has-text('dm dois do B')", { timeout: 30000 }); }
  catch (e) { // diagnóstico (só quando falha): o que A mostra, o que o console dela disse e o que o servidor guardou para ela
    const d = await A.evaluate(async () => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), s = JSON.parse(localStorage[k]), u = s.user.id;
      const r = await fetch(`${location.origin}/__sb`).catch(() => null); const cfg = await (await fetch("config.js")).text(); const url = cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1], key = cfg.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/)[1];
      const rows = await (await fetch(`${url}/rest/v1/messages?select=id,created_at,sender_id&recipient_id=eq.${u}&order=id`, { headers: { apikey: key, authorization: "Bearer " + s.access_token } })).json();
      return { na_tela: [...document.querySelectorAll(".msg .vis")].map((x) => x.innerText), corte: localStorage.getItem("lacre:sync:" + u), no_servidor: rows, lista: document.getElementById("messages").className, chat: document.getElementById("chat").className, titulo: document.getElementById("conv-title")?.textContent, visivel: document.visibilityState, online: navigator.onLine }; }).catch((x) => ({ erro: String(x) }));
    console.error("DIAGNOSTICO A:", JSON.stringify(d), "\nCONSOLE A:", JSON.stringify(logsA.slice(-40))); throw e; }
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
  await vigiarPiscada(A);
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido quando a lista apareceu"); assert.ok(ms < 3500, `demorou ${ms} ms`);
  assert.deepEqual(await textos(A), ["dm um do A", "dm dois do B", "dm tres do A", "dm quatro do B"]);
  const L = await A.evaluate(() => { const m = document.getElementById("messages"); return m.scrollHeight - m.clientHeight - m.scrollTop; }); assert.ok(L <= 5, `abriu no fim (faltam ${L}px)`);
  await B.click(`#contacts button:not([data-grupo]):has-text("@${nomeA}")`); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.waitForSelector("#messages:not(.carregando)"); // (o B estava com o grupo aberto)
  await enviar(B, "dm chegou durante a abertura"); await dorme(1200);
  assert.equal((await textos(A)).includes("dm chegou durante a abertura"), false, "(enquanto o servidor confere, o que chega espera na fila: entra no fim, uma vez só)");
  await A.waitForFunction(() => document.querySelectorAll(".msg").length >= 5, null, { timeout: 15000 }); await A.waitForTimeout(800);
  assert.deepEqual(await textos(A), ["dm um do A", "dm dois do B", "dm tres do A", "dm quatro do B", "dm chegou durante a abertura"]);
  assert.equal(await A.locator(".bubble.err").count(), 0); assert.equal(c.liberou, true);
  assert.deepEqual(await piscou(A), { apagou: 0, escondeu: 0 }, "a lista não pode sumir e voltar quando o servidor responde");
  await A.waitForSelector(".msg.mine .rcpt.read", { timeout: 15000 }); // o que o servidor sabe (B leu) chega à tela mesmo sem refazer a lista
});
t("grupo: com o servidor LENTO, as mensagens já aparecem na hora, em ordem; ao responder nada duplica", async () => {
  await recarregar(A); const c = await atrasar(A, 5000);
  const t0 = Date.now(); await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 4000 }); const ms = Date.now() - t0;
  await vigiarPiscada(A);
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido quando a lista apareceu"); assert.ok(ms < 3500, `demorou ${ms} ms`);
  assert.deepEqual(await textos(A), ["grupo um do A", "grupo dois do B", "grupo tres do A"]);
  assert.ok(await A.locator(".msg.mine").count() === 2 && await A.locator(".msg.grupo-msg").count() === 1, "minhas e dos outros, com a aparência de grupo");
  await dorme(5500);
  assert.equal(c.liberou, true); assert.deepEqual(await textos(A), ["grupo um do A", "grupo dois do B", "grupo tres do A"]); assert.equal(await A.locator(".bubble.err").count(), 0);
  assert.deepEqual(await piscou(A), { apagou: 0, escondeu: 0 }, "a lista não pode sumir e voltar quando o servidor responde");
});
t("conversas reais têm reações e mensagens que não viram balão: nada pisca, a reação já aparece com as mensagens e o servidor lento não muda a lista", async () => {
  // B reage a uma mensagem antiga do A e depois escreve outra: a linha da reação fica no servidor ENTRE as mensagens (não vira balão)
  await B.click(`#contacts button:not([data-grupo]):has-text("@${nomeA}")`); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.waitForSelector("#messages:not(.carregando)");
  await B.locator(".msg:has(.vis:text-is('dm um do A')) .bubble").first().click({ button: "right" }); await B.locator('.picker .emojis button[aria-label="Reagir com 👍"]').click();
  await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando)"); // (o A estava com o grupo aberto)
  await A.waitForSelector(".msg:has(.vis:text-is('dm um do A')) .chip", { timeout: 30000 });
  await enviar(B, "dm seis do B"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('dm seis do B')", { timeout: 30000 });
  await recarregar(A); const c = await atrasar(A, 5000);
  await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 4000 }); await vigiarPiscada(A);
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido");
  await A.waitForSelector(".msg:has(.vis:text-is('dm um do A')) .chip:has-text('👍')", { timeout: 2000 }); // (a reação guardada já aparece com as mensagens, sem esperar o servidor)
  const antes = await textos(A); await dorme(5800);
  assert.equal(c.liberou, true); assert.deepEqual(await textos(A), antes, "a lista é a mesma depois da conferência do servidor");
  assert.deepEqual(await piscou(A), { apagou: 0, escondeu: 0 }, "nada some nem volta a ficar escondido");
  assert.equal(await A.locator(".msg:has(.vis:text-is('dm um do A')) .chip").count(), 1, "uma reação só");
});
t("o servidor sabe de uma mensagem mais ANTIGA que a mais nova do aparelho: ela entra no lugar certo, sem refazer a lista e sem duplicar", async () => {
  await recarregar(A); await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg"); await A.waitForTimeout(1500);
  const antes = (await textos(A)).length; assert.ok(antes >= 5);
  // o aparelho "esquece" a SEGUNDA mensagem guardada (como se tivesse chegado com o Lacre fechado e ainda não estivesse guardada aqui)
  const esquecida = await A.evaluate(([uid, peer]) => new Promise((ok, no) => {
    const r = indexedDB.open("lacre-sf"); r.onerror = () => no(r.error);
    r.onsuccess = () => { const tx = r.result.transaction("history", "readwrite"), s = tx.objectStore("history"), q = s.getAllKeys(IDBKeyRange.bound(`${uid}|${peer}|`, `${uid}|${peer}|\uffff`));
      q.onsuccess = () => { const alvo = q.result[1]; s.delete(alvo); tx.oncomplete = () => ok(String(alvo)); }; tx.onerror = () => no(tx.error); };
  }), [await meuId(A), await meuId(B)]);
  assert.match(esquecida, /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|\d{12}$/);
  await recarregar(A); await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 30000 }); await vigiarPiscada(A);
  // a conferência do servidor (e a lista refeita, se preciso) leva um tempo que varia: espera a mensagem esquecida voltar em vez de um tempo fixo
  await A.waitForFunction((n) => [...document.querySelectorAll(".msg .vis")].filter((x) => x.textContent.trim()).length === n, antes, { timeout: 30000 }).catch(() => {}); await A.waitForTimeout(800);
  const l = await textos(A);
  assert.deepEqual(await piscou(A), { apagou: 0, escondeu: 0 }, "a mensagem que faltava entra no lugar certo SEM refazer a lista (antes a lista sumia por 1 s e voltava)");
  assert.equal(l.length, antes, `a mensagem esquecida volta (decifrada ou como aviso de que não dá): antes ${antes}, depois ${l.length}`);
  for (const x of ["dm um do A", "dm quatro do B", "dm chegou durante a abertura"]) assert.equal(l.filter((y) => y === x).length, 1, x);
  listaFinal = l;
  const ordem = ["dm um do A", "dm tres do A", "dm quatro do B", "dm chegou durante a abertura"].map((x) => l.indexOf(x)); assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, "as que o aparelho guardava continuam em ordem");
});
t("balões de aviso (mensagem que não deu para decifrar) são lembrados: na próxima abertura já vêm junto com o resto, sem entrar no meio da lista depois", async () => {
  assert.ok(listaFinal.length >= 5);
  await recarregar(A); const c = await atrasar(A, 5000);
  await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 4000 }); await vigiarPiscada(A);
  assert.equal(c.liberou, false, "o servidor ainda não tinha respondido");
  assert.deepEqual(await textos(A), listaFinal, "a lista completa (com o balão de aviso, no lugar certo) já está na tela antes de o servidor responder");
  await dorme(5800); assert.equal(c.liberou, true);
  assert.deepEqual(await textos(A), listaFinal); assert.deepEqual(await piscou(A), { apagou: 0, escondeu: 0 });
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
