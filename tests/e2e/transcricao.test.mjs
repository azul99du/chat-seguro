// Transcrição de áudios no aparelho (Whisper): botão em cada áudio, escolha do modelo (Base e Melhor/Small), download uma vez e guardado, apagar, nada sai do site.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

const FALA = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "fala-pt.mp3");
let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeB; const erros = [], pedidos = [];
const t = (nome, fn) => test(nome, { timeout: 420000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); }
const vigiar = (p) => { p.on("pageerror", (e) => erros.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(m.text().slice(0, 200)); }); p.on("request", (r) => pedidos.push(r.url())); };
const modelo = (p, id) => p.locator(`#tr-modelos button[data-modelo="${id}"]`);
const doModelo = (id) => pedidos.filter((u) => u.includes(`/vendor/whisper/${id}/onnx/`)).length;
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ca = await browser.newContext({ viewport: { width: 420, height: 820 } }); A = await ca.newPage(); B = await (await browser.newContext({ viewport: { width: 420, height: 820 } })).newPage(); vigiar(A); vigiar(B);
  nomeB = novoUsuario("tb"); await cadastrar(A, novoUsuario("ta")); await cadastrar(B, nomeB); await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.click("#mais"); await A.setInputFiles("#file", FALA); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .media.audio", { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });
const texto = (p) => p.locator(".transc-saida").first().innerText();
const esperaTexto = async (p, ms = 300000) => { const ini = Date.now(); while (Date.now() - ini < ms) { if (await p.locator(".transc-saida:not([hidden]) p").count()) return texto(p); const m = await p.locator(".transc-msg").first().innerText().catch(() => ""); if (/Não foi possível|Só dá para|curto demais|falhou/i.test(m)) assert.fail("erro na transcrição: " + m); await p.waitForTimeout(500); } assert.fail("a transcrição não terminou a tempo"); };

t("o áudio tem o botão Transcrever; na primeira vez a folha avisa o tamanho do modelo e deixa escolher Base ou Melhor, sem baixar nada sozinha", async () => {
  const btn = A.locator(".msg.mine .transc-btn"); await btn.waitFor(); assert.equal((await btn.innerText()).trim(), "Transcrever");
  await btn.click(); await A.waitForSelector("#tr-folha[open]"); assert.match(await A.locator("#tr-folha").innerText(), /nada é enviado para fora/i);
  assert.equal(await modelo(A, "base").getAttribute("aria-pressed"), "true"); assert.match(await modelo(A, "base").innerText(), /baixar \d+ MB/); assert.match(await modelo(A, "small").innerText(), /Melhor \(Small\)[\s\S]*baixar \d+ MB/);
  assert.match(await A.locator("#tr-ir").innerText(), /Baixar \(7\d MB\) e transcrever/); await modelo(A, "small").click(); await A.waitForFunction(() => /Baixar \(2\d\d MB\)/.test(document.querySelector("#tr-ir").textContent), null, { timeout: 10000 }); assert.match(await A.locator("#tr-aviso").innerText(), /Wi-Fi/); await modelo(A, "base").click(); await A.waitForFunction(() => /Baixar \(7\d MB\)/.test(document.querySelector("#tr-ir").textContent), null, { timeout: 10000 });
  assert.equal(doModelo("base") + doModelo("small"), 0, "nada baixado antes de a pessoa confirmar"); await A.click("#tr-fechar"); await A.waitForSelector("#tr-folha:not([open])", { state: "attached" });
});
t("Base: baixa uma vez, transcreve no aparelho (português), guarda o texto com o modelo usado; copiar, ocultar e mostrar", async () => {
  await A.click(".msg.mine .transc-btn"); await A.waitForSelector("#tr-folha[open]"); await A.click("#tr-ir"); await A.waitForSelector("#tr-folha:not([open])", { state: "attached" });
  const t1 = await esperaTexto(A); assert.match(t1, /reuni[ãa]o/i, `texto: ${t1}`); assert.match(t1, /notebook/i); assert.match(t1, /Eduardo/i);
  assert.match(await A.locator(".transc-rod").first().innerText(), /Modelo: Base · trocar/); assert.ok(doModelo("base") >= 2, "baixou o codificador e o decodificador do site");
  await A.locator(".transc-rod button", { hasText: "Ocultar" }).click(); assert.equal(await A.locator(".transc-saida").first().isHidden(), true); await A.locator(".transc-btn").first().click(); await A.locator(".transc-saida:not([hidden])").waitFor();
  assert.equal(await A.locator(".msg.mine .transc-btn").first().isHidden(), true);
});
t("com o modelo no aparelho, a segunda transcrição começa direto (sem folha) e não baixa nada de novo, nem depois de recarregar a página", async () => {
  await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await A.click("#contacts button"); const btn = A.locator(".msg.mine .transc-btn").first(); await btn.waitFor({ timeout: 30000 });
  const antes = doModelo("base"); await btn.click(); await A.waitForTimeout(300); assert.equal(await A.locator("#tr-folha").evaluate((d) => d.open), false, "sem folha: o modelo já está guardado");
  const t2 = await esperaTexto(A); assert.match(t2, /notebook/i); assert.equal(doModelo("base"), antes, "nada de novo baixado do site");
});
t("Melhor (Small): o decodificador em duas partes é juntado e a transcrição sai; trocar de modelo a partir do resultado", async () => {
  await A.locator(".transc-rod button", { hasText: "trocar" }).click(); await A.waitForSelector("#tr-folha[open]"); await modelo(A, "small").click(); await A.click("#tr-ir"); await A.waitForSelector("#tr-folha:not([open])", { state: "attached" });
  await A.waitForFunction(() => /Small/.test(document.querySelector(".transc-rod")?.textContent || "") , null, { timeout: 400000 });
  const t3 = await texto(A); assert.match(t3, /reuni[ãa]o/i, `texto: ${t3}`); assert.match(t3, /notebook/i); assert.ok(pedidos.some((u) => /decoder_model_merged_quantized\.onnx\.parte0$/.test(u)) && pedidos.some((u) => /\.parte1$/.test(u)), "baixou as duas partes");
});
t("apagar o modelo do aparelho: a folha passa a pedir o download de novo", async () => {
  await A.locator(".transc-rod button", { hasText: "trocar" }).click(); await A.waitForSelector("#tr-folha[open]"); await modelo(A, "small").click(); assert.match(await modelo(A, "small").innerText(), /já está no aparelho/);
  await A.click("#tr-apagar"); await A.waitForFunction(() => /baixar \d+ MB/.test(document.querySelector('#tr-modelos button[data-modelo="small"] .tr-st').textContent), null, { timeout: 15000 }); assert.equal(await A.locator("#tr-apagar").isHidden(), true); await A.click("#tr-fechar");
});
t("quem recebe também transcreve (o botão aparece no áudio recebido); nada saiu do site; nenhum erro de página", async () => {
  await B.click("#contacts button"); await B.locator(".msg:not(.mine) .transc-btn").first().waitFor({ timeout: 30000 });
  const base = new URL(srv.url).origin, fora = pedidos.filter((u) => /^https?:/.test(u) && !u.startsWith(base) && !/supabase|127\.0\.0\.1|localhost|fonts\.(googleapis|gstatic)/.test(u));
  assert.deepEqual(fora, [], "nenhum pedido para fora do site e do Supabase (o modelo vem do próprio site)"); assert.deepEqual(erros, []);
});
