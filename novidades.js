// Novidades: o que mudou em cada atualização. Funções puras (testadas em Node) + a lista, que é escrita à mão a cada publicação (a mais nova PRIMEIRO).
// Para anunciar uma atualização: ponha uma entrada nova no topo de NOVIDADES (id maior que o da anterior), com itens curtos, em português simples e sem termo técnico.
// A pessoa vê um ponto rosa no menu da conta enquanto o id da entrada mais nova for diferente do último que ela abriu (guardado só no aparelho).
export const TEMAS = [["selos", "Selos"], ["mensagens", "Mensagens"], ["grupos", "Grupos"], ["seguranca", "Segurança"], ["geral", "Geral"]];
const NOME_TEMA = new Map(TEMAS);
export const temaNome = (t) => NOME_TEMA.get(t) || null;
export const NOVIDADES = [
  { id: "2026-11-14-5", data: "2026-11-14", itens: [
    { tema: "selos", icone: "🛠️", titulo: "Correção no efeito sonoro", texto: "Quem recebia um efeito sonoro aparecia como silenciado e ficava sem o campo de escrever por alguns minutos. Isso não acontece mais." },
  ] },
  { id: "2026-11-14-4", data: "2026-11-14", itens: [
    { tema: "selos", icone: "🔊", titulo: "Efeito sonoro na loja", texto: "Escolha um membro (ou você mesmo) e um trecho de 1 ou 2 segundos de um áudio: a cada mensagem dele, o som toca para o grupo. Você escolhe por quanto tempo, de 5 em 5 minutos; quanto mais tempo, mais Selos." },
  ] },
  { id: "2026-11-14-3", data: "2026-11-14", itens: [
    { tema: "geral", icone: "⭐", titulo: "Tela de Novidades", texto: "No menu da conta, veja o que mudou em cada atualização, organizado por assunto. Um ponto rosa avisa quando há novidade." },
  ] },
  { id: "2026-11-14-2", data: "2026-11-14", itens: [
    { tema: "selos", icone: "👻", titulo: "Jumpscare na loja", texto: "Um susto sorteado da lista do admin aparece para os outros membros. Só depois do susto eles descobrem quem comprou." },
    { tema: "selos", icone: "🎬", titulo: "Som de vídeo no jumpscare", texto: "O admin pode escolher um vídeo MP4: só o som dele é usado." },
  ] },
  { id: "2026-11-14-1", data: "2026-11-14", itens: [
    { tema: "selos", icone: "🏷️", titulo: "Loja de Selos", texto: "Gaste Selos em um título ao lado do nome, em uma mensagem em destaque ou para silenciar um membro por 5 minutos." },
    { tema: "mensagens", icone: "👁️", titulo: "Quem viu e quem ouviu", texto: "No grupo, um selo mostra quem já viu sua mensagem. Nos áudios, quem ouviu e até onde." },
    { tema: "mensagens", icone: "🎧", titulo: "Áudios em sequência", texto: "Toque em um áudio e os seguintes tocam sozinhos." },
    { tema: "geral", icone: "⚡", titulo: "Tela inicial na hora", texto: "Contatos, fotos e avisos aparecem assim que você abre o site." },
    { tema: "geral", icone: "📜", titulo: "Rolagem sem balanço", texto: "Ao abrir um grupo e subir a conversa, a tela não volta mais sozinha." },
  ] },
  { id: "2026-11-13-1", data: "2026-11-13", itens: [
    { tema: "grupos", icone: "📊", titulo: "Estatísticas do grupo", texto: "Quem mais conversa, tempo na tela e sequência de dias." },
    { tema: "selos", icone: "🪙", titulo: "Selos, a moeda do grupo", texto: "O admin define como ganhar Selos: entrar no grupo, conversar, aparecer todo dia." },
    { tema: "seguranca", icone: "📱", titulo: "Vários aparelhos na mesma conta", texto: "Use a conta em até 5 aparelhos; um aparelho já conectado libera o novo." },
    { tema: "geral", icone: "💨", titulo: "Conversas abrem na hora", texto: "As mensagens já aparecem ao abrir, sem piscar." },
  ] },
  { id: "2026-11-12-1", data: "2026-11-12", itens: [
    { tema: "grupos", icone: "👥", titulo: "Grupos", texto: "Crie grupos com nome e foto, sub-admins, uma cor para cada pessoa e citação com @." },
    { tema: "geral", icone: "🎞️", titulo: "Vídeos curtos nas conversas", texto: "Links de Shorts, Reels e TikTok tocam dentro da conversa." },
    { tema: "geral", icone: "✏️", titulo: "Trocar o nome de usuário", texto: "Você pode trocar o seu @; o nome antigo fica reservado por 30 dias." },
  ] },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ID = /^\d{4}-\d{2}-\d{2}-\d{1,2}$/;
export const limpaVisto = (v) => (typeof v === "string" && ID.test(v) ? v : null); // o que o aparelho guardou é desconfiável (pode estar velho ou adulterado)
export const maisNovaId = (lista = NOVIDADES) => (lista.length ? lista.map((e) => e.id).sort().at(-1) : null);
// Entradas mais novas que a última que a pessoa abriu (nunca abriu = todas)
export const novosDesde = (lista, visto) => { const v = limpaVisto(visto); return lista.filter((e) => v === null || e.id > v); };
export const temNovidade = (lista, visto) => novosDesde(lista, visto).length > 0;
export function dataCurta(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m && +m[2] >= 1 && +m[2] <= 12 ? `${+m[3]} ${MESES[+m[2] - 1]}` : ""; }
// Assuntos que existem na lista (na ordem de TEMAS), para os botões de filtro
export const temasPresentes = (lista) => TEMAS.filter(([t]) => lista.some((e) => e.itens.some((i) => i.tema === t))).map(([t, n]) => ({ tema: t, nome: n }));
// Filtra por assunto ("tudo" mostra tudo); atualizações sem nenhum item do assunto somem
export const filtrar = (lista, tema = "tudo") => (tema === "tudo" ? lista : lista.map((e) => ({ ...e, itens: e.itens.filter((i) => i.tema === tema) })).filter((e) => e.itens.length));
// Itens de uma atualização agrupados por assunto, na ordem de TEMAS (para os subtítulos dentro do cartão)
export const agruparPorTema = (itens) => TEMAS.map(([t, nome]) => ({ tema: t, nome, itens: itens.filter((i) => i.tema === t) })).filter((g) => g.itens.length);
// Conferência da lista (usada nos testes): ids únicos e em ordem, datas e assuntos válidos, itens com texto
export function problemas(lista) {
  const p = [], ids = new Set();
  lista.forEach((e, k) => {
    if (!ID.test(e.id || "")) p.push(`id ruim: ${e.id}`); if (ids.has(e.id)) p.push(`id repetido: ${e.id}`); ids.add(e.id);
    if (!dataCurta(e.data)) p.push(`data ruim em ${e.id}`); if (typeof e.id === "string" && !String(e.id).startsWith(e.data || "?")) p.push(`o id deve começar pela data (${e.id})`);
    if (k > 0 && !(lista[k - 1].id > e.id)) p.push(`fora de ordem (a mais nova primeiro): ${e.id}`);
    if (!Array.isArray(e.itens) || !e.itens.length) p.push(`sem itens: ${e.id}`);
    for (const i of e.itens || []) { if (!NOME_TEMA.has(i.tema)) p.push(`assunto desconhecido: ${i.tema}`); if (!i.titulo || !i.texto || !i.icone) p.push(`item incompleto em ${e.id}`); }
  });
  return p;
}
