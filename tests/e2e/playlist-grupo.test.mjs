// Playlists em GRUPO (item da loja):  criar e editar (Apple e YouTube), sincronização cifrada, tocar na conversa (as duas pessoas ouvem), controle só de quem iniciou
// (sequência, aleatório, loop de uma música, pausa, escolher a música), parar, trocar de dono e sair da conversa. Apple e YouTube são SIMULADOS aqui.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync, crc32 } from "node:zlib";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC; const erros = [], pedidos = [];
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
setInterval(() => { if (listening) { entrega(); } }, 300);
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
  await ctx.route("https://audio-ssl.itunes.apple.com/**", (r) => { pedidos.push("audio-ssl"); const buf = onda(/previa104/.test(r.request().url()) ? 6 : 60), rg = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || ""); // (aceita pedir um pedaço, como a Apple: sem isso não dá para pular para o meio da música)
    if (rg) { const ini = Number(rg[1]), fim = rg[2] ? Math.min(Number(rg[2]), buf.length - 1) : buf.length - 1; return r.fulfill({ status: 206, headers: { ...CORS, "content-type": "audio/wav", "accept-ranges": "bytes", "content-range": `bytes ${ini}-${fim}/${buf.length}`, "content-length": String(fim - ini + 1) }, body: buf.subarray(ini, fim + 1) }); }
    r.fulfill({ status: 200, headers: { ...CORS, "content-type": "audio/wav", "accept-ranges": "bytes" }, body: buf }); });
  await ctx.route("https://is1-ssl.mzstatic.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: png(40, 40) }));
  await ctx.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: png(40, 40, 0x90) }));
  await ctx.route("https://www.youtube-nocookie.com/**", (r) => { pedidos.push("youtube-nocookie"); r.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: YT_HTML }); });
}

const chave = (p, titulo) => p.locator(`#sr-cards button.sr-sw[aria-label="${titulo}"]`);
const abrirSelos = async (p) => { await p.click("#grupo-btn"); await p.waitForSelector("#grupo-info[open]"); await p.click("#gi-selos"); await p.waitForSelector("#selos[open]"); await p.waitForFunction(() => document.querySelector("#sl-meu .n"), null, { timeout: 30000 }); };
const sair = async (p) => { await p.click("#selos .pg-volta"); await p.click("#grupo-info .pg-volta"); };
const ajusta = (p, sel, v) => p.evaluate(([s, x]) => { const i = document.querySelector(s); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);

const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
async function apiUser(tag) { const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: await jwk() })).error); return { c, id: data.user.id, nome }; }

import { createClient } from "../../vendor/supabase.js";
const vigiar = (p) => { p.on("pageerror", (e) => erros.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erros.push(m.text().slice(0, 200)); }); p.on("request", (r) => pedidos.push(r.url())); };
const gaveta = async (p) => { if (!(await p.locator("#pl-gaveta").isVisible())) await p.click("#pl-abrir"); await p.waitForSelector("#pl-gaveta #pl-ctl button", { state: "visible" }); };
const botao = (p, rotulo) => p.locator(`#pl-ctl button[aria-label="${rotulo}"]`);
const esperaBarra = async (p, re, ms = 25000) => { const ini = Date.now(); for (;;) { if ((await p.locator("#pl-barra").isVisible()) && re.test(await p.locator("#pl-faixa").innerText())) return; if (Date.now() - ini > ms) assert.fail(`a barra não mostrou ${re}; mostra: ${(await p.locator("#pl-faixa").innerText().catch(() => "?"))}`); await p.waitForTimeout(250); } };
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Radio")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
const tocando = (p) => p.evaluate(() => window.__som.some((x) => x.tocando));
const rpcDe = (p, fn, args) => p.evaluate(async ([f, a, url, key]) => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)), tok = JSON.parse(localStorage[k]).access_token; const r = await fetch(`${url}/rest/v1/rpc/${f}`, { method: "POST", headers: { apikey: key, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(a) }); return { status: r.status, corpo: await r.text() }; }, [fn, args, SUPABASE_URL, SUPABASE_KEY]);
const menu = async (p, item) => { if (!(await p.locator("#menu-conta").isVisible())) { await p.click("#eu-foto"); await p.waitForSelector("#menu-conta:not([hidden])"); } await p.click(item); };
let gid;
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async () => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 820 } }); await ctx.addInitScript(() => { window.__som = []; const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const s = this.currentSrc || this.src || ""; if (s.includes("audio-ssl")) { const e = { src: s, el: this, get tocando() { return !e.el.paused && !e.el.ended; } }; window.__som.push(e); } return o.call(this); }; }); await simular(ctx); const p = await ctx.newPage(); vigiar(p); return p; };
  [A, B, C] = [await novo(), await novo(), await novo()]; [nomeA, nomeB, nomeC] = [novoUsuario("ga"), novoUsuario("gb"), novoUsuario("gc")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.fill("#text", "oi b"); await A.click("#send-form .primary");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await A.fill("#text", "oi c"); await A.click("#send-form .primary");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await P.fill("#text", "oi a, aqui é " + nome); await P.click("#send-form .primary"); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Radio");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Radio")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await abrirGrupoDe(B); await abrirGrupoDe(C);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("o admin liga o item Playlist tocando e dá Selos; B cria a playlist (Apple e YouTube) e compra 8 passos de 5 min (preço = 40 + 7 x 10 = 110); o saldo cai e o grupo ganha um aviso", async () => {
  await abrirSelos(A); await A.click("#sl-editar"); await A.waitForSelector("#selos-regras[open]"); assert.equal(await A.locator("#sr-loja .sr-card").count(), 7);
  await chave(A, "Entrar no grupo").click(); await A.locator('#sr-cards .sr-card:has(b:text-is("Entrar no grupo")) .sr-n').first().click(); await A.waitForSelector("#selos-num[open]"); await A.fill("#sn-valor", "300"); await A.click("#sn-ok"); await A.waitForFunction(() => !document.querySelector("#selos-num").open);
  await A.locator('#sr-loja button.sr-sw[aria-label="Playlist tocando"]').click(); assert.match(await A.locator('#sr-loja .sr-card:has(b:text-is("Playlist tocando")) .sr-frase').innerText(), /Custa 40 Selos pelos primeiros 5 minutos e 10 Selos a cada 5 minutos a mais/);
  await A.click("#sr-salvar"); await A.waitForFunction(() => !document.querySelector("#selos-regras").open, null, { timeout: 30000 }); await sair(A);
  await B.click("#eu-foto"); await B.click("#pl-menu"); await B.waitForSelector("#playlists[open]"); await B.click("#pl-nova"); await B.waitForSelector("#pl-editor[open]"); await B.fill("#pl-nome-in", "Festa"); await B.locator("#pl-nome-in").blur(); await B.waitForTimeout(400);
  await B.click("#pl-add-btn"); await B.fill("#pl-busca", "banda sol"); await B.waitForSelector("#pl-res li"); for (const n of ["Aurora", "Brisa"]) { await B.locator(`#pl-res li:has(b:text-is("${n}")) button`).click(); await B.waitForFunction((x) => document.querySelector("#pl-res-msg").textContent.includes(x), n); }
  await B.click("#pl-aba-y"); await B.fill("#pl-link", "https://youtu.be/abcdefghijk"); await B.click("#pl-link-ok"); await B.waitForFunction(() => /Adicionada/.test(document.querySelector("#pl-link-msg").textContent), null, { timeout: 20000 }); await B.click("#pl-add-fechar"); await B.waitForSelector("#pl-add:not([open])", { state: "attached" });
  await B.click("#pl-editor .pg-volta"); await B.click("#playlists .pg-volta"); await B.waitForSelector("#playlists:not([open])", { state: "attached" });
  await abrirSelos(B); await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "300", null, { timeout: 30000 }); assert.equal(await B.locator('#sl-loja .lj-cartao[data-item="playlist"] .lj-bt').isEnabled(), true);
  await B.locator('#sl-loja .lj-cartao[data-item="playlist"] .lj-bt').click(); await B.waitForSelector("#loja-folha[open] .lf-pl", { timeout: 20000 }); await B.locator("#loja-folha .lf-pl", { hasText: "Festa" }).click(); await ajusta(B, "#lf-passos", 8);
  assert.match(await B.locator("#lf-passos ~ .lf-mono").innerText(), /40 minutos · custa 110 Selos/); assert.match(await B.locator("#lf-depois").innerText(), /300 → 190/); await B.click("#lf-ok"); await B.waitForFunction(() => !document.querySelector("#loja-folha").open, null, { timeout: 30000 });
  await B.waitForFunction(() => document.querySelector("#sl-meu .n")?.textContent === "190", null, { timeout: 30000 }); await sair(B);
  await B.waitForSelector(`#messages .aviso-linha:has-text("Você pôs uma playlist para tocar no grupo por 40 minutos")`, { timeout: 30000 }); await A.waitForSelector(`#messages .aviso-linha:has-text("@${nomeB} pôs uma playlist para tocar no grupo por 40 minutos")`, { timeout: 30000 });
});
t("a playlist toca para todo o grupo; só quem comprou controla (próxima, aleatório, escolher); o servidor recusa controle e outra compra de quem não é o dono", async () => {
  await esperaBarra(B, /Aurora · Banda Sol · você controla · até \d\d:\d\d/); for (const p of [A, C]) await esperaBarra(p, new RegExp(`Aurora · Banda Sol · @${nomeB} controla · até`));
  for (const p of [A, B, C]) await p.waitForFunction(() => window.__som.some((x) => x.tocando && x.src.includes("previa101")), null, { timeout: 15000 });
  await gaveta(A); await gaveta(B); await gaveta(C); assert.equal(await A.locator("#pl-ctl button[aria-label='Pausar']").count(), 0, "membro comum não controla"); assert.equal(await C.locator("#pl-ctl button[aria-label='Pausar']").count(), 0);
  await botao(B, "Próxima música").click(); for (const p of [A, B, C]) await esperaBarra(p, /Brisa/); await botao(B, "Pausar").click(); for (const p of [A, C]) await p.waitForFunction(() => !window.__som.some((x) => x.tocando), null, { timeout: 12000 }); await botao(B, "Tocar").click(); for (const p of [A, C]) await p.waitForFunction(() => window.__som.some((x) => x.tocando), null, { timeout: 12000 });
  await botao(B, "Ordem aleatória").click(); await B.waitForFunction(() => document.querySelector("#pl-ctl button[aria-label='Ordem aleatória']").getAttribute("aria-pressed") === "true"); await botao(B, "Ordem aleatória").click();
  await B.locator("#pl-faixas li").nth(2).locator("button").click(); for (const p of [A, B, C]) await esperaBarra(p, /Vídeo abcdefghijk/); await A.waitForSelector("#pl-palco iframe.pl-yt", { state: "attached", timeout: 10000 });
  gid = await A.evaluate(async () => (await (await import("./vendor/supabase.js")).createClient((await import("./config.js")).SUPABASE_URL, (await import("./config.js")).SUPABASE_KEY).rpc("meus_grupos")).data[0].grupo_id);
  const ver = await rpcDe(A, "playlist_ver_grupo", { p_grupo: gid }); const sessao = JSON.parse(ver.corpo)[0]; assert.ok(sessao && sessao.dono && !("faixas" in sessao), "a consulta leve não traz as músicas");
  const ctl = await rpcDe(A, "playlist_controlar", { p_sessao: sessao.id, p_estado: { f: 0, p: 0, t: true, a: false, l: false } }); assert.ok(ctl.status >= 400 && /sem_controle/.test(ctl.corpo), "quem não comprou não controla (servidor)");
  const par = await rpcDe(A, "playlist_parar", { p_sessao: sessao.id }); assert.ok(par.status >= 400 && /sem_controle/.test(par.corpo));
  const nova = await rpcDe(A, "playlist_comprar", { p_grupo: gid, p_passos: 1, p_faixas: { v: 1, ciphertext: "AAAA", iv: "AAAA" }, p_estado: { f: 0, p: 0, t: true, a: false, l: false } }); assert.ok(nova.status >= 400 && /ja_com_playlist|saldo_insuficiente|item_desligado/.test(nova.corpo), "outra compra é recusada enquanto uma toca: " + nova.corpo);
  const fAdd = await rpcDe(A, "playlist_faixas", { p_sessao: sessao.id }); assert.ok(fAdd.corpo.includes("ciphertext") && !/Aurora|Brisa|abcdefghijk/.test(fAdd.corpo), "as músicas chegam cifradas");
});
t("a playlist em uso fica travada para pôr músicas novas (tirar e reordenar ainda vale); estranho ao grupo não vê nada; ao acabar o tempo a barra some e a trava cai", async () => {
  await B.click("#eu-foto"); await B.click("#pl-menu"); await B.waitForSelector("#playlists[open]"); await B.locator("#pl-lista .pl-cartao button", { hasText: "Editar" }).first().click(); await B.waitForSelector("#pl-editor[open]");
  await B.waitForFunction(() => !document.querySelector("#pl-trava").hidden, null, { timeout: 20000 }); assert.match(await B.locator("#pl-trava").innerText(), /está tocando no grupo “Radio” até \d\d:\d\d/); assert.equal(await B.locator("#pl-add-btn").isDisabled(), true);
  assert.equal(await B.locator("#pl-musicas li").first().locator('button[aria-label="Descer"]').isEnabled(), true, "mudar a ordem continua valendo");
  const e = await apiUser("est"); const veja = await e.c.rpc("playlist_ver_grupo", { p_grupo: gid }); assert.deepEqual(veja.data || [], [], "quem não é do grupo não vê a sessão"); const sess = JSON.parse((await rpcDe(A, "playlist_ver_grupo", { p_grupo: gid })).corpo)[0]; const f = await e.c.rpc("playlist_faixas", { p_sessao: sess.id }); assert.ok(!f.data, "nem as músicas"); const m = await e.c.rpc("playlist_controlar", { p_sessao: sess.id, p_estado: { f: 0, p: 0, t: true, a: false, l: false } }); assert.ok(m.error);
  await B.click("#pl-editor .pg-volta"); await B.click("#playlists .pg-volta"); await B.waitForSelector("#playlists:not([open])", { state: "attached" });
  const fora = pedidos.filter((u) => /^https?:/.test(u) && !u.startsWith(new URL(srv.url).origin) && !/supabase|127\.0\.0\.1|localhost|fonts\.(googleapis|gstatic)|itunes\.apple\.com|mzstatic\.com|youtube-nocookie\.com|i\.ytimg\.com/.test(u)); assert.deepEqual(fora, []);
});
t("quando o tempo acaba: a música e a barra somem para todos e a playlist volta a aceitar músicas novas; dá para comprar outra", async () => {
  for (const p of [A, B, C]) await p.waitForSelector("#pl-barra", { state: "hidden", timeout: 100000 }); for (const p of [A, B, C]) assert.equal(await tocando(p), false, "ninguém ouve mais nada");
  await B.click("#eu-foto"); await B.click("#pl-menu"); await B.waitForSelector("#playlists[open]"); await B.locator("#pl-lista .pl-cartao button", { hasText: "Editar" }).first().click(); await B.waitForSelector("#pl-editor[open]"); await B.waitForTimeout(1500);
  assert.equal(await B.locator("#pl-trava").isHidden(), true, "a trava caiu"); assert.equal(await B.locator("#pl-add-btn").isEnabled(), true); await B.click("#pl-editor .pg-volta"); await B.click("#playlists .pg-volta"); await B.waitForSelector("#playlists:not([open])", { state: "attached" });
  await abrirSelos(B); await B.locator('#sl-loja .lj-cartao[data-item="playlist"] .lj-bt').waitFor(); assert.equal(await B.locator('#sl-loja .lj-cartao[data-item="playlist"] .lj-bt').isEnabled(), true, "o item volta a poder ser comprado"); await sair(B);
});
t("nenhum erro de página", () => { assert.deepEqual(erros, []); });
