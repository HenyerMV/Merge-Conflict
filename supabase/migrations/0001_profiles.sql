-- MERGE CONFLICT · Fase 4: perfiles + avatares + RLS
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text,
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text,
  wins int not null default 0,
  current_win_streak int not null default 0,
  best_win_streak int not null default 0,
  fastest_win_seconds numeric(8,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- El jugador solo ve y edita lo suyo. No hay política de INSERT/DELETE para clientes.
create policy "perfil: leer el propio" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "perfil: editar el propio" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Estadísticas (wins, rachas, fastest_win_seconds) NO son editables desde el cliente:
-- solo el servidor (service role) las escribirá en las Fases 7-8.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, avatar_url) on public.profiles to authenticated;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Perfil automático al registrarse (usuario nuevo con Google).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id,
          'jugador_' || substr(replace(new.id::text, '-', ''), 1, 8),
          new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Fotos de perfil: bucket público, 2 MB, solo imágenes, carpeta = id del usuario.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "avatars: lectura pública" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars: subir en su carpeta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: actualizar el suyo" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: borrar el suyo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
