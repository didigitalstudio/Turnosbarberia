'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/shared/Icon';
import { EmptyState } from '@/components/shared/EmptyState';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import { setAppointmentStatus, moveAppointment } from '@/app/actions/booking';
import { ShopSwitcher, type ShopBrief } from '@/components/shop/ShopSwitcher';
import { isoFromARLocal } from '@/lib/tz';

type A = {
  id: string; starts_at: string; ends_at: string; customer_name: string; status: string;
  payment_status?: string | null;
  payment_amount?: number | null;
  services: { name: string; duration_mins: number; price: number };
  barbers: { id: string; name: string; initials: string; hue: number };
};

type ViewMode = 'day' | 'week';

type ScheduleRow = {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_working: boolean;
};

type StatusOption = 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

const STATUS_LABELS: Record<StatusOption, string> = {
  confirmed: 'Confirmado',
  in_progress: 'En proceso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No se presentó'
};

const SLOT_MIN = 30;          // tamaño de cada fila (30 min)
const SLOT_HEIGHT = 48;       // altura en px por bloque de 30 min
const DEFAULT_START_H = 8;    // 08:00
const DEFAULT_END_H = 21;     // 21:00

export function AgendaView({
  appointments, barbers, dayISO, workingDays, view = 'day',
  weekAppointments, weekStartISO, schedules,
  currentShop, userShops
}: {
  appointments: A[];
  barbers: any[];
  dayISO: string;
  workingDays?: number[];
  view?: ViewMode;
  /** Turnos de los 7 días de la semana actual (solo si view=week). */
  weekAppointments?: A[];
  /** ISO del lunes de la semana que se muestra (solo si view=week). */
  weekStartISO?: string;
  /** Schedules del shop (cualquier barbero). Se usan para derivar la ventana horaria del día. */
  schedules?: ScheduleRow[];
  currentShop?: ShopBrief;
  userShops?: ShopBrief[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Overrides locales para reflejar drag&drop al toque sin esperar el round
  // trip al server. Si el move falla, los limpiamos y mostramos el toast.
  const [overrides, setOverrides] = useState<Map<string, { starts_at: string; ends_at: string; barber_id: string }>>(new Map());
  const barberById = useMemo(() => {
    const m = new Map<string, A['barbers']>();
    for (const b of barbers) m.set(b.id, b);
    return m;
  }, [barbers]);
  const applyOverride = (a: A): A => {
    const o = overrides.get(a.id);
    if (!o) return a;
    const nb = barberById.get(o.barber_id) || a.barbers;
    return { ...a, starts_at: o.starts_at, ends_at: o.ends_at, barbers: nb };
  };
  const visibleAppointments = useMemo(() => appointments.map(applyOverride), [appointments, overrides, barberById]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleWeek = useMemo(() => (weekAppointments || []).map(applyOverride), [weekAppointments, overrides, barberById]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (apptId: string, target: { dayISO: string; minutes: number; columnId: string; columnKind: 'barber' | 'day' }) => {
    const appt = (weekAppointments || appointments).find(a => a.id === apptId)
      || appointments.find(a => a.id === apptId);
    if (!appt) return;

    const durationMin = Math.max(1, Math.round((new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60_000));
    const hh = Math.floor(target.minutes / 60);
    const mm = target.minutes % 60;
    const newStartISO = isoFromARLocal(target.dayISO, hh, mm);
    const newEndISO = new Date(new Date(newStartISO).getTime() + durationMin * 60_000).toISOString();
    const newBarberId = target.columnKind === 'barber' ? target.columnId : appt.barbers?.id;

    // No-op si quedó en el mismo lugar (evita round trip).
    if (appt.starts_at === newStartISO && appt.barbers?.id === newBarberId) return;

    // Optimistic.
    const prev = overrides.get(apptId);
    setOverrides(prevMap => {
      const next = new Map(prevMap);
      next.set(apptId, { starts_at: newStartISO, ends_at: newEndISO, barber_id: newBarberId });
      return next;
    });

    start(async () => {
      const r = await moveAppointment({
        id: apptId,
        startsAt: newStartISO,
        ...(newBarberId !== appt.barbers?.id ? { barberId: newBarberId } : {})
      });
      if ((r as any)?.error) {
        // Rollback
        setOverrides(prevMap => {
          const next = new Map(prevMap);
          if (prev) next.set(apptId, prev); else next.delete(apptId);
          return next;
        });
        setError((r as any).error);
      } else {
        // Refresh server data; al volver, las nuevas props deberían hacer
        // el override redundante. Lo limpiamos para no quedar pegados a un
        // valor stale si el server normaliza algo.
        router.refresh();
        setOverrides(prevMap => {
          const next = new Map(prevMap);
          next.delete(apptId);
          return next;
        });
      }
    });
  };

  const total = visibleAppointments.length;
  const done = visibleAppointments.filter(a => a.status === 'completed').length;
  const ingresos = visibleAppointments
    .filter(a => a.status !== 'cancelled' && a.status !== 'no_show')
    .reduce((s, a) => s + Number(a.services?.price || 0), 0);

  const isToday = dayISO === todayLocalISO();

  // Tick para mover la línea "now" cada minuto.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  // Ventana horaria: derivada de schedules del día. Fallback: 08-21.
  const dow = new Date(dayISO + 'T12:00:00').getDay();
  const { startH, endH } = useMemo(() => deriveWindow(schedules, view === 'week' ? null : dow), [schedules, dow, view]);
  const slots = useMemo(() => buildSlots(startH, endH), [startH, endH]);

  const dayIsClosed = useMemo(() => {
    if (!workingDays) return false;
    const s = new Set(workingDays);
    return !s.has(dow);
  }, [workingDays, dow]);

  const switchView = (next: ViewMode) => {
    const qs = new URLSearchParams(searchParams?.toString() || '');
    qs.set('view', next);
    if (!qs.get('d')) qs.set('d', dayISO);
    router.push(`/shop?${qs.toString()}`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Selector de sede si hay varias */}
      {currentShop && userShops && userShops.length > 1 && (
        <div className="px-5 pt-3.5 md:px-8">
          <ShopSwitcher shop={currentShop} userShops={userShops} />
        </div>
      )}

      {/* Stats */}
      <div className="px-5 pt-3.5 grid grid-cols-3 gap-2 md:px-8 md:gap-3">
        <Stat k="Hoy"      v={`${total}`} s="turnos"/>
        <Stat k="Hechos"   v={`${done}`}  s={`de ${total}`}/>
        <Stat k="Ingresos" v={shortMoney(ingresos)} s="estimado"/>
      </div>

      {/* Toggle Día / Semana */}
      <div className="px-5 pt-3 md:px-8">
        <ViewToggle value={view} onChange={switchView} />
      </div>

      {view === 'day' ? (
        <DayView
          dayISO={dayISO}
          appointments={visibleAppointments}
          barbers={barbers}
          slots={slots}
          startH={startH}
          endH={endH}
          workingDays={workingDays}
          dayIsClosed={dayIsClosed}
          isToday={isToday}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          pending={pending}
          onPick={(id, next) => {
            setMenuFor(null);
            start(async () => {
              setError(null);
              const r = await setAppointmentStatus(id, next);
              if ((r as any)?.error) setError((r as any).error);
            });
          }}
          onMove={onMove}
          error={error}
          onCloseError={() => setError(null)}
        />
      ) : (
        <WeekView
          weekStartISO={weekStartISO || mondayOf(dayISO)}
          weekAppointments={visibleWeek}
          slots={slots}
          startH={startH}
          endH={endH}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          pending={pending}
          onPick={(id, next) => {
            setMenuFor(null);
            start(async () => {
              setError(null);
              const r = await setAppointmentStatus(id, next);
              if ((r as any)?.error) setError((r as any).error);
            });
          }}
          onMove={onMove}
          error={error}
          onCloseError={() => setError(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Day view                                                          */
/* ------------------------------------------------------------------ */

function DayView({
  dayISO, appointments, barbers, slots, startH, endH, workingDays, dayIsClosed, isToday,
  menuFor, setMenuFor, pending, onPick, onMove, error, onCloseError
}: {
  dayISO: string;
  appointments: A[];
  barbers: any[];
  slots: Array<{ h: number; m: number; label: string }>;
  startH: number;
  endH: number;
  workingDays?: number[];
  dayIsClosed: boolean;
  isToday: boolean;
  menuFor: string | null;
  setMenuFor: (v: string | null) => void;
  pending: boolean;
  onPick: (id: string, next: StatusOption) => void;
  onMove: (apptId: string, target: { dayISO: string; minutes: number; columnId: string; columnKind: 'barber' | 'day' }) => void;
  error: string | null;
  onCloseError: () => void;
}) {
  const dayPickerRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => buildDays(7, workingDays), [workingDays]);

  useEffect(() => {
    const el = dayPickerRef.current?.querySelector<HTMLElement>(`[data-day="${dayISO}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [dayISO]);

  // Agrupar turnos por barbero
  const byBarber = useMemo(() => {
    const m = new Map<string, A[]>();
    for (const b of barbers) m.set(b.id, []);
    for (const a of appointments) {
      if (a.status === 'cancelled') continue;
      const list = m.get(a.barbers?.id);
      if (list) list.push(a);
    }
    return m;
  }, [appointments, barbers]);

  const now = Date.now();
  // Línea "now": solo si estamos en el día mostrado y dentro de la ventana horaria.
  const nowLineTop = useMemo(() => {
    if (!isToday) return null;
    const d = new Date();
    const minutesFromStart = (d.getHours() - startH) * 60 + d.getMinutes();
    const totalMinutes = (endH - startH) * 60;
    if (minutesFromStart < 0 || minutesFromStart > totalMinutes) return null;
    return (minutesFromStart / SLOT_MIN) * SLOT_HEIGHT;
  }, [isToday, startH, endH, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = appointments.length > 0;
  const showClosed = dayIsClosed && !hasData;

  return (
    <>
      {/* Day picker */}
      <div ref={dayPickerRef} className="px-5 pt-3 pb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar md:px-8 md:gap-2">
        {days.map(d => {
          const sel = d.iso === dayISO;
          return (
            <Link key={d.iso} href={`/shop?d=${d.iso}&view=day`}
              data-day={d.iso}
              aria-pressed={sel}
              aria-label={`Ver agenda del ${d.wd} ${d.day}${d.closed ? ' (cerrado)' : ''}`}
              className={`min-w-[52px] md:min-w-[64px] min-h-[48px] py-2 rounded-m text-center transition active:scale-[0.97]
                ${sel ? 'bg-bg text-ink border-0' :
                  d.closed ? 'border border-dashed border-dark-line text-dark-muted opacity-60' :
                  'border border-dark-line text-bg hover:border-bg/40'}`}>
              <div className="text-[9px] uppercase tracking-wide">{d.wd}</div>
              <div className="font-display text-[18px] leading-none mt-0.5">{d.day}</div>
            </Link>
          );
        })}
      </div>

      {/* Header con nueva cita */}
      <div className="px-5 md:px-8 flex items-center gap-2 pb-2">
        <div className="font-mono text-[10px] tracking-[2px] text-dark-muted flex-1 truncate">
          {new Date(dayISO + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' , timeZone: 'America/Argentina/Buenos_Aires' }).toUpperCase()} · VISTA DÍA
        </div>
        <Link href={`/shop/nuevo?d=${dayISO}`} aria-label="Nuevo turno"
          className="w-9 h-9 rounded-s grid place-items-center text-white bg-accent active:scale-95 transition">
          <Icon name="plus" size={16} color="#fff"/>
        </Link>
      </div>

      {error && (
        <div className="px-5 md:px-8 pb-2">
          <Toast dark tone="error" message={error} onClose={onCloseError} />
        </div>
      )}

      {showClosed ? (
        <div className="px-5 md:px-8 pb-5">
          <EmptyState
            dark
            icon="calendar"
            title="Día cerrado"
            description="Esta sede no trabaja este día. Podés cambiar los horarios en Ajustes."
          />
        </div>
      ) : barbers.length === 0 ? (
        <div className="px-5 md:px-8 pb-5">
          <EmptyState
            dark
            icon="users"
            title="Sin barberos"
            description="Todavía no cargaste barberos para esta sede."
            ctaLabel="Ir a equipo"
            ctaHref="/shop/equipo"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-5 pb-5 md:px-8">
          <CalendarGrid
            slots={slots}
            startH={startH}
            columns={barbers.map(b => ({
              id: b.id,
              kind: 'barber' as const,
              header: (
                <div className="flex flex-col items-start">
                  <div className="text-[12px] font-semibold text-bg truncate max-w-full">{b.name}</div>
                  <div className="text-[9px] text-dark-muted uppercase tracking-[1.5px]">{b.initials}</div>
                </div>
              ),
              hue: b.hue,
              appointments: byBarber.get(b.id) || []
            }))}
            dayISO={dayISO}
            nowLineTop={nowLineTop}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            pending={pending}
            onPick={onPick}
            onMove={onMove}
          />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Week view                                                         */
/* ------------------------------------------------------------------ */

function WeekView({
  weekStartISO, weekAppointments, slots, startH, endH,
  menuFor, setMenuFor, pending, onPick, onMove, error, onCloseError
}: {
  weekStartISO: string;
  weekAppointments: A[];
  slots: Array<{ h: number; m: number; label: string }>;
  startH: number;
  endH: number;
  menuFor: string | null;
  setMenuFor: (v: string | null) => void;
  pending: boolean;
  onPick: (id: string, next: StatusOption) => void;
  onMove: (apptId: string, target: { dayISO: string; minutes: number; columnId: string; columnKind: 'barber' | 'day' }) => void;
  error: string | null;
  onCloseError: () => void;
}) {
  const weekDays = useMemo(() => buildWeek(weekStartISO), [weekStartISO]);
  const byDay = useMemo(() => {
    const m = new Map<string, A[]>();
    for (const d of weekDays) m.set(d.iso, []);
    for (const a of weekAppointments) {
      if (a.status === 'cancelled') continue;
      const iso = localISO(new Date(a.starts_at));
      const list = m.get(iso);
      if (list) list.push(a);
    }
    return m;
  }, [weekAppointments, weekDays]);

  const prevWeek = shiftWeek(weekStartISO, -7);
  const nextWeek = shiftWeek(weekStartISO, 7);
  const weekLabel = formatWeekRange(weekStartISO);

  const todayISO = todayLocalISO();
  const nowLineTop = useMemo(() => {
    const d = new Date();
    const isThisWeek = weekDays.some(x => x.iso === todayISO);
    if (!isThisWeek) return null;
    const minutesFromStart = (d.getHours() - startH) * 60 + d.getMinutes();
    const totalMinutes = (endH - startH) * 60;
    if (minutesFromStart < 0 || minutesFromStart > totalMinutes) return null;
    return (minutesFromStart / SLOT_MIN) * SLOT_HEIGHT;
  }, [weekDays, startH, endH, todayISO]);

  return (
    <>
      {/* Selector de semana */}
      <div className="px-5 md:px-8 pt-3 pb-2 flex items-center gap-2">
        <Link href={`/shop?d=${prevWeek}&view=week`} aria-label="Semana anterior"
          className="w-9 h-9 rounded-s grid place-items-center border border-dark-line text-bg hover:border-bg/40 transition">
          <Icon name="arrow-left" size={16}/>
        </Link>
        <div className="flex-1 text-center font-mono text-[11px] tracking-[2px] text-bg uppercase truncate">
          {weekLabel}
        </div>
        <Link href={`/shop?d=${nextWeek}&view=week`} aria-label="Semana siguiente"
          className="w-9 h-9 rounded-s grid place-items-center border border-dark-line text-bg hover:border-bg/40 transition">
          <Icon name="arrow-right" size={16}/>
        </Link>
        <Link href={`/shop/nuevo?d=${todayISO}`} aria-label="Nuevo turno"
          className="w-9 h-9 rounded-s grid place-items-center text-white bg-accent active:scale-95 transition">
          <Icon name="plus" size={16} color="#fff"/>
        </Link>
      </div>

      {error && (
        <div className="px-5 md:px-8 pb-2">
          <Toast dark tone="error" message={error} onClose={onCloseError} />
        </div>
      )}

      <div className="flex-1 overflow-auto px-5 pb-5 md:px-8">
        <CalendarGrid
          slots={slots}
          startH={startH}
          columns={weekDays.map(d => ({
            id: d.iso,
            kind: 'day' as const,
            header: (
              <Link href={`/shop?d=${d.iso}&view=day`}
                className={`flex flex-col items-start hover:opacity-90 transition ${d.iso === todayISO ? 'text-accent' : 'text-bg'}`}>
                <div className="text-[9px] uppercase tracking-[1.5px] opacity-80">{d.wd}</div>
                <div className="font-display text-[18px] leading-none mt-0.5">{d.day}</div>
              </Link>
            ),
            appointments: byDay.get(d.iso) || [],
            compact: true
          }))}
          dayISO={todayISO}
          nowLineTop={nowLineTop}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          pending={pending}
          onPick={onPick}
          onMove={onMove}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Calendar grid (shared)                                            */
/* ------------------------------------------------------------------ */

type GridColumn = {
  id: string;
  /** Tipo: 'barber' = vista día (id = barber id). 'day' = vista semana (id = dayISO). */
  kind: 'barber' | 'day';
  header: React.ReactNode;
  appointments: A[];
  /** Color lateral si todas las cards de la columna son del mismo barbero (vista día). Si no, se usa el hue de cada turno. */
  hue?: number;
  /** Compact = vista semana (cards chicas, sin avatar grande). */
  compact?: boolean;
};

type DragState = {
  apptId: string;
  durationMin: number;
  // Offset entre el clientY del pointerdown y el top de la card.
  // Lo usamos para que el ghost no salte al cursor: respetamos dónde
  // agarró el dueño la tarjeta.
  pointerOffsetY: number;
  // Resultado actual del snap (null si pointer cae fuera del body).
  target: { columnId: string; columnKind: 'barber' | 'day'; minutes: number; colIdx: number } | null;
};

function CalendarGrid({
  slots, startH, columns, dayISO, nowLineTop, menuFor, setMenuFor, pending, onPick, onMove
}: {
  slots: Array<{ h: number; m: number; label: string }>;
  startH: number;
  columns: GridColumn[];
  dayISO: string;
  nowLineTop: number | null;
  menuFor: string | null;
  setMenuFor: (v: string | null) => void;
  pending: boolean;
  onPick: (id: string, next: StatusOption) => void;
  onMove: (apptId: string, target: { dayISO: string; minutes: number; columnId: string; columnKind: 'barber' | 'day' }) => void;
}) {
  const timeWidth = 52;
  const colMinPx = 120;
  const gridTemplateColumns = `${timeWidth}px repeat(${columns.length}, minmax(${colMinPx}px, 1fr))`;

  const totalMinutes = slots.length * SLOT_MIN;
  const bodyHeight = slots.length * SLOT_HEIGHT;
  const windowStartMin = startH * 60;

  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Para evitar que el click "fantasma" después de un drop abra el menú.
  const justDraggedRef = useRef(false);

  const resolveTarget = (clientX: number, clientY: number, durationMin: number, pointerOffsetY: number) => {
    const el = bodyRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const relX = clientX - rect.left;
    const relY = clientY - rect.top - pointerOffsetY;
    if (relX < timeWidth) return null;
    const colsWidth = rect.width - timeWidth;
    if (colsWidth <= 0) return null;
    const colWidth = colsWidth / columns.length;
    const colIdx = Math.min(columns.length - 1, Math.max(0, Math.floor((relX - timeWidth) / colWidth)));
    const col = columns[colIdx];
    if (!col) return null;
    // Snap a 15min.
    let minutesIntoBody = (relY / SLOT_HEIGHT) * SLOT_MIN;
    minutesIntoBody = Math.round(minutesIntoBody / 15) * 15;
    // Clamp para que el turno completo entre en la ventana.
    const minMin = 0;
    const maxMin = totalMinutes - durationMin;
    if (maxMin < 0) return null;
    minutesIntoBody = Math.max(minMin, Math.min(maxMin, minutesIntoBody));
    return {
      columnId: col.id,
      columnKind: col.kind,
      minutes: windowStartMin + minutesIntoBody,
      colIdx
    };
  };

  const startDrag = (apptId: string, ev: React.PointerEvent, durationMin: number, cardTop: number) => {
    if (ev.button !== 0) return;
    if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) return;
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Distancia entre el pointer y el top de la card al agarrarla.
    const pointerOffsetY = (ev.clientY - rect.top) - cardTop;

    let entered = false;
    const originX = ev.clientX;
    const originY = ev.clientY;

    const onMoveDoc = (e: PointerEvent) => {
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      if (!entered && dx * dx + dy * dy < 16) return; // threshold ~4px
      if (!entered) {
        entered = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      const target = resolveTarget(e.clientX, e.clientY, durationMin, pointerOffsetY);
      setDrag(prev => prev && prev.apptId === apptId ? { ...prev, target } : prev);
    };

    const onUpDoc = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMoveDoc);
      window.removeEventListener('pointerup', onUpDoc);
      window.removeEventListener('pointercancel', onUpDoc);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (entered) {
        const target = resolveTarget(e.clientX, e.clientY, durationMin, pointerOffsetY);
        if (target) {
          const col = columns[target.colIdx];
          if (col) {
            const targetDay = col.kind === 'day' ? col.id : dayISO;
            onMove(apptId, {
              dayISO: targetDay,
              minutes: target.minutes,
              columnId: col.id,
              columnKind: col.kind
            });
          }
        }
        justDraggedRef.current = true;
        // El click sintético llega después del pointerup. Lo limpiamos en
        // el siguiente tick para que el handler del botón lo ignore.
        setTimeout(() => { justDraggedRef.current = false; }, 0);
      }
      setDrag(null);
    };

    window.addEventListener('pointermove', onMoveDoc);
    window.addEventListener('pointerup', onUpDoc);
    window.addEventListener('pointercancel', onUpDoc);

    setDrag({ apptId, durationMin, pointerOffsetY, target: null });
  };

  return (
    <div className="bg-dark-card border border-dark-line rounded-l overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: `calc(${timeWidth}px + ${columns.length * colMinPx}px)` }}>
          {/* Header */}
          <div
            className="grid sticky top-0 z-20 bg-dark-card border-b border-dark-line"
            style={{ gridTemplateColumns }}>
            <div className="border-r border-dark-line" aria-hidden="true"/>
            {columns.map(c => (
              <div key={c.id} className="px-2.5 py-2 border-r border-dark-line last:border-r-0">
                {c.header}
              </div>
            ))}
          </div>

          {/* Body */}
          <div ref={bodyRef} className="grid relative" style={{ gridTemplateColumns, height: bodyHeight }}>
            {/* Columna de horarios */}
            <div className="border-r border-dark-line relative">
              {slots.map((s, rowIdx) => (
                <div
                  key={`h-${rowIdx}`}
                  className={`absolute left-0 right-0 text-right pr-2 font-mono text-[10px] text-dark-muted ${s.m === 0 ? 'border-t border-dark-line/60' : 'border-t border-dark-line/20'}`}
                  style={{ top: rowIdx * SLOT_HEIGHT, height: SLOT_HEIGHT, paddingTop: 2 }}>
                  {s.m === 0 ? s.label : ''}
                </div>
              ))}
            </div>

            {/* Columnas de datos */}
            {columns.map((c, colIdx) => (
              <div key={c.id} className="relative border-r border-dark-line last:border-r-0">
                {/* Background cells (click → nuevo turno) */}
                {slots.map((s, rowIdx) => {
                  const cellDay = c.kind === 'day' ? c.id : dayISO;
                  const atISO = toISO(cellDay, s.h, s.m);
                  const href = c.kind === 'barber'
                    ? `/shop/nuevo?d=${dayISO}&at=${encodeURIComponent(atISO)}&barber=${c.id}`
                    : `/shop/nuevo?d=${cellDay}&at=${encodeURIComponent(atISO)}`;
                  return (
                    <Link
                      key={`cell-${rowIdx}`}
                      href={href}
                      tabIndex={-1}
                      aria-label="Crear turno"
                      className={`absolute left-0 right-0 ${s.m === 0 ? 'border-t border-dark-line/60' : 'border-t border-dark-line/20'} ${drag ? '' : 'hover:bg-dark/40'} transition group`}
                      style={{ top: rowIdx * SLOT_HEIGHT, height: SLOT_HEIGHT, pointerEvents: drag ? 'none' : undefined }}>
                      <span className="opacity-0 group-hover:opacity-60 absolute right-1 top-1 text-dark-muted text-[10px]">+</span>
                    </Link>
                  );
                })}

                {/* Cards de turnos */}
                {c.appointments.map(a => {
                  const startDate = new Date(a.starts_at);
                  const endDate = new Date(a.ends_at);
                  const startMin = startDate.getHours() * 60 + startDate.getMinutes();
                  const endMin = endDate.getHours() * 60 + endDate.getMinutes();
                  const windowEndMin = windowStartMin + totalMinutes;
                  const visibleStart = Math.max(startMin, windowStartMin);
                  const visibleEnd = Math.min(endMin, windowEndMin);
                  if (visibleEnd <= visibleStart) return null;

                  const top = ((visibleStart - windowStartMin) / SLOT_MIN) * SLOT_HEIGHT;
                  const height = ((visibleEnd - visibleStart) / SLOT_MIN) * SLOT_HEIGHT;
                  const hue = a.barbers?.hue ?? c.hue ?? 55;
                  const durationMin = Math.max(15, endMin - startMin);
                  const isBeingDragged = drag?.apptId === a.id;

                  return (
                    <AppointmentCard
                      key={a.id}
                      appointment={a}
                      top={top}
                      height={height}
                      hue={hue}
                      compact={c.compact}
                      menuOpen={menuFor === a.id}
                      onToggleMenu={() => {
                        if (justDraggedRef.current) return;
                        setMenuFor(menuFor === a.id ? null : a.id);
                      }}
                      onCloseMenu={() => setMenuFor(null)}
                      disabled={pending}
                      onPick={(next) => onPick(a.id, next)}
                      onPointerDownDrag={(ev) => startDrag(a.id, ev, durationMin, top)}
                      isBeingDragged={isBeingDragged}
                      anyDragging={!!drag}
                    />
                  );
                })}

                {/* Ghost del drop target en esta columna */}
                {drag?.target && drag.target.colIdx === colIdx && (() => {
                  const ghostTop = ((drag.target.minutes - windowStartMin) / SLOT_MIN) * SLOT_HEIGHT;
                  const ghostHeight = (drag.durationMin / SLOT_MIN) * SLOT_HEIGHT;
                  const hh = Math.floor(drag.target.minutes / 60);
                  const mm = drag.target.minutes % 60;
                  const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                  return (
                    <div
                      className="absolute left-0.5 right-0.5 z-20 rounded-s border-2 border-dashed border-accent bg-accent/15 pointer-events-none flex items-start px-1.5 py-1"
                      style={{ top: ghostTop, height: Math.max(ghostHeight, 28) }}>
                      <span className="font-mono text-[10px] text-accent">{label}</span>
                    </div>
                  );
                })()}
              </div>
            ))}

            {/* Línea "ahora" */}
            {nowLineTop != null && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-10"
                style={{ top: nowLineTop }}
                aria-hidden="true">
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full bg-accent" style={{ marginLeft: timeWidth - 4 }}/>
                  <div className="flex-1 h-[2px] bg-accent/80"/>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppointmentCard({
  appointment, top, height, hue, compact, menuOpen, onToggleMenu, onCloseMenu, disabled, onPick,
  onPointerDownDrag, isBeingDragged, anyDragging
}: {
  appointment: A;
  top: number;
  height: number;
  hue: number;
  compact?: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  disabled: boolean;
  onPick: (next: StatusOption) => void;
  onPointerDownDrag: (e: React.PointerEvent) => void;
  isBeingDragged: boolean;
  anyDragging: boolean;
}) {
  const now = Date.now();
  const startMs = new Date(appointment.starts_at).getTime();
  const endMs = new Date(appointment.ends_at).getTime();
  const isInProgress = appointment.status === 'in_progress' || (now >= startMs && now < endMs && appointment.status !== 'completed' && appointment.status !== 'cancelled');
  const isDone = appointment.status === 'completed';
  const isNoShow = appointment.status === 'no_show';
  const isPrepaid = appointment.payment_status === 'paid' && Number(appointment.payment_amount || 0) > 0;
  const time = new Date(appointment.starts_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' });

  const baseBg = `oklch(0.3 0.04 ${hue})`;
  // Borde más claro y brillante cuando el cliente ya pagó la seña — el dueño
  // distingue al instante un turno "asegurado" vs uno todavía no pago.
  const baseBorder = isPrepaid ? `oklch(0.85 0.18 ${hue})` : `oklch(0.7 0.1 ${hue})`;
  const borderWidth = isPrepaid ? '4px' : '3px';

  // Turnos cerrados (completados / cancelados / no_show) no se mueven —
  // son terminales también del lado del server. Permitir el drag llevaría
  // al usuario a ver un error después del soltar.
  const draggable = !disabled && !isDone && !isNoShow && appointment.status !== 'cancelled';

  return (
    <div
      className={`absolute left-0.5 right-0.5 z-10 ${isBeingDragged ? 'opacity-30' : ''} ${anyDragging && !isBeingDragged ? 'opacity-70' : ''}`}
      style={{ top, height: Math.max(height, 28) }}>
      <button
        type="button"
        onPointerDown={draggable ? onPointerDownDrag : undefined}
        onClick={onToggleMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Turno ${appointment.customer_name} a las ${time}. Tocá para cambiar estado.`}
        className={`w-full h-full rounded-s text-left px-1.5 py-1 transition active:scale-[0.99] overflow-hidden ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
          ${isInProgress ? 'bg-accent text-white' :
            isDone ? 'opacity-60' :
            isNoShow ? 'opacity-50' : ''}`}
        style={{
          background: isInProgress ? undefined : baseBg,
          color: isInProgress ? undefined : '#F5F3EE',
          borderLeft: isInProgress ? undefined : `${borderWidth} solid ${baseBorder}`,
          boxShadow: isPrepaid && !isInProgress ? `inset 0 0 0 1px ${baseBorder}` : undefined,
          touchAction: 'manipulation'
        }}>
        {compact ? (
          <div className="flex flex-col min-w-0">
            <div className="font-mono text-[10px] opacity-85 leading-none">{time}</div>
            <div className="text-[11px] font-semibold truncate mt-0.5">{appointment.customer_name}</div>
            {height >= 44 && (
              <div className="text-[10px] opacity-75 truncate mt-0.5">{appointment.barbers?.name}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1">
              <div className="font-mono text-[10px] opacity-85 leading-none">{time}</div>
              {isInProgress && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-xs tracking-wider bg-white/25">
                  EN CURSO
                </span>
              )}
              {appointment.payment_status === 'paid' && Number(appointment.payment_amount || 0) > 0 && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-xs tracking-wider bg-white/25" title="Seña ya cobrada">
                  $✓
                </span>
              )}
              {isDone && <Icon name="check" size={12}/>}
            </div>
            <div className="text-[12px] font-semibold truncate mt-0.5">{appointment.customer_name}</div>
            {height >= 44 && appointment.services?.name && (
              <div className="text-[10px] opacity-75 truncate mt-0.5">
                {appointment.services.name}
                {appointment.services.duration_mins ? ` · ${appointment.services.duration_mins}m` : ''}
              </div>
            )}
          </div>
        )}
      </button>
      {menuOpen && (
        <StatusMenu
          current={appointment.status as StatusOption}
          disabled={disabled}
          onPick={onPick}
          onClose={onCloseMenu}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.5px] transition active:scale-[0.97]
     ${active ? 'bg-bg text-ink' : 'bg-dark-card border border-dark-line text-bg hover:border-bg/40'}`;
  return (
    <div role="tablist" aria-label="Modo de vista" className="inline-flex gap-1.5">
      <button type="button" role="tab" aria-selected={value === 'day'} onClick={() => onChange('day')} className={btn(value === 'day')}>
        Día
      </button>
      <button type="button" role="tab" aria-selected={value === 'week'} onClick={() => onChange('week')} className={btn(value === 'week')}>
        Semana
      </button>
    </div>
  );
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return (
    <div className="bg-dark-card border border-dark-line rounded-l px-3 py-2.5">
      <div className="text-[9px] text-dark-muted uppercase tracking-[1.5px]">{k}</div>
      <div className="font-display text-[22px] text-bg leading-none mt-0.5">{v}</div>
      <div className="text-[10px] text-dark-muted mt-0.5">{s}</div>
    </div>
  );
}

function StatusMenu({
  current, disabled, onPick, onClose
}: {
  current: StatusOption;
  disabled: boolean;
  onPick: (next: StatusOption) => void;
  onClose: () => void;
}) {
  const options: StatusOption[] = ['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
  const menuRef = useRef<HTMLUListElement>(null);
  const [offsetX, setOffsetX] = useState(0);

  // Reposicionamos el menú si se sale del viewport en mobile.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overflowRight = rect.right - window.innerWidth + 8;
    if (overflowRight > 0) setOffsetX(-overflowRight);
    const overflowLeft = 8 - rect.left;
    if (overflowLeft > 0) setOffsetX(overflowLeft);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-30 cursor-default"/>
      <ul
        ref={menuRef}
        role="menu"
        style={{ transform: `translateX(${offsetX}px)` }}
        className="absolute left-0 top-full mt-1 z-40 min-w-[180px] bg-dark-card border border-dark-line rounded-l overflow-hidden shadow-fab-dark">
        {options.map(opt => {
          const isActive = opt === current;
          return (
            <li key={opt} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onPick(opt)}
                disabled={disabled || isActive}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] transition min-h-[44px]
                  ${isActive
                    ? 'bg-bg text-ink font-semibold'
                    : 'text-bg hover:bg-dark'} disabled:opacity-60`}>
                <span className="flex-1">{STATUS_LABELS[opt]}</span>
                {isActive && <Icon name="check" size={14}/>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Utils                                                             */
/* ------------------------------------------------------------------ */

function shortMoney(n: number) {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return money(n);
}

function todayLocalISO() {
  const d = new Date();
  return localISO(d);
}

function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDays(n: number, workingDays?: number[]) {
  const out: Array<{ iso: string; day: number; wd: string; closed: boolean }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const openDays: Set<number> | null = workingDays ? new Set(workingDays) : null;
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const dow = d.getDay();
    out.push({
      iso: localISO(d),
      day: d.getDate(),
      wd: d.toLocaleDateString('es-AR', { weekday: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.', '').slice(0, 3),
      closed: openDays ? !openDays.has(dow) : false
    });
  }
  return out;
}

function buildSlots(startH: number, endH: number) {
  const out: Array<{ h: number; m: number; label: string }> = [];
  for (let h = startH; h < endH; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) {
      out.push({ h, m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
    }
  }
  return out;
}

function deriveWindow(schedules: ScheduleRow[] | undefined, dow: number | null) {
  if (!schedules || schedules.length === 0) {
    return { startH: DEFAULT_START_H, endH: DEFAULT_END_H };
  }
  const relevant = dow == null
    ? schedules.filter(s => s.is_working)
    : schedules.filter(s => s.is_working && Number(s.day_of_week) === dow);
  if (relevant.length === 0) return { startH: DEFAULT_START_H, endH: DEFAULT_END_H };
  let startH = 24;
  let endH = 0;
  for (const s of relevant) {
    const sh = hourFrom(s.start_time);
    const eh = hourCeilFrom(s.end_time);
    if (sh < startH) startH = sh;
    if (eh > endH) endH = eh;
  }
  if (startH >= endH) return { startH: DEFAULT_START_H, endH: DEFAULT_END_H };
  return { startH, endH };
}

function hourFrom(t: string | null | undefined): number {
  if (!t) return DEFAULT_START_H;
  const [h] = t.split(':');
  const n = Number(h);
  if (!Number.isFinite(n)) return DEFAULT_START_H;
  return n;
}
function hourCeilFrom(t: string | null | undefined): number {
  if (!t) return DEFAULT_END_H;
  const [h, m] = t.split(':');
  const nh = Number(h);
  const nm = Number(m);
  if (!Number.isFinite(nh)) return DEFAULT_END_H;
  return nm && nm > 0 ? nh + 1 : nh;
}

function toISO(dayISO: string, h: number, m: number) {
  return `${dayISO}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function mondayOf(dayISO: string) {
  const d = new Date(dayISO + 'T12:00:00');
  const dow = d.getDay(); // 0=Dom, 1=Lun..
  const diff = (dow === 0 ? -6 : 1 - dow);
  d.setDate(d.getDate() + diff);
  return localISO(d);
}

function shiftWeek(weekStartISO: string, days: number) {
  const d = new Date(weekStartISO + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localISO(d);
}

function buildWeek(weekStartISO: string) {
  const base = new Date(weekStartISO + 'T12:00:00');
  const out: Array<{ iso: string; day: number; wd: string }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      iso: localISO(d),
      day: d.getDate(),
      wd: d.toLocaleDateString('es-AR', { weekday: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.', '').slice(0, 3)
    });
  }
  return out;
}

function formatWeekRange(weekStartISO: string) {
  const start = new Date(weekStartISO + 'T12:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.', '');
  return `SEMANA DEL ${fmt(start)} AL ${fmt(end)}`.toUpperCase();
}
