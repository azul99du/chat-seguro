// Testes do protocolo de sigilo futuro (X3DH simplificado + Double Ratchet). Sem navegador e sem rede.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as R from "../ratchet.js";

const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
const send = async (st, from, to, t) => ({ ...(await R.encrypt(st, from, to, R.bytes(t))), from, to });
const recv = (st, m) => R.decrypt(st, m.from, m.to, m.header, m.ciphertext);
const rejects = (p) => assert.rejects(p);

async function setup() {
  const ikA = await R.genDH(), ikB = await R.genDH(), spkB = await R.genDH(), id = R.randomHex(16);
  const a = await R.initiate(ikA.priv, ikB.pub, { id, ...spkB.pub });
  return { ikA, ikB, spkB, id, a, accept: (h) => R.accept(ikB.priv, ikA.pub, { id, priv: spkB.priv }, h) };
}

describe("sessão e conversa", () => {
  test("A inicia, B aceita e decifra; o servidor nunca vê texto claro", async () => {
    const s = await setup();
    const m1 = await send(s.a, A, B, "oi bob");
    assert.ok(m1.header.init, "1ª mensagem leva os dados de início");
    assert.equal(m1.header.n, 0);
    assert.ok(!JSON.stringify(m1).includes("oi bob"));
    const b = await s.accept(m1.header);
    const d = await recv(b, m1);
    assert.equal(R.text(d.plaintext), "oi bob");
  });

  test("vai-e-vem: cada virada usa chave DH nova e chave/iv diferentes por mensagem", async () => {
    const s = await setup();
    let a = s.a;
    const m1 = await send(a, A, B, "1"); a = m1.state;
    const m2 = await send(a, A, B, "2"); a = m2.state;
    let b = (await recv(await s.accept(m1.header), m1)).state;
    b = (await recv(b, m2)).state;
    const r1 = await send(b, B, A, "resposta"); b = r1.state;
    const da = await recv(a, r1); a = da.state;
    assert.equal(R.text(da.plaintext), "resposta");
    assert.equal(a.init, null, "para de mandar dados de início depois da 1ª resposta");
    assert.notEqual(r1.header.dh.x, m1.header.dh.x);
    const m3 = await send(a, A, B, "3");
    assert.notEqual(m3.ciphertext, m2.ciphertext);
    assert.notEqual(m3.iv, m2.iv);
    assert.equal(R.text((await recv(b, m3)).plaintext), "3");
  });

  test("fora de ordem e mensagem perdida: chaves puladas são guardadas e apagadas após o uso", async () => {
    const s = await setup();
    let a = s.a; const ms = [];
    for (const t of ["x1", "x2", "x3"]) { const m = await send(a, A, B, t); a = m.state; ms.push(m); }
    let b = await s.accept(ms[0].header);
    for (const i of [2, 0, 1]) { const d = await recv(b, ms[i]); b = d.state; assert.equal(R.text(d.plaintext), "x" + (i + 1)); }
    assert.equal(b.skipped.length, 0);
  });

  test("dois lados podem iniciar sessões ao mesmo tempo (ids diferentes)", async () => {
    const s = await setup(), spkA = await R.genDH();
    const b2 = await R.initiate(s.ikB.priv, s.ikA.pub, { id: R.randomHex(16), ...spkA.pub });
    assert.notEqual(s.a.sid, b2.sid);
    assert.ok(R.canSend(s.a) && R.canSend(b2));
  });
});

describe("ataques", () => {
  async function ready() {
    const s = await setup(); let a = s.a;
    const m1 = await send(a, A, B, "primeira"); a = m1.state;
    const b = (await recv(await s.accept(m1.header), m1)).state;
    const m2 = await send(a, A, B, "segunda"); a = m2.state;
    return { ...s, a, b, m1, m2 };
  }

  test("repetir mensagem já lida é recusado", async () => {
    const t = await ready(); const d = await recv(t.b, t.m2);
    await rejects(recv(d.state, t.m2));
  });
  test("cabeçalho adulterado, remetente/destinatário trocados e DH falsa são recusados", async () => {
    const t = await ready();
    await rejects(recv(t.b, { ...t.m2, header: { ...t.m2.header, n: t.m2.header.n + 1 } }));
    await rejects(R.decrypt(t.b, B, A, t.m2.header, t.m2.ciphertext));
    await rejects(R.decrypt(t.b, A, B, { ...t.m2.header, dh: { x: "a", y: "b" } }, t.m2.ciphertext));
  });
  test("salto absurdo de contador é recusado", async () => {
    const t = await ready();
    await rejects(recv(t.b, { ...t.m2, header: { ...t.m2.header, n: 99999 } }));
  });
  test("mensagem inválida NÃO altera o estado (sem desincronização por ataque)", async () => {
    const t = await ready(); const antes = JSON.stringify(t.b);
    await rejects(recv(t.b, { ...t.m2, header: { ...t.m2.header, n: 7 } }));
    assert.equal(JSON.stringify(t.b), antes);
  });
  test("servidor trocando a chave de médio prazo (SPK) de B: ninguém lê a mensagem", async () => {
    const s = await setup(), fake = await R.genDH();
    const ev = await R.initiate(s.ikA.priv, s.ikB.pub, { id: s.id, ...fake.pub });
    const m = await send(ev, A, B, "x");
    await rejects((async () => recv(await s.accept(m.header), m))());
  });
});

describe("sigilo futuro e autocura", () => {
  test("vazar TODO o estado de B hoje não revela nenhuma mensagem anterior", async () => {
    const s = await setup(); let a = s.a, b = null; const past = [];
    const m1 = await send(a, A, B, "s1"); a = m1.state; past.push(m1);
    b = (await recv(await s.accept(m1.header), m1)).state;
    const r1 = await send(b, B, A, "s2"); b = r1.state; a = (await recv(a, r1)).state; past.push(r1);
    for (const t of ["s3", "s4"]) { const m = await send(a, A, B, t); a = m.state; past.push(m); b = (await recv(b, m)).state; }
    const leaked = structuredClone(b);
    for (const m of past) if (m.to === B) await rejects(recv(leaked, m));
  });

  test("autocura: depois que o lado vazado gera chave DH nova e o outro responde, o atacante perde a conversa", async () => {
    const s = await setup(); let a = s.a, b;
    const m1 = await send(a, A, B, "m1"); a = m1.state; b = (await recv(await s.accept(m1.header), m1)).state;
    const r1 = await send(b, B, A, "r1"); b = r1.state; a = (await recv(a, r1)).state;
    const m2 = await send(a, A, B, "m2"); a = m2.state; b = (await recv(b, m2)).state;
    let snap = structuredClone(b);                                   // vazamento do estado de B
    const x1 = await send(a, A, B, "x1"); a = x1.state;
    snap = (await recv(snap, x1)).state; b = (await recv(b, x1)).state; // atacante ainda acompanha (tem a chave DH de B)
    const y1 = await send(b, B, A, "y1"); b = y1.state; a = (await recv(a, y1)).state;
    const z1 = await send(a, A, B, "z1"); a = z1.state;
    snap = (await recv(snap, z1)).state; b = (await recv(b, z1)).state; // B ainda usa a chave DH vazada até receber z1
    const w1 = await send(b, B, A, "w1"); b = w1.state; a = (await recv(a, w1)).state; // B gira a chave: só ele a conhece
    const v1 = await send(a, A, B, "v1"); a = v1.state;
    assert.equal(R.text((await recv(b, v1)).plaintext), "v1");
    await rejects(recv(snap, w1));
    await rejects(recv(snap, v1));
  });
});
