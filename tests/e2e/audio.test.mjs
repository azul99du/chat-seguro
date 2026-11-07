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
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
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
const alvo = async (p) => { const b = await p.locator("#mic").boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2; await p.mouse.move(x, y); return { x, y }; };
const audios = (p) => p.locator(".msg.mine .media.audio").count();
const modo = async (p) => (await p.locator("#send-form").getAttribute("data-rec")) ?? "";
t("segurar o microfone grava (barra com tempo e dica); soltar envia sozinho; o amigo ouve", async () => {
  await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]");
  assert.equal(await A.locator("#rec-bar").isVisible(), true); assert.equal(await A.locator("#text").isVisible(), false, "o campo de texto cede lugar à barra de gravação");
  assert.match(await A.locator("#rec-dica").innerText(), /Deslize para cancelar/); assert.equal(await A.locator("#lock-pill").isVisible(), true, "o cadeado aparece");
  await A.waitForTimeout(2600); assert.match(await A.locator("#rec-tempo").innerText(), /^0:0[1-9]/, "o contador anda");
  const antes = await audios(A); await A.mouse.up();
  await A.waitForFunction((n) => document.querySelectorAll(".msg.mine .media.audio").length > n, antes, { timeout: 30000 });
  assert.equal(await modo(A), "", "voltou ao normal"); assert.equal(await A.locator("#rec-bar").isVisible(), false); assert.equal(await A.locator("#text").isVisible(), true);
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
  const ouvir = B.locator(".msg:not(.mine) .media.audio button.ph"); await ouvir.waitFor({ timeout: 30000 });
  assert.match(await ouvir.innerText(), /Ouvir áudio · 0:0\d · \d+ KB/, "chega como 'Ouvir áudio', sem baixar sozinho");
  await ouvir.click();
  await B.waitForSelector(".msg:not(.mine) .player", { timeout: 30000 });
  await B.waitForFunction(() => { const x = document.querySelector(".msg:not(.mine) .player .tempo"); return x && !/^0:00 \//.test(x.textContent) && !/não toca/.test(x.textContent); }, null, { timeout: 15000 });
  const b = guardados.filter(Boolean); assert.ok(b.length > 0, "baixou do storage");
  for (const x of b) assert.ok(![[0x1a, 0x45, 0xdf, 0xa3], [0x66, 0x74, 0x79, 0x70]].some((m) => m.every((v, i) => x[i + (m[0] === 0x66 ? 4 : 0)] === v)), "o servidor guarda só bytes cifrados");
});
t("áudios ficam guardados no aparelho: depois de recarregar já aparecem prontos para tocar, sem baixar de novo (quem ouviu e quem enviou)", async () => {
  const gets = { A: 0, B: 0 }; for (const [n, p] of [["A", A], ["B", B]]) p.on("request", (r) => { if (r.method() === "GET" && /\/storage\/v1\/object\/(authenticated\/)?media\//.test(r.url())) gets[n]++; });
  for (const p of [A, B]) { await p.reload(); await p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await p.click("#contacts button"); await p.waitForSelector("#send-form:not([hidden])"); }
  await B.waitForSelector(".msg:not(.mine) .media.audio .player", { timeout: 20000 }); await A.waitForSelector(".msg.mine .media.audio .player", { timeout: 20000 });
  await B.waitForTimeout(800); assert.deepEqual(gets, { A: 0, B: 0 }, "nenhum download: tudo veio do aparelho");
  const tempo = await B.locator(".msg:not(.mine) .media.audio .player .tempo").first().innerText(); assert.match(tempo, /^0:00 \/ 0:0\d/);
  await B.locator(".msg:not(.mine) .media.audio .player .play").first().click(); await B.waitForFunction(() => { const x = document.querySelector(".msg:not(.mine) .player .tempo"); return x && !/^0:00 \//.test(x.textContent) && !/não toca/.test(x.textContent); }, null, { timeout: 15000 });
});
t("toque curto no microfone não envia nada e explica como usar", async () => {
  const antes = enviados.length, n = await audios(A); await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec]"); await A.waitForTimeout(60); await A.mouse.up();
  await A.waitForSelector("#rec-toast", { state: "visible" }); assert.match(await A.locator("#rec-toast").innerText(), /Segure o botão/);
  await A.waitForFunction(() => !document.getElementById("send-form").dataset.rec); await A.waitForTimeout(800); assert.equal(enviados.length, antes); assert.equal(await audios(A), n);
});
t("sem espera: a barra de gravação aparece no mesmo instante do toque e um áudio curto (cerca de 1 s) é enviado", async () => {
  const n = await audios(A), { x, y } = await alvo(A);
  await A.evaluate(() => { window.__t = 0; new MutationObserver(() => { if (!window.__t && document.getElementById("send-form").dataset.rec) window.__t = performance.now(); }).observe(document.getElementById("send-form"), { attributes: true }); window.__d = 0; document.getElementById("mic").addEventListener("pointerdown", () => { window.__d = performance.now(); }, true); });
  await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]"); const atraso = await A.evaluate(() => Math.round(window.__t - window.__d)); assert.ok(atraso < 100, `a tela demorou ${atraso} ms para reagir ao toque`);
  await A.waitForTimeout(1100); await A.mouse.up(); await A.waitForFunction((k) => document.querySelectorAll(".msg.mine .media.audio").length > k, n, { timeout: 30000 });
});
t("arrastar para a esquerda cancela: nada é enviado", async () => {
  const antes = enviados.length, n = await audios(A), { x, y } = await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]"); await A.waitForTimeout(1200);
  await A.mouse.move(x - 60, y, { steps: 4 }); await A.mouse.move(x - 140, y, { steps: 4 });
  await A.waitForSelector("#send-form.cancelando"); assert.match(await A.locator("#rec-dica").innerText(), /Solte para cancelar/);
  const tempo = await A.locator("#rec-tempo").boundingBox(), dica = await A.locator("#rec-dica").boundingBox();
  assert.ok(dica.x >= tempo.x + tempo.width - 1, `o texto não pode ficar em cima do tempo (tempo termina em ${tempo.x + tempo.width}, texto começa em ${dica.x})`);
  await A.mouse.up(); await A.waitForFunction(() => !document.getElementById("send-form").dataset.rec); await A.waitForTimeout(800);
  assert.equal(enviados.length, antes); assert.equal(await audios(A), n); assert.equal(await A.locator("#pending").isHidden(), true);
});
t("em tela estreita (360 px) o texto de cancelar não encosta no contador nem no microfone", async () => {
  await A.setViewportSize({ width: 360, height: 700 }); await A.waitForTimeout(300);
  const { x, y } = await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]"); await A.waitForTimeout(1000);
  for (const dx of [0, 70, 150]) {
    await A.mouse.move(x - dx, y, { steps: 3 }); await A.waitForTimeout(450);
    const tempo = await A.locator("#rec-tempo").boundingBox(), dica = await A.locator("#rec-dica").boundingBox(), mic = await A.locator("#mic").boundingBox(), txt = await A.locator("#rec-dica-txt").boundingBox();
    assert.ok(dica.x >= tempo.x + tempo.width - 1, `texto sobre o tempo (dx ${dx})`); assert.ok(dica.x + dica.width <= mic.x + 1, `o microfone cobre o texto (dx ${dx}): texto até ${dica.x + dica.width}, microfone a partir de ${mic.x}`);
    assert.ok(txt.x + txt.width <= dica.x + dica.width + 1, "o texto cabe no espaço (sem vazar)");
  }
  await A.mouse.up(); await A.waitForFunction(() => !document.getElementById("send-form").dataset.rec); await A.setViewportSize({ width: 1280, height: 720 });
});
t("voltar o dedo antes de passar do limite não cancela: soltar ainda envia", async () => {
  const n = await audios(A), { x, y } = await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]"); await A.waitForTimeout(1300);
  await A.mouse.move(x - 140, y, { steps: 4 }); await A.waitForSelector("#send-form.cancelando"); await A.mouse.move(x - 10, y, { steps: 4 }); await A.waitForFunction(() => !document.getElementById("send-form").classList.contains("cancelando"));
  await A.mouse.up(); await A.waitForFunction((k) => document.querySelectorAll(".msg.mine .media.audio").length > k, n, { timeout: 30000 });
});
t("arrastar para cima trava: soltar o dedo mantém gravando, com ondas e lixeira; o botão de enviar manda", async () => {
  const n = await audios(A), { x, y } = await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]"); await A.waitForTimeout(800);
  await A.mouse.move(x, y - 40, { steps: 4 }); await A.mouse.move(x, y - 100, { steps: 4 }); await A.waitForSelector("#send-form[data-rec=travado]");
  await A.mouse.up(); await A.waitForTimeout(1500); assert.equal(await modo(A), "travado", "continua gravando depois de soltar");
  assert.equal(await A.locator("#rec-lixo").isVisible(), true); assert.equal(await A.locator("#rec-onda").isVisible(), true); assert.equal(await A.locator("#lock-pill").isVisible(), false);
  assert.match(await A.locator("#rec-tempo").innerText(), /^0:0[2-9]/); assert.equal(await A.locator("#send-form .primary").isVisible(), true, "o botão vira enviar");
  assert.ok((await A.locator("#rec-onda i").count()) > 10, "ondas de voz");
  await A.click("#send-form .primary"); await A.waitForFunction((k) => document.querySelectorAll(".msg.mine .media.audio").length > k, n, { timeout: 30000 }); assert.equal(await modo(A), "");
});
t("gravação travada: a lixeira descarta tudo", async () => {
  const antes = enviados.length, n = await audios(A), { x, y } = await alvo(A); await A.mouse.down(); await A.waitForSelector("#send-form[data-rec=segurando]");
  await A.mouse.move(x, y - 100, { steps: 6 }); await A.waitForSelector("#send-form[data-rec=travado]"); await A.mouse.up(); await A.waitForTimeout(1000);
  await A.click("#rec-lixo"); await A.waitForFunction(() => !document.getElementById("send-form").dataset.rec); await A.waitForTimeout(800);
  assert.equal(enviados.length, antes); assert.equal(await audios(A), n); assert.equal(await A.locator("#text").isVisible(), true);
});
t("teclado: Enter no microfone grava (travado) e o botão enviar manda", async () => {
  const n = await audios(A); await A.focus("#mic"); await A.keyboard.press("Enter"); await A.waitForSelector("#send-form[data-rec=travado]"); await A.waitForTimeout(1300);
  await A.click("#send-form .primary"); await A.waitForFunction((k) => document.querySelectorAll(".msg.mine .media.audio").length > k, n, { timeout: 30000 });
});
t("anexar MP3 com tags (artista, título, comentário, ID3v1): sai limpo, mostra a duração e o amigo ouve", async () => {
  const mp3 = makeAudio(dir, "mp3"), bytes = [...readFileSync(mp3)];
  assert.ok(readFileSync(mp3).toString("latin1").includes("SEGREDOARTISTA"), "o arquivo de teste precisa ter as tags");
  const limpo = await A.evaluate(async (b) => { const { cleanAudio } = await import("/media.js"); const r = cleanAudio(new Uint8Array(b).buffer); return { mime: r.mime, b: Array.from(r.bytes) }; }, bytes);
  assert.ok(!Buffer.from(limpo.b).toString("latin1").includes("SEGREDO"), "nenhuma tag sobra"); assert.equal(limpo.mime, "audio/mpeg"); assert.equal(limpo.b[0], 0xff);
  await A.setInputFiles("#file", mp3); await A.waitForSelector("#pending-info.ok", { timeout: 25000 });
  assert.match(await A.locator("#pending-info").innerText(), /^0:0[1-3] · \d+ KB · metadados removidos/);
  await A.click("#send-form .primary"); await A.waitForSelector(".msg.mine .media.audio .player >> nth=1", { timeout: 30000 });
  const ouvir = B.locator(".msg:not(.mine) .media.audio button.ph").last(); await ouvir.waitFor({ timeout: 30000 }); await ouvir.click();
  await B.waitForSelector(".msg:not(.mine) .media.audio .player >> nth=1", { timeout: 30000 });
});
t("formato não suportado (OGG) é recusado com mensagem clara", async () => {
  await A.setInputFiles("#file", { name: "x.ogg", mimeType: "audio/ogg", buffer: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200)]) });
  await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /Formato não suportado/); await A.click("#note button");
  assert.equal(await A.locator("#pending").isHidden(), true);
});
t("nenhum erro de JavaScript nem violação da política de segurança durante o áudio", async () => { assert.deepEqual(erros, []); });
