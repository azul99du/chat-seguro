import test from "node:test";
import assert from "node:assert/strict";
import { limpaEmail, emailValido, resultadoTroca, textoTroca, erroTroca, avisoDoLink, MAX_EMAIL } from "../email.js";

test("limpaEmail e emailValido", () => {
  assert.equal(limpaEmail("  Ana@Exemplo.COM "), "ana@exemplo.com");
  for (const ok of ["ana@exemplo.com", "a.b+c@sub.dominio.com.br", "  X@y.io "]) assert.equal(emailValido(ok), true, ok);
  for (const ruim of ["", "ana", "ana@", "@x.com", "ana@x", "ana @x.com", "ana@x..", "a@b.c", "ana@@x.com", "ana@x.com,b@y.com", "<a>@x.com", `${"a".repeat(MAX_EMAIL)}@x.com`, null]) assert.equal(emailValido(ruim), false, String(ruim));
});
test("resultadoTroca: feito, pendente ou desconhecido (sem diferenciar maiúscula)", () => {
  assert.equal(resultadoTroca({ email: "Novo@x.com" }, "novo@x.com"), "feito");
  assert.equal(resultadoTroca({ email: "velho@x.com", new_email: "NOVO@x.com" }, "novo@x.com"), "pendente");
  assert.equal(resultadoTroca({ email: "velho@x.com" }, "novo@x.com"), "desconhecido"); assert.equal(resultadoTroca(null, "novo@x.com"), "desconhecido");
});
test("textos", () => {
  assert.match(textoTroca("feito", "n@x.com"), /trocado para n@x\.com/); assert.match(textoTroca("pendente", "n@x.com"), /link de confirmação[\s\S]*n@x\.com[\s\S]*antigo/); assert.match(textoTroca("?", "n@x.com"), /Segurança/);
});
test("erroTroca: cada caso tem uma frase clara, sem revelar se o e-mail já tem conta", () => {
  assert.match(erroTroca({ code: "insufficient_aal" }), /código do app autenticador/);
  assert.match(erroTroca({ code: "email_exists" }), /Tente outro/); assert.doesNotMatch(erroTroca({ code: "email_exists" }), /já tem conta|cadastrado/i);
  assert.match(erroTroca({ message: "User already registered" }), /Tente outro/);
  assert.match(erroTroca({ code: "email_address_invalid" }), /não parece válido/); assert.match(erroTroca({ status: 429 }), /Muitas tentativas/); assert.match(erroTroca({ message: "boom" }), /antigo continua valendo/); assert.match(erroTroca(null), /antigo continua valendo/);
});
test("avisoDoLink: confirmado, primeiro dos dois links, link vencido e nada", () => {
  assert.match(avisoDoLink("#access_token=abc&type=email_change"), /E-mail confirmado/);
  assert.match(avisoDoLink("#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email"), /outro e-mail/);
  assert.match(avisoDoLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), /venceu/);
  for (const x of ["", "#", "#foo=bar", null, "#access_token=abc&type=recovery"]) assert.equal(avisoDoLink(x), null, String(x));
});
