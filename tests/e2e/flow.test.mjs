// Conversa de ponta a ponta no navegador (Chromium) com duas pessoas, contra um projeto Supabase de teste.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";
import { hasFfmpeg, tmp, makeVideo, makeJpegWithExif } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig;
let browser, srv, A, B, ctxA, ctxB, N, dirFix, foto, video, nomeB, emailA, nomeA;
const enviados = [], erros = [];
// "skip" só é conhecido depois do before(): por isso a decisão é tomada dentro de cada teste
const t = (nome, fn, opts = {}) => test(nome, { timeout: 120000 }, async (ctx) => {
  const motivo = skip || (opts.ffmpeg && !hasFfmpeg() && "ffmpeg não instalado");
  if (motivo) return ctx.skip(motivo);
  return fn(ctx);
});
const textos = (p) => p.locator(".msg .vis").allInnerTexts().then((l) => l.filter((x) => x.trim()));
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const vista = (p, txt, timeout = 25000) => p.waitForSelector(`.msg:not(.mine) .vis:has-text("${txt}")`, { timeout });

async function cadastrar(page, usuario, email) {
  await page.goto(srv.url); await page.click("#tab-signup");
  await page.fill("#username", usuario); await page.fill("#email", email); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 });
  await page.fill("#ask-input", "curta"); await page.click("#ask button[value=ok]");
  await page.waitForSelector("#ask[open] #ask-text:has-text('pelo menos 16')");               // frase curta é recusada
  await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]");
  await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome} pageerror: ${e.message} @ ${(e.stack || "").split("\n").slice(1, 4).join(" | ")}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome} console: ${m.text().slice(0, 200)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}

before(async () => {
  if (skip) return;
  const s = await cadastroFunciona();
  if (!s.ok) { skip = s.motivo; console.warn(`::warning::testes de navegador pulados: ${s.motivo}`); return; }
  srv = await servir(prepararSite());
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = () => browser.newContext({ viewport: { width: 1100, height: 780 } });
  ctxA = await novo(); ctxB = await novo(); A = await ctxA.newPage(); B = await ctxB.newPage(); vigiar("A", A); vigiar("B", B);
  dirFix = tmp(); if (hasFfmpeg()) { foto = makeJpegWithExif(dirFix); video = makeVideo(dirFix, "video.mp4"); }
  emailA = novoEmail(); nomeA = novoUsuario("a"); nomeB = novoUsuario("b");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) for (const pg of [u.page, N].filter(Boolean)) // apaga os arquivos de teste do storage, como dono
    await pg.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
      await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); },
      { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("cadastro de duas pessoas: frase-senha curta é recusada, chat abre", async () => {
  await cadastrar(A, nomeA, emailA); await cadastrar(B, nomeB, novoEmail());
});
t("A adiciona B pelo nome exato e vê B online (canal privado de presença)", async () => {
  await A.waitForTimeout(1500);
  await chamar(A, nomeB);
  await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.waitForSelector("#conv-status:not([hidden])", { timeout: 20000 });
  assert.equal(await A.locator("#contacts .avatar.on").count(), 1);
});
t("tempo real com sigilo futuro: ida e volta de 6 mensagens, 'vista' em tempo real", async () => {
  await enviar(A, "oi bob, segredo número um");
  await B.waitForSelector("#contacts button .unread", { timeout: 25000 }); await B.click("#contacts button");
  await vista(B, "segredo número um");
  await enviar(B, "oi alice, resposta dois"); await vista(A, "resposta dois");
  for (let i = 3; i <= 6; i++) { const [de, para] = i % 2 ? [A, B] : [B, A]; await enviar(de, "mensagem " + i); await vista(para, "mensagem " + i); }
  await A.waitForSelector(".msg.mine .rcpt.read", { timeout: 20000 });
});
t("código de segurança é igual nos dois aparelhos", async () => {
  const ler = async (p) => { await p.click("#safety-btn"); await p.waitForSelector("#safety[open]"); const c = (await p.locator("#safety-code").innerText()).replace(/\s+/g, " ").trim(); await p.click("#safety button[value=ok]"); return c; };
  const [ca, cb] = [await ler(A), await ler(B)];
  assert.match(ca, /^(\d{5} ?){12}$/); assert.equal(ca, cb);
});
t("reação chega (como mensagem cifrada), não vira balão, e pode ser removida", async () => {
  await B.locator(".msg:not(.mine) .bubble").first().click({ button: "right" }); await B.click(".picker .emojis button:nth-child(2)");
  await A.waitForSelector(".msg.mine .chip:has-text('❤️')", { timeout: 25000 });
  assert.equal((await textos(A)).length, 6);
  await B.click(".msg .chip.mine");
  await A.waitForFunction(() => document.querySelectorAll(".msg .chip").length === 0, null, { timeout: 25000 });
});
t("foto: metadados (EXIF/GPS/modelo) são removidos, a rotação é aplicada e o amigo recebe", async () => {
  const bytes = [...readFileSync(foto)];
  assert.ok(readFileSync(foto).toString("latin1").includes("SEGREDOMAKE"), "a foto de teste precisa ter o EXIF");
  const r = await A.evaluate(async (b) => { const { cleanImage } = await import("/media.js"); const o = await cleanImage(new File([new Uint8Array(b)], "x.jpg", { type: "image/jpeg" })); return { w: o.w, h: o.h, mime: o.mime, b: Array.from(o.bytes) }; }, bytes);
  const txt = Buffer.from(r.b).toString("latin1");
  assert.ok(!/Exif|SEGREDO|GPS/.test(txt), "nenhum metadado pode sobrar");
  assert.ok(r.w < r.h && r.mime === "image/jpeg", `orientação 6 aplicada (${r.w}x${r.h})`);
  await A.setInputFiles("#file", foto); await A.waitForSelector("#pending-info.ok", { timeout: 25000 });
  await enviar(A, "foto com sigilo futuro");
  await B.waitForSelector(".msg:not(.mine) .media img", { timeout: 30000 });
  assert.ok(await B.evaluate(() => { const i = document.querySelector(".msg:not(.mine) .media img"); return i.naturalWidth > 0 && i.naturalWidth < i.naturalHeight; }));
}, { ffmpeg: true });
t("vídeo: o amigo só baixa ao tocar; toca; e o arquivo no servidor é cifrado", async () => {
  const guardados = [];
  A.on("response", async (r) => { if (r.request().method() === "GET" && /\/storage\/v1\/object\/(authenticated\/)?media\//.test(r.url())) guardados.push(await r.body().catch(() => null)); });
  await B.setInputFiles("#file", video); await B.waitForSelector("#pending-info.ok", { timeout: 25000 }); await B.click("#send-form .primary");
  await A.waitForSelector(".msg:not(.mine) .media button.ph", { timeout: 30000 });
  await A.click(".msg:not(.mine) .media button.ph");
  await A.waitForFunction(() => { const v = document.querySelector(".msg:not(.mine) video"); return v && v.readyState >= 1; }, null, { timeout: 30000 });
  const [w, d] = await A.evaluate(() => { const v = document.querySelector(".msg:not(.mine) video"); return [v.videoWidth, Math.round(v.duration)]; });
  assert.deepEqual([w, d], [320, 2]);
  for (let i = 0; i < 50 && !guardados.filter(Boolean).length; i++) await A.waitForTimeout(100); // o corpo da resposta chega de forma assíncrona
  const bin = guardados.filter(Boolean); assert.ok(bin.length > 0, "nenhum arquivo do storage foi capturado");
  for (const b of bin) assert.ok(!(b[0] === 0xff && b[1] === 0xd8) && !b.includes(Buffer.from("ftyp")), "o servidor guarda só bytes cifrados");
}, { ffmpeg: true });
t("fundo da conversa: aplica, persiste ao recarregar e é pessoal (B não vê)", async () => {
  await A.click("#bg-btn"); await A.waitForSelector("#bgdlg[open]");
  const [fc] = await Promise.all([A.waitForEvent("filechooser"), A.click("#bg-pick")]); await fc.setFiles(foto || join(dirFix, "raw.jpg"));
  await A.waitForFunction(() => document.getElementById("messages").classList.contains("has-bg"), null, { timeout: 30000 });
  assert.equal(await B.evaluate(() => document.getElementById("messages").classList.contains("has-bg")), false);
}, { ffmpeg: true });
t("recarregar: histórico (enviado e recebido) volta do aparelho, sem balões de erro", async () => {
  await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await A.waitForSelector("#contacts button"); await A.click("#contacts button");
  await A.waitForSelector(".msg .media img", { timeout: 30000 });
  const h = await textos(A);
  for (const x of ["oi bob, segredo número um", "oi alice, resposta dois", "mensagem 3", "mensagem 6", "foto com sigilo futuro"]) assert.ok(h.includes(x), x);
  assert.equal(await A.locator(".bubble.err").count(), 0);
  await A.waitForFunction(() => document.getElementById("messages").classList.contains("has-bg"), null, { timeout: 30000 }); // fundo voltou
}, { ffmpeg: true });
t("duas abas do mesmo usuário: a trava impede avançar a chave em dobro", async () => {
  const A2 = await ctxA.newPage(); vigiar("A2", A2); await A2.goto(srv.url); await A2.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await A2.click("#contacts button");
  await A2.waitForSelector(".msg", { timeout: 30000 });
  await enviar(B, "para as duas abas"); await vista(A, "para as duas abas"); await vista(A2, "para as duas abas");
  assert.equal((await textos(A2)).filter((x) => x === "para as duas abas").length, 1);
  await enviar(A2, "mandei da aba 2"); await vista(B, "mandei da aba 2");
  await enviar(A, "mandei da aba 1"); await vista(B, "mandei da aba 1");
  await A2.close();
});
t("chave do amigo diferente da fixada: alerta e a conversa NÃO abre", async () => {
  const k = await A.evaluate(() => Object.keys(localStorage).find((x) => x.startsWith("pin:")));
  await A.evaluate((key) => localStorage.setItem(key, "0000deadbeef"), k); await A.reload();
  await A.waitForSelector("#contacts button", { timeout: 30000 }); await A.click("#contacts button");
  await A.waitForSelector("#choice[open]"); assert.match(await A.locator("#choice-title").innerText(), /mudou/);
  await A.click("#choice button[value=no]"); await A.waitForTimeout(300);
  assert.equal(await A.locator("#messages .msg").count(), 0);
  await A.evaluate((key) => localStorage.removeItem(key), k); // restaura (será fixada de novo)
});
t("aparelho novo: mensagens antigas com sigilo futuro ficam indisponíveis; a sessão é refeita sozinha e as próximas chegam", async () => {
  const cn = await browser.newContext({ viewport: { width: 1100, height: 780 } }); N = await cn.newPage(); vigiar("N", N);
  await N.goto(srv.url); await N.fill("#email", emailA); await N.fill("#password", SENHA); await N.click("#auth-submit");
  await N.waitForSelector("#ask[open]", { timeout: 30000 });
  await N.fill("#ask-input", "frase-errada-qualquer"); await N.click("#ask button[value=ok]"); await N.waitForSelector("#ask-text:has-text('incorreta')");
  await N.fill("#ask-input", FRASE); await N.click("#ask button[value=ok]"); await N.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
  await N.waitForTimeout(1500); await chamar(N, nomeB);
  await N.waitForSelector(`#conv-title:has-text("@${nomeB}")`); await N.waitForSelector(".bubble.err", { timeout: 30000 });
  await N.waitForFunction(() => document.querySelectorAll(".bubble.err").length >= 5, null, { timeout: 30000 }); // a lista carrega em sequência
  await B.waitForTimeout(3000); await enviar(B, "depois de refazer a sessão");
  await vista(N, "depois de refazer a sessão", 40000);
  await enviar(N, "respondendo do aparelho novo"); await vista(B, "respondendo do aparelho novo");
});
t("avisos automáticos de outro aparelho MEU não viram balão de erro: só a mensagem de verdade aparece (com o texto que ensina a importar o histórico)", async () => {
  await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await A.click("#contacts button"); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.waitForSelector(".bubble.err", { timeout: 20000 }); await A.waitForTimeout(800);
  // (a resposta do amigo, feita já na sessão nova, também não abre neste aparelho: é a mesma limitação, mas é uma mensagem de verdade dele)
  assert.equal(await A.locator(".msg.mine .bubble.err").count(), 1, "o 'hello' do outro aparelho some; só 'respondendo do aparelho novo' (uma mensagem real minha) aparece como indisponível");
  assert.match(await A.locator(".msg.mine .bubble.err").first().innerText(), /exporte o histórico de lá e importe aqui/);
});
t("anônimo não entra no canal privado de presença", async () => {
  const r = await A.evaluate(async ({ url, key }) => {
    const { createClient } = await import("/vendor/supabase.js"); const c = createClient(url, key, { auth: { persistSession: false } });
    return new Promise((res) => { let fim = false; const ch = c.channel("online", { config: { private: true } }); const to = setTimeout(() => { if (!fim) { fim = true; res("timeout"); } }, 8000);
      ch.subscribe((s) => { if (fim || !["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) return; fim = true; clearTimeout(to); res(s); setTimeout(() => c.removeChannel(ch), 0); }); }); // fim evita recursão: removeChannel dispara CLOSED
  }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.notEqual(r, "SUBSCRIBED");
});
t("layout: a página nunca cresce; só a lista de mensagens rola", async () => {
  if (await A.locator("#send-form").isHidden()) { await A.click("#contacts button"); await A.waitForSelector("#send-form:not([hidden])"); }
  for (let i = 0; i < 20; i++) await enviar(A, "enchimento " + i);
  await A.waitForTimeout(800);
  const l = await A.evaluate(() => ({ w: innerHeight, d: document.scrollingElement.scrollHeight, c: Math.round(document.getElementById("chat").getBoundingClientRect().height), rola: document.getElementById("messages").scrollHeight > document.getElementById("messages").clientHeight }));
  assert.ok(l.d <= l.w && l.c === l.w && l.rola, JSON.stringify(l));
  await A.setViewportSize({ width: 1100, height: 500 }); await A.waitForTimeout(200);
  assert.equal(await A.evaluate(() => Math.round(document.getElementById("chat").getBoundingClientRect().height)), 500);
});
t("sair e apagar chaves limpa o aparelho", async () => {
  await menuConta(B, "#logout"); await B.waitForSelector("#choice[open]"); await B.click("#choice button[value=wipe]"); await B.waitForSelector("#auth:not([hidden])", { timeout: 15000 });
  const n = await B.evaluate(() => new Promise((r) => { const q = indexedDB.open("chat-seguro"); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").count(); g.onsuccess = () => r(g.result); }; }));
  assert.equal(n, 0);
});
t("nenhum erro de JavaScript nem violação da política de segurança durante todo o fluxo", async () => {
  assert.deepEqual(erros, []);
});
