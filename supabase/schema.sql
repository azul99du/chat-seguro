-- Chat seguro: o banco guarda apenas chaves PUBLICAS e texto CIFRADO.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  public_key jsonb not null,
  key_backup jsonb,           -- chave privada CIFRADA por frase-senha (o servidor nao consegue abrir)
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) default auth.uid(),
  recipient_id uuid not null references public.profiles(id),
  ciphertext text not null,   -- base64, AES-GCM
  iv text not null,           -- base64
  created_at timestamptz not null default now()
);
create index on public.messages (recipient_id, created_at);
create index on public.messages (sender_id, created_at);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

-- Perfis: qualquer usuario logado pode buscar (precisa da chave publica); so edita o proprio.
create policy "perfis visiveis a logados" on public.profiles
  for select to authenticated using (true);
create policy "cria proprio perfil" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "atualiza proprio perfil" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Mensagens: so remetente e destinatario leem; so envia como si mesmo; nao edita.
create policy "le proprias mensagens" on public.messages
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
create policy "envia como si mesmo" on public.messages
  for insert to authenticated with check (sender_id = auth.uid());

alter publication supabase_realtime add table public.messages;

-- ===== Visto + reacoes (migracao leitura_e_reacoes) =====
alter table public.messages add column read_at timestamptz;
revoke update on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;
create policy "destinatario marca como lida" on public.messages
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

create table public.reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) default auth.uid(),
  ciphertext text not null,   -- emoji cifrado com a chave da conversa
  iv text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index on public.reactions (user_id);
alter table public.reactions enable row level security;
create policy "le reacoes das suas conversas" on public.reactions
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_id
            and (select auth.uid()) in (m.sender_id, m.recipient_id)));
create policy "reage nas suas conversas" on public.reactions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and
    exists (select 1 from public.messages m where m.id = message_id
            and (select auth.uid()) in (m.sender_id, m.recipient_id)));
create policy "troca a propria reacao" on public.reactions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "remove a propria reacao" on public.reactions
  for delete to authenticated using (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.reactions;

-- ===== Otimiza policies antigas (auth.uid() avaliado uma vez por consulta) =====
alter policy "cria proprio perfil" on public.profiles with check (id = (select auth.uid()));
alter policy "atualiza proprio perfil" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "le proprias mensagens" on public.messages using ((select auth.uid()) in (sender_id, recipient_id));
alter policy "envia como si mesmo" on public.messages with check (sender_id = (select auth.uid()));

-- ===== Mídia (cifrada no navegador) e fundo por conversa (migração midia_e_fundos) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['application/octet-stream'])
on conflict (id) do nothing;
-- caminho: {remetente}/{destinatario}/{arquivo}
create policy "envia midia na propria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "le midia das suas conversas" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (select auth.uid())::text in ((storage.foldername(name))[1], (storage.foldername(name))[2]));
create policy "apaga a propria midia" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.chat_backgrounds (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  peer_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,   -- caminho + chave da imagem, cifrados
  iv text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
create index on public.chat_backgrounds (peer_id);
alter table public.chat_backgrounds enable row level security;
create policy "le o proprio fundo" on public.chat_backgrounds
  for select to authenticated using (user_id = (select auth.uid()));
create policy "cria o proprio fundo" on public.chat_backgrounds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "troca o proprio fundo" on public.chat_backgrounds
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "remove o proprio fundo" on public.chat_backgrounds
  for delete to authenticated using (user_id = (select auth.uid()));

-- ===== SEGURANÇA (migrações seguranca_parte1, seguranca_parte2, ajustes e realtime_canais_privados) =====
-- Backup da chave privada: tabela própria, só o dono lê (antes ficava em profiles, legível por todos os logados)
create table public.key_backups (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  backup jsonb not null check (length(backup::text) < 4000),
  updated_at timestamptz not null default now()
);
alter table public.key_backups enable row level security;
create policy "le o proprio backup" on public.key_backups for select to authenticated using (user_id = (select auth.uid()));
create policy "cria o proprio backup" on public.key_backups for insert to authenticated with check (user_id = (select auth.uid()));
create policy "troca o proprio backup" on public.key_backups for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- (dados antigos foram copiados de profiles.key_backup, que foi removida)
alter table public.profiles drop column key_backup;

-- Privilégios mínimos
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke delete on public.messages, public.profiles from authenticated;
revoke update on public.profiles from authenticated;          -- username e chave pública imutáveis
revoke all on public.key_backups from authenticated;
grant select, insert, update on public.key_backups to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Mensagens: o cliente só define destinatário + texto cifrado
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv) on public.messages to authenticated;
alter table public.messages add constraint messages_tamanho
  check (char_length(ciphertext) between 1 and 30000 and char_length(iv) between 8 and 32);

-- Reações: update também exige participar da conversa; sem DELETE (remover = marcador vazio cifrado)
revoke insert, update on public.reactions from authenticated;
grant insert (message_id, user_id, ciphertext, iv), update (message_id, user_id, ciphertext, iv) on public.reactions to authenticated;
drop policy "troca a propria reacao" on public.reactions;
create policy "troca a propria reacao" on public.reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.messages m where m.id = message_id and (select auth.uid()) in (m.sender_id, m.recipient_id)));
drop policy "remove a propria reacao" on public.reactions;
revoke delete on public.reactions from authenticated;
alter table public.reactions add constraint reactions_tamanho
  check (char_length(ciphertext) between 1 and 200 and char_length(iv) between 8 and 32);
alter table public.chat_backgrounds add constraint bg_tamanho check (char_length(ciphertext) <= 4000 and char_length(iv) <= 32);
alter table public.profiles add constraint profiles_chave_tamanho check (length(public_key::text) < 2000);

-- Perfis: só o próprio e o de quem já trocou mensagem; busca de amigo só por nome EXATO
create or replace function public.find_user(p_username text)
returns table (id uuid, username text, public_key jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.public_key from public.profiles p
  where p.username = lower(p_username) and (select auth.uid()) is not null
  limit 1
$$;
revoke all on function public.find_user(text) from public, anon, authenticated;
grant execute on function public.find_user(text) to authenticated;
drop policy "perfis visiveis a logados" on public.profiles;
create policy "ve o proprio perfil e o de quem conversa com voce" on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or exists (select 1 from public.messages m
               where (m.sender_id = (select auth.uid()) and m.recipient_id = profiles.id)
                  or (m.recipient_id = (select auth.uid()) and m.sender_id = profiles.id)));

-- Storage: nome do arquivo no formato {uuid}/{uuid}/{arquivo}
drop policy "envia midia na propria pasta" on storage.objects;
create policy "envia midia na propria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Realtime: canais privados (só usuários logados). No painel, desligue "Allow public access" em Realtime Settings.
create policy "canais do chat: logados leem" on realtime.messages
  for select to authenticated using (realtime.topic() in ('online', 'msgs'));
create policy "canais do chat: logados anunciam" on realtime.messages
  for insert to authenticated with check (realtime.topic() in ('online', 'msgs'));

-- ===== SIGILO FUTURO (migrações sigilo_futuro_parte1 e parte2) =====
-- v=1: mensagem antiga (chave fixa entre os dois). v=2: Double Ratchet (cada mensagem usa uma chave nova que é apagada).
alter table public.messages add column v smallint not null default 1;
alter table public.messages add column header jsonb;   -- sessão, chave DH da vez e contadores (nada do conteúdo)
alter table public.messages add constraint messages_protocolo check (
  (v = 1 and header is null) or (v = 2 and header is not null and length(header::text) < 2000));
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv, v, header) on public.messages to authenticated;

-- Chaves de médio prazo (só a parte PÚBLICA); a privada fica no aparelho e é apagada após 14 dias
create table public.prekeys (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  id text not null check (id ~ '^[0-9a-f]{32}$'),
  public_key jsonb not null check (length(public_key::text) < 500),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.prekeys enable row level security;
revoke all on public.prekeys from anon, authenticated;
grant select, insert, delete on public.prekeys to authenticated;
create policy "le as proprias prekeys" on public.prekeys for select to authenticated using (user_id = (select auth.uid()));
create policy "publica a propria prekey" on public.prekeys for insert to authenticated with check (user_id = (select auth.uid()));
create policy "apaga as proprias prekeys" on public.prekeys for delete to authenticated using (user_id = (select auth.uid()));
create or replace function public.get_prekey(p_user uuid)
returns table (id text, public_key jsonb)
language sql stable security definer set search_path = public as $$
  select k.id, k.public_key from public.prekeys k
  where k.user_id = p_user and (select auth.uid()) is not null
  order by k.created_at desc limit 1
$$;
revoke all on function public.get_prekey(uuid) from public, anon, authenticated;
grant execute on function public.get_prekey(uuid) to authenticated;

-- A partir daqui, só entra mensagem NOVA com sigilo futuro (sem "downgrade" para a chave fixa)
drop policy "envia como si mesmo" on public.messages;
create policy "envia como si mesmo" on public.messages
  for insert to authenticated with check (sender_id = (select auth.uid()) and v = 2);
-- Reações agora são mensagens v2; a tabela antiga fica só para leitura do histórico
revoke insert, update on public.reactions from authenticated;

-- ===== LIMITES DE USO / ANTI-ABUSO (migrações limites_de_uso e limites_de_uso_lote) =====
-- 1) Mensagens: no máximo 60 por minuto e 1000 por hora por pessoa (inclui reações e controle)
create or replace function public.limita_mensagens() returns trigger
language plpgsql set search_path = public as $$
declare por_minuto int; por_hora int;
begin
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into por_minuto, por_hora
  from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 hour';
  if por_minuto >= 60 or por_hora >= 1000 then
    raise exception 'limite de mensagens atingido: espere um pouco' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return new;
end $$;
create trigger limita_mensagens before insert on public.messages
  for each row execute function public.limita_mensagens();

-- 2) Contador de uso de funções (janelas de 1 minuto); ninguém acessa direto
create table public.limite_uso (
  user_id uuid not null,
  funcao text not null,
  janela timestamptz not null,
  n int not null default 0,
  primary key (user_id, funcao, janela)
);
alter table public.limite_uso enable row level security;
revoke all on public.limite_uso from anon, authenticated;

create or replace function public.consome(p_funcao text, p_max_min int, p_max_hora int) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); m int; h int;
begin
  if u is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  insert into public.limite_uso (user_id, funcao, janela, n)
    values (u, p_funcao, date_trunc('minute', now()), 1)
    on conflict (user_id, funcao, janela) do update set n = public.limite_uso.n + 1
    returning n into m;
  select coalesce(sum(n), 0) into h from public.limite_uso
    where user_id = u and funcao = p_funcao and janela > now() - interval '1 hour';
  if m > p_max_min or h > p_max_hora then
    raise exception 'limite de uso atingido: espere um pouco' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  if random() < 0.02 then delete from public.limite_uso where janela < now() - interval '1 day'; end if;
end $$;
revoke all on function public.consome(text, int, int) from public, anon, authenticated;

-- Buscas com limite: 15/min e 100/h (find_user); 30/min e 300/h (get_prekey)
create or replace function public.find_user(p_username text)
returns table (id uuid, username text, public_key jsonb)
language plpgsql security definer set search_path = public as $$
begin
  perform public.consome('find_user', 15, 100);
  return query select p.id, p.username, p.public_key from public.profiles p
    where p.username = lower(p_username) limit 1;
end $$;
revoke all on function public.find_user(text) from public, anon, authenticated;
grant execute on function public.find_user(text) to authenticated;

create or replace function public.get_prekey(p_user uuid)
returns table (id text, public_key jsonb)
language plpgsql security definer set search_path = public as $$
begin
  perform public.consome('get_prekey', 30, 300);
  return query select k.id, k.public_key from public.prekeys k
    where k.user_id = p_user order by k.created_at desc limit 1;
end $$;
revoke all on function public.get_prekey(uuid) from public, anon, authenticated;
grant execute on function public.get_prekey(uuid) to authenticated;

-- 3) Chaves de médio prazo: no máximo 30 por pessoa
create or replace function public.limita_prekeys() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.prekeys where user_id = new.user_id) >= 30 then
    raise exception 'chaves demais' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return new;
end $$;
create trigger limita_prekeys before insert on public.prekeys
  for each row execute function public.limita_prekeys();

-- 4) Arquivos: no máximo 200 por hora e 400 MB no total por pessoa
-- (função SECURITY DEFINER: a consulta não entra em recursão com as policies da própria tabela do storage)
create or replace function public.pode_enviar_arquivo() returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (select count(*) from storage.objects o
           where o.bucket_id = 'media' and o.owner_id = (select auth.uid())::text
             and o.created_at > now() - interval '1 hour') < 200
     and (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
           where o.bucket_id = 'media' and o.owner_id = (select auth.uid())::text) < 400 * 1024 * 1024
$$;
revoke all on function public.pode_enviar_arquivo() from public, anon, authenticated;
grant execute on function public.pode_enviar_arquivo() to authenticated;
drop policy "envia midia na propria pasta" on storage.objects;
create policy "envia midia na propria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.pode_enviar_arquivo());

-- 5) Pedidos em lote: um gatilho por linha não enxerga as outras linhas do mesmo INSERT, então limitamos o lote
create or replace function public.limita_lote_mensagens() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from novas) > 20 then
    raise exception 'lote grande demais' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return null;
end $$;
create trigger limita_lote_mensagens after insert on public.messages
  referencing new table as novas for each statement execute function public.limita_lote_mensagens();

create or replace function public.limita_lote_prekeys() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from novas) > 5 then
    raise exception 'lote grande demais' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return null;
end $$;
create trigger limita_lote_prekeys after insert on public.prekeys
  referencing new table as novas for each statement execute function public.limita_lote_prekeys();

-- ===== VERIFICAÇÃO EM DOIS PASSOS (migração dois_passos_no_banco) =====
-- Verdadeiro se a pessoa NÃO ativou a verificação, ou se a sessão já passou por ela (aal2)
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                     where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;
revoke all on function public.mfa_ok() from public, anon, authenticated;
grant execute on function public.mfa_ok() to authenticated;

-- Políticas RESTRITIVAS (somam-se às existentes): sem o 2º passo, quem ativou a verificação não acessa nada
create policy "exige dois passos" on public.profiles          as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.messages          as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.reactions         as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.key_backups       as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.chat_backgrounds  as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.prekeys           as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on storage.objects          as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on realtime.messages        as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- As funções de busca também exigem (passam por consome)
create or replace function public.consome(p_funcao text, p_max_min int, p_max_hora int) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); m int; h int;
begin
  if u is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'verificacao em dois passos pendente' using errcode = '42501'; end if;
  insert into public.limite_uso (user_id, funcao, janela, n)
    values (u, p_funcao, date_trunc('minute', now()), 1)
    on conflict (user_id, funcao, janela) do update set n = public.limite_uso.n + 1
    returning n into m;
  select coalesce(sum(n), 0) into h from public.limite_uso
    where user_id = u and funcao = p_funcao and janela > now() - interval '1 hour';
  if m > p_max_min or h > p_max_hora then
    raise exception 'limite de uso atingido: espere um pouco' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  if random() < 0.02 then delete from public.limite_uso where janela < now() - interval '1 day'; end if;
end $$;
revoke all on function public.consome(text, int, int) from public, anon, authenticated;

-- ===== Realtime: ninguém publica em 'msgs' (migração realtime_publicar_so_presenca) =====
-- O app só ESCUTA 'msgs' (postgres_changes) e usa 'online' para presença; a política antiga deixava qualquer conta logada publicar nos dois.
drop policy "canais do chat: logados anunciam" on realtime.messages;
create policy "canais do chat: logados anunciam" on realtime.messages
  for insert to authenticated with check (realtime.topic() = 'online');

-- ===== Avisos push (migração avisos_push) =====
-- O servidor nunca vê o conteúdo: o aviso é um "toque na campainha" sem texto. A chave de push é criada pela função "notificar" na primeira vez.
create extension if not exists pg_net;

-- remetente marca avisar=false só para mensagens invisíveis (hello, apagar); notificada só a função do servidor mexe
alter table public.messages add column avisar boolean not null default true;
alter table public.messages add column notificada boolean not null default false;
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv, v, header, avisar) on public.messages to authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 800),
  p256dh text not null check (length(p256dh) between 80 and 120),
  auth text not null check (length(auth) between 16 and 40),
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "ve as proprias inscricoes" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "apaga as proprias inscricoes" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
create policy "exige dois passos" on public.push_subscriptions as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- inscrever (ou mover para esta conta) este aparelho; no máximo 5 por pessoa
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  if u is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  if not public.mfa_ok() then raise exception 'verificacao em dois passos pendente' using errcode = '42501'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (u, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  delete from public.push_subscriptions where user_id = u and id not in (select id from public.push_subscriptions where user_id = u order by created_at desc limit 5);
end $$;
revoke all on function public.registrar_push(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_push(text, text, text) to authenticated;

-- configuração interna (endereço da função e chaves de push): ninguém logado lê; só a função do servidor (com a chave de serviço)
create table public.push_config (chave text primary key, valor text not null);
alter table public.push_config enable row level security;
create policy "exige dois passos" on public.push_config as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.push_config from anon, authenticated;

-- gatilho: ao chegar mensagem que quer aviso, chama a função (sem esperar resposta e sem nunca atrapalhar o envio)
create or replace function public.notificar_mensagem() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  select valor into u from public.push_config where chave = 'functions_url';
  if u is null then return new; end if;
  perform net.http_post(url := u || '/notificar', headers := jsonb_build_object('content-type', 'application/json'),
    body := jsonb_build_object('mensagem', new.id, 'destinatario', new.recipient_id), timeout_milliseconds := 4000);
  return new;
exception when others then return new;
end $$;
revoke all on function public.notificar_mensagem() from public, anon, authenticated;
create trigger notifica_mensagem after insert on public.messages for each row when (new.avisar) execute function public.notificar_mensagem();
-- ===== Foto de perfil (migração foto_de_perfil) =====
-- Bucket privado 'avatars': {dono}/{carimbo}.webp|jpg, até 150 KB. Só o dono envia/apaga; só o dono e quem já conversou com ele leem.
-- A foto NÃO é cifrada de ponta a ponta (o servidor consegue ver), diferente das mensagens e arquivos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 153600, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

alter table public.profiles add column avatar text;
alter table public.profiles add constraint profiles_avatar_formato
  check (avatar is null or avatar ~ ('^' || id::text || '/[0-9]{10,16}\.(webp|jpg)$'));
grant update (avatar) on public.profiles to authenticated;   -- só esta coluna (nome e chave pública continuam imutáveis)

-- no máximo 5 fotos guardadas por pessoa (o app apaga a antiga). SECURITY DEFINER: a consulta não entra em recursão com as policies do storage
create or replace function public.pode_enviar_foto() returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (select count(*) from storage.objects o where o.bucket_id = 'avatars' and o.owner_id = (select auth.uid())::text) < 5
$$;
revoke all on function public.pode_enviar_foto() from public, anon, authenticated;
grant execute on function public.pode_enviar_foto() to authenticated;

create policy "envia a propria foto" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
    and name ~ '^[0-9a-f-]{36}/[0-9]{10,16}\.(webp|jpg)$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.pode_enviar_foto()));
create policy "apaga a propria foto" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "le a propria foto e a de quem conversa com voce" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.messages m
               where (m.sender_id = (select auth.uid()) and m.recipient_id::text = (storage.foldername(name))[1])
                  or (m.recipient_id = (select auth.uid()) and m.sender_id::text = (storage.foldername(name))[1]))));
-- (a política restritiva "exige dois passos" de storage.objects já vale para este bucket também)

-- ===== Armazenamento: quanto a pessoa já enviou (migração armazenamento) =====
-- Só conta os arquivos DA PRÓPRIA pessoa (a política "exige dois passos" também vale: sem o 2º passo devolve vazio).
create or replace function public.meu_uso_arquivos() returns table (arquivos bigint, bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  select count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'media' and o.owner_id = (select auth.uid())::text and (select public.mfa_ok())
$$;
revoke all on function public.meu_uso_arquivos() from public, anon, authenticated;
grant execute on function public.meu_uso_arquivos() to authenticated;

-- ===== Aparelhos conectados (migração aparelhos_conectados) =====
-- Quem escreve é a Edge Function "aparelho" (service role). Nenhum IP nem texto bruto de navegador é guardado, só rótulos e local aproximado.
create table public.aparelhos (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  navegador text not null, sistema text not null,
  tipo text not null check (tipo in ('celular', 'tablet', 'computador', 'outro')),
  pais_codigo text check (pais_codigo ~ '^[A-Z]{2}$'), regiao text, cidade text,
  entrou_em timestamptz not null default now(), ultimo_acesso timestamptz not null default now(), local_em timestamptz
);
create index aparelhos_por_pessoa on public.aparelhos (user_id, ultimo_acesso desc);
alter table public.aparelhos enable row level security;
revoke all on public.aparelhos from anon, authenticated;   -- ninguém logado lê nem escreve direto: só pela função meus_aparelhos()
create policy "exige dois passos" on public.aparelhos as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create or replace function public.meus_aparelhos() returns table (session_id uuid, navegador text, sistema text, tipo text, pais_codigo text, regiao text, cidade text, entrou_em timestamptz, ultimo_acesso timestamptz, conectado boolean, atual boolean)
language sql stable security definer set search_path = public, auth as $$
  select a.session_id, a.navegador, a.sistema, a.tipo, a.pais_codigo, a.regiao, a.cidade, a.entrou_em, a.ultimo_acesso,
         exists (select 1 from auth.sessions s where s.id = a.session_id) as conectado,
         a.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid as atual
    from public.aparelhos a
   where a.user_id = (select auth.uid()) and (select public.mfa_ok())
   order by a.ultimo_acesso desc limit 30
$$;
revoke all on function public.meus_aparelhos() from public, anon, authenticated;
grant execute on function public.meus_aparelhos() to authenticated;

-- ===== Aviso de aparelho novo (migração aviso_aparelho_novo) =====
-- decisao: null = ainda não conferido; 'reconhecido' = "sou eu"; 'recusado' = "não fui eu". O primeiro aparelho de uma conta, e quem volta com o mesmo
-- navegador+sistema+tipo+estado de um aparelho já reconhecido, entram como 'reconhecido' (feito pela função "aparelho"). Aparelhos antigos viram 'reconhecido'.
alter table public.aparelhos add column decisao text check (decisao in ('reconhecido', 'recusado')), add column decidido_em timestamptz;
update public.aparelhos set decisao = 'reconhecido', decidido_em = now() where decisao is null;
drop function public.meus_aparelhos();
create function public.meus_aparelhos() returns table (session_id uuid, navegador text, sistema text, tipo text, pais_codigo text, regiao text, cidade text, entrou_em timestamptz, ultimo_acesso timestamptz, conectado boolean, atual boolean, decisao text)
language sql stable security definer set search_path = public, auth as $$
  select a.session_id, a.navegador, a.sistema, a.tipo, a.pais_codigo, a.regiao, a.cidade, a.entrou_em, a.ultimo_acesso,
         exists (select 1 from auth.sessions s where s.id = a.session_id) as conectado,
         a.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid as atual, a.decisao
    from public.aparelhos a
   where a.user_id = (select auth.uid()) and (select public.mfa_ok())
   order by a.ultimo_acesso desc limit 30
$$;
revoke all on function public.meus_aparelhos() from public, anon, authenticated;
grant execute on function public.meus_aparelhos() to authenticated;
-- "Sou eu" / "Não fui eu": só a própria pessoa, só para sessões dela, e nunca para a sessão que está decidindo
create or replace function public.decidir_aparelho(p_sessao uuid, p_decisao text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
begin
  if p_decisao not in ('reconhecido', 'recusado') or not (select public.mfa_ok()) then return false; end if;
  update public.aparelhos set decisao = p_decisao, decidido_em = now()
   where session_id = p_sessao and user_id = (select auth.uid())
     and session_id is distinct from nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  return found;
end $$;
revoke all on function public.decidir_aparelho(uuid, text) from public, anon, authenticated;
grant execute on function public.decidir_aparelho(uuid, text) to authenticated;

-- ===== Código do aparelho (migração codigo_do_aparelho) =====
-- Cada navegador cria um código aleatório e o guarda só nele; o servidor recebe apenas SHA-256(id_da_conta:codigo). Quem volta com um código já reconhecido não gera aviso.
alter table public.aparelhos add column disp_hash text check (disp_hash ~ '^[0-9a-f]{64}$');
create index aparelhos_disp on public.aparelhos (user_id, disp_hash);

-- ===== Grupos (migração grupos) =====
-- Mensagem de grupo NÃO tem formato novo: ela vai cifrada separadamente para cada pessoa, pela mesma sessão com sigilo futuro das conversas a dois
-- (uma linha por pessoa em "messages", marcada com o grupo). O servidor sabe QUEM está em cada grupo (precisa, para recusar quem não é do grupo e
-- liberar os arquivos), mas não lê as mensagens nem o NOME do grupo: o nome é cifrado com uma chave que só os participantes têm.
create table public.grupos (
  id uuid primary key,
  criador uuid references public.profiles(id) on delete set null,
  nome jsonb not null check (length(nome::text) < 600),          -- nome cifrado com a chave do grupo
  created_at timestamptz not null default now()
);
create table public.grupo_membros (
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  admin boolean not null default false,
  chave jsonb not null check (length(chave::text) < 900),       -- chave do grupo cifrada PARA esta pessoa (só ela abre)
  por uuid not null,                                            -- quem cifrou (diz com qual chave pública abrir)
  entrou_em timestamptz not null default now(),
  primary key (grupo_id, user_id)
);
create index grupo_membros_por_pessoa on public.grupo_membros (user_id);
alter table public.grupos enable row level security;
alter table public.grupo_membros enable row level security;
revoke all on public.grupos from anon, authenticated;            -- ninguém logado lê nem escreve direto: só pelas funções abaixo
revoke all on public.grupo_membros from anon, authenticated;
create policy "exige dois passos" on public.grupos as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.grupo_membros as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Mensagens: cada linha diz de qual grupo é (ou de nenhum)
alter table public.messages add column grupo_id uuid references public.grupos(id) on delete cascade;
create index messages_grupo_dest on public.messages (grupo_id, recipient_id, id) where grupo_id is not null;
create index messages_grupo_rem on public.messages (grupo_id, sender_id, id) where grupo_id is not null;

-- Perguntas que as políticas fazem (SECURITY DEFINER: as tabelas de grupo não são legíveis direto)
create or replace function public.membro_de(p_grupo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.grupo_membros gm where gm.user_id = (select auth.uid()) and gm.grupo_id::text = p_grupo)
$$;
revoke all on function public.membro_de(text) from public, anon, authenticated;
grant execute on function public.membro_de(text) to authenticated;

create or replace function public.mesmo_grupo(p_outro text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.grupo_membros a join public.grupo_membros b on b.grupo_id = a.grupo_id
                  where a.user_id = (select auth.uid()) and b.user_id::text = p_outro)
$$;
revoke all on function public.mesmo_grupo(text) from public, anon, authenticated;
grant execute on function public.mesmo_grupo(text) to authenticated;

create or replace function public.pode_enviar_ao_grupo(p_grupo uuid, p_dest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_dest <> (select auth.uid())
     and exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid()))
     and exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = p_dest)
$$;
revoke all on function public.pode_enviar_ao_grupo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pode_enviar_ao_grupo(uuid, uuid) to authenticated;

-- "Já conversaram": cada um já mandou mensagem particular para o outro. Só assim alguém pode colocar você num grupo (um desconhecido não consegue).
create or replace function public.ja_conversou(p_outro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages m where m.grupo_id is null and m.sender_id = (select auth.uid()) and m.recipient_id = p_outro)
     and exists (select 1 from public.messages m where m.grupo_id is null and m.sender_id = p_outro and m.recipient_id = (select auth.uid()))
$$;
revoke all on function public.ja_conversou(uuid) from public, anon, authenticated;
grant execute on function public.ja_conversou(uuid) to authenticated;

-- Só entra mensagem de grupo se quem envia E quem recebe estão no grupo (quem saiu não consegue mais mandar)
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv, v, header, avisar, grupo_id) on public.messages to authenticated;
drop policy "envia como si mesmo" on public.messages;
create policy "envia como si mesmo" on public.messages
  for insert to authenticated with check (sender_id = (select auth.uid()) and v = 2
    and (grupo_id is null or public.pode_enviar_ao_grupo(grupo_id, recipient_id)));

-- Uma mensagem de grupo vira até 19 linhas (uma por pessoa): o limite por pessoa sobe de 60/min e 1000/h para 300/min e 5000/h
create or replace function public.limita_mensagens() returns trigger
language plpgsql set search_path = public as $$
declare por_minuto int; por_hora int;
begin
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into por_minuto, por_hora
  from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 hour';
  if por_minuto >= 300 or por_hora >= 5000 then
    raise exception 'limite de mensagens atingido: espere um pouco' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return new;
end $$;

-- Quem está no mesmo grupo vê o perfil (nome, chave pública e foto) um do outro, mesmo sem nunca ter conversado a dois
drop policy "ve o proprio perfil e o de quem conversa com voce" on public.profiles;
create policy "ve o proprio perfil e o de quem conversa com voce" on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or exists (select 1 from public.messages m
               where (m.sender_id = (select auth.uid()) and m.recipient_id = profiles.id)
                  or (m.recipient_id = (select auth.uid()) and m.sender_id = profiles.id))
    or public.mesmo_grupo(id::text));
drop policy "le a propria foto e a de quem conversa com voce" on storage.objects;
create policy "le a propria foto e a de quem conversa com voce" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.messages m
               where (m.sender_id = (select auth.uid()) and m.recipient_id::text = (storage.foldername(name))[1])
                  or (m.recipient_id = (select auth.uid()) and m.sender_id::text = (storage.foldername(name))[1]))
    or public.mesmo_grupo((storage.foldername(name))[1])));
-- Arquivos de grupo: {remetente}/{grupo}/{arquivo}, enviados UMA vez; quem está no grupo baixa (a chave de cada arquivo vai dentro das mensagens cifradas)
drop policy "le midia das suas conversas" on storage.objects;
create policy "le midia das suas conversas" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (
    (select auth.uid())::text in ((storage.foldername(name))[1], (storage.foldername(name))[2])
    or public.membro_de((storage.foldername(name))[2])));

-- Meus grupos e quem está em cada um (uma linha por grupo+pessoa). A chave embrulhada só vem na MINHA linha.
create or replace function public.meus_grupos() returns table (grupo_id uuid, nome jsonb, criado_em timestamptz, user_id uuid, username text, public_key jsonb, avatar text, admin boolean, entrou_em timestamptz, chave jsonb, por uuid, por_chave jsonb)
language sql stable security definer set search_path = public as $$
  select g.id, g.nome, g.created_at, m.user_id, p.username, p.public_key, p.avatar, m.admin, m.entrou_em,
         case when m.user_id = (select auth.uid()) then m.chave end,
         case when m.user_id = (select auth.uid()) then m.por end,
         case when m.user_id = (select auth.uid()) then (select q.public_key from public.profiles q where q.id = m.por) end
    from public.grupo_membros eu
    join public.grupos g on g.id = eu.grupo_id
    join public.grupo_membros m on m.grupo_id = g.id
    join public.profiles p on p.id = m.user_id
   where eu.user_id = (select auth.uid()) and (select public.mfa_ok())
   order by g.id, m.entrou_em, m.user_id
$$;
revoke all on function public.meus_grupos() from public, anon, authenticated;
grant execute on function public.meus_grupos() to authenticated;

-- Criar: quem cria vira admin. De 2 a 20 pessoas; no máximo 50 grupos por pessoa; só entra quem já conversou com quem está criando.
create or replace function public.criar_grupo(p_id uuid, p_nome jsonb, p_chave jsonb, p_membros jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); m jsonb; alvo uuid; n int;
begin
  perform public.consome('criar_grupo', 5, 20);                 -- (também confere o login e o 2º passo)
  if jsonb_typeof(p_membros) is distinct from 'array' then raise exception 'dados invalidos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_membros);
  if n < 1 or n > 19 then raise exception 'tamanho_do_grupo' using errcode = '22023'; end if;
  if (select count(*) from public.grupo_membros gm where gm.user_id = u) >= 50 then raise exception 'grupos_demais' using errcode = 'PT429', hint = 'rate_limit'; end if;
  insert into public.grupos (id, criador, nome) values (p_id, u, p_nome);
  insert into public.grupo_membros (grupo_id, user_id, admin, chave, por) values (p_id, u, true, p_chave, u);
  for m in select * from jsonb_array_elements(p_membros) loop
    alvo := (m ->> 'id')::uuid;
    if alvo = u or not public.ja_conversou(alvo) then raise exception 'nao_conversou' using errcode = '42501', detail = alvo::text; end if;
    if (select count(*) from public.grupo_membros gm where gm.user_id = alvo) >= 50 then raise exception 'grupos_demais_dela' using errcode = '42501', detail = alvo::text; end if;
    insert into public.grupo_membros (grupo_id, user_id, chave, por) values (p_id, alvo, m -> 'chave', u);
  end loop;
end $$;
revoke all on function public.criar_grupo(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_grupo(uuid, jsonb, jsonb, jsonb) to authenticated;

-- Adicionar: só admin, e só quem já conversou com ele
create or replace function public.grupo_adicionar(p_grupo uuid, p_user uuid, p_chave jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  if p_user = u or not public.ja_conversou(p_user) then raise exception 'nao_conversou' using errcode = '42501', detail = p_user::text; end if;
  if (select count(*) from public.grupo_membros gm where gm.grupo_id = p_grupo) >= 20 then raise exception 'grupo_cheio' using errcode = '22023'; end if;
  if (select count(*) from public.grupo_membros gm where gm.user_id = p_user) >= 50 then raise exception 'grupos_demais_dela' using errcode = '42501', detail = p_user::text; end if;
  insert into public.grupo_membros (grupo_id, user_id, chave, por) values (p_grupo, p_user, p_chave, u);
end $$;
revoke all on function public.grupo_adicionar(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grupo_adicionar(uuid, uuid, jsonb) to authenticated;

-- Remover alguém (só admin) ou sair (qualquer um). Sem admin, o mais antigo assume; sem ninguém, o grupo e as mensagens dele somem do servidor.
create or replace function public.grupo_remover(p_grupo uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if p_user is distinct from u and not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then
    raise exception 'so_admin' using errcode = '42501';
  end if;
  delete from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = p_user;
  if not found then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo) then
    delete from public.grupos g where g.id = p_grupo;
  elsif not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.admin) then
    update public.grupo_membros gm set admin = true
     where gm.grupo_id = p_grupo and gm.user_id = (select x.user_id from public.grupo_membros x where x.grupo_id = p_grupo order by x.entrou_em, x.user_id limit 1);
  end if;
end $$;
revoke all on function public.grupo_remover(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grupo_remover(uuid, uuid) to authenticated;

-- Trocar o nome (cifrado): só admin
create or replace function public.grupo_renomear(p_grupo uuid, p_nome jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  update public.grupos g set nome = p_nome where g.id = p_grupo;
end $$;
revoke all on function public.grupo_renomear(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grupo_renomear(uuid, jsonb) to authenticated;

-- ===== Grupos: sub-admin, foto do grupo e citação (migração grupos_cargos_foto_citacao) =====
-- Cargos: admin (tudo) > sub-admin (só expulsa membros comuns) > membro. Só o admin dá ou tira o cargo de sub-admin e muda a foto/nome.
alter table public.grupo_membros add column sub boolean not null default false;
alter table public.grupo_membros add constraint grupo_cargo_unico check (not (admin and sub));
-- Foto do grupo: o arquivo vai CIFRADO com a chave do grupo para o bucket 'media' ({quem enviou}/{grupo}/{arquivo}); aqui fica só onde está e o IV.
alter table public.grupos add column foto jsonb check (foto is null or length(foto::text) < 400);

-- Citação (@nome): só quem escreveu sabe quem foi citado; a linha de quem foi citado leva a marca, e só ela dispara o aviso (push). Mensagem comum de grupo não avisa mais.
alter table public.messages add column citado boolean not null default false;
alter table public.messages add constraint messages_citado_so_grupo check (not citado or grupo_id is not null);
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv, v, header, avisar, grupo_id, citado) on public.messages to authenticated;
drop trigger notifica_mensagem on public.messages;
create trigger notifica_mensagem after insert on public.messages for each row when (new.avisar and (new.grupo_id is null or new.citado)) execute function public.notificar_mensagem();

drop function public.meus_grupos();
create or replace function public.meus_grupos() returns table (grupo_id uuid, nome jsonb, criado_em timestamptz, user_id uuid, username text, public_key jsonb, avatar text, admin boolean, entrou_em timestamptz, chave jsonb, por uuid, por_chave jsonb, foto jsonb, sub boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.nome, g.created_at, m.user_id, p.username, p.public_key, p.avatar, m.admin, m.entrou_em,
         case when m.user_id = (select auth.uid()) then m.chave end,
         case when m.user_id = (select auth.uid()) then m.por end,
         case when m.user_id = (select auth.uid()) then (select q.public_key from public.profiles q where q.id = m.por) end,
         g.foto, m.sub
    from public.grupo_membros eu
    join public.grupos g on g.id = eu.grupo_id
    join public.grupo_membros m on m.grupo_id = g.id
    join public.profiles p on p.id = m.user_id
   where eu.user_id = (select auth.uid()) and (select public.mfa_ok())
   order by g.id, m.entrou_em, m.user_id
$$;
revoke all on function public.meus_grupos() from public, anon, authenticated;
grant execute on function public.meus_grupos() to authenticated;

-- Remover: o admin remove qualquer um; o sub-admin só remove membros comuns (nem admin, nem outro sub-admin); qualquer um sai. Sem admin, assume o sub-admin mais antigo (ou o membro mais antigo).
create or replace function public.grupo_remover(p_grupo uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); eu public.grupo_membros; alvo public.grupo_membros;
begin
  perform public.consome('grupo_mudar', 30, 200);
  select * into eu from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u;
  select * into alvo from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = p_user;
  if p_user is distinct from u and not coalesce(eu.admin or (eu.sub and not alvo.admin and not alvo.sub), false) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  delete from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = p_user;
  if not found then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo) then
    delete from public.grupos g where g.id = p_grupo;
  elsif not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.admin) then
    update public.grupo_membros gm set admin = true, sub = false
     where gm.grupo_id = p_grupo and gm.user_id = (select x.user_id from public.grupo_membros x where x.grupo_id = p_grupo order by x.sub desc, x.entrou_em, x.user_id limit 1);
  end if;
end $$;
revoke all on function public.grupo_remover(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grupo_remover(uuid, uuid) to authenticated;

-- Dar ou tirar o cargo de sub-admin: SÓ o admin (o sub-admin não dá cargo a ninguém, nem a si mesmo)
create or replace function public.grupo_cargo(p_grupo uuid, p_user uuid, p_sub boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  update public.grupo_membros gm set sub = coalesce(p_sub, false) where gm.grupo_id = p_grupo and gm.user_id = p_user and not gm.admin;
  if not found then raise exception 'alvo_invalido' using errcode = '42501'; end if;
end $$;
revoke all on function public.grupo_cargo(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.grupo_cargo(uuid, uuid, boolean) to authenticated;

-- Foto do grupo (ou null para tirar): só o admin; o arquivo tem de estar na pasta deste grupo
create or replace function public.grupo_foto(p_grupo uuid, p_foto jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  if p_foto is not null and (jsonb_typeof(p_foto) <> 'object' or length(p_foto::text) >= 400 or jsonb_typeof(p_foto -> 'iv') is distinct from 'string'
     or coalesce(p_foto ->> 'p', '') !~ ('^[0-9a-f-]{36}/' || p_grupo::text || '/[0-9a-f-]{36}$')) then
    raise exception 'foto_invalida' using errcode = '22023';
  end if;
  update public.grupos g set foto = p_foto where g.id = p_grupo;
end $$;
revoke all on function public.grupo_foto(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grupo_foto(uuid, jsonb) to authenticated;

-- ===== Trocar o nome de usuário (migração trocar_nome) =====
-- Regras (todas aqui no banco, o app só mostra): nome novo no mesmo formato do cadastro; NUNCA um nome que já existe nem um nome antigo de outra pessoa ainda reservado;
-- no máximo uma troca a cada 30 dias; o nome antigo fica reservado por 30 dias (ninguém o pega para se passar pela pessoa; ela mesma pode voltar a ele).
create table public.nomes_antigos (
  username text primary key check (username ~ '^[a-z0-9_]{3,20}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trocado_em timestamptz not null default now()
);
create index nomes_antigos_por_pessoa on public.nomes_antigos (user_id, trocado_em desc);
alter table public.nomes_antigos enable row level security;
revoke all on public.nomes_antigos from anon, authenticated;     -- ninguém logado lê nem escreve direto: só pela função trocar_nome()
create policy "exige dois passos" on public.nomes_antigos as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create or replace function public.trocar_nome(p_novo text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); antigo text; novo text := lower(btrim(coalesce(p_novo, ''))); ultimo timestamptz;
begin
  perform public.consome('trocar_nome', 5, 20);
  if novo !~ '^[a-z0-9_]{3,20}$' then raise exception 'nome_invalido' using errcode = '22023'; end if;
  select p.username into antigo from public.profiles p where p.id = u;
  if antigo is null then raise exception 'sem_perfil' using errcode = '42501'; end if;
  if novo = antigo then raise exception 'mesmo_nome' using errcode = '22023'; end if;
  select max(n.trocado_em) into ultimo from public.nomes_antigos n where n.user_id = u;
  if ultimo is not null and ultimo > now() - interval '30 days' then
    raise exception 'troca_cedo' using errcode = '42501', detail = extract(epoch from (ultimo + interval '30 days'))::bigint::text;
  end if;
  if exists (select 1 from public.profiles p where p.username = novo)
     or exists (select 1 from public.nomes_antigos n where n.username = novo and n.user_id <> u and n.trocado_em > now() - interval '30 days') then
    raise exception 'nome_em_uso' using errcode = '23505';
  end if;
  update public.profiles p set username = novo where p.id = u;
  delete from public.nomes_antigos n where n.username = novo and n.user_id = u;      -- voltou a um nome seu de antes
  insert into public.nomes_antigos (username, user_id, trocado_em) values (antigo, u, now())
    on conflict (username) do update set user_id = excluded.user_id, trocado_em = excluded.trocado_em;
  return novo;
end $$;
revoke all on function public.trocar_nome(text) from public, anon, authenticated;
grant execute on function public.trocar_nome(text) to authenticated;

-- Cadastro: também não pega um nome antigo de outra pessoa ainda reservado
create or replace function public.profiles_nome_reservado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.nomes_antigos n where n.username = new.username and n.user_id <> new.id and n.trocado_em > now() - interval '30 days') then
    raise exception 'nome_em_uso' using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public.profiles_nome_reservado() from public, anon, authenticated;
create trigger profiles_nome_reservado before insert on public.profiles for each row execute function public.profiles_nome_reservado();

-- ===== Cor de cada pessoa no grupo (migração grupo_cor) =====
-- Cada participante tem UMA cor por grupo, só dele: 'p0'..'p9' (cores prontas) ou '#rrggbb' (cor aleatória, a mais diferente das já usadas, calculada no aparelho).
-- O banco impede duas pessoas com a mesma cor no mesmo grupo (índice único). Quem entra ganha a primeira cor pronta livre; quem sai libera a sua.
alter table public.grupo_membros add column cor text check (cor is null or cor ~ '^(p[0-9]|#[0-9a-f]{6})$');
create unique index grupo_membros_cor_unica on public.grupo_membros (grupo_id, cor) where cor is not null;

create or replace function public.cor_livre(p_grupo uuid) returns text
language sql stable security definer set search_path = public as $$
  select x.c from (select 'p' || g as c from generate_series(0, 9) g) x
   where not exists (select 1 from public.grupo_membros m where m.grupo_id = p_grupo and m.cor = x.c)
   order by x.c limit 1
$$;
revoke all on function public.cor_livre(uuid) from public, anon, authenticated;

-- grupos que já existem: cada pessoa ganha uma cor pronta, na ordem em que entrou (a partir da 11ª pessoa, sem cor até escolher uma)
do $$ declare r record; n int; begin
  for r in select grupo_id, user_id, row_number() over (partition by grupo_id order by entrou_em, user_id) - 1 as i from public.grupo_membros loop
    if r.i < 10 then update public.grupo_membros set cor = 'p' || r.i where grupo_id = r.grupo_id and user_id = r.user_id; end if;
  end loop;
end $$;

-- criar e adicionar passam a dar a primeira cor livre
create or replace function public.criar_grupo(p_id uuid, p_nome jsonb, p_chave jsonb, p_membros jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); m jsonb; alvo uuid; n int;
begin
  perform public.consome('criar_grupo', 5, 20);
  if jsonb_typeof(p_membros) is distinct from 'array' then raise exception 'dados invalidos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_membros);
  if n < 1 or n > 19 then raise exception 'tamanho_do_grupo' using errcode = '22023'; end if;
  if (select count(*) from public.grupo_membros gm where gm.user_id = u) >= 50 then raise exception 'grupos_demais' using errcode = 'PT429', hint = 'rate_limit'; end if;
  insert into public.grupos (id, criador, nome) values (p_id, u, p_nome);
  insert into public.grupo_membros (grupo_id, user_id, admin, chave, por, cor) values (p_id, u, true, p_chave, u, public.cor_livre(p_id));
  for m in select * from jsonb_array_elements(p_membros) loop
    alvo := (m ->> 'id')::uuid;
    if alvo = u or not public.ja_conversou(alvo) then raise exception 'nao_conversou' using errcode = '42501', detail = alvo::text; end if;
    if (select count(*) from public.grupo_membros gm where gm.user_id = alvo) >= 50 then raise exception 'grupos_demais_dela' using errcode = '42501', detail = alvo::text; end if;
    insert into public.grupo_membros (grupo_id, user_id, chave, por, cor) values (p_id, alvo, m -> 'chave', u, public.cor_livre(p_id));
  end loop;
end $$;
revoke all on function public.criar_grupo(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_grupo(uuid, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.grupo_adicionar(p_grupo uuid, p_user uuid, p_chave jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  if p_user = u or not public.ja_conversou(p_user) then raise exception 'nao_conversou' using errcode = '42501', detail = p_user::text; end if;
  if (select count(*) from public.grupo_membros gm where gm.grupo_id = p_grupo) >= 20 then raise exception 'grupo_cheio' using errcode = '22023'; end if;
  if (select count(*) from public.grupo_membros gm where gm.user_id = p_user) >= 50 then raise exception 'grupos_demais_dela' using errcode = '42501', detail = p_user::text; end if;
  insert into public.grupo_membros (grupo_id, user_id, chave, por, cor) values (p_grupo, p_user, p_chave, u, public.cor_livre(p_grupo));
end $$;
revoke all on function public.grupo_adicionar(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grupo_adicionar(uuid, uuid, jsonb) to authenticated;

-- Escolher a própria cor: só a da própria linha; nunca uma cor já usada por outra pessoa do grupo (o índice único recusa)
create or replace function public.grupo_cor(p_grupo uuid, p_cor text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid());
begin
  perform public.consome('grupo_mudar', 30, 200);
  if p_cor is null or p_cor !~ '^(p[0-9]|#[0-9a-f]{6})$' then raise exception 'cor_invalida' using errcode = '22023'; end if;
  update public.grupo_membros gm set cor = p_cor where gm.grupo_id = p_grupo and gm.user_id = u;
  if not found then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
exception when unique_violation then raise exception 'cor_em_uso' using errcode = '23505';
end $$;
revoke all on function public.grupo_cor(uuid, text) from public, anon, authenticated;
grant execute on function public.grupo_cor(uuid, text) to authenticated;

drop function public.meus_grupos();
create or replace function public.meus_grupos() returns table (grupo_id uuid, nome jsonb, criado_em timestamptz, user_id uuid, username text, public_key jsonb, avatar text, admin boolean, entrou_em timestamptz, chave jsonb, por uuid, por_chave jsonb, foto jsonb, sub boolean, cor text)
language sql stable security definer set search_path = public as $$
  select g.id, g.nome, g.created_at, m.user_id, p.username, p.public_key, p.avatar, m.admin, m.entrou_em,
         case when m.user_id = (select auth.uid()) then m.chave end,
         case when m.user_id = (select auth.uid()) then m.por end,
         case when m.user_id = (select auth.uid()) then (select q.public_key from public.profiles q where q.id = m.por) end,
         g.foto, m.sub, m.cor
    from public.grupo_membros eu
    join public.grupos g on g.id = eu.grupo_id
    join public.grupo_membros m on m.grupo_id = g.id
    join public.profiles p on p.id = m.user_id
   where eu.user_id = (select auth.uid()) and (select public.mfa_ok())
   order by g.id, m.entrou_em, m.user_id
$$;
revoke all on function public.meus_grupos() from public, anon, authenticated;
grant execute on function public.meus_grupos() to authenticated;

-- Estatísticas do grupo: tempo de tela por pessoa e por dia (todos do grupo veem) + base para as moedas.
-- O servidor só conhece o que enxerga sem decifrar nada: segundos na tela e a data de entrada. O resto das estatísticas é contado no aparelho.
create table public.grupo_dia (
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dia date not null,
  segundos int not null default 0 check (segundos between 0 and 86400),
  primary key (grupo_id, user_id, dia)
);
alter table public.grupo_dia enable row level security;
revoke all on public.grupo_dia from anon, authenticated;
create policy "exige dois passos" on public.grupo_dia as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Soma segundos de tela de HOJE (dia de Brasília). Cada pedido soma no máximo 120 s e o dia nunca passa de 6 h: não dá para inflar o tempo à vontade.
create or replace function public.grupo_tela(p_grupo uuid, p_segundos int) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.consome('grupo_tela', 4, 120);
  if p_segundos is null or p_segundos < 1 then return; end if;
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  insert into public.grupo_dia (grupo_id, user_id, dia, segundos) values (p_grupo, u, hoje, least(p_segundos, 120))
    on conflict (grupo_id, user_id, dia) do update set segundos = least(public.grupo_dia.segundos + least(p_segundos, 120), 21600);
end $$;
revoke all on function public.grupo_tela(uuid, int) from public, anon, authenticated;
grant execute on function public.grupo_tela(uuid, int) to authenticated;

-- Tempo de tela dos últimos 35 dias de quem está no grupo (só quem está no grupo lê)
create or replace function public.grupo_estatisticas(p_grupo uuid) returns table (user_id uuid, dia date, segundos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query select d.user_id, d.dia, d.segundos from public.grupo_dia d
    join public.grupo_membros m on m.grupo_id = d.grupo_id and m.user_id = d.user_id
   where d.grupo_id = p_grupo and d.dia > (now() at time zone 'America/Sao_Paulo')::date - 35;
end $$;
revoke all on function public.grupo_estatisticas(uuid) from public, anon, authenticated;
grant execute on function public.grupo_estatisticas(uuid) to authenticated;

-- Território das moedas: um extrato (só soma ou desconta; ninguém logado escreve nele). Ainda nenhuma regra de ganho: quando houver, entra por uma função do servidor.
-- A chave (grupo, pessoa, motivo, ref) impede pagar duas vezes pelo mesmo motivo.
create table public.moedas_extrato (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  quantidade int not null check (quantidade <> 0),
  motivo text not null check (length(motivo) between 1 and 40),
  ref text not null default '' check (length(ref) < 80),
  criado_em timestamptz not null default now(),
  unique (grupo_id, user_id, motivo, ref)
);
alter table public.moedas_extrato enable row level security;
revoke all on public.moedas_extrato from anon, authenticated;
create policy "exige dois passos" on public.moedas_extrato as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create or replace function public.moedas_saldo(p_grupo uuid) returns table (user_id uuid, saldo bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query select e.user_id, sum(e.quantidade)::bigint from public.moedas_extrato e where e.grupo_id = p_grupo group by e.user_id;
end $$;
revoke all on function public.moedas_saldo(uuid) from public, anon, authenticated;
grant execute on function public.moedas_saldo(uuid) to authenticated;

-- Estatísticas: cada pessoa publica o que ELA enviou por dia (só contagens, sem conteúdo), para os números baterem em todos os aparelhos.
-- Quem lê usa o maior valor entre o que o próprio aparelho contou e o que foi publicado. É só exibição: não vale como prova para moedas.
alter table public.grupo_dia add column env jsonb not null default '{}'::jsonb check (pg_column_size(env) < 300);

create or replace function public.grupo_enviadas(p_grupo uuid, p_dias jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        it jsonb; k text; v jsonb; d date; novo jsonb; velho jsonb;
        chaves text[] := array['texto','foto','video','audio','figurinha','respostas','citou'];
begin
  perform public.consome('grupo_enviadas', 4, 60);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  if p_dias is null or jsonb_typeof(p_dias) <> 'array' or jsonb_array_length(p_dias) > 35 then raise exception 'dados_invalidos' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_dias) loop
    if jsonb_typeof(it) <> 'object' or jsonb_typeof(it->'dia') <> 'string' or (it->>'dia') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'dados_invalidos' using errcode = '22023'; end if;
    d := (it->>'dia')::date;
    if d > hoje + 1 or d < hoje - 35 then continue; end if;
    novo := '{}'::jsonb;
    foreach k in array chaves loop
      v := it->k;
      if v is not null then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d{1,6}$' then raise exception 'dados_invalidos' using errcode = '22023'; end if;
        if (v #>> '{}')::int > 0 then novo := novo || jsonb_build_object(k, (v #>> '{}')::int); end if;
      end if;
    end loop;
    insert into public.grupo_dia (grupo_id, user_id, dia, segundos, env) values (p_grupo, u, d, 0, novo)
      on conflict (grupo_id, user_id, dia) do update set env = (
        select coalesce(jsonb_object_agg(kk, greatest(coalesce((public.grupo_dia.env->>kk)::int, 0), coalesce((novo->>kk)::int, 0))), '{}'::jsonb)
          from unnest(chaves) kk where greatest(coalesce((public.grupo_dia.env->>kk)::int, 0), coalesce((novo->>kk)::int, 0)) > 0);
  end loop;
end $$;
revoke all on function public.grupo_enviadas(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grupo_enviadas(uuid, jsonb) to authenticated;

drop function public.grupo_estatisticas(uuid);
create or replace function public.grupo_estatisticas(p_grupo uuid) returns table (user_id uuid, dia date, segundos int, env jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query select d.user_id, d.dia, d.segundos, d.env from public.grupo_dia d
    join public.grupo_membros m on m.grupo_id = d.grupo_id and m.user_id = d.user_id
   where d.grupo_id = p_grupo and d.dia > (now() at time zone 'America/Sao_Paulo')::date - 36;
end $$;
revoke all on function public.grupo_estatisticas(uuid) from public, anon, authenticated;
grant execute on function public.grupo_estatisticas(uuid) to authenticated;

-- Estatísticas que o servidor confere (não dá para forjar um número grande):
-- (1) tempo de tela: só vale o tempo real que passou desde a última chamada da pessoa (um relógio só, em qualquer grupo ou aparelho);
-- (2) o servidor conta sozinho quantas mensagens cada pessoa mandou por dia (cada envio = um lote de linhas) e quantos arquivos ela enviou ao armazenamento;
--     o que a pessoa publica sobre os próprios tipos (grupo_enviadas) é limitado por essas duas contas ao exibir.
create table public.tela_ping (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ultimo timestamptz not null
);
alter table public.tela_ping enable row level security;
revoke all on public.tela_ping from anon, authenticated;
create policy "exige dois passos" on public.tela_ping as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create or replace function public.grupo_tela(p_grupo uuid, p_segundos int) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); hoje date := (now() at time zone 'America/Sao_Paulo')::date; antes timestamptz; passou numeric; credito int;
begin
  perform public.consome('grupo_tela', 4, 120);
  if p_segundos is null or p_segundos < 1 then return; end if;
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tela:' || u::text));
  select t.ultimo into antes from public.tela_ping t where t.user_id = u;
  insert into public.tela_ping (user_id, ultimo) values (u, now()) on conflict (user_id) do update set ultimo = now();
  passou := case when antes is null then null else extract(epoch from now() - antes) end;
  -- sessão nova (sem chamada nos últimos 3 min): no máximo um bloco normal (70 s); senão, no máximo o tempo que realmente passou (+6 s de folga)
  credito := least(p_segundos, 120, case when passou is null or passou > 180 then 70 else ceil(passou)::int + 6 end);
  if credito < 1 then return; end if;
  insert into public.grupo_dia (grupo_id, user_id, dia, segundos) values (p_grupo, u, hoje, credito)
    on conflict (grupo_id, user_id, dia) do update set segundos = least(public.grupo_dia.segundos + credito, 21600);
end $$;
revoke all on function public.grupo_tela(uuid, int) from public, anon, authenticated;
grant execute on function public.grupo_tela(uuid, int) to authenticated;

drop function public.grupo_estatisticas(uuid);
create or replace function public.grupo_estatisticas(p_grupo uuid) returns table (user_id uuid, dia date, segundos int, env jsonb, msgs int, arquivos int)
language plpgsql stable security definer set search_path = public, storage as $$
#variable_conflict use_column
declare lim date := (now() at time zone 'America/Sao_Paulo')::date - 36;
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query
  with mem as (select gm.user_id as uid from public.grupo_membros gm where gm.grupo_id = p_grupo),
  d as (select x.user_id as uid, x.dia as dia, x.segundos as seg, x.env as env from public.grupo_dia x where x.grupo_id = p_grupo and x.dia > lim and x.user_id in (select uid from mem)),
  s as (select ms.sender_id as uid, (ms.created_at at time zone 'America/Sao_Paulo')::date as dia, count(distinct ms.created_at)::int as n -- um envio = um lote de linhas com o mesmo horário (reações entram: é um limite máximo, nunca menos que o real)
          from public.messages ms where ms.grupo_id = p_grupo and ms.avisar and ms.created_at > now() - interval '37 days' and ms.sender_id in (select uid from mem) group by 1, 2),
  a as (select ((storage.foldername(o.name))[1])::uuid as uid, (o.created_at at time zone 'America/Sao_Paulo')::date as dia, count(*)::int as n
          from storage.objects o where o.bucket_id = 'media' and (storage.foldername(o.name))[2] = p_grupo::text and o.created_at > now() - interval '37 days' group by 1, 2),
  t as (select uid, dia from d union select uid, dia from s union select uid, dia from a)
  select t.uid, t.dia, coalesce(d.seg, 0), coalesce(d.env, '{}'::jsonb), coalesce(s.n, 0), coalesce(a.n, 0)
    from t left join d using (uid, dia) left join s using (uid, dia) left join a using (uid, dia)
   where t.dia > lim and t.uid in (select uid from mem);
end $$;
revoke all on function public.grupo_estatisticas(uuid) from public, anon, authenticated;
grant execute on function public.grupo_estatisticas(uuid) to authenticated;

-- ===== Selos: moeda de cada grupo. O admin define as regras; o servidor calcula os ganhos só com o que ele mesmo confere =====
-- Regras por grupo (um JSON validado), sem teto fixo de Selos por dia (só se o admin ligar o "teto"). Nada é retroativo: cada regra guarda a data em que foi ligada ("desde").
-- Ganho confirmado = linhas do extrato (moedas_extrato) de dias já encerrados (dia de Brasília). Ganho a confirmar = o de hoje, calculado na hora e ainda sem linha no extrato.
create table public.selo_regras (
  grupo_id uuid primary key references public.grupos(id) on delete cascade,
  regras jsonb not null check (pg_column_size(regras) < 4000),
  atualizado_em timestamptz not null default now(),
  por uuid references public.profiles(id) on delete set null
);
create table public.selo_apurado (
  grupo_id uuid primary key references public.grupos(id) on delete cascade,
  ate date not null
);
alter table public.selo_regras enable row level security;
alter table public.selo_apurado enable row level security;
revoke all on public.selo_regras, public.selo_apurado from anon, authenticated;
create policy "exige dois passos" on public.selo_regras as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy "exige dois passos" on public.selo_apurado as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create or replace function public.selo_int(p jsonb, k text, minimo int, maximo int, padrao int) returns int
language plpgsql immutable set search_path = public as $$
declare v jsonb := p -> k;
begin
  if v is null then return padrao; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d{1,4}$' or (v #>> '{}')::int < minimo or (v #>> '{}')::int > maximo then raise exception 'regras_invalidas' using errcode = '22023', detail = k; end if;
  return (v #>> '{}')::int;
end $$;

-- Valida e refaz o JSON de regras (só chaves conhecidas, números inteiros nos limites). "desde" é do servidor: vale a data em que a regra foi ligada.
create or replace function public.selo_limpa(novo jsonb, velho jsonb, hoje date) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb := '{}'::jsonb; k text; o jsonb; ant jsonb; lig boolean; it jsonb; ms jsonb := '[]'::jsonb; vistos int[] := '{}'; d int; v int; m jsonb;
begin
  if novo is null or jsonb_typeof(novo) <> 'object' then raise exception 'regras_invalidas' using errcode = '22023'; end if;
  foreach k in array array['entrada','dia_ativo','mensagens','arquivos','sequencia','teto'] loop
    o := coalesce(novo -> k, '{"on": false}'::jsonb); ant := coalesce(velho -> k, '{}'::jsonb);
    if jsonb_typeof(o) <> 'object' or jsonb_typeof(o -> 'on') <> 'boolean' then raise exception 'regras_invalidas' using errcode = '22023', detail = k; end if;
    lig := (o ->> 'on')::boolean; it := jsonb_build_object('on', lig);
    if k = 'sequencia' then
      m := coalesce(o -> 'marcos', '[]'::jsonb);
      if jsonb_typeof(m) <> 'array' or jsonb_array_length(m) > 10 then raise exception 'regras_invalidas' using errcode = '22023', detail = 'marcos'; end if;
      for v in select generate_series(0, jsonb_array_length(m) - 1) loop
        if jsonb_typeof(m -> v) <> 'object' then raise exception 'regras_invalidas' using errcode = '22023', detail = 'marcos'; end if;
        d := public.selo_int(m -> v, 'dias', 1, 365, 1);
        if d = any(vistos) then raise exception 'regras_invalidas' using errcode = '22023', detail = 'marcos'; end if;
        vistos := vistos || d; ms := ms || jsonb_build_array(jsonb_build_object('dias', d, 'valor', public.selo_int(m -> v, 'valor', 1, 999, 1)));
      end loop;
      it := it || jsonb_build_object('marcos', (select coalesce(jsonb_agg(e order by (e ->> 'dias')::int), '[]'::jsonb) from jsonb_array_elements(ms) e));
    else
      it := it || jsonb_build_object('valor', public.selo_int(o, 'valor', 1, 999, 1));
      if k = 'dia_ativo' then it := it || jsonb_build_object('min', public.selo_int(o, 'min', 1, 999, 1)); end if;
      if k in ('mensagens', 'arquivos') then it := it || jsonb_build_object('a_cada', public.selo_int(o, 'a_cada', 1, 999, 1)); end if;
    end if;
    if k <> 'teto' then -- (o teto não é ganho: não precisa de data)
      it := it || jsonb_build_object('desde', case when lig and (not coalesce((ant ->> 'on')::boolean, false) or ant ->> 'desde' is null) then hoje::text else coalesce(ant ->> 'desde', hoje::text) end);
    end if;
    r := r || jsonb_build_object(k, it);
  end loop;
  return r;
end $$;

-- O que uma pessoa ganha num dia (dia de Brasília), pelas regras dadas. Só usa o que o servidor confere: envios (lotes de linhas), arquivos enviados, data de entrada.
create or replace function public.selo_ganhos(p_grupo uuid, p_user uuid, p_dia date, p_regras jsonb) returns table (motivo text, ref text, qtd int)
language plpgsql stable security definer set search_path = public, storage as $$
#variable_conflict use_column
declare msgs int; arq int; resto int; q int; r jsonb; dias date[]; dd date; seq int := 0; mc jsonb; entrou timestamptz;
begin
  if p_regras is null then return; end if;
  select count(distinct ms.created_at)::int into msgs from public.messages ms
   where ms.grupo_id = p_grupo and ms.sender_id = p_user and ms.avisar and (ms.created_at at time zone 'America/Sao_Paulo')::date = p_dia;
  select count(*)::int into arq from storage.objects o
   where o.bucket_id = 'media' and (storage.foldername(o.name))[1] = p_user::text and (storage.foldername(o.name))[2] = p_grupo::text and (o.created_at at time zone 'America/Sao_Paulo')::date = p_dia;
  resto := case when (p_regras -> 'teto' ->> 'on')::boolean then (p_regras -> 'teto' ->> 'valor')::int else null end;
  r := p_regras -> 'entrada';
  if (r ->> 'on')::boolean then
    select gm.entrou_em into entrou from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = p_user;
    if entrou is not null and (entrou at time zone 'America/Sao_Paulo')::date = p_dia and p_dia >= (r ->> 'desde')::date then motivo := 'entrada'; ref := ''; qtd := (r ->> 'valor')::int; return next; end if;
  end if;
  r := p_regras -> 'dia_ativo';
  if (r ->> 'on')::boolean and p_dia >= (r ->> 'desde')::date and msgs >= (r ->> 'min')::int then
    q := (r ->> 'valor')::int; if resto is not null then q := least(q, resto); resto := resto - q; end if;
    if q > 0 then motivo := 'dia_ativo'; ref := p_dia::text; qtd := q; return next; end if;
  end if;
  r := p_regras -> 'mensagens';
  if (r ->> 'on')::boolean and p_dia >= (r ->> 'desde')::date then
    q := (msgs / (r ->> 'a_cada')::int) * (r ->> 'valor')::int; if resto is not null then q := least(q, resto); resto := resto - q; end if;
    if q > 0 then motivo := 'mensagens'; ref := p_dia::text; qtd := q; return next; end if;
  end if;
  r := p_regras -> 'arquivos';
  if (r ->> 'on')::boolean and p_dia >= (r ->> 'desde')::date then
    q := (arq / (r ->> 'a_cada')::int) * (r ->> 'valor')::int; if resto is not null then q := least(q, resto); resto := resto - q; end if;
    if q > 0 then motivo := 'arquivos'; ref := p_dia::text; qtd := q; return next; end if;
  end if;
  r := p_regras -> 'sequencia';
  if (r ->> 'on')::boolean and p_dia >= (r ->> 'desde')::date and msgs > 0 then
    select coalesce(array_agg(x.dia), '{}') into dias from (select distinct (ms.created_at at time zone 'America/Sao_Paulo')::date as dia from public.messages ms
      where ms.grupo_id = p_grupo and ms.sender_id = p_user and ms.avisar and ms.created_at > now() - interval '400 days') x;
    dd := p_dia; while dd = any(dias) and seq < 366 loop seq := seq + 1; dd := dd - 1; end loop;
    for mc in select e from jsonb_array_elements(r -> 'marcos') e where (e ->> 'dias')::int = seq loop
      motivo := 'sequencia'; ref := seq::text || ':' || (p_dia - seq + 1)::text; qtd := (mc ->> 'valor')::int; return next;
    end loop;
  end if;
end $$;

-- Fecha os dias encerrados (até ontem) que ainda não foram contados, com as regras de agora. Idempotente: o extrato tem chave única por pessoa, motivo e referência.
create or replace function public.selo_apurar(p_grupo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare reg jsonb; ate date; hoje date := (now() at time zone 'America/Sao_Paulo')::date; d date; m uuid;
begin
  perform pg_advisory_xact_lock(hashtext('selo:' || p_grupo::text));
  select s.regras into reg from public.selo_regras s where s.grupo_id = p_grupo; if reg is null then return; end if;
  select a.ate into ate from public.selo_apurado a where a.grupo_id = p_grupo;
  ate := greatest(coalesce(ate, hoje - 36), hoje - 36);
  for d in select g::date from generate_series(ate + 1, hoje - 1, interval '1 day') g loop
    for m in select gm.user_id from public.grupo_membros gm where gm.grupo_id = p_grupo loop
      insert into public.moedas_extrato (grupo_id, user_id, quantidade, motivo, ref)
        select p_grupo, m, g.qtd, g.motivo, g.ref from public.selo_ganhos(p_grupo, m, d, reg) g where g.qtd > 0
        on conflict (grupo_id, user_id, motivo, ref) do nothing;
    end loop;
  end loop;
  if hoje - 1 > ate then insert into public.selo_apurado (grupo_id, ate) values (p_grupo, hoje - 1) on conflict (grupo_id) do update set ate = excluded.ate; end if;
end $$;

-- Regras do grupo (qualquer membro lê)
create or replace function public.selo_regras_ver(p_grupo uuid) returns table (regras jsonb, atualizado_em timestamptz, por uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query select s.regras, s.atualizado_em, s.por from public.selo_regras s where s.grupo_id = p_grupo;
end $$;
revoke all on function public.selo_regras_ver(uuid) from public, anon, authenticated;
grant execute on function public.selo_regras_ver(uuid) to authenticated;

-- Só o admin muda. Antes de valer a regra nova, fecha os dias passados com a regra antiga (nada é retroativo). Sem mudança real, não mexe em nada (e não gera aviso).
create or replace function public.selo_regras_mudar(p_grupo uuid, p_regras jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); hoje date := (now() at time zone 'America/Sao_Paulo')::date; velho jsonb; novo jsonb;
begin
  perform public.consome('selo_regras', 60, 300);
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = u and gm.admin) then raise exception 'so_admin' using errcode = '42501'; end if;
  perform public.selo_apurar(p_grupo);
  select s.regras into velho from public.selo_regras s where s.grupo_id = p_grupo;
  novo := public.selo_limpa(p_regras, coalesce(velho, '{}'::jsonb), hoje);
  if velho is not distinct from novo then return; end if;
  insert into public.selo_regras (grupo_id, regras, atualizado_em, por) values (p_grupo, novo, now(), u)
    on conflict (grupo_id) do update set regras = excluded.regras, atualizado_em = now(), por = u;
end $$;
revoke all on function public.selo_regras_mudar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.selo_regras_mudar(uuid, jsonb) to authenticated;

-- Saldo de cada pessoa do grupo: confirmado (extrato) e a confirmar (hoje). Qualquer membro lê.
create or replace function public.selo_saldo(p_grupo uuid) returns table (user_id uuid, confirmados bigint, pendentes bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare reg jsonb; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  perform public.consome('selo_saldo', 20, 300);
  perform public.selo_apurar(p_grupo);
  select s.regras into reg from public.selo_regras s where s.grupo_id = p_grupo;
  return query select gm.user_id,
      coalesce((select sum(e.quantidade) from public.moedas_extrato e where e.grupo_id = p_grupo and e.user_id = gm.user_id), 0)::bigint,
      coalesce((select sum(g.qtd) from public.selo_ganhos(p_grupo, gm.user_id, hoje, reg) g), 0)::bigint
    from public.grupo_membros gm where gm.grupo_id = p_grupo;
end $$;
revoke all on function public.selo_saldo(uuid) from public, anon, authenticated;
grant execute on function public.selo_saldo(uuid) to authenticated;

-- Quando as regras de cada um dos meus grupos mudaram por último (para o aviso no chat)
create or replace function public.selos_resumo() returns table (grupo_id uuid, atualizado_em timestamptz, por uuid)
language sql stable security definer set search_path = public as $$
  select s.grupo_id, s.atualizado_em, s.por from public.selo_regras s
   where (select public.mfa_ok()) and exists (select 1 from public.grupo_membros gm where gm.grupo_id = s.grupo_id and gm.user_id = (select auth.uid()))
$$;
revoke all on function public.selos_resumo() from public, anon, authenticated;
grant execute on function public.selos_resumo() to authenticated;
revoke all on function public.selo_int(jsonb, text, int, int, int) from public, anon, authenticated;
revoke all on function public.selo_limpa(jsonb, jsonb, date) from public, anon, authenticated;
revoke all on function public.selo_ganhos(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.selo_apurar(uuid) from public, anon, authenticated;

-- Selos valem na hora: o servidor já conta tudo o que importa, então não há por que esperar o dia acabar.
-- Cada chamada recalcula o dia de HOJE também e grava no extrato; as linhas do dia só crescem (maior valor), nunca pagam em dobro (chave única) e nunca são tiradas.
-- "pendentes" fica sempre 0 (a assinatura de selo_saldo não muda, para quem ainda tem o site antigo aberto).
create or replace function public.selo_apurar(p_grupo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare reg jsonb; ate date; hoje date := (now() at time zone 'America/Sao_Paulo')::date; d date; m uuid;
begin
  perform pg_advisory_xact_lock(hashtext('selo:' || p_grupo::text));
  select s.regras into reg from public.selo_regras s where s.grupo_id = p_grupo; if reg is null then return; end if;
  select a.ate into ate from public.selo_apurado a where a.grupo_id = p_grupo;
  ate := greatest(coalesce(ate, hoje - 36), hoje - 36);
  for d in select g::date from generate_series(ate + 1, hoje, interval '1 day') g loop
    for m in select gm.user_id from public.grupo_membros gm where gm.grupo_id = p_grupo loop
      insert into public.moedas_extrato (grupo_id, user_id, quantidade, motivo, ref)
        select p_grupo, m, g.qtd, g.motivo, g.ref from public.selo_ganhos(p_grupo, m, d, reg) g where g.qtd > 0
        on conflict (grupo_id, user_id, motivo, ref) do update set quantidade = greatest(public.moedas_extrato.quantidade, excluded.quantidade);
    end loop;
  end loop;
  if hoje - 1 > ate then insert into public.selo_apurado (grupo_id, ate) values (p_grupo, hoje - 1) on conflict (grupo_id) do update set ate = excluded.ate; end if; -- (hoje nunca é "encerrado": é recalculado a cada chamada)
end $$;

create or replace function public.selo_saldo(p_grupo uuid) returns table (user_id uuid, confirmados bigint, pendentes bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (select public.mfa_ok()) or not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  perform public.consome('selo_saldo', 20, 300);
  perform public.selo_apurar(p_grupo);
  return query select gm.user_id, coalesce((select sum(e.quantidade) from public.moedas_extrato e where e.grupo_id = p_grupo and e.user_id = gm.user_id), 0)::bigint, 0::bigint
    from public.grupo_membros gm where gm.grupo_id = p_grupo;
end $$;
revoke all on function public.selo_apurar(uuid) from public, anon, authenticated;
revoke all on function public.selo_saldo(uuid) from public, anon, authenticated;
grant execute on function public.selo_saldo(uuid) to authenticated;

-- ===== Vários aparelhos na mesma conta, etapa 1 (migração aparelhos_etapa1) =====
-- Cada navegador/aparelho tem um identificador aleatório (32 hex) que só ele conhece. O servidor guarda quais aparelhos a conta tem e se cada um já foi
-- permitido por outro aparelho da conta. O 1º aparelho (nenhum permitido ainda) entra como 'aprovado'; os seguintes entram 'pendente' até um aparelho
-- aprovado permitir. Máximo de 5 por conta (pendentes contam). NESTA etapa nada disso muda o envio nem o recebimento de mensagens.
-- O identificador (id) é segredo do aparelho: nada o devolve ao app. Para apontar um aparelho na tela usa-se "ref", um código sem valor de acesso.
create table public.dispositivos (
  user_id uuid not null references public.profiles(id) on delete cascade,
  id text not null check (id ~ '^[0-9a-f]{32}$'),
  ref uuid not null default gen_random_uuid() unique,
  estado text not null check (estado in ('pendente', 'aprovado')),
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  aprovado_em timestamptz,
  aprovado_por text check (aprovado_por is null or aprovado_por ~ '^[0-9a-f]{32}$'),   -- id do aparelho que permitiu (o 1º aparelho se aprova sozinho)
  primary key (user_id, id),
  check ((estado = 'aprovado') = (aprovado_em is not null))
);
alter table public.dispositivos enable row level security;
revoke all on public.dispositivos from anon, authenticated;   -- ninguém logado lê nem escreve direto: só pelas funções abaixo
create policy "exige dois passos" on public.dispositivos as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Ligação sessão de login -> aparelho: é assim que o servidor sabe DE QUAL aparelho vem uma chamada (a sessão vem do JWT, que o app não forja)
create table public.dispositivo_sessoes (
  session_id uuid primary key,
  user_id uuid not null,
  dispositivo text not null,
  criado_em timestamptz not null default now(),
  foreign key (user_id, dispositivo) references public.dispositivos (user_id, id) on delete cascade
);
create index dispositivo_sessoes_por_aparelho on public.dispositivo_sessoes (user_id, dispositivo);
alter table public.dispositivo_sessoes enable row level security;
revoke all on public.dispositivo_sessoes from anon, authenticated;
create policy "exige dois passos" on public.dispositivo_sessoes as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- O aparelho desta chamada (linha vazia se a sessão ainda não registrou o aparelho, ou se a sessão já foi encerrada). Interna: ninguém logado chama.
create or replace function public.dispositivo_atual() returns public.dispositivos
language sql stable security definer set search_path = public, auth as $$
  select d.* from public.dispositivo_sessoes s
    join public.dispositivos d on d.user_id = s.user_id and d.id = s.dispositivo
   where s.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
     and s.user_id = (select auth.uid())
     and exists (select 1 from auth.sessions x where x.id = s.session_id)
$$;
revoke all on function public.dispositivo_atual() from public, anon, authenticated;

-- Registrar (ou reconfirmar) este aparelho. Idempotente. Devolve o estado: 'aprovado' ou 'pendente'.
create or replace function public.registrar_dispositivo(p_id text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); s uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; r public.dispositivos; est text;
begin
  perform public.consome('registrar_dispositivo', 20, 200);
  if s is null or not (select public.mfa_ok()) or not exists (select 1 from auth.sessions x where x.id = s) then raise exception 'nao_autorizado' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[0-9a-f]{32}$' then raise exception 'aparelho_invalido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));   -- uma conta por vez: "o primeiro aparelho" e o limite não têm corrida
  select * into r from public.dispositivos d where d.user_id = u and d.id = p_id;
  if not found then
    if (select count(*) from public.dispositivos d where d.user_id = u) >= 5 then raise exception 'limite_de_aparelhos'; end if;
    est := case when exists (select 1 from public.dispositivos d where d.user_id = u and d.estado = 'aprovado') then 'pendente' else 'aprovado' end;
    insert into public.dispositivos (user_id, id, estado, aprovado_em, aprovado_por)
      values (u, p_id, est, case when est = 'aprovado' then now() end, case when est = 'aprovado' then p_id end);
  elsif r.estado = 'pendente' and not exists (select 1 from public.dispositivos d where d.user_id = u and d.estado = 'aprovado') then
    -- ninguém aprovado restou na conta (o último saiu): não há quem permita, então este vira o primeiro
    est := 'aprovado';
    update public.dispositivos d set estado = 'aprovado', aprovado_em = now(), aprovado_por = p_id, visto_em = now() where d.user_id = u and d.id = p_id;
  else
    est := r.estado;
    update public.dispositivos d set visto_em = now() where d.user_id = u and d.id = p_id;
  end if;
  insert into public.dispositivo_sessoes (session_id, user_id, dispositivo) values (s, u, p_id)
    on conflict (session_id) do update set dispositivo = excluded.dispositivo where public.dispositivo_sessoes.user_id = u;
  delete from public.dispositivo_sessoes x where x.user_id = u and not exists (select 1 from auth.sessions a where a.id = x.session_id);   -- sessões que já acabaram
  return est;
end $$;
revoke all on function public.registrar_dispositivo(text) from public, anon, authenticated;
grant execute on function public.registrar_dispositivo(text) to authenticated;

-- Os aparelhos da própria conta (sem o identificador secreto). O nome ("Chrome no Windows") vem do acesso mais recente daquele aparelho.
create or replace function public.meus_dispositivos() returns table (ref uuid, estado text, criado_em timestamptz, visto_em timestamptz, aprovado_em timestamptz, atual boolean, navegador text, sistema text, tipo text, pais_codigo text, regiao text, cidade text)
language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
declare u uuid := auth.uid(); cur public.dispositivos;
begin
  perform public.consome('meus_dispositivos', 60, 600);
  if not (select public.mfa_ok()) or not exists (select 1 from auth.sessions x where x.id = nullif(auth.jwt() ->> 'session_id', '')::uuid) then return; end if;   -- (sessão já encerrada: nada)
  cur := public.dispositivo_atual();
  return query
    select d.ref, d.estado, d.criado_em, d.visto_em, d.aprovado_em, d.id = cur.id, ap.navegador, ap.sistema, ap.tipo, ap.pais_codigo, ap.regiao, ap.cidade
      from public.dispositivos d
      left join lateral (select a.navegador, a.sistema, a.tipo, a.pais_codigo, a.regiao, a.cidade
                           from public.dispositivo_sessoes s join public.aparelhos a on a.session_id = s.session_id
                          where s.user_id = d.user_id and s.dispositivo = d.id order by a.ultimo_acesso desc limit 1) ap on true
     where d.user_id = u order by d.criado_em, d.ref;
end $$;
revoke all on function public.meus_dispositivos() from public, anon, authenticated;
grant execute on function public.meus_dispositivos() to authenticated;

-- Permitir (p_permitir = true) ou recusar um aparelho PENDENTE. Só vale se a chamada vem de um aparelho APROVADO da mesma conta.
-- Recusar apaga o registro, as chaves de recepção e as SESSÕES de login dele (o aparelho é desconectado). Devolve false (sem mudar nada) quando não pode.
create or replace function public.decidir_dispositivo(p_ref uuid, p_permitir boolean) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos; alvo public.dispositivos;
begin
  perform public.consome('decidir_dispositivo', 30, 200);
  if p_ref is null or p_permitir is null or not (select public.mfa_ok()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null or cur.estado <> 'aprovado' then return false; end if;
  select * into alvo from public.dispositivos d where d.user_id = u and d.ref = p_ref and d.estado = 'pendente';
  if not found then return false; end if;
  if p_permitir then
    update public.dispositivos d set estado = 'aprovado', aprovado_em = now(), aprovado_por = cur.id where d.user_id = u and d.id = alvo.id;
  else
    delete from auth.sessions a where a.id in (select s.session_id from public.dispositivo_sessoes s where s.user_id = u and s.dispositivo = alvo.id);   -- desconecta o aparelho (apagar a sessão leva os refresh tokens)
    delete from public.prekeys k where k.user_id = u and k.aparelho = alvo.id;
    delete from public.dispositivos d where d.user_id = u and d.id = alvo.id;
  end if;
  return true;
end $$;
revoke all on function public.decidir_dispositivo(uuid, boolean) from public, anon, authenticated;
grant execute on function public.decidir_dispositivo(uuid, boolean) to authenticated;

-- Remover um aparelho (aprovado ou pendente): apaga o registro e as chaves de recepção dele (e, sendo OUTRO aparelho, desconecta as sessões dele). Um aparelho pode remover a si mesmo (em qualquer estado);
-- remover OUTRO só vale vindo de um aparelho aprovado. Um pendente não mexe nos outros.
create or replace function public.remover_dispositivo(p_ref uuid) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos; alvo public.dispositivos;
begin
  perform public.consome('remover_dispositivo', 30, 200);
  if p_ref is null or not (select public.mfa_ok()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null then return false; end if;
  select * into alvo from public.dispositivos d where d.user_id = u and d.ref = p_ref;
  if not found then return false; end if;
  if alvo.id <> cur.id and cur.estado <> 'aprovado' then return false; end if;
  if alvo.id <> cur.id then
      delete from auth.sessions a where a.id in (select s.session_id from public.dispositivo_sessoes s where s.user_id = u and s.dispositivo = alvo.id);   -- desconecta o aparelho (apagar a sessão leva os refresh tokens)
  end if;
  delete from public.prekeys k where k.user_id = u and k.aparelho = alvo.id;
  delete from public.dispositivos d where d.user_id = u and d.id = alvo.id;
  return true;
end $$;
revoke all on function public.remover_dispositivo(uuid) from public, anon, authenticated;
grant execute on function public.remover_dispositivo(uuid) to authenticated;

-- Chaves de recepção marcadas com o aparelho que as guarda (nula nas antigas). Quem busca (get_prekey) continua igual: ainda não filtra por aparelho.
alter table public.prekeys add column aparelho text check (aparelho is null or aparelho ~ '^[0-9a-f]{32}$');
create index prekeys_por_aparelho on public.prekeys (user_id, aparelho);
-- A coluna nova não é legível por quem está logado (senão um aparelho pendente leria o identificador secreto dos outros): leitura só das colunas de sempre
revoke select on public.prekeys from authenticated;
grant select (user_id, id, public_key, created_at) on public.prekeys to authenticated;
-- Só dá para marcar uma chave com o aparelho DESTA sessão (que por sua vez é da própria conta). Interna: é gatilho.
create or replace function public.valida_aparelho_prekey() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.aparelho is null then return new; end if;
  if (select auth.jwt() ->> 'role') = 'authenticated' then
    if (public.dispositivo_atual()).id is distinct from new.aparelho then raise exception 'aparelho_invalido' using errcode = '42501'; end if;
  elsif not exists (select 1 from public.dispositivos d where d.user_id = new.user_id and d.id = new.aparelho) then raise exception 'aparelho_invalido' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.valida_aparelho_prekey() from public, anon, authenticated;
create trigger valida_aparelho_prekey before insert on public.prekeys
  for each row execute function public.valida_aparelho_prekey();

-- ===== Vários aparelhos na mesma conta, etapa 2 (migração aparelhos_etapa2) =====
-- Conversa a dois: cada mensagem vai cifrada separadamente para CADA aparelho aprovado de quem recebe e para CADA OUTRO aparelho aprovado de quem envia.
-- para_aparelho = "ref" (código público) do aparelho de destino (nulo = formato antigo: uma cópia que qualquer aparelho aprovado da pessoa enxerga).
-- de_aparelho = "ref" do aparelho que enviou, preenchido PELO SERVIDOR (o cliente não tem permissão de gravar a coluna). O identificador secreto do aparelho nunca sai.
-- Um aparelho PENDENTE não lê, não envia e não aparece para quem envia. Sessão de login sem aparelho registrado (site antigo em cache) segue lendo só o formato antigo.
alter table public.messages add column para_aparelho uuid, add column de_aparelho uuid;
alter table public.messages add constraint messages_aparelho_so_a_dois check (para_aparelho is null or grupo_id is null);
create index messages_para_aparelho on public.messages (recipient_id, para_aparelho, id) where para_aparelho is not null;
create index messages_irmas on public.messages (recipient_id, sender_id, created_at) where para_aparelho is not null;
revoke insert on public.messages from authenticated;
grant insert (recipient_id, ciphertext, iv, v, header, avisar, grupo_id, citado, para_aparelho) on public.messages to authenticated;   -- (de_aparelho fica de fora: só o gatilho preenche)

-- Recuperação: o pendente pede; o prazo é contado pelo relógio do banco
alter table public.dispositivos add column recuperacao_pedida_em timestamptz;

-- Estado e código do aparelho DESTA chamada (só dizem respeito a quem chama; as políticas precisam executá-las)
create or replace function public.aparelho_estado() returns text
language sql stable security definer set search_path = public, auth as $$ select (public.dispositivo_atual()).estado $$;
create or replace function public.aparelho_ref() returns uuid
language sql stable security definer set search_path = public, auth as $$ select case when (public.dispositivo_atual()).estado = 'aprovado' then (public.dispositivo_atual()).ref end $$;
revoke all on function public.aparelho_estado() from public, anon, authenticated;
revoke all on function public.aparelho_ref() from public, anon, authenticated;
grant execute on function public.aparelho_estado() to authenticated;
grant execute on function public.aparelho_ref() to authenticated;

-- Quem lê: pendente nada. Quem enviou lê o que enviou (menos as cópias para si mesmo, que só o aparelho de destino e o que as criou leem).
-- Quem recebe lê o formato antigo (para_aparelho nulo) e só as cópias endereçadas ao SEU aparelho.
alter policy "le proprias mensagens" on public.messages using (
  coalesce((select public.aparelho_estado()), 'aprovado') <> 'pendente' and (
    (sender_id = (select auth.uid()) and (recipient_id <> sender_id or de_aparelho = (select public.aparelho_ref())))
    or (recipient_id = (select auth.uid()) and (para_aparelho is null or para_aparelho = (select public.aparelho_ref())))));
alter policy "destinatario marca como lida" on public.messages
  using (recipient_id = (select auth.uid()) and sender_id <> recipient_id and coalesce((select public.aparelho_estado()), 'aprovado') <> 'pendente' and (para_aparelho is null or para_aparelho = (select public.aparelho_ref())))
  with check (recipient_id = (select auth.uid()) and sender_id <> recipient_id and coalesce((select public.aparelho_estado()), 'aprovado') <> 'pendente' and (para_aparelho is null or para_aparelho = (select public.aparelho_ref())));
alter policy "envia como si mesmo" on public.messages with check (
  sender_id = (select auth.uid()) and v = 2 and coalesce((select public.aparelho_estado()), 'aprovado') <> 'pendente'
  and (grupo_id is null or public.pode_enviar_ao_grupo(grupo_id, recipient_id)));

-- Gatilho de inserção: preenche de_aparelho e confere o destino (aparelho APROVADO de quem recebe; cópia para si só para OUTRO aparelho aprovado meu). Interna.
create or replace function public.confere_aparelho_mensagem() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare cur public.dispositivos;
begin
  cur := public.dispositivo_atual();
  new.de_aparelho := case when cur.estado = 'aprovado' then cur.ref end;   -- (qualquer valor vindo do cliente é descartado)
  if new.para_aparelho is not null then
    if not exists (select 1 from public.dispositivos d where d.user_id = new.recipient_id and d.ref = new.para_aparelho and d.estado = 'aprovado') then
      raise exception 'aparelho_invalido' using errcode = '42501';
    end if;
    if new.recipient_id = new.sender_id and (cur.ref is null or cur.estado <> 'aprovado' or new.para_aparelho = cur.ref) then
      raise exception 'copia_propria_invalida' using errcode = '42501';
    end if;
  elsif new.recipient_id = new.sender_id then
    raise exception 'copia_propria_invalida' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.confere_aparelho_mensagem() from public, anon, authenticated;
create trigger confere_aparelho_mensagem before insert on public.messages for each row execute function public.confere_aparelho_mensagem();

-- Push: UM aviso por mensagem por pessoa (só a linha de menor id da leva avisa) e nenhum para cópia própria
create or replace function public.notificar_mensagem() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if new.recipient_id = new.sender_id then return new; end if;
  if new.para_aparelho is not null and exists (select 1 from public.messages m where m.sender_id = new.sender_id and m.recipient_id = new.recipient_id
       and m.created_at = new.created_at and m.para_aparelho is not null and m.id < new.id) then return new; end if;
  select valor into u from public.push_config where chave = 'functions_url';
  if u is null then return new; end if;
  perform net.http_post(url := u || '/notificar', headers := jsonb_build_object('content-type', 'application/json'),
    body := jsonb_build_object('mensagem', new.id, 'destinatario', new.recipient_id), timeout_milliseconds := 4000);
  return new;
exception when others then return new;
end $$;

-- Chaves: a antiga só devolve chave de aparelho aprovado (ou sem marca); a nova devolve a mais recente de CADA aparelho aprovado (pode ser a minha própria conta)
create or replace function public.get_prekey(p_user uuid)
returns table (id text, public_key jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.consome('get_prekey', 30, 300);
  return query select k.id, k.public_key from public.prekeys k
    left join public.dispositivos d on d.user_id = k.user_id and d.id = k.aparelho
    where k.user_id = p_user and (k.aparelho is null or d.estado = 'aprovado') order by k.created_at desc limit 1;
end $$;
revoke all on function public.get_prekey(uuid) from public, anon, authenticated;
grant execute on function public.get_prekey(uuid) to authenticated;

create or replace function public.get_prekeys_aparelhos(p_user uuid)
returns table (ref uuid, id text, public_key jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.consome('get_prekeys_aparelhos', 30, 300);
  if coalesce(public.aparelho_estado(), 'aprovado') = 'pendente' then return; end if;
  return query select distinct on (d.ref) d.ref, k.id, k.public_key from public.dispositivos d
    join public.prekeys k on k.user_id = d.user_id and k.aparelho = d.id
    where d.user_id = p_user and d.estado = 'aprovado' order by d.ref, k.created_at desc;
end $$;
revoke all on function public.get_prekeys_aparelhos(uuid) from public, anon, authenticated;
grant execute on function public.get_prekeys_aparelhos(uuid) to authenticated;

-- Lida: ler num aparelho marca a mensagem como lida em TODAS as cópias que recebi (as dos meus outros aparelhos), o que respeita a política nova
create or replace function public.marcar_lidas(p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := (select auth.uid()); r uuid;
begin
  perform public.consome('marcar_lidas', 120, 2000);
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  if array_length(p_ids, 1) > 300 then raise exception 'lote grande demais' using errcode = '22023'; end if;
  if coalesce(public.aparelho_estado(), 'aprovado') = 'pendente' then return; end if;
  r := public.aparelho_ref();
  update public.messages m set read_at = now() where m.id = any(p_ids) and m.recipient_id = u and m.sender_id <> u and m.read_at is null and (m.para_aparelho is null or m.para_aparelho = r);
  if r is not null then
    update public.messages m set read_at = now() from public.messages x
     where x.id = any(p_ids) and x.recipient_id = u and x.sender_id <> u and x.para_aparelho = r
       and m.recipient_id = u and m.sender_id = x.sender_id and m.created_at = x.created_at and m.para_aparelho is not null and m.read_at is null;
  end if;
end $$;
revoke all on function public.marcar_lidas(bigint[]) from public, anon, authenticated;
grant execute on function public.marcar_lidas(bigint[]) to authenticated;

-- Prazo da recuperação: 24 horas (parâmetro interno em push_config, que ninguém logado lê; serve para o projeto de TESTE encurtar o prazo)
create or replace function public.recuperacao_prazo() returns interval
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select valor into v from public.push_config where chave = 'recuperacao_prazo';
  return coalesce(v::interval, interval '24 hours');
exception when others then return interval '24 hours';
end $$;
revoke all on function public.recuperacao_prazo() from public, anon, authenticated;

-- Registrar: sem o atalho "o pendente vira aprovado ao reabrir". Só o 1º aparelho de uma conta SEM nenhum aprovado entra aprovado; pendente só vira aprovado por permissão ou por recuperação.
create or replace function public.registrar_dispositivo(p_id text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); s uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; r public.dispositivos; est text;
begin
  perform public.consome('registrar_dispositivo', 20, 200);
  if s is null or not (select public.mfa_ok()) or not exists (select 1 from auth.sessions x where x.id = s) then raise exception 'nao_autorizado' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[0-9a-f]{32}$' then raise exception 'aparelho_invalido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  select * into r from public.dispositivos d where d.user_id = u and d.id = p_id;
  if not found then
    if (select count(*) from public.dispositivos d where d.user_id = u) >= 5 then raise exception 'limite_de_aparelhos'; end if;
    est := case when exists (select 1 from public.dispositivos d where d.user_id = u and d.estado = 'aprovado') then 'pendente' else 'aprovado' end;
    insert into public.dispositivos (user_id, id, estado, aprovado_em, aprovado_por)
      values (u, p_id, est, case when est = 'aprovado' then now() end, case when est = 'aprovado' then p_id end);
  else
    est := r.estado;
    update public.dispositivos d set visto_em = now() where d.user_id = u and d.id = p_id;
  end if;
  insert into public.dispositivo_sessoes (session_id, user_id, dispositivo) values (s, u, p_id)
    on conflict (session_id) do update set dispositivo = excluded.dispositivo where public.dispositivo_sessoes.user_id = u;
  delete from public.dispositivo_sessoes x where x.user_id = u and not exists (select 1 from auth.sessions a where a.id = x.session_id);
  return est;
end $$;
revoke all on function public.registrar_dispositivo(text) from public, anon, authenticated;
grant execute on function public.registrar_dispositivo(text) to authenticated;

-- Permitir apaga qualquer pedido de recuperação do aparelho
create or replace function public.decidir_dispositivo(p_ref uuid, p_permitir boolean) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos; alvo public.dispositivos;
begin
  perform public.consome('decidir_dispositivo', 30, 200);
  if p_ref is null or p_permitir is null or not (select public.mfa_ok()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null or cur.estado <> 'aprovado' then return false; end if;
  select * into alvo from public.dispositivos d where d.user_id = u and d.ref = p_ref and d.estado = 'pendente';
  if not found then return false; end if;
  if p_permitir then
    update public.dispositivos d set estado = 'aprovado', aprovado_em = now(), aprovado_por = cur.id, recuperacao_pedida_em = null where d.user_id = u and d.id = alvo.id;
  else
    delete from auth.sessions a where a.id in (select s.session_id from public.dispositivo_sessoes s where s.user_id = u and s.dispositivo = alvo.id);
    delete from public.prekeys k where k.user_id = u and k.aparelho = alvo.id;
    delete from public.dispositivos d where d.user_id = u and d.id = alvo.id;
  end if;
  return true;
end $$;
revoke all on function public.decidir_dispositivo(uuid, boolean) from public, anon, authenticated;
grant execute on function public.decidir_dispositivo(uuid, boolean) to authenticated;

-- Os aparelhos da conta, com o pedido de recuperação (quando foi pedido e quando vale) e a hora do banco
create or replace function public.dispositivos_conta() returns table (ref uuid, estado text, criado_em timestamptz, visto_em timestamptz, aprovado_em timestamptz, atual boolean, navegador text, sistema text, tipo text, pais_codigo text, regiao text, cidade text, recuperacao_em timestamptz, vale_em timestamptz, agora timestamptz)
language plpgsql security definer set search_path = public, auth as $$
#variable_conflict use_column
declare u uuid := auth.uid(); cur public.dispositivos;
begin
  perform public.consome('meus_dispositivos', 60, 600);
  if not (select public.mfa_ok()) or not exists (select 1 from auth.sessions x where x.id = nullif(auth.jwt() ->> 'session_id', '')::uuid) then return; end if;
  cur := public.dispositivo_atual();
  return query
    select d.ref, d.estado, d.criado_em, d.visto_em, d.aprovado_em, d.id = cur.id, ap.navegador, ap.sistema, ap.tipo, ap.pais_codigo, ap.regiao, ap.cidade,
           d.recuperacao_pedida_em, d.recuperacao_pedida_em + public.recuperacao_prazo(), now()
      from public.dispositivos d
      left join lateral (select a.navegador, a.sistema, a.tipo, a.pais_codigo, a.regiao, a.cidade
                           from public.dispositivo_sessoes s join public.aparelhos a on a.session_id = s.session_id
                          where s.user_id = d.user_id and s.dispositivo = d.id order by a.ultimo_acesso desc limit 1) ap on true
     where d.user_id = u order by d.criado_em, d.ref;
end $$;
revoke all on function public.dispositivos_conta() from public, anon, authenticated;
grant execute on function public.dispositivos_conta() to authenticated;

-- Recuperação ("perdi o único aparelho"): só um aparelho PENDENTE pede; um pedido por vez; vale 24 h depois, se ninguém recusar. Tudo pelo relógio do banco.
create or replace function public.pedir_recuperacao() returns timestamptz
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos; t timestamptz;
begin
  perform public.consome('recuperacao', 10, 60);
  if not (select public.mfa_ok()) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null or cur.estado <> 'pendente' then return null; end if;
  update public.dispositivos d set recuperacao_pedida_em = coalesce(d.recuperacao_pedida_em, now()) where d.user_id = u and d.id = cur.id returning d.recuperacao_pedida_em into t;
  return t;
end $$;
revoke all on function public.pedir_recuperacao() from public, anon, authenticated;
grant execute on function public.pedir_recuperacao() to authenticated;

create or replace function public.cancelar_recuperacao() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos;
begin
  perform public.consome('recuperacao', 10, 60);
  if not (select public.mfa_ok()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null or cur.estado <> 'pendente' then return false; end if;
  update public.dispositivos d set recuperacao_pedida_em = null where d.user_id = u and d.id = cur.id;
  return true;
end $$;
revoke all on function public.cancelar_recuperacao() from public, anon, authenticated;
grant execute on function public.cancelar_recuperacao() to authenticated;

-- Concluir: só o próprio aparelho pendente, só depois do prazo contado pelo banco. Remove e desconecta TODOS os outros aparelhos e vira o único aprovado.
create or replace function public.concluir_recuperacao() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare u uuid := auth.uid(); cur public.dispositivos; s uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  perform public.consome('recuperacao', 10, 60);
  if not (select public.mfa_ok()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('dispositivos:' || u::text, 0));
  cur := public.dispositivo_atual();
  if cur.id is null or cur.estado <> 'pendente' or cur.recuperacao_pedida_em is null or now() < cur.recuperacao_pedida_em + public.recuperacao_prazo() then return false; end if;
  delete from auth.sessions a where a.user_id = u and a.id is distinct from s;
  delete from public.prekeys k where k.user_id = u and k.aparelho is distinct from cur.id;
  delete from public.dispositivos d where d.user_id = u and d.id <> cur.id;
  update public.dispositivos d set estado = 'aprovado', aprovado_em = now(), aprovado_por = cur.id, recuperacao_pedida_em = null where d.user_id = u and d.id = cur.id;
  return true;
end $$;
revoke all on function public.concluir_recuperacao() from public, anon, authenticated;
grant execute on function public.concluir_recuperacao() to authenticated;

-- ===== Vários aparelhos na mesma conta, etapa 3 (migração aparelhos_etapa3): grupos =====
-- A mensagem de grupo passa a ir cifrada para CADA aparelho aprovado de cada participante e para CADA outro aparelho de quem envia (como já era na conversa a dois).
-- Quem ainda não usa aparelhos continua recebendo uma cópia só (para_aparelho nulo). O grupo vai na linha e dentro do conteúdo cifrado.
alter table public.messages drop constraint messages_aparelho_so_a_dois;   -- (a etapa 2 só permitia cópia por aparelho fora de grupo)

-- Enviar ao grupo: aos outros participantes, como sempre; e a mim mesmo só como cópia para OUTRO aparelho meu (o gatilho confere_aparelho_mensagem confere o aparelho)
alter policy "envia como si mesmo" on public.messages with check (
  sender_id = (select auth.uid()) and v = 2 and coalesce((select public.aparelho_estado()), 'aprovado') <> 'pendente'
  and (grupo_id is null or public.pode_enviar_ao_grupo(grupo_id, recipient_id)
       or (recipient_id = (select auth.uid()) and para_aparelho is not null and public.membro_de(grupo_id::text))));

-- Limites de envio, conferidos UMA vez por pedido (antes eram conferidos a cada linha, o que ficava lento num pedido de 100 linhas):
--   * um pedido leva até 100 linhas: grupo de 20 pessoas com 5 aparelhos cada = 19 × 5 + 4 cópias para os meus outros aparelhos = 99;
--   * por pessoa, contam MENSAGENS (um envio = um pedido = um horário), não linhas: 300 por minuto e 5000 por hora, como já era na conversa a dois com um aparelho;
--   * as linhas têm um teto próprio, mais alto (3000 por minuto e 30000 por hora), para ninguém encher o banco com pedidos grandes.
-- O gatilho roda depois de inserir: se passar do limite, o pedido inteiro é desfeito.
create or replace function public.limita_lote_mensagens() returns trigger
language plpgsql set search_path = public as $$
declare r record;
begin
  if (select count(*) from novas) > 100 then
    raise exception 'lote grande demais' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  for r in select distinct n.sender_id from novas n loop
    if (select count(distinct m.created_at) filter (where m.created_at > now() - interval '1 minute') > 300 or count(distinct m.created_at) > 5000
            or count(*) filter (where m.created_at > now() - interval '1 minute') > 3000 or count(*) > 30000
          from public.messages m where m.sender_id = r.sender_id and m.created_at > now() - interval '1 hour') then
      raise exception 'limite de mensagens atingido: espere um pouco' using errcode = 'PT429', hint = 'rate_limit';
    end if;
  end loop;
  return null;
end $$;
-- (o gatilho por linha continua existindo, mas não faz mais nada: a conferência é a do pedido, acima)
create or replace function public.limita_mensagens() returns trigger
language plpgsql set search_path = public as $$
begin
  return new;
end $$;

-- As chaves de recepção de TODOS os aparelhos aprovados de quem está no grupo, numa chamada só (inclui os meus: servem para as cópias). Só participante chama; pendente não.
create or replace function public.get_prekeys_grupo(p_grupo uuid)
returns table (user_id uuid, ref uuid, id text, public_key jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.consome('get_prekeys_grupo', 30, 600);
  if coalesce(public.aparelho_estado(), 'aprovado') = 'pendente' then return; end if;
  if not exists (select 1 from public.grupo_membros gm where gm.grupo_id = p_grupo and gm.user_id = (select auth.uid())) then raise exception 'nao_esta_no_grupo' using errcode = '42501'; end if;
  return query select distinct on (d.user_id, d.ref) d.user_id, d.ref, k.id, k.public_key
    from public.grupo_membros gm
    join public.dispositivos d on d.user_id = gm.user_id and d.estado = 'aprovado'
    join public.prekeys k on k.user_id = d.user_id and k.aparelho = d.id
   where gm.grupo_id = p_grupo order by d.user_id, d.ref, k.created_at desc;
end $$;
revoke all on function public.get_prekeys_grupo(uuid) from public, anon, authenticated;
grant execute on function public.get_prekeys_grupo(uuid) to authenticated;
