// Realtime: quem pode ler e quem pode PUBLICAR em cada canal. Roda no navegador (o WebSocket do Node trava com a biblioteca).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P;
const t = (nome, fn) => test(nome, { timeout: 90000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext()).newPage(); await P.goto(srv.url);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

// entra no canal privado `topico` e tenta publicar um broadcast; devolve { entrou, publicou }
const tentar = (anonimo, topico) => P.evaluate(async ({ url, key, anonimo, topico }) => {
  const { createClient } = await import("/vendor/supabase.js");
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!anonimo) { const e = `lacre.rt.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@gmail.com`; const { data, error } = await c.auth.signUp({ email: e, password: "senha-teste-123" }); if (error || !data.session) return { entrou: "sem sessão", publicou: "-" }; await c.realtime.setAuth(data.session.access_token); }
  return new Promise((res) => {
    const ch = c.channel(topico, { config: { private: true, broadcast: { ack: true } } }); let fim = false;
    const sai = (o) => { if (!fim) { fim = true; res(o); setTimeout(() => c.removeChannel(ch), 0); } }; setTimeout(() => sai({ entrou: "timeout", publicou: "-" }), 9000);
    ch.subscribe(async (s) => {
      if (s === "SUBSCRIBED") { const r = await Promise.race([ch.send({ type: "broadcast", event: "x", payload: { a: 1 } }), new Promise((ok) => setTimeout(() => ok("timeout"), 4000))]); sai({ entrou: "sim", publicou: r }); }
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) sai({ entrou: s, publicou: "-" });
    });
  });
}, { url: SUPABASE_URL, key: SUPABASE_KEY, anonimo, topico });

t("anônimo não entra em nenhum canal (nem para ler)", async () => {
  for (const topico of ["online", "msgs"]) assert.notEqual((await tentar(true, topico)).entrou, "sim", topico);
});
t("conta logada entra em 'online' e consegue publicar presença/broadcast ali", async () => {
  const r = await tentar(false, "online"); assert.equal(r.entrou, "sim"); assert.equal(r.publicou, "ok");
});
t("conta logada entra em 'msgs' (para ouvir), mas NÃO consegue publicar nele", async () => {
  const r = await tentar(false, "msgs"); assert.equal(r.entrou, "sim", "precisa entrar: é por onde chegam as mensagens");
  assert.notEqual(r.publicou, "ok", "publicar em 'msgs' deve ser negado: " + r.publicou);
});
t("canal com outro nome é recusado", async () => { assert.notEqual((await tentar(false, "qualquer-outro")).entrou, "sim"); });
