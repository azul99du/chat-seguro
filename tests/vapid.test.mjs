// Avisos push: chave e token VAPID (RFC 8292) e o service worker (sem conteúdo nenhum nas notificações).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gerarChaves, jwtVapid, cabecalhoVapid, b64u, desb64u } from "../supabase/functions/notificar/vapid.js";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const partes = (jwt) => jwt.split(".");
const json = (p) => JSON.parse(Buffer.from(desb64u(p)).toString());

describe("VAPID", () => {
  test("chave pública: 65 bytes não comprimidos (0x04) em base64url; privada é JWK P-256", async () => {
    const k = await gerarChaves(), pub = desb64u(k.publica);
    assert.equal(pub.length, 65); assert.equal(pub[0], 4); assert.doesNotMatch(k.publica, /[+/=]/);
    assert.equal(k.privadaJwk.kty, "EC"); assert.equal(k.privadaJwk.crv, "P-256"); assert.ok(k.privadaJwk.d, "tem a parte privada");
  });
  test("token JWT: cabeçalho ES256, audiência = origem do serviço, validade curta e assunto https; assinatura confere", async () => {
    const k = await gerarChaves(), agora = Date.UTC(2026, 10, 7, 12, 0, 0), jwt = await jwtVapid(k.privadaJwk, ENDPOINT, "https://azul99du.github.io/chat-seguro/", agora);
    const [h, c, s] = partes(jwt);
    assert.deepEqual(json(h), { typ: "JWT", alg: "ES256" });
    const claims = json(c); assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, "https://azul99du.github.io/chat-seguro/");
    assert.equal(claims.exp, Math.floor(agora / 1000) + 12 * 3600); assert.ok(claims.exp - Math.floor(agora / 1000) <= 24 * 3600, "validade de no máximo 24 h");
    assert.equal(desb64u(s).length, 64, "assinatura r||s de 64 bytes");
    const pub = await crypto.subtle.importKey("raw", desb64u(k.publica), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, desb64u(s), new TextEncoder().encode(`${h}.${c}`)), "a assinatura confere com a chave pública");
    const outra = await gerarChaves(), pub2 = await crypto.subtle.importKey("raw", desb64u(outra.publica), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub2, desb64u(s), new TextEncoder().encode(`${h}.${c}`)), false, "outra chave não valida");
  });
  test("a validade nunca passa de 24 h, mesmo se pedirem mais", async () => {
    const k = await gerarChaves(), agora = Date.now(), c = json(partes(await jwtVapid(k.privadaJwk, ENDPOINT, "https://x.example/", agora, 10 * 24 * 3600))[1]);
    assert.ok(c.exp * 1000 - agora < 24 * 3600 * 1000);
  });
  test("audiência muda com o serviço (Mozilla, Apple)", async () => {
    const k = await gerarChaves();
    for (const e of ["https://updates.push.services.mozilla.com/wpush/v2/xyz", "https://web.push.apple.com/abc"]) assert.equal(json(partes(await jwtVapid(k.privadaJwk, e, "https://x.example/"))[1]).aud, new URL(e).origin);
  });
  test("assunto inválido é recusado; cabeçalho no formato 'vapid t=…, k=…'", async () => {
    const k = await gerarChaves(); await assert.rejects(() => jwtVapid(k.privadaJwk, ENDPOINT, "azul@exemplo"), /assunto/);
    assert.equal(cabecalhoVapid("T", "K"), "vapid t=T, k=K");
  });
  test("base64url faz ida e volta", () => { const b = Uint8Array.from([251, 255, 0, 1, 62, 63]); assert.deepEqual([...desb64u(b64u(b))], [...b]); });
});

describe("service worker e função (conteúdo nunca viaja)", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8"), fn = readFileSync(new URL("../supabase/functions/notificar/index.ts", import.meta.url), "utf8");
  test("a notificação é genérica e não vem do aviso (sem event.data)", () => {
    assert.match(sw, /Você tem uma nova mensagem/); assert.doesNotMatch(sw, /e\.data|event\.data|\.json\(\)/, "o aviso não carrega texto");
  });
  test("com o Lacre visível na tela não mostra notificação", () => assert.match(sw, /visibilityState === "visible"[\s\S]{0,40}return/));
  test("a função manda push sem corpo, com TTL e tópico, e confere a mensagem antes (existe, do destinatário, recente, não avisada)", () => {
    assert.doesNotMatch(fn, /body:\s*(JSON|new|`)/, "o push em si não leva corpo");
    for (const trecho of ["recipient_id !== dest", "m.notificada", "120_000", ".eq(\"notificada\", false)", "TTL", "Topic", "404 || r.status === 410"]) assert.ok(fn.includes(trecho), trecho);
  });
});
