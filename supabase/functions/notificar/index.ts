// Avisos push do Lacre. Roda no Supabase (Edge Function). NÃO recebe nem vê o conteúdo de mensagem nenhuma:
// o aviso é um "toque na campainha" sem texto; o navegador acorda o Lacre e ele mesmo mostra "Você tem uma nova mensagem".
//  GET   -> devolve a chave pública de push (o navegador precisa dela para se inscrever)
//  POST  -> { mensagem, destinatario } vindo do gatilho do banco; confere que a mensagem existe, é recente e ainda não foi avisada
import { createClient } from "jsr:@supabase/supabase-js@2";
import { gerarChaves, jwtVapid, cabecalhoVapid } from "./vapid.js";

const ASSUNTO = "https://azul99du.github.io/chat-seguro/";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;

async function chaves(db: ReturnType<typeof createClient>) {
  const ler = async () => {
    const { data } = await db.from("push_config").select("chave,valor").in("chave", ["vapid_public", "vapid_private_jwk"]);
    const m = Object.fromEntries((data ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor]));
    return m.vapid_public && m.vapid_private_jwk ? { publica: m.vapid_public as string, privadaJwk: JSON.parse(m.vapid_private_jwk) } : null;
  };
  const atual = await ler(); if (atual) return atual;
  const nova = await gerarChaves(); // primeira vez: cria e guarda (a privada só o servidor lê)
  await db.from("push_config").upsert([{ chave: "vapid_public", valor: nova.publica }, { chave: "vapid_private_jwk", valor: JSON.stringify(nova.privadaJwk) }], { onConflict: "chave", ignoreDuplicates: true });
  return (await ler()) ?? nova;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const k = await chaves(db);
    if (req.method === "GET") return json({ chave: k.publica });
    if (req.method !== "POST") return json({ erro: "metodo" }, 405);
    const b = await req.json().catch(() => null);
    const id = Number(b?.mensagem), dest = String(b?.destinatario ?? "");
    if (!Number.isSafeInteger(id) || id <= 0 || !UUID.test(dest)) return json({ erro: "dados" }, 400);
    // só avisa de mensagem de verdade: existe, é do destinatário, é recente, quer aviso e ainda não foi avisada (a marca é atômica: sem aviso em dobro)
    const { data: m } = await db.from("messages").select("id,recipient_id,created_at,avisar,notificada").eq("id", id).maybeSingle();
    if (!m || m.recipient_id !== dest || !m.avisar || m.notificada || Date.now() - new Date(m.created_at).getTime() > 120_000) return json({ ok: false });
    const { data: marcada } = await db.from("messages").update({ notificada: true }).eq("id", id).eq("notificada", false).select("id");
    if (!marcada?.length) return json({ ok: false });
    const { data: subs } = await db.from("push_subscriptions").select("id,endpoint").eq("user_id", dest);
    let enviados = 0;
    await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string }) => {
      try {
        const jwt = await jwtVapid(k.privadaJwk, s.endpoint, ASSUNTO);
        const r = await fetch(s.endpoint, { method: "POST", headers: { Authorization: cabecalhoVapid(jwt, k.publica), TTL: "86400", Urgency: "high", Topic: "lacre" } }); // sem corpo: nada de conteúdo
        if (r.status === 404 || r.status === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // inscrição expirada: some
        else if (r.ok) enviados++;
        await r.body?.cancel();
      } catch { /* um serviço de push fora do ar não impede os outros */ }
    }));
    return json({ ok: true, enviados });
  } catch { return json({ erro: "interno" }, 500); }
});
