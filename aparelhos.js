// Pista de risco do aviso de aparelho novo: compara o local do aparelho novo com o dos aparelhos que a pessoa já reconheceu.
// Só usa país e estado (o IP não é guardado em lugar nenhum). Devolve null quando não há motivo para destacar.
export function riscoDeLocal(a, lista, nomePais = (c) => c) {
  const conhecidos = (lista || []).filter((x) => x.decisao === "reconhecido" && (x.pais_codigo || x.regiao));
  if (!conhecidos.length || !a?.pais_codigo) return null;
  if (!conhecidos.some((x) => x.pais_codigo === a.pais_codigo)) return { nivel: "alto", texto: `Local muito diferente do seu uso normal: ${nomePais(a.pais_codigo)}.` };
  if (a.regiao && !conhecidos.some((x) => x.pais_codigo === a.pais_codigo && x.regiao === a.regiao)) return { nivel: "medio", texto: `Em outro estado do que você costuma usar: ${a.regiao}.` };
  return null;
}
