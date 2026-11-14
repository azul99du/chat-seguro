// Quem OUVIU o áudio: no grupo, o anel mostra rosa (só viu), âmbar (ouviu um trecho) e verde (ouviu tudo); na conversa a dois, "vista" → "ouviu até 0:02" → "ouvida".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";
import { hasFfmpeg, tmp } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, C, nomeA, nomeB, nomeC, mp3;
const t = (nome, fn) => test(nome, { timeout: 280000 }, async (c) => (skip ? c.skip(skip) : !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const enviarAudio = async (p, n) => { await p.setInputFiles("#file", mp3); await p.waitForSelector("#pending-info.ok", { timeout: 25000 }); await p.click("#send-form .primary"); await p.waitForFunction((k) => document.querySelectorAll(".msg.mine .media.audio").length >= k, n, { timeout: 30000 }); };
const ultimoSelo = (p) => p.locator(".msg.mine:last-of-type .rcpt").innerText().then((x) => x.trim());
const segundos = (p) => p.locator(".msg:not(.mine):last-of-type .player .barra").getAttribute("aria-valuenow").then(Number);
// ouvir o último áudio recebido: toca no "Ouvir áudio" (ou no play) e, se `ate` for dado, pausa quando chegar nesse segundo
async function ouvir(p, ate = null) {
  const ult = p.locator(".msg:not(.mine):last-of-type .media.audio"), bt = ult.locator("button.audio-ph, .play"); await bt.first().click();
  await p.waitForSelector(".msg:not(.mine):last-of-type .player .play.on", { timeout: 30000 });
  if (ate !== null) { await p.waitForFunction((n) => +document.querySelector(".msg:not(.mine):last-of-type .player .barra")?.getAttribute("aria-valuenow") >= n, ate, { timeout: 30000 }); await p.locator(".msg:not(.mine):last-of-type .player .play").click(); }
  else await p.waitForSelector(".msg:not(.mine):last-of-type .player .play:not(.on)", { timeout: 40000 }); // ouve até o fim
}
const abrirGrupoDe = async (p) => { await p.click("#contacts button[data-grupo]"); await p.waitForSelector('#conv-title:text-is("Ouvidos")', { timeout: 15000 }); await p.waitForSelector("#messages:not(.carregando)"); };

before(async () => {
  if (skip || !hasFfmpeg()) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  const d = tmp(); mp3 = join(d, "oito.mp3"); execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:a", "libmp3lame", "-y", mp3]); // 8 s
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const novo = async () => (await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage());
  [A, B, C] = [await novo(), await novo(), await novo()]; [nomeA, nomeB, nomeC] = [novoUsuario("a"), novoUsuario("b"), novoUsuario("c")];
  await cadastrar(A, nomeA); await cadastrar(B, nomeB); await cadastrar(C, nomeC);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await enviar(A, "oi b");
  await chamar(A, nomeC); await A.waitForSelector(`#conv-title:text-is("@${nomeC}")`); await enviar(A, "oi c");
  for (const [P, nome] of [[B, nomeB], [C, nomeC]]) { await P.waitForSelector("#contacts button .unread", { timeout: 30000 }); await P.click("#contacts button"); await P.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await enviar(P, "oi a, aqui é " + nome); await A.waitForSelector(`.msg:not(.mine) .vis:has-text("aqui é ${nome}")`, { timeout: 30000 }).catch(() => {}); }
  await A.click("#chamar-fab"); await A.click("#novo-grupo"); await A.waitForSelector("#grupo-novo[open]"); await A.fill("#gn-nome", "Ouvidos");
  await A.check(`#gn-lista label:has-text("@${nomeB}") .marca`); await A.check(`#gn-lista label:has-text("@${nomeC}") .marca`); await A.click("#gn-criar"); await A.waitForSelector('#conv-title:text-is("Ouvidos")', { timeout: 30000 });
  await B.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 }); await C.waitForSelector("#contacts button[data-grupo]", { timeout: 30000 });
  await abrirGrupoDe(B); await abrirGrupoDe(C); // os dois já estão olhando o grupo
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("grupo: áudio enviado mostra 0/2 (só viram); o B ouve TUDO: 1/2; o C ouve um TRECHO: 2/2 mas sem fechar; o C ouve o resto: 'todos' verde", async () => {
  await enviarAudio(A, 1);
  await A.waitForFunction(() => document.querySelector(".msg.mine:last-of-type .rcpt.vistos.audio"), null, { timeout: 20000 });
  assert.equal(await ultimoSelo(A), "0/2", "viram, mas ninguém ouviu");
  await ouvir(B); // até o fim
  await A.waitForFunction(() => document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() === "1/2", null, { timeout: 40000 });
  await ouvir(C, 2); // só um trecho: pausa em ~2 s de 8
  await A.waitForFunction(() => document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() === "2/2", null, { timeout: 40000 });
  assert.equal(await A.locator(".msg.mine:last-of-type .rcpt").evaluate((e) => e.classList.contains("todos")), false, "o C ouviu só um trecho: não fecha");
  await A.locator(".msg.mine:last-of-type .rcpt").click(); await A.waitForSelector("#visto-grupo[open]"); if (process.env.FOTO) { await A.screenshot({ path: process.env.FOTO + "-janela.png" }); await A.keyboard.press("Escape"); await A.screenshot({ path: process.env.FOTO + "-lista.png" }); await A.locator(".msg.mine:last-of-type .rcpt").click(); await A.waitForSelector("#visto-grupo[open]"); } // (foto opcional para conferir o visual)
  const d = await A.locator("#visto-grupo").innerText();
  assert.match(d, /2 de 2 ouviram/i); assert.match(d, /ouviram\s/i); assert.match(d, new RegExp("@" + nomeB + "[\\s\\S]*ouviu", "i"), "o B só 'ouviu' (ouviu tudo)"); assert.match(d, /ouviram um trecho/i);
  assert.match(d, new RegExp("@" + nomeC + "[\\s\\S]*ouviu até 0:0[1-4] de 0:08", "i"), "o C: até onde ouviu"); assert.doesNotMatch(d, /só viram/i);
  assert.doesNotMatch(await A.locator("#visto-grupo .vt-pessoa", { hasText: nomeB }).innerText(), /ouviu até/, "quem ouviu tudo só diz que ouviu");
  await A.keyboard.press("Escape");
  await ouvir(C); // continua de onde parou, até o fim
  await A.waitForFunction(() => document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() === "todos", null, { timeout: 60000 });
  assert.equal(await A.locator(".msg.mine:last-of-type .rcpt").evaluate((e) => e.classList.contains("todos")), true, "todos ouviram tudo: verde");
});

t("conversa a dois: 'vista' → 'ouviu até 0:02' → 'ouvida'", async () => {
  await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando)");
  await B.click(`#contacts button:not([data-grupo]):has-text("@${nomeA}")`); await B.waitForSelector(`#conv-title:text-is("@${nomeA}")`); await B.waitForSelector("#messages:not(.carregando)");
  await enviarAudio(A, 1); // (nesta conversa é o primeiro áudio meu)
  await A.waitForFunction(() => /vista/.test(document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent || ""), null, { timeout: 40000 }); // o B está com a conversa aberta: leu
  await ouvir(B, 2);
  await A.waitForFunction(() => /^ouviu até 0:0[1-4]$/.test(document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() || ""), null, { timeout: 40000 });
  assert.equal(await A.locator(".msg.mine:last-of-type .rcpt").evaluate((e) => e.classList.contains("parte")), true, "âmbar");
  await ouvir(B); // até o fim
  await A.waitForFunction(() => /^ouvida \d{2}:\d{2}$/.test(document.querySelector(".msg.mine:last-of-type .rcpt")?.textContent.trim() || ""), null, { timeout: 60000 });
  assert.equal(await A.locator(".msg.mine:last-of-type .rcpt").evaluate((e) => e.classList.contains("read")), true, "verde");
});

t("depois de recarregar o que o servidor sabe continua na tela: 'ouvida' na conversa a dois e 'todos' no grupo", async () => {
  await A.reload(); await pronto(A);
  await A.click(`#contacts button:not([data-grupo]):has-text("@${nomeB}")`); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`); await A.waitForSelector("#messages:not(.carregando) .msg");
  await A.waitForFunction(() => [...document.querySelectorAll(".msg.mine .rcpt")].some((r) => /^ouvida/.test(r.textContent.trim())), null, { timeout: 30000 });
  await abrirGrupoDe(A); await A.waitForFunction(() => [...document.querySelectorAll(".msg.mine .rcpt")].some((r) => r.textContent.trim() === "todos"), null, { timeout: 30000 });
});
