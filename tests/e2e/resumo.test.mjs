// Resumo de áudio com IA: o botão só aparece em transcrição longa; a folha avisa tudo ANTES (tamanho, Hugging Face, erra, demora) e nada é baixado sem a pessoa aceitar;
// arquivo com assinatura errada é descartado; pouca memória não tenta. (O download e o resumo de verdade, com o modelo real de 885 MB, foram conferidos à mão: não rodam no CI.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar, menuConta } from "./env.mjs";

const FALA = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "fala-pt.mp3");
let skip = configurado ? false : motivoSemConfig, browser, srv, A, nomeB; const erros = [], pedidosHf = [];
const t = (nome, fn) => test(nome, { timeout: 420000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); }
const guardados = () => A.evaluate(async () => { try { return (await (await caches.open("lacre-resumo-v1")).keys()).length; } catch { return -1; } });
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ca = await browser.newContext({ viewport: { width: 420, height: 820 } }), cb = await browser.newContext({ viewport: { width: 420, height: 820 } }); A = await ca.newPage(); const B = await cb.newPage();
  for (const p of [A, B]) { p.on("pageerror", (e) => erros.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|status of 5/.test(m.text())) erros.push(m.text().slice(0, 200)); }); }
  A.on("request", (r) => { if (/huggingface\.co|\.hf\.co/.test(r.url())) pedidosHf.push(r.url()); });
  nomeB = novoUsuario("rb"); await cadastrar(A, novoUsuario("ra")); await cadastrar(B, nomeB); await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.click("#mais"); await A.setInputFiles("#file", FALA); await A.waitForSelector("#pending-info.ok", { timeout: 30000 }); await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .media.audio", { timeout: 30000 });
  await A.click(".msg.mine .transc-btn"); await A.waitForSelector("#tr-folha[open]"); await A.click("#tr-ir"); await A.waitForSelector(".transc-saida:not([hidden]) p", { timeout: 360000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("transcrição curta não ganha o botão Resumir; com o limite baixo ele aparece", async () => {
  assert.equal(await A.locator(".msg.mine .transc-resumir").count(), 0, "um recado curto não precisa de resumo");
  await A.evaluate(() => localStorage.setItem("lacre:resumo-min", "20")); await A.locator(".transc-rod button", { hasText: "Ocultar" }).click(); await A.locator(".transc-btn").first().click();
  await A.waitForSelector(".msg.mine .transc-resumir"); assert.equal((await A.locator(".msg.mine .transc-resumir").innerText()).trim(), "Resumir");
});
t("a folha avisa tudo antes e nada é baixado até a pessoa aceitar", async () => {
  await A.click(".msg.mine .transc-resumir"); await A.waitForSelector("#rs-folha[open]"); const txt = await A.locator("#rs-folha").innerText();
  assert.match(txt, /nunca saem dele/i); assert.match(txt, /885 MB/); assert.match(txt, /Hugging Face[\s\S]*endereço de internet/); assert.match(txt, /assinatura de segurança/); assert.match(txt, /pode errar/); assert.match(txt, /demora vários minutos/);
  assert.match(await A.locator("#rs-ir").innerText(), /Baixar \(885 MB\) e resumir/); assert.equal(await A.locator("#rs-apagar").isHidden(), true);
  await A.click("#rs-fechar"); await A.waitForSelector("#rs-folha:not([open])", { state: "attached" }); assert.equal(pedidosHf.length, 0, "nenhum pedido ao Hugging Face antes de aceitar"); assert.equal(await guardados(), 0);
});
t("arquivo com assinatura errada é descartado e nada fica guardado; erro de rede também avisa", async () => {
  await A.context().route(/huggingface\.co\/.*config\.json/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "content-length": "912", "access-control-allow-origin": "*" }, body: "x".repeat(912) }));
  await A.click(".msg.mine .transc-resumir"); await A.waitForSelector("#rs-folha[open]"); await A.click("#rs-ir");
  await A.waitForFunction(() => /não passou na conferência/.test(document.querySelector("#rs-aviso").textContent), null, { timeout: 30000 }); assert.match(await A.locator("#rs-aviso").innerText(), /descartado e nada foi usado/);
  assert.ok(pedidosHf.some((u) => u.includes("79346d370dfae34801d26993fda9ae2372900fd0")), "pediu a versão fixa, não a main"); assert.ok(pedidosHf.every((u) => !/\/main\//.test(u))); assert.equal(await guardados(), 0, "nada guardado");
  assert.equal(await A.locator("#rs-ir").isDisabled(), false, "dá para tentar de novo");
  await A.context().unroute(/huggingface\.co\/.*config\.json/); await A.context().route(/huggingface\.co\/.*config\.json/, (r) => r.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, body: "erro" }));
  await A.click("#rs-ir"); await A.waitForFunction(() => /Não foi possível baixar config\.json/.test(document.querySelector("#rs-aviso").textContent), null, { timeout: 30000 }); assert.equal(await guardados(), 0);
  await A.click("#rs-fechar"); await A.waitForSelector("#rs-folha:not([open])", { state: "attached" });
});
t("aparelho com pouca memória não tenta: avisa e nem abre o download", async () => {
  await A.evaluate(() => Object.defineProperty(navigator, "deviceMemory", { value: 2, configurable: true }));
  await A.click(".msg.mine .transc-resumir"); await A.waitForFunction(() => /pouca memória/.test(document.querySelector(".msg.mine .transc-msg")?.textContent || ""), null, { timeout: 10000 }); assert.equal(await A.locator("#rs-folha").evaluate((d) => d.open), false);
  await A.evaluate(() => { delete navigator.deviceMemory; });
});
t("o site só fala com o Hugging Face depois do consentimento e o CSP continua sem script de fora", async () => {
  const csp = await A.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content"); assert.match(csp, /connect-src[^;]*https:\/\/huggingface\.co https:\/\/\*\.hf\.co/); assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/); assert.doesNotMatch(csp, /script-src[^;]*hf\.co/);
});
t("desinstalar: Armazenamento mostra o modelo instalado e o botão apaga (pede confirmação); sem modelo, o botão some", async () => {
  await A.evaluate(async () => { const c = await caches.open("lacre-resumo-v1"), tam = { "config.json": 912, "generation_config.json": 219, "tokenizer.json": 9117040, "tokenizer_config.json": 10369, "onnx/model_q4.onnx": 919096585 };
    for (const [a, n] of Object.entries(tam)) await c.put(new URL(`/__lacre_resumo__/qwen3-0.6b-q4/${a}`, location.href).href, new Response("x", { headers: { "content-length": String(n) } })); }); // (arquivos de mentira só com o tamanho certo no cabeçalho)
  await A.keyboard.press("Escape"); await A.click("#back"); await menuConta(A, "#arm-btn"); await A.waitForSelector("#armaz[open]");
  await A.waitForFunction(() => /Instalado: 885 MB/.test(document.querySelector("#arm-ia-resumo-txt").textContent), null, { timeout: 10000 }); assert.equal(await A.locator("#arm-ia-resumo-apagar").isVisible(), true);
  await A.click("#arm-ia-resumo-apagar"); await A.waitForSelector("#choice[open]"); assert.match(await A.locator("#choice").innerText(), /Nenhuma mensagem será apagada/); await A.click('#choice button[value=""]'); assert.equal(await guardados(), 5, "cancelar não apaga");
  await A.click("#arm-ia-resumo-apagar"); await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=sim]");
  await A.waitForFunction(() => /Não está instalado/.test(document.querySelector("#arm-ia-resumo-txt").textContent), null, { timeout: 10000 }); assert.equal(await A.locator("#arm-ia-resumo-apagar").isHidden(), true); assert.equal(await guardados(), 0, "apagou do aparelho");
  assert.match(await A.locator("#arm-ia-tr-txt").innerText(), /Instalado: Base/, "o modelo de transcrição usado no teste aparece"); assert.equal(await A.locator("#arm-ia-tr-apagar").isVisible(), true);
});
t("sem erros de página", () => assert.deepEqual(erros, []));
