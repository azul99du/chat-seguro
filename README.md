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

## Pendente
- Trocar a frase-senha; revogar aparelhos.
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
