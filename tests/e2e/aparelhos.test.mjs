// Aparelhos conectados + aviso de aparelho novo: registro (navegador, sistema, local, datas), reconhecimento automático do mesmo navegador,
// folha de aviso ("Sou eu" / "Não fui eu: trocar a senha"), ponto rosa enquanto houver algo para conferir, e as regras do servidor.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, compartilhaCodigo } from "./env.mjs";

const UA_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0";
let skip = configurado ? false : motivoSemConfig, browser, srv, P, email; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = "#chat:not([hidden]):not(.preparando)";
const abrir = async (p) => { await menuConta(p, "#sec-btn"); await p.waitForSelector("#mfa[open]"); await p.click("#mfa-aparelhos"); await p.waitForSelector("#aparelhos[open]"); await p.waitForFunction(() => document.querySelectorAll("#aparelhos-lista .linha").length > 0, null, { timeout: 20000 }); };
const fechar = async (p) => { await p.click("#aparelhos button[value=cancel]"); await p.click("#mfa button[value=cancel]"); };
async function entrar(opts = {}) { // outro aparelho entrando na mesma conta
  const pg = await (await browser.newContext({ viewport: { width: 1100, height: 780 }, ...opts })).newPage(); pg.on("pageerror", (e) => erros.push(e.message));
  await pg.goto(srv.url); await pg.fill("#email", email); await pg.fill("#password", SENHA); await pg.click("#auth-submit");
  await pg.waitForSelector("#ask[open]", { timeout: 30000 }); await pg.fill("#ask-input", FRASE); await pg.click("#ask button[value=ok]"); await pg.waitForSelector(pronto, { timeout: 30000 }); await pg.waitForTimeout(1500); return pg;
}
const sair = async (pg) => { await menuConta(pg, "#logout"); await pg.waitForSelector("#choice[open]"); await pg.click("#choice button[value=keep]"); await pg.waitForSelector("#auth:not([hidden])", { timeout: 15000 }); };
const conferir = (p) => p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // o app confere ao voltar para a aba
const esperarAviso = async (p) => { // o aparelho novo leva alguns segundos para se registrar (consulta do local): confere de novo até a folha aparecer
  for (let i = 0; i < 20; i++) { await conferir(p); if (await p.locator("#novo-aparelho").evaluate((d) => d.open)) return; await p.waitForTimeout(1500); }
  throw new Error("a folha de aviso não apareceu");
};
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); P.on("pageerror", (e) => erros.push(e.message)); email = novoEmail();
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("d")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE); await P.click("#ask button[value=ok]"); await P.waitForSelector(pronto, { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a lista mostra ESTE aparelho com navegador, sistema, local e datas; o primeiro aparelho da conta não gera aviso", async () => {
  await abrir(P); const itens = P.locator("#aparelhos-lista .linha"); assert.equal(await itens.count(), 1);
  const txt = await itens.first().innerText(); assert.match(txt, /Chrome no /, txt); assert.match(txt, /Este aparelho/); assert.doesNotMatch(txt, /Novo/);
  assert.match(txt, /(aproximado|Local indisponível)/); assert.match(txt, /Entrou em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/); assert.match(txt, /Último acesso em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  assert.match(await P.locator("#aparelhos .pg-nota").innerText(), /não guarda o IP/); assert.equal(await P.locator("#ap-ponto").isVisible(), false); await fechar(P);
});
t("o MESMO código de aparelho é reconhecido sozinho, mesmo com outro navegador; um código NOVO gera aviso mesmo com o mesmo navegador", async () => {
  const c2 = await browser.newContext({ viewport: { width: 1100, height: 780 }, userAgent: UA_WINDOWS }); await compartilhaCodigo(c2, P); const P2 = await c2.newPage(); P2.on("pageerror", (e) => erros.push(e.message));
  await P2.goto(srv.url); await P2.fill("#email", email); await P2.fill("#password", SENHA); await P2.click("#auth-submit");
  await P2.waitForSelector("#ask[open]", { timeout: 30000 }); await P2.fill("#ask-input", FRASE); await P2.click("#ask button[value=ok]"); await P2.waitForSelector(pronto, { timeout: 30000 }); await P2.waitForTimeout(2500);
  await conferir(P); await P.waitForTimeout(1500);
  assert.equal(await P.locator("#novo-aparelho").evaluate((d) => d.open), false, "mesmo código (mesmo aparelho), navegador diferente: sem folha"); assert.equal(await P.locator("#ap-ponto").isVisible(), false, "sem ponto");
  await abrir(P); assert.equal(await P.locator("#aparelhos-lista .linha").count(), 2); assert.equal(await P.locator("#aparelhos-lista .selo-novo").count(), 0);
  assert.equal(await P.locator("#aparelhos-lista .linha:not(.atual) .selo-estado").first().innerText(), "Sessão ativa"); await fechar(P);
  await sair(P2); await conferir(P); await abrir(P); assert.equal(await P.locator("#aparelhos-lista .linha:not(.atual) .selo-estado").first().innerText(), "Saiu"); await fechar(P);
  // mesmo navegador (mesmo texto de navegador e sistema), mas SEM o código: agora é aparelho novo
  const Q = await entrar(); await esperarAviso(P); assert.equal(await P.locator("#na-aparelho").innerText().then((x) => /Chrome/.test(x)), true); await P.click("#novo-sim"); await P.waitForFunction(() => !document.getElementById("novo-aparelho").open); await sair(Q);
});
t("aparelho DIFERENTE entra: o outro aparelho recebe a folha com aparelho, local e data; 'Sou eu' reconhece e tira o aviso", async () => {
  const W = await entrar({ userAgent: UA_WINDOWS }); await esperarAviso(P);
  assert.equal(await P.locator("#na-aparelho").innerText(), "Chrome no Windows"); assert.match(await P.locator("#na-local").innerText(), /\S/); assert.match(await P.locator("#na-quando").innerText(), /\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  assert.match(await P.locator("#novo-aparelho").innerText(), /Não fui eu: trocar a senha[\s\S]*Sou eu, conheço este aparelho/);
  assert.equal(await W.locator("#novo-aparelho").evaluate((d) => d.open), false, "quem acabou de entrar não é avisado de si mesmo");
  await P.click("#novo-sim"); await P.waitForFunction(() => !document.getElementById("novo-aparelho").open); await P.waitForTimeout(800);
  await P.waitForFunction(() => document.getElementById("ap-ponto").hidden, null, { timeout: 12000 }); await conferir(P); await P.waitForTimeout(800); assert.equal(await P.locator("#novo-aparelho").evaluate((d) => d.open), false, "não pergunta de novo");
  await sair(W);
});
t("fechar a folha sem decidir: o ponto rosa continua; na lista aparece 'Novo' com 'Reconheço / Não reconheço'", async () => {
  const M = await entrar({ userAgent: UA_MAC_FIREFOX }); await esperarAviso(P);
  assert.equal(await P.locator("#na-aparelho").innerText(), "Firefox no macOS"); await P.keyboard.press("Escape"); await P.waitForFunction(() => !document.getElementById("novo-aparelho").open);
  await P.waitForTimeout(600); assert.equal(await P.locator("#ap-ponto").isVisible(), true, "o ponto rosa lembra");
  await menuConta(P); assert.match(await P.locator("#sec-btn").innerText(), /aparelho novo para conferir/); await P.keyboard.press("Escape");
  await abrir(P); const novo = P.locator('#aparelhos-lista .linha:has-text("Firefox no macOS")'); assert.match(await novo.innerText(), /Novo/); assert.equal(await novo.locator(".ap-acoes button").count(), 2);
  await novo.locator('.ap-acoes button:has-text("Não reconheço")').click(); await P.waitForFunction(() => /Não reconhecido/.test(document.getElementById("aparelhos-lista").innerText), null, { timeout: 10000 }); await fechar(P);
  await conferir(P); await P.waitForTimeout(600); assert.equal(await P.locator("#ap-ponto").isVisible(), true, "'não reconheço' e ainda conectado: o ponto fica");
  await sair(M); await conferir(P); await P.waitForFunction(() => document.getElementById("ap-ponto").hidden, null, { timeout: 15000 });
});
t("'Não fui eu': marca como não reconhecido e já abre a troca de senha (que desconecta os outros aparelhos)", async () => {
  const L = await entrar({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }); await esperarAviso(P); await P.click("#novo-nao");
  await P.waitForSelector("#mfa[open]"); await P.waitForSelector("#ask[open]", { timeout: 10000 }); assert.match(await P.locator("#ask-title").innerText(), /Trocar a senha/);
  await P.click("#ask button[value=cancel]");
  await P.waitForFunction(() => !document.getElementById("ask").open);
  await P.click("#mfa button[value=cancel]");
  await abrir(P); assert.match(await P.locator('#aparelhos-lista .linha:has-text("ChromeOS")').innerText(), /Não reconhecido/); await fechar(P); await sair(L);
});
t("no servidor: só a própria pessoa decide, nunca na própria sessão, só 'reconhecido'/'recusado'; a tabela segue fechada", async () => {
  const cli = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const reg = (token, ua, disp) => fetch(SUPABASE_URL + "/functions/v1/aparelho", { method: "POST", headers: { authorization: "Bearer " + token, apikey: SUPABASE_KEY, "content-type": "application/json", "user-agent": ua }, body: JSON.stringify(disp ? { disp } : {}) });
  const em = novoEmail(), c1 = cli(), s1 = await c1.auth.signUp({ email: em, password: SENHA }); assert.ok(s1.data.session);
  await c1.from("profiles").insert({ id: s1.data.user.id, username: novoUsuario("z"), public_key: { kty: "EC" } });
  assert.equal((await reg(s1.data.session.access_token, UA_WINDOWS, "a".repeat(32))).status, 200);   // 1º aparelho: entra como reconhecido
  const c2 = cli(), s2 = await c2.auth.signInWithPassword({ email: em, password: SENHA }); assert.ok(s2.data.session);
  assert.equal((await reg(s2.data.session.access_token, UA_MAC_FIREFOX, "b".repeat(32))).status, 200); // 2º, código diferente: fica para conferir
  const lista = (await c1.rpc("meus_aparelhos")).data, novo = lista.find((a) => !a.atual), proprio = lista.find((a) => a.atual);
  assert.equal(proprio.decisao, "reconhecido"); assert.equal(novo.decisao, null); assert.equal(novo.sistema, "macOS");
  assert.equal((await c1.rpc("decidir_aparelho", { p_sessao: proprio.session_id, p_decisao: "recusado" })).data, false, "não decide a própria sessão");
  assert.equal((await c1.rpc("decidir_aparelho", { p_sessao: novo.session_id, p_decisao: "qualquer" })).data, false, "decisão inválida");
  const outra = cli(), so = await outra.auth.signUp({ email: novoEmail(), password: SENHA }); assert.ok(so.data.session);
  assert.equal((await outra.rpc("decidir_aparelho", { p_sessao: novo.session_id, p_decisao: "reconhecido" })).data, false, "outra pessoa não decide");
  assert.equal((await c1.rpc("meus_aparelhos")).data.find((a) => !a.atual).decisao, null, "nada mudou");
  assert.equal((await c1.rpc("decidir_aparelho", { p_sessao: novo.session_id, p_decisao: "recusado" })).data, true);
  assert.equal((await c1.rpc("meus_aparelhos")).data.find((a) => !a.atual).decisao, "recusado");
  assert.ok((await c1.from("aparelhos").update({ decisao: "reconhecido" }).eq("session_id", novo.session_id)).error, "a tabela não aceita escrita direta");
  assert.ok((await cli().rpc("decidir_aparelho", { p_sessao: novo.session_id, p_decisao: "reconhecido" })).error, "sem login é recusado");
  // mesmo CÓDIGO do 1º aparelho, em outro navegador: reconhecido sozinho; código mal formado conta como "sem código" (aparelho novo)
  const c3 = cli(), s3 = await c3.auth.signInWithPassword({ email: em, password: SENHA }); assert.ok(s3.data.session);
  assert.equal((await reg(s3.data.session.access_token, UA_MAC_FIREFOX, "a".repeat(32))).status, 200);
  assert.equal((await c3.rpc("meus_aparelhos")).data.find((a) => a.atual).decisao, "reconhecido", "mesmo código do aparelho reconhecido");
  const c4 = cli(), s4 = await c4.auth.signInWithPassword({ email: em, password: SENHA });
  assert.equal((await reg(s4.data.session.access_token, UA_WINDOWS, "xyz")).status, 200); assert.equal((await c4.rpc("meus_aparelhos")).data.find((a) => a.atual).decisao, null, "código inválido: aparelho novo");
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
