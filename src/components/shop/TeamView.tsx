'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Avatar } from '@/components/shared/Avatar';
import { Icon } from '@/components/shared/Icon';
import { EmptyState } from '@/components/shared/EmptyState';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import { upsertBarber } from '@/app/actions/ajustes';
import type { Barber, Schedule } from '@/types/db';

const DAY_LABELS = ['L','M','M','J','V','S','D']; // Mon..Sun
const SLOTS_PER_DAY = 20; // 10h * 2 slots/h

export function TeamView({
  barbers, weekAppts, schedules, startOfWeek, todayISO, tomorrowISO, monthStats
}: {
  barbers: Barber[];
  weekAppts: { id: string; barber_id: string; starts_at: string; status: string }[];
  schedules: Schedule[];
  startOfWeek: string;
  todayISO: string;
  tomorrowISO: string;
  /** Stats del mes actual por barbero — cortes completados, revenue, no-shows y servicio top. */
  monthStats?: Record<string, { count: number; revenue: number; topService: string | null; showPct: number | null }>;
}) {
  const start = new Date(startOfWeek);
  const todayDate = new Date(todayISO);
  const tomorrowDate = new Date(tomorrowISO);

  const [error, setError] = useState<string | null>(null);

  if (barbers.length === 0) {
    return (
      <div className="flex-1 overflow-auto px-5 pt-4 pb-5">
        <EmptyState
          dark
          icon="users"
          title="Todavía no hay equipo"
          description="Sumá barberos desde Ajustes para que aparezcan acá con sus horarios y métricas."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-5 pt-4 pb-5 md:px-8 md:grid md:grid-cols-2 md:gap-3 md:items-start xl:grid-cols-3">
      {error && (
        <div className="md:col-span-2 xl:col-span-3 mb-2.5">
          <Toast dark tone="error" message={error} onClose={() => setError(null)} autoDismissMs={5000} />
        </div>
      )}
      {barbers.map(b => {
        const barberAppts = weekAppts.filter(a => a.barber_id === b.id);
        const todayCount = barberAppts.filter(a => {
          const d = new Date(a.starts_at);
          return d >= todayDate && d < tomorrowDate;
        }).length;
        const weekCount = barberAppts.length;

        // bar chart: appointments per weekday (Mon..Sun)
        const perDay = Array(7).fill(0);
        for (const a of barberAppts) {
          const dateStart = new Date(a.starts_at);
          const idx = Math.floor((dateStart.getTime() - start.getTime()) / 86400000);
          if (idx >= 0 && idx < 7) perDay[idx]++;
        }

        // working days for this barber
        const working = new Set(
          schedules.filter(s => s.barber_id === b.id && s.is_working).map(s => s.day_of_week)
        );

        // hours summary string
        const wd = schedules.filter(s => s.barber_id === b.id && s.is_working);
        const hoursStr = wd.length
          ? `${dayRangeLabel(working)} · ${wd[0].start_time.replace(':00','')}-${wd[0].end_time.replace(':00','')}`
          : 'Sin horario cargado';

        const occupancy = Math.min(100, Math.round((weekCount * 100) / (SLOTS_PER_DAY * working.size || 1)));

        // Día más cargado esta semana
        const busiestDayIdx = perDay.indexOf(Math.max(...perDay));
        const busiestDay = weekCount > 0 ? ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][busiestDayIdx] : '--';

        // Hora más pedida esta semana (de los turnos del barbero)
        const hourCount = Array(24).fill(0);
        for (const a of barberAppts) hourCount[new Date(a.starts_at).getHours()]++;
        const busiestHour = weekCount > 0 ? `${hourCount.indexOf(Math.max(...hourCount))}:00` : '--';

        const month = monthStats?.[b.id] || { count: 0, revenue: 0, topService: null, showPct: null };

        return (
          <div key={b.id} className="bg-dark-card border border-dark-line rounded-2xl px-4 py-3.5 mb-2.5">
            <div className="flex items-center gap-3">
              <Avatar name={b.initials} size={46} hue={b.hue} dark/>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-bg truncate">{b.name}</div>
                <div className="text-[11px] text-dark-muted mt-0.5 truncate">{b.role}</div>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-dark text-accent">
                <Icon name="star" size={12} color="#B6754C"/>
                <span className="text-[11px] font-semibold">{Number(b.rating).toFixed(1)}</span>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <Stat l="Hoy"      v={todayCount}/>
              <Stat l="Semana"   v={weekCount}/>
              <Stat l="Ocupación" v={`${occupancy}%`}/>
            </div>

            <div className="flex gap-2 mt-2">
              <Stat l="Presentismo" v={month.showPct !== null ? `${month.showPct}%` : '--'}/>
              <Stat l="Día pico"    v={busiestDay}/>
              <Stat l="Hora pico"   v={busiestHour}/>
            </div>

            {month.topService && (
              <div className="mt-2 bg-dark rounded-s px-2.5 py-2 flex items-center gap-2">
                <div className="text-[9px] text-dark-muted uppercase tracking-[1px] shrink-0">Servicio top</div>
                <div className="text-[12px] text-bg font-medium truncate">{month.topService}</div>
              </div>
            )}

            <CommissionPanel
              barber={b}
              month={month}
              onError={setError}
            />

            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-dark-muted">
              <Icon name="clock" size={12} color="#8C8A83"/>
              {hoursStr}
            </div>

            <div className="flex gap-1 mt-3" aria-label={`Ocupación semanal de ${b.name}`}>
              {DAY_LABELS.map((d, di) => {
                const dow = (di + 1) % 7;
                const off = !working.has(dow);
                const max = Math.max(...perDay, 1);
                const pct = off ? 0 : Math.max(8, Math.round((perDay[di] * 100) / max));
                const isToday = di === ((todayDate.getDay() + 6) % 7);
                return (
                  <div key={di} className="flex-1 text-center">
                    <div className="h-[30px] bg-dark rounded-xs overflow-hidden flex items-end">
                      <div className="w-full rounded-t-xs"
                        style={{
                          height: `${pct}%`,
                          background: off ? 'transparent' : isToday ? '#B6754C' : `oklch(0.75 0.06 ${b.hue})`,
                          opacity: off ? 0 : 1
                        }}/>
                    </div>
                    <div className={`text-[9px] mt-1 ${off ? 'text-dark-muted' : 'text-bg'}`}>{d}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CommissionPanel({
  barber, month, onError
}: {
  barber: Barber;
  month: { count: number; revenue: number };
  onError: (msg: string) => void;
}) {
  const initial = clampPct(Number(barber.commission_pct ?? 50));
  const [pct, setPct] = useState<number>(initial);
  const [saved, setSaved] = useState<number>(initial);
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok'>('idle');
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si el server vuelve a renderizar con un valor distinto (ej. después de
  // editar desde Ajustes en otra pestaña), nos sincronizamos.
  useEffect(() => {
    const fresh = clampPct(Number(barber.commission_pct ?? 50));
    if (fresh !== saved) {
      setSaved(fresh);
      setPct(fresh);
    }
  }, [barber.commission_pct]); // eslint-disable-line react-hooks/exhaustive-deps

  const toPay = Math.round((month.revenue * pct) / 100);

  const persist = (value: number) => {
    if (value === saved) return;
    setStatus('saving');
    startTransition(async () => {
      const r = await upsertBarber({
        id: barber.id,
        name: barber.name,
        role: barber.role || '',
        commission_pct: value
      });
      if ((r as any)?.error) {
        // Rollback al último valor confirmado y notificamos.
        setPct(saved);
        setStatus('idle');
        onError((r as any).error);
        return;
      }
      setSaved(value);
      setStatus('ok');
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      okTimerRef.current = setTimeout(() => setStatus(s => s === 'ok' ? 'idle' : s), 1500);
    });
  };

  const onChange = (raw: string) => {
    const next = clampPct(Number(raw));
    setPct(Number.isFinite(next) ? next : 0);
    // Debounce de 600ms — guardamos sin esperar al blur, así se siente
    // "vivo" mientras tocás los steppers o tipeás.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(next), 600);
  };

  const onBlur = () => {
    // Forzamos el save inmediato — evita que el user salga de la pantalla
    // antes de que el debounce dispare.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    persist(pct);
  };

  return (
    <div className="mt-3 bg-dark rounded-s px-3 py-2.5 border border-dark-line/60">
      <div className="flex items-center justify-between">
        <div className="text-[9px] text-dark-muted uppercase tracking-[1.5px]">Mes en curso</div>
        <label className="flex items-center gap-1 text-dark-muted">
          <span className="font-mono text-[10px] uppercase tracking-[1.5px]">Comisión</span>
          <div className="flex items-center bg-dark-card border border-dark-line rounded-xs focus-within:border-accent transition">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={pct}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              aria-label={`Comisión de ${barber.name} en porcentaje`}
              className="bg-transparent text-bg text-[11px] font-mono w-[36px] text-right outline-none px-1.5 py-0.5"
            />
            <span className="font-mono text-[10px] text-dark-muted pr-1.5">%</span>
          </div>
          <span className="w-3 h-3 grid place-items-center" aria-live="polite">
            {status === 'saving' && (
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" aria-label="Guardando" />
            )}
            {status === 'ok' && (
              <Icon name="check" size={10} color="#B6754C"/>
            )}
          </span>
        </label>
      </div>
      <div className="flex items-end justify-between mt-1.5 gap-2">
        <div>
          <div className="font-display text-[22px] text-bg leading-none">{month.count}</div>
          <div className="text-[10px] text-dark-muted mt-1">cortes · {money(month.revenue)}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-[22px] text-accent leading-none">{money(toPay)}</div>
          <div className="text-[10px] text-dark-muted mt-1">a pagar</div>
        </div>
      </div>
    </div>
  );
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function Stat({ l, v }: { l: string; v: number | string }) {
  return (
    <div className="flex-1 bg-dark rounded-s px-2.5 py-2">
      <div className="text-[9px] text-dark-muted uppercase">{l}</div>
      <div className="font-display text-[20px] text-bg leading-none mt-0.5">{v}</div>
    </div>
  );
}

function dayRangeLabel(working: Set<number>) {
  const list = Array.from(working).sort();
  if (list.length === 6 && !list.includes(0)) return 'Lun-Sáb';
  if (list.length === 5 && !list.includes(0) && !list.includes(6)) return 'Lun-Vie';
  if (list.length === 7) return 'Todos los días';
  return list.map(n => ['D','L','M','M','J','V','S'][n]).join('·');
}
