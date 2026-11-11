# chat-seguro
Chat com criptografia ponta a ponta. Front estático (GitHub Pages) + Supabase.

## Como rodar
1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor.
2. Preencha `config.js` com a URL e a chave publishable.
3. Em Authentication > Providers > Email, desative "Confirm email" para testes.
4. Sirva a pasta: `python3 -m http.server 8000` e abra http://localhost:8000.

## Criptografia
ECDH P-256 (WebCrypto) -> AES-GCM 256. Chave privada no IndexedDB. O banco só vê chave pública, texto cifrado e o backup da chave privada cifrado por uma frase-senha (PBKDF2 600k + AES-GCM) que só o usuário sabe. Esqueceu a frase-senha em um aparelho novo = mensagens antigas perdidas.

## Mídia e privacidade
- Fotos: redesenhadas no canvas antes do envio (descarta EXIF, GPS, modelo, data), reduzidas a 1600 px. GIF vira imagem parada.
- Vídeos MP4/MOV (até 45 MB): o contêiner é limpo sem recodificar (título, GPS, datas, faixas de metadados). Resta só a assinatura do codificador dentro dos dados do vídeo.
- O arquivo é cifrado no navegador (AES-GCM, chave aleatória por arquivo) antes de ir para o Storage; a chave vai dentro da mensagem cifrada.
- Fundo de conversa: pessoal, limpo de metadados e cifrado.
- **Áudio:** grave pelo microfone (botão do microfone; até 5 min, com prévia antes de enviar) ou anexe MP3, M4A ou WAV (até 20 MB). MP3 perde ID3v2/ID3v1/APE (artista, título, capa, comentário); WAV guarda só `fmt`/`data` (some LIST/INFO, bext, iXML); M4A passa pela mesma limpeza do MP4 (GPS, data, título); a gravação do navegador (MP4/AAC ou WebM/Opus) tem aplicativo, título e data zerados e blocos Tags/Attachments/Chapters apagados. Tudo sem recodificar, no mesmo tamanho. O amigo baixa e decifra só ao tocar em "Ouvir áudio". Outros formatos (OGG, FLAC, AAC solto) são recusados com aviso.

## Pendente
- Trocar a frase-senha; trocar a senha de login (pede a atual, 12+ caracteres, derruba os outros aparelhos; com 2FA exige o código); revogar aparelhos.
- Verificação de chave (código de segurança) contra servidor malicioso.
- Considerar protocolo Signal/biblioteca auditada antes de uso sério.

## Segurança
- **CSP** no `index.html`: só roda código do próprio site e só fala com o Supabase do projeto. A biblioteca do Supabase fica em `vendor/supabase.js` (empacotada do npm `@supabase/supabase-js@2.45.4` com esbuild), sem CDN de terceiros.
- **Banco:** RLS em todas as tabelas; `anon` sem acesso a nada; o cliente só escreve destinatário + texto cifrado (não forja data nem "visto"); perfil visível só para quem já conversou (busca por nome exato via `find_user`); backup da chave privada em tabela própria.
- **Chaves:** código de segurança por conversa e alerta se a chave de um amigo mudar; frase-senha do backup com no mínimo 12 caracteres; "Sair e apagar chaves" para aparelhos compartilhados.
- **Mídia recebida nunca é confiável:** tipo restrito a imagem/vídeo, caminho validado, nunca `text/html`.
- **Fazer no painel do Supabase:** Realtime → desligar "Allow public access"; Authentication → considerar desligar novos cadastros depois que os amigos entrarem e ligar a confirmação de e-mail.

## Sigilo futuro (forward secrecy)
Mensagens novas usam **Double Ratchet** (como o Signal) com acordo de chaves 3DH: `ratchet.js` (protocolo, testável sem navegador), `store.js` (sessões e histórico cifrados no aparelho).
- Cada mensagem usa uma chave nova, derivada da anterior por função de mão única, e a chave antiga é apagada. Roubar a chave de identidade, o backup ou o estado de hoje não revela o passado.
- Cada vez que os dois trocam mensagens, uma chave DH nova entra na cadeia: quem teve a chave vazada deixa de acompanhar a conversa (autocura).
- O servidor guarda só texto cifrado + cabeçalho (id da sessão, chave DH da vez e contadores).
- **Consequência:** o histórico novo fica **só no aparelho** que enviou/recebeu (cifrado com chave local). Em aparelho novo, mensagens antigas com sigilo futuro aparecem como "não disponíveis"; as mensagens do formato antigo (v1) continuam legíveis em qualquer aparelho. Se um amigo trocar de aparelho, a sessão é refeita sozinha.
- Limites: sem chaves de uso único, as primeiras mensagens de uma sessão ficam expostas enquanto a chave de médio prazo (SPK, 7 dias + 14 de carência) existir. Com dois aparelhos ao mesmo tempo, as mensagens novas vão para o último aparelho que falou.

## Testes
```bash
npm ci
npm run test:unit   # protocolo de sigilo futuro, limpeza de vídeo, cifra de arquivo, código e schema (precisa de ffmpeg)
npm run test:e2e    # navegador + banco, contra um projeto Supabase DE TESTE (veja abaixo)
```
- **`tests/ratchet.test.mjs`**: sessão, ordem trocada, repetição, adulteração, redirecionamento, troca de chave de médio prazo, vazamento total do estado (passado não abre) e autocura.
- **`tests/media.test.mjs`**: vídeos MP4/MOV com título, GPS, data e faixa de timecode saem limpos, do mesmo tamanho, e continuam tocando; cifra de arquivo.
- **`tests/static.test.mjs`**: sem `innerHTML`/`eval`, sem scripts de CDN, sem chave secreta, CSP correta, RLS ligado em toda tabela, funções `SECURITY DEFINER` seguras.
- **`tests/e2e/security.test.mjs`**: ataques com conta comum e sem login (ler, forjar, mover reações, prekeys alheias, storage). Tudo precisa ser bloqueado.
- **`tests/e2e/flow.test.mjs`**: duas pessoas no Chromium: mensagens em tempo real, reações, foto e vídeo, fundo, recarregar, duas abas, aparelho novo, alerta de troca de chave.

### Projeto de teste (para o `test:e2e`)
Os testes criam contas e mensagens de verdade, então **nunca** rodam contra o banco real: `SUPABASE_URL` igual ao de `config.js` é recusado (a trava só se desliga com `ALLOW_PROD=1`).
1. Crie um projeto Supabase só para testes e aplique `supabase/schema.sql` (o schema recria exatamente o banco real; já foi conferido catálogo a catálogo).
2. No painel desse projeto, em **Authentication → Providers → Email**, desligue **Confirm email**. Sem isso o cadastro de teste não devolve sessão e os testes se pulam com um aviso.
3. `SUPABASE_URL=... SUPABASE_KEY=<chave publishable> npm run test:e2e` (use `CHROMIUM_PATH` para apontar um Chromium já instalado).
No GitHub Actions (`.github/workflows/ci.yml`) isso roda a cada push, usando o projeto de teste `chat-seguro-teste`. Os usuários de teste ficam no banco de teste e não afetam o real.

## Limites de uso e monitoramento
**Limites no banco** (todos devolvem HTTP 429 "espere um pouco"; o site mostra uma mensagem clara):
- mensagens: 300 por minuto e 5000 por hora por pessoa (linhas no banco: uma mensagem de grupo vira uma linha por participante); no máximo 20 por pedido em lote (reações e controle contam);
- grupos: criar 5 por minuto e 20 por hora; adicionar/remover/renomear/dar cargo/trocar foto 30 por minuto e 200 por hora; no máximo 20 pessoas por grupo e 50 grupos por pessoa;
- busca de amigo (`find_user`): 15 por minuto e 100 por hora; busca de chave (`get_prekey`): 30 por minuto e 300 por hora;
- chaves de médio prazo: no máximo 30 por pessoa e 5 por pedido;
- arquivos: 200 por hora e 400 MB no total por pessoa.

**Monitoramento:** `supabase/monitoramento.sql` tem consultas prontas (contas novas, quem manda muito, quem bate nos limites, armazenamento, último acesso). Os logs de acesso (países/redes, erros 4xx/5xx, falhas de login) ficam em *Logs* no painel do Supabase e podem ser consultados por aqui com o conector.

**Notificações (push).** O sino no topo da lista de conversas liga e desliga. O aviso é um **toque sem texto**: aparece "Lacre · Você tem uma nova mensagem", sem nome nem conteúdo (o servidor nunca vê as mensagens, e o serviço de push do Google/Apple/Mozilla só vê que houve um toque). Com o Lacre aberto na tela, nenhum aviso aparece. Como funciona: o banco tem um gatilho (`notifica_mensagem`, via `pg_net`) que chama a função `notificar` (Edge Function em `supabase/functions/notificar/`, sem JWT, que faz a autenticação do pedido sozinha) para cada mensagem que quer aviso; a função confere que a mensagem existe, é do destinatário, tem menos de 2 min e ainda não foi avisada (marca `notificada` atômica, sem aviso em dobro), e manda um push VAPID (RFC 8292, ES256, `vapid.js`) **sem corpo** para os aparelhos da pessoa, com `Topic` (avisos acumulados viram um só). Inscrições expiradas (404/410) são apagadas. As chaves VAPID são criadas pela própria função na primeira chamada e ficam em `push_config` (tabela que ninguém logado lê); o navegador pega a chave pública em `GET /functions/v1/notificar`. O aparelho se registra por `registrar_push` (no máximo 5 por pessoa; o mesmo aparelho muda de dono se outra conta entrar; sair da conta tira o aparelho da lista). Mensagens invisíveis (`hello`, apagar) vão com `avisar=false` e não geram aviso (o servidor sabe só que são desse tipo). `reação` é igual a mensagem para o servidor, então também avisa. iPhone: só com o Lacre instalado na tela inicial (há `manifest.webmanifest` e ícones). Configuração por projeto: `insert into push_config values ('functions_url', 'https://<ref>.supabase.co/functions/v1')`. Se a chave VAPID for trocada, quem tem o sino ligado liga de novo (o app detecta e se reinscreve sozinho ao tocar no sino).

**Mensagens: menu e resposta por gesto.** Não há mais o botão "+" ao lado de cada mensagem. **Segurar** a mensagem (cerca de 0,4 s, com leve vibração) abre o menu: reagir (6 emojis), **Responder**, **Copiar** (texto) e **Apagar…**. No computador, o **botão direito** faz o mesmo; no teclado, Enter com a mensagem focada. **Arrastar a mensagem para a direita** (60 px) responde: um ícone de seta aparece e escurece ao passar do limite. Em telas de toque o texto das mensagens não é selecionável (use "Copiar").

**Abertura do site.** Quem já estava logado vai direto para as conversas: uma tela de abertura (marca "lacre") cobre tudo enquanto se confere a sessão, e a estrutura das conversas aparece antes de as chaves e os contatos carregarem (`#chat.preparando` só aceita toques quando tudo está pronto, `body[data-pronto]`). Com verificação em dois passos, nada abre antes do código. Em segundo plano, `getUser()` confere no servidor se a sessão ainda vale (ex.: senha trocada em outro aparelho): se não, cai no login. Ao abrir uma conversa, a lista só aparece pronta, já nas últimas mensagens.

**Arquivos guardados no aparelho.** Áudios, fotos, figurinhas e fundos baixados (ou enviados) ficam no IndexedDB, **cifrados do mesmo jeito que estão no servidor** (a chave de cada arquivo só existe dentro das mensagens, que já ficam cifradas aqui). Ouvir de novo não baixa nada, e áudio já guardado aparece com o player pronto. Limite de 300 MB no total, descartando os menos usados; cada arquivo até 50 MB (inclui vídeos). Apagar a mensagem apaga a cópia; "Sair e apagar chaves" apaga tudo. Áudio de 5 s ocupa ~25 KB.

**Gravar áudio:** segure o botão do microfone para gravar e **solte para enviar** (a barra vira "● 0:07 ‹ Deslize para cancelar"; o botão cresce e pulsa). **Arrastar para cima** (cadeado) **trava** a gravação: dá para soltar o dedo; aparecem lixeira, ondas de voz ao vivo (Web Audio) e o botão de enviar. **Arrastar para o lado** e soltar **cancela** (o botão não desliza para o lado, para não cobrir o texto; ele escurece e o texto vira "Solte para cancelar"). A barra de gravação aparece no instante do toque (sem espera); toque de menos de 0,25 s não grava e mostra uma dica, e áudio de menos de 1 s aparece como 0:01. Quem usa teclado ou leitor de tela aperta Enter/Espaço no botão: grava já travado, e o botão de enviar manda. Metadados saem do áudio antes do envio (como antes) e o limite é de 5 minutos. Gestos em `app.js` (`mic` + `pointer*`), estilos em `style.css` ("gravar áudio").

**Apagar mensagens:** no menu da mensagem (o "+" ao lado do balão) há "Apagar…". Em mensagem **própria** dá para **apagar para todos** (vai uma mensagem cifrada `{type:"delete", to:<id>}` para o amigo; nos dois aparelhos o texto guardado é trocado por "Mensagem apagada"; o arquivo cifrado de foto/vídeo/áudio sai do armazenamento; citações já na tela passam a mostrar "Mensagem apagada") ou **só para mim** (o aparelho guarda que a mensagem ficou escondida, sem aviso). Mensagem **recebida** só pode ser apagada para mim. O aviso "Mensagem apagada" também pode ser apagado, só para mim. Quem recebe o pedido confere no servidor que o autor da mensagem é quem mandou apagar (ninguém apaga mensagem alheia). Linhas no banco não são removidas (o app não tem permissão de DELETE em `messages`); o texto antigo não fica mais legível em nenhum aparelho, e com sigilo futuro o texto cifrado no servidor já é ilegível. Figurinhas não têm o arquivo removido (o mesmo arquivo é reaproveitado em outras mensagens). Versões antigas do site, ainda em cache, mostram o pedido como "não foi possível decifrar".

**Figurinhas:** botão de figurinhas ao lado do clipe. "Criar ou importar" aceita vários arquivos de uma vez (PNG, JPG, WebP, GIF). Figurinhas prontas (PNG/WebP com fundo transparente) e animadas entram direto; fotos inteiras abrem o editor de recorte, que segue o fluxo do notebook `recortador_figurinhas_sam2`: a pessoa toca no que quer recortar (pode tocar em vários pontos; tocar num ponto o remove; o botão de setas troca para o **ponto vermelho**, que diz ao modelo o que deve ficar de fora), o recorte aparece ao lado numa grade de transparência, e "Salvar figurinha" guarda um WebP 512×512 de até 100 KB. O recorte usa o **SAM 2.1 tiny** (Meta, Apache 2.0, ONNX int8) via ONNX Runtime Web, rodando em WebAssembly no próprio aparelho, em segundo plano (`sam2.js`; arquivos em `vendor/sam2/` ~62 MB e `vendor/ort/` ~15 MB, baixados só quando alguém abre o editor; a CSP ganhou `'wasm-unsafe-eval'` e `connect-src 'self'` só por isso). A foto é analisada uma vez (~10–15 s sem GPU) e cada toque seguinte leva ~0,2 s. O acabamento (`recorte.js`, valores em `recorte-config.js`): rampa de borda (BORDA_MIN/MAX), miolo opaco e buracos pequenos fechados, contorno branco, nota mínima da máscara. O resultado é redesenhado no canvas (sem metadados). GIF, WebP e PNG animados (até 1 MB e 1024 px) são guardados inteiros, sem recorte, só com os metadados removidos sem recodificar. A lista fica **só neste aparelho**, cifrada no IndexedDB (some em "Sair e apagar chaves"; não sincroniza entre aparelhos). Enviar uma figurinha é enviar mídia cifrada (`kind: "sticker"`); reenviar a mesma ao mesmo amigo reaproveita o arquivo já enviado. Quem recebe pode tocar em "Salvar figurinha". Lógica pura em `sticker.js` (limpeza de animadas) e `recorte.js` (acabamento), com testes em `tests/sticker.test.mjs` e `tests/recorte.test.mjs`.

**Trocar a senha de login:** "Segurança da conta → Trocar senha de login". Confere a senha atual num cliente descartável, exige 12+ caracteres (o servidor aceita 6, então a regra é do app), pede confirmação e, ao concluir, encerra as sessões dos outros aparelhos. Com 2FA ativo o servidor só aceita a troca em sessão que já passou pelo código (aal2). A senha de login não protege as mensagens: trocá-la não afeta a chave nem a frase-senha.

**Login:** o Supabase Auth só limita depois de centenas de tentativas por minuto de um mesmo IP (medido: o primeiro bloqueio veio após ~340 tentativas em ~8 s), e senhas erradas não bloqueiam a conta. Por isso: senha nova com 12+ caracteres, e no painel (Authentication) reduzir os limites de tentativas e exigir senha mínima de 12. A mensagem protegida não depende da senha de login: sem a chave do aparelho (ou a frase-senha) o atacante não lê nada.

## Verificação em dois passos (TOTP)
Opcional por conta: botão do escudo no cabeçalho da lista → "Ativar" → escanear o QR num app autenticador (Google Authenticator, Authy, Microsoft Authenticator…) → digitar o código de 6 dígitos.
- Depois de ativada, o login pede o código **antes** de qualquer coisa (inclusive antes da frase-senha num aparelho novo). Recarregar a página não pede de novo; entrar numa sessão nova, sim.
- **Vale no banco, não só no site:** as tabelas, o storage e o realtime têm políticas *restritivas* (`public.mfa_ok()`): uma sessão só com senha não lê perfil, mensagens nem backup da chave, não envia, não busca amigos nem lista arquivos. Desativar também exige o 2º passo.
- **Perdeu o celular?** Cadastre o mesmo QR/chave em dois aparelhos assim que ativar. Se perder todos, o administrador remove o fator (SQL em `supabase/monitoramento.sql`, item 9) depois de confirmar que é a pessoa.
- **Chutar o código:** o Supabase limita as verificações por IP (medido: bloqueio após ~30 tentativas em segundos). Em *Authentication → Rate Limits*, deixe **"token verifications"** em 5 por 5 minutos: é esse limite que protege o código de 6 dígitos.

## Responder a mensagens
No menu de cada mensagem (botão **+**) há **Responder**: texto, foto, vídeo ou áudio. Aparece a barra "Respondendo a…" acima do campo (cancela no **×** ou com **Esc**), e a resposta chega com a citação no topo do balão; tocar nela rola até a original e a destaca.
- A citação (id da original, autor e um resumo de até 80 caracteres) viaja **dentro da mensagem cifrada**: o servidor não vê qual mensagem foi respondida, e nenhuma mudança no banco foi necessária. Fica no histórico local, então volta ao recarregar.
- **Anti-forja:** o que chega de outra pessoa é validado (`reply.js`, com testes) e, quando a mensagem original está na tela, o texto e o autor mostrados vêm **dela**, não do resumo recebido. Assim, um amigo mal-intencionado não consegue fazer parecer que você escreveu algo que não escreveu. Se a original não está carregada (mensagens muito antigas), mostra o resumo recebido em itálico e avisa ao tocar.
- Reações e mensagens de controle não são citáveis; responder a uma resposta cita só a mensagem anterior (sem aninhar).

## Guarda de entrada (`guarda.js`)
O `index.html` não carrega o app direto: carrega o `guarda.js`, que decide primeiro e só então faz `import("./app.js")`.
- **Navegadores embutidos** (Instagram, Facebook, Messenger, TikTok, Snapchat, WebView genérica do Android...) são **bloqueados**: o aplicativo que hospeda a tela consegue executar código dentro da página e ler o que aparece nela (mensagens já decifradas) e o que ela guarda. A tela de bloqueio ensina a abrir no navegador de verdade (no Android há botão que tenta abrir direto no Chrome). Quando bloqueia, o app **nem é carregado**: nenhuma chave é aberta e nenhum banco local é criado.
- **Dentro de moldura (iframe) de outro site:** também bloqueado (clique disfarçado). O GitHub Pages não deixa mandar o cabeçalho `frame-ancestors`, então esta é a defesa possível; com Cloudflare Pages dá para usar cabeçalhos de verdade.
- Limite honesto: o Safari View Controller do iPhone não se identifica, então não dá para detectá-lo.

## Frase-senha do backup
Mínimo de **16 caracteres** (e pelo menos 8 diferentes) para frases novas; "Segurança da conta → Trocar frase-senha" permite fortalecer uma frase antiga (pede confirmação digitada duas vezes). É o ponto que decide o dano se alguém descobrir a senha de login de uma conta sem 2FA: o backup cifrado pode ser atacado fora do site, sem limite de tentativas. Cinco palavras sorteadas ("rio-lua-pedra-nuvem-cafe") aguentam; "eduardo2026!" não.

## Foto de perfil
Toque no círculo ao lado do seu @ (topo da lista) → escolher foto → arraste e use o zoom → Salvar (ou Remover foto). O navegador recorta em quadrado 256×256, descarta os metadados (local, câmera) e guarda em WebP/JPEG de até 100 KB. A foto aparece na lista de conversas e no topo da conversa de quem já trocou mensagem com você.
- Bucket privado `avatars` (`supabase/avatar.sql`): só o dono envia/apaga (no máximo 5 arquivos, o app apaga a antiga), só o dono e quem já conversou com ele leem; a coluna `profiles.avatar` só aceita um caminho da própria pasta. A política "exige dois passos" vale aqui também.
- **Diferente das mensagens, a foto NÃO é cifrada de ponta a ponta**: o servidor consegue ver. Se isso incomodar, dá para cifrar a foto e mandar a chave pela conversa.
- Testes: `tests/avatar.test.mjs` (recorte e nomes) e `tests/e2e/avatar.test.mjs` (envio, quem vê, estranhos, formatos e limites).

## Histórico para outro aparelho (exportar / importar)
Por causa do sigilo futuro, um aparelho novo não consegue ler as mensagens antigas (as chaves delas foram apagadas). Em **Segurança da conta → Exportar histórico** o aparelho antigo gera um arquivo `.lacre`; no aparelho novo, **Importar histórico** traz tudo de volta.
- O arquivo é cifrado no navegador com AES-256-GCM; a chave vem de uma senha própria dele (PBKDF2-SHA256, 1.000.000 de voltas). O app gera uma senha de 20 símbolos sorteados (~99 bits) ou aceita uma sua (16+ caracteres). Não vai para o servidor.
- Só abre na MESMA conta (o id da conta é dado autenticado). Senha errada, conta errada e arquivo alterado dão o mesmo erro.
- Importar só ACRESCENTA: o que o aparelho já tem nunca é sobrescrito, e importar duas vezes não duplica. Apagadas para todos/para mim continuam apagadas.
- Inclui o texto e as chaves dos arquivos de mídia (que seguem no servidor, cifrados). Figurinhas salvas e o cache de arquivos não entram.
- O arquivo é uma cópia legível do histórico para quem tiver arquivo + senha: guarde só onde você controla e apague depois de importar.
- Testes: `tests/historico.test.mjs` e `tests/e2e/historico.test.mjs` (aparelho novo não lê → exporta → importa → lê).

## Telas de configuração e modo escuro
- **Segurança da conta** e **Perfil** são páginas inteiras no celular (painel centralizado no computador), no estilo lista do WhatsApp: ícone, título e explicação em cada linha, com grupos ("Senhas", "Outro aparelho").
- A linha da **verificação em duas etapas** tem destaque: cartão rosa com selo "Desativada" e botão "Ativar verificação"; verde com "Ativada" quando ligada.
- No **Perfil**: foto com botão de câmera em rosa lacre, nome com botão de copiar (e a explicação de que é o nome que os amigos digitam), e "Remover foto".
- **Aparência** (menu da sua foto): automática (segue o aparelho), clara ou escura. A escolha fica salva neste aparelho (`lacre:tema`) e é aplicada pelo `guarda.js` antes de desenhar a tela. As cores vêm de variáveis em `style.css` (`--paper`, `--card`, `--texto`, `--mine`...) trocadas em `:root[data-tema="escuro"]` e em `prefers-color-scheme: dark`.
- Testes: `tests/e2e/tela.test.mjs` (menu, Chamar, Aparência, página de Segurança e Perfil).

## Armazenamento
Menu da foto → **Armazenamento**: mostra o que este aparelho guarda (arquivos baixados, com a barra do limite de 300 MB; histórico; figurinhas) e quanto você já enviou ao servidor (limite de 400 MB por pessoa, via a função `meu_uso_arquivos`, que só soma os arquivos da própria pessoa). **Liberar espaço** apaga SÓ as cópias de fotos/áudios/figurinhas baixados neste aparelho: nenhuma mensagem, chave, figurinha salva ou arquivo do servidor é tocado, e os arquivos baixam de novo quando abertos. Testes: `tests/e2e/armazenamento.test.mjs`.

## Vídeos comprimidos no envio
Ao anexar um vídeo MP4/MOV, o app comprime no próprio aparelho (WebCodecs): **720p (lado menor), ~2 Mbps, até 30 fps, H.264**, mantendo o **áudio AAC original sem recomprimir**. Mostra "Comprimindo vídeo… X%" (dá para cancelar no ×) e depois "NN MB · comprimido de MM MB · metadados removidos". Entrada de até 300 MB; o resultado precisa ficar em até 45 MB.
- **Sem bibliotecas de terceiros:** `video.js` lê o MP4 de origem e monta o novo MP4 do zero (só as caixas mínimas), então o arquivo não herda nenhum metadado (local, aparelho, datas). O código roda no mesmo contexto do app: por isso não há dependência externa para auditar.
- **Quando não comprime (envia como antes):** navegador sem WebCodecs; vídeo já leve (≤ 720p e ≤ 3 Mbps); MP4 fragmentado; áudio que não é AAC; vídeo de 10 bits/HDR; HEVC que o navegador não decodifica; qualquer erro ou resultado que não fique ≥ 10% menor. Nesses casos vale o limite de 45 MB do original.
- **Cache:** os vídeos também ficam guardados no aparelho (limite por arquivo: 50 MB; total do cache: 300 MB, com descarte dos menos usados).
- Testes: `tests/video.browser.test.mjs` (ffprobe/ffmpeg conferem codec, tamanho, duração, rotação, áudio idêntico, ausência de metadados e decodificação sem erros) e `tests/e2e/video.test.mjs`.

## Aparelhos conectados
Menu da foto → Segurança da conta → **Aparelhos conectados**: lista os acessos à conta (mais novo primeiro): navegador e sistema ("Chrome no Android"), local aproximado, data/hora de entrada e do último acesso, "Este aparelho" para o atual e "Sessão ativa" / "Saiu" para os outros. Atalho "Não reconheço um aparelho: trocar a senha" (trocar a senha desconecta todos os outros aparelhos).
- A Edge Function `aparelho` (exige login) registra a sessão atual: navegador/sistema/tipo (rótulos do User-Agent; o texto bruto NÃO é guardado), data e local. **O IP não é guardado.** O local vem de uma consulta server-a-server ao serviço público **ipwho.is** só com o IP (sem nome, conta ou mensagens), uma vez por sessão por dia. Se o serviço falhar, aparece "Local indisponível". Para desligar a região, basta remover a função `local()` de `supabase/functions/aparelho/index.ts`.
- Tabela `public.aparelhos` (RLS ligada, sem acesso direto; só a função `meus_aparelhos()` lê, e só as linhas da própria pessoa, exigindo o 2º passo). Guarda no máximo os 30 acessos mais recentes de cada pessoa.
- **"Sair" agora só desconecta o aparelho atual** (antes desconectava a conta em todos os aparelhos).
- Testes: `tests/aparelho.test.mjs` e `tests/e2e/aparelhos.test.mjs`.

## Aviso de aparelho novo
Quando OUTRO aparelho entra na conta, os aparelhos que já estavam conectados mostram, ao abrir o Lacre (ou ao voltar para a aba, ou a cada minuto com a aba aberta), uma **folha** com o aparelho, o local aproximado e a data/hora do primeiro acesso, e duas saídas: **"Sou eu, conheço este aparelho"** (reconhece e some) e **"Não fui eu: trocar a senha"** (marca como não reconhecido e abre a troca de senha, que desconecta os outros aparelhos). Fechar a folha sem decidir deixa um **ponto rosa** na foto (e uma linha em Segurança da conta) até a pessoa conferir; em Aparelhos conectados o aparelho aparece com "Novo" e os botões "Reconheço / Não reconheço". Um "não reconhecido" que ainda está conectado mantém o ponto até sair.
- Quem acabou de entrar não é avisado de si mesmo. O PRIMEIRO aparelho da conta, e quem volta com o mesmo navegador + sistema + tipo + estado de um aparelho já reconhecido, entram como reconhecidos (sem aviso). Se o local de um dos dois não deu para saber, isso não conta como diferença.
- A decisão é guardada em `public.aparelhos.decisao` (`reconhecido` / `recusado`); só a função `decidir_aparelho()` altera, só para sessões da própria pessoa e nunca para a sessão que está decidindo.
- Limite: o aviso só aparece quando o Lacre está aberto (não manda e-mail). Testes: `tests/e2e/aparelhos.test.mjs`.

### Código do aparelho (como o Lacre sabe "quem é quem")
Cada navegador cria um **código aleatório** (`lacre:disp` no armazenamento do site) na primeira vez. O servidor guarda só `SHA-256(id_da_conta:código)`, nunca o código. Quem volta com um código **já reconhecido** (mesmo em outro navegador ou depois de sair e entrar) não gera aviso; um código novo, mesmo no mesmo tipo de navegador e sistema, gera. Limpar os dados do site ou usar aba anônima cria um aparelho novo (pede conferência uma vez). Sessões antigas ganham o código na próxima vez que abrem o app.
- O **IP não identifica aparelho** (vários aparelhos na mesma rede dividem o IP; o mesmo aparelho troca de IP). Ele só vira **pista de risco** pelo local aproximado: o aviso destaca "Local muito diferente do seu uso normal" (outro país) ou "Em outro estado" em relação aos aparelhos já reconhecidos (`aparelhos.js`).

## Grupos
Botão **Chamar → Criar um grupo**: dê um nome e marque as pessoas (só aparece quem já conversa com você). O grupo entra na lista de conversas (quadrado de cantos redondos, com a inicial do nome; pessoas são círculos). No topo da conversa, o botão de pessoas abre **Dados do grupo**: participantes, quem é admin, mudar o nome, adicionar, remover e sair.

**Como a mensagem viaja.** Não existe uma "chave do grupo" que abra as mensagens. Cada mensagem é cifrada **separadamente para cada participante**, pela mesma sessão com sigilo futuro (Double Ratchet) das conversas a dois, e gravada num pedido só (uma linha por pessoa em `messages`, marcada com `grupo_id`): ou chega para todos, ou para ninguém. Quem sai ou é removido simplesmente deixa de receber cópias; quem entra só lê o que for enviado depois. Fotos, vídeos, áudios e figurinhas são cifrados e enviados **uma vez** (`{remetente}/{grupo}/{arquivo}`); a chave do arquivo vai dentro de cada cópia cifrada da mensagem.

**O que o servidor sabe e o que não sabe.** Sabe quem participa de cada grupo (precisa, para recusar mensagem de quem não é do grupo e liberar os arquivos só para participantes). Não lê as mensagens nem o **nome** do grupo: o nome é cifrado (AES-GCM) com uma chave aleatória do grupo, que chega a cada participante embrulhada na cifra a dois de quem o adicionou. O nome fica preso ao id do grupo (dado autenticado), então não dá para trocar nomes entre grupos.

**Cargos.** Três níveis: **admin** (quem cria o grupo): faz tudo; **sub-admin**: só **remove membros comuns** (não remove o admin nem outro sub-admin) e não dá cargo a ninguém; **membro**: conversa e pode sair. Só o admin dá ou tira o cargo de sub-admin (botão de escudo ao lado do nome, em "Dados do grupo"), muda o nome, adiciona pessoas e troca a foto. Se o admin sai, assume o sub-admin mais antigo (ou, sem sub-admin, o membro mais antigo). Entrada, saída e mudança de cargo viram avisos na conversa.

**Foto do grupo.** Só o admin troca (botão da câmera em "Dados do grupo"; recorte quadrado no centro, 256 px). A foto é **cifrada com a chave do grupo** (a mesma que cifra o nome) antes de ir para o servidor, no bucket `media` (`{admin}/{grupo}/{arquivo}`), e a tabela `grupos` guarda só o caminho e o IV (`grupo_foto()` recusa caminho fora da pasta do grupo). Diferente da foto de perfil, o servidor não consegue ver a imagem.

**Citar alguém (@).** Ao digitar `@` aparece uma lista com os participantes (sem você), que vai filtrando conforme se digita; toque, Enter ou Tab escolhe. O nome citado fica em destaque para todos, e mais forte (com uma barra rosa na mensagem) para quem foi citado. Só valem nomes de quem está no grupo; e-mails (`a@b.com`) e nomes de fora ficam como texto. **Aviso:** só a linha de quem foi citado leva a marca `citado` (`messages.citado`), e só ela dispara o push, se a pessoa estiver fora do site (com o Lacre aberto na tela nada aparece). **Mudança:** mensagem comum de grupo **não avisa mais** por push (antes avisava todo mundo); conversa a dois continua avisando. O servidor não vê o texto, mas fica sabendo **quem foi citado** (a marca é uma coluna): é o preço de o aviso funcionar com o site fechado. O texto do aviso é o mesmo de sempre ("Você tem uma nova mensagem").

**Regras (todas conferidas no banco, por funções `SECURITY DEFINER`; as tabelas `grupos` e `grupo_membros` não são legíveis nem graváveis direto):**
- quem cria é admin; só admin adiciona, remove e muda o nome; qualquer um sai;
- só entra num grupo quem **já conversou** com quem está adicionando, nos dois sentidos (um desconhecido não coloca você num grupo só por ter mandado uma mensagem);
- se o admin sai, quem está há mais tempo assume; quando a última pessoa sai, o grupo e as mensagens dele são apagados do servidor;
- mensagem com `grupo_id` só entra se quem envia **e** quem recebe estão no grupo.

**Proteções do lado do aparelho.**
- A linha do servidor diz de qual grupo a mensagem é, e o conteúdo cifrado diz a mesma coisa; se não baterem, a mensagem é recusada (`conteudoBate` em `grupo.js`). O servidor não consegue jogar uma mensagem particular dentro de um grupo, nem levar uma mensagem de um grupo para outro.
- Cada aparelho anota quem estava em cada grupo. Quando a lista muda, aparece um aviso no meio da conversa ("@fulano entrou no grupo", "saiu", "o grupo agora se chama…"): ninguém entra num grupo sem os outros verem.
- Responder, reagir e apagar apontam para um identificador da mensagem que viaja cifrado (cada pessoa recebe a mensagem numa linha diferente do servidor). "Apagar para todos" só vale se vier de quem escreveu.
- A verificação por código de segurança continua sendo feita pessoa a pessoa, na conversa a dois (em Dados do grupo, o balão ao lado do nome abre essa conversa).

**Sincronização.** Ao abrir o Lacre (e ao voltar para a aba), tudo o que chegou com ele fechado é decifrado em ordem, numa fila única. Sem isso, uma mensagem de grupo só seria lida quando a conversa a dois com quem a mandou fosse aberta. De quebra, as conversas com mensagem nova ganham a bolinha de não lida logo ao abrir, e a lista fica ordenada pela atividade mais recente.

**Limites e custos.** Até 20 pessoas por grupo. Uma mensagem num grupo de N pessoas ocupa N−1 linhas no banco (é o preço de não ter uma chave compartilhada); por isso o limite de envio é contado em linhas. Em grupo não há "vista". Como nas conversas a dois, o que você envia de um aparelho não é legível em outro aparelho seu (aparece o aviso "Enviada por você de outro navegador ou aparelho").

## Botão "voltar" do celular
Cada tela que abre por cima (conversa, páginas de configuração, janelas de pergunta e aviso, foto ampliada, menu da conta, menu da mensagem, bandeja do "+") ganha uma entrada no histórico do navegador (`history.pushState`): o "voltar" do celular fecha a tela de cima, uma por vez, em vez de sair do site. Se a tela é fechada pelo próprio app (setinha, Cancelar), a entrada é desfeita junto, então nunca sobra um "voltar" à toa. Da lista de conversas, "voltar" sai do site, como em qualquer página. Depois de recarregar a página, o navegador ainda guarda as entradas da página antiga: pode ser preciso um "voltar" a mais para sair. Teste: `tests/e2e/voltar.test.mjs`.
