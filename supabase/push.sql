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
