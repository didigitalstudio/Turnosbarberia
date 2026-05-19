-- ============================================================================
-- TurnosBarbería — Facturación electrónica AFIP (TusFacturasAPP).
--
-- Análogo a shop_payment_settings (0012): cada shop guarda sus credenciales
-- de un proveedor de facturación + datos fiscales (CUIT, punto de venta,
-- condición IVA). Una factura emitida queda persistida en `invoices`, con
-- el CAE devuelto por AFIP, el PDF, y referencia al sale y/o appointment
-- que originó la operación.
--
-- Diseño: el cliente puede emitir factura por:
--   - Una venta registrada en caja (sale walk-in o cobro por MP)  → sale_id
--   - La seña de un turno pagada con MP                          → appointment_id
--   - Operación "suelta" del shop                                → ambos null
--
-- Provider abstracto desde el día uno: hoy 'tusfacturas', mañana puede ser
-- AfipSDK o WSFE directo sin tocar el schema.
--
-- Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- shop_invoicing_settings: credenciales + datos fiscales por shop.
-- ---------------------------------------------------------------------------
create table if not exists public.shop_invoicing_settings (
  shop_id            uuid primary key references public.shops(id) on delete cascade,
  provider           text not null default 'tusfacturas'
                     check (provider in ('tusfacturas')),
  -- Credenciales TusFacturas. Si en el futuro arrancamos en modelo
  -- "cuenta DI multi-empresa", estos quedan NULL y leemos del env.
  api_key            text,
  api_token          text,
  user_token         text,
  -- Datos fiscales del shop (siempre obligatorios para facturar).
  cuit               text,
  razon_social       text,
  punto_venta        integer not null default 1 check (punto_venta > 0),
  condicion_iva      text check (condicion_iva in ('RI','MONOTRIBUTO','EXENTO')),
  -- Permite "pausar" sin perder credenciales (igual que shop_payment_settings).
  is_active          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.shop_invoicing_settings enable row level security;

drop policy if exists "invoicing settings owner read" on public.shop_invoicing_settings;
create policy "invoicing settings owner read"
  on public.shop_invoicing_settings for select
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

drop policy if exists "invoicing settings owner write" on public.shop_invoicing_settings;
create policy "invoicing settings owner write"
  on public.shop_invoicing_settings for all
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

create or replace function public.touch_invoicing_settings()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_shop_invoicing_settings on public.shop_invoicing_settings;
create trigger touch_shop_invoicing_settings
  before update on public.shop_invoicing_settings
  for each row execute function public.touch_invoicing_settings();

-- ---------------------------------------------------------------------------
-- invoices: comprobantes AFIP emitidos.
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops(id) on delete restrict,
  -- Una factura puede atarse a un sale (cobro registrado) y/o appointment
  -- (típicamente la seña). Ambos opcionales para soportar facturación libre.
  sale_id          uuid references public.sales(id) on delete set null,
  appointment_id   uuid references public.appointments(id) on delete set null,
  -- Tipo de comprobante AFIP: 'B','C','A','NC-B','NC-C', etc. Determinado por
  -- la condición IVA del shop (RI→A/B según cliente, MONOTRIBUTO→C, etc.).
  tipo_comprobante text not null,
  punto_venta      integer not null,
  numero           bigint,         -- nro asignado por AFIP al confirmar
  cae              text,           -- Código de Autorización Electrónica
  cae_vencimiento  date,
  monto_total      numeric(12,2) not null check (monto_total >= 0),
  monto_neto       numeric(12,2),
  monto_iva        numeric(12,2),
  -- Cliente: jsonb porque varía por tipo (CF sin DNI, RI con CUIT, etc.):
  --   { tipo_doc:'CUIT'|'DNI'|'CF', nro_doc, razon_social,
  --     condicion_iva:'RI'|'MONOTRIBUTO'|'EXENTO'|'CF', email, domicilio }
  cliente_data     jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                   check (status in ('pending','emitted','error','cancelled')),
  pdf_url          text,
  external_id      text,           -- id en el sistema del proveedor (TusFacturas)
  provider         text not null default 'tusfacturas',
  error_msg        text,
  emitida_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists invoices_shop_idx
  on public.invoices(shop_id, created_at desc);
create index if not exists invoices_sale_idx
  on public.invoices(sale_id) where sale_id is not null;
create index if not exists invoices_appointment_idx
  on public.invoices(appointment_id) where appointment_id is not null;
-- Evita facturar dos veces el mismo sale o la misma seña (cuando la factura
-- queda 'emitted'). Permite reintentos cuando la primera quedó en 'error'.
create unique index if not exists invoices_sale_emitted_uniq
  on public.invoices(sale_id) where sale_id is not null and status = 'emitted';
create unique index if not exists invoices_appointment_emitted_uniq
  on public.invoices(appointment_id) where appointment_id is not null and status = 'emitted';

alter table public.invoices enable row level security;

drop policy if exists "invoices owner read" on public.invoices;
create policy "invoices owner read"
  on public.invoices for select
  using (
    exists (select 1 from public.shops where id = shop_id and owner_id = auth.uid())
  );

create or replace function public.touch_invoices()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_invoices on public.invoices;
create trigger touch_invoices
  before update on public.invoices
  for each row execute function public.touch_invoices();
