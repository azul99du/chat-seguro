// Figurinhas: criar com recorte por cliques (desfazer), PNG transparente, animada (GIF) sem metadados, enviar, receber, salvar, recentes e apagar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";
import { hasFfmpeg, tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, dir; const erros = [], enviados = [];
const t = (nome, fn, { ffmpeg = false } = {}) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : ffmpeg && !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
async function cadastrar(page, usuario) {
  await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit");
  await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden])", { timeout: 30000 });
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
  await A.fill("#add-user", nomeB); await A.click("#add-form button"); await A.waitForSelector(`#conv-title:has-text("@${nomeB}")`);
  await A.fill("#text", "oi"); await A.click("#send-form .primary"); await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button");
});
after(async () => {
  if (!browser) return;
  for (const u of enviados) await u.page.evaluate(async ({ p, url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); if (!k) return;
    await fetch(`${url}/storage/v1/object/media/${p}`, { method: "DELETE", headers: { Authorization: "Bearer " + JSON.parse(localStorage[k]).access_token, apikey: key } }); }, { p: u.path, url: SUPABASE_URL, key: SUPABASE_KEY }).catch(() => {});
  await browser.close(); await srv.close();
});

t("gaveta vazia explica como criar; editor abre com a imagem e sem nada mantido", async () => {
  await A.click("#sticker"); await A.waitForSelector("#stk[open]"); assert.equal(await A.locator("#stk-empty").isVisible(), true); assert.equal(await A.locator("#stk-recent-sec").isVisible(), false);
  await A.setInputFiles("#stk-file", join(dir, "boneco.png")); await A.waitForSelector("#stkedit[open]");
  assert.equal(await A.locator("#stk-save").isDisabled(), true); assert.match(await A.locator("#stk-status").innerText(), /Nada mantido/);
  assert.ok((await pixel("#stk-canvas", 0.5, 0.5))[3] < 100, "tudo apagado/esmaecido no começo");
});
t("tocar mantém só a região (o resto fica esmaecido); desfazer volta; recomeçar zera", async () => {
  await tocar(0.5, 0.5); assert.match(await A.locator("#stk-status").innerText(), /1 toque/);
  assert.equal((await pixel("#stk-canvas", 0.5, 0.5))[3], 255, "boneco opaco"); assert.ok((await pixel("#stk-canvas", 0.05, 0.05))[3] < 100, "fundo esmaecido");
  assert.equal(await A.locator("#stk-save").isDisabled(), false);
  await A.click("#stk-undo"); assert.ok((await pixel("#stk-canvas", 0.5, 0.5))[3] < 100); assert.equal(await A.locator("#stk-save").isDisabled(), true);
  await tocar(0.5, 0.5); await tocar(0.05, 0.05); assert.match(await A.locator("#stk-status").innerText(), /2 toques/); // o 2º toque (fundo azul) entrou por engano...
  await A.click("#stk-undo"); assert.ok((await pixel("#stk-canvas", 0.05, 0.05))[3] < 100, "...e foi desfeito sozinho");
  await A.click("#stk-mode-del"); await tocar(0.5, 0.5); assert.ok((await pixel("#stk-canvas", 0.5, 0.5))[3] < 100, "modo Apagar tira a região"); await A.click("#stk-undo");
  assert.equal((await pixel("#stk-canvas", 0.5, 0.5))[3], 255, "desfazer o apagar traz de volta"); await A.click("#stk-mode-add");
  await A.check("#stk-preview"); assert.equal((await pixel("#stk-canvas", 0.05, 0.05))[3], 0, "prévia: fundo transparente de verdade");
});
t("salvar: a figurinha vai para 'Suas figurinhas' como PNG transparente, cortada e sem o texto escondido", async () => {
  await A.click("#stk-save"); await A.waitForSelector("#stk[open]"); await A.waitForFunction(() => document.querySelectorAll("#stk-mine .stk-item").length === 1);
  assert.match(await A.locator("#stk-count").innerText(), /^1\//);
  const r = await imagem(A, "#stk-mine img"); assert.equal(Math.max(r.w, r.h), 512, `ampliada até 512: ${r.w}x${r.h}`); assert.ok(Math.abs(r.w - r.h) <= 24, "cortada na caixa do quadrado"); assert.equal(r.canto[3], 0, "canto transparente");
  const [b] = await biblioteca(A); assert.ok(!b.texto.includes("SEGREDO")); assert.ok(b.texto.startsWith("\x89PNG")); assert.equal(b.mime, "image/png");
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
  await A.click("#sticker"); await A.waitForSelector("#stk[open]"); assert.equal(await A.locator("#stk-recent .stk-item").count(), 1);
  const antes = enviados.filter((u) => u.page === A).length; await A.click("#stk-recent .stk-item");
  await A.waitForFunction(() => document.querySelectorAll(".msg.mine .bubble.sticker").length === 2, null, { timeout: 30000 }); await B.waitForFunction(() => document.querySelectorAll(".msg:not(.mine) .bubble.sticker").length === 2, null, { timeout: 30000 });
  assert.equal(enviados.filter((u) => u.page === A).length, antes, "aproveitou o arquivo já enviado");
});
t("B salva a figurinha recebida; ela continua lá depois de recarregar a página", async () => {
  await B.locator(".bubble.sticker .stk-save").first().click(); await B.waitForFunction(() => /Salva/.test(document.querySelector(".bubble.sticker .stk-save").textContent));
  await B.locator(".bubble.sticker .stk-save").nth(1).click(); await B.waitForFunction(() => /já tem/i.test(document.querySelectorAll(".bubble.sticker .stk-save")[1].textContent), null, { timeout: 15000 });
  await B.reload(); await B.waitForSelector("#chat:not([hidden])", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector("#send-form:not([hidden])");
  await B.click("#sticker"); await B.waitForSelector("#stk[open]"); assert.equal(await B.locator("#stk-mine .stk-item").count(), 1); assert.equal(await B.locator("#stk-recent-sec").isVisible(), false, "salva mas nunca usada: não é recente");
  await B.click("#stk-close");
});
t("animada (GIF com comentário): vai direto para a lista, sai sem o comentário e continua animada", async () => {
  const gif = gifTeste(dir); await A.click("#sticker"); await A.waitForSelector("#stk[open]");
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
  const m = B.locator(".msg:not(.mine):has(.bubble.sticker)").first(); await m.hover(); await m.locator(".react-btn").click(); await B.locator(".picker .responder").click();
  assert.equal(await B.locator("#reply-text").innerText(), "Figurinha");
  await B.fill("#text", "kkk"); await B.click("#send-form .primary"); await A.waitForSelector('.msg:not(.mine):has(.vis:text-is("kkk")) .quote .q-text:text-is("Figurinha")', { timeout: 30000 });
});
t("apagar: pede confirmação, remove só da lista e não mexe nas mensagens já enviadas", async () => {
  await A.click("#sticker"); await A.waitForSelector("#stk[open]"); await A.click("#stk-manage"); await A.locator("#stk-mine .stk-item").first().click();
  await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=nao]"); assert.equal(await A.locator("#stk-mine .stk-item").count(), 2, "cancelar mantém");
  await A.locator("#stk-mine .stk-item").first().click(); await A.waitForSelector("#choice[open]"); await A.click("#choice button[value=sim]");
  await A.waitForFunction(() => document.querySelectorAll("#stk-mine .stk-item").length === 1); await A.click("#stk-close");
  assert.ok((await A.locator(".msg.mine .bubble.sticker").count()) >= 3);
});
t("importar vários: pronta (transparente) entra direto; foto abre o editor; 'tirar fundo' e pincel; recorte pequeno é ampliado", async () => {
  await A.click("#sticker"); await A.waitForSelector("#stk[open]"); const antes = await A.locator("#stk-mine .stk-item").count();
  await A.setInputFiles("#stk-file", [join(dir, "pronta.png"), join(dir, "boneco.png")]); await A.waitForSelector("#stkedit[open]");
  await A.click("#stk-auto"); assert.equal((await pixel("#stk-canvas", 0.5, 0.5))[3], 255, "boneco mantido"); assert.ok((await pixel("#stk-canvas", 0.05, 0.05))[3] < 100, "fundo tirado");
  await A.click("#stk-undo"); assert.equal(await A.locator("#stk-save").isDisabled(), true, "desfazer o automático zera");
  await A.click("#stk-auto"); await A.click("#stk-mode-erase"); const b = await A.locator("#stk-canvas").boundingBox();
  await A.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5); await A.mouse.down(); await A.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 4 }); await A.mouse.up();
  assert.ok((await pixel("#stk-canvas", 0.55, 0.5))[3] < 100, "o pincel − apagou um pedaço"); await A.click("#stk-undo"); assert.equal((await pixel("#stk-canvas", 0.55, 0.5))[3], 255, "uma pincelada = um desfazer");
  await A.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.45); await A.mouse.down(); await A.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.45, { steps: 3 }); await A.mouse.up(); // um corte a mais, para não repetir a figurinha de antes
  await A.click("#stk-save"); await A.waitForSelector("#stk[open]"); await A.waitForFunction((n) => document.querySelectorAll("#stk-mine .stk-item").length === n, antes + 2);
  const lib = await biblioteca(A); const grande = lib.find((x) => x.w === 512 || x.h === 512); assert.ok(grande, "o recorte pequeno foi ampliado até 512");
  assert.ok(lib.some((x) => x.w === 120 && x.h === 80), "a figurinha pronta manteve o tamanho (sem recortar nem ampliar)");
  await A.click("#stk-close");
});
t("limite: arquivo que não é imagem é recusado com aviso", async () => {
  await A.click("#sticker"); await A.waitForSelector("#stk[open]"); writeFileSync(join(dir, "x.txt"), "oi"); await A.setInputFiles("#stk-file", join(dir, "x.txt"));
  await A.waitForSelector("#note[open]"); assert.match(await A.locator("#note-text").innerText(), /imagem/i);
});
t("nenhum erro de script durante o fluxo", () => { assert.deepEqual(erros, []); });
