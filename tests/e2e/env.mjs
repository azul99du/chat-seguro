// Ambiente dos testes de ponta a ponta: sobe uma cópia do site apontada para um projeto Supabase DE TESTE.
import { createServer } from "node:http";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "../helpers/fixtures.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cfg = readFileSync(join(raiz, "config.js"), "utf8");
const PROD_URL = cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1], PROD_KEY = cfg.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/)[1];

export const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_KEY = process.env.SUPABASE_KEY;
export const configurado = !!(SUPABASE_URL && SUPABASE_KEY);
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
  const dir = tmp(), arquivos = ["index.html", "style.css", "guarda.js", "app.js", "media.js", "crypto.js", "store.js", "ratchet.js", "verify.js", "reply.js", "sticker.js", "recorte.js", "recorte-config.js", "sam2.js", "figurinhas.js", "avatar.js", "historico.js", "config.js", "favicon.svg", "favicon.ico", "apple-touch-icon.png", "sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  for (const f of arquivos) cpSync(join(raiz, f), join(dir, f));
  cpSync(join(raiz, "vendor"), join(dir, "vendor"), { recursive: true });
  const host = (u) => new URL(u).host;
  for (const f of ["config.js", "index.html"]) {
    const p = join(dir, f); let t = readFileSync(p, "utf8");
    t = t.replaceAll(host(PROD_URL), host(SUPABASE_URL)).replaceAll(PROD_KEY, SUPABASE_KEY).replaceAll(PROD_URL, SUPABASE_URL);
    writeFileSync(p, t);
  }
  return dir;
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
export function servir(dir) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const f = join(dir, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
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
