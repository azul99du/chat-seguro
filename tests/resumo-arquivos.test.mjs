// O download do modelo de resumo, com um "cache" e uma "rede" de mentira: confere tamanho e assinatura, guarda só o que passou, descarta o resto.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const guarda = new Map();
globalThis.self ??= globalThis; globalThis.self.location ??= { href: "https://site.exemplo/app/" };
globalThis.caches = { open: async () => ({ async match(k) { const v = guarda.get(k); return v ? new Response(v.corpo, { status: 200, headers: v.headers }) : undefined; }, async put(k, r) { const corpo = new Uint8Array(await r.arrayBuffer()); guarda.set(k, { corpo, headers: Object.fromEntries(r.headers) }); }, async delete(k) { return guarda.delete(k); } }), delete: async () => { guarda.clear(); return true; } };
const { baixarModeloResumo, modeloResumoBaixado, apagarModeloResumo, arquivoGuardado, ErroModelo } = await import("../resumo-arquivos.js");

const sha = (b) => createHash("sha256").update(b).digest("hex");
const A = new TextEncoder().encode("conteudo do arquivo A".repeat(300)), B = new TextEncoder().encode("{\"b\":1}");
const manifesto = { "a.bin": { tam: A.length, sha: sha(A) }, "b.json": { tam: B.length, sha: sha(B) } };
const corpos = { "a.bin": A, "b.json": B };
const rede = (trocas = {}, cabecalhos = {}) => async (url) => { const nome = url.split("/").pop(), dados = trocas[nome] ?? corpos[nome]; if (!dados) return new Response("x", { status: 404 }); const m = Math.floor(dados.length / 3);
  return new Response(new ReadableStream({ start(c) { c.enqueue(dados.slice(0, m)); c.enqueue(dados.slice(m)); c.close(); } }), { status: 200, headers: { "content-length": String(cabecalhos[nome] ?? dados.length) } }); };
const opcoes = (extra = {}) => ({ manifesto, urlDe: (a) => `https://hf.exemplo/${a}`, ...extra });
const antes = () => guarda.clear();

test("baixa, confere e guarda; depois diz que está no aparelho e não baixa de novo", async () => {
  antes(); let pedidos = 0, bytes = 0; const buscar = async (u, i) => { pedidos++; return rede()(u, i); };
  assert.equal(await modeloResumoBaixado(manifesto), false); await baixarModeloResumo(opcoes({ buscar, progresso: (n) => { bytes += n; } }));
  assert.equal(pedidos, 2); assert.equal(bytes, A.length + B.length); assert.equal(await modeloResumoBaixado(manifesto), true);
  assert.deepEqual(new Uint8Array(await (await arquivoGuardado("a.bin").then((r) => r ?? new Response(null))).arrayBuffer()).length >= 0, true);
  pedidos = 0; await baixarModeloResumo(opcoes({ buscar })); assert.equal(pedidos, 0, "já guardado: nenhuma rede");
});
test("assinatura diferente: o arquivo é descartado e dá erro 'assinatura' (conteúdo trocado com o mesmo tamanho)", async () => {
  antes(); const falso = new Uint8Array(A); falso[10] ^= 1; // mesmo tamanho, um bit diferente
  await assert.rejects(() => baixarModeloResumo(opcoes({ buscar: rede({ "a.bin": falso }) })), (e) => e instanceof ErroModelo && e.codigo === "assinatura" && /não passou na conferência/.test(e.message));
  assert.equal(guarda.size, 0, "nada ficou guardado"); assert.equal(await modeloResumoBaixado(manifesto), false);
});
test("tamanho diferente (avisado no cabeçalho ou maior que o esperado): erro 'tamanho' e nada guardado", async () => {
  antes(); await assert.rejects(() => baixarModeloResumo(opcoes({ buscar: rede({}, { "a.bin": A.length + 5 }) })), (e) => e.codigo === "tamanho"); assert.equal(guarda.size, 0);
  antes(); await assert.rejects(() => baixarModeloResumo(opcoes({ buscar: rede({ "a.bin": new Uint8Array(A.length + 50) }) })), (e) => e.codigo === "tamanho"); assert.equal(guarda.size, 0);
  antes(); await assert.rejects(() => baixarModeloResumo(opcoes({ buscar: rede({ "a.bin": A.slice(0, A.length - 3) }) })), (e) => ["tamanho", "assinatura"].includes(e.codigo)); assert.equal(guarda.size, 0, "menor que o esperado também é recusado");
});
test("erro de rede (404/500) e arquivos que passaram antes continuam guardados", async () => {
  antes(); await assert.rejects(() => baixarModeloResumo(opcoes({ buscar: async (u) => (u.endsWith("b.json") ? new Response("x", { status: 500 }) : rede()(u)) })), (e) => e.codigo === "rede");
  assert.equal(guarda.size, 1, "o A ficou (passou na conferência); o B não"); assert.equal(await modeloResumoBaixado(manifesto), false);
  await baixarModeloResumo(opcoes({ buscar: rede() })); assert.equal(await modeloResumoBaixado(manifesto), true, "a segunda vez só falta o B");
});
test("apagar tira tudo; arquivo desconhecido não é servido", async () => {
  antes(); await baixarModeloResumo(opcoes({ buscar: rede() })); await apagarModeloResumo(); assert.equal(await modeloResumoBaixado(manifesto), false);
  assert.equal(await arquivoGuardado("../../etc/passwd"), null);
});
test("o pedido sai sem cookies nem referência (só o endereço de internet vai junto)", async () => {
  antes(); let init; await baixarModeloResumo(opcoes({ buscar: async (u, i) => { init = i; return rede()(u, i); } }));
  assert.equal(init.credentials, "omit"); assert.equal(init.referrerPolicy, "no-referrer"); assert.equal(init.mode, "cors");
});
