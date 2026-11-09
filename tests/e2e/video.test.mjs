// Vídeo no app: comprime no aparelho (720p) antes de enviar, mostra o progresso, dá para cancelar; o amigo recebe e toca; cache de vídeo pequeno.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";
import { hasFfmpeg, tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, video; const erros = [], dir = tmp();
const t = (nome, fn) => test(nome, { timeout: 180000 }, async (c) => (skip ? c.skip(skip) : !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: "pipe" });
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
before(async () => {
  if (skip || !hasFfmpeg()) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  video = join(dir, "grande.mp4"); ff("-f", "lavfi", "-i", "testsrc2=duration=6:size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=duration=6", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "14M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "location=+12.3456-045.6789/", video);
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  A = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage(); B = await (await browser.newContext({ viewport: { width: 1100, height: 780 } })).newPage();
  for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => erros.push(`${n}: ${e.message}`));
  const nomeB = novoUsuario("b"); await cadastrar(A, novoUsuario("a")); await cadastrar(B, nomeB); await chamar(A, nomeB); await A.waitForSelector("#send-form:not([hidden])");
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("cancelar durante a compressão: nada fica pendente e nada é enviado", async () => {
  await A.setInputFiles("#file", video); await A.waitForFunction(() => /Comprimindo vídeo/.test(document.getElementById("pending-info")?.textContent || ""), null, { timeout: 15000 });
  await A.click("#pending-x"); await A.waitForSelector("#pending", { state: "hidden" }); await A.waitForTimeout(1500);
  assert.equal(await A.locator("#pending").isHidden(), true, "continua sem anexo"); assert.equal(await A.locator(".msg.mine").count(), 0, "nada foi enviado");
});
t("enviar: mostra o progresso, termina como 'comprimido de X', e o amigo recebe, toca e vê em 720p", async () => {
  await A.setInputFiles("#file", video); await A.waitForSelector("#pending-info.ok", { timeout: 90000 });
  const info = await A.locator("#pending-info").innerText(); assert.match(info, /comprimido de \d+(\.\d+)? MB · metadados removidos/, info);
  const [novo, antigo] = [...info.matchAll(/(\d+(?:\.\d+)?) (KB|MB)/g)].map((m) => Number(m[1]) * (m[2] === "MB" ? 1024 : 1)); assert.ok(novo < antigo * 0.5, `menor que a metade: ${info}`);
  await A.fill("#text", "vídeo comprimido"); await A.click("#send-form .primary");
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
  const bloco = B.locator(".msg:not(.mine) .media button.ph"); await bloco.waitFor({ timeout: 30000 }); await bloco.click();
  await B.waitForSelector(".msg:not(.mine) .media video", { timeout: 30000 });
  await B.waitForFunction(() => { const v = document.querySelector(".msg:not(.mine) .media video"); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  assert.deepEqual(await B.evaluate(() => { const v = document.querySelector(".msg:not(.mine) .media video"); return [v.videoWidth, v.videoHeight, Math.round(v.duration)]; }), [1280, 720, 6]);
});
t("vídeo que coube no limite de 8 MB fica no cache: ao recarregar já aparece pronto (sem baixar de novo)", async () => {
  const gets = []; B.on("request", (r) => { if (r.method() === "GET" && /\/storage\/v1\/object\/(authenticated\/)?media\//.test(r.url())) gets.push(r.url()); });
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.click("#contacts button");
  const bloco = B.locator(".msg:not(.mine) .media button.ph"); await bloco.waitFor({ timeout: 30000 }); const antes = gets.length; await bloco.click();
  await B.waitForSelector(".msg:not(.mine) .media video", { timeout: 30000 }); assert.equal(gets.length, antes, "nenhum download: veio do aparelho");
});
t("sem erros de JavaScript", () => assert.deepEqual(erros, []));
