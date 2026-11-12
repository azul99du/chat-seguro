// Vários aparelhos na mesma conta, etapa 1: o 1º aparelho entra permitido, os outros ficam "aguardando permissão" até um aparelho permitido liberar;
// aviso no aparelho permitido; Permitir / Recusar / Remover; limite de 5 e registro repetido. O envio de mensagens não muda (veja flow.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, compartilhaCodigo } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P, email; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 150000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = "#chat:not([hidden]):not(.preparando)";
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
async function entrar() { // outro navegador entrando na mesma conta (pede a frase-senha)
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } }); await compartilhaCodigo(ctx, P); // (o aviso antigo de "aparelho novo" não é o assunto aqui: o código antigo vale o mesmo; o aparelho de RECEPÇÃO é outro e é novo)
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => erros.push(e.message));
  await pg.goto(srv.url); await pg.fill("#email", email); await pg.fill("#password", SENHA); await pg.click("#auth-submit");
  await pg.waitForSelector("#ask[open]", { timeout: 30000 }); await pg.fill("#ask-input", FRASE); await pg.click("#ask button[value=ok]"); await pg.waitForSelector(pronto, { timeout: 30000 });
  await pg.waitForTimeout(1500); return pg;
}
const conferir = (p) => p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // o app confere ao voltar para a aba
const aviso = (p) => p.locator("#aviso-disp");
async function esperarLogin(p) { for (let i = 0; i < 25; i++) { await conferir(p); if (await p.locator("#auth").isVisible().catch(() => false)) return; await p.waitForTimeout(1500); } throw new Error("o aparelho desconectado não voltou para o login"); }
async function semPedido(p, ciclos = 5) { for (let i = 0; i < ciclos; i++) { await conferir(p); await p.waitForTimeout(3300); if (await aviso(p).isVisible()) throw new Error("o pedido reapareceu: " + await aviso(p).innerText()); } } // (a conferência tem espaço de 3 s: cada volta é um ciclo de verdade)
async function esperarAviso(p, re) { for (let i = 0; i < 20; i++) { await conferir(p); if (await aviso(p).isVisible() && re.test(await aviso(p).innerText())) return; await p.waitForTimeout(1200); } throw new Error("o aviso não apareceu: " + re); }
async function esperarSemAviso(p) { for (let i = 0; i < 20; i++) { await conferir(p); if (!(await aviso(p).isVisible())) return; await p.waitForTimeout(1200); } throw new Error("o aviso não sumiu"); }
const abrir = async (p, n) => { await menuConta(p, "#sec-btn"); await p.waitForSelector("#mfa[open]"); await p.click("#mfa-aparelhos"); await p.waitForSelector("#aparelhos[open]"); await p.waitForFunction((k) => document.querySelectorAll("#dispositivos-lista .linha").length === k, n, { timeout: 20000 }); };
const fechar = async (p) => { await p.click("#aparelhos button[value=cancel]"); await p.click("#mfa button[value=cancel]"); };
const linhas = (p) => p.locator("#dispositivos-lista .linha");
const confirmar = async (p) => { await p.waitForSelector("#choice[open]"); await p.click('#choice button[value=sim]'); await p.waitForFunction(() => !document.getElementById("choice").open); };
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); P.on("pageerror", (e) => erros.push(e.message)); email = novoEmail();
  await P.goto(srv.url); await P.click("#tab-signup"); await P.fill("#username", novoUsuario("v")); await P.fill("#email", email); await P.fill("#password", SENHA); await P.click("#auth-submit");
  await P.waitForSelector("#ask[open]", { timeout: 30000 }); await P.fill("#ask-input", FRASE); await P.click("#ask button[value=ok]"); await P.waitForSelector(pronto, { timeout: 30000 }); await P.waitForTimeout(1500);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

let Q;
t("o PRIMEIRO aparelho da conta entra permitido: sem aviso de espera, com 'Este aparelho' e 'Permitido', e sem botão de decidir", async () => {
  assert.equal(await aviso(P).isVisible(), false); await abrir(P, 1);
  const txt = await linhas(P).first().innerText(); assert.match(txt, /Este aparelho/); assert.match(txt, /Permitido/); assert.doesNotMatch(txt, /Aguardando/);
  assert.equal(await P.locator("#disp-aviso").isVisible(), false); assert.equal(await linhas(P).first().locator('button:has-text("Permitir")').count(), 0);
  assert.match(await linhas(P).first().locator("button").innerText(), /Remover este aparelho/); await fechar(P);
});
t("o SEGUNDO aparelho fica pendente: aviso claro e curto, selo 'Aguardando permissão', sem Permitir/Recusar", async () => {
  Q = await entrar(); await esperarAviso(Q, /Aguardando permissão/); await abrir(Q, 2);
  assert.equal(await Q.locator("#disp-aviso").isVisible(), true); assert.match(await Q.locator("#disp-aviso").innerText(), /aguarda a permissão de outro aparelho já conectado/);
  const eu = Q.locator("#dispositivos-lista .linha.atual"), txt = await eu.innerText(); assert.match(txt, /Este aparelho/); assert.match(txt, /Aguardando permissão/);
  assert.equal(await Q.locator('#dispositivos-lista button:has-text("Permitir")').count(), 0); assert.equal(await Q.locator('#dispositivos-lista button:has-text("Recusar")').count(), 0);
  assert.equal(await Q.locator("#dispositivos-lista .linha:not(.atual) button").count(), 0, "um pendente não remove nem decide sobre os outros");
  await fechar(Q);
});
t("o aparelho permitido vê o aviso ao voltar para a aba e permite o novo; o novo deixa de esperar", async () => {
  await esperarAviso(P, /Um aparelho novo pede permissão/); await P.click("#aviso-disp"); await P.waitForSelector("#aparelhos[open]"); await P.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 2);
  assert.equal(await P.locator("#disp-pedido").isVisible(), true);
  const novo = P.locator('#dispositivos-lista .linha[data-estado=pendente]'); assert.match(await novo.innerText(), /Aguardando permissão/); assert.equal(await novo.locator("button").count(), 2);
  await novo.locator('button:has-text("Permitir")').click(); await P.waitForFunction(() => document.querySelectorAll('#dispositivos-lista .linha[data-estado=pendente]').length === 0, null, { timeout: 15000 });
  assert.equal(await P.locator("#dispositivos-lista .linha:has-text('Permitido')").count(), 2); assert.equal(await P.locator("#disp-pedido").isVisible(), false); await P.click("#aparelhos button[value=cancel]"); // (aberto pelo aviso, sem passar pela Segurança da conta)
  await esperarSemAviso(P); await esperarSemAviso(Q);
});
t("recusar: o pedido some, o aparelho recusado é desconectado (volta para o login) e NÃO reaparece como pendente; entrar de novo gera um pedido novo", async () => {
  const R = await entrar(); await esperarAviso(P, /Um aparelho novo/); await abrir(P, 3);
  await P.locator('#dispositivos-lista .linha[data-estado=pendente] button:has-text("Recusar")').click(); await confirmar(P);
  await P.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 2, null, { timeout: 15000 }); await fechar(P);
  await esperarLogin(R); await semPedido(P); await semPedido(R, 2);
  assert.equal(await R.locator("#chat").isVisible(), false);
  // entrar de novo (mesmo navegador): a conta já tem aparelho permitido, então é um pedido novo, pendente
  await R.fill("#email", email); await R.fill("#password", SENHA); await R.click("#auth-submit"); await R.waitForSelector(pronto, { timeout: 30000 });
  await esperarAviso(R, /Aguardando permissão/); await esperarAviso(P, /Um aparelho novo/);
  await abrir(P, 3); await P.locator('#dispositivos-lista .linha[data-estado=pendente] button:has-text("Recusar")').click(); await confirmar(P);
  await P.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 2, null, { timeout: 15000 }); await fechar(P); await esperarLogin(R); await R.context().close();
});
t("remover outro aparelho (permitido): sai da lista; um pendente remove a si mesmo e volta para o login", async () => {
  await abrir(P, 2); await P.locator('#dispositivos-lista .linha:not(.atual) button:has-text("Remover")').click(); await confirmar(P);
  await P.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 1, null, { timeout: 15000 }); await fechar(P);
  await esperarLogin(Q); await semPedido(P, 4); assert.equal(await Q.locator("#chat").isVisible(), false, "o removido não volta como pendente"); // (é desconectado: precisa entrar de novo)
  await Q.context().close();
  const S = await entrar(); await esperarAviso(S, /Aguardando permissão/); await abrir(S, 2); await S.locator("#dispositivos-lista .linha.atual button").click(); await confirmar(S);
  await S.waitForSelector("#auth:not([hidden])", { timeout: 20000 }); await abrir(P, 1); await fechar(P); await S.context().close();
});
t("limite de 5 aparelhos e registro repetido (idempotente), direto no servidor", async () => {
  const cli = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const em = novoEmail(), c0 = cli(), s0 = await c0.auth.signUp({ email: em, password: SENHA }); assert.ok(s0.data.session);
  assert.ifError((await c0.from("profiles").insert({ id: s0.data.user.id, username: novoUsuario("l"), public_key: { kty: "EC" } })).error);
  const ids = Array.from({ length: 6 }, hex), cs = [c0];
  for (let i = 1; i < 6; i++) { const c = cli(); assert.ifError((await c.auth.signInWithPassword({ email: em, password: SENHA })).error); cs.push(c); }
  assert.equal((await cs[0].rpc("registrar_dispositivo", { p_id: ids[0] })).data, "aprovado");
  assert.equal((await cs[0].rpc("registrar_dispositivo", { p_id: ids[0] })).data, "aprovado", "repetir é idempotente");
  for (let i = 1; i < 5; i++) assert.equal((await cs[i].rpc("registrar_dispositivo", { p_id: ids[i] })).data, "pendente");
  assert.equal((await cs[3].rpc("registrar_dispositivo", { p_id: ids[3] })).data, "pendente", "repetir um pendente continua pendente");
  assert.equal((await cs[0].rpc("meus_dispositivos")).data.length, 5, "repetir não duplica");
  const r6 = await cs[5].rpc("registrar_dispositivo", { p_id: ids[5] }); assert.match(r6.error?.message || "", /limite_de_aparelhos/);
  assert.equal((await cs[0].rpc("meus_dispositivos")).data.length, 5);
  // liberar uma vaga (remover um pendente) deixa o 6º entrar, como pendente
  const lista = (await cs[0].rpc("meus_dispositivos")).data, pend = lista.find((a) => a.estado === "pendente");
  assert.equal((await cs[0].rpc("remover_dispositivo", { p_ref: pend.ref })).data, true);
  assert.equal((await cs[5].rpc("registrar_dispositivo", { p_id: ids[5] })).data, "pendente");
  assert.ok((await cs[0].rpc("registrar_dispositivo", { p_id: "curto" })).error, "id malformado");
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
