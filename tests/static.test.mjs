// Verificações estáticas do código e do schema: pegam erros de segurança comuns antes de irem para o ar.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const APP = ["guarda.js", "app.js", "media.js", "crypto.js", "store.js", "ratchet.js", "verify.js", "reply.js", "sticker.js", "recorte.js", "recorte-config.js", "sam2.js", "figurinhas.js", "avatar.js", "historico.js", "video.js", "aparelhos.js", "dispositivos.js", "grupo.js", "videolink.js", "lista.js", "usuario.js", "cores.js", "estatisticas.js", "selos.js", "snapshot.js", "visto.js", "sw.js", "supabase/functions/notificar/vapid.js"];
const rastreados = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" }).split("\n").filter(Boolean);

describe("código", () => {
  for (const f of APP) test(`${f}: sintaxe válida`, () => execFileSync("node", ["--check", join(raiz, f)]));

  test("todos os imports relativos existem", () => {
    for (const f of APP) for (const m of ler(f).matchAll(/from\s+"(\.[^"]+)"/g)) assert.ok(existsSync(join(raiz, dirname(f), m[1].split("?")[0])), `${f} importa ${m[1]}`);
  });
  test("nada que injete HTML ou execute texto como código", () => {
    for (const f of APP) {
      const src = ler(f).replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/, `${f}`);
    }
  });
  test("o app só é carregado pelo guarda.js (que bloqueia navegadores embutidos e molduras)", () => {
    const html = ler("index.html"), scripts = [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
    assert.equal(scripts.length, 1, "index.html carrega um único script"); assert.match(scripts[0], /^<script src="guarda\.js(\?v=[0-9a-f]+)?">$/, "index.html não pode carregar app.js diretamente");
    assert.match(ler("guarda.js"), /import\("\.\/app\.js(\?v=[0-9a-f]+)?"\)/);
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

describe("visual", () => {
  test("sem o destaque azul do toque no celular (tap highlight)", () => assert.match(ler("style.css"), /-webkit-tap-highlight-color:\s*transparent/));
});

describe("política de segurança do navegador (CSP)", () => {
  const html = ler("index.html"), csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";
  const dir = (n) => csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(n + " ")) ?? "";
  test("existe e só roda script do próprio site", () => {
    assert.ok(csp, "meta CSP ausente");
    assert.equal(dir("script-src"), "script-src 'self' 'wasm-unsafe-eval'", "wasm-unsafe-eval só deixa compilar WebAssembly (recorte inteligente); não libera eval de texto");
    assert.doesNotMatch(csp, /unsafe-inline|(?<!wasm-)unsafe-eval|\*/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /object-src 'none'/);
  });
  test("só conversa com o Supabase configurado em config.js", () => {
    const host = new URL(ler("config.js").match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1]).host;
    assert.equal(dir("connect-src"), `connect-src 'self' https://${host} wss://${host}`);
  });
});

describe("avisos push (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql");
  test("inscrições: RLS, só o dono vê/apaga, registro só pela função, no máximo 5 por pessoa", () => {
    assert.match(sql, /alter table public\.push_subscriptions enable row level security/); assert.match(sql, /revoke all on public\.push_subscriptions from anon, authenticated/);
    assert.match(sql, /grant select, delete on public\.push_subscriptions to authenticated/); assert.doesNotMatch(sql, /grant [^;]*insert[^;]*on public\.push_subscriptions/); assert.match(sql, /limit 5\)/);
  });
  test("configuração interna (chave privada de push): ninguém logado lê", () => {
    assert.match(sql, /alter table public\.push_config enable row level security/); assert.match(sql, /revoke all on public\.push_config from anon, authenticated/); assert.doesNotMatch(sql, /create policy "[^"]*" on public\.push_config\s+for (select|all)/);
  });
  test("o cliente não escreve 'notificada' e o gatilho só dispara para mensagens que querem aviso", () => {
    const ultimo = [...sql.matchAll(/grant insert \(([^)]*)\) on public\.messages to authenticated/g)].pop()[1];
    assert.equal(ultimo, "recipient_id, ciphertext, iv, v, header, avisar, grupo_id, citado, para_aparelho", "o cliente só escolhe destinatário, conteúdo cifrado, aviso, grupo, quem foi citado e o aparelho de destino (nunca de_aparelho: quem preenche é o servidor)"); assert.doesNotMatch(ultimo, /de_aparelho/); assert.match(sql, /when \(new\.avisar\)/);
  });
});

describe("vários aparelhos, etapa 2 (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql");
  test("o servidor preenche de_aparelho e confere o destino; funções internas não são chamáveis; as de política e as do app têm permissão só para logados", () => {
    assert.match(sql, /create trigger confere_aparelho_mensagem before insert on public\.messages/); assert.match(sql, /new\.de_aparelho := /);
    for (const f of ["confere_aparelho_mensagem\\(\\)", "recuperacao_prazo\\(\\)"]) { assert.match(sql, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated`)); assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}`)); }
    for (const f of ["get_prekeys_aparelhos\\(uuid\\)", "marcar_lidas\\(bigint\\[\\]\\)", "dispositivos_conta\\(\\)", "pedir_recuperacao\\(\\)", "cancelar_recuperacao\\(\\)", "concluir_recuperacao\\(\\)"]) assert.match(sql, new RegExp(`grant execute on function public\\.${f} to authenticated`));
  });
  test("a leitura de mensagens exige aparelho não pendente e só mostra a cópia do próprio aparelho", () => {
    const pol = [...sql.matchAll(/alter policy "le proprias mensagens"[\s\S]*?;\n/g)].pop()[0]; assert.match(pol, /aparelho_estado\(\)/); assert.match(pol, /para_aparelho = \(select public\.aparelho_ref\(\)\)/); assert.match(pol, /recipient_id <> sender_id/);
  });
  test("sem atalho: a recuperação é a única forma de um pendente virar aprovado sem permissão (24 h, relógio do banco)", () => {
    const reg = [...sql.matchAll(/create or replace function public\.registrar_dispositivo[\s\S]*?\$\$;/g)].pop()[0]; assert.doesNotMatch(reg, /vira o primeiro|elsif r\.estado = 'pendente'/);
    assert.match(sql, /interval '24 hours'/); assert.match(sql, /now\(\) < cur\.recuperacao_pedida_em \+ public\.recuperacao_prazo\(\)/);
  });
});

describe("armazenamento (supabase/schema.sql)", () => {
  test("meu_uso_arquivos só soma os arquivos da própria pessoa e exige o 2º passo", () => {
    const f = ler("supabase/schema.sql").match(/create or replace function public\.meu_uso_arquivos\(\)[\s\S]*?\$\$;/)[0];
    assert.match(f, /owner_id = \(select auth\.uid\(\)\)::text/); assert.match(f, /public\.mfa_ok\(\)/); assert.match(f, /bucket_id = 'media'/);
  });
});

describe("política de segurança: nada de estilo escrito direto no HTML", () => {
  test("index.html não tem atributo style (a política só aceita o style.css; o navegador reclamaria em toda abertura)", () => assert.doesNotMatch(ler("index.html"), /\sstyle\s*=\s*["']/));
});

describe("fontes", () => {
  const html = ler("index.html"), css = ler("style.css");
  const link = html.match(/fonts\.googleapis\.com\/css2\?([^"]+)"/)[1].replace(/&amp;/g, "&");
  const carregados = {};
  for (const m of link.matchAll(/family=([^:&]+)(?::wght@([\d;]+))?/g)) carregados[m[1].replace(/\+/g, " ")] = (m[2] || "400").split(";").map(Number);
  const familia = { "--body": "Instrument Sans", "--display": "Syne", "--mono": "DM Mono" };
  test("todo peso pedido no CSS (font: <peso> ... var(--fonte)) é um peso realmente carregado (senão o navegador engrossa à força)", () => {
    for (const m of css.matchAll(/font:\s*(\d{3})\s[^;}]*var\((--body|--display|--mono)/g)) assert.ok(carregados[familia[m[2]]]?.includes(Number(m[1])), `${familia[m[2]]} ${m[1]} não está no link de fontes`);
  });
  test("títulos das páginas de configuração usam a mesma fonte dos diálogos (Syne)", () => {
    assert.match(css, /dialog\.pagina \.pg-bar h2\{[^}]*var\(--display\)/);
  });
});

describe("cache do navegador", () => {
  test("as URLs de CSS/JS levam a versão do conteúdo (rode `npm run versionar` depois de mexer no site)", async () => {
    const { emDia } = await import("../scripts/versionar.mjs"); const r = emDia();
    assert.deepEqual(r.velhos, [], "versão desatualizada em: " + r.velhos.join(", "));
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
  test("limites de envio (etapa 3): conferidos uma vez por pedido; 100 linhas por pedido; 300 mensagens/min e 5000/h; teto de linhas 3000/min e 30000/h", () => {
    const lote = [...sql.matchAll(/create or replace function public\.limita_lote_mensagens\(\)[\s\S]*?end \$\$;/g)].pop()[0];
    assert.match(lote, /from novas\) > 100/); assert.match(lote, /count\(distinct m\.created_at\) filter \(where m\.created_at > now\(\) - interval '1 minute'\) > 300/); assert.match(lote, /count\(distinct m\.created_at\) > 5000/);
    assert.match(lote, /count\(\*\) filter \(where m\.created_at > now\(\) - interval '1 minute'\) > 3000/); assert.match(lote, /count\(\*\) > 30000/); assert.match(lote, /interval '1 hour'/);
    const linha = [...sql.matchAll(/create or replace function public\.limita_mensagens\(\)[\s\S]*?end \$\$;/g)].pop()[0]; assert.doesNotMatch(linha, /select|count/, "o gatilho por linha não consulta mais nada");
    assert.match(sql, /alter table public\.messages drop constraint messages_aparelho_so_a_dois;/);
    const pol = [...sql.matchAll(/alter policy "envia como si mesmo"[\s\S]*?;\n/g)].pop()[0]; assert.match(pol, /recipient_id = \(select auth\.uid\(\)\) and para_aparelho is not null and public\.membro_de\(grupo_id::text\)/, "a mim mesmo num grupo: só cópia para outro aparelho, e só se participo"); assert.match(pol, /aparelho_estado\(\)/);
    assert.match(sql, /function public\.get_prekeys_grupo\(p_grupo uuid\)[\s\S]*?nao_esta_no_grupo[\s\S]*?d\.estado = 'aprovado'/);
    assert.match(sql, /revoke all on function public\.get_prekeys_grupo\(uuid\) from public, anon, authenticated;\ngrant execute on function public\.get_prekeys_grupo\(uuid\) to authenticated;/);
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

describe("grupos (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql");
  test("as tabelas de grupo não são legíveis nem graváveis direto: só pelas funções", () => {
    for (const t of ["grupos", "grupo_membros"]) { assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`)); assert.doesNotMatch(sql, new RegExp(`grant [^;]* on public\\.${t} to authenticated`)); }
  });
  test("mensagem de grupo só entra se quem envia e quem recebe estão no grupo", () => {
    const ultima = [...sql.matchAll(/create policy "envia como si mesmo"[\s\S]*?;/g)].pop()[0];
    assert.match(ultima, /grupo_id is null or public\.pode_enviar_ao_grupo\(grupo_id, recipient_id\)/);
    const f = sql.match(/create or replace function public\.pode_enviar_ao_grupo[\s\S]*?\$\$;/)[0];
    assert.match(f, /gm\.user_id = \(select auth\.uid\(\)\)/); assert.match(f, /gm\.user_id = p_dest/);
  });
  test("criar, adicionar, remover e renomear: limite de uso, só admin muda, só entra quem já conversou com quem adiciona", () => {
    const f = (n) => [...sql.matchAll(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?\\$\\$;`, "g"))].pop()[0]; // (a definição mais recente)
    for (const n of ["criar_grupo", "grupo_adicionar", "grupo_remover", "grupo_renomear"]) assert.match(f(n), /perform public\.consome\(/, n);
    for (const n of ["grupo_adicionar", "grupo_renomear"]) assert.match(f(n), /gm\.admin\) then raise exception 'so_admin'/, n);
    const rem = f("grupo_remover"); assert.match(rem, /p_user is distinct from u and not coalesce\(eu\.admin or \(eu\.sub and not alvo\.admin and not alvo\.sub\), false\)/, "remover outra pessoa: admin qualquer um, sub-admin só membro comum; sair: qualquer um");
    const cargo = f("grupo_cargo"); assert.match(cargo, /gm\.admin\) then raise exception 'so_admin'/, "só o admin dá cargo (sub-admin não dá)"); assert.match(cargo, /and not gm\.admin;/, "e nunca muda o cargo de um admin"); assert.match(f("grupo_foto"), /gm\.admin\) then raise exception 'so_admin'/, "só o admin muda a foto");
    assert.match(f("grupo_foto"), /p_grupo::text \|\| '\/\[0-9a-f-\]\{36\}\$'/, "a foto tem de estar na pasta do grupo");
    for (const n of ["criar_grupo", "grupo_adicionar"]) assert.match(f(n), /not public\.ja_conversou\(/, n);
    assert.match(f("ja_conversou"), /m\.sender_id = \(select auth\.uid\(\)\) and m\.recipient_id = p_outro[\s\S]*m\.sender_id = p_outro and m\.recipient_id = \(select auth\.uid\(\)\)/, "os dois lados já escreveram");
    assert.match(f("meus_grupos"), /public\.mfa_ok\(\)/);
  });
  test("arquivos de grupo: só quem está no grupo baixa", () => {
    const ultima = [...sql.matchAll(/create policy "le midia das suas conversas"[\s\S]*?;/g)].pop()[0];
    assert.match(ultima, /public\.membro_de\(\(storage\.foldername\(name\)\)\[2\]\)/);
  });
});

describe("citação e aviso de grupo (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql");
  test("só mensagem de grupo pode ter a marca de citado, e só ela (citada) dispara o push em grupo; conversa a dois continua avisando", () => {
    assert.match(sql, /check \(not citado or grupo_id is not null\)/);
    const gatilho = [...sql.matchAll(/create trigger notifica_mensagem[^;]*;/g)].pop()[0]; assert.match(gatilho, /when \(new\.avisar and \(new\.grupo_id is null or new\.citado\)\)/);
  });
  test("um admin nunca é sub-admin ao mesmo tempo", () => assert.match(sql, /check \(not \(admin and sub\)\)/));
});

describe("vídeos curtos: política de segurança", () => {
  const html = ler("index.html"), csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)[1], dir = (n) => csp.split(";").map((x) => x.trim()).find((x) => x.startsWith(n + " ")) ?? "";
  test("só as três redes podem ser carregadas em moldura (nada mais, sem curinga) e a lista é a mesma de videolink.js", async () => {
    const { HOSTS_PLAYER } = await import("../videolink.js");
    assert.equal(dir("frame-src"), "frame-src " + HOSTS_PLAYER.join(" "));
    assert.doesNotMatch(dir("frame-src"), /\*|http:/); assert.match(csp, /default-src 'none'/);
  });
  test("a moldura do player vai sem cookies de login, sem referência, sem permissões e isolada", () => {
    const js = ler("app.js"), f = js.slice(js.indexOf("function quadroDoVideo"), js.indexOf("async function abrirVideo"));
    assert.match(f, /credentialless/); assert.match(f, /sandbox/); assert.match(f, /referrerpolicy/); assert.match(f, /"allow", "autoplay; fullscreen; picture-in-picture"/);
    assert.doesNotMatch(f, /allow-top-navigation|allow-forms|allow-modals|allow-downloads/, "o player não pode navegar a página nem baixar arquivos");
  });
  test("o vídeo só é carregado depois de um toque (nenhuma moldura no HTML)", () => assert.doesNotMatch(ler("index.html"), /<iframe/));
});

describe("fluxo de publicação (CI em duas etapas)", () => {
  const ci = ler(".github/workflows/ci.yml"), sh = ler("scripts/publicar.sh");
  test("na main os testes só são pulados se ESTE hash já passou, por completo, em OUTRA branch", () => {
    assert.match(ci, /refs\/heads\/main/); assert.match(ci, /status=success/); assert.match(ci, /head_branch!="main"/); assert.match(ci, /head_sha=="\$\{\{ github\.sha \}\}"/); assert.match(ci, /event=="push"/);
    assert.match(ci, /actions: read/); assert.doesNotMatch(ci, /contents: write|id-token: write|pull-requests: write/, "o CI continua só com permissão de leitura de conteúdo");
    assert.equal((ci.match(/needs\.ja-testado\.outputs\.pular != 'true'/g) || []).length, 3, "os três grupos de testes (rápidos, ponta a ponta local e Edge Functions) dependem da conferência");
  });
  test("um envio direto à main (sem ter passado antes) roda tudo: pular começa falso", () => assert.match(ci, /pular=false\n/));
  test("o script só leva à main um hash com CI bem-sucedido e nunca força a main", () => {
    assert.match(sh, /ci_passou\)" -gt 0/); assert.match(sh, /refs\/heads\/main"/); assert.doesNotMatch(sh, /--force[^\n]*main|\+\$sha:refs\/heads\/main/, "sem push forçado na main");
    assert.match(sh, /--force origin "\$sha:refs\/heads\/ci\/teste"/, "só a branch de teste é forçada"); assert.match(sh, /versionar\.mjs --check/);
  });
});

describe("trocar nome de usuário (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql"), f = [...sql.matchAll(/create or replace function public\.trocar_nome\([\s\S]*?\$\$;/g)].pop()[0];
  test("a função confere formato, nome existente, nome reservado de outra pessoa e o prazo de 30 dias; exige o 2º passo e usa limite de uso", () => {
    assert.match(f, /perform public\.consome\('trocar_nome'/); assert.match(f, /\^\[a-z0-9_\]\{3,20\}\$/); assert.match(f, /exists \(select 1 from public\.profiles p where p\.username = novo\)/);
    assert.match(f, /n\.username = novo and n\.user_id <> u and n\.trocado_em > now\(\) - interval '30 days'/); assert.match(f, /ultimo > now\(\) - interval '30 days'/); assert.match(f, /errcode = '23505'/);
  });
  test("a lista de nomes antigos não é legível nem gravável direto, e o cadastro também respeita os nomes reservados", () => {
    assert.match(sql, /alter table public\.nomes_antigos enable row level security/); assert.match(sql, /revoke all on public\.nomes_antigos from anon, authenticated/); assert.doesNotMatch(sql, /grant [^;]* on public\.nomes_antigos to authenticated/);
    assert.match(sql, /create trigger profiles_nome_reservado before insert on public\.profiles/); assert.match(sql, /grant execute on function public\.trocar_nome\(text\) to authenticated/);
  });
  test("o prazo do banco (30 dias) é o mesmo do app", async () => { const { DIAS_TROCA } = await import("../usuario.js"); assert.equal(DIAS_TROCA, 30); assert.equal((sql.match(/interval '30 days'/g) || []).length >= 4, true); });
});

describe("cor no grupo (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql"), f = (n) => [...sql.matchAll(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?\\$\\$;`, "g"))].pop()[0];
  test("a cor só tem o formato p0..p9 ou #rrggbb, e o banco impede repetir cor no mesmo grupo (índice único)", () => {
    assert.match(sql, /add column cor text check \(cor is null or cor ~ '\^\(p\[0-9\]\|#\[0-9a-f\]\{6\}\)\$'\)/); assert.match(sql, /create unique index grupo_membros_cor_unica on public\.grupo_membros \(grupo_id, cor\) where cor is not null/);
  });
  test("escolher a cor: só a própria linha, formato conferido, conflito vira 'cor_em_uso'; quem entra ganha a primeira cor livre", () => {
    const g = f("grupo_cor"); assert.match(g, /gm\.grupo_id = p_grupo and gm\.user_id = u/); assert.match(g, /p_cor !~/); assert.match(g, /unique_violation then raise exception 'cor_em_uso'/); assert.match(g, /perform public\.consome\(/);
    assert.match(f("criar_grupo"), /public\.cor_livre\(p_id\)/); assert.match(f("grupo_adicionar"), /public\.cor_livre\(p_grupo\)/); assert.match(sql, /revoke all on function public\.cor_livre\(uuid\) from public, anon, authenticated/);
    assert.match(f("meus_grupos"), /m\.cor/);
  });
});

describe("aparelhos da conta (supabase/schema.sql)", () => {
  const sql = ler("supabase/schema.sql"), f = (n) => [...sql.matchAll(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?\\$\\$;`, "g"))].pop()[0];
  test("tabelas fechadas: RLS, sem acesso direto, política dos dois passos", () => {
    for (const tb of ["dispositivos", "dispositivo_sessoes"]) { assert.match(sql, new RegExp(`revoke all on public\\.${tb} from anon, authenticated`)); assert.doesNotMatch(sql, new RegExp(`grant [^;]* on public\\.${tb} to authenticated`)); }
    assert.match(sql, /estado text not null check \(estado in \('pendente', 'aprovado'\)\)/); assert.match(sql, /id text not null check \(id ~ '\^\[0-9a-f\]\{32\}\$'\)/);
  });
  test("só as quatro funções do app são chamáveis; as internas não", () => {
    for (const [n, a] of [["registrar_dispositivo", "text"], ["meus_dispositivos", ""], ["decidir_dispositivo", "uuid, boolean"], ["remover_dispositivo", "uuid"]]) assert.match(sql, new RegExp(`grant execute on function public\\.${n}\\(${a}\\) to authenticated`), n);
    for (const n of ["dispositivo_atual", "valida_aparelho_prekey"]) { assert.match(sql, new RegExp(`revoke all on function public\\.${n}\\(\\) from public, anon, authenticated`)); assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${n}\\(`)); }
  });
  test("regras no servidor: limite de 5, 1º aparelho aprovado, só aprovado decide, recusar e remover apagam as chaves, tudo com limite de uso", () => {
    const r = f("registrar_dispositivo"); assert.match(r, />= 5 then raise exception 'limite_de_aparelhos'/); assert.match(r, /pg_advisory_xact_lock/); assert.match(r, /public\.mfa_ok\(\)/);
    assert.match(f("decidir_dispositivo"), /cur\.estado <> 'aprovado' then return false/); assert.match(f("decidir_dispositivo"), /d\.estado = 'pendente'/);
    assert.match(f("remover_dispositivo"), /alvo\.id <> cur\.id and cur\.estado <> 'aprovado' then return false/);
    for (const n of ["decidir_dispositivo", "remover_dispositivo"]) assert.match(f(n), /delete from public\.prekeys k where k\.user_id = u and k\.aparelho = alvo\.id/);
    for (const n of ["registrar_dispositivo", "meus_dispositivos", "decidir_dispositivo", "remover_dispositivo"]) assert.match(f(n), /perform public\.consome\('/, n);
    assert.doesNotMatch(f("meus_dispositivos"), /\bd\.id,/, "o identificador secreto não é devolvido");
    assert.match(f("decidir_dispositivo"), /delete from auth\.sessions[\s\S]*delete from public\.dispositivos/, "recusar desconecta o aparelho antes de apagar o registro");
    assert.match(f("remover_dispositivo"), /if alvo\.id <> cur\.id then\s+delete from auth\.sessions[\s\S]*delete from public\.dispositivos/, "remover OUTRO desconecta; a auto-remoção não");
    assert.match(f("meus_dispositivos"), /from auth\.sessions/, "sessão encerrada não lista nada");
  });
  test("prekeys: a marca do aparelho só é aceita para o aparelho da sessão e a coluna não é legível", () => {
    assert.match(sql, /alter table public\.prekeys add column aparelho text check \(aparelho is null or aparelho ~ '\^\[0-9a-f\]\{32\}\$'\)/);
    assert.match(sql, /grant select \(user_id, id, public_key, created_at\) on public\.prekeys to authenticated/);
    assert.match(f("valida_aparelho_prekey"), /dispositivo_atual\(\)\)\.id is distinct from new\.aparelho/); assert.match(sql, /create trigger valida_aparelho_prekey before insert on public\.prekeys/);
  });
});
