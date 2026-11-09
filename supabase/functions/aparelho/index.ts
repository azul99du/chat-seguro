// Registro dos aparelhos que entram na conta (para a tela "Aparelhos conectados"). Roda no Supabase (Edge Function) e exige login (verify_jwt).
// Guarda só: navegador, sistema, tipo, país/região/cidade APROXIMADOS, datas e uma versão embaralhada do código do aparelho. NUNCA guarda o endereço IP nem o texto bruto do navegador.
// A região vem de uma consulta ao serviço público ipwho.is feita AQUI, no servidor, com o IP e mais nada (sem nome, conta ou mensagens), uma vez por sessão por dia.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { descreverAparelho } from "./ua.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const claims = (jwt: string) => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); } catch { return null; } };
const ipDe = (req: Request) => (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
const publico = (ip: string) => ip && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc|fd|fe80)/i.test(ip);
async function local(ip: string) {
  if (!publico(ip)) return null;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,region,city`, { signal: AbortSignal.timeout(3000) });
    const d = await r.json(); if (!d?.success) return null;
    const lim = (s: unknown, n = 80) => (typeof s === "string" && s ? s.slice(0, n) : null);
    return { pais_codigo: /^[A-Z]{2}$/.test(d.country_code ?? "") ? d.country_code : null, regiao: lim(d.region), cidade: lim(d.city) };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const c = claims((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!c || !UUID.test(c.sub ?? "") || !UUID.test(c.session_id ?? "") || c.role !== "authenticated") return json({ erro: "sessao" }, 401);
  const corpo = await req.json().catch(() => null), disp = typeof corpo?.disp === "string" && /^[0-9a-f]{32}$/.test(corpo.disp) ? corpo.disp : null;
  // só guardamos uma versão embaralhada (e amarrada a esta conta) do código do aparelho: o código em si nunca fica no servidor
  const hash = disp ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${c.sub}:${disp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("") : null;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { data: ja } = await db.from("aparelhos").select("session_id,user_id,ultimo_acesso,local_em,disp_hash").eq("session_id", c.session_id).maybeSingle();
    if (ja && ja.user_id !== c.sub) return json({ erro: "sessao" }, 403);
    const agora = new Date();
    if (ja && !ja.disp_hash && hash) await db.from("aparelhos").update({ disp_hash: hash }).eq("session_id", c.session_id); // sessão antiga: passa a ter código (para o próximo login deste navegador ser reconhecido)
    if (ja) { // sessão já registrada: só atualiza o último acesso (no máximo a cada 5 min) e renova o local uma vez por dia
      const velhoLocal = !ja.local_em || agora.getTime() - new Date(ja.local_em).getTime() > 86_400_000;
      if (!velhoLocal && agora.getTime() - new Date(ja.ultimo_acesso).getTime() < 300_000) return json({ ok: true });
      const mudanca: Record<string, unknown> = { ultimo_acesso: agora.toISOString() };
      if (velhoLocal) { const l = await local(ipDe(req)); if (l) Object.assign(mudanca, l, { local_em: agora.toISOString() }); }
      await db.from("aparelhos").update(mudanca).eq("session_id", c.session_id);
      return json({ ok: true });
    }
    const info = descreverAparelho(req.headers.get("user-agent") ?? ""), l = await local(ipDe(req));
    // aviso de aparelho novo: o PRIMEIRO aparelho da conta, e quem volta com o MESMO CÓDIGO de um aparelho já reconhecido, entram como "reconhecido"; o resto fica para a pessoa conferir
    const { data: outros } = await db.from("aparelhos").select("decisao,disp_hash").eq("user_id", c.sub);
    const conhecido = !outros?.length || (!!hash && outros.some((o: { decisao: string | null; disp_hash: string | null }) => o.decisao === "reconhecido" && o.disp_hash === hash));
    const { error } = await db.from("aparelhos").insert({ session_id: c.session_id, user_id: c.sub, ...info, ...(l ?? {}), local_em: l ? agora.toISOString() : null, disp_hash: hash, decisao: conhecido ? "reconhecido" : null, decidido_em: conhecido ? agora.toISOString() : null });
    if (error && error.code !== "23505") return json({ erro: "gravar" }, 500);
    // guarda só os 30 mais recentes de cada pessoa
    const { data: todos } = await db.from("aparelhos").select("session_id").eq("user_id", c.sub).order("ultimo_acesso", { ascending: false }).range(30, 200);
    if (todos?.length) await db.from("aparelhos").delete().in("session_id", todos.map((x: { session_id: string }) => x.session_id));
    return json({ ok: true });
  } catch { return json({ erro: "interno" }, 500); }
});
