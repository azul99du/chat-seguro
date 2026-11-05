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
