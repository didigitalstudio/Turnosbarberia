'use client';
import { useMemo } from 'react';
import { Icon } from '@/components/shared/Icon';
import { money } from '@/lib/format';

type Appt = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  services?: { price?: number } | null;
};

/**
 * Tira horizontal de KPIs del día, encima de la agenda. Compacta para no
 * comerse pantalla en mobile. Calcula todo en cliente desde las props para
 * evitar quereies extra.
 */
export function DayOverview({
  appointments,
  totalIncomeToday,
  totalExpensesToday
}: {
  appointments: Appt[];
  /** Suma de sales del día (server-side). */
  totalIncomeToday: number;
  /** Suma de expenses del día (server-side). */
  totalExpensesToday: number;
}) {
  const now = Date.now();

  const stats = useMemo(() => {
    const active = appointments.filter(a => a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'expired');
    const completed = active.filter(a => a.status === 'completed').length;
    const inProgress = active.filter(a => {
      const s = new Date(a.starts_at).getTime();
      const e = new Date(a.ends_at).getTime();
      return a.status === 'in_progress' || (now >= s && now < e && a.status !== 'completed');
    }).length;
    const upcoming = active.filter(a => new Date(a.starts_at).getTime() > now && a.status !== 'completed').length;
    const next = active
      .filter(a => new Date(a.starts_at).getTime() > now)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
    return { total: active.length, completed, inProgress, upcoming, next };
  }, [appointments, now]);

  const nextTime = stats.next
    ? new Date(stats.next.starts_at).toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires'
      })
    : null;
  const utilidad = totalIncomeToday - totalExpensesToday;

  return (
    <div className="px-5 md:px-8 pt-2 pb-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <Tile
          label="Turnos hoy"
          value={String(stats.total)}
          hint={stats.inProgress > 0 ? `${stats.inProgress} en curso` : `${stats.completed} listos`}
          icon="calendar"
        />
        <Tile
          label="Próximo"
          value={nextTime || '—'}
          hint={stats.upcoming > 0 ? `${stats.upcoming} por venir` : 'sin pendientes'}
          icon="clock"
        />
        <Tile
          label="Ingresos hoy"
          value={money(totalIncomeToday)}
          hint={totalExpensesToday > 0 ? `egresos ${money(totalExpensesToday)}` : ''}
          icon="cash"
          mono
        />
        <Tile
          label="Utilidad"
          value={money(utilidad)}
          hint={utilidad >= 0 ? 'en verde' : 'en rojo'}
          icon={utilidad >= 0 ? 'check' : 'close'}
          mono
          tone={utilidad >= 0 ? 'pos' : 'neg'}
        />
      </div>
    </div>
  );
}

function Tile({
  label, value, hint, icon, mono, tone
}: {
  label: string;
  value: string;
  hint?: string;
  icon: 'calendar' | 'clock' | 'cash' | 'check' | 'close';
  mono?: boolean;
  tone?: 'pos' | 'neg';
}) {
  const valueColor = tone === 'neg' ? 'text-accent' : 'text-bg';
  return (
    <div className="bg-dark-card border border-dark-line rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon name={icon} size={11} color="#8C8A83" />
        <div className="font-mono text-[9px] tracking-[1.5px] text-dark-muted uppercase truncate">{label}</div>
      </div>
      <div className={`mt-1 text-[18px] md:text-[20px] leading-none font-semibold ${mono ? 'font-mono' : ''} ${valueColor} truncate`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-dark-muted mt-0.5 truncate">{hint}</div>}
    </div>
  );
}
