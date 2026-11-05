-- Consultas de monitoramento (somente leitura). Rode no SQL Editor do Supabase (você é o administrador).
-- Elas mostram METADADOS (quem, quando, quanto); nunca o conteúdo das mensagens, que o servidor não consegue ler.

-- 1) Contas criadas por dia (pico incomum = alguém criando contas em massa)
select created_at::date as dia, count(*) as contas
from auth.users group by 1 order by 1 desc limit 14;

-- 2) Cadastros SEM perfil nos últimos 7 dias (conta criada e nunca concluída: típico de bot ou de teste)
select u.email, u.created_at, u.last_sign_in_at
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null and u.created_at > now() - interval '7 days' order by u.created_at desc;

-- 3) Quem mais mandou mensagens na última hora (limite: 60/min e 1000/h por pessoa)
select p.username, count(*) as mensagens, min(m.created_at) as primeira, max(m.created_at) as ultima
from public.messages m join public.profiles p on p.id = m.sender_id
where m.created_at > now() - interval '1 hour' group by p.username order by mensagens desc limit 10;

-- 4) Mensagens por hora nas últimas 24h
select date_trunc('hour', created_at) as hora, count(*) as mensagens
from public.messages where created_at > now() - interval '24 hours' group by 1 order by 1;

-- 5) Quem está batendo nos limites de busca (find_user / get_prekey) nas últimas 24h
select p.username, l.funcao, sum(l.n) as chamadas, max(l.n) as pico_por_minuto
from public.limite_uso l join public.profiles p on p.id = l.user_id
where l.janela > now() - interval '24 hours' group by p.username, l.funcao order by chamadas desc limit 20;

-- 6) Armazenamento de mídia por pessoa (limite: 400 MB e 200 arquivos/hora)
select p.username, count(*) as arquivos, round(sum((o.metadata->>'size')::bigint) / 1048576.0, 1) as mb
from storage.objects o join public.profiles p on p.id::text = o.owner_id
where o.bucket_id = 'media' group by p.username order by mb desc;

-- 7) Último acesso de cada conta
select p.username, u.last_sign_in_at from public.profiles p join auth.users u on u.id = p.id order by u.last_sign_in_at desc;

-- 8) Quem ativou a verificação em dois passos
select p.username, count(f.id) filter (where f.status = 'verified') as fatores_ativos, max(f.created_at) as ativada_em
from public.profiles p left join auth.mfa_factors f on f.user_id = p.id group by p.username order by p.username;

-- 9) RECUPERAÇÃO: alguém perdeu o celular do autenticador e não consegue entrar?
-- (rode SÓ depois de confirmar com a pessoa que é ela mesma; a conta volta a abrir só com e-mail e senha)
-- delete from auth.mfa_factors where user_id = (select id from public.profiles where username = 'NOME_DO_USUARIO');
