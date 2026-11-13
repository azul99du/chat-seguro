// Vários aparelhos na mesma conta, etapa 3: GRUPOS. Cada mensagem do grupo vai cifrada para CADA aparelho aprovado de cada participante e para os outros aparelhos de quem envia.
// A tem 2 aparelhos (A1, A2), B tem 1 e depois 2 (B1, B2) e C tem 1. Cobre: todos leem; o que um aparelho envia aparece no outro como "minha"; reagir e apagar para todos;
// recarregar; aparelho novo não vê o que veio antes (e não mostra erro); e o servidor conta UMA mensagem por envio (estatísticas e Selos).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar, compartilhaCodigo, permitirNovo, conferirAba } from "./env.mjs";
import { genDH, accept, decrypt as ratchetDecrypt } from "../../ratchet.js";

let skip = configurado ? false : motivoSemConfig, browser, srv, A1, A2, B1, B2, C1, emailA, emailB, emailC, nomeA, nomeB, nomeC; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 240000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = "#chat:not([hidden]):not(.preparando)";
const vigiar = (n, p) => { p.on("pageerror", (e) => erros.push(`${n} pageerror: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${n} console: ${m.text().slice(0, 200)}`); }); return p; };
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const vis = (p, txt, de = "", timeout = 40000) => p.waitForSelector(`.msg${de} .vis:has-text("${txt}")`, { timeout });
const recebida = (p, txt, timeout) => vis(p, txt, ":not(.mine)", timeout), minha = (p, txt, timeout) => vis(p, txt, ".mine", timeout);
const textos = (p) => p.locator(".msg .vis").allInnerTexts().then((l) => l.filter((x) => x.trim()));
const msg = (txt) => `.msg:has(.vis:has-text("${txt}"))`;
const abrirConversa = async (p, nome) => { // (a conversa conta como aberta só com a tela da conversa ligada: "voltar" a fecha mesmo no computador)
  const aberta = await p.evaluate((n) => document.getElementById("chat").classList.contains("in-conv") && document.getElementById("conv-title").textContent.includes(n), nome);
  if (aberta) return; await p.click(`#contacts button:has-text("${nome}")`); await p.waitForSelector(`#conv-title:has-text("@${nome}")`); await p.waitForSelector("#messages:not(.carregando)");
};
const comoLista = (p) => p.evaluate(() => document.getElementById("back").click());

async function cadastrar(usuario, email) {
  const p = vigiar(usuario, await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage());
  await p.goto(srv.url); await p.click("#tab-signup"); await p.fill("#username", usuario); await p.fill("#email", email); await p.fill("#password", SENHA); await p.click("#auth-submit");
  await p.waitForSelector("#ask[open]", { timeout: 30000 }); await p.fill("#ask-input", FRASE); await p.click("#ask button[value=ok]"); await p.waitForSelector(pronto, { timeout: 30000 }); await p.waitForTimeout(1500); return p;
}
async function novoAparelho(nome, email, base) { // outro navegador entrando na mesma conta: fica pendente (tela de espera)
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }); await compartilhaCodigo(ctx, base); const pg = vigiar(nome, await ctx.newPage());
  await pg.goto(srv.url); await pg.fill("#email", email); await pg.fill("#password", SENHA); await pg.click("#auth-submit");
  await pg.waitForSelector("#ask[open]", { timeout: 30000 }); await pg.fill("#ask-input", FRASE); await pg.click("#ask button[value=ok]"); await pg.waitForSelector("#espera:not([hidden])", { timeout: 30000 }); return pg;
}
const refrescar = async (...ps) => { for (const p of ps) await conferirAba(p); await ps[0].waitForTimeout(1200); }; // cada aparelho esquece a lista de aparelhos guardada (até 60 s) e refaz a dos contatos no próximo envio
const GRUPO = "Varios";
const abrirGrupo = async (p) => {
  const aberta = await p.evaluate((n) => document.getElementById("chat").classList.contains("in-conv") && document.getElementById("conv-title").textContent === n, GRUPO);
  if (aberta) return; await p.waitForSelector("#contacts button[data-grupo]", { timeout: 40000 }); await p.click("#contacts button[data-grupo]"); await p.waitForSelector(`#conv-title:text-is("${GRUPO}")`); await p.waitForSelector("#messages:not(.carregando)");
};
const semErro = async (...ps) => { for (const p of ps) assert.equal(await p.locator(".bubble.err").count(), 0, "nenhum balão de erro (nem 'enviada de outro aparelho', nem 'não foi possível decifrar')"); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  emailA = novoEmail(); emailB = novoEmail(); emailC = novoEmail(); nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); nomeC = novoUsuario("c");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("partida: A conversa com B e com C (ida e volta), cria o grupo, e todos leem (1 aparelho cada)", async () => {
  A1 = await cadastrar(nomeA, emailA); B1 = await cadastrar(nomeB, emailB); C1 = await cadastrar(nomeC, emailC);
  for (const [P, nome] of [[B1, nomeB], [C1, nomeC]]) {
    await chamar(A1, nome); await A1.waitForSelector(`#conv-title:has-text("@${nome}")`); await enviar(A1, "oi " + nome);
    await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await recebida(P, "oi " + nome); await enviar(P, "oi de volta " + nome); await recebida(A1, "oi de volta " + nome);
  }
  await A1.click("#chamar-fab"); await A1.click("#novo-grupo"); await A1.waitForSelector("#grupo-novo[open]"); await A1.fill("#gn-nome", GRUPO);
  for (const n of [nomeB, nomeC]) await A1.check(`#gn-lista label:has-text("@${n}") .marca`);
  await A1.click("#gn-criar"); await A1.waitForSelector(`#conv-title:text-is("${GRUPO}")`, { timeout: 30000 }); await A1.waitForSelector("#messages:not(.carregando)");
  for (const p of [B1, C1]) await abrirGrupo(p);
  await enviar(A1, "grupo: primeira"); for (const p of [B1, C1]) await recebida(p, "grupo: primeira"); await minha(A1, "grupo: primeira");
  await enviar(C1, "grupo: do carlos"); for (const p of [A1, B1]) await recebida(p, "grupo: do carlos");
});
t("A ganha um segundo aparelho (A2): depois de permitido vê o grupo, mas não o que veio antes (e sem balão de erro)", async () => {
  A2 = await novoAparelho("A2", emailA, A1); await permitirNovo(A1); await A2.waitForSelector(pronto, { timeout: 60000 }); await A2.waitForTimeout(1500);
  await refrescar(A1, A2, B1, C1); await abrirGrupo(A2);
  assert.equal(await A2.locator("#messages .msg").count(), 0, "as mensagens antigas do grupo não migram"); await semErro(A2);
});
t("mensagem de outra pessoa no grupo chega nos DOIS aparelhos de A, no tempo real", async () => {
  await abrirGrupo(A1); await enviar(B1, "grupo: para os dois aparelhos");
  for (const p of [A1, A2, C1]) await recebida(p, "grupo: para os dois aparelhos");
  await semErro(A1, A2);
});
t("o que um aparelho de A envia ao grupo aparece no outro aparelho de A como 'minha' (nos dois sentidos) e chega a B e C", async () => {
  await enviar(A1, "grupo: escrito no A1"); await minha(A1, "grupo: escrito no A1"); await minha(A2, "grupo: escrito no A1"); for (const p of [B1, C1]) await recebida(p, "grupo: escrito no A1");
  await enviar(A2, "grupo: escrito no A2"); await minha(A2, "grupo: escrito no A2"); await minha(A1, "grupo: escrito no A2"); for (const p of [B1, C1]) await recebida(p, "grupo: escrito no A2");
  for (const p of [A1, A2]) assert.equal(await p.locator(msg("grupo: escrito no A")).count(), 2, "cada mensagem uma vez só (a cópia e a leva não se duplicam)");
  await semErro(A1, A2, B1, C1);
});
t("reagir e apagar para todos atravessam aparelhos no grupo", async () => {
  await A2.locator(msg("grupo: para os dois aparelhos")).locator(".bubble").first().click({ button: "right" }); await A2.locator('.picker .emojis button[aria-label="Reagir com ❤️"]').click();
  await B1.waitForSelector(`${msg("grupo: para os dois aparelhos")} .chip:has-text("❤️")`, { timeout: 40000 }); await A1.waitForSelector(`${msg("grupo: para os dois aparelhos")} .chip:has-text("❤️")`, { timeout: 40000 });
  await A1.locator(msg("grupo: escrito no A2")).locator(".bubble").first().click({ button: "right" }); await A1.locator(".picker .apagar").click(); await A1.waitForSelector("#choice[open]"); await A1.click("#choice button[value=todos]");
  for (const p of [A1, A2, B1, C1]) await p.waitForFunction(() => document.body.innerText.includes("Mensagem apagada") && !document.body.innerText.includes("grupo: escrito no A2"), null, { timeout: 40000 });
});
t("recarregar mantém o grupo igual nos dois aparelhos de A: sem balões de erro, sem repetir, a apagada continua apagada", async () => {
  for (const p of [A1, A2]) { await p.reload(); await p.waitForSelector(pronto, { timeout: 30000 }); await abrirGrupo(p); await p.waitForTimeout(1500); }
  await semErro(A1, A2);
  for (const p of [A1, A2]) {
    const l = await textos(p); for (const txt of ["grupo: para os dois aparelhos", "grupo: escrito no A1"]) assert.equal(l.filter((x) => x === txt).length, 1, `${txt}: ${JSON.stringify(l)}`);
    assert.ok(!l.includes("grupo: escrito no A2")); assert.equal(await p.locator(".bubble.apagada").count(), 1);
    assert.equal(await p.locator(`.msg.mine ${".vis"}:has-text("grupo: escrito no A1")`).count(), 1, "continua sendo minha");
  }
  assert.ok((await textos(A1)).includes("grupo: primeira"), "o aparelho antigo guarda o que já tinha"); assert.ok(!(await textos(A2)).includes("grupo: primeira"));
});
t("B ganha um segundo aparelho (B2): passa a receber as mensagens novas do grupo nos dois; C (1 aparelho) continua recebendo", async () => {
  B2 = await novoAparelho("B2", emailB, B1); await permitirNovo(B1); await B2.waitForSelector(pronto, { timeout: 60000 }); await B2.waitForTimeout(1500);
  await refrescar(A1, A2, B1, B2, C1); await abrirGrupo(B2);
  await enviar(A1, "grupo: para todos os aparelhos"); for (const p of [B1, B2, C1]) await recebida(p, "grupo: para todos os aparelhos"); await minha(A2, "grupo: para todos os aparelhos");
  await enviar(B2, "grupo: do segundo aparelho do B"); await minha(B1, "grupo: do segundo aparelho do B"); for (const p of [A1, A2, C1]) await recebida(p, "grupo: do segundo aparelho do B");
  await enviar(C1, "grupo: carlos de novo"); for (const p of [A1, A2, B1, B2]) await recebida(p, "grupo: carlos de novo");
  await semErro(A1, A2, B1, B2, C1);
});
t("o servidor conta UMA mensagem por envio (estatísticas), embora cada envio tenha uma linha por aparelho", async () => {
  const r = await A1.evaluate(async () => {
    const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const gid = (await sb.rpc("meus_grupos")).data[0].grupo_id, eu = (await sb.auth.getUser()).data.user.id, hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const est = (await sb.rpc("grupo_estatisticas", { p_grupo: gid })).data.find((x) => x.user_id === eu && x.dia === hoje);
    const linhas = (await sb.from("messages").select("id,created_at,recipient_id,para_aparelho,avisar").eq("grupo_id", gid).eq("sender_id", eu).order("id", { ascending: false }).limit(200)).data;
    const ult = linhas.filter((l) => l.created_at === linhas[0].created_at);
    return { msgs: est?.msgs, envios: new Set(linhas.filter((l) => l.avisar).map((l) => l.created_at)).size, ultN: ult.length, ultProprias: ult.filter((l) => l.recipient_id === eu).length, porAparelho: ult.every((l) => l.para_aparelho) };
  });
  assert.equal(r.msgs, r.envios, "estatística = número de envios visíveis"); assert.ok(r.msgs >= 4 && r.msgs <= 8, "A enviou poucas mensagens (não uma por linha): " + r.msgs);
  assert.equal(r.porAparelho, true); assert.equal(r.ultN, 4, "último envio do A1: 2 aparelhos de B + 1 de C + 1 cópia para o A2"); assert.equal(r.ultProprias, 1);
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
