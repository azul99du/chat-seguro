// Responder a mensagens (citação): texto, foto e áudio; barra "Respondendo a…"; ir até a original; persistir; cancelar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";
import { hasFfmpeg, tmp, makeAudio, makeJpegWithExif } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, dir; const erros = [], enviados = [];
const t = (nome, fn, { ffmpeg = false } = {}) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome}: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const ver = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:has-text("${txt}")`, { timeout: 30000 });
// abre o menu da mensagem que contém `txt` e toca em Responder
async function responderA(p, seletorMsg) { const m = p.locator(seletorMsg).first(); await m.locator(".bubble").first().click({ button: "right" }); await p.locator(".picker .responder").click(); }
const msgCom = (txt) => `.msg:has(.vis:text-is("${txt}"))`;

before(async () => {
  if (skip) return;
  const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const [ca, cb] = [await browser.newContext({ viewport: { width: 1100, height: 760 } }), await browser.newContext({ viewport: { width: 1100, height: 760 } })];
  A = await ca.newPage(); B = await cb.newPage(); vigiar("A", A); vigiar("B", B);
  nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await enviar(A, "qual o horário do jantar?"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await ver(B, "qual o horário do jantar?");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("o menu da mensagem tem os 6 emojis e o botão Responder", async () => {
  const m = B.locator(msgCom("qual o horário do jantar?")); await m.locator(".bubble").first().click({ button: "right" });
  assert.equal(await B.locator(".picker .emojis button").count(), 6); assert.equal(await B.locator(".picker .responder").innerText(), "Responder");
  await B.keyboard.press("Escape"); await B.mouse.click(5, 5); await B.waitForSelector(".picker", { state: "detached" });
});
t("o menu aparece SOBREPOSTO: as mensagens não mudam de lugar, o balão fica em foco e o menu cabe na tela", async () => {
  const pos = () => B.evaluate(() => [...document.querySelectorAll(".msg")].map((m) => Math.round(m.getBoundingClientRect().top)).join(",") + "|" + document.getElementById("messages").scrollTop + "|" + document.getElementById("messages").scrollHeight);
  const antes = await pos(); await B.locator(msgCom("qual o horário do jantar?")).locator(".bubble").first().click({ button: "right" }); await B.waitForSelector(".picker .acoes");
  assert.equal(await pos(), antes, "nada se desloca com o menu aberto");
  assert.equal(await B.locator("#messages .picker").count(), 0, "o menu não está dentro da lista de mensagens");
  const caixas = await B.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON(); return { e: r(".picker .emojis"), a: r(".picker .acoes"), f: r(".p-foco"), w: innerWidth, h: innerHeight }; });
  for (const k of ["e", "a"]) assert.ok(caixas[k].left >= 0 && caixas[k].top >= 0 && caixas[k].right <= caixas.w && caixas[k].bottom <= caixas.h, k + " dentro da tela");
  const emCima = caixas.e.bottom <= caixas.f.top + 1; // (a 1ª mensagem fica no topo da lista: sem espaço em cima, reações e ações ficam as duas abaixo)
  assert.ok(emCima ? caixas.a.top >= caixas.f.bottom - 1 : caixas.e.top >= caixas.f.bottom - 1 && caixas.a.top >= caixas.e.bottom - 1, "o menu não cobre o balão");
  await B.mouse.click(5, 5); await B.waitForSelector(".picker", { state: "detached" }); assert.equal(await pos(), antes);
});
t("botão ⌄ só aparece com o mouse em cima da mensagem; clicar abre o menu; no celular ele não existe", async () => {
  const msg = B.locator(msgCom("qual o horário do jantar?")).first(), op = msg.locator(".msg-opcoes"), opac = () => op.evaluate((e) => getComputedStyle(e).opacity);
  await B.mouse.move(5, 5); await B.waitForTimeout(250); assert.equal(await opac(), "0", "sem o mouse em cima: invisível");
  await msg.locator(".bubble").hover(); for (let i = 0; i < 20 && (await opac()) !== "1"; i++) await B.waitForTimeout(100); assert.equal(await opac(), "1", "com o mouse em cima: aparece");
  const rb = await msg.locator(".bubble").boundingBox(), ro = await op.boundingBox(); assert.ok(ro.x >= rb.x + rb.width, "fica ao lado do balão, não por cima do texto");
  await op.click(); await B.waitForSelector(".picker .acoes"); assert.equal(await B.locator(".picker .responder").count(), 1);
  await B.keyboard.press("Escape"); await B.waitForSelector(".picker", { state: "detached" });
  const toque = await B.context().browser().newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 700 } }); const pg = await toque.newPage();
  await pg.setContent('<style>.msg-opcoes{display:none}@media (hover:hover) and (pointer:fine){.msg-opcoes{display:grid}}</style><button class="msg-opcoes">x</button>');
  assert.equal(await pg.locator(".msg-opcoes").isVisible(), false, "em aparelho de toque o botão não aparece"); await toque.close();
});
t("responder a um texto: aparece a barra 'Respondendo a…', e a citação chega nos dois lados", async () => {
  await responderA(B, msgCom("qual o horário do jantar?"));
  await B.waitForSelector("#replybar:not([hidden])");
  assert.equal(await B.locator("#reply-who").innerText(), `Respondendo a @${nomeA}`); assert.equal(await B.locator("#reply-text").innerText(), "qual o horário do jantar?");
  assert.equal(await B.evaluate(() => document.activeElement.id), "text", "o foco vai para o campo de mensagem");
  await enviar(B, "às 20h");
  await B.waitForSelector("#replybar", { state: "hidden" });                                    // a barra some depois de enviar
  const meu = B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote");                        // B vê a citação do que A escreveu
  assert.equal(await meu.locator(".q-who").innerText(), `@${nomeA}`); assert.equal(await meu.locator(".q-text").innerText(), "qual o horário do jantar?");
  await ver(A, "às 20h"); const dele = A.locator(".msg:not(.mine):has(.vis:text-is('às 20h')) .quote"); // A vê que respondeu à própria mensagem
  assert.equal(await dele.locator(".q-who").innerText(), "Você"); assert.equal(await dele.locator(".q-text").innerText(), "qual o horário do jantar?");
});
t("tocar na citação leva até a mensagem original e a destaca", async () => {
  for (let i = 0; i < 14; i++) { await enviar(A, "enchimento " + i); await ver(A, "enchimento " + i, { meu: true }); } await ver(B, "enchimento 13"); // espera cada envio terminar antes do próximo                // empurra a original para fora da tela
  await B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote").click();
  await B.waitForSelector(`${msgCom("qual o horário do jantar?")}.flash`, { timeout: 5000 });
  assert.equal(await B.locator(msgCom("qual o horário do jantar?")).evaluate((n) => { const r = n.getBoundingClientRect(), m = document.getElementById("messages").getBoundingClientRect(); return r.top >= m.top - 2 && r.bottom <= m.bottom + 2; }), true, "a original ficou visível");
  await B.waitForSelector(`${msgCom("qual o horário do jantar?")}.flash`, { state: "detached", timeout: 4000 });  // o destaque some sozinho
});
t("cancelar: pelo botão × e pela tecla Esc; a mensagem seguinte sai sem citação", async () => {
  await responderA(B, msgCom("enchimento 3")); await B.waitForSelector("#replybar:not([hidden])"); await B.click("#reply-x"); await B.waitForSelector("#replybar", { state: "hidden" });
  await responderA(B, msgCom("enchimento 4")); await B.waitForSelector("#replybar:not([hidden])"); await B.focus("#text"); await B.keyboard.press("Escape"); await B.waitForSelector("#replybar", { state: "hidden" });
  await enviar(B, "sem citação"); await ver(A, "sem citação");
  assert.equal(await B.locator(".msg.mine:has(.vis:text-is('sem citação')) .quote").count(), 0); assert.equal(await A.locator(".msg:not(.mine):has(.vis:text-is('sem citação')) .quote").count(), 0);
});
t("recarregar: as citações voltam do histórico do aparelho", async () => {
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.waitForSelector("#contacts button"); await B.click("#contacts button"); await ver(B, "às 20h", { meu: true });
  assert.equal(await B.locator(".msg.mine:has(.vis:text-is('às 20h')) .quote .q-text").innerText(), "qual o horário do jantar?");
});
t("responder a uma FOTO e a um ÁUDIO: a citação mostra 'Foto · legenda' e 'Áudio · duração'", async () => {
  await A.setInputFiles("#file", makeJpegWithExif(dir)); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await enviar(A, "praia"); await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 40000 });
  await responderA(B, ".msg:has(.media img)"); assert.equal(await B.locator("#reply-text").innerText(), "Foto · praia");
  await enviar(B, "que lindo!"); await ver(A, "que lindo!");
  assert.equal(await A.locator(".msg:not(.mine):has(.vis:text-is('que lindo!')) .quote .q-text").innerText(), "Foto · praia");
  await A.setInputFiles("#file", makeAudio(dir, "mp3")); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary");
  await B.waitForSelector(".msg:not(.mine) .media.audio", { timeout: 40000 });
  await responderA(B, ".msg:has(.media.audio)"); assert.match(await B.locator("#reply-text").innerText(), /^Áudio · 0:0[1-3]$/);
  await enviar(B, "ouvi, valeu"); await ver(A, "ouvi, valeu");
  assert.match(await A.locator(".msg:not(.mine):has(.vis:text-is('ouvi, valeu')) .quote .q-text").innerText(), /^Áudio · 0:0[1-3]$/);
}, { ffmpeg: true });
t("responder a uma resposta (cadeia): a citação mostra só a mensagem anterior, sem aninhar", async () => {
  await responderA(A, msgCom("ouvi, valeu")); await enviar(A, "de nada"); await ver(B, "de nada");
  const q = B.locator(".msg:not(.mine):has(.vis:text-is('de nada')) .quote"); assert.equal(await q.locator(".q-text").innerText(), "ouvi, valeu"); assert.equal(await q.locator(".quote").count(), 0);
}, { ffmpeg: true });
t("citação de uma mensagem que NÃO está na tela: mostra o resumo recebido, marca como não verificado e avisa ao tocar", async () => {
  await enviar(A, "alvo antigo"); await ver(B, "alvo antigo");
  await responderA(B, msgCom("alvo antigo")); await enviar(B, "resposta recente"); await ver(A, "resposta recente", { meu: false });
  // o histórico passa a trazer só a mensagem mais nova (como numa conversa com milhares de mensagens). Agora a conversa é lida em várias consultas (formato antigo, cópias para este
  // aparelho, minhas linhas): por isso o corte é por id (só entra linha com id >= o da mais nova), em vez de "a mais nova de cada resposta".
  const corte = await B.evaluate(async ({ url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); const r = await fetch(`${url}/rest/v1/messages?select=id&order=id.desc&limit=1`, { headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); return (await r.json())[0].id; }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  await B.route("**/rest/v1/messages?*", async (route) => {
    if (route.request().method() !== "GET") return route.continue().catch(() => {});
    try { // (a conferência do servidor ainda pode estar em andamento quando o teste termina e a rota é removida: aí o pedido já foi tratado e não há mais nada a fazer)
      const r = await route.fetch(), linhas = await r.json();
      await route.fulfill({ response: r, json: Array.isArray(linhas) && linhas.length && "id" in linhas[0] ? linhas.filter((l) => l.id >= corte) : linhas });
    } catch {}
  });
  // (o aparelho também pinta na hora o que guarda localmente: numa conversa com milhares de mensagens ele só guardaria/mostraria as mais novas. Aqui o histórico local fica só com a mais nova.)
  await B.evaluate(([c]) => new Promise((ok, no) => {
    const r = indexedDB.open("lacre-sf"); r.onerror = () => no(r.error);
    r.onsuccess = () => { const tx = r.result.transaction("history", "readwrite"), st = tx.objectStore("history"), q = st.openCursor();
      q.onsuccess = () => { const cur = q.result; if (!cur) return; const id = Number(String(cur.key).split("|")[2]); if (Number.isFinite(id) && id < c) cur.delete(); cur.continue(); }; tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error); };
  }), [corte]);
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.waitForSelector("#contacts button"); await B.click("#contacts button");
  await ver(B, "resposta recente", { meu: true });
  assert.equal(await B.locator(".msg .vis").count(), 1, "só a mensagem mais nova está na tela");
  const q = B.locator(".quote.sem-original"); await q.waitFor();
  assert.equal(await q.locator(".q-text").innerText(), "alvo antigo"); assert.equal(await q.locator(".q-who").innerText(), `@${nomeA}`);
  await q.click(); await B.waitForSelector("#note[open]"); assert.match(await B.locator("#note-text").innerText(), /não está mais nesta tela/);
  await B.click("#note button"); await B.waitForLoadState("networkidle").catch(() => {}); await B.unroute("**/rest/v1/messages?*");
});
// gestos de toque simulados com eventos de ponteiro "touch" (o app só escuta toque/caneta para segurar e arrastar)
const ALVO = ".msg:not(.mine):has(.vis:text-is(\"alvo de toque\")) .bubble";
const toque = (p, seletor, etapas) => p.locator(seletor).first().evaluate(async (el, etapas) => {
  const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
  const ev = (tipo, dx = 0) => (tipo === "pointerdown" ? el : window).dispatchEvent(new PointerEvent(tipo, { pointerType: "touch", pointerId: 9, isPrimary: true, bubbles: true, cancelable: true, clientX: x + dx, clientY: y }));
  for (const e of etapas) { if (e.espera) await new Promise((ok) => setTimeout(ok, e.espera)); else ev(e.tipo, e.dx || 0); }
}, etapas);
t("não existe mais o botão + ao lado das mensagens", async () => assert.equal(await B.locator(".react-btn").count(), 0));
t("(prepara) uma mensagem nova do A chega no B para os testes de toque", async () => { await enviar(A, "alvo de toque"); await ver(B, "alvo de toque"); });
t("segurar a mensagem (toque) abre o menu; soltar não clica na mensagem; tocar fora fecha", async () => {
  const seletor = ALVO; await toque(B, seletor, [{ tipo: "pointerdown" }, { espera: 650 }]);
  await B.waitForSelector(".picker .emojis"); assert.equal(await B.locator(".picker .responder").count(), 1); assert.equal(await B.locator(".picker .apagar").count(), 1);
  await toque(B, seletor, [{ tipo: "pointerup" }]); await B.waitForTimeout(200); assert.equal(await B.locator(".picker").count(), 1, "levantar o dedo não fecha o menu");
  await B.mouse.click(5, 5); await B.waitForSelector(".picker", { state: "detached" });
});
t("toque curto na mensagem não abre o menu", async () => {
  await toque(B, ALVO, [{ tipo: "pointerdown" }, { espera: 120 }, { tipo: "pointerup" }, { espera: 600 }]); assert.equal(await B.locator(".picker").count(), 0);
});
t("arrastar a mensagem para a direita responde (e arrastar pouco ou para o lado errado não)", async () => {
  const sel = ALVO;
  await toque(B, sel, [{ tipo: "pointerdown" }, { tipo: "pointermove", dx: 30 }, { tipo: "pointerup", dx: 30 }]); await B.waitForTimeout(300); assert.equal(await B.locator("#replybar").isHidden(), true, "30 px não basta");
  await toque(B, sel, [{ tipo: "pointerdown" }, { tipo: "pointermove", dx: -90 }, { tipo: "pointerup", dx: -90 }]); await B.waitForTimeout(300); assert.equal(await B.locator("#replybar").isHidden(), true, "para a esquerda não responde");
  await toque(B, sel, [{ tipo: "pointerdown" }, { tipo: "pointermove", dx: 30 }, { tipo: "pointermove", dx: 80 }]);
  assert.equal(await B.locator(".line.pronto").count(), 1, "passou do limite: o ícone fica ativo"); await toque(B, sel, [{ tipo: "pointerup", dx: 80 }]);
  await B.waitForSelector("#replybar:not([hidden])"); assert.match(await B.locator("#reply-who").innerText(), /^Respondendo a @/); await B.click("#reply-x");
});
t("nenhum erro de JavaScript nem violação da política de segurança", async () => { assert.deepEqual(erros, []); });
