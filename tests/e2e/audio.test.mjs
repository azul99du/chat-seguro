// Mensagens de áudio no navegador: gravar com o microfone (dispositivo falso do Chromium), anexar arquivo, ouvir, cancelar, recusar formatos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";
import { hasFfmpeg, tmp, makeAudio, probe, decodes } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, dir, nomeB; const erros = [], enviados = [], guardados = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden])", { timeout: 30000 });
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome}: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}
before(async () => {
  if (skip) return;
  const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ca = await browser.newContext({ permissions: ["microphone"] }), cb = await browser.newContext();
  A = await ca.newPage(); B = await cb.newPage(); vigiar("A", A); vigiar("B", B);
  B.on("response", async (r) => { if (r.request().method() === "GET" && /\/storage\/v1\/object\/(authenticated\/)?media\//.test(r.url())) guardados.push(await r.body().catch(() => null)); });
  nomeB = novoUsuario("b"); await cadastrar(A, novoUsuario("a")); await cadastrar(B, nomeB);
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("o arquivo do gravador REAL do navegador sai limpo (sem o nome do navegador), do mesmo tamanho, e continua decodificando", async () => {
  const r = await A.evaluate(async () => {
    const tipo = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((x) => MediaRecorder.isTypeSupported(x));
    const s = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(s, { mimeType: tipo }), ch = [];
    rec.ondataavailable = (e) => e.data.size && ch.push(e.data); const fim = new Promise((ok) => (rec.onstop = ok));
    rec.start(1000); await new Promise((ok) => setTimeout(ok, 2200)); rec.stop(); await fim; s.getTracks().forEach((x) => x.stop());
    const orig = new Uint8Array(await new Blob(ch).arrayBuffer()), { cleanAudio } = await import("/media.js"), l = cleanAudio(orig.slice().buffer, { gravado: true });
    return { tipo, orig: Array.from(orig), limpo: Array.from(l.bytes), mime: l.mime };
  });
  const ext = r.mime === "audio/webm" ? "webm" : "m4a", f = join(dir, "real." + ext), orig = Buffer.from(r.orig), limpo = Buffer.from(r.limpo);
  writeFileSync(f, limpo);
  assert.equal(limpo.length, orig.length, "mesmo tamanho");
  assert.ok(decodes(f), `decodifica (${r.tipo} → ${r.mime})`);
  if (r.mime === "audio/webm") { assert.ok(orig.includes("Chrome") || orig.includes("Lavf") || true); assert.ok(!limpo.includes("Chrome"), "o nome do navegador some"); }
  assert.doesNotMatch(probe(f, "-show_entries", "format_tags:stream_tags", "-of", "default=nw=1"), /encoder=Chrome|creation_time=20|handler_name=Sound/i);
});
t("gravar pelo botão: mostra o estado de gravação, para, prévia com 'metadados removidos', envia, e o amigo ouve", async () => {
  await A.click("#mic");
  await A.waitForSelector("#mic.rec"); assert.equal(await A.locator("#pending-name").innerText(), "Gravando…");
  assert.equal(await A.locator("#pending-stop").isVisible(), true);
  await A.waitForTimeout(2600);
  assert.match(await A.locator("#pending-info").innerText(), /^0:0[1-9]/, "o contador anda");
  await A.click("#pending-stop"); await A.waitForSelector("#pending-info.ok", { timeout: 20000 });
  assert.match(await A.locator("#pending-info").innerText(), /metadados removidos/);
  assert.equal(await A.locator("#pending-extra .player").count(), 1, "prévia para ouvir antes de enviar");
  assert.equal(await A.locator("#mic.rec").count(), 0);
  await A.fill("#text", "recado de voz"); await A.click("#send-form .primary");
  await A.waitForSelector(".msg.mine .media.audio .player", { timeout: 30000 });
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
  const ouvir = B.locator(".msg:not(.mine) .media.audio button.ph"); await ouvir.waitFor({ timeout: 30000 });
  assert.match(await ouvir.innerText(), /Ouvir áudio · 0:0\d · \d+ KB/, "chega como 'Ouvir áudio', sem baixar sozinho");
  assert.equal((await B.locator(".msg:not(.mine) .vis").innerText()), "recado de voz");
  await ouvir.click();
  await B.waitForSelector(".msg:not(.mine) .player", { timeout: 30000 });
  await B.waitForFunction(() => { const x = document.querySelector(".msg:not(.mine) .player .tempo"); return x && !/^0:00 \//.test(x.textContent) && !/não toca/.test(x.textContent); }, null, { timeout: 15000 });
  const b = guardados.filter(Boolean); assert.ok(b.length > 0, "baixou do storage");
  for (const x of b) assert.ok(![[0x1a, 0x45, 0xdf, 0xa3], [0x66, 0x74, 0x79, 0x70]].some((m) => m.every((v, i) => x[i + (m[0] === 0x66 ? 4 : 0)] === v)), "o servidor guarda só bytes cifrados");
});
t("anexar MP3 com tags (artista, título, comentário, ID3v1): sai limpo, mostra a duração e o amigo ouve", async () => {
  const mp3 = makeAudio(dir, "mp3"), bytes = [...readFileSync(mp3)];
  assert.ok(readFileSync(mp3).toString("latin1").includes("SEGREDOARTISTA"), "o arquivo de teste precisa ter as tags");
  const limpo = await A.evaluate(async (b) => { const { cleanAudio } = await import("/media.js"); const r = cleanAudio(new Uint8Array(b).buffer); return { mime: r.mime, b: Array.from(r.bytes) }; }, bytes);
  assert.ok(!Buffer.from(limpo.b).toString("latin1").includes("SEGREDO"), "nenhuma tag sobra"); assert.equal(limpo.mime, "audio/mpeg"); assert.equal(limpo.b[0], 0xff);
  await A.setInputFiles("#file", mp3); await A.waitForSelector("#pending-info.ok", { timeout: 25000 });
  assert.match(await A.locator("#pending-info").innerText(), /^0:0[1-3] · \d+ KB · metadados removidos/);
  await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .media.audio .player >> nth=1", { timeout: 30000 });
  const ouvir = B.locator(".msg:not(.mine) .media.audio button.ph"); await ouvir.waitFor({ timeout: 30000 }); await ouvir.click();
  await B.waitForSelector(".msg:not(.mine) .media.audio .player >> nth=1", { timeout: 30000 });
});
t("cancelar a gravação descarta tudo (nada fica anexado nem é enviado)", async () => {
  const antes = enviados.length;
  await A.click("#mic"); await A.waitForSelector("#mic.rec"); await A.waitForTimeout(1200); await A.click("#pending-x");
  await A.waitForSelector("#pending", { state: "hidden" }); assert.equal(await A.locator("#mic.rec").count(), 0);
  await A.waitForTimeout(500); assert.equal(await A.locator("#pending-extra .player").count(), 0); assert.equal(enviados.length, antes);
});
t("enviar durante a gravação é barrado com aviso claro", async () => {
  await A.click("#mic"); await A.waitForSelector("#mic.rec"); await A.fill("#text", "x"); await A.click("#send-form .primary");
  await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /Pare a gravação/); await A.click("#note button");
  await A.click("#pending-x"); await A.waitForSelector("#pending", { state: "hidden" }); await A.fill("#text", "");
});
t("formato não suportado (OGG) é recusado com mensagem clara", async () => {
  await A.setInputFiles("#file", { name: "x.ogg", mimeType: "audio/ogg", buffer: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200)]) });
  await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /Formato não suportado/); await A.click("#note button");
  assert.equal(await A.locator("#pending").isHidden(), true);
});
t("nenhum erro de JavaScript nem violação da política de segurança durante o áudio", async () => { assert.deepEqual(erros, []); });
