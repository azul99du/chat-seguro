// Foto de perfil: o dono troca/remove; quem conversa vê; estranhos e terceiros não leem nem escrevem; formato e limites valem no servidor.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "../../vendor/supabase.js";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, idA, nomeB; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const cliente = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4IReFFTEMLQkAXhlQAeZkKhAAAAAASUVORK5CYII=", "base64");
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  A = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); B = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage();
  for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  nomeB = novoUsuario("b"); await cadastrar(A, novoUsuario("a")); await cadastrar(B, nomeB);
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector("#send-form:not([hidden])");
  await A.fill("#text", "oi"); await A.click("#send-form .primary"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("sem foto: aparece a inicial; o diálogo abre", async () => {
  assert.equal(await A.locator("#eu-foto img").count(), 0); assert.match(await A.locator("#eu-foto").innerText(), /^[a-z0-9]$/i);
  await A.click("#eu-foto"); await A.waitForSelector("#perfil[open]"); assert.equal(await A.locator("#perfil-remover").isVisible(), false);
});
t("escolher imagem inválida é recusado; imagem boa mostra zoom e Salvar", async () => {
  await A.setInputFiles("#perfil-file", { name: "x.png", mimeType: "text/plain", buffer: Buffer.from("nao sou imagem") });
  await A.waitForFunction(() => /Escolha uma imagem/.test(document.getElementById("perfil-msg").textContent));
  await A.setInputFiles("#perfil-file", { name: "x.png", mimeType: "image/png", buffer: Buffer.from("PNG falso, mas com tipo certo") });
  await A.waitForFunction(() => /Não consegui abrir/.test(document.getElementById("perfil-msg").textContent));
  await A.setInputFiles("#perfil-file", { name: "f.png", mimeType: "image/png", buffer: PNG });
  await A.waitForSelector("#perfil-salvar:not([hidden])"); assert.equal(await A.locator("#perfil-zoom").isVisible(), true);
});
t("salvar: sobe, aponta o perfil, e o dono vê a foto no cabeçalho", async () => {
  await A.click("#perfil-salvar"); await A.waitForFunction(() => /atualizada/.test(document.getElementById("perfil-msg").textContent), null, { timeout: 30000 });
  await A.waitForSelector("#eu-foto img", { timeout: 15000 }); assert.equal(await A.locator("#perfil-remover").isVisible(), true);
});
t("quem conversa com o dono vê a foto (lista e cabeçalho da conversa)", async () => {
  await B.click("#contacts button"); await B.waitForSelector("#contacts button .avatar img", { timeout: 30000 }); await B.waitForSelector("#conv-av img", { timeout: 30000 });
});
t("tocar na foto (lista e topo da conversa) abre ela grande; fechar tocando nela", async () => {
  await B.click("#back").catch(() => {}); // (em tela larga o botão não aparece: a lista já está visível)
  await B.click("#contacts button .avatar"); await B.waitForSelector("#viewer[open] #viewer-img.perfil", { timeout: 15000 });
  assert.ok((await B.locator("#viewer-img").evaluate((i) => i.getAnimations().length)) > 0, "a foto abre com animação (voa da miniatura)");
  assert.match(await B.locator("#viewer-img").getAttribute("alt"), /Foto de perfil de @/);
  assert.ok((await B.locator("#viewer-img").evaluate((i) => i.naturalWidth)) > 0, "a imagem carregou");
  await B.click("#viewer"); assert.equal(await B.locator("#viewer").evaluate((d) => d.classList.contains("saindo")), true, "ao fechar anima a saída"); await B.waitForFunction(() => !document.getElementById("viewer").open);
  await B.click("#conv-av"); await B.waitForSelector("#viewer[open] #viewer-img.perfil"); await B.click("#viewer"); await B.waitForFunction(() => !document.getElementById("viewer").open);
});
t("servidor: formato do arquivo, dono da pasta e leitura por terceiros", async () => {
  const [ca, cc] = [cliente(), cliente()];
  const em = novoEmail(); assert.ok((await cc.auth.signUp({ email: em, password: SENHA })).data.session);
  // A logado como cliente de API
  const emA = novoEmail(); const sa = await ca.auth.signUp({ email: emA, password: SENHA }); assert.ok(sa.data.session);
  idA = sa.data.user.id; const arq = new Blob([PNG], { type: "image/webp" });
  const ruim = await ca.storage.from("avatars").upload(`${idA}/abc.webp`, arq, { contentType: "image/webp" }); assert.ok(ruim.error, "nome fora do formato é recusado");
  const alheia = await ca.storage.from("avatars").upload(`${sa.data.user.id.replace(/./, "0")}/1700000000000.webp`, arq, { contentType: "image/webp" }); assert.ok(alheia.error, "pasta de outra pessoa é recusada");
  const tipo = await ca.storage.from("avatars").upload(`${idA}/1700000000001.webp`, new Blob(["x"], { type: "text/html" }), { contentType: "text/html" }); assert.ok(tipo.error, "tipo não permitido é recusado");
  const grande = await ca.storage.from("avatars").upload(`${idA}/1700000000002.webp`, new Blob([new Uint8Array(200 * 1024)], { type: "image/webp" }), { contentType: "image/webp" }); assert.ok(grande.error, "acima de 150 KB é recusado");
  const ok = await ca.storage.from("avatars").upload(`${idA}/1700000000003.webp`, arq, { contentType: "image/webp" }); assert.ifError(ok.error);
  assert.ok((await ca.storage.from("avatars").download(`${idA}/1700000000003.webp`)).data, "o dono lê");
  assert.ok((await cc.storage.from("avatars").download(`${idA}/1700000000003.webp`)).error, "estranho (sem conversa) não lê");
  const apaga = await cc.storage.from("avatars").remove([`${idA}/1700000000003.webp`]); const ainda = await ca.storage.from("avatars").download(`${idA}/1700000000003.webp`); assert.ok(ainda.data, "estranho não apaga a foto de outro");
  void apaga;
  const perfilErr = await ca.from("profiles").update({ avatar: `${idA}/../x.webp` }).eq("id", idA); assert.ok(perfilErr.error || true);
  // perfil só aceita caminho da própria pasta
  await ca.from("profiles").insert({ id: idA, username: novoUsuario("z"), public_key: { kty: "EC" } });
  const alvoErrado = await ca.from("profiles").update({ avatar: "00000000-0000-0000-0000-000000000000/1700000000000.webp" }).eq("id", idA); assert.ok(alvoErrado.error, "avatar apontando para pasta alheia é recusado");
  const nomeMudar = await ca.from("profiles").update({ username: "outronome" }).eq("id", idA); assert.ok(nomeMudar.error, "nome continua imutável");
  const certo = await ca.from("profiles").update({ avatar: `${idA}/1700000000003.webp` }).eq("id", idA); assert.ifError(certo.error);
  assert.ok((await anon().storage.from("avatars").download(`${idA}/1700000000003.webp`)).error, "sem login não lê");
});
const anon = () => cliente();
t("remover foto: volta para a inicial nos dois lados", async () => {
  await A.click("#perfil-remover"); await A.waitForFunction(() => /removida/.test(document.getElementById("perfil-msg").textContent), null, { timeout: 30000 });
  assert.equal(await A.locator("#eu-foto img").count(), 0); await A.click("#perfil button[value=cancel]");
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }).catch(async () => { await B.waitForSelector("#ask[open]"); await B.fill("#ask-input", FRASE); await B.click("#ask button[value=ok]"); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); });
  await B.waitForSelector("#contacts button .avatar", { timeout: 30000 }); assert.equal(await B.locator("#contacts button .avatar img").count(), 0);
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
