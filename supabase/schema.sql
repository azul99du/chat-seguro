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
