-- ============================================================================
-- TurnosBarbería — pagos en turnos (Hito 3 de cobro anticipado).
--
-- Sostiene un "hold" del slot mientras el cliente paga la seña. El turno se
-- crea como `pending_payment`, queda reservado en la grilla por N minutos
-- (payment_expires_at) y, si el pago llega, pasa a `confirmed`. Si no llega,
-- queda como `expired` y el slot vuelve a estar libre.
--
-- Los valores del enum se agregan en 0009/0010 (no pueden ir en la misma
-- transacción que los use).
--
-- Safe to re-run.
-- ============================================================================

-- Columnas de pago en appointments.
alter table public.appointments
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_provider text,
  add column if not exists payment_external_id text,
  add column if not exists payment_amount numeric(10,2),
  add column if not exists payment_expires_at timestamptz;

alter table public.appointments
  drop constraint if exists appointments_payment_status_check;
alter table public.appointments
  add constraint appointments_payment_status_check
  check (payment_status in ('not_required', 'pending', 'paid', 'refunded', 'partial_refund', 'expired'));

-- Excluir también 'expired' del EXCLUDE constraint, así un hold caducado
-- libera el slot inmediatamente y otro cliente puede reservar.
alter table public.appointments
  drop constraint if exists appointments_no_overlap;
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status not in ('cancelled','no_show','expired'));

-- Función helper: marca como `expired` los pending_payment cuyo hold ya pasó.
-- Se llama antes de cada insert nuevo para evitar bloqueos por filas zombi.
-- Lazy cleanup, sin cron.
create or replace function public.release_expired_holds()
returns void
language sql
security definer
set search_path = public
as $$
  update public.appointments
  set status = 'expired', payment_status = 'expired'
  where status = 'pending_payment'
    and payment_expires_at is not null
    and payment_expires_at < now();
$$;

grant execute on function public.release_expired_holds() to authenticated, anon, service_role;

-- RLS de insert: permitir el nuevo estado pending_payment.
drop policy if exists "appointments insert anon" on public.appointments;
create policy "appointments insert anon"
  on public.appointments for insert
  with check (
    starts_at > now()
    and starts_at < (now() + interval '180 days')
    and ends_at > starts_at
    and ends_at <= (starts_at + interval '8 hours')
    and status in ('pending', 'confirmed', 'pending_payment')
  );
