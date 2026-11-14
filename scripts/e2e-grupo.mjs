// Divide a lista de testes de ponta a ponta (package.json → test:e2e) em N grupos de peso parecido e imprime os arquivos do grupo I (1..N).
// Uso: node scripts/e2e-grupo.mjs <I> <N> [--sem-funcoes]   (--sem-funcoes tira os testes que precisam das Edge Functions, que o banco local do CI não tem)
import { readFileSync, statSync } from "node:fs";
const [i, n] = [Number(process.argv[2]), Number(process.argv[3])], semFuncoes = process.argv.includes("--sem-funcoes");
const SO_NO_PROJETO_DE_TESTE = ["tests/e2e/aparelhos.test.mjs", "tests/e2e/notificacoes.test.mjs"];
const lista = JSON.parse(readFileSync("package.json", "utf8")).scripts["test:e2e"].split(/\s+/).filter((x) => x.endsWith(".mjs"));
const arquivos = semFuncoes ? lista.filter((f) => !SO_NO_PROJETO_DE_TESTE.includes(f)) : lista;
const peso = (f) => statSync(f).size; // tamanho do arquivo ≈ quantos testes/passos ele tem
const grupos = Array.from({ length: n }, () => ({ total: 0, fs: [] }));
for (const f of [...arquivos].sort((a, b) => peso(b) - peso(a))) { const g = grupos.reduce((m, x) => (x.total < m.total ? x : m)); g.fs.push(f); g.total += peso(f); }
if (!(i >= 1 && i <= n)) { console.error("grupo inválido"); process.exit(2); }
console.log(grupos[i - 1].fs.join(" "));
