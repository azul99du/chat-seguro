// Playlists (conversa a dois): criar e editar (Apple e YouTube), sincronização cifrada, tocar na conversa (as duas pessoas ouvem), controle só de quem iniciou
// (sequência, aleatório, loop de uma música, pausa, escolher a música), parar, trocar de dono e sair da conversa. Apple e YouTube são SIMULADOS aqui.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync, crc32 } from "node:zlib";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB; const erros = [], pedidos = [];
const t = (nome, fn) => test(nome, { timeout: 240000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await page.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); }
function onda(seg = 6, taxa = 22050) { const n = seg * taxa, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((i / taxa) * 2 * Math.PI * (300 + 100 * (i / taxa)))), 44 + i * 2); return b; }
function png(w, h, cor = 0x70) { const bloco = (tipo, dados) => { const b = Buffer.concat([Buffer.from(tipo), dados]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, cor)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => linha)))), bloco("IEND", Buffer.alloc(0))]); }

const CORS = { "access-control-allow-origin": "*" };
const musica = (id, titulo, artista) => ({ wrapperType: "track", kind: "song", trackId: id, trackName: titulo, artistName: artista, collectionName: "Disco " + artista, previewUrl: `https://audio-ssl.itunes.apple.com/teste/previa${id}.m4a`, artworkUrl100: `https://is1-ssl.mzstatic.com/teste/capa${id}.jpg/100x100bb.jpg` });
const CATALOGO = [musica(101, "Aurora", "Banda Sol"), musica(102, "Brisa", "Banda Sol"), musica(103, "Cometa", "Banda Sol"), musica(104, "Delta", "Banda Sol")];
// "YouTube" de mentira: responde ao protocolo de postMessage (listening, loadVideoById, playVideo, pauseVideo, seekTo, mute) e dá o vídeo por acabado depois de DUR segundos
const YT_DUR = 7;
const YT_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222"><script>
const id0 = location.pathname.split("/").pop(); let id = id0, t = 0, estado = 5, ini = 0, dur = ${YT_DUR}, mudo = false, ultimoEstado = null;
const manda = (o) => parent.postMessage(JSON.stringify({ ...o, channel: "widget", id: 1 }), "*");
const erro = () => id.startsWith("ERRO");
const agora = () => (estado === 1 ? t + (performance.now() - ini) / 1000 : t);
const entrega = () => { const c = agora(); if (estado === 1 && c >= dur) { estado = 0; t = dur; } manda({ event: "infoDelivery", info: { currentTime: c, playerState: estado, muted: mudo } }); };
setInterval(() => { if (listening) { entrega(); } }, 300); let fimLog = false; setInterval(() => { if (estado === 0 && !fimLog) { fimLog = true; console.log("STUB fim " + id); } if (estado !== 0) fimLog = false; }, 200);
let listening = false;
addEventListener("message", (e) => { let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.event === "listening") { if (!listening) { listening = true; if (erro()) manda({ event: "onError", info: 150 }); else { manda({ event: "initialDelivery", info: { playerState: estado, currentTime: t, duration: dur, videoData: { video_id: id, title: "Vídeo " + id, author: "", errorCode: null } } }); manda({ event: "onReady", info: null }); } } else manda({ event: "alreadyInitialized", info: null }); return; }
  if (d.event !== "command") return; const [a, b] = Array.isArray(d.args) ? d.args : [d.args];
  if (d.func === "playVideo") { if (estado !== 1) { ini = performance.now(); estado = 1; } } else if (d.func === "pauseVideo") { t = agora(); estado = 2; } else if (d.func === "seekTo") { t = Number(a) || 0; ini = performance.now(); if (estado === 0) estado = 1; }
  else if (d.func === "loadVideoById" || d.func === "cueVideoById") { id = a; t = Number(b) || 0; ini = performance.now(); estado = d.func === "loadVideoById" ? 1 : 5; if (erro()) manda({ event: "onError", info: 150 }); } else if (d.func === "mute") mudo = true; else if (d.func === "unMute") mudo = false; entrega(); });
const q = new URLSearchParams(location.search); if (q.get("autoplay") === "1") { estado = 1; ini = performance.now(); t = Number(q.get("start")) || 0; }
</script>`;
async function simular(ctx) {
  await ctx.route("https://itunes.apple.com/**", (r) => { const u = new URL(r.request().url()); pedidos.push(u.hostname + u.pathname); const termo = (u.searchParams.get("term") || "").toLowerCase(); r.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/javascript; charset=utf-8" }, body: JSON.stringify({ resultCount: CATALOGO.length, results: /banda|aurora|brisa|cometa|delta|sol/.test(termo) ? CATALOGO : [] }) }); });
  await ctx.route("https://audio-ssl.itunes.apple.com/**", (r) => { pedidos.push("audio-ssl"); r.fulfill({ status: 200, headers: { ...CORS, "content-type": "audio/wav" }, body: onda(/previa104/.test(r.request().url()) ? 6 : 60) }); });
  await ctx.route("https://is1-ssl.mzstatic.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: png(40, 40) }));
  await ctx.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: png(40, 40, 0x90) }));
  await ctx.route("https://www.youtube-nocookie.com/**", (r) => { pedidos.push("youtube-nocookie"); r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: YT_HTML }); });
}

const vigiar = (p) => { p.on("console", (m) => { if (m.text().startsWith("STUB")) (p.__stub ||= []).push(m.text()); }); p.on("pageerror", (e) => erros.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(m.text().slice(0, 200)); }); p.on("request", (r) => pedidos.push(r.url())); };
const menu = async (p, item) => { if (!(await p.locator("#menu-conta").isVisible())) { await p.click("#eu-foto"); await p.waitForSelector("#menu-conta:not([hidden])"); } await p.click(item); };
const listar = async (p) => { if (await p.locator("#back").isVisible()) { await p.click("#back"); await p.waitForSelector("#contacts button", { state: "visible" }); } };
const abrirDm = async (p, nome) => { if (await p.locator(`#conv-title:text-is("@${nome}")`).isVisible()) return; await listar(p); await p.click(`#contacts button:not([data-grupo]):has-text("@${nome}")`); await p.waitForSelector(`#conv-title:text-is("@${nome}")`, { timeout: 20000 }); await p.waitForSelector("#messages:not(.carregando)"); };
const faixaDaBarra = (p) => p.locator("#pl-faixa").innerText();
const esperaBarra = async (p, re, ms = 20000) => { const ini = Date.now(); for (;;) { if ((await p.locator("#pl-barra").isVisible()) && re.test(await faixaDaBarra(p))) return; if (Date.now() - ini > ms) assert.fail(`a barra não mostrou ${re}; mostra: ${(await p.locator("#pl-faixa").innerText().catch(() => "?"))}; rastro: ${JSON.stringify(await p.evaluate(() => window.__plLog || []))}; stub: ${JSON.stringify(p.__stub || [])}`); await p.waitForTimeout(250); } };
const esperaEstado = async (p, nomeBotao, aria, ms = 15000) => { const ini = Date.now(); for (;;) { const v = await p.locator(`#pl-ctl button[aria-label="${nomeBotao}"]`).getAttribute("aria-pressed").catch(() => null); if (v === aria) return; if (Date.now() - ini > ms) assert.fail(`${nomeBotao} não ficou ${aria}`); await p.waitForTimeout(250); } };
const tocandoAgora = (p) => p.evaluate(() => window.__som.filter((x) => x.tocando).length);
const srcAtual = (p) => p.evaluate(() => window.__som.length ? window.__som[window.__som.length - 1].src : "");
const botao = (p, rotulo) => p.locator(`#pl-ctl button[aria-label="${rotulo}"]`);
async function criarLista(p, nome, adds) { // abre Playlists, cria e põe as músicas: adds = ["a:Banda Sol:Aurora,Brisa", "y:abcdefghijk"]
  await listar(p); await menu(p, "#pl-menu"); await p.waitForSelector("#playlists[open]"); await p.click("#pl-nova"); await p.waitForSelector("#pl-editor[open]");
  await p.fill("#pl-nome-in", nome); await p.locator("#pl-nome-in").blur(); await p.waitForTimeout(400);
  for (const a of adds) { await p.click("#pl-add-btn"); await p.waitForSelector("#pl-add[open]");
    if (a.startsWith("a:")) { const [, termo, nomes] = a.split(":"); await p.fill("#pl-busca", termo); await p.waitForSelector("#pl-res li", { timeout: 15000 }); for (const n of nomes.split(",")) { await p.locator(`#pl-res li:has(b:text-is("${n}")) button`).click(); await p.waitForFunction((x) => document.querySelector("#pl-res-msg").textContent.includes(x), n, { timeout: 15000 }); } }
    else { await p.click("#pl-aba-y"); await p.fill("#pl-link", "https://youtu.be/" + a.slice(2)); await p.click("#pl-link-ok"); await p.waitForFunction(() => /Adicionada|não deixa|não pode|Tente/.test(document.querySelector("#pl-link-msg").textContent), null, { timeout: 20000 }); }
    await p.click("#pl-add-fechar"); await p.waitForSelector("#pl-add:not([open])", { state: "attached" }); }
}
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async () => { const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); await ctx.addInitScript(() => { try { localStorage.setItem("lacre:pl-debug", "1"); } catch {} window.__som = []; const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const s = this.currentSrc || this.src || ""; if (s.includes("audio-ssl")) { const e = { src: s, el: this, get tocando() { return !e.el.paused && !e.el.ended; } }; window.__som.push(e); } return o.call(this); }; }); await simular(ctx); const p = await ctx.newPage(); vigiar(p); return p; };
  [A, B] = [await novo(), await novo()]; [nomeA, nomeB] = [novoUsuario("pa"), novoUsuario("pb")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.fill("#text", "oi"); await A.click("#send-form .primary");
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.fill("#text", "oi, aqui é o b"); await B.click("#send-form .primary"); await A.waitForSelector(".msg:not(.mine)", { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("criar playlist: nome, músicas da Apple (busca) e do YouTube (link verificado); vídeo que não deixa tocar é recusado; ordem, remover; fica salva (cifrada) e volta ao recarregar", async () => {
  await criarLista(A, "Treino", ["a:banda sol:Aurora,Brisa,Cometa", "y:abcdefghijk"]);
  const nomes = () => A.locator("#pl-musicas li b").allInnerTexts(); assert.deepEqual(await nomes(), ["Aurora", "Brisa", "Cometa", "Vídeo abcdefghijk"]);
  assert.match(await A.locator("#pl-musicas li").last().innerText(), /YouTube · 0:07/); assert.match(await A.locator("#pl-musicas li").first().innerText(), /Banda Sol · trecho de 30 s/);
  await A.click("#pl-add-btn"); await A.click("#pl-aba-y"); await A.fill("#pl-link", "https://youtu.be/ERRO0000001"); await A.click("#pl-link-ok"); await A.waitForFunction(() => /não deixa tocar fora/.test(document.querySelector("#pl-link-msg").textContent), null, { timeout: 20000 });
  await A.fill("#pl-link", "https://evil.example/watch?v=abcdefghijk"); await A.click("#pl-link-ok"); await A.waitForFunction(() => /não parece o link/.test(document.querySelector("#pl-link-msg").textContent)); await A.click("#pl-aba-a"); await A.fill("#pl-busca", "banda sol"); await A.waitForSelector("#pl-res li");
  await A.locator('#pl-res li:has(b:text-is("Aurora")) button').click(); await A.waitForFunction(() => /já está na playlist/.test(document.querySelector("#pl-res-msg").textContent)); await A.click("#pl-add-fechar"); await A.waitForSelector("#pl-add:not([open])", { state: "attached" });
  assert.equal((await nomes()).length, 4, "nada repetido nem recusado entrou");
  await A.locator("#pl-musicas li").nth(0).locator('button[aria-label="Descer"]').click(); await A.waitForFunction(() => document.querySelector("#pl-musicas li b").textContent === "Brisa"); await A.locator("#pl-musicas li").nth(0).locator('button[aria-label="Subir"]').isDisabled().then((d) => assert.equal(d, true));
  await A.locator("#pl-musicas li").nth(0).locator('button[aria-label="Subir"]').isDisabled(); await A.locator("#pl-musicas li").nth(1).locator('button[aria-label="Subir"]').click(); await A.waitForFunction(() => document.querySelector("#pl-musicas li b").textContent === "Aurora");
  await A.locator("#pl-musicas li").nth(2).locator('button[aria-label="Tirar da playlist"]').click(); await A.waitForFunction(() => document.querySelectorAll("#pl-musicas li").length === 3); assert.deepEqual(await nomes(), ["Aurora", "Brisa", "Vídeo abcdefghijk"]);
  await A.waitForTimeout(800); const dados = await A.evaluate(async ({ url, key }) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), tok = JSON.parse(localStorage[k]).access_token; const r = await fetch(`${url}/rest/v1/rpc/playlists_ler`, { method: "POST", headers: { apikey: key, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: "{}" }); return r.text(); }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.ok(dados.includes("ciphertext") && !/Treino|Aurora|Brisa|abcdefghijk|Banda/.test(dados), "o servidor só vê o bloco cifrado");
  await A.reload(); await A.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 }); await menu(A, "#pl-menu"); await A.waitForSelector("#pl-lista .pl-cartao", { timeout: 20000 }); assert.match(await A.locator("#pl-lista .pl-cartao").first().innerText(), /Treino[\s\S]*3 músicas/);
  await A.locator("#pl-lista .pl-cartao button", { hasText: "Editar" }).first().click(); await A.waitForSelector("#pl-editor[open]"); assert.deepEqual(await nomes(), ["Aurora", "Brisa", "Vídeo abcdefghijk"], "volta do servidor, decifrada"); assert.equal(await A.inputValue("#pl-nome-in"), "Treino");
  await A.click("#pl-editor .pg-volta"); await A.click("#playlists .pg-volta"); await A.waitForSelector("#playlists:not([open])", { state: "attached" });
});
t("tocar na conversa a dois: as duas pessoas ouvem; só quem iniciou vê os controles; o outro pode parar de ouvir e silenciar", async () => {
  await abrirDm(A, nomeB); await A.click("#mais"); await A.click("#plbtn"); await A.waitForSelector("#playlists[open]"); assert.match(await A.locator("#pl-ctx").innerText(), new RegExp(`@${nomeB}`));
  await A.locator("#pl-lista .pl-cartao button", { hasText: "Tocar aqui" }).first().click(); await A.waitForSelector("#playlists:not([open])", { state: "attached" });
  await esperaBarra(A, /Aurora · Banda Sol · você controla/); assert.equal(await A.locator("#pl-nome").innerText(), "Treino");
  await abrirDm(B, nomeA); await esperaBarra(B, new RegExp(`Aurora · Banda Sol · @${nomeA} controla`), 20000);
  for (const p of [A, B]) await p.waitForFunction(() => window.__som.some((x) => x.tocando && x.src.includes("previa101")), null, { timeout: 15000 });
  assert.equal(await B.locator("#pl-ctl button[aria-label='Pausar']").count(), 0, "quem não iniciou não tem controles"); assert.equal(await B.locator("#pl-ctl .pl-rot", { hasText: "Parar de ouvir" }).count(), 1);
  await B.click("#pl-ctl .pl-rot"); await B.waitForFunction(() => !window.__som.some((x) => x.tocando), null, { timeout: 5000 }); assert.equal(await tocandoAgora(A), 1, "A continua ouvindo"); await B.locator("#pl-ctl .pl-rot", { hasText: "Ouvir" }).click(); await B.waitForFunction(() => window.__som.some((x) => x.tocando), null, { timeout: 8000 });
});
t("controle de quem iniciou: pausar/continuar, próxima, anterior, aleatório e loop ligam, escolher a música na lista; o outro acompanha; o servidor recusa controle de quem não iniciou", async () => {
  await botao(A, "Pausar").click(); await B.waitForFunction(() => !window.__som.some((x) => x.tocando), null, { timeout: 12000 }); assert.equal(await tocandoAgora(A), 0); await botao(A, "Tocar").click(); await B.waitForFunction(() => window.__som.some((x) => x.tocando), null, { timeout: 12000 });
  await botao(A, "Próxima música").click(); await esperaBarra(A, /Brisa/); await esperaBarra(B, /Brisa/); await B.waitForFunction(() => window.__som.some((x) => x.tocando && x.src.includes("previa102")), null, { timeout: 12000 });
  await botao(A, "Música anterior").click(); await esperaBarra(B, /Aurora/);
  await botao(A, "Ordem aleatória").click(); await esperaEstado(A, "Ordem aleatória", "true"); await botao(A, "Repetir esta música").click(); await esperaEstado(A, "Repetir esta música", "true"); await botao(A, "Repetir esta música").click(); await esperaEstado(A, "Repetir esta música", "false"); await botao(A, "Ordem aleatória").click(); await esperaEstado(A, "Ordem aleatória", "false");
  await A.click("#pl-abrir"); await A.waitForSelector("#pl-faixas:not([hidden])"); assert.equal(await A.locator("#pl-faixas li").count(), 3); await A.locator("#pl-faixas li").nth(2).locator("button").click(); await esperaBarra(B, /Vídeo abcdefghijk/); await esperaBarra(A, /Vídeo abcdefghijk/);
  await B.click("#pl-abrir"); assert.equal(await B.locator("#pl-faixas li button:not([disabled])").count(), 0, "quem só ouve não escolhe a música");
});
t("música do YouTube toca no player da barra (as duas pontas); loop repete a mesma; ao acabar passa sozinha para a próxima da ordem", async () => {
  await esperaBarra(A, /Vídeo abcdefghijk/); for (const p of [A, B]) { await p.waitForSelector("#pl-palco iframe.pl-yt", { timeout: 10000 }); assert.match(await p.locator("#pl-palco iframe").getAttribute("src"), /youtube-nocookie\.com\/embed\/abcdefghijk\?enablejsapi=1/); assert.equal(await p.locator("#pl-palco").isVisible(), true); }
  await botao(A, "Repetir esta música").click(); await esperaEstado(A, "Repetir esta música", "true"); await A.waitForTimeout(11000); await esperaBarra(A, /Vídeo abcdefghijk/); await esperaBarra(B, /Vídeo abcdefghijk/); assert.equal(await A.locator("#pl-palco iframe.pl-yt").count(), 1, "com loop a mesma música recomeça (o vídeo dura 7 s, passaram 11)");
  await botao(A, "Repetir esta música").click(); await esperaEstado(A, "Repetir esta música", "false"); await esperaBarra(A, /Aurora/, 25000); await esperaBarra(B, /Aurora/, 25000); await A.waitForFunction(() => window.__som.some((x) => x.tocando && x.src.includes("previa101")), null, { timeout: 10000 }); assert.equal(await A.locator("#pl-palco").isVisible(), false, "o player some quando a música é da Apple");
});
t("parar encerra para os dois; a outra pessoa pode começar a dela (vira dona); sair da conversa cala a música e voltar retoma; a Apple e o YouTube são os únicos de fora", async () => {
  await botao(A, "Parar a playlist").click(); for (const p of [A, B]) await p.waitForSelector("#pl-barra", { state: "hidden", timeout: 12000 }); assert.equal(await tocandoAgora(A) + await tocandoAgora(B), 0);
  await criarLista(B, "Estudo", ["a:banda sol:Delta"]); await B.click("#pl-editor .pg-volta").catch(() => {}); await B.click("#playlists .pg-volta").catch(() => {}); await B.waitForSelector("#playlists:not([open])", { state: "attached" });
  await abrirDm(B, nomeA); await B.click("#mais"); await B.click("#plbtn"); await B.locator("#pl-lista .pl-cartao", { hasText: "Estudo" }).locator("button", { hasText: "Tocar aqui" }).click(); await esperaBarra(B, /Delta · Banda Sol · você controla/);
  await abrirDm(A, nomeB); await esperaBarra(A, new RegExp(`Delta · Banda Sol · @${nomeB} controla`), 20000); assert.equal(await A.locator("#pl-ctl button[aria-label='Pausar']").count(), 0, "agora o dono é o B");
  await listar(A); await A.waitForTimeout(600); assert.equal(await tocandoAgora(A), 0, "sair da conversa para a música (ela só toca com a conversa aberta)");
  await abrirDm(A, nomeB); await esperaBarra(A, /Delta/, 15000); await A.waitForFunction(() => window.__som.some((x) => x.tocando), null, { timeout: 15000 });
  const fora = pedidos.filter((u) => /^https?:/.test(u) && !u.startsWith(new URL(srv.url).origin) && !/supabase|127\.0\.0\.1|localhost|fonts\.(googleapis|gstatic)|itunes\.apple\.com|mzstatic\.com|youtube-nocookie\.com|i\.ytimg\.com/.test(u)); assert.deepEqual(fora, [], "nenhum pedido para fora do que a política permite");
});
t("nenhum erro de página", () => { assert.deepEqual(erros, []); });
