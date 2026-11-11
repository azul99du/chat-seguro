// Links de Shorts / Reels / TikTok: viram cartão; o vídeo só carrega ao tocar (com aviso na 1ª vez), numa moldura isolada; links parecidos NÃO viram cartão.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeB; const erros = [], pedidos = [];
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(p, nome) { await p.goto(srv.url); await p.click("#tab-signup"); await p.fill("#username", nome); await p.fill("#email", novoEmail()); await p.fill("#password", SENHA); await p.click("#auth-submit"); await p.waitForSelector("#ask[open]", { timeout: 30000 }); await p.fill("#ask-input", FRASE); await p.click("#ask button[value=ok]"); await pronto(p); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const YT = "dQw4w9WgXcQ", TT = "7234567890123456789", IG = "C8aBcD_eFgH";
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const novo = async (n) => { const p = await (await browser.newContext({ viewport: { width: 390, height: 780 } })).newPage(); p.on("pageerror", (e) => erros.push(n + ": " + e.message));
    p.on("request", (r) => { if (/youtube|instagram|tiktok/.test(new URL(r.url()).hostname)) pedidos.push({ n, url: r.url(), tipo: r.resourceType() }); });
    await p.route(/^https:\/\/(www\.youtube-nocookie\.com|www\.instagram\.com|www\.tiktok\.com)\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player de mentira</title><body>player de mentira</body>" })); return p; }; // (nada de rede de verdade nos testes)
  A = await novo("A"); B = await novo("B"); nomeB = novoUsuario("b"); await cadastrar(B, nomeB); await cadastrar(A, novoUsuario("a"));
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("cada rede vira um cartão com a etiqueta certa, e NADA é contatado enquanto ninguém tocar", async () => {
  await enviar(A, `olha isso https://www.youtube.com/shorts/${YT}?si=zzz`); await enviar(A, `https://www.instagram.com/reel/${IG}/?igsh=abc`); await enviar(A, `https://www.tiktok.com/pt-BR/@fulano/video/${TT}`);
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector(".msg:not(.mine) .vcard >> nth=2", { timeout: 30000 });
  assert.deepEqual(await B.locator(".vcard .rede").allInnerTexts(), ["YouTube Shorts", "Instagram Reels", "TikTok"]);
  assert.equal(await B.locator("iframe").count(), 0, "nenhuma moldura antes de tocar"); assert.deepEqual(pedidos.filter((p) => p.n === "B"), [], "nenhum pedido às redes antes de tocar");
  assert.equal(await B.locator(".msg:not(.mine)").first().locator(".vis").innerText(), "olha isso https://www.youtube.com/shorts/" + YT + "?si=zzz", "o texto da mensagem continua como foi escrito");
  assert.equal(await A.locator(".msg.mine .vcard").count(), 3, "quem enviou também vê os cartões");
});
t("tocar: aviso na primeira vez (o que a rede vai ver); Cancelar não carrega nada; 'Assistir' abre a tela cheia com a moldura isolada", async () => {
  const card = B.locator(".vcard.yt").first();
  await card.click(); await B.waitForSelector("#choice[open]"); assert.match(await B.locator("#choice-title").innerText(), /YouTube vai ver/); assert.match(await B.locator("#choice-text").innerText(), /endereço de internet \(IP\).*aparelho.*qual vídeo/s); assert.match(await B.locator("#choice-text").innerText(), /não vê a conversa/);
  await B.click('#choice-actions button[value=""]').catch(async () => { await B.keyboard.press("Escape"); }); await B.waitForSelector("#choice", { state: "hidden" });
  await B.waitForFunction(() => !document.querySelector("iframe"), null, { timeout: 5000 }); assert.deepEqual(pedidos.filter((p) => p.n === "B"), [], "cancelou: nada foi pedido");
  await card.click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="uma"]'); await B.waitForSelector("#video-view[open] iframe");
  const f = B.locator("#video-view iframe");
  assert.equal(await f.getAttribute("src"), `https://www.youtube-nocookie.com/embed/${YT}?playsinline=1&rel=0`, "endereço limpo, sem o ?si= do link original");
  assert.equal(await f.getAttribute("credentialless"), ""); assert.equal(await f.getAttribute("referrerpolicy"), "strict-origin"); assert.equal(await f.getAttribute("allow"), "autoplay; fullscreen; picture-in-picture");
  const sb = await f.getAttribute("sandbox"); assert.ok(sb.includes("allow-scripts") && !/allow-top-navigation|allow-forms|allow-modals|allow-downloads/.test(sb), sb);
  assert.equal(await B.locator("#vv-rede-txt").innerText(), "YouTube Shorts"); assert.equal(await B.locator("#vv-url").innerText(), `youtube.com/shorts/${YT}`);
  const a = B.locator("#vv-abrir"); assert.equal(await a.getAttribute("href"), `https://www.youtube.com/shorts/${YT}`); assert.equal(await a.getAttribute("target"), "_blank"); assert.match(await a.getAttribute("rel"), /noopener/); assert.match(await a.getAttribute("rel"), /noreferrer/); assert.equal(await B.locator("#vv-abrir-txt").innerText(), "Abrir no YouTube");
  assert.ok(pedidos.some((p) => p.n === "B" && p.tipo === "document" && p.url.startsWith("https://www.youtube-nocookie.com/embed/" + YT)), "só agora o pedido saiu");
  assert.equal(await B.evaluate(() => { try { return !!document.querySelector("#video-view iframe").contentDocument; } catch { return false; } }), false, "a página do Lacre não consegue ler dentro da moldura");
});
t("fechar (setinha, Esc e o 'voltar' do celular) tira a moldura: o vídeo para", async () => {
  await B.click("#vv-fechar"); await B.waitForSelector("#video-view", { state: "hidden" }); await B.waitForFunction(() => !document.querySelector("iframe"), null, { timeout: 5000 });
  const card = B.locator(".vcard.yt").first(); await card.click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="uma"]'); await B.waitForSelector("#video-view[open] iframe"); await B.keyboard.press("Escape"); await B.waitForSelector("#video-view", { state: "hidden" }); await B.waitForFunction(() => !document.querySelector("iframe"), null, { timeout: 5000 });
  await card.click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="uma"]'); await B.waitForSelector("#video-view[open] iframe");
  await B.goBack().catch(() => {}); await B.waitForTimeout(300); await B.waitForSelector("#video-view", { state: "hidden" }); await B.waitForFunction(() => !document.querySelector("iframe"), null, { timeout: 5000 }); assert.ok(!B.url().startsWith("about:"), "e continua no site");
});
t("'Assistir e não perguntar de novo' vale só para aquela rede; Instagram e TikTok usam o endereço de player certo e sem referência", async () => {
  const yt = B.locator(".vcard.yt").first(); await yt.click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="sempre"]'); await B.waitForSelector("#video-view[open] iframe"); await B.click("#vv-fechar");
  await yt.click(); await B.waitForSelector("#video-view[open] iframe"); assert.equal(await B.locator("#choice[open]").count(), 0, "o YouTube não pergunta mais"); await B.click("#vv-fechar");
  const ig = B.locator(".vcard.ig").first(); await ig.click(); await B.waitForSelector("#choice[open]"); assert.match(await B.locator("#choice-title").innerText(), /Instagram vai ver/, "outra rede pergunta"); await B.click('#choice-actions button[value="uma"]');
  await B.waitForSelector("#video-view[open] iframe"); assert.equal(await B.locator("#video-view iframe").getAttribute("src"), `https://www.instagram.com/reel/${IG}/embed/`); assert.equal(await B.locator("#video-view iframe").getAttribute("referrerpolicy"), "no-referrer"); await B.click("#vv-fechar");
  const tt = B.locator(".vcard.tt").first(); await tt.click(); await B.waitForSelector("#choice[open]"); await B.click('#choice-actions button[value="uma"]'); await B.waitForSelector("#video-view[open] iframe");
  assert.equal(await B.locator("#video-view iframe").getAttribute("src"), `https://www.tiktok.com/embed/v2/${TT}`); assert.equal(await B.locator("#vv-abrir").getAttribute("href"), `https://www.tiktok.com/@fulano/video/${TT}`); await B.click("#vv-fechar");
});
t("links que só PARECEM ser dessas redes não viram cartão", async () => {
  const antes = await B.locator(".vcard").count();
  for (const l of [`https://youtube.com.evil.com/shorts/${YT}`, `https://www.youtube.com@evil.com/shorts/${YT}`, `http://www.youtube.com/shorts/${YT}`, `https://www.youtube.com/watch?v=${YT}`, `https://evil.com/?u=https://www.tiktok.com/@a/video/${TT}`, "https://www.instagram.com/p/C8aBcD_eFgH/", `youtube.com/shorts/${YT}`]) await enviar(A, "falso " + l);
  await B.waitForSelector(".msg:not(.mine) .vis:has-text('falso youtube.com/shorts')", { timeout: 30000 });
  assert.equal(await B.locator(".vcard").count(), antes, "nenhum cartão novo"); await B.waitForFunction(() => !document.querySelector("iframe"), null, { timeout: 5000 });
});
t("nenhum erro de página", async () => { assert.deepEqual(erros, []); });
