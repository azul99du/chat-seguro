// Áudios em sequência: ao ouvir um, os áudios seguidos logo abaixo tocam sozinhos, um depois do outro; um texto no meio encerra a sequência.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, novoEmail, novoUsuario, SENHA, FRASE, chamar } from "./env.mjs";
import { hasFfmpeg, tmp, makeAudio } from "../helpers/fixtures.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, A, B, nomeA, nomeB, mp3;
const t = (nome, fn) => test(nome, { timeout: 200000 }, async (c) => (skip ? c.skip(skip) : !hasFfmpeg() ? c.skip("ffmpeg não instalado") : fn(c)));
const pronto = (p) => p.waitForSelector("#chat:not([hidden]):not(.preparando)", { timeout: 30000 });
async function cadastrar(page, usuario) { await page.goto(srv.url); await page.click("#tab-signup"); await page.fill("#username", usuario); await page.fill("#email", novoEmail()); await page.fill("#password", SENHA); await page.click("#auth-submit"); await page.waitForSelector("#ask[open]", { timeout: 30000 }); await page.fill("#ask-input", FRASE); await page.click("#ask button[value=ok]"); await pronto(page); }
const enviar = async (p, txt) => { await p.fill("#text", txt); await p.click("#send-form .primary"); };
const enviarAudio = async (p) => { await p.setInputFiles("#file", mp3); await p.waitForSelector("#pending-info.ok", { timeout: 25000 }); await p.click("#send-form .primary"); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
// anota, na ordem, qual áudio da lista começou a tocar (o botão do player ganha a classe "on")
const vigiar = (ctx) => ctx.addInitScript(() => { window.__ordem = []; const ini = () => { const L = document.getElementById("messages"); if (!L) return setTimeout(ini, 50);
  new MutationObserver((ms) => { for (const m of ms) { const e = m.target; if (m.type === "attributes" && e.classList?.contains("play") && e.classList.contains("on")) { const i = [...L.querySelectorAll(".media.audio")].indexOf(e.closest(".media.audio")); if (window.__ordem.at(-1) !== i) window.__ordem.push(i); } } }).observe(L, { attributes: true, attributeFilter: ["class"], subtree: true }); }; document.addEventListener("DOMContentLoaded", ini); });
const ordem = (p) => p.evaluate(() => window.__ordem);
const quantos = (p) => p.locator(".msg .media.audio").count();

before(async () => {
  if (skip || !hasFfmpeg()) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); mp3 = makeAudio(tmp(), "mp3"); // 2 s
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ca = await browser.newContext(), cb = await browser.newContext(); await vigiar(cb);
  [A, B] = [await ca.newPage(), await cb.newPage()]; [nomeA, nomeB] = [novoUsuario("a"), novoUsuario("b")]; await cadastrar(A, nomeA); await cadastrar(B, nomeB);
  await chamar(A, nomeB); await A.waitForSelector(`#conv-title:text-is("@${nomeB}")`);
  for (let i = 1; i <= 3; i++) { await enviarAudio(A); await A.waitForFunction((n) => document.querySelectorAll(".msg.mine .media.audio").length >= n, i, { timeout: 30000 }); }
  await enviar(A, "texto no meio"); await A.waitForSelector(".msg.mine .vis:has-text('texto no meio')", { timeout: 30000 });
  await enviarAudio(A); await A.waitForFunction(() => document.querySelectorAll(".msg.mine .media.audio").length >= 4, null, { timeout: 30000 });
  await B.waitForSelector("#contacts button .unread", { timeout: 30000 }); await B.click("#contacts button"); await B.waitForSelector("#messages:not(.carregando) .msg"); await B.waitForFunction(() => document.querySelectorAll(".msg .media.audio").length >= 4, null, { timeout: 30000 });
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("ouvir o 1º áudio toca o 2º e o 3º sozinhos, em ordem, e PARA no texto: o 4º (depois do texto) não toca", async () => {
  assert.equal(await quantos(B), 4);
  await B.locator(".msg .media.audio button.audio-ph").first().click();
  await B.waitForFunction(() => window.__ordem.length >= 3, null, { timeout: 40000 });
  assert.deepEqual((await ordem(B)).slice(0, 3), [0, 1, 2], "tocou o 1º, depois o 2º e o 3º");
  await dorme(5000); // tempo de sobra para o 4º tocar, se fosse tocar
  assert.deepEqual(await ordem(B), [0, 1, 2], "a sequência termina no texto: o 4º áudio não toca sozinho");
  assert.equal(await B.locator(".msg .media.audio .play.on").count(), 0, "nada fica tocando no fim");
});

t("ouvir um áudio do MEIO toca ele e só os de baixo (não volta aos de cima)", async () => {
  await B.reload(); await pronto(B); await B.click("#contacts button"); await B.waitForSelector("#messages:not(.carregando) .msg");
  await B.waitForFunction(() => document.querySelectorAll(".msg .media.audio").length >= 4, null, { timeout: 30000 });
  // (os áudios já ouvidos ficam guardados no aparelho e voltam como player pronto; os que não, como botão "Ouvir áudio": os dois casos valem)
  const segundo = B.locator(".msg .media.audio").nth(1); const bt = segundo.locator("button.audio-ph, .play");
  await bt.first().click();
  await B.waitForFunction(() => window.__ordem.length >= 2, null, { timeout: 40000 }); await dorme(4500);
  assert.deepEqual(await ordem(B), [1, 2], "tocou o 2º e o 3º; o 1º (acima) e o 4º (depois do texto) não");
});
