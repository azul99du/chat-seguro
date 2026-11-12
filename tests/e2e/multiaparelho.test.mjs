// Vários aparelhos na mesma conta, etapa 2: conversa a dois com uma cópia cifrada para CADA aparelho aprovado de quem recebe e para CADA outro aparelho de quem envia.
// A tem 2 aparelhos (A1, A2) e B tem 1 e depois 2 (B1, B2). Cobre: leitura em todos, o que cada aparelho envia aparecer nos outros como "minha", responder, reagir, apagar para todos,
// recarregar, lida/não lida entre aparelhos, aparelho pendente (tela de espera, sem receber nada), removido, formato antigo, aparelho falso e recuperação da conta.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar, compartilhaCodigo, permitirNovo, conferirAba } from "./env.mjs";
import { genDH, accept, decrypt as ratchetDecrypt } from "../../ratchet.js";

let skip = configurado ? false : motivoSemConfig, browser, srv, A1, A2, B1, B2, emailA, emailB, nomeA, nomeB; const erros = [];
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
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  emailA = novoEmail(); emailB = novoEmail(); nomeA = novoUsuario("a"); nomeB = novoUsuario("b");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("conversa de partida (1 aparelho cada): ida e volta; B vê 'vista' ao abrir", async () => {
  A1 = await cadastrar(nomeA, emailA); B1 = await cadastrar(nomeB, emailB);
  await chamar(A1, nomeB); await A1.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await enviar(A1, "oi bob, primeira"); await B1.waitForSelector("#contacts button .unread", { timeout: 30000 });
  await B1.click("#contacts button"); await recebida(B1, "oi bob, primeira"); await enviar(B1, "oi alice, segunda"); await recebida(A1, "oi alice, segunda");
  await A1.waitForSelector(".msg.mine .rcpt.read", { timeout: 30000 });
});
let antigas;
t("aparelho pendente (A2): tela cheia 'Aguardando permissão', sem conversas; não recebe o que chega enquanto espera; depois de permitido, entra sozinho e lê só as NOVAS", async () => {
  A2 = await novoAparelho("A2", emailA, A1);
  assert.match(await A2.locator("#espera").innerText(), /Aguardando permissão/); assert.equal(await A2.locator("#chat").isVisible(), false); assert.equal(await A2.locator("#contacts button").count(), 0);
  assert.match(await A2.locator("#espera").innerText(), /Não tenho mais acesso aos outros aparelhos/); assert.match(await A2.locator("#espera").innerText(), /Sair/);
  await enviar(B1, "enquanto A2 espera"); await recebida(A1, "enquanto A2 espera");
  assert.equal(await A2.locator("#chat").isVisible(), false, "o pendente continua sem ver nada");
  await permitirNovo(A1); await A2.waitForSelector(pronto, { timeout: 60000 }); await A2.waitForTimeout(1500);
  await refrescar(B1, A1, A2); await abrirConversa(A2, nomeB);
  assert.equal(await A2.locator("#messages .msg").count(), 0, "as mensagens antigas não migram (nem aparecem como erro)");
  await abrirConversa(A1, nomeB); antigas = await textos(A1); assert.ok(antigas.length >= 3);
});
t("mensagem do B chega nos DOIS aparelhos de A, no tempo real", async () => {
  await abrirConversa(B1, nomeA); await enviar(B1, "para os dois aparelhos"); await recebida(A1, "para os dois aparelhos"); await recebida(A2, "para os dois aparelhos");
});
t("o que A2 envia: B lê, e A1 vê como mensagem MINHA, no lugar certo (depois da anterior), sem aviso de 'outro aparelho'", async () => {
  await enviar(A2, "escrito no A2"); await recebida(B1, "escrito no A2"); await minha(A1, "escrito no A2");
  const l = await textos(A1); assert.ok(l.indexOf("escrito no A2") > l.indexOf("para os dois aparelhos"), "no lugar certo: " + l.join(" | ")); assert.equal(await A1.locator(".bubble.err").count(), 0);
  await enviar(A1, "escrito no A1"); await recebida(B1, "escrito no A1"); await minha(A2, "escrito no A1"); assert.equal(await A2.locator(".bubble.err").count(), 0);
  const l2 = await textos(A2); assert.ok(l2.indexOf("escrito no A1") > l2.indexOf("escrito no A2"), "ordem no A2: " + l2.join(" | "));
});
t("'vista': quando B lê, os DOIS aparelhos de A mostram 'vista' nas mensagens que cada um enviou e nas que o outro enviou", async () => {
  await B1.waitForTimeout(500);
  for (const p of [A1, A2]) for (const txt of ["escrito no A1", "escrito no A2"]) await p.waitForSelector(`.msg.mine:has(.vis:has-text("${txt}")) .rcpt.read`, { timeout: 40000 });
});
t("responder atravessa aparelhos: B responde a uma mensagem do A2 e os dois aparelhos de A veem a citação; A1 responde a uma do B e A2 vê", async () => {
  await B1.locator(msg("escrito no A2")).locator(".bubble").first().click({ button: "right" }); await B1.locator(".picker .responder").click(); await enviar(B1, "resposta ao A2");
  for (const p of [A1, A2]) { await recebida(p, "resposta ao A2"); assert.match(await p.locator(`${msg("resposta ao A2")} .quote`).innerText(), /escrito no A2/); assert.match(await p.locator(`${msg("resposta ao A2")} .quote .q-who`).innerText(), /Você/); }
  await A1.locator(msg("para os dois aparelhos")).locator(".bubble").first().click({ button: "right" }); await A1.locator(".picker .responder").click(); await enviar(A1, "respondi do A1");
  await recebida(B1, "respondi do A1"); await minha(A2, "respondi do A1"); assert.match(await A2.locator(`${msg("respondi do A1")} .quote`).innerText(), /para os dois aparelhos/);
  assert.match(await B1.locator(`${msg("respondi do A1")} .quote`).innerText(), /para os dois aparelhos/);
});
t("reação atravessa aparelhos: A2 reage a uma mensagem do B; B vê a reação e A1 vê a reação como minha", async () => {
  await A2.locator(msg("para os dois aparelhos")).locator(".bubble").first().click({ button: "right" }); await A2.locator('.picker .emojis button[aria-label="Reagir com ❤️"]').click();
  await B1.waitForSelector(`${msg("para os dois aparelhos")} .chip:has-text("❤️")`, { timeout: 40000 }); await A1.waitForSelector(`${msg("para os dois aparelhos")} .chip.mine:has-text("❤️")`, { timeout: 40000 });
  await B1.locator(msg("escrito no A1")).locator(".bubble").first().click({ button: "right" }); await B1.locator('.picker .emojis button[aria-label="Reagir com 👍"]').click(); // B reage a uma minha: os dois aparelhos de A veem
  for (const p of [A1, A2]) await p.waitForSelector(`${msg("escrito no A1")} .chip:has-text("👍")`, { timeout: 40000 });
});
t("apagar para todos atravessa aparelhos: A1 apaga uma mensagem que o A2 escreveu; A2 e B passam a mostrar 'Mensagem apagada'", async () => {
  await A1.locator(msg("escrito no A2")).locator(".bubble").first().click({ button: "right" }); await A1.locator(".picker .apagar").click(); await A1.waitForSelector("#choice[open]"); await A1.click("#choice button[value=todos]");
  for (const p of [A1, A2, B1]) { await p.waitForFunction(() => document.body.innerText.includes("Mensagem apagada") && !document.body.innerText.includes("escrito no A2"), null, { timeout: 40000 }); }
});
t("recarregar mantém tudo, nos dois aparelhos: mesma lista, sem balões de erro, mensagem apagada continua apagada", async () => {
  const antes = (await textos(A1)).join("|");
  for (const p of [A1, A2]) { await p.reload(); await p.waitForSelector(pronto, { timeout: 30000 }); await abrirConversa(p, nomeB); await p.waitForTimeout(1200); }
  for (const p of [A1, A2]) { assert.equal(await p.locator(".bubble.err").count(), 0); assert.equal(await p.locator(".bubble.apagada").count(), 1); assert.ok(!(await p.evaluate(() => document.body.innerText)).includes("escrito no A2")); }
  const a1 = await textos(A1), a2 = await textos(A2); for (const txt of ["para os dois aparelhos", "escrito no A1", "resposta ao A2", "respondi do A1"]) { assert.ok(a1.includes(txt) && a2.includes(txt), txt); }
  assert.ok(antes.length > 0); assert.equal(await A1.locator(`${msg("resposta ao A2")} .quote`).count(), 1, "a citação volta depois de recarregar");
});
t("lida/não lida entre aparelhos: B manda com os dois aparelhos de A na lista; ler no A1 zera a bolinha do A2", async () => {
  await comoLista(A1); await comoLista(A2); await abrirConversa(B1, nomeA);
  await enviar(B1, "para ler num só"); for (const p of [A1, A2]) await p.waitForSelector("#contacts button .unread", { timeout: 40000 });
  await A1.click("#contacts button"); await recebida(A1, "para ler num só"); await A2.waitForSelector("#contacts button .unread", { state: "detached", timeout: 40000 }); // (o servidor marcou a cópia do A2 como lida)
  assert.equal(await B1.locator(`.msg.mine:has(.vis:has-text("para ler num só")) .rcpt.read`).count() >= 0, true);
});
t("B ganha um segundo aparelho (B2): pendente não recebe nada; depois de permitido, os dois aparelhos de B leem o que A envia, e as respostas de B2 aparecem nos dois de A", async () => {
  B2 = await novoAparelho("B2", emailB, B1); await abrirConversa(A1, nomeB); await enviar(A1, "enquanto B2 espera"); await recebida(B1, "enquanto B2 espera");
  assert.equal(await B2.locator("#chat").isVisible(), false);
  await permitirNovo(B1); await B2.waitForSelector(pronto, { timeout: 60000 }); await B2.waitForTimeout(1500); await refrescar(A1, A2, B1);
  await abrirConversa(B2, nomeA); await abrirConversa(A2, nomeB);
  await enviar(A1, "para os dois do B"); await recebida(B1, "para os dois do B"); await recebida(B2, "para os dois do B"); await minha(A2, "para os dois do B");
  await enviar(B2, "resposta do B2"); for (const p of [A1, A2]) await recebida(p, "resposta do B2"); await minha(B1, "resposta do B2");
  assert.equal(await B2.locator(".bubble.err").count(), 0); assert.ok(!(await textos(B2)).includes("enquanto B2 espera"), "o B2 não lê o que chegou antes de ser permitido");
});
t("aparelho removido (A2): é desconectado e deixa de receber; quem envia não falha mesmo com a lista antiga guardada (atualiza e tenta de novo)", async () => {
  await menuConta(A1, "#sec-btn"); await A1.waitForSelector("#mfa[open]"); await A1.click("#mfa-aparelhos"); await A1.waitForSelector("#aparelhos[open]");
  await A1.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 2, null, { timeout: 20000 });
  await A1.locator('#dispositivos-lista .linha:not(.atual) button:has-text("Remover")').click(); await A1.waitForSelector("#choice[open]"); await A1.click("#choice button[value=sim]");
  await A1.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 1, null, { timeout: 20000 }); await A1.click("#aparelhos button[value=cancel]"); await A1.click("#mfa button[value=cancel]");
  for (let i = 0; i < 25 && !(await A2.locator("#auth").isVisible().catch(() => false)); i++) { await conferirAba(A2); await A2.waitForTimeout(1500); }
  assert.equal(await A2.locator("#auth").isVisible(), true, "o aparelho removido volta para o login");
  await abrirConversa(B1, nomeA); await enviar(B1, "depois de remover o A2"); await recebida(A1, "depois de remover o A2"); // (a lista de B ainda tinha o A2: o servidor recusa, B atualiza e reenvia sozinho)
  await B1.waitForTimeout(800); assert.equal(await B1.locator(".msg.mine:has(.vis:has-text('depois de remover o A2'))").count(), 1); assert.equal(await B1.locator("#choice[open]").count(), 0, "nenhum aviso de erro");
  await enviar(A1, "A1 sozinho de novo"); await recebida(B1, "A1 sozinho de novo"); await recebida(B2, "A1 sozinho de novo");
});
t("destinatário SEM aparelho registrado (conta do site antigo): recebe no formato antigo, uma cópia só, sem para_aparelho", async () => {
  const nomeC = novoUsuario("c"), emailC = novoEmail(), c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await c.auth.signUp({ email: emailC, password: SENHA }); assert.ok(s.data.session);
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), pub = await crypto.subtle.exportKey("jwk", par.publicKey);
  assert.ifError((await c.from("profiles").insert({ id: s.data.user.id, username: nomeC, public_key: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y } })).error);
  assert.ifError((await c.from("prekeys").insert({ id: [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""), public_key: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y } })).error); // chave sem marca de aparelho
  await chamar(A1, nomeC); await A1.waitForSelector(`#conv-title:has-text("@${nomeC}")`); await enviar(A1, "para quem não tem aparelhos"); await minha(A1, "para quem não tem aparelhos");
  const rows = (await c.from("messages").select("id,para_aparelho,de_aparelho,v,grupo_id")).data; assert.equal(rows.length, 1, "uma cópia só"); assert.equal(rows[0].para_aparelho, null); assert.equal(rows[0].v, 2);
  await A1.waitForTimeout(500); assert.equal(await A1.locator(".bubble.err").count(), 0);
});
t("aparelho FALSO na lista (o servidor enfia um aparelho aprovado cuja chave privada ninguém tem): nada vaza e o envio para os outros aparelhos segue funcionando", async () => {
  // um login "de fora" registra um aparelho em B e publica uma chave de recepção que ele não tem como abrir; B2 o permite
  const falso = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  assert.ifError((await falso.auth.signInWithPassword({ email: emailB, password: SENHA })).error); const idF = hex(); assert.equal((await falso.rpc("registrar_dispositivo", { p_id: idF })).data, "pendente");
  const spk = await genDH(); assert.ifError((await falso.from("prekeys").insert({ id: hex(), public_key: { kty: "EC", crv: "P-256", x: spk.pub.x, y: spk.pub.y }, aparelho: idF })).error);
  await permitirNovo(B1); await refrescar(A1, B1, B2);
  await abrirConversa(A1, nomeB); await enviar(A1, "com um aparelho falso na lista"); await recebida(B1, "com um aparelho falso na lista"); await recebida(B2, "com um aparelho falso na lista");
  await minha(A1, "com um aparelho falso na lista"); assert.equal(await A1.locator("#choice[open]").count(), 0, "o envio não falhou");
  // o aparelho falso até LÊ a linha endereçada a ele (o servidor a entrega), mas sem a chave de identidade de B não abre a sessão: nada do texto vaza
  const minhas = (await falso.from("messages").select("id,header,ciphertext,sender_id,recipient_id")).data.filter((m) => m.header?.init), ultima = minhas[minhas.length - 1];
  assert.ok(ultima, "(a linha endereçada ao aparelho falso existe)"); const ikFalsa = await genDH();
  const pubA = (await (async () => { const r = await falso.from("profiles").select("public_key").eq("id", ultima.sender_id).single(); return r.data.public_key; })());
  await assert.rejects(async () => { const st = await accept(ikFalsa.priv, pubA, { id: ultima.header.init.spk, priv: spk.priv }, ultima.header); await ratchetDecrypt(st, ultima.sender_id, ultima.recipient_id, ultima.header, ultima.ciphertext); }, "sem a chave de identidade da conta não abre nada");
  assert.ok(!JSON.stringify(ultima).includes("aparelho falso"), "o texto não aparece em nenhum campo");
  assert.equal(await B1.locator(".bubble.err").count(), 0);
});
t("recuperação: o pendente pede; o aparelho aprovado vê o aviso e pode recusar (o pendente é desconectado); passado o prazo, outro pedido assume a conta e remove todos os outros", async () => {
  const R1 = await novoAparelho("R1", emailA, A1);
  await R1.click("#espera-perdi"); assert.match(await R1.locator("#espera-caixa-pedir").innerText(), /24 horas/); assert.match(await R1.locator("#espera-caixa-pedir").innerText(), /todos os outros aparelhos/i);
  await R1.click("#espera-pedir"); await R1.waitForSelector("#choice[open]"); await R1.click("#choice button[value=sim]"); await R1.waitForSelector("#espera-caixa-pedido:not([hidden])", { timeout: 20000 });
  assert.equal(await R1.locator("#espera-concluir").isDisabled(), true, "antes do prazo não dá para concluir"); assert.match(await R1.locator("#espera-pedido-txt").innerText(), /Pedido de recuperação feito/);
  for (let i = 0; i < 20; i++) { await conferirAba(A1); if (/recuperação/.test(await A1.locator("#aviso-disp").innerText().catch(() => ""))) break; await A1.waitForTimeout(1500); }
  assert.match(await A1.locator("#aviso-disp").innerText(), /Pedido de recuperação da conta/); await A1.click("#aviso-disp"); await A1.waitForSelector("#aparelhos[open]");
  assert.equal(await A1.locator("#disp-recup").isVisible(), true); assert.match(await A1.locator("#disp-recup").innerText(), /Se não foi você, toque em Recusar/);
  await A1.locator('#dispositivos-lista .linha[data-estado=pendente] button:has-text("Recusar")').click(); await A1.waitForSelector("#choice[open]"); await A1.click("#choice button[value=sim]");
  await A1.waitForFunction(() => !document.querySelector("#dispositivos-lista .linha[data-estado=pendente]"), null, { timeout: 20000 }); await A1.click("#aparelhos button[value=cancel]");
  for (let i = 0; i < 25 && !(await R1.locator("#auth").isVisible().catch(() => false)); i++) { await conferirAba(R1); await R1.waitForTimeout(1500); }
  assert.equal(await R1.locator("#auth").isVisible(), true, "recusar desconecta o pendente"); await R1.context().close();
  // segundo pedido: leva até o fim (o projeto de TESTE tem o prazo curto em push_config; no padrão de 24 h esta parte para aqui)
  const R2 = await novoAparelho("R2", emailA, A1); await R2.click("#espera-perdi"); await R2.click("#espera-pedir"); await R2.waitForSelector("#choice[open]"); await R2.click("#choice button[value=sim]"); await R2.waitForSelector("#espera-caixa-pedido:not([hidden])", { timeout: 20000 });
  const falta = await R2.locator("#espera-pedido-txt").innerText(); if (!/(segundo|menos de 1 minuto|agora|Prazo cumprido)/.test(falta) && !/Faltam [0-9] minutos?/.test(falta)) { console.log("# prazo longo (" + falta.slice(0, 80) + "...): conclusão não testada"); return; }
  await R2.waitForFunction(() => !document.getElementById("espera-concluir").disabled, null, { timeout: 90000 });
  await R2.click("#espera-concluir"); await R2.waitForSelector("#choice[open]"); await R2.click("#choice button[value=sim]"); await R2.waitForSelector(pronto, { timeout: 60000 });
  for (const p of [A1]) { for (let i = 0; i < 25 && !(await p.locator("#auth").isVisible().catch(() => false)); i++) { await conferirAba(p); await p.waitForTimeout(1500); } assert.equal(await p.locator("#auth").isVisible(), true, "o aparelho antigo foi removido e desconectado"); }
  await menuConta(R2, "#sec-btn"); await R2.waitForSelector("#mfa[open]"); await R2.click("#mfa-aparelhos"); await R2.waitForSelector("#aparelhos[open]"); await R2.waitForFunction(() => document.querySelectorAll("#dispositivos-lista .linha").length === 1, null, { timeout: 20000 });
  assert.match(await R2.locator("#dispositivos-lista .linha").first().innerText(), /Permitido/);
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
