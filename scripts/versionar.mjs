// Carimba uma versão (?v=...) nos arquivos do site, para o navegador nunca misturar página nova com CSS/JS velho em cache.
// O GitHub Pages deixa os arquivos em cache por 10 minutos; com a versão na URL, qualquer mudança no conteúdo vira um endereço novo.
// Uso: `npm run versionar` (grava)  ·  `node scripts/versionar.mjs --check` (só confere; os testes rodam isto).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = /\?v=[0-9a-f]{6,}/g;
const RE_JS = /((?:\bfrom\s+|\bimport\()\s*")(\.\/[A-Za-z0-9_-]+\.js)(?:\?v=[0-9a-f]+)?(")/g;   // import estático e dinâmico entre módulos
const RE_HTML = /((?:href|src)=")(style\.css|guarda\.js)(?:\?v=[0-9a-f]+)?(")/g;
const modulos = (raiz) => readdirSync(raiz).filter((f) => f.endsWith(".js") && f !== "sw.js").sort(); // sw.js é atualizado pelo próprio navegador

export function calcular(raiz = RAIZ) {
  const arquivos = [...modulos(raiz), "style.css", "index.html"];
  const h = createHash("sha256");
  for (const f of arquivos) h.update(f + "\0" + readFileSync(join(raiz, f), "utf8").replace(V, "") + "\0");
  const versao = h.digest("hex").slice(0, 10);
  const saidas = new Map();
  for (const f of modulos(raiz)) saidas.set(f, readFileSync(join(raiz, f), "utf8").replace(RE_JS, `$1$2?v=${versao}$3`));
  saidas.set("index.html", readFileSync(join(raiz, "index.html"), "utf8").replace(RE_HTML, `$1$2?v=${versao}$3`));
  return { versao, saidas };
}
export function emDia(raiz = RAIZ) {
  const { versao, saidas } = calcular(raiz); const velhos = [];
  for (const [f, novo] of saidas) if (readFileSync(join(raiz, f), "utf8") !== novo) velhos.push(f);
  return { versao, velhos };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { versao, saidas } = calcular(), { velhos } = emDia();
  if (process.argv.includes("--check")) { if (velhos.length) { console.error(`Versão desatualizada em: ${velhos.join(", ")}. Rode: npm run versionar`); process.exit(1); } console.log("versão em dia:", versao); }
  else { for (const f of velhos) writeFileSync(join(RAIZ, f), saidas.get(f)); console.log(`versão ${versao}: ${velhos.length} arquivo(s) atualizado(s)`); }
}
