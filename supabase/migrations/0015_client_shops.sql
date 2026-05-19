-- ============================================================================
-- TurnosBarbería — vinculación cliente N:M con shops.
--
-- Antes, profile.shop_id era el ÚNICO "shop atado" al cliente, y se
-- sobrescribía en cada primer booking. Si un cliente reservaba en barbería
-- A y después en B, perdía la referencia a A.
--
-- Esta migración introduce client_shops como tabla N:M, con un flag
-- is_primary para indicar cuál es la barbería "casa" del cliente (lo que
-- se usa por defecto al loguearse para mandarlo a su shop).
--
-- profile.shop_id queda como referencia rápida (no lo deprecamos por compat),
-- y se mantiene sincronizado con la fila is_primary.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.client_shops (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (profile_id, shop_id)
);

create index if not exists client_shops_profile_idx on public.client_shops(profile_id);
create index if not exists client_shops_primary_idx on public.client_shops(profile_id) where is_primary;

-- Solo una primaria por profile.
create unique index if not exists client_shops_one_primary
  on public.client_shops(profile_id)
  where is_primary;

alter table public.client_shops enable row level security;

-- El cliente lee y maneja sus propias vinculaciones.
drop policy if exists "client_shops self read" on public.client_shops;
create policy "client_shops self read"
  on public.client_shops for select
  using (profile_id = auth.uid());

drop policy if exists "client_shops self write" on public.client_shops;
create policy "client_shops self write"
  on public.client_shops for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Backfill: cada cliente con profile.shop_id seteado obtiene una fila
-- is_primary=true. is_admin=true se excluye (su shop_id es el panel admin,
-- no una vinculación de cliente).
insert into public.client_shops (profile_id, shop_id, is_primary)
  select id, shop_id, true
  from public.profiles
  where shop_id is not null
    and is_admin = false
on conflict (profile_id, shop_id) do nothing;

-- Trigger: si se pone is_primary=true en una fila, las otras filas del
-- mismo profile_id se ponen en false. Mantiene la invariante de "una sola
-- primaria por cliente".
create or replace function public.enforce_single_primary_shop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_primary then
    update public.client_shops
    set is_primary = false
    where profile_id = new.profile_id
      and shop_id <> new.shop_id
      and is_primary;
    -- También sincronizamos profile.shop_id para que las queries que aún
    -- usan ese campo (cookies de "última barbería", redirects post-login)
    -- vean la primaria actualizada. Sin tocar is_admin para admins.
    update public.profiles
    set shop_id = new.shop_id
    where id = new.profile_id
      and is_admin = false;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_single_primary on public.client_shops;
create trigger trg_enforce_single_primary
  before insert or update of is_primary on public.client_shops
  for each row execute function public.enforce_single_primary_shop();
