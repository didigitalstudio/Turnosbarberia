-- ============================================================================
-- TurnosBarbería — config de pago por shop (Hito 4 de cobro anticipado).
--
-- Cada shop puede tener su propia cuenta de Mercado Pago. Guardamos su
-- access token (Bearer) y, opcionalmente, un webhook_secret para validar
-- las notificaciones entrantes. Una fila por shop, con RLS estricto:
-- solo el owner del shop puede leer/escribir su token.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.shop_payment_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  mp_access_token text,
  mp_public_key text,
  mp_webhook_secret text,
  -- Permite "activar/desactivar" sin perder las credenciales guardadas.
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_payment_settings enable row level security;

-- Solo el owner del shop puede ver/escribir su configuración. El service_role
-- (server actions con admin client) bypasea RLS para crear las preferencias
-- de pago y leer el token en el webhook.
drop policy if exists "payment settings owner read" on public.shop_payment_settings;
create policy "payment settings owner read"
  on public.shop_payment_settings for select
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

drop policy if exists "payment settings owner write" on public.shop_payment_settings;
create policy "payment settings owner write"
  on public.shop_payment_settings for all
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

-- updated_at trigger
create or replace function public.touch_payment_settings()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_shop_payment_settings on public.shop_payment_settings;
create trigger touch_shop_payment_settings
  before update on public.shop_payment_settings
  for each row execute function public.touch_payment_settings();
