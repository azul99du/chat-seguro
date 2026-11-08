// Figurinhas: criar com recorte por cliques (desfazer), PNG transparente, animada (GIF) sem metadados, enviar, receber, salvar, recentes e apagar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, menuConta, chamar } from "./env.mjs";
import { hasFfmpeg, tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, dir; const erros = [], enviados = [];
const t = (nome, fn, { ffmpeg = false, timeout = 120000 } = {}) => test(nome, { timeout }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
}
function vigiar(nome, page) {
  page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(`${nome}: ${m.text().slice(0, 160)}`); });
  page.on("request", (r) => { const m = r.url().match(/\/storage\/v1\/object\/media\/(.+)$/); if (m && r.method() === "POST") enviados.push({ page, path: decodeURIComponent(m[1]) }); });
}
// PNG 120x80: fundo azul, quadrado vermelho no meio, com um texto escondido (tEXt) que NÃO pode sair na figurinha
function pngTeste(transparente = false) {
  const W = 120, H = 80, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 4 + 1) + 1 + x * 4, dentro = x >= 40 && x < 80 && y >= 20 && y < 60, v = dentro ? [220, 30, 30] : [30, 60, 200]; raw.set([...v, transparente && !dentro ? 0 : 255], o); }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const ch = (tp, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(tp), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("tEXt", Buffer.from("Comment\0SEGREDO-FIGURINHA")), ch("IDAT", deflateSync(raw)), ch("IEND", Buffer.alloc(0))]);
}
// GIF animado (ffmpeg) com um comentário escondido logo depois da paleta global
function gifTeste(d) {
  const f = join(d, "anim.gif"); execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5", "-t", "1", "-y", f]);
  const g = readFileSync(f), off = 13 + (g[10] & 0x80 ? 3 * 2 ** ((g[10] & 7) + 1) : 0), txt = Buffer.from("SEGREDO-GIF-GPS");
  const com = Buffer.concat([Buffer.from([0x21, 0xfe, txt.length]), txt, Buffer.from([0])]);
  const out = join(d, "anim-com.gif"); writeFileSync(out, Buffer.concat([g.subarray(0, off), com, g.subarray(off)])); return out;
}
const pixel = (sel, xf, yf) => A.evaluate(({ sel, xf, yf }) => { const c = document.querySelector(sel), d = c.getContext("2d").getImageData(Math.floor(c.width * xf), Math.floor(c.height * yf), 1, 1).data; return [...d]; }, { sel, xf, yf });
const tocar = async (xf, yf) => { const b = await A.locator("#stk-canvas").boundingBox(); await A.mouse.click(b.x + b.width * xf, b.y + b.height * yf); };
// biblioteca de figurinhas de uma página, lida do armazenamento local (já decifrada): bytes como texto, tipo e tamanho
const biblioteca = (p) => p.evaluate(async () => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), uid = JSON.parse(localStorage[k]).user.id;
  const st = await import("./store.js"); return (await st.listStickers(uid)).map((s) => ({ id: s.id, mime: s.mime, w: s.w, h: s.h, anim: s.anim, texto: Array.from(s.bytes, (x) => String.fromCharCode(x)).join("") })); });
// tamanho e pixel do canto de uma <img> da tela (desenhada num canvas)
const imagem = (p, sel) => p.evaluate((sel) => { const i = document.querySelector(sel), c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d").drawImage(i, 0, 0);
  return { w: i.naturalWidth, h: i.naturalHeight, canto: [...c.getContext("2d").getImageData(0, 0, 1, 1).data] }; }, sel);

before(async () => {
  if (skip) return;
  const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); dir = tmp(); writeFileSync(join(dir, "boneco.png"), pngTeste()); writeFileSync(join(dir, "pronta.png"), pngTeste(true));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const [ca, cb] = [await browser.newContext({ viewport: { width: 1100, height: 800 } }), await browser.newContext({ viewport: { width: 1100, height: 800 } })];
  A = await ca.newPage(); B = await cb.newPage(); vigiar("A", A); vigiar("B", B);
  nomeA = novoUsuario("a"); nomeB = novoUsuario("b"); await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.fill("#text", "oi"); await A.click("#send-form .primary"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

const abrirFig = async (p) => { await p.click("#mais"); await p.click("#sticker"); };
const resultado = () => A.waitForFunction(() => { const o = document.getElementById("stk-out"); return o && !o.hidden; }, null, { timeout: 200000 });
t("gaveta vazia explica como criar; editor abre com a foto, sem recorte e sem pontos", async () => {
  await abrirFig(A); await A.waitForSelector("#stk[open]"); assert.equal(await A.locator("#stk-empty").isVisible(), true); assert.equal(await A.locator("#stk-recent-sec").isVisible(), false);
  await A.setInputFiles("#stk-file", join(dir, "boneco.png")); await A.waitForSelector("#stkedit[open]");
  assert.equal(await A.locator("#stk-save").isDisabled(), true); assert.match(await A.locator("#stk-info").innerText(), /^0 pontos/);
  assert.equal(await A.locator("#stk-out").isHidden(), true); assert.equal(await A.locator("#stk-cor, #stk-mode-add, #stk-mode-brush, #stk-holes").count(), 0, "os modos antigos (Manter/Apagar/Pincel) foram removidos");
});
t("SAM 2.1 no aparelho: tocar recorta (contorno branco, fundo transparente); tocar no ponto o remove; limpar zera", async () => {
  await tocar(0.5, 0.5); await A.waitForFunction(() => /^1 ponto/.test(document.getElementById("stk-info").textContent)); await resultado();
  assert.equal(await A.locator("#stk-save").isDisabled(), false); assert.equal(await A.locator("#stk-out").evaluate((c) => [c.width, c.height].join("x")), "512x512");
  assert.equal((await pixel("#stk-out", 0.01, 0.01))[3], 0, "canto transparente"); assert.equal((await pixel("#stk-out", 0.5, 0.5))[3], 255, "miolo opaco");
  await tocar(0.5, 0.5); await A.waitForFunction(() => /^0 pontos/.test(document.getElementById("stk-info").textContent)); assert.equal(await A.locator("#stk-save").isDisabled(), true, "sem pontos não salva");
  await tocar(0.5, 0.5); await tocar(0.65, 0.6); await A.waitForFunction(() => /^2 pontos/.test(document.getElementById("stk-info").textContent));
  await A.click("#stk-clear"); assert.match(await A.locator("#stk-info").innerText(), /^0 pontos/); assert.equal(await A.locator("#stk-clear").isDisabled(), true);
  await tocar(0.5, 0.5); await resultado();
  const foto = await A.locator("#stk-canvas").evaluate((c) => ({ ar: c.width / c.height, css: c.getBoundingClientRect() }));
  assert.ok(Math.abs(foto.css.width / foto.css.height - foto.ar) < 0.02, "a foto não pode aparecer esticada: proporção na tela = proporção da imagem");
  const url = () => A.locator("#stk-out").evaluate((c) => c.toDataURL()); const comContorno = await url();
  await A.uncheck("#stk-contorno"); await A.waitForFunction((u) => document.getElementById("stk-out").toDataURL() !== u, comContorno); const semContorno = await url();
  await A.check("#stk-contorno"); await A.waitForFunction((u) => document.getElementById("stk-out").toDataURL() !== u, semContorno); assert.equal(await url(), comContorno, "ligar de novo volta ao resultado com contorno");
  const recursos = await A.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name));
  assert.ok(recursos.some((u) => u.endsWith("vision_encoder_int8.onnx")) && recursos.some((u) => u.endsWith("ort.wasm.min.mjs")), "modelo e programa vieram do próprio site");
  assert.ok(recursos.every((u) => !/^https?:\/\/(?!127\.0\.0\.1|[a-z0-9]+\.supabase\.co|fonts\.g)/.test(u)), "nada de servidor de terceiros");
}, { timeout: 420000 });
t("ponto vermelho (botão de setas): sozinho avisa, com um verde tira partes; o botão volta ao verde", async () => {
  await A.click("#stk-clear"); assert.equal(await A.locator("#stk-modo").getAttribute("data-modo"), "verde"); assert.match(await A.locator("#stk-modo-txt").innerText(), /verde: manter/);
  await A.click("#stk-modo"); assert.equal(await A.locator("#stk-modo").getAttribute("data-modo"), "vermelho"); assert.match(await A.locator("#stk-modo-txt").innerText(), /vermelho: remover/);
  await tocar(0.2, 0.2); await A.waitForFunction(() => /^1 ponto \(0 verdes, 1 vermelho\)/.test(document.getElementById("stk-info").textContent));
  await A.waitForFunction(() => /primeiro no que quer manter/.test(document.getElementById("stk-msg").textContent)); assert.equal(await A.locator("#stk-save").isDisabled(), true, "só vermelho não gera recorte");
  const cor = await pixel("#stk-canvas", 0.25, 0.2); assert.ok(cor[0] > 180 && cor[1] < 90 && cor[2] < 90, `o ponto é vermelho: ${cor}`);
  await A.click("#stk-modo"); assert.equal(await A.locator("#stk-modo").getAttribute("data-modo"), "verde");
  await tocar(0.5, 0.5); await A.waitForFunction(() => /^2 pontos \(1 verde, 1 vermelho\)/.test(document.getElementById("stk-info").textContent)); await resultado();
  await A.click("#stk-clear"); await tocar(0.5, 0.5); await resultado(); // deixa um recorte pronto para salvar
}, { timeout: 420000 });
t("salvar: vai para 'Suas figurinhas' como WebP 512x512 de até 100 KB, transparente e sem o texto escondido", async () => {
  await A.click("#stk-save"); await A.waitForSelector("#stk[open]"); await A.waitForFunction(() => document.querySelectorAll("#stk-mine .stk-item").length === 1);
  assert.match(await A.locator("#stk-count").innerText(), /^1\//);
  const r = await imagem(A, "#stk-mine img"); assert.equal(r.w, 512); assert.equal(r.h, 512); assert.equal(r.canto[3], 0, "canto transparente");
  const [b] = await biblioteca(A); assert.ok(!b.texto.includes("SEGREDO")); assert.equal(b.mime, "image/webp"); assert.ok(b.texto.startsWith("RIFF") && b.texto.slice(8, 12) === "WEBP"); assert.ok(b.texto.length <= 100 * 1024, `${b.texto.length} bytes`);
});
t("enviar: A vê a figurinha sem balão; B recebe, com o canto transparente e botão de salvar", async () => {
  await A.click("#stk-mine .stk-item"); await A.waitForSelector("#stk", { state: "hidden" });
  await A.waitForSelector(".msg.mine .bubble.sticker img", { timeout: 30000 }); await B.waitForSelector(".msg:not(.mine) .bubble.sticker img", { timeout: 30000 });
  const r = await imagem(B, ".bubble.sticker img"); assert.equal(r.canto[3], 0);
  assert.equal(await B.locator(".bubble.sticker .stk-save").isVisible(), true); assert.equal(await A.locator(".bubble.sticker .stk-save").count(), 0, "a minha não tem botão de salvar");
  assert.equal(await B.locator(".bubble.sticker").evaluate((e) => getComputedStyle(e).backgroundColor), "rgba(0, 0, 0, 0)", "sem fundo de balão");
  assert.match(await B.locator(".bubble.sticker .sr").innerText(), /Figurinha enviada/);
});
t("recentes: aparecem depois do uso; reenviar a mesma figurinha ao mesmo amigo não sobe outro arquivo", async () => {
  await abrirFig(A); await A.waitForSelector("#stk[open]"); assert.equal(await A.locator("#stk-recent .stk-item").count(), 1);
  const antes = enviados.filter((u) => u.page === A).length; await A.click("#stk-recent .stk-item");
  await A.waitForFunction(() => document.querySelectorAll(".msg.mine .bubble.sticker").length === 2, null, { timeout: 30000 }); await B.waitForFunction(() => document.querySelectorAll(".msg:not(.mine) .bubble.sticker").length === 2, null, { timeout: 30000 });
  assert.equal(enviados.filter((u) => u.page === A).length, antes, "aproveitou o arquivo já enviado");
});
t("B salva a figurinha recebida; ela continua lá depois de recarregar a página", async () => {
  await B.locator(".bubble.sticker .stk-save").first().click(); await B.waitForFunction(() => /Salva/.test(document.querySelector(".bubble.sticker .stk-save").textContent));
  await B.locator(".bubble.sticker .stk-save").nth(1).click(); await B.waitForFunction(() => /já tem/i.test(document.querySelectorAll(".bubble.sticker .stk-save")[1].textContent), null, { timeout: 15000 });
  await B.reload(); await B.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector("#send-form:not([hidden])");
  await abrirFig(B); await B.waitForSelector("#stk[open]"); assert.equal(await B.locator("#stk-mine .stk-item").count(), 1); assert.equal(await B.locator("#stk-recent-sec").isVisible(), false, "salva mas nunca usada: não é recente");
  await B.click("#stk-close");
});
t("animada (GIF com comentário): vai direto para a lista, sai sem o comentário e continua animada", async () => {
  const gif = gifTeste(dir); await abrirFig(A); await A.waitForSelector("#stk[open]");
  await A.setInputFiles("#stk-file", gif); await A.waitForFunction(() => document.querySelectorAll("#stk-mine .stk-item").length === 2, null, { timeout: 20000 });
  assert.equal(await A.locator("#stkedit[open]").count(), 0, "sem editor para animadas");
  const item = A.locator('#stk-mine img[alt="Figurinha animada"]'); await item.click(); await A.waitForSelector("#stk", { state: "hidden" });
  await B.waitForFunction(() => document.querySelectorAll(".msg:not(.mine) .bubble.sticker").length === 3, null, { timeout: 30000 });
  await B.waitForSelector(".msg:not(.mine):last-of-type .bubble.sticker img", { timeout: 30000 });
  const r = await imagem(B, ".msg:not(.mine):last-of-type .bubble.sticker img"); assert.equal(r.w, 64);
  const g = (await biblioteca(A)).find((x) => x.anim); assert.ok(g.texto.startsWith("GIF8")); assert.ok(!g.texto.includes("SEGREDO"), "comentário removido"); assert.equal(g.mime, "image/gif");
  assert.ok((g.texto.match(/\x21\xf9\x04/g) || []).length >= 2, "os quadros e tempos continuam lá");
});
t("responder a uma figurinha mostra 'Figurinha' na citação", async () => {
  const m = B.locator(".msg:not(.mine):has(.bubble.sticker)").first(); await m.locator(".bubble").first().click({ button: "right" }); await B.locator(".picker .responder").click();
  assert.equal(await B.locator("#reply-text").innerText(), "Figurinha");
  await B.fill("#text", "kkk"); await B.click("#send-form .primary"); await A.waitForSelector('.msg:not(.mine):has(.vis:text-is("kkk")) .quote .q-text:text-is("Figurinha")', { timeout: 30000 });
});
t("apagar: pede confirmação, remove só da lista e não mexe nas mensagens já enviadas", async () => {
  await abrirFig(A); await A.waitForSelector("#stk[open]"); await A.click("#stk-manage"); await A.locator("#stk-mine .stk-item").first().click();
  await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=nao]"); assert.equal(await A.locator("#stk-mine .stk-item").count(), 2, "cancelar mantém");
  await A.locator("#stk-mine .stk-item").first().click(); await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=sim]");
  await A.waitForFunction(() => document.querySelectorAll("#stk-mine .stk-item").length === 1); await A.click("#stk-close");
  assert.ok((await A.locator(".msg.mine .bubble.sticker").count()) >= 3);
});
t("importar vários: figurinha pronta (transparente) entra direto; foto abre o editor e 'Cancelar' volta para a gaveta", async () => {
  await abrirFig(A); await A.waitForSelector("#stk[open]"); const antes = await A.locator("#stk-mine .stk-item").count();
  await A.setInputFiles("#stk-file", [join(dir, "pronta.png"), join(dir, "boneco.png")]); await A.waitForSelector("#stkedit[open]");
  await A.click("#stk-skip"); await A.waitForSelector("#stk[open]"); await A.waitForFunction((n) => document.querySelectorAll("#stk-mine .stk-item").length === n, antes + 1);
  const lib = await biblioteca(A); assert.ok(lib.some((x) => x.w === 120 && x.h === 80 && x.mime === "image/png"), "a pronta manteve o tamanho e o formato (sem recortar)");
  await A.click("#stk-close");
});
t("limite: arquivo que não é imagem é recusado com aviso", async () => {
  await abrirFig(A); await A.waitForSelector("#stk[open]"); writeFileSync(join(dir, "x.txt"), "oi"); await A.setInputFiles("#stk-file", join(dir, "x.txt"));
  await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /imagem/i);
});
t("nenhum erro de script durante o fluxo", () => { assert.deepEqual(erros, []); });
