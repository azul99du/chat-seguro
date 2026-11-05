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
