// Subir a tela logo depois de abrir um grupo (ou conversa): a lista não pode ser puxada de volta para o fim enquanto o servidor ainda confere
// e acrescenta uma mensagem que o aparelho não tinha (antes cada mensagem acrescentada empurrava a tela para o fim, e a pessoa "lutava" com a rolagem por ~1 s).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar, menuConta } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, ctxA, A, B, nomeA, nomeB;
const t = (nome, fn) => test(nome, { timeout: 240000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const GRUPO = "Rolagem", longo = (n) => `mensagem ${n} ` + "texto comprido para ocupar varias linhas na tela ".repeat(7);
const rolagem = (p) => p.evaluate(() => { const L = document.getElementById("messages"); return { top: L.scrollTop, max: L.scrollHeight - L.clientHeight }; });

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctxA = await browser.newContext({ viewport: { width: 1100, height: 700 } }); const ctxB = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  [A, B] = [await ctxA.newPage(), await ctxB.newPage()]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  await enviar(A, "oi b"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .vis:has-text('oi b')", { timeout: 30000 });
  await enviar(B, "oi a"); await A.waitForSelector(".msg:not(.mine) .vis:has-text('oi a')", { timeout: 30000 });
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", GRUPO); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`);
  await A.click("#gn-criar"); await A.waitForSelector(`#conv-title:text-is("${GRUPO}")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await B.click("#contacts button[data-grupo]"); await B.waitForSelector(`#conv-title:text-is("${GRUPO}")`); await B.waitForSelector("#messages:not(.carregando)");
  for (let i = 1; i <= 6; i++) { // conversa comprida (a lista passa da altura da tela)
    await enviar(A, longo(i * 2 - 1)); await B.waitForSelector(`.msg:not(.mine) .vis:has-text("mensagem ${i * 2 - 1} ")`, { timeout: 30000 });
    await enviar(B, longo(i * 2)); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("mensagem ${i * 2} ")`, { timeout: 30000 });
  }
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

const altura = (p) => p.evaluate(() => document.getElementById("messages").scrollHeight);
t("figurinhas recebidas: o espaço do botão 'Salvar figurinha' e a proporção da imagem já estão reservados, então a lista não muda de altura quando a figurinha termina de carregar", async () => {
  // (era assim que a tela "balançava" ao rolar logo depois de abrir: cada figurinha ganhava um botão e a lista andava ~30 px quadro a quadro)
  await B.route(/\/storage\/v1\/object\//, async (route) => { if (route.request().method() !== "GET") return route.continue(); await dorme(1500); route.continue().catch(() => {}); }); // B demora para baixar o arquivo
  const png = Buffer.from(await A.evaluate(() => { const c = document.createElement("canvas"); c.width = 120; c.height = 80; const x = c.getContext("2d"); x.fillStyle = "#d22"; x.fillRect(40, 20, 40, 40); return c.toDataURL("image/png").split(",")[1]; }), "base64"); // 120x80 com fundo transparente (não quadrada)
  await A.click("#mais"); await A.click("#sticker"); await A.waitForSelector("#stk[open]");
  await A.setInputFiles("#stk-file", { name: "pronta.png", mimeType: "image/png", buffer: png }); await A.waitForSelector("#stk-mine .stk-item", { timeout: 30000 });
  await A.click("#stk-mine .stk-item"); await A.waitForSelector("#stk", { state: "hidden" });
  await B.waitForSelector(".msg:not(.mine) .bubble.sticker", { timeout: 30000 }); // chegou (ainda com "…", a imagem demora 1,5 s)
  assert.equal(await B.locator(".msg:not(.mine) .bubble.sticker img").count(), 0, "o teste precisa pegar a figurinha ainda sem a imagem");
  const medidas = () => B.evaluate(() => { const b = document.querySelector(".msg:not(.mine) .bubble.sticker"), m = b.querySelector(".media"), alvo = [...b.querySelectorAll(".ph, img, .stk-save, .meta")].map((e) => `${e.className || e.tagName}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}:${getComputedStyle(e).display}:${getComputedStyle(e.parentElement).display}`); return { lista: document.getElementById("messages").scrollHeight, balao: Math.round(b.getBoundingClientRect().height), alvo, ar: m.style.getPropertyValue("--ar") }; });
  const antes = await medidas();
  await B.waitForSelector(".msg:not(.mine) .bubble.sticker img", { timeout: 30000 }); await B.waitForTimeout(300);
  const depois = await medidas();
  assert.equal(depois.lista, antes.lista, "a lista mudou de altura quando a figurinha carregou: " + JSON.stringify({ antes, depois }));
  assert.equal(await B.locator(".bubble.sticker .stk-save").isVisible(), true, "o botão de salvar aparece quando a figurinha carrega");
  await B.unroute(/\/storage\/v1\/object\//);
});

t("grupo: subir a tela logo ao abrir, enquanto o servidor ainda acrescenta uma mensagem nova, não é puxado de volta para o fim", async () => {
  // A fica sem tempo real e sem a verificação periódica: a mensagem que B manda agora só chega pelo servidor, durante a abertura
  await ctxA.addInitScript(() => { try { localStorage.setItem("lacre:poll", "0"); } catch {} });
  await ctxA.routeWebSocket(/\/realtime\//, (ws) => ws.close());
  await A.reload(); await pronto(A); await A.waitForTimeout(1500);
  await enviar(B, "nova do B " + "x".repeat(300)); await B.waitForSelector(".msg.mine .vis:has-text('nova do B')", { timeout: 30000 });
  await A.route(/\/rest\/v1\/messages\?/, async (route) => { if (route.request().method() !== "GET") return route.continue(); await dorme(1800); route.continue().catch(() => {}); }); // servidor lento: a mensagem nova entra ~2 s depois de abrir
  await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 6000 });
  const ini = await rolagem(A); assert.ok(ini.max > 300, "a lista precisa ser mais alta que a tela para o teste valer: " + JSON.stringify(ini));
  await A.evaluate(() => { document.getElementById("messages").scrollTop = 0; }); // a pessoa sobe a tela na hora
  const picos = []; for (let i = 0; i < 28; i++) { await dorme(100); picos.push((await rolagem(A)).top); } // ~2,8 s: cobre a chegada da mensagem nova
  await A.waitForSelector(".msg:not(.mine) .vis:has-text('nova do B')", { timeout: 10000 });
  assert.ok(Math.max(...picos) < 60, "a tela foi puxada de volta para baixo: " + JSON.stringify(picos));
});

t("grupo: mensagens ANTIGAS que o servidor acrescenta no meio da lista (o aparelho não as tinha) não puxam a tela para o fim enquanto a pessoa começa a subir", async () => {
  // (era o balanço do celular: depois de abrir, o app acrescentava dezenas de mensagens antigas, uma a cada ~12 ms, e cada uma mandava a tela para o fim)
  await ctxA.addInitScript(() => { try { localStorage.setItem("lacre:poll", "0"); } catch {} });
  await A.reload(); await pronto(A); await A.waitForTimeout(1500); // (sem tempo real: o que B manda agora só chega pelo servidor)
  await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 15000 });
  for (let i = 1; i <= 8; i++) { await enviar(B, `antiga ${i} ` + "x".repeat(250)); await B.waitForSelector(`.msg.mine .vis:has-text("antiga ${i} ")`, { timeout: 30000 }); }
  await enviar(A, "meu depois " + "y".repeat(40)); await A.waitForSelector(".msg.mine .vis:has-text('meu depois')", { timeout: 15000 }); // a mais nova do aparelho: as do B ficam ANTES dela na lista
  await A.route(/\/rest\/v1\/messages\?/, async (route) => { if (route.request().method() !== "GET") return route.continue(); await dorme(60); route.continue().catch(() => {}); }); // o servidor responde logo depois de a lista aparecer
  await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 8000 });
  const dist = () => A.evaluate(() => { const L = document.getElementById("messages"); return L.scrollHeight - L.scrollTop - L.clientHeight; });
  assert.ok((await A.evaluate(() => document.getElementById("messages").scrollHeight)) > 1500, "a lista precisa ser bem mais alta que a tela");
  const PASSO = 6, PASSOS = 60; // a pessoa começa a subir devagar logo ao abrir (~1 s): o servidor responde no meio disso, com ela ainda a menos de 140 px do fim
  for (let i = 0; i < PASSOS; i++) { await A.evaluate((p) => { document.getElementById("messages").scrollTop -= p; }, PASSO); await dorme(16); }
  await A.waitForSelector(".msg:not(.mine) .vis:has-text('antiga 8 ')", { timeout: 15000 }); await dorme(300);
  const d = await dist(); assert.ok(d >= PASSO * PASSOS * 0.9, `a tela foi puxada de volta para o fim: distância do fim ${d}px, esperado pelo menos ${PASSO * PASSOS * 0.9}px`);
});

t("o menu da conta mostra a versão do site que está rodando (para conferir se o navegador pegou a atualização)", async () => {
  await menuConta(A); assert.match(await A.locator("#versao-site").innerText(), /^Versão do site: [0-9a-f]{10}$/);
});

t("modo de diagnóstico (?diag): só aparece com o parâmetro e mostra quem mexe na rolagem da lista", async () => {
  assert.equal(await A.locator(".diag").count(), 0, "sem o parâmetro não aparece nada");
  await A.goto(srv.url + "?diag=1"); await pronto(A); await A.waitForSelector(".diag");
  await A.click("#contacts button[data-grupo]"); await A.waitForSelector("#messages:not(.carregando) .msg", { timeout: 10000 });
  await A.waitForFunction(() => /scrollTop=\d+ \(era/.test(document.querySelector(".diag pre").textContent) && /app\.js:\d+/.test(document.querySelector(".diag pre").textContent), null, { timeout: 10000 });
});
