-- ============================================================================
-- TurnosBarbería — config de WhatsApp Cloud API por shop.
--
-- Cada barbería puede tener su propio número WA Business y credenciales de
-- Meta Cloud API. Guardamos el phone_number_id (numérico, identifica el
-- número en la API) y el access token (long-lived) emitido por Meta para
-- su WhatsApp Business Account.
--
-- RLS: solo el owner del shop puede leer/escribir. El service_role bypassea
-- para el cron y el envío diferido.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.shop_whatsapp_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  -- Identificador del número emitido por Meta para envíos vía Cloud API.
  -- Lo encontrás en business.facebook.com → WhatsApp → API Setup → Phone number ID.
  phone_number_id text,
  -- System User access token (long-lived). Conviene generar uno permanente
  -- desde Business Settings → System Users → Generate New Token, con permisos
  -- whatsapp_business_messaging y whatsapp_business_management.
  access_token text,
  -- Nombre del template aprobado por Meta para recordatorios (default: appointment_reminder).
  reminder_template_name text not null default 'appointment_reminder',
  reminder_template_language text not null default 'es_AR',
  -- Permite "pausar" sin perder las credenciales.
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_whatsapp_settings enable row level security;

drop policy if exists "wa settings owner read" on public.shop_whatsapp_settings;
create policy "wa settings owner read"
  on public.shop_whatsapp_settings for select
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

drop policy if exists "wa settings owner write" on public.shop_whatsapp_settings;
create policy "wa settings owner write"
  on public.shop_whatsapp_settings for all
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

create or replace function public.touch_wa_settings()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_shop_whatsapp_settings on public.shop_whatsapp_settings;
create trigger touch_shop_whatsapp_settings
  before update on public.shop_whatsapp_settings
  for each row execute function public.touch_wa_settings();
