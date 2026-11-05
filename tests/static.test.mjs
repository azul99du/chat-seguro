// Verificações estáticas do código e do schema: pegam erros de segurança comuns antes de irem para o ar.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const APP = ["guarda.js", "app.js", "media.js", "crypto.js", "store.js", "ratchet.js", "verify.js", "reply.js"];
const rastreados = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" }).split("\n").filter(Boolean);

describe("código", () => {
  for (const f of APP) test(`${f}: sintaxe válida`, () => execFileSync("node", ["--check", join(raiz, f)]));

  test("todos os imports relativos existem", () => {
    for (const f of APP) for (const m of ler(f).matchAll(/from\s+"(\.[^"]+)"/g)) assert.ok(existsSync(join(raiz, dirname(f), m[1])), `${f} importa ${m[1]}`);
  });
  test("nada que injete HTML ou execute texto como código", () => {
    for (const f of APP) {
      const src = ler(f).replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/, `${f}`);
    }
  });
  test("o app só é carregado pelo guarda.js (que bloqueia navegadores embutidos e molduras)", () => {
    const html = ler("index.html"), scripts = [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
    assert.deepEqual(scripts, ['<script src="guarda.js">'], "index.html não pode carregar app.js diretamente");
    assert.match(ler("guarda.js"), /import\("\.\/app\.js"\)/);
    assert.match(ler("guarda.js"), /Instagram/); assert.match(ler("guarda.js"), /window\.top !== window\.self/);
  });
  test("nenhuma biblioteca de terceiros carregada de CDN (tudo local)", () => {
    for (const f of [...APP, "index.html"]) assert.doesNotMatch(ler(f), /(src|from)\s*=?\s*["']https?:\/\//, `${f} carrega script externo`);
  });
  test("nenhuma chave secreta no repositório (só a chave publishable)", () => {
    for (const f of rastreados.filter((x) => !/\.(png|jpg|lock)$/.test(x) && !x.startsWith("vendor/") && !x.startsWith("tests/") && x !== "package-lock.json")) {
      const t = ler(f);
      assert.doesNotMatch(t, /service_role|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY/, f);
    }
    assert.match(ler("config.js"), /sb_publishable_[A-Za-z0-9_-]+/);
  });
});

describe("ícones do site", () => {
  test("favicon (svg e ico) e ícone do iOS existem e estão ligados no index.html", () => {
    const html = ler("index.html");
    for (const [rel, arq] of [["icon", "favicon.svg"], ["icon", "favicon.ico"], ["apple-touch-icon", "apple-touch-icon.png"]]) {
      assert.match(html, new RegExp(`<link rel="${rel}" href="${arq.replace(".", "\\.")}"`), arq);
      assert.ok(existsSync(join(raiz, arq)), `${arq} não existe`);
    }
    assert.match(readFileSync(join(raiz, "favicon.svg"), "utf8"), /<svg[^>]+viewBox/);
    assert.doesNotMatch(readFileSync(join(raiz, "favicon.svg"), "utf8"), /<script|onload|href=["']http/i, "SVG sem script nem recursos externos");
    assert.deepEqual([...readFileSync(join(raiz, "favicon.ico")).subarray(0, 4)], [0, 0, 1, 0], "cabeçalho ICO");
    assert.deepEqual([...readFileSync(join(raiz, "apple-touch-icon.png")).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG");
  });
});

describe("política de segurança do navegador (CSP)", () => {
  const html = ler("index.html"), csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";
  const dir = (n) => csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(n + " ")) ?? "";
  test("existe e só roda script do próprio site", () => {
    assert.ok(csp, "meta CSP ausente");
    assert.equal(dir("script-src"), "script-src 'self'");
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /object-src 'none'/);
  });
  test("só conversa com o Supabase configurado em config.js", () => {
    const host = new URL(ler("config.js").match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1]).host;
    assert.equal(dir("connect-src"), `connect-src https://${host} wss://${host}`);
  });
});

describe("banco (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql");
  test("toda tabela do schema público tem RLS ligado", () => {
    const tabelas = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    assert.ok(tabelas.length >= 6, `esperava as tabelas do app, achei ${tabelas}`);
    for (const t of tabelas) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} sem RLS`);
  });
  test("nenhuma policy dá acesso ao papel anônimo (anon)", () => {
    for (const p of sql.matchAll(/create policy[\s\S]*?;/g)) assert.doesNotMatch(p[0], /\bto\s+(anon|public)\b/i, p[0].slice(0, 80));
  });
  test("funções SECURITY DEFINER fixam search_path e negam execução a anon", () => {
    const funcoes = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)[\s\S]*?\$\$;/g)].filter((f) => /security definer/i.test(f[0]));
    assert.ok(funcoes.length >= 5, "esperava find_user, get_prekey, consome, pode_enviar_arquivo...");
    for (const f of funcoes) {
      assert.match(f[0], /set search_path = public/, `${f[1]} sem search_path`);
      assert.match(sql, new RegExp(`revoke all on function public\\.${f[1]}\\([^)]*\\) from public, anon, authenticated`), `${f[1]} deve negar execução a anon`);
    }
  });
  test("há limites de uso: mensagens, lote, buscas, prekeys e arquivos", () => {
    for (const nome of ["limita_mensagens", "limita_lote_mensagens", "limita_prekeys", "limita_lote_prekeys", "consome", "pode_enviar_arquivo"]) assert.match(sql, new RegExp(`function public\\.${nome}\\(`), nome);
    assert.match(sql, /perform public\.consome\('find_user'/); assert.match(sql, /perform public\.consome\('get_prekey'/);
    assert.match(sql, /with check[\s\S]*public\.pode_enviar_arquivo\(\)/);
  });
  test("toda tabela do app exige o 2º passo (política restritiva) para quem ativou a verificação", () => {
    const tabelas = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]).filter((n) => n !== "limite_uso");
    for (const tb of [...tabelas, "storage.objects", "realtime.messages"].map((n) => n.replace(/^(?!storage|realtime)/, "public."))) {
      assert.match(sql, new RegExp(`create policy "exige dois passos" on ${tb.replace(".", "\\.")}\\s+as restrictive`), tb);
    }
    assert.match(sql, /if not public\.mfa_ok\(\) then raise exception/, "as buscas (consome) também exigem");
  });
  test("só mensagens com sigilo futuro (v=2) podem ser inseridas", () => {
    const ultima = [...sql.matchAll(/create policy "envia como si mesmo"[\s\S]*?;/g)].pop()[0];
    assert.match(ultima, /v = 2/);
  });
});
