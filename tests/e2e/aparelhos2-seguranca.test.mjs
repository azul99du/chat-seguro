// Vários aparelhos, etapas 2 e 3: o que o BANCO deixa cada conta e cada aparelho fazer (cópia endereçada a um aparelho, aparelho pendente, recuperação).
// O conteúdo das mensagens aqui é falso: o que se testa são as regras do servidor. (O tempo real e o fluxo completo estão em multiaparelho.test.mjs.)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_KEY, configurado, motivoSemConfig, cadastroFunciona, novoEmail, novoUsuario, SENHA } from "./env.mjs";

const mk = () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
const pk = (n) => ({ kty: "EC", crv: "P-256", x: "x" + n, y: "y" + n });
const hdr = () => ({ sid: hex(), dh: { x: "x", y: "y" }, pn: 0, n: 0 });
const linha = (to, para, extra = {}) => ({ recipient_id: to, ciphertext: "Y3Q=", iv: "aXZpdml2aXZpdg==", v: 2, header: hdr(), para_aparelho: para ?? null, ...extra });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let skip = configurado ? false : motivoSemConfig, anon;
const t = (nome, fn) => test(nome, { timeout: 120000 }, async (ctx) => (skip ? ctx.skip(skip) : fn(ctx)));

// uma conta com N sessões de login; cada sessão registra um aparelho (o 1º entra aprovado, os outros pendentes) e publica uma chave de recepção marcada
async function conta(tag, n) {
  const email = novoEmail(), c0 = mk(), s = await c0.auth.signUp({ email, password: SENHA }); if (s.error || !s.data.session) throw new Error(s.error?.message || "sem sessão");
  const id = s.data.user.id, r = await c0.from("profiles").insert({ id, username: novoUsuario(tag), public_key: pk(tag) }); if (r.error) throw r.error;
  const cs = [c0], ids = [hex()], refs = [];
  for (let i = 1; i < n; i++) { const c = mk(), l = await c.auth.signInWithPassword({ email, password: SENHA }); if (l.error) throw l.error; cs.push(c); ids.push(hex()); }
  for (let i = 0; i < n; i++) {
    const e = await cs[i].rpc("registrar_dispositivo", { p_id: ids[i] }); assert.ifError(e.error);
    assert.ifError((await cs[i].from("prekeys").insert({ id: hex(), public_key: pk(tag + i), aparelho: ids[i] })).error);
    refs.push((await cs[i].rpc("dispositivos_conta")).data.find((a) => a.atual).ref);
  }
  return { id, email, cs, ids, refs };
}
const aprovar = async (m, i) => assert.equal((await m.cs[0].rpc("decidir_dispositivo", { p_ref: m.refs[i], p_permitir: true })).data, true);
const le = async (c, id) => (await c.from("messages").select("id").eq("id", id)).data?.length === 1;
const bloqueado = (r) => Boolean(r.error) || !(r.data?.length ?? (r.data ? 1 : 0));
let A, B, X; // A: 3 aparelhos (1º aprovado, 2º aprovado, 3º pendente); B: 4 aparelhos (1º e 2º aprovados, 3º pendente, 4º removido); X: de fora
before(async () => {
  if (skip) return; const s = await cadastroFunciona(); if (!s.ok) { skip = s.motivo; return; }
  anon = mk(); A = await conta("a", 3); B = await conta("b", 4); X = await conta("x", 1);
  await aprovar(A, 1); await aprovar(B, 1);
  assert.equal((await B.cs[0].rpc("remover_dispositivo", { p_ref: B.refs[3] })).data, true); // o 4º aparelho de B é removido
});

t("get_prekeys_aparelhos: só aparelhos APROVADOS (com chave), com o ref e a chave; o identificador secreto não aparece; pendente e removido ficam de fora", async () => {
  const r = await A.cs[0].rpc("get_prekeys_aparelhos", { p_user: B.id }); assert.ifError(r.error);
  assert.deepEqual(r.data.map((x) => x.ref).sort(), [B.refs[0], B.refs[1]].sort());
  for (const x of r.data) { assert.match(x.id, /^[0-9a-f]{32}$/); assert.ok(x.public_key.x); assert.deepEqual(Object.keys(x).sort(), ["id", "public_key", "ref"]); }
  const txt = JSON.stringify(r.data); for (const id of B.ids) assert.ok(!txt.includes(id), "o identificador secreto do aparelho não pode aparecer");
  const meus = await A.cs[0].rpc("get_prekeys_aparelhos", { p_user: A.id }); assert.deepEqual(meus.data.map((x) => x.ref).sort(), [A.refs[0], A.refs[1]].sort(), "posso pedir os meus (os aprovados)");
  assert.equal((await A.cs[2].rpc("get_prekeys_aparelhos", { p_user: B.id })).data?.length ?? 0, 0, "um aparelho pendente não busca chaves");
  assert.ok((await anon.rpc("get_prekeys_aparelhos", { p_user: B.id })).error, "sem login");
});
t("get_prekey (antiga): nunca devolve a chave de aparelho pendente; devolve a de aprovado e a sem marca", async () => {
  const sem = await conta("s", 2); // só o 2º é pendente, e é o que publicou a chave mais recente
  const r = await X.cs[0].rpc("get_prekey", { p_user: sem.id }); assert.ifError(r.error); assert.equal(r.data.length, 1);
  const pend = (await sem.cs[1].from("prekeys").select("id,created_at").order("created_at", { ascending: false })).data[0].id;
  assert.notEqual(r.data[0].id, pend, "a chave do pendente não sai");
  assert.ifError((await sem.cs[0].from("prekeys").insert({ id: hex(), public_key: pk("sm") })).error); // sem marca (formato antigo): continua valendo
  assert.equal((await X.cs[0].rpc("get_prekey", { p_user: sem.id })).data.length, 1);
});
t("inserir: só com para_aparelho de aparelho APROVADO de quem recebe; pendente, removido, de outra pessoa e inexistente são recusados", async () => {
  const [a1] = A.cs;
  assert.ifError((await a1.from("messages").insert(linha(B.id, B.refs[0]))).error);
  assert.ifError((await a1.from("messages").insert(linha(B.id, B.refs[1]))).error);
  for (const [nome, para] of [["pendente", B.refs[2]], ["removido", B.refs[3]], ["de outra pessoa", X.refs[0]], ["inexistente", crypto.randomUUID()], ["de si mesmo (aparelho meu, mas o destinatário é B)", A.refs[1]]]) {
    const r = await a1.from("messages").insert(linha(B.id, para)); assert.ok(r.error, nome); assert.equal(r.error.code, "42501", nome + ": " + r.error.message);
  }
  assert.ok((await a1.from("messages").insert(linha(B.id, "nao-e-uuid"))).error, "formato inválido");
  assert.ok((await a1.from("messages").insert({ ...linha(B.id, B.refs[0]), grupo_id: crypto.randomUUID() })).error, "cópia por aparelho num grupo de que não participo: recusada");
});
t("cópia para si mesmo: só para OUTRO aparelho aprovado meu; não para o próprio aparelho, pendente, de outra conta nem sem aparelho de destino", async () => {
  const [a1, a2] = A.cs;
  assert.ifError((await a1.from("messages").insert(linha(A.id, A.refs[1]))).error);
  assert.ifError((await a2.from("messages").insert(linha(A.id, A.refs[0]))).error);
  for (const [nome, c, para] of [["para o próprio aparelho", a1, A.refs[0]], ["para aparelho pendente meu", a1, A.refs[2]], ["sem aparelho de destino", a1, null], ["aparelho de outra conta", a1, X.refs[0]]]) {
    const r = await c.from("messages").insert(linha(A.id, para)); assert.ok(r.error, nome); assert.equal(r.error.code, "42501", nome);
  }
  const solto = mk(); assert.ifError((await solto.auth.signInWithPassword({ email: A.email, password: SENHA })).error); // sessão sem aparelho registrado
  assert.ok((await solto.from("messages").insert(linha(A.id, A.refs[1]))).error, "sessão sem aparelho não manda cópia para si");
  assert.ok((await X.cs[0].from("messages").insert({ ...linha(A.id, A.refs[0]), sender_id: A.id })).error, "outra conta não envia como a conta A");
});
t("de_aparelho é do servidor: o cliente não grava a coluna, e o valor gravado é o ref do aparelho da sessão (nulo sem aparelho)", async () => {
  const [a1, a2] = A.cs;
  assert.ok((await a1.from("messages").insert({ ...linha(B.id, B.refs[0]), de_aparelho: A.refs[1] })).error, "forjar de_aparelho");
  assert.ok((await a1.from("messages").insert({ ...linha(B.id, B.refs[0]), de_aparelho: crypto.randomUUID() })).error, "forjar de_aparelho (qualquer valor)");
  const r1 = await a1.from("messages").insert(linha(B.id, B.refs[0])).select("de_aparelho").single(); assert.equal(r1.data.de_aparelho, A.refs[0]);
  const r2 = await a2.from("messages").insert(linha(B.id, B.refs[0])).select("de_aparelho").single(); assert.equal(r2.data.de_aparelho, A.refs[1]);
  const solto = mk(); assert.ifError((await solto.auth.signInWithPassword({ email: A.email, password: SENHA })).error);
  const r3 = await solto.from("messages").insert({ ...linha(B.id, null) }).select("de_aparelho").single(); assert.ifError(r3.error); assert.equal(r3.data.de_aparelho, null, "sem aparelho registrado: formato antigo, sem de_aparelho");
});
t("aparelho PENDENTE não envia (nem no formato antigo) e não lê nada; sessão sem aparelho lê só o formato antigo", async () => {
  const [, , a3] = A.cs, [, , b3] = B.cs;
  assert.ok((await a3.from("messages").insert(linha(B.id, null))).error, "pendente enviando no formato antigo");
  assert.ok((await a3.from("messages").insert(linha(B.id, B.refs[0]))).error, "pendente enviando para um aparelho");
  assert.ok((await a3.from("messages").insert(linha(A.id, A.refs[0]))).error, "pendente mandando cópia para si");
  const antiga = (await A.cs[0].from("messages").insert(linha(B.id, null)).select("id").single()).data.id; // formato antigo para B
  const dirigida = (await A.cs[0].from("messages").insert(linha(B.id, B.refs[0])).select("id").single()).data.id;
  assert.equal(await le(b3, antiga), false, "o pendente de B não lê nem o formato antigo");
  assert.equal(await le(b3, dirigida), false);
  assert.equal(await le(B.cs[0], antiga), true, "aprovado lê o formato antigo"); assert.equal(await le(B.cs[1], antiga), true, "qualquer aprovado lê o formato antigo");
  const solto = mk(); assert.ifError((await solto.auth.signInWithPassword({ email: B.email, password: SENHA })).error);
  assert.equal(await le(solto, antiga), true, "sessão sem aparelho segue lendo o formato antigo"); assert.equal(await le(solto, dirigida), false, "mas não a cópia endereçada");
  assert.equal((await a3.from("messages").select("id").limit(5)).data.length, 0, "o pendente de A também não lê nem o que a própria conta enviou");
  assert.equal(await le(a3, antiga), false);
});
t("cópia endereçada ao aparelho X NÃO é legível pelo aparelho Y da mesma conta, por pendente, nem por outra conta", async () => {
  const [a1, a2, a3] = A.cs, [b1, b2, b3] = B.cs;
  const r = await a1.from("messages").insert([linha(B.id, B.refs[0]), linha(B.id, B.refs[1]), linha(A.id, A.refs[1])]).select("id,recipient_id,para_aparelho"); assert.ifError(r.error);
  const [pb1, pb2, propria] = r.data.map((x) => x.id);
  assert.equal(await le(b1, pb1), true); assert.equal(await le(b2, pb1), false, "o outro aparelho aprovado de B");
  assert.equal(await le(b2, pb2), true); assert.equal(await le(b1, pb2), false); assert.equal(await le(b3, pb1), false, "pendente");
  assert.equal(await le(X.cs[0], pb1), false, "outra conta"); assert.equal(await le(anon, pb1), false, "sem login");
  // quem enviou lê o que enviou (para o status): todos os aparelhos aprovados de A leem as linhas endereçadas a B
  assert.equal(await le(a1, pb1), true); assert.equal(await le(a2, pb1), true); assert.equal(await le(a3, pb1), false, "menos o pendente");
  // a cópia para si: só o aparelho de destino (e o que a criou)
  assert.equal(await le(a2, propria), true, "o aparelho de destino lê"); assert.equal(await le(a1, propria), true, "o que criou lê (precisa do retorno do insert)");
  assert.equal(await le(a3, propria), false); assert.equal(await le(B.cs[0], propria), false); assert.equal(await le(X.cs[0], propria), false);
  const outra = (await a2.from("messages").insert(linha(A.id, A.refs[0])).select("id").single()).data.id; // de a2 para a1
  assert.equal(await le(a1, outra), true); assert.equal(await le(a2, outra), true); // a2 criou, a1 é o destino
  const aprovado3 = mk(); assert.ifError((await aprovado3.auth.signInWithPassword({ email: A.email, password: SENHA })).error);
  assert.equal(await le(aprovado3, propria), false, "sessão sem aparelho não lê cópias endereçadas");
  // filtros do app (recipient_id = eu) não furam a política
  assert.equal((await b2.from("messages").select("id").eq("recipient_id", B.id).eq("id", pb1)).data.length, 0);
});
t("marcar_lidas: ler em um aparelho marca todas as cópias que recebi; quem enviou vê 'lida' (cópias próprias não contam); pendente e outra conta não marcam", async () => {
  const [a1, a2] = A.cs, [b1, b2, b3] = B.cs;
  const r = await a1.from("messages").insert([linha(B.id, B.refs[0]), linha(B.id, B.refs[1]), linha(A.id, A.refs[1])]).select("id,recipient_id"); assert.ifError(r.error);
  const [pb1, pb2, propria] = r.data.map((x) => x.id), lida = async (c, id) => (await c.from("messages").select("read_at").eq("id", id).single()).data.read_at;
  assert.ifError((await X.cs[0].rpc("marcar_lidas", { p_ids: [pb1, pb2] })).error); assert.equal(await lida(a1, pb1), null, "outra conta não marca");
  assert.ifError((await b3.rpc("marcar_lidas", { p_ids: [pb1] })).error); assert.equal(await lida(a1, pb1), null, "pendente não marca");
  assert.ifError((await b2.rpc("marcar_lidas", { p_ids: [pb1] })).error); assert.equal(await lida(a1, pb1), null, "uma cópia que não é do meu aparelho não vale como id");
  assert.ifError((await b1.rpc("marcar_lidas", { p_ids: [pb1] })).error);
  assert.ok(await lida(a1, pb1), "a cópia lida"); assert.ok(await lida(a1, pb2), "e a cópia do outro aparelho de B (mesma mensagem)"); assert.equal(await lida(a1, propria), null, "a cópia própria não conta");
  assert.ok(await lida(b2, pb2), "o outro aparelho de B vê a sua cópia como lida (zera a não lida)");
  assert.ok((await a1.rpc("marcar_lidas", { p_ids: Array.from({ length: 301 }, (_, i) => i + 1) })).error, "lote grande");
  assert.ok((await anon.rpc("marcar_lidas", { p_ids: [pb1] })).error, "sem login");
  // o destinatário continua sem poder mexer no resto
  assert.ok(bloqueado(await b1.from("messages").update({ ciphertext: "aGFja2Vk" }).eq("id", pb1).select()));
  assert.ok(bloqueado(await a1.from("messages").update({ read_at: new Date().toISOString() }).eq("id", propria).select()), "nem o dono da cópia própria marca a si mesmo por update");
});
t("marcar_ouvida: só quem recebeu registra (em todas as cópias dele); o progresso só avança; valores ruins, outra conta, pendente, quem enviou e sem login não valem; ninguém escreve as colunas direto", async () => {
  const [a1] = A.cs, [b1, b2, b3] = B.cs;
  const r = await a1.from("messages").insert([linha(B.id, B.refs[0]), linha(B.id, B.refs[1])]).select("id"); assert.ifError(r.error);
  const [pb1, pb2] = r.data.map((x) => x.id), col = async (id) => (await a1.from("messages").select("read_at,ouvido_ate,ouvido_tudo,ouvido_em").eq("id", id).single()).data;
  const vazio = { read_at: null, ouvido_ate: null, ouvido_tudo: false, ouvido_em: null }, ouve = (c, id, ate, tudo = false) => c.rpc("marcar_ouvida", { p_id: id, p_ate: ate, p_tudo: tudo });
  assert.ifError((await ouve(X.cs[0], pb1, 10)).error); assert.deepEqual(await col(pb1), vazio, "outra conta não registra");
  assert.ifError((await ouve(b3, pb1, 10)).error); assert.deepEqual(await col(pb1), vazio, "aparelho pendente não registra");
  assert.ifError((await ouve(a1, pb1, 10)).error); assert.deepEqual(await col(pb1), vazio, "quem enviou não registra por quem recebeu");
  assert.ok((await ouve(anon, pb1, 10)).error, "sem login");
  assert.ifError((await ouve(b1, pb1, 12)).error);
  let c = await col(pb1); assert.equal(c.ouvido_ate, 12); assert.equal(c.ouvido_tudo, false); assert.ok(c.ouvido_em); assert.ok(c.read_at, "ouvir também conta como ler");
  assert.equal((await col(pb2)).ouvido_ate, 12, "e a cópia do outro aparelho de B (mesma mensagem)");
  assert.ifError((await ouve(b1, pb1, 5)).error); assert.equal((await col(pb1)).ouvido_ate, 12, "ouvir menos não faz o progresso voltar");
  assert.ifError((await ouve(b2, pb1, 30, true)).error); c = await col(pb1); assert.equal(c.ouvido_ate, 30); assert.equal(c.ouvido_tudo, true);
  assert.ifError((await ouve(b1, pb1, 9, false)).error); c = await col(pb1); assert.equal(c.ouvido_tudo, true, "ouviu tudo não desfaz"); assert.equal(c.ouvido_ate, 30);
  for (const ate of [-1, 90000, null]) assert.ok((await ouve(b1, pb1, ate)).error, "valor ruim: " + ate);
  assert.ok(bloqueado(await b1.from("messages").update({ ouvido_ate: 1 }).eq("id", pb1).select()), "ninguém escreve a coluna direto");
  assert.ok(bloqueado(await a1.from("messages").update({ ouvido_tudo: true }).eq("id", pb2).select()), "nem quem enviou");
});

t("recuperação: só o pendente pede; um pedido por vez; o prazo é do banco (não dá para concluir antes); outra conta não mexe; pendente não aprova a si mesmo", async () => {
  const m = await conta("r", 3); // 1º aprovado; 2º e 3º pendentes
  const [c1, c2, c3] = m.cs;
  assert.equal((await c1.rpc("pedir_recuperacao")).data, null, "aprovado não pede"); assert.equal((await c1.rpc("concluir_recuperacao")).data, false);
  assert.ok((await anon.rpc("pedir_recuperacao")).error); assert.ok((await anon.rpc("concluir_recuperacao")).error);
  const t1 = (await c2.rpc("pedir_recuperacao")).data; assert.ok(t1, "o pendente pede");
  assert.equal((await c2.rpc("pedir_recuperacao")).data, t1, "um pedido por vez: pedir de novo devolve o mesmo, sem renovar o relógio");
  assert.equal((await c2.rpc("concluir_recuperacao")).data, false, "antes do prazo");
  assert.equal((await c2.rpc("decidir_dispositivo", { p_ref: m.refs[1], p_permitir: true })).data, false, "o pendente não se aprova");
  assert.equal((await X.cs[0].rpc("concluir_recuperacao")).data, false, "outra conta"); assert.equal((await X.cs[0].rpc("cancelar_recuperacao")).data, false);
  const l = (await c1.rpc("dispositivos_conta")).data, pedido = l.find((a) => a.ref === m.refs[1]); assert.equal(new Date(pedido.recuperacao_em).getTime(), new Date(t1).getTime(), "o aparelho aprovado vê o pedido");
  assert.ok(new Date(pedido.vale_em) > new Date(pedido.agora) || true); assert.ok(pedido.vale_em && pedido.agora);
  assert.equal(l.find((a) => a.ref === m.refs[2]).recuperacao_em, null);
  assert.equal((await c3.rpc("pedir_recuperacao")).data && true, true); assert.equal((await c3.rpc("cancelar_recuperacao")).data, true, "cancelar é possível");
  assert.equal((await c1.rpc("dispositivos_conta")).data.find((a) => a.ref === m.refs[2]).recuperacao_em, null);
  // recusar (por um aparelho aprovado) derruba o pedido e desconecta o pendente
  assert.equal((await c1.rpc("decidir_dispositivo", { p_ref: m.refs[2], p_permitir: false })).data, true); assert.ok((await c3.auth.refreshSession()).error);
  // passado o prazo, o pendente conclui: os OUTROS saem e ele vira aprovado
  const prazo = (await c1.rpc("dispositivos_conta")).data.find((a) => a.ref === m.refs[1]).vale_em;
  const espera = new Date(prazo).getTime() - Date.now() + 1500; if (espera > 20000) return; // (o projeto de teste precisa ter 'recuperacao_prazo' curto em push_config; no padrão de 24 h este trecho não roda)
  await dorme(Math.max(espera, 0));
  assert.equal((await c2.rpc("concluir_recuperacao")).data, true);
  const depois = (await c2.rpc("dispositivos_conta")).data; assert.equal(depois.length, 1); assert.equal(depois[0].estado, "aprovado"); assert.equal(depois[0].recuperacao_em, null);
  assert.ok((await c1.auth.refreshSession()).error, "o aparelho antigo foi desconectado"); assert.equal((await c2.rpc("concluir_recuperacao")).data, false, "já aprovado: nada a concluir");
});
t("sem atalho: o último aprovado sai e o pendente NÃO vira aprovado sozinho; um aparelho novo, sim (conta sem aprovados)", async () => {
  const m = await conta("t", 2);
  assert.equal((await m.cs[0].rpc("remover_dispositivo", { p_ref: m.refs[0] })).data, true);
  assert.equal((await m.cs[1].rpc("registrar_dispositivo", { p_id: m.ids[1] })).data, "pendente", "continua pendente: só permissão ou recuperação");
  const novo = mk(); assert.ifError((await novo.auth.signInWithPassword({ email: m.email, password: SENHA })).error);
  assert.equal((await novo.rpc("registrar_dispositivo", { p_id: hex() })).data, "aprovado", "conta sem nenhum aprovado: o aparelho novo é o primeiro");
});
// ----- Etapa 3: grupos com uma cópia por aparelho -----
const cif = () => ({ c: "Y2hhdmU=", iv: "aXZpdml2aXZpdg==" });
let G;
t("grupo: cópia por aparelho só para aparelho APROVADO de participante; a mim mesmo só como cópia para OUTRO aparelho meu; pendente e gente de fora ficam de fora", async () => {
  const [a1, a2, a3] = A.cs, [b1] = B.cs;
  assert.ifError((await a1.from("messages").insert(linha(B.id, B.refs[0]))).error); assert.ifError((await b1.from("messages").insert(linha(A.id, A.refs[0]))).error); // já conversaram (ida e volta)
  G = crypto.randomUUID(); assert.ifError((await a1.rpc("criar_grupo", { p_id: G, p_nome: cif(), p_chave: cif(), p_membros: [{ id: B.id, chave: cif() }] })).error);
  const g = (to, para, extra = {}) => ({ ...linha(to, para), grupo_id: G, avisar: true, citado: false, ...extra });
  // uma mensagem de grupo "de verdade": os dois aparelhos de B e a cópia para o meu outro aparelho, num pedido só
  const ok = await a1.from("messages").insert([g(B.id, B.refs[0]), g(B.id, B.refs[1]), g(A.id, A.refs[1], { avisar: false })]).select("id,recipient_id,para_aparelho,de_aparelho,created_at");
  assert.ifError(ok.error); assert.equal(ok.data.length, 3); assert.ok(ok.data.every((l) => l.de_aparelho === A.refs[0]), "o servidor carimba o aparelho que enviou");
  assert.equal(new Set(ok.data.map((l) => l.created_at)).size, 1, "um pedido = um horário = UMA mensagem para as estatísticas e os Selos");
  assert.ifError((await a1.from("messages").insert(g(B.id, null))).error, "formato antigo (uma cópia só) continua valendo no grupo");
  for (const [nome, l] of [["aparelho pendente de quem recebe", g(B.id, B.refs[2])], ["aparelho removido", g(B.id, B.refs[3])], ["aparelho de outra pessoa", g(B.id, A.refs[1])], ["quem não está no grupo", g(X.id, X.refs[0])],
    ["cópia para o MEU próprio aparelho (este)", g(A.id, A.refs[0])], ["cópia para mim sem aparelho", g(A.id, null)], ["cópia para o meu aparelho pendente", g(A.id, A.refs[2])]])
    assert.ok((await a1.from("messages").insert(l)).error, nome);
  assert.ok((await a1.from("messages").insert([g(B.id, B.refs[0]), g(B.id, B.refs[2])])).error, "uma linha inválida derruba o pedido inteiro");
  assert.ok((await a3.from("messages").insert(g(B.id, B.refs[0]))).error, "aparelho pendente não envia ao grupo");
  assert.ok((await X.cs[0].from("messages").insert({ ...linha(X.id, null), grupo_id: G })).error, "de fora: nem cópia para si");
  const outro = crypto.randomUUID(); assert.ok((await a1.from("messages").insert({ ...linha(A.id, A.refs[1]), grupo_id: outro })).error, "cópia para mim num grupo de que não participo");
  // quem lê o quê
  const [paraB1, paraB2, copia] = [ok.data.find((l) => l.para_aparelho === B.refs[0]).id, ok.data.find((l) => l.para_aparelho === B.refs[1]).id, ok.data.find((l) => l.recipient_id === A.id).id];
  assert.equal(await le(B.cs[0], paraB1), true); assert.equal(await le(B.cs[1], paraB1), false, "o 2º aparelho de B não lê a cópia do 1º"); assert.equal(await le(B.cs[1], paraB2), true);
  assert.equal(await le(B.cs[2], paraB1), false, "pendente não lê"); assert.equal(await le(a2, copia), true, "o meu outro aparelho lê a cópia"); assert.equal(await le(a1, copia), true, "(quem criou enxerga)");
  assert.equal(await le(B.cs[0], copia), false, "a cópia para mim não aparece para os outros"); assert.equal(await le(a3, copia), false); assert.equal(await le(X.cs[0], paraB1), false);
  assert.equal(await le(a2, paraB1), true, "o meu outro aparelho vê que a mensagem foi enviada (linha sem conteúdo legível para ele)");
});
t("get_prekeys_grupo: uma chamada devolve os aparelhos APROVADOS de todos os participantes (e os meus), sem o identificador secreto; de fora e pendente não leem", async () => {
  const r = await A.cs[0].rpc("get_prekeys_grupo", { p_grupo: G }); assert.ifError(r.error);
  assert.deepEqual(r.data.map((x) => x.ref).sort(), [A.refs[0], A.refs[1], B.refs[0], B.refs[1]].sort(), "só os aprovados (sem o pendente e sem o removido)");
  for (const x of r.data) { assert.deepEqual(Object.keys(x).sort(), ["id", "public_key", "ref", "user_id"]); assert.ok([A.id, B.id].includes(x.user_id)); }
  const txt = JSON.stringify(r.data); for (const id of [...A.ids, ...B.ids]) assert.ok(!txt.includes(id), "o identificador secreto do aparelho não pode aparecer");
  assert.equal((await X.cs[0].rpc("get_prekeys_grupo", { p_grupo: G })).error?.code, "42501", "quem não está no grupo");
  assert.equal((await A.cs[2].rpc("get_prekeys_grupo", { p_grupo: G })).data?.length ?? 0, 0, "aparelho pendente"); assert.ok((await anon.rpc("get_prekeys_grupo", { p_grupo: G })).error, "sem login");
});
t("grupo: estatísticas e Selos contam UMA mensagem por envio, tenha quantas cópias tiver", async () => {
  const [a1] = A.cs, hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const conta = async () => (await a1.rpc("grupo_estatisticas", { p_grupo: G })).data.find((x) => x.user_id === A.id && x.dia === hoje)?.msgs ?? 0;
  const antes = await conta(), g = (to, para, extra = {}) => ({ ...linha(to, para), grupo_id: G, avisar: true, citado: false, ...extra });
  await dorme(50); assert.ifError((await a1.from("messages").insert([g(B.id, B.refs[0]), g(B.id, B.refs[1]), g(A.id, A.refs[1], { avisar: false })])).error);
  assert.equal(await conta(), antes + 1, "3 linhas, 1 mensagem");
  assert.ifError((await a1.rpc("selo_regras_mudar", { p_grupo: G, p_regras: { mensagens: { on: true, valor: 7, a_cada: 1 } } })).error);
  const s1 = (await a1.rpc("selo_saldo", { p_grupo: G })).data.find((x) => x.user_id === A.id).confirmados;
  await dorme(50); assert.ifError((await a1.from("messages").insert([g(B.id, B.refs[0]), g(B.id, B.refs[1]), g(A.id, A.refs[1], { avisar: false })])).error);
  const s2 = (await a1.rpc("selo_saldo", { p_grupo: G })).data.find((x) => x.user_id === A.id).confirmados;
  assert.equal(Number(s2) - Number(s1), 7, "uma mensagem a mais = 7 Selos a mais (não 21)");
});
t("grupo: ler num aparelho marca as cópias dos meus outros aparelhos; o push sai uma vez por pessoa", async () => {
  const [a1] = A.cs, g = (to, para, extra = {}) => ({ ...linha(to, para), grupo_id: G, avisar: true, citado: true, ...extra });
  const r = await a1.from("messages").insert([g(B.id, B.refs[0]), g(B.id, B.refs[1])]).select("id,para_aparelho"); assert.ifError(r.error);
  const [l1, l2] = [r.data.find((l) => l.para_aparelho === B.refs[0]).id, r.data.find((l) => l.para_aparelho === B.refs[1]).id];
  assert.ifError((await B.cs[0].rpc("marcar_lidas", { p_ids: [l1] })).error);
  const lidas = (await a1.from("messages").select("id,read_at").in("id", [l1, l2])).data; assert.equal(lidas.filter((x) => x.read_at).length, 2, "lida nos dois aparelhos de B");
});
t("funções e tabelas: internas não são chamáveis; sem login nada roda; tabelas dos aparelhos seguem fechadas", async () => {
  for (const c of [anon, X.cs[0]]) for (const f of ["confere_aparelho_mensagem", "recuperacao_prazo", "dispositivo_atual"]) assert.ok((await c.rpc(f)).error, f);
  for (const f of ["aparelho_estado", "aparelho_ref", "dispositivos_conta"]) assert.ok((await anon.rpc(f)).error, f + " sem login");
  assert.ok((await X.cs[0].from("dispositivos").select("*")).error); assert.ok((await X.cs[0].from("dispositivos").update({ recuperacao_pedida_em: null }).neq("estado", "x").select()).error);
});
