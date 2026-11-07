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
