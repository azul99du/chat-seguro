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
- mensagens: 60 por minuto e 1000 por hora por pessoa; no máximo 20 por pedido em lote (reações e controle contam);
- busca de amigo (`find_user`): 15 por minuto e 100 por hora; busca de chave (`get_prekey`): 30 por minuto e 300 por hora;
- chaves de médio prazo: no máximo 30 por pessoa e 5 por pedido;
- arquivos: 200 por hora e 400 MB no total por pessoa.

**Monitoramento:** `supabase/monitoramento.sql` tem consultas prontas (contas novas, quem manda muito, quem bate nos limites, armazenamento, último acesso). Os logs de acesso (países/redes, erros 4xx/5xx, falhas de login) ficam em *Logs* no painel do Supabase e podem ser consultados por aqui com o conector.

**Gravar áudio:** segure o botão do microfone para gravar e **solte para enviar** (a barra vira "● 0:07 ‹ Deslize para cancelar"; o botão cresce e pulsa). **Arrastar para cima** (cadeado) **trava** a gravação: dá para soltar o dedo; aparecem lixeira, ondas de voz ao vivo (Web Audio) e o botão de enviar. **Arrastar para o lado** e soltar **cancela**. Toque curto (< 0,8 s) não grava e mostra uma dica. Quem usa teclado ou leitor de tela aperta Enter/Espaço no botão: grava já travado, e o botão de enviar manda. Metadados saem do áudio antes do envio (como antes) e o limite é de 5 minutos. Gestos em `app.js` (`mic` + `pointer*`), estilos em `style.css` ("gravar áudio").

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
