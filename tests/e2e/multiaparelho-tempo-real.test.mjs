// Vários aparelhos, etapa 2: o TEMPO REAL (postgres_changes) respeita a política nova. A cópia endereçada ao aparelho X não chega ao aparelho Y da mesma conta,
// nem a pendente, nem a outra conta; a cópia para mim mesmo só chega ao aparelho de destino. Roda no navegador (o WebSocket do Node trava com a biblioteca).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { configurado, motivoSemConfig, prepararSite, servir, cadastroFunciona, SUPABASE_URL, SUPABASE_KEY } from "./env.mjs";

let skip = configurado ? false : motivoSemConfig, browser, srv, P;
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (c) => (skip ? c.skip(skip) : fn(c)));
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  srv = await servir(prepararSite()); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  P = await (await browser.newContext()).newPage(); await P.goto(srv.url);
});
after(async () => { if (browser) { await browser.close(); await srv.close(); } });

t("tempo real: cada aparelho recebe só as cópias dele (a do outro aparelho, a do pendente e a de outra conta não chegam)", async () => {
  const r = await P.evaluate(async ({ url, key }) => {
    const { createClient } = await import("/vendor/supabase.js");
    const mk = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const dorme = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const conta = async (n) => {
      const email = `lacre.rt2.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@gmail.com`, c0 = mk(), s = await c0.auth.signUp({ email, password: "senha-teste-123" });
      if (s.error || !s.data.session) throw new Error("cadastro: " + (s.error?.message || "sem sessão"));
      const id = s.data.user.id, p = await c0.from("profiles").insert({ id, username: "rt" + Math.random().toString(36).slice(2, 10), public_key: { kty: "EC", crv: "P-256", x: "x", y: "y" } }); if (p.error) throw p.error;
      const cs = [c0]; for (let i = 1; i < n; i++) { const c = mk(), l = await c.auth.signInWithPassword({ email, password: "senha-teste-123" }); if (l.error) throw l.error; cs.push(c); }
      const refs = []; for (const c of cs) { const e = await c.rpc("registrar_dispositivo", { p_id: hex() }); if (e.error) throw e.error; refs.push((await c.rpc("dispositivos_conta")).data.find((a) => a.atual).ref); }
      return { id, cs, refs };
    };
    const A = await conta(3), B = await conta(1), X = await conta(1);
    for (const i of [1]) { const d = await A.cs[0].rpc("decidir_dispositivo", { p_ref: A.refs[i], p_permitir: true }); if (d.data !== true) throw new Error("aprovar"); } // A: 0 e 1 aprovados, 2 pendente
    const ouvir = async (c, uid) => {
      const eventos = [], ch = c.channel("msgs", { config: { private: true } });
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` }, (p) => eventos.push(p.new.id));
      await new Promise((ok, no) => { setTimeout(() => no(new Error("timeout ao entrar no canal")), 15000); ch.subscribe((s) => { if (s === "SUBSCRIBED") ok(); else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) no(new Error("canal: " + s)); }); });
      return eventos;
    };
    const [e0, e1, e2, eb, ex] = [await ouvir(A.cs[0], A.id), await ouvir(A.cs[1], A.id), await ouvir(A.cs[2], A.id), await ouvir(B.cs[0], B.id), await ouvir(X.cs[0], X.id)];
    await dorme(1500);
    const linha = (to, para) => ({ recipient_id: to, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: { sid: hex(), dh: { x: "x", y: "y" }, pn: 0, n: 0 }, para_aparelho: para });
    // B manda a A: uma cópia para cada aparelho aprovado + uma tentativa para o pendente (recusada pelo servidor)
    const ins = await B.cs[0].from("messages").insert([linha(A.id, A.refs[0]), linha(A.id, A.refs[1])]).select("id"); if (ins.error) throw ins.error;
    const [idA0, idA1] = ins.data.map((x) => x.id);
    const pendente = await B.cs[0].from("messages").insert(linha(A.id, A.refs[2]));
    // formato antigo (sem aparelho): todos os aprovados recebem; o pendente não
    const antigo = (await B.cs[0].from("messages").insert(linha(A.id, null)).select("id").single()).data.id;
    // cópia para mim mesmo: do aparelho 0 de A para o aparelho 1 de A
    const propria = (await A.cs[0].from("messages").insert(linha(A.id, A.refs[1])).select("id").single()).data.id;
    // A manda para B e para X (outra conta): X não recebe o que é de B
    const paraB = (await A.cs[0].from("messages").insert(linha(B.id, B.refs[0])).select("id").single()).data.id;
    await dorme(5000);
    return { idA0, idA1, antigo, propria, paraB, pendenteErro: pendente.error?.code || null, e0, e1, e2, eb, ex };
  }, { url: SUPABASE_URL, key: SUPABASE_KEY });
  assert.equal(r.pendenteErro, "42501", "o servidor recusa cópia para aparelho pendente");
  assert.ok(!r.e0.includes(r.idA1), "o aparelho 0 NÃO recebe a cópia endereçada ao aparelho 1");
  assert.deepEqual(r.e0.sort(), [r.idA0, r.antigo, r.propria].sort(), "aparelho 0 de A: a cópia dele, o formato antigo e (só) a cópia para si que ELE MESMO criou (o servidor devolve o que o aparelho acabou de gravar; o app ignora)");
  assert.deepEqual(r.e1.sort(), [r.idA1, r.antigo, r.propria].sort(), "aparelho 1 de A: a cópia dele, o formato antigo e a cópia que o aparelho 0 mandou para ele");
  assert.deepEqual(r.e2, [], "o aparelho pendente não recebe NADA pelo tempo real (nem o formato antigo)");
  assert.deepEqual(r.eb, [r.paraB], "B recebe só o que A mandou para ele (e nada do que é de A para A)"); assert.deepEqual(r.ex, [], "outra conta não recebe nada");
  assert.ok(r.paraB, "(controle)");
});
