// Trocar o e-mail da conta. Partes puras (testadas em Node); o app cuida de pedir a senha, chamar o servidor e mostrar o resultado.
// O e-mail só serve para entrar e para o servidor falar com a pessoa: as mensagens e as chaves não dependem dele.
export const MAX_EMAIL = 254;
export const limpaEmail = (e) => String(e ?? "").trim().toLowerCase();
// Formato simples (o servidor confere de verdade e a confirmação por link é a prova): algo@dominio.tld, sem espaços
export const emailValido = (e) => { const x = limpaEmail(e); return x.length >= 6 && x.length <= MAX_EMAIL && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(x); };

// Depois do pedido: o e-mail mudou na hora, ou ficou esperando a pessoa confirmar por link?
export function resultadoTroca(user, novo) {
  const n = limpaEmail(novo);
  if (limpaEmail(user?.email) === n) return "feito";
  if (limpaEmail(user?.new_email) === n) return "pendente";
  return "desconhecido";
}

export function textoTroca(res, novo) {
  if (res === "feito") return `E-mail trocado para ${novo}. Daqui em diante, entre com ele.`;
  if (res === "pendente") return `Enviamos um link de confirmação para ${novo}. O e-mail só muda depois que você abrir o link (se o aviso pedir, confirme também no e-mail antigo). Até lá, continue entrando com o antigo.`;
  return "O pedido foi enviado, mas não deu para saber se o e-mail já mudou. Veja em Segurança qual e-mail aparece.";
}

export function erroTroca(e) {
  const m = String(e?.message ?? ""), c = e?.code;
  if (c === "insufficient_aal" || /aal2|reauth/i.test(m)) return "Para trocar o e-mail, saia e entre de novo digitando o código do app autenticador.";
  if (c === "email_exists" || /already (been )?registered|already exists|already in use/i.test(m)) return "Não foi possível usar esse e-mail. Tente outro.";
  if (c === "validation_failed" || c === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(m)) return "Esse e-mail não parece válido. Confira e tente de novo.";
  if (c === "over_email_send_rate_limit" || e?.status === 429 || /rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  return "Não foi possível trocar agora. O e-mail antigo continua valendo.";
}

// O link do e-mail leva de volta ao site com o resultado na parte # do endereço: dá para saber o que aconteceu
export function avisoDoLink(hashOuBusca) {
  const h = String(hashOuBusca ?? "").replace(/^[#?]/, ""); if (!h) return null;
  let p; try { p = new URLSearchParams(h); } catch { return null; }
  if (p.get("error") || p.get("error_code") || p.get("error_description")) return /expired|invalid/i.test(`${p.get("error_code")} ${p.get("error_description")}`) ? "O link do e-mail venceu ou já foi usado. Peça a troca de novo em Segurança." : null;
  if (p.get("type") === "email_change") return "E-mail confirmado. Daqui em diante, entre com o novo e-mail.";
  if (/confirmation link accepted/i.test(p.get("message") ?? "")) return "Primeiro link confirmado. Falta abrir o link que foi enviado para o outro e-mail.";
  return null;
}
