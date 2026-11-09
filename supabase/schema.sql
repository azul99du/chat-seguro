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
