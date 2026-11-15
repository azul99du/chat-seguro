// Música nas conversas (cartão no estilo do Instagram): busca na Apple (SIMULADA aqui: nenhum teste fala com a Apple de verdade), trecho escolhido, envio
// cifrado e reprodução só da janela escolhida; em conversa a dois e em grupo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { deflateSync, crc32 } from "node:zlib";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, SUPABASE_URL, SUPABASE_KEY, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, buscas = 0, modoBusca = "ok", cabecalhos = [], pedidos = []; const erros = [];
const t = (nome, fn) => test(nome, { timeout: 200000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const jwk = async () => { const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", k.publicKey); return { kty: "EC", crv: "P-256", x: j.x, y: j.y }; };
async function apiUser(tag) { const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA }); if (error || !data.session) throw new Error(error?.message || "sem sessão");
  const nome = novoUsuario(tag); assert.ifError((await c.from("profiles").insert({ id: data.user.id, username: nome, public_key: await jwk() })).error); return { c, id: data.user.id, nome }; }
function onda(seg = 6, taxa = 22050) { const n = seg * taxa, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((i / taxa) * 2 * Math.PI * (300 + 100 * (i / taxa)))), 44 + i * 2); return b; }
function png(w, h, cor = 0x70) { const bloco = (tipo, dados) => { const b = Buffer.concat([Buffer.from(tipo), dados]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, cor)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => linha)))), bloco("IEND", Buffer.alloc(0))]); }
const CORS = { "access-control-allow-origin": "*" };
const musica = (id, titulo, artista) => ({ wrapperType: "track", kind: "song", trackId: id, trackName: titulo, artistName: artista, previewUrl: `https://audio-ssl.itunes.apple.com/teste/previa${id}.m4a`, artworkUrl100: `https://is1-ssl.mzstatic.com/teste/capa${id}.jpg/100x100bb.jpg` });
async function simularApple(ctx) { // a "Apple" do teste: busca, trecho de 30 s e capa
  await ctx.route("https://itunes.apple.com/**", (r) => { buscas++; const u = new URL(r.request().url()), termo = u.searchParams.get("term"), pais = u.searchParams.get("country"); cabecalhos.push(r.request().headers()); pedidos.push(`${pais}:${termo}`); if (modoBusca === "erro") return r.fulfill({ status: 500, headers: CORS, body: "x" });
    const vazio = modoBusca === "vazio" || (modoBusca === "so-us" && pais === "BR") || (modoBusca === "tipo" && termo !== "akeboshi wnd");
    return r.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/javascript; charset=utf-8" }, body: JSON.stringify({ resultCount: vazio ? 0 : 3, results: vazio ? [] : [musica(1, "Wind", "Akeboshi"), musica(2, "Blue Wind", "Outro Artista"), { ...musica(3, "Sem trecho", "X"), previewUrl: "https://evil.example/x.m4a" }] }) }); });
  await ctx.route("https://audio-ssl.itunes.apple.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "audio/x-m4p" }, body: onda(30) }));
  await ctx.route("https://is1-ssl.mzstatic.com/**", (r) => r.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: png(60, 60) }));
}
const tocou = (p) => p.evaluate(() => window.__tocou), zerar = (p) => p.evaluate(() => { window.__tocou = 0; });
const ajusta = (p, sel, v) => p.evaluate(([s, x]) => { const i = document.querySelector(s); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
async function abrirMusica(p) { await p.click("#mais"); await p.click("#musica"); await p.waitForSelector("#musica-folha[open]"); }
async function buscarEEscolher(p, termo, titulo) { await p.fill("#mu-busca", termo); await p.waitForSelector("#mu-destaque:not([hidden]) button, #mu-lista button", { timeout: 20000 }); await p.locator(`:is(#mu-destaque, #mu-lista) button:has(b:text-is("${titulo}"))`).first().click(); await p.waitForSelector("#mu-cartao .mu-card .mu-capa img", { timeout: 30000 }); await p.waitForFunction(() => !document.querySelector("#mu-enviar").disabled, null, { timeout: 30000 }); }
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Musica")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
const abrirDm = async (p, nome) => { await p.click(`#contacts button:not([data-grupo]):has-text("@${nome}")`); await p.waitForSelector(`#conv-title:text-is("@${nome}")`, { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };

before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async (n) => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }); await ctx.addInitScript(() => { const o = HTMLMediaElement.prototype.play; window.__tocou = 0; HTMLMediaElement.prototype.play = function () { if ((this.currentSrc || this.src || "").startsWith("blob:")) window.__tocou++; return o.call(this); }; }); await simularApple(ctx); const p = await ctx.newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message)); return p; };
  [A, B, C] = [await novo("A"), await novo("B"), await novo("C")]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Musica");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Musica")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Musica")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("a bandeja tem o botão Música; a busca explica que vai direto à Apple, avisa quando não acha nada ou dá erro, e só mostra o que tem trecho e capa da Apple", async () => {
  await abrirDm(A, nomeB); await abrirMusica(A); assert.match(await A.locator(".mu-nota").innerText(), /direto da Apple/); await A.fill("#mu-busca", "a"); assert.match(await A.locator("#mu-msg").innerText(), /pelo menos 2 letras/); assert.equal(buscas, 0, "uma letra só não busca");
  modoBusca = "vazio"; await A.fill("#mu-busca", "nada por aqui"); await A.waitForFunction(() => /Nenhuma música encontrada/.test(document.querySelector("#mu-msg").textContent), null, { timeout: 20000 });
  modoBusca = "erro"; await A.fill("#mu-busca", "qualquer coisa"); await A.waitForFunction(() => /Não foi possível buscar/.test(document.querySelector("#mu-msg").textContent), null, { timeout: 15000 });
  modoBusca = "ok"; await A.fill("#mu-busca", "akeboshi"); await A.waitForSelector("#mu-destaque:not([hidden]) button", { timeout: 15000 }); assert.deepEqual(await A.locator("#mu-lista b").allInnerTexts(), ["Blue Wind"], "o resultado com endereço de fora da Apple some");
  assert.ok(cabecalhos.length > 0 && cabecalhos.every((h) => !h.referer), "a busca não leva o endereço do site (sem Referer)");
});
t("busca melhor: o resultado muito melhor vira 'Melhor resultado'; sem nada no Brasil acha na loja dos EUA; com erro de digitação ainda acha; resultados parelhos não ganham destaque", async () => {
  assert.match(await A.locator("#mu-destaque").innerText(), /melhor resultado[\s\S]*Wind[\s\S]*Akeboshi/i);
  const esperaPedido = async (re, ms = 20000) => { const ini = Date.now(); while (!pedidos.some((x) => re.test(x))) { if (Date.now() - ini > ms) assert.fail(`o pedido ${re} não saiu: ${JSON.stringify(pedidos)}`); await A.waitForTimeout(150); } };
  modoBusca = "so-us"; pedidos.length = 0; await A.fill("#mu-busca", "wind akeboshi"); await esperaPedido(/^US:wind akeboshi$/); assert.ok(pedidos[0].startsWith("BR:"), "a loja do Brasil vem primeiro; como não achou, tentou os EUA"); await A.waitForSelector("#mu-destaque:not([hidden]) button"); assert.match(await A.locator("#mu-destaque").innerText(), /Wind/);
  modoBusca = "tipo"; pedidos.length = 0; await A.fill("#mu-busca", "akeboshii wnd"); await esperaPedido(/:akeboshi wnd$/); assert.ok(pedidos.some((x) => x === "BR:akeboshii wnd") && pedidos.some((x) => x === "US:akeboshii wnd"), "BR e EUA com o que foi digitado, antes das variações"); await A.waitForTimeout(1000); assert.match((await A.locator("#mu-destaque, #mu-lista").allInnerTexts()).join(" "), /Wind/, "achou mesmo com o erro de digitação");
  modoBusca = "ok"; await A.fill("#mu-busca", "wind"); await A.waitForFunction(() => document.querySelectorAll("#mu-lista button").length + document.querySelectorAll("#mu-destaque button").length === 2, null, { timeout: 20000 }); assert.equal(await A.locator("#mu-destaque").isHidden(), true, "Wind e Blue Wind: parelho, sem destaque"); assert.deepEqual(await A.locator("#mu-lista b").allInnerTexts(), ["Wind", "Blue Wind"], "a que casa melhor vem primeiro");
});
t("escolher o trecho: a prévia é o cartão do Instagram; um trecho grande arrastável sobre as ondas escolhe o começo e a barra escolhe a duração; nada passa do arquivo de 30 s; a prévia toca", async () => {
  await A.locator('#mu-lista button:has(b:text-is("Wind"))').first().click(); await A.waitForSelector("#mu-cartao .mu-capa img", { timeout: 30000 }); await A.waitForFunction(() => !document.querySelector("#mu-enviar").disabled, null, { timeout: 30000 });
  assert.equal(await A.locator("#mu-cartao .mu-disco").count(), 1, "o disco de vinil"); assert.equal(await A.locator("#mu-cartao .mu-tit").innerText(), "Wind"); assert.equal(await A.locator("#mu-cartao .mu-art").innerText(), "Akeboshi");
  assert.equal(await A.locator("#mu-onda i").count(), 60, "ondas do áudio"); assert.ok((await A.locator("#mu-onda i.dentro").count()) >= 28 && (await A.locator("#mu-onda i.dentro").count()) <= 32, "metade das barras está dentro do trecho de 15 s");
  assert.match(await A.locator("#mu-grip").innerText(), /0:00 – 0:15/); assert.equal(await A.locator("#mu-dur-txt").innerText(), "15 s"); assert.equal(await A.locator("#mu-ini").count(), 0, "a barra do começo saiu: agora é o trecho arrastável");
  const largLinha = async () => (await A.locator("#mu-linha").boundingBox()).width, largJan = async () => (await A.locator("#mu-janela").boundingBox()).width;
  assert.ok(Math.abs((await largJan()) / (await largLinha()) - 0.5) < 0.04, "15 de 30 s = metade da linha");
  await ajusta(A, "#mu-dur", 5); assert.match(await A.locator("#mu-grip").innerText(), /0:00 – 0:05/); assert.ok(Math.abs((await largJan()) / (await largLinha()) - 1 / 6) < 0.03, "5 de 30 s = um sexto"); assert.ok((await A.locator("#mu-onda i.dentro").count()) <= 12);
  const arrastar = async (de, para) => { await A.mouse.move(de, (await A.locator("#mu-janela").boundingBox()).y + 40); await A.mouse.down(); await A.mouse.move(para, (await A.locator("#mu-janela").boundingBox()).y + 40, { steps: 10 }); await A.mouse.up(); };
  let lb = await A.locator("#mu-linha").boundingBox(), jb = await A.locator("#mu-janela").boundingBox(); await arrastar(jb.x + jb.width / 2, jb.x + jb.width / 2 + lb.width * 0.2); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:06", "arrastar 20% da linha = 6 s");
  lb = await A.locator("#mu-linha").boundingBox(); jb = await A.locator("#mu-janela").boundingBox(); await arrastar(jb.x + jb.width / 2, lb.x + lb.width + 200); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:25", "arrastar além do fim para na ponta (30 - 5 s)"); assert.match(await A.locator("#mu-grip").innerText(), /0:25 – 0:30/);
  lb = await A.locator("#mu-linha").boundingBox(); jb = await A.locator("#mu-janela").boundingBox(); await arrastar(jb.x + jb.width / 2, lb.x - 300); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:00", "e além do começo também");
  lb = await A.locator("#mu-linha").boundingBox(); await A.mouse.click(lb.x + lb.width * 0.5, lb.y + 52); assert.match(await A.locator("#mu-ini-txt").innerText(), /0:1[23]/, "tocar fora do trecho traz o trecho para ali");
  await A.locator("#mu-janela").focus(); await A.keyboard.press("Home"); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:00"); await A.keyboard.press("End"); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:25"); await ajusta(A, "#mu-dur", 15); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:15", "aumentar a duração recua o começo para caber"); assert.equal(await A.locator("#mu-janela").getAttribute("aria-valuemax"), "15");
  await ajusta(A, "#mu-dur", 5); await A.locator("#mu-janela").focus(); await A.keyboard.press("Home"); for (let i = 0; i < 12; i++) await A.keyboard.press("ArrowRight"); assert.equal(await A.locator("#mu-ini-txt").innerText(), "0:06", "setas: 0,5 s por vez"); assert.equal(await A.locator("#mu-janela").getAttribute("aria-valuetext"), "começa em 0:06, dura 5 segundos");
  await zerar(A); await A.click("#mu-cartao .mu-capa"); await A.waitForSelector("#mu-cartao .mu-card.tocando"); assert.equal(await tocou(A), 1, "a prévia toca"); await A.waitForSelector("#mu-cabeca:not([hidden])", { timeout: 3000 }); await A.click("#mu-cartao .mu-capa"); await A.waitForSelector("#mu-cartao .mu-card:not(.tocando)");
});
t("enviar: o cartão aparece nas duas pontas, cifrado como qualquer mídia; quem recebe toca só a janela escolhida (para sozinho)", async () => {
  await A.click("#mu-enviar"); await A.waitForFunction(() => !document.querySelector("#musica-folha").open, null, { timeout: 30000 });
  await A.waitForSelector(".msg.mine .mu-card .mu-capa img", { timeout: 30000 }); assert.equal(await A.locator(".msg.mine .mu-tit").last().innerText(), "Wind"); assert.equal(await A.locator(".msg.mine .mu-art").last().innerText(), "Akeboshi");
  await abrirDm(B, nomeA); await B.waitForSelector(".msg:not(.mine) .mu-card .mu-capa img", { timeout: 30000 }); assert.equal(await B.locator(".msg:not(.mine) .mu-tit").last().innerText(), "Wind"); assert.equal(await B.locator(".msg:not(.mine) .mu-art").last().innerText(), "Akeboshi");
  assert.equal(await B.locator(".msg:not(.mine) .bubble.musica-bolha").count(), 1, "sem balão em volta: só o cartão");
  await zerar(B); await B.click(".msg:not(.mine) .mu-capa"); await B.waitForSelector(".msg:not(.mine) .mu-card.tocando"); assert.equal(await tocou(B), 1);
  await B.waitForSelector(".msg:not(.mine) .mu-card:not(.tocando)", { timeout: 15000 }); // 5 s de trecho: para sozinho
  await B.click(".msg:not(.mine) .mu-capa"); await B.waitForSelector(".msg:not(.mine) .mu-card.tocando"); await B.click(".msg:not(.mine) .mu-capa"); await B.waitForSelector(".msg:not(.mine) .mu-card:not(.tocando)", { timeout: 5000 }); // tocar de novo e pausar
});
t("em grupo funciona igual, para todos os membros; o que o servidor guarda é só arquivo cifrado (nenhum título em texto claro)", async () => {
  await abrirGrupoDe(C); await abrirMusica(C); await buscarEEscolher(C, "wind", "Blue Wind"); await C.click("#mu-enviar"); await C.waitForFunction(() => !document.querySelector("#musica-folha").open, null, { timeout: 30000 });
  await C.waitForSelector(".msg.mine .mu-card .mu-capa img", { timeout: 30000 });
  for (const p of [A, B]) { await abrirGrupoDe(p); await p.waitForSelector(".msg .mu-card .mu-capa img", { timeout: 30000 }); assert.equal(await p.locator(".msg .mu-tit").last().innerText(), "Blue Wind"); }
  const linhas = await C.evaluate(async () => { const { createClient } = await import("./vendor/supabase.js"), { SUPABASE_URL, SUPABASE_KEY } = await import("./config.js"), sb = createClient(SUPABASE_URL, SUPABASE_KEY), r = await sb.from("messages").select("ciphertext").eq("sender_id", (await sb.auth.getUser()).data.user.id).order("id", { ascending: false }).limit(5); return JSON.stringify(r.data || []); });
  assert.doesNotMatch(linhas, /Blue Wind|Outro Artista/, "o servidor não vê o título nem o artista");
});
t("voltar e fechar no meio: nada fica tocando nem é enviado; abrir de novo começa limpo", async () => {
  await abrirDm(A, nomeB); await abrirMusica(A); await buscarEEscolher(A, "akeboshi", "Wind"); await A.click("#mu-voltar"); await A.waitForSelector("#mu-busca-tela:not([hidden])"); assert.equal(await A.locator("#mu-trecho-tela").isHidden(), true);
  await A.click("#mu-fechar"); await A.waitForFunction(() => !document.querySelector("#musica-folha").open); assert.equal(await A.locator(".msg.mine .mu-card").count(), 1, "só a música enviada antes");
  await abrirMusica(A); assert.equal(await A.inputValue("#mu-busca"), ""); assert.equal(await A.locator("#mu-lista button").count(), 0, "a busca anterior foi limpa"); await A.click("#mu-fechar");
});
t("nenhum erro de página", () => assert.deepEqual(erros, []));
