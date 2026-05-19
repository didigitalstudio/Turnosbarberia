-- ============================================================================
-- TurnosBarbería — bloqueos de agenda (vacaciones, feriados, descansos).
--
-- El schedule semanal (lun-dom + horario) sirve para la operación normal.
-- Para excepciones puntuales (ej: "del 24 al 31 todo cerrado", "el barbero X
-- se toma el martes 15 libre", "1 de mayo feriado") usamos schedule_blocks:
-- un rango [starts_at, ends_at) opcionalmente atado a un barbero.
--
-- Reglas:
--   - barber_id = NULL → bloqueo del shop completo (todos los barberos)
--   - barber_id != NULL → solo ese barbero
--   - starts_at < ends_at
--
-- En availability.ts, antes de armar slots libres, descartamos cualquier
-- slot que solape con un bloque vigente para el barbero filtrado o para
-- el shop entero.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists schedule_blocks_shop_range_idx
  on public.schedule_blocks(shop_id, starts_at, ends_at);
create index if not exists schedule_blocks_barber_idx
  on public.schedule_blocks(barber_id)
  where barber_id is not null;

alter table public.schedule_blocks enable row level security;

-- Lectura pública por shop (mismo modelo que schedules): el cliente que
-- consulta disponibilidad necesita saber si el slot está bloqueado.
drop policy if exists "schedule_blocks public read" on public.schedule_blocks;
create policy "schedule_blocks public read"
  on public.schedule_blocks for select
  using (true);

-- Sólo el owner o admins del shop pueden crear/editar/borrar bloqueos.
drop policy if exists "schedule_blocks shop write" on public.schedule_blocks;
create policy "schedule_blocks shop write"
  on public.schedule_blocks for all
  using (
    exists (
      select 1 from public.shops s
      where s.id = shop_id
        and (s.owner_id = auth.uid() or s.id = public.current_shop_id())
    )
  )
  with check (
    exists (
      select 1 from public.shops s
      where s.id = shop_id
        and (s.owner_id = auth.uid() or s.id = public.current_shop_id())
    )
  );
