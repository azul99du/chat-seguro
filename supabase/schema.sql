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
