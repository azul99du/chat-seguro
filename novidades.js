// Novidades: o que mudou em cada atualização. Funções puras (testadas em Node) + a lista, que é escrita à mão a cada publicação (a mais nova PRIMEIRO).
// Para anunciar uma atualização: ponha uma entrada nova no topo de NOVIDADES (id maior que o da anterior), com itens curtos, em português simples e sem termo técnico.
// A pessoa vê um ponto rosa no menu da conta enquanto o id da entrada mais nova for diferente do último que ela abriu (guardado só no aparelho).
export const TEMAS = [["selos", "Selos"], ["mensagens", "Mensagens"], ["grupos", "Grupos"], ["seguranca", "Segurança"], ["geral", "Geral"]];
const NOME_TEMA = new Map(TEMAS);
export const temaNome = (t) => NOME_TEMA.get(t) || null;
export const NOVIDADES = [
  { id: "2026-11-19-1", data: "2026-11-19", itens: [
    { tema: "grupos", icone: "🔗", titulo: "Links de convite para grupos", texto: "Em Dados do grupo, quem administra pode criar links de convite: cada um com seu nome, sua validade (24 horas, 7 dias, 30 dias ou sem fim), seu limite de pessoas e um QR code para mostrar na hora. Quem tem conta e abre o link vê o nome do grupo e pede para entrar; um admin aceita pelo aviso no alto do grupo (ou o link aceita sozinho, se você escolher assim). Dá para desligar um link a qualquer momento. A pessoa só vê as mensagens de depois que entrou." },
  ] },
  { id: "2026-11-18-1", data: "2026-11-18", itens: [
    { tema: "seguranca", icone: "✉️", titulo: "Trocar o e-mail da conta", texto: "Em Segurança, toque em Trocar e-mail da conta. Você digita a senha, escreve o novo e-mail duas vezes e o Lacre manda um link de confirmação para ele. O e-mail só muda depois que você abrir o link, e até lá você continua entrando com o antigo. A página Segurança também passa a mostrar com qual e-mail você entra. Suas mensagens e chaves não dependem do e-mail, então nada se perde." },
  ] },
  { id: "2026-11-17-3", data: "2026-11-17", itens: [
    { tema: "mensagens", icone: "🔍", titulo: "Buscar dentro da conversa", texto: "Toque na lupa no alto de uma conversa (ou de um grupo) para procurar uma palavra. As mensagens que a têm ficam marcadas, o contador mostra \"3 de 7\" e as setas levam de uma para a outra, começando pela mais nova. Não faz diferença entre maiúscula e minúscula nem entre com e sem acento (\"acao\" acha \"ação\"), e também procura nas legendas das fotos e nos nomes das músicas. Mensagens bem antigas aparecem na hora, com as anteriores a elas. A busca acontece só no seu aparelho: o que você procura nunca sai dele." },
  ] },
  { id: "2026-11-17-2", data: "2026-11-17", itens: [
    { tema: "mensagens", icone: "🔔", titulo: "Aviso no alto da tela", texto: "Quando um contato (ou alguém de um grupo) manda mensagem e você está em outra conversa, aparece um cartão no alto da tela com a foto, o nome e um pedaço da mensagem. Toque nele para abrir a conversa, ou deslize para cima para dispensar. Ele some sozinho em poucos segundos. A prévia é lida no seu aparelho e não aparece quando você já está olhando aquela conversa." },
  ] },
  { id: "2026-11-17-1", data: "2026-11-17", itens: [
    { tema: "mensagens", icone: "📶", titulo: "Mensagem sem internet", texto: "Se você escrever sem conexão, a mensagem não se perde: ela fica esperando no seu aparelho (cifrada, como todo o resto), aparece com o aviso \"Aguardando conexão…\" e sai sozinha quando a internet voltar. Dá para cancelar antes disso. Vale para mensagens de texto; fotos, vídeos e áudios ainda precisam de conexão na hora de enviar." },
    { tema: "mensagens", icone: "✍️", titulo: "Digitando…", texto: "Agora aparece \"digitando…\" quando a pessoa está escrevendo para você, no alto da conversa e na lista. Nos grupos aparece o nome de quem está escrevendo. O aviso é cifrado, não fica gravado em lugar nenhum, só quem está na conversa consegue ler e some sozinho quando a pessoa para ou envia." },
  ] },
  { id: "2026-11-16-3", data: "2026-11-16", itens: [
    { tema: "mensagens", icone: "🎧", titulo: "Playlists", texto: "Crie suas playlists no menu da sua foto, com trechos de 30 segundos de músicas da Apple ou vídeos inteiros do YouTube (cole o link). Elas ficam cifradas e aparecem em todos os seus aparelhos. Em uma conversa a dois, toque em + e em Playlist para tocar a sua para as duas pessoas: quem inicia controla (pausar, pular, ordem aleatória, repetir uma música ou escolher qual toca)." },
    { tema: "selos", icone: "🎵", titulo: "Playlist na loja de Selos", texto: "Em grupo, a playlist é um item da loja: você escolhe uma playlist sua e por quanto tempo ela toca para todo o grupo (de 5 em 5 minutos; quanto mais tempo, mais Selos). Só quem comprou controla, e as músicas são as de quando comprou: enquanto estiver tocando, você não pode pôr músicas novas nela. O admin liga o item e define o preço nas regras dos Selos." },
  ] },
  { id: "2026-11-16-2", data: "2026-11-16", itens: [
    { tema: "mensagens", icone: "📝", titulo: "Transcrição de áudios", texto: "Todo áudio tem um botão Transcrever, que transforma a voz em texto. Acontece no seu próprio aparelho: o áudio e o texto não saem dele. Você escolhe entre Base (mais rápido, erra mais) e Melhor (mais preciso, mas mais lento e pesado). O modelo é baixado só uma vez e fica guardado; use Wi-Fi na primeira vez." },
  ] },
  { id: "2026-11-16-1", data: "2026-11-16", itens: [
    { tema: "geral", icone: "💡", titulo: "Sugestões", texto: "Toque na sua foto e abra Sugestões para dizer o que gostaria de ver no Lacre. O quadro é público para quem tem conta, mostra a data de cada sugestão e você escolhe se o seu nome aparece ou se fica anônimo. Dá para curtir as ideias dos outros. São até 5 sugestões por dia, de até 202 caracteres." },
    { tema: "mensagens", icone: "🎼", titulo: "Música: busca e lista melhores", texto: "A busca de música agora mostra primeiro a trilha original da obra (por exemplo, as músicas oficiais de Death Note) e a lista continua carregando mais músicas conforme você desce. Ao escolher uma música ela já começa a tocar, e volta a tocar sozinha depois que você muda o trecho ou a duração." },
  ] },
  { id: "2026-11-15-3", data: "2026-11-15", itens: [
    { tema: "mensagens", icone: "🎚️", titulo: "Escolher o trecho da música ficou mais fácil", texto: "Agora você arrasta um trecho grande sobre as ondas da música para escolher onde começa, e a duração fica na barra." },
    { tema: "mensagens", icone: "🔎", titulo: "Busca de música melhor", texto: "Entende acento e erro de digitação, mostra o melhor resultado em destaque e, se não achar no Brasil, procura também na loja dos EUA." },
  ] },
  { id: "2026-11-15-2", data: "2026-11-15", itens: [
    { tema: "mensagens", icone: "🎵", titulo: "Música nas conversas", texto: "Pesquise uma música e envie um trecho de até 30 segundos, no estilo do Instagram: capa, disco de vinil girando e play. Funciona em grupos e em conversas a dois. Está no botão + (Música)." },
  ] },
  { id: "2026-11-15-1", data: "2026-11-15", itens: [
    { tema: "grupos", icone: "🖼️", titulo: "Foto de fundo do grupo", texto: "O admin pode pôr uma foto de fundo para o grupo todo, em Dados do grupo. E na loja, qualquer membro pode trocar a foto de fundo para todos por um tempo, de 5 em 5 minutos. Enquanto vale, ela substitui a do admin." },
  ] },
  { id: "2026-11-14-6", data: "2026-11-14", itens: [
    { tema: "selos", icone: "🎁", titulo: "Coleta diária de Selos", texto: "Uma vez por dia, cada membro pode coletar na tela de Selos a média dos preços dos itens ligados na loja. O admin liga a coleta nas regras." },
  ] },
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
