// Nome de usuário: validação e prazos. Funções puras (testadas em Node). O banco confere TUDO de novo (função trocar_nome): isto só evita idas desnecessárias e monta as mensagens.
export const DIAS_TROCA = 30; // uma troca a cada 30 dias; o nome antigo fica reservado pelo mesmo tempo (o mesmo número está no banco)
// "  @Fulano_1 " -> "fulano_1"; devolve null se não servir (3 a 20 letras minúsculas, números ou _; sem acento nem espaço)
export function limpaUsuario(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(t) ? t : null;
}
// O banco responde "troca_cedo" com o instante (em segundos) a partir do qual a troca é liberada; devolve a data ou null
export function dataLiberada(detail) {
  const n = Number(detail); return Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : null;
}
