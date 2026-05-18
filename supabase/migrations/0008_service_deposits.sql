-- ============================================================================
-- TurnosBarbería — seña por servicio (Hito 2 de cobro anticipado).
--
-- Agrega configuración por servicio para exigir un pago anticipado al reservar:
--   - deposit_type: 'none' | 'percent' | 'fixed' | 'full'
--   - deposit_amount: monto en pesos (si type=fixed) o porcentaje (si type=percent)
--   - 'full' = 100% del precio; 'none' = sin seña.
--
-- Por defecto deposit_type='none', así servicios existentes siguen funcionando
-- igual hasta que el dueño los configure desde Ajustes.
--
-- Safe to re-run.
-- ============================================================================

alter table public.services
  add column if not exists deposit_type text not null default 'none',
  add column if not exists deposit_amount numeric(10,2) not null default 0;

-- Constraints sobre los nuevos campos. Drop-then-add para idempotencia.
alter table public.services
  drop constraint if exists services_deposit_type_check;
alter table public.services
  add constraint services_deposit_type_check
  check (deposit_type in ('none', 'percent', 'fixed', 'full'));

alter table public.services
  drop constraint if exists services_deposit_amount_check;
alter table public.services
  add constraint services_deposit_amount_check
  check (
    deposit_amount >= 0
    and (deposit_type <> 'percent' or deposit_amount <= 100)
  );
