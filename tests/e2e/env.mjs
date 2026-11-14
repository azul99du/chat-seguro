// Ambiente dos testes de ponta a ponta: sobe uma cópia do site apontada para um projeto Supabase DE TESTE.
import { createServer } from "node:http";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "../helpers/fixtures.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cfg = readFileSync(join(raiz, "config.js"), "utf8");
const PROD_URL = cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1], PROD_KEY = cfg.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/)[1];

export const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_KEY = process.env.SUPABASE_KEY;
export const configurado = !!(SUPABASE_URL && SUPABASE_KEY);
// Banco local do CI (Supabase CLI em Docker): só é aceito em 127.0.0.1, nunca outro endereço sem https.
if (configurado && new URL(SUPABASE_URL).protocol === "http:" && !["127.0.0.1", "localhost"].includes(new URL(SUPABASE_URL).hostname))
  throw new Error("SUPABASE_URL sem https só é aceito para o banco local (127.0.0.1).");
export const motivoSemConfig = "defina SUPABASE_URL e SUPABASE_KEY de um projeto Supabase DE TESTE";
// Trava: estes testes criam contas e mensagens. Nunca contra o banco que as pessoas usam, a menos que se peça explicitamente.
if (configurado && SUPABASE_URL === PROD_URL && process.env.ALLOW_PROD !== "1")
  throw new Error("SUPABASE_URL aponta para o banco REAL do app. Use um projeto de teste (ou ALLOW_PROD=1 sabendo o que faz).");

const rand = () => Math.random().toString(36).slice(2, 8);
export const novoEmail = () => `lacre.e2e.${Date.now().toString(36)}.${rand()}@${process.env.E2E_EMAIL_DOMAIN || "gmail.com"}`;
export const novoUsuario = (p = "u") => `${p}${Date.now().toString(36).slice(-5)}${rand()}`.slice(0, 20);
export const SENHA = "senha-teste-123", FRASE = "frase-longa-de-teste";
export const apiKey = SUPABASE_KEY;

// Cópia do site com a URL/chave (config.js e CSP do index.html) trocadas pelas do projeto de teste.
export function prepararSite() {
  const dir = tmp(), arquivos = ["index.html", "style.css", "guarda.js", "app.js", "media.js", "crypto.js", "store.js", "ratchet.js", "verify.js", "reply.js", "sticker.js", "recorte.js", "recorte-config.js", "sam2.js", "figurinhas.js", "avatar.js", "historico.js", "video.js", "aparelhos.js", "dispositivos.js", "grupo.js", "videolink.js", "lista.js", "usuario.js", "cores.js", "estatisticas.js", "selos.js", "snapshot.js", "visto.js", "loja.js", "config.js", "favicon.svg", "favicon.ico", "apple-touch-icon.png", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  for (const f of arquivos) cpSync(join(raiz, f), join(dir, f));
  symlinkSync(join(raiz, "vendor"), join(dir, "vendor"), "dir"); // (link em vez de cópia: são ~75 MB de modelos por teste)
  const host = (u) => new URL(u).host;
  for (const f of ["config.js", "index.html"]) {
    const p = join(dir, f); let t = readFileSync(p, "utf8");
    t = t.replaceAll(host(PROD_URL), host(SUPABASE_URL)).replaceAll(PROD_KEY, SUPABASE_KEY).replaceAll(PROD_URL, SUPABASE_URL);
    // banco local (só 127.0.0.1, sem https): o CSP precisa liberar http/ws no lugar de https/wss
    if (new URL(SUPABASE_URL).protocol === "http:") t = t.replaceAll(`https://${host(SUPABASE_URL)}`, `http://${host(SUPABASE_URL)}`).replaceAll(`wss://${host(SUPABASE_URL)}`, `ws://${host(SUPABASE_URL)}`);
    if (f === "config.js") t += `\ntry { if (localStorage.getItem("lacre:poll") === null) localStorage.setItem("lacre:poll", "4000"); } catch {} // testes: a verificação periódica de chegada a cada 4 s (o normal é 30 s)\n`;
    writeFileSync(p, t);
  }
  return dir;
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
export function servir(dir) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const caminho = req.url.split("?")[0], f = join(dir, caminho === "/" ? "index.html" : decodeURIComponent(caminho)); // (o endereço pode vir com ?parametros)
      if (!f.startsWith(dir) || !existsSync(f)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }).end(readFileSync(f));
    }).listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${s.address().port}/`, close: () => new Promise((r) => s.close(r)) }));
  });
}

// O cadastro precisa devolver sessão na hora. Se o projeto exige confirmação de e-mail, os testes se pulam com aviso.
export async function cadastroFunciona() {
  const { createClient } = await import("../../vendor/supabase.js");
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signUp({ email: novoEmail(), password: SENHA });
  if (error || !data.session) return { ok: false, motivo: error?.message || "o projeto exige confirmação de e-mail (desligue 'Confirm email' em Authentication → Providers → Email)" };
  return { ok: true };
}

// Tela inicial: a conta fica no menu da foto (topo) e "Chamar" é um botão flutuante que abre uma folha.
export async function menuConta(p, item) { // abre o menu (se preciso) e toca num item: "#sec-btn", "#logout", "#notif-btn", "#menu-foto", "#copiar-nome"
  if (!(await p.locator("#menu-conta").isVisible())) { await p.click("#eu-foto"); await p.waitForSelector("#menu-conta:not([hidden])"); }
  if (item) await p.click(item);
}
export async function chamar(p, nome) { // botão "Chamar" → digita o nome → abre a conversa
  await p.click("#chamar-fab"); await p.waitForSelector("#chamar[open]"); await p.fill("#add-user", nome); await p.click("#add-form button");
}

// Dois "aparelhos" do teste que devem contar como O MESMO aparelho para o aviso (sem alarme): o 2º contexto recebe o mesmo código de aparelho do 1º.
export async function compartilhaCodigo(contexto, paginaOriginal) {
  const codigo = await paginaOriginal.evaluate(() => localStorage.getItem("lacre:disp"));
  if (codigo) await contexto.addInitScript((c) => { try { localStorage.setItem("lacre:disp", c); } catch {} }, codigo);
}

// Vários aparelhos (etapa 2): um aparelho novo na conta entra PENDENTE (tela "Aguardando permissão") e só lê depois que um aparelho já permitido o libera.
export const conferirAba = (p) => p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // o app confere os aparelhos ao voltar para a aba (e esquece a lista guardada de aparelhos dos contatos)
export async function permitirNovo(P) { // no aparelho PERMITIDO: abre o aviso do pedido e toca em Permitir
  for (let i = 0; i < 30; i++) { await conferirAba(P); if (await P.locator("#aviso-disp:not([hidden])").count()) break; await P.waitForTimeout(1500); }
  await P.click("#aviso-disp"); await P.waitForSelector("#aparelhos[open]");
  await P.waitForSelector('#dispositivos-lista .linha[data-estado=pendente] button:has-text("Permitir")', { timeout: 20000 });
  await P.locator('#dispositivos-lista .linha[data-estado=pendente] button:has-text("Permitir")').first().click();
  await P.waitForFunction(() => !document.querySelector("#dispositivos-lista .linha[data-estado=pendente]"), null, { timeout: 20000 });
  await P.click("#aparelhos button[value=cancel]");
}
