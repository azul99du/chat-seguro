import test from "node:test";
import assert from "node:assert/strict";
import { previaDe, tituloDoAviso, devePop, POP_MS } from "../pop.js";

test("prévia: texto, mídia com e sem legenda, música; reação e coisas internas não avisam", () => {
  assert.equal(previaDe({ type: "text", text: "oi, tudo bem?" }), "oi, tudo bem?");
  assert.equal(previaDe({ type: "text", text: "   " }), null);
  assert.equal(previaDe({ type: "media", kind: "image", caption: "" }), "Foto");
  assert.equal(previaDe({ type: "media", kind: "image", caption: "praia" }), "Foto: praia");
  assert.equal(previaDe({ type: "media", kind: "video" }), "Vídeo"); assert.equal(previaDe({ type: "media", kind: "audio", dur: 12 }), "Áudio"); assert.equal(previaDe({ type: "media", kind: "sticker" }), "Figurinha");
  assert.equal(previaDe({ type: "media", kind: "musica", titulo: "Death Note", artista: "Hideki" }), "Música: Death Note · Hideki");
  for (const c of [{ type: "reaction" }, { type: "hello" }, { type: "delete" }, null, {}]) assert.equal(previaDe(c), null);
  assert.ok(previaDe({ type: "text", text: "a".repeat(500) }).length <= 80, "texto comprido é cortado");
});
test("título: contato e grupo", () => { assert.equal(tituloDoAviso(null, "ana"), "@ana"); assert.equal(tituloDoAviso("Família", "pai"), "Família · @pai"); });
test("devePop: só à vista, ao vivo, fora da conversa, sem janela por cima e não desligado", () => {
  const ok = { visivel: true, aoVivo: true, conversaAberta: false, janelaAberta: false, desligado: false };
  assert.equal(devePop(ok), true);
  for (const k of ["visivel", "aoVivo"]) assert.equal(devePop({ ...ok, [k]: false }), false);
  for (const k of ["conversaAberta", "janelaAberta", "desligado"]) assert.equal(devePop({ ...ok, [k]: true }), false);
  assert.ok(POP_MS >= 3000);
});
