import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { limpaUsuario, dataLiberada, DIAS_TROCA } from "../usuario.js";

describe("nome de usuário", () => {
  test("aceita o formato do cadastro, tira @ e espaços e passa para minúsculas", () => {
    assert.equal(limpaUsuario("  @Fulano_1 "), "fulano_1"); assert.equal(limpaUsuario("abc"), "abc"); assert.equal(limpaUsuario("a".repeat(20)), "a".repeat(20)); assert.equal(limpaUsuario("__x"), "__x"); assert.equal(limpaUsuario("João".normalize("NFD").replace(/[̀-ͯ]/g, "")), "joao");
  });
  test("recusa curto, longo, com acento, espaço, símbolo, vazio e o que não é texto", () => {
    for (const x of ["ab", "", "   ", "a".repeat(21), "joão", "ana maria", "ana-maria", "ana.maria", "@@ana", "ana@x", "ａｎａ", "a\nb", null, undefined, 42, {}]) assert.equal(limpaUsuario(x), null, JSON.stringify(x));
  });
  test("data em que a troca é liberada (vem do banco em segundos); lixo vira null", () => {
    assert.equal(dataLiberada("1796000000").toISOString(), new Date(1796000000 * 1000).toISOString()); assert.equal(dataLiberada(1796000000).getTime(), 1796000000000);
    for (const x of ["", "abc", null, undefined, "0", "-5", "99999999999999", NaN]) assert.equal(dataLiberada(x), null, String(x));
  });
  test("o prazo é de 30 dias", () => assert.equal(DIAS_TROCA, 30));
});
