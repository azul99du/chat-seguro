import { test } from "node:test";
import assert from "node:assert/strict";
import { enquadrar, caminhoNovo, CAMINHO_OK, extensao } from "../avatar.js";
const U = "123e4567-e89b-12d3-a456-426614174000";
test("enquadrar: quadrado centralizado, zoom e limites", () => {
  assert.deepEqual(enquadrar(400, 200), { x: 100, y: 0, lado: 200 });
  assert.deepEqual(enquadrar(400, 200, 2, 0, 0), { x: 0, y: 0, lado: 100 });
  const r = enquadrar(400, 200, 2, 1, 1); assert.equal(r.x + r.lado, 400); assert.equal(r.y + r.lado, 200);
  assert.equal(enquadrar(100, 100, 0.2).lado, 100, "zoom abaixo de 1 vale 1");
});
test("caminho do arquivo segue o formato aceito pelo servidor", () => {
  assert.ok(CAMINHO_OK.test(caminhoNovo(U, new Blob([], { type: "image/webp" }), 1700000000000)));
  assert.ok(CAMINHO_OK.test(caminhoNovo(U, new Blob([], { type: "image/jpeg" }), 1700000000000)));
  assert.equal(extensao(new Blob([], { type: "image/jpeg" })), "jpg");
  for (const ruim of [`${U}/../x.webp`, `${U}/abc.webp`, `${U}/1700000000000.png`, "x/1700000000000.webp"]) assert.ok(!CAMINHO_OK.test(ruim), ruim);
});
