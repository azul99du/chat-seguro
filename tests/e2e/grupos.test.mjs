// Grupos, de ponta a ponta, com três pessoas em três navegadores: criar, conversar, responder, reagir, apagar, foto, sincronizar, renomear, remover, adicionar e sair.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";
import { hasFfmpeg, tmp, makeJpegWithExif } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, dir; const erros = [], enviados = [];
const t = (nome, fn, { ffmpeg = false } = {}) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page);
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome}: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const ver = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:text-is("${txt}")`, { timeout: 30000 });
const msg = (txt) => `.msg:has(.vis:text-is("${txt}"))`;
const msgT = (txt) => `.msg:has(.vis:has-text("${txt}"))`; // (para mensagens com @citação: o texto fica dividido em trechos, e o text-is do Playwright só casa texto de um trecho só)
const verT = (p, txt, { meu = false } = {}) => p.waitForSelector(`.msg${meu ? ".mine" : ":not(.mine)"} .vis:has-text("${txt}")`, { timeout: 30000 });
const GRUPO = "#contacts button[data-grupo]";
const abrirGrupo = async (p, nome = "Trio do teste") => { await p.click(`${GRUPO}:has-text("${nome}")`); await p.waitForSelector(`#conv-title:text-is("${nome}")`); await p.waitForSelector("#messages:not(.carregando)"); };
const abrirPessoa = async (p, nome) => { await p.click(`#contacts button:not([data-grupo]):has-text("@${nome}")`); await p.waitForSelector(`#conv-title:text-is("@${nome}")`); await p.waitForSelector("#messages:not(.carregando)"); };
const avisos = (p) => p.locator("#messages .aviso-linha").allInnerTexts();
const menu = async (p, txt) => { await p.locator(msg(txt)).first().locator(".bubble").first().click({ button: "right" }); await p.waitForSelector(".picker .acoes"); };
const dadosDoGrupo = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); };
const voltar = (p, dlg) => p.click(`#${dlg} .pg-volta`);

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp(); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); vigiar(n, p); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")];
  [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("só entra num grupo quem já conversou com quem cria: sem resposta da outra pessoa, o grupo é recusado", async () => {
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b"); await ver(A, "oi b", { meu: true });
  await A.click("#chamar-fab"); await A.waitForSelector("#chamar[open]"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]");
  assert.equal(await A.locator("#gn-criar").isDisabled(), true, "sem nome e sem ninguém, não cria");
  await A.fill("#gn-nome", "Cedo demais"); assert.equal(await A.locator("#gn-criar").isDisabled(), true, "com nome mas sem ninguém, não cria");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); assert.equal(await A.locator("#gn-criar").isDisabled(), false);
  await A.click("#gn-criar");
  await A.waitForFunction(() => /ainda não trocou mensagens com você/.test(document.getElementById("gn-msg").textContent), null, { timeout: 20000 });
  assert.match(await A.locator("#gn-msg").innerText(), new RegExp("@" + nomeB));
  await voltar(A, "grupo-novo"); assert.equal(await A.locator(GRUPO).count(), 0);
});
t("A conversa com B e com C (ida e volta) e cria o grupo: abre na hora, com o aviso de criação e quem participa", async () => {
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await abrirPessoa(B, nomeA); await ver(B, "oi b"); await enviar(B, "oi a, aqui é o b"); await ver(A, "oi a, aqui é o b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  await C.waitForSelector("#contacts button .unread", { timeout: 30000 }); await abrirPessoa(C, nomeA); await ver(C, "oi c"); await enviar(C, "oi a, aqui é o c"); await ver(A, "oi a, aqui é o c");
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]");
  await A.fill("#gn-nome", "  Trio   do teste "); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`);
  assert.match(await A.locator("#gn-quem").innerText(), /2 pessoas escolhidas/);
  await A.click("#gn-criar");
  await A.waitForSelector(`#conv-title:text-is("Trio do teste")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  assert.equal(await A.locator("#grupo-novo[open]").count(), 0);
  const sub = await A.locator("#conv-sub").innerText(); assert.match(sub, /^você, /); assert.ok(sub.includes("@" + nomeB) && sub.includes("@" + nomeC), sub);
  assert.deepEqual(await avisos(A), ["Você criou o grupo"]);
  assert.equal(await A.locator("#safety-btn").isVisible(), false); assert.equal(await A.locator("#grupo-btn").isVisible(), true);
  assert.match(await A.locator(`${GRUPO} .who small`).innerText(), /grupo · 3 pessoas/);
});
t("B e C recebem o grupo na hora, com o nome decifrado (o servidor só guarda o nome cifrado)", async () => {
  for (const p of [B, C]) { await p.waitForSelector(`${GRUPO}:has-text("Trio do teste")`, { timeout: 30000 }); }
  const cru = await A.evaluate(async ({ url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
    const r = await fetch(`${url}/rest/v1/rpc/meus_grupos`, { method: "POST", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key, "content-type": "application/json" }, body: "{}" }); return r.text(); }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.doesNotMatch(cru, /Trio/, "o nome não aparece em nada do que o servidor devolve"); assert.match(cru, /"nome":\s*\{"c":/);
});
t("mensagem no grupo chega para todos, com o nome de quem escreveu, e NÃO aparece na conversa a dois", async () => {
  await enviar(A, "primeira do grupo"); await ver(A, "primeira do grupo", { meu: true });
  for (const p of [B, C]) {
    await p.waitForSelector(`${GRUPO} .unread`, { timeout: 30000 }); await abrirGrupo(p); await ver(p, "primeira do grupo");
    assert.equal(await p.locator(`${msg("primeira do grupo")} .autor`).innerText(), "@" + nomeA);
    assert.deepEqual(await avisos(p), [`@${nomeA} adicionou você ao grupo`]);
    assert.equal(await p.locator(`${GRUPO} .unread`).count(), 0, "aberto = lido");
  }
  await enviar(B, "resposta do b"); await ver(A, "resposta do b"); await ver(C, "resposta do b");
  assert.equal(await C.locator(`${msg("resposta do b")} .autor`).innerText(), "@" + nomeB);
  await enviar(B, "segunda seguida do b"); await ver(C, "segunda seguida do b");
  assert.equal(await C.locator(`${msg("segunda seguida do b")} .autor`).count(), 0, "mensagens seguidas da mesma pessoa não repetem o nome");
  assert.equal(await A.locator(".msg.mine .rcpt.read").count(), 0, "em grupo não há 'vista'");
  await abrirPessoa(B, nomeA); assert.deepEqual((await B.locator(".msg .vis").allInnerTexts()).filter(Boolean), ["oi b", "oi a, aqui é o b"], "a conversa a dois não mistura as mensagens do grupo");
  await abrirGrupo(B);
});
t("responder no grupo: a citação mostra de quem é a mensagem original, para cada pessoa", async () => {
  await menu(C, "primeira do grupo"); await C.locator(".picker .responder").click();
  assert.equal(await C.locator("#reply-who").innerText(), "Respondendo a @" + nomeA);
  await enviar(C, "respondendo a primeira"); await ver(C, "respondendo a primeira", { meu: true });
  await ver(A, "respondendo a primeira"); await ver(B, "respondendo a primeira");
  assert.equal(await A.locator(`${msg("respondendo a primeira")} .quote .q-who`).innerText(), "Você");
  assert.equal(await B.locator(`${msg("respondendo a primeira")} .quote .q-who`).innerText(), "@" + nomeA);
  assert.equal(await B.locator(`${msg("respondendo a primeira")} .quote .q-text`).innerText(), "primeira do grupo");
  assert.equal(await B.locator(`${msg("respondendo a primeira")} .quote.sem-original`).count(), 0, "a original está na tela: o texto citado vem dela");
});
t("reações no grupo: um botão por emoji, com a contagem", async () => {
  await menu(B, "primeira do grupo"); await B.locator('.picker .emojis button:has-text("👍")').click();
  await A.waitForSelector(`${msg("primeira do grupo")} .rx .chip`, { timeout: 30000 });
  await menu(C, "primeira do grupo"); await C.locator('.picker .emojis button:has-text("👍")').click();
  await A.waitForFunction(() => [...document.querySelectorAll(".msg .rx .chip")].some((c) => c.textContent === "👍 2"), null, { timeout: 30000 });
  await B.waitForFunction(() => [...document.querySelectorAll(".msg .rx .chip.mine")].some((c) => c.textContent === "👍 2"), null, { timeout: 30000 });
  await C.locator(`${msg("primeira do grupo")} .rx .chip`).click(); // C tira a dele
  await A.waitForFunction(() => [...document.querySelectorAll(".msg .rx .chip")].some((c) => c.textContent === "👍"), null, { timeout: 30000 });
});
t("foto no grupo: enviada UMA vez ao servidor e aberta por todos", async () => {
  const antes = enviados.length, foto = makeJpegWithExif(dir);
  await A.setInputFiles("#file", foto); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary");
  await A.waitForSelector(".msg.mine .media img", { timeout: 30000 });
  for (const p of [B, C]) await p.waitForSelector(".msg:not(.mine) .media img", { timeout: 40000 });
  const novos = enviados.slice(antes); assert.equal(novos.length, 1, "um único arquivo cifrado, não um por pessoa");
  assert.match(novos[0].path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
}, { ffmpeg: true });
t("apagar para todos no grupo: vira 'Mensagem apagada' para cada pessoa, e a citação antiga também", async () => {
  await menu(A, "primeira do grupo"); await A.locator(".picker .apagar").click(); await A.waitForSelector("#choice[open]");
  assert.match(await A.locator("#choice-text").innerText(), /todo o grupo/);
  await A.click('#choice-actions button[value="todos"]');
  for (const p of [A, B, C]) {
    await p.waitForSelector(".bubble.apagada", { timeout: 30000 });
    assert.equal(await p.locator(msg("primeira do grupo")).count(), 0);
    await p.waitForFunction(() => document.querySelector(".quote .q-text")?.textContent === "Mensagem apagada", null, { timeout: 15000 });
  }
  await menu(B, "resposta do b"); await B.locator(".picker .apagar").click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="mim"]');
  await B.waitForSelector(msg("resposta do b"), { state: "detached" }); assert.equal(await A.locator(msg("resposta do b")).count(), 1, "só para mim: os outros continuam vendo");
});
t("recarregar: o grupo, as mensagens (minhas e dos outros), a apagada e os avisos continuam", async () => {
  for (const p of [A, B]) { await p.reload(); await pronto(p); await p.waitForSelector(`${GRUPO}:has-text("Trio do teste")`, { timeout: 30000 }); await abrirGrupo(p); }
  await ver(A, "resposta do b"); await ver(A, "respondendo a primeira"); assert.equal(await A.locator(".bubble.apagada").count(), 1);
  assert.deepEqual(await avisos(A), ["Você criou o grupo"]);
  await ver(B, "segunda seguida do b", { meu: true }); assert.equal(await B.locator(msg("resposta do b")).count(), 0, "o que B apagou só para ele continua apagado");
  assert.equal(await B.locator(".bubble.err").count(), 0, "nenhuma mensagem ilegível");
});
t("o que chega com o Lacre fechado é lido ao abrir: o grupo aparece com a bolinha de não lida, sem precisar abrir a conversa a dois", async () => {
  await C.goto("about:blank");
  await enviar(A, "enquanto c estava fora"); await ver(B, "enquanto c estava fora");
  await C.goto(srv.url); await pronto(C);
  await C.waitForSelector(`${GRUPO} .unread`, { timeout: 30000 });
  assert.equal(await C.locator(`#contacts button:not([data-grupo]) .unread`).count(), 0, "a conversa a dois com A não fica marcada");
  assert.equal(await C.locator("#contacts button").first().getAttribute("data-grupo") !== null, true, "o grupo sobe para o topo da lista");
  await abrirGrupo(C); await ver(C, "enquanto c estava fora"); assert.equal(await C.locator(".bubble.err").count(), 0);
});
t("dados do grupo: participantes, quem é admin, e só o admin muda o nome ou remove alguém", async () => {
  await dadosDoGrupo(B);
  assert.equal(await B.locator("#gi-nome").innerText(), "Trio do teste"); assert.match(await B.locator("#gi-cont").innerText(), /3 de 20/);
  assert.equal(await B.locator("#gi-lista .linha").count(), 3); assert.match(await B.locator("#gi-lista .linha").first().innerText(), /\(você\)/);
  assert.match(await B.locator(`#gi-lista .linha:has-text("@${nomeA}")`).innerText(), /admin/);
  for (const s of ["#gi-renomear", "#gi-add"]) assert.equal(await B.locator(s).isVisible(), false, s + " só para admin");
  assert.equal(await B.locator("#gi-lista .remover").count(), 0); await voltar(B, "grupo-info");
  await dadosDoGrupo(A); assert.equal(await A.locator("#gi-lista .remover").count(), 2);
  await A.click("#gi-renomear"); await A.waitForSelector("#ask[open]"); assert.equal(await A.inputValue("#ask-input"), "Trio do teste"); assert.equal(await A.getAttribute("#ask-input", "type"), "text");
  await A.fill("#ask-input", "Trio renomeado"); await A.click("#ask button[value=ok]");
  await A.waitForFunction(() => document.getElementById("gi-nome").textContent === "Trio renomeado", null, { timeout: 30000 }); await voltar(A, "grupo-info");
  for (const p of [A, B, C]) { await p.waitForSelector(`#conv-title:text-is("Trio renomeado")`, { timeout: 30000 }); await p.waitForSelector(`${GRUPO}:has-text("Trio renomeado")`); }
  for (const p of [B, C]) await p.waitForFunction(() => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === "O grupo agora se chama “Trio renomeado”"), null, { timeout: 30000 });
});
t("remover alguém: a pessoa perde o grupo na hora, os outros veem o aviso, e ela não recebe mais nada", async () => {
  await dadosDoGrupo(A); await A.click(`#gi-lista .linha:has-text("@${nomeC}") .remover`); await A.waitForSelector("#choice[open]"); await A.click('#choice-actions button[value="sim"]');
  await A.waitForFunction(() => document.querySelectorAll("#gi-lista .linha").length === 2, null, { timeout: 30000 }); await voltar(A, "grupo-info");
  await C.waitForSelector("#note[open]", { timeout: 30000 }); assert.match(await C.locator("#note-text").innerText(), /não participa mais do grupo “Trio renomeado”/); await C.click("#note button");
  assert.equal(await C.locator(GRUPO).count(), 0); assert.equal(await C.locator("#send-form").isVisible(), false);
  for (const p of [A, B]) await p.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} saiu do grupo`), nomeC, { timeout: 30000 });
  assert.match(await B.locator("#conv-sub").innerText(), new RegExp(`^você, @${nomeA}$`));
  await enviar(A, "sem o c agora"); await ver(B, "sem o c agora"); await C.waitForTimeout(2500);
  assert.equal(await C.locator(GRUPO).count(), 0); assert.equal(await C.locator("#contacts .unread").count(), 0, "C não recebe mais nada do grupo");
});
t("adicionar de volta: quem entra vê o grupo e só as mensagens novas; os outros veem o aviso de entrada", async () => {
  await dadosDoGrupo(A); await A.click("#gi-add"); await A.waitForSelector("#grupo-novo[open]");
  assert.equal(await A.locator("#gn-titulo").innerText(), "Adicionar pessoas"); assert.equal(await A.locator("#gn-nome-box").isVisible(), false);
  assert.deepEqual(await A.locator("#gn-lista label .tx b").allInnerTexts(), ["@" + nomeC], "só quem ainda não está no grupo");
  await A.check("#gn-lista .marca"); await A.click("#gn-criar"); await A.waitForSelector("#grupo-novo", { state: "hidden", timeout: 30000 });
  await A.waitForFunction(() => document.querySelectorAll("#gi-lista .linha").length === 3, null, { timeout: 30000 }); await voltar(A, "grupo-info");
  await B.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} entrou no grupo`), nomeC, { timeout: 30000 });
  await C.waitForSelector(`${GRUPO}:has-text("Trio renomeado")`, { timeout: 30000 });
  await enviar(A, "bem-vindo de volta"); await C.waitForSelector(`${GRUPO} .unread`, { timeout: 30000 }); await abrirGrupo(C, "Trio renomeado"); await ver(C, "bem-vindo de volta");
  assert.equal(await C.locator(msg("sem o c agora")).count(), 0, "o que foi dito enquanto C estava fora não chega para C");
});
t("sair do grupo: some para quem saiu; se o admin sai, outra pessoa assume; quem fica sozinho é avisado ao enviar", async () => {
  await dadosDoGrupo(A); await A.click("#gi-sair"); await A.waitForSelector("#choice[open]");
  assert.match(await A.locator("#choice-text").innerText(), /quem está há mais tempo no grupo assume/); await A.click('#choice-actions button[value="sim"]');
  await A.waitForSelector(GRUPO, { state: "detached", timeout: 30000 }); assert.equal(await A.locator("#send-form").isVisible(), false); assert.equal(await A.locator("#note[open]").count(), 0, "quem sai por vontade própria não recebe o aviso de remoção");
  await B.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} saiu do grupo`), nomeA, { timeout: 30000 });
  await dadosDoGrupo(B); await B.waitForFunction(() => document.querySelectorAll("#gi-lista .linha").length === 2, null, { timeout: 30000 });
  assert.match(await B.locator("#gi-lista .linha").first().innerText(), /\(você\)[\s\S]*admin/, "B (o mais antigo) virou admin"); await voltar(B, "grupo-info");
  await enviar(B, "ficamos nós dois"); await ver(C, "ficamos nós dois");
  await dadosDoGrupo(C); await C.click("#gi-sair"); await C.waitForSelector("#choice[open]"); await C.click('#choice-actions button[value="sim"]'); await C.waitForSelector(GRUPO, { state: "detached", timeout: 30000 });
  await B.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} saiu do grupo`), nomeC, { timeout: 30000 });
  await enviar(B, "alguém aí?"); await B.waitForSelector("#note[open]", { timeout: 20000 }); assert.match(await B.locator("#note-text").innerText(), /Não há mais ninguém neste grupo/); await B.click("#note button");
});
// ---------- segundo grupo: citação (@), foto do grupo, sub-admin ----------
const G2 = "Segundo grupo", idDoGrupo = (p) => p.locator(`${GRUPO}:has-text("${G2}")`).getAttribute("data-grupo");
const textoCampo = (p) => p.evaluate(() => document.getElementById("text").textContent.replace(/\u00a0/g, " "));
const linhasDe = (p, g) => p.evaluate(async ({ url, key, g }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), tk = JSON.parse(localStorage[k]);
  const r = await fetch(`${url}/rest/v1/messages?select=recipient_id,citado,avisar&grupo_id=eq.${g}&sender_id=eq.${tk.user.id}`, { headers: { Authorization: "Bearer " + tk.access_token, apikey: key } }); return r.json(); }, { url: SUPABASE_URL, key: SUPABASE_KEY, g });
t("segundo grupo: A cria com B e C (agora os três abrem)", async () => {
  await abrirPessoa(A, nomeB).catch(async () => { await chamar(A, nomeB); }); // (A sai do grupo anterior sem conversa aberta)
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]");
  await A.fill("#gn-nome", G2); await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar");
  await A.waitForSelector(`#conv-title:text-is("${G2}")`, { timeout: 30000 }); await A.waitForSelector("#messages:not(.carregando)");
  for (const p of [B, C]) { await p.waitForSelector(`${GRUPO}:has-text("${G2}")`, { timeout: 30000 }); await abrirGrupo(p, G2); }
});
t("citar: ao digitar @ aparece a lista (sem mim), filtra ao digitar, Enter escolhe, e a conversa a dois não mostra lista", async () => {
  await B.fill("#text", ""); await B.click("#text"); await B.keyboard.type("oi @"); await B.waitForSelector("#mencoes:not([hidden]) .opcao");
  assert.deepEqual((await B.locator("#mencoes .opcao b").allInnerTexts()).sort(), [`@${nomeA}`, `@${nomeC}`].sort(), "participantes, menos eu");
  await B.keyboard.type(nomeC.slice(0, 3)); await B.waitForFunction((n) => document.querySelectorAll("#mencoes .opcao").length === 1 && document.querySelector("#mencoes .opcao b").textContent === "@" + n, nomeC);
  await B.keyboard.press("Escape"); await B.waitForSelector("#mencoes", { state: "hidden" }); assert.equal(await textoCampo(B), "oi @" + nomeC.slice(0, 3), "Esc fecha a lista e não envia nem apaga");
  await B.keyboard.type("x"); await B.waitForSelector("#mencoes", { state: "hidden", timeout: 3000 }).catch(() => {}); // (sem ninguém que combine, a lista some)
  for (let i = 0; i < 4; i++) await B.keyboard.press("Backspace");
  await B.keyboard.type(nomeC.slice(0, 3)); await B.waitForSelector("#mencoes:not([hidden]) .opcao"); await B.keyboard.press("Enter");
  assert.equal(await textoCampo(B), `oi @${nomeC} `, "Enter escolhe o nome (não envia)"); assert.equal(await B.locator("#mencoes").isHidden(), true);
  await B.keyboard.type("vem cá"); await B.keyboard.press("Enter"); await verT(B, `oi @${nomeC} vem cá`, { meu: true });
  await verT(A, `oi @${nomeC} vem cá`); await verT(C, `oi @${nomeC} vem cá`);
  await abrirPessoa(B, nomeA); await B.click("#text"); await B.keyboard.type("@"); await B.waitForTimeout(400); assert.equal(await B.locator("#mencoes").isHidden(), true, "a conversa a dois não tem lista de citação"); await B.fill("#text", "");
  await abrirGrupo(B, G2);
});
t("citado: o nome aparece em destaque para todos (mais forte para quem foi citado) e só a linha de quem foi citado leva a marca do aviso", async () => {
  assert.equal(await C.locator(`${msgT(`oi @${nomeC} vem cá`)} .mencao.eu`).count(), 1); assert.equal(await C.locator(`${msgT(`oi @${nomeC} vem cá`)} .bubble.cita-eu`).count(), 1);
  assert.equal(await A.locator(`${msgT(`oi @${nomeC} vem cá`)} .mencao`).count(), 1); assert.equal(await A.locator(`${msgT(`oi @${nomeC} vem cá`)} .mencao.eu`).count(), 0, "para A é só um nome em destaque");
  assert.equal(await A.locator(`${msgT(`oi @${nomeC} vem cá`)} .bubble.cita-eu`).count(), 0);
  const g = await idDaConversa(B), l = await linhasDe(B, g); const citados = l.filter((x) => x.citado); assert.equal(citados.length, 1, "uma única linha marcada"); assert.equal(l.length, 2, "uma linha por participante");
  await enviar(B, "sem citar ninguém"); await ver(A, "sem citar ninguém"); assert.equal((await linhasDe(B, g)).filter((x) => x.citado).length, 1, "mensagem comum não ganha marca nova");
  await enviar(B, "falei de @naoexiste e de beto@email.com"); await verT(C, "falei de @naoexiste e de beto@email.com"); assert.equal((await linhasDe(B, g)).filter((x) => x.citado).length, 1, "nome que não é do grupo e e-mail não contam"); assert.equal(await C.locator(`${msgT("falei de @naoexiste e de beto@email.com")} .mencao`).count(), 0);
});
const idDaConversa = (p) => p.locator(`${GRUPO}[aria-current="true"]`).getAttribute("data-grupo");
t("foto do grupo: só o admin vê o botão; troca, aparece para todos, vira aviso e some ao remover", async () => {
  await dadosDoGrupo(B); assert.equal(await B.locator("#gi-foto-btn").isVisible(), false); assert.equal(await B.locator("#gi-foto-rm").isVisible(), false); await voltar(B, "grupo-info");
  await dadosDoGrupo(A); assert.equal(await A.locator("#gi-foto-btn").isVisible(), true);
  const antes = enviados.length; await A.setInputFiles("#gi-file", makeJpegWithExif(dir, "grupo.jpg"));
  await A.waitForFunction(() => /atualizada/.test(document.getElementById("gi-msg").textContent), null, { timeout: 40000 });
  await A.waitForSelector("#gi-av img", { timeout: 20000 }); assert.equal(enviados.length - antes, 1, "um arquivo cifrado enviado");
  for (const p of [B, C]) { await p.waitForSelector(`${GRUPO}:has-text("${G2}") .avatar img`, { timeout: 40000 }); await p.waitForFunction(() => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === "A foto do grupo foi alterada"), null, { timeout: 30000 }); }
  await B.waitForSelector("#conv-av img", { timeout: 20000 });
  const cru = await A.evaluate(async ({ url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); const r = await fetch(`${url}/rest/v1/rpc/meus_grupos`, { method: "POST", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key, "content-type": "application/json" }, body: "{}" }); return r.text(); }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.match(cru, /"foto":\s*\{[^}]*"p":\s*"[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}"/, "o servidor guarda só o caminho do arquivo cifrado e o IV");
  await A.click("#gi-foto-rm"); await A.waitForFunction(() => /removida/.test(document.getElementById("gi-msg").textContent), null, { timeout: 20000 });
  for (const p of [B, C]) await p.waitForSelector(`${GRUPO}:has-text("${G2}") .avatar img`, { state: "detached", timeout: 40000 });
  await voltar(A, "grupo-info");
}, { ffmpeg: true });
t("sub-admin: o admin dá o cargo; o sub-admin só vê o botão de remover nos membros comuns e não vê rename, adicionar, foto nem cargo", async () => {
  await dadosDoGrupo(A); await A.click(`#gi-lista .linha:has-text("@${nomeB}") .cargo`);
  await A.waitForFunction((n) => [...document.querySelectorAll("#gi-lista .linha")].some((r) => r.innerText.includes("@" + n) && r.innerText.includes("sub-admin")), nomeB, { timeout: 30000 });
  assert.match(await A.locator("#gi-msg").innerText(), /pode remover membros/); await voltar(A, "grupo-info");
  for (const p of [B, C]) await p.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} agora é sub-admin`), nomeB, { timeout: 30000 });
  await dadosDoGrupo(B);
  for (const s2 of ["#gi-renomear", "#gi-add", "#gi-foto-btn", "#gi-foto-rm"]) assert.equal(await B.locator(s2).isVisible(), false, s2);
  assert.equal(await B.locator("#gi-lista .cargo").count(), 0, "sub-admin não dá cargo");
  assert.equal(await B.locator(`#gi-lista .linha:has-text("@${nomeA}") .remover`).count(), 0, "não expulsa o admin"); assert.equal(await B.locator(`#gi-lista .linha:has-text("@${nomeC}") .remover`).count(), 1, "expulsa membro comum");
  assert.match(await B.locator(`#gi-lista .linha:has-text("@${nomeB}")`).innerText(), /sub-admin/);
  await B.click(`#gi-lista .linha:has-text("@${nomeC}") .remover`); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="sim"]');
  await B.waitForFunction(() => document.querySelectorAll("#gi-lista .linha").length === 2, null, { timeout: 30000 });
  await C.waitForSelector("#note[open]", { timeout: 30000 }); await C.click("#note button"); assert.equal(await C.locator(`${GRUPO}:has-text("${G2}")`).count(), 0, "C foi removido pelo sub-admin");
  await voltar(B, "grupo-info");
});
t("sub-admin: o admin tira o cargo e o botão de remover some para ele", async () => {
  await dadosDoGrupo(A); await A.click(`#gi-lista .linha:has-text("@${nomeB}") .cargo`);
  await A.waitForFunction(() => /deixou de ser sub-admin/.test(document.getElementById("gi-msg").textContent), null, { timeout: 30000 }); await voltar(A, "grupo-info");
  await B.waitForFunction((n) => [...document.querySelectorAll(".aviso-linha")].some((a) => a.textContent === `@${n} deixou de ser sub-admin`), nomeB, { timeout: 30000 });
  await dadosDoGrupo(B); assert.equal(await B.locator("#gi-lista .remover").count(), 0); await voltar(B, "grupo-info");
});
t("nenhum erro de página durante todo o roteiro", async () => { assert.deepEqual(erros, []); });
