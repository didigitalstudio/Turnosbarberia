'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/shared/Icon';
import { Pill } from '@/components/shared/Pill';
import { Toast } from '@/components/shared/Toast';
import { EmptyState } from '@/components/shared/EmptyState';
import { money } from '@/lib/format';
import { cancelAppointment } from '@/app/actions/booking';

type Upcoming = {
  id: string; starts_at: string; status: string; service_id?: string;
  payment_status?: string | null;
  payment_amount?: number | null;
  services: { name: string; duration_mins: number; price: number };
  barbers: { name: string };
};
type Hist = { id: string; starts_at: string; service_id?: string; services: { name: string }; barbers: { name: string } };

export function MyAppointmentsView({ slug, upcoming, history }: { slug: string; upcoming: Upcoming[]; history: Hist[] }) {
  const [tab, setTab] = useState<'next'|'past'>('next');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const featured = upcoming[0];
  const rest = upcoming.slice(1);
  const reservar = (serviceId?: string, rescheduleId?: string) => {
    const qs = new URLSearchParams();
    if (serviceId) qs.set('service', serviceId);
    if (rescheduleId) qs.set('reschedule', rescheduleId);
    const tail = qs.toString();
    return `/${slug}/reservar${tail ? `?${tail}` : ''}`;
  };

  const [cancelInfo, setCancelInfo] = useState<{ refund: number; inWindow: boolean; refundError: string | null } | null>(null);

  const doCancel = (id: string) => {
    setConfirmCancel(null);
    start(async () => {
      setError(null);
      setCancelInfo(null);
      const r = await cancelAppointment(id);
      if (r?.error) { setError(r.error); return; }
      setCancelInfo({
        refund: Number(r?.refundAmount || 0),
        inWindow: Boolean(r?.inWindow),
        refundError: r?.refundError || null
      });
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-5 pt-3 pb-2">
        <h1 className="font-display text-[30px] -tracking-[0.5px]">Mis turnos</h1>
      </header>

      <div role="tablist" aria-label="Filtro de turnos" className="px-5 pb-2 flex gap-2">
        {(['next','past'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[36px] px-4 py-2 rounded-full text-xs font-medium transition active:scale-[0.97] ${tab === t ? 'bg-ink text-bg' : 'bg-transparent text-ink border border-line hover:border-ink/30'}`}>
            {t === 'next' ? 'Próximos' : 'Historial'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-5 pt-3.5 pb-5">
        {tab === 'next' && (
          <>
            {!featured ? (
              <EmptyState
                icon="calendar"
                title="No tenés turnos próximos"
                description="Cuando reserves uno, va a aparecer acá."
                ctaLabel="Reservar ahora"
                ctaHref={reservar()}
              />
            ) : (
              <FeaturedCard a={featured} reservarHref={reservar(featured.service_id || '', featured.id)} pending={pending} onCancel={(id) => setConfirmCancel(id)}/>
            )}
            {error && (
              <div className="mt-3">
                <Toast tone="error" message={error} onClose={() => setError(null)} />
              </div>
            )}

            {rest.length > 0 && <SectionLabel className="mt-6">MÁS ADELANTE</SectionLabel>}
            {rest.map(a => {
              const d = new Date(a.starts_at);
              return (
                <div key={a.id} className="flex items-center gap-3.5 bg-card border border-line rounded-xl px-3.5 py-3 mb-2 active:scale-[0.99] transition">
                  <DateChip date={d} variant="light" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{a.services?.name}</div>
                    <div className="text-[11px] text-muted mt-0.5">con {a.barbers?.name} · {d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false , timeZone: 'America/Argentina/Buenos_Aires' })}</div>
                  </div>
                  <Icon name="chevron-right" size={18} color="#7A766E"/>
                </div>
              );
            })}
          </>
        )}

        {tab === 'past' && (
          <>
            {history.length === 0 ? (
              <EmptyState
                icon="scissors"
                title="Sin historial todavía"
                description="Después de tu primer turno aparece acá."
                ctaLabel="Reservar el primero"
                ctaHref={reservar()}
              />
            ) : (
              history.map((a, i) => {
                const d = new Date(a.starts_at);
                return (
                  <div key={a.id} className={`flex items-center gap-3 px-1 py-3 min-h-[48px] ${i < history.length - 1 ? 'border-b border-line' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-muted"/>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium">{a.services?.name}</div>
                      <div className="text-[11px] text-muted">{d.toLocaleDateString('es-AR', { day:'2-digit', month:'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.','')} · con {a.barbers?.name}</div>
                    </div>
                    <Link href={reservar(a.service_id || '')} className="text-[11px] text-muted underline py-2 px-1 active:opacity-60 transition">Repetir</Link>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {confirmCancel && (
        <CancelConfirmDialog
          appointment={upcoming.find(u => u.id === confirmCancel)}
          onConfirm={() => doCancel(confirmCancel)}
          onClose={() => setConfirmCancel(null)}
          pending={pending}
        />
      )}

      {cancelInfo && (
        <CancelResultDialog
          info={cancelInfo}
          onClose={() => setCancelInfo(null)}
        />
      )}
    </div>
  );
}

function CancelResultDialog({
  info, onClose
}: {
  info: { refund: number; inWindow: boolean; refundError: string | null };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-[340px] bg-card border border-line rounded-2xl p-5">
        <div className="font-display text-[22px] leading-tight">Turno cancelado</div>
        {info.refundError ? (
          <p className="text-[13px] text-muted mt-2 leading-relaxed">{info.refundError}</p>
        ) : info.refund > 0 ? (
          <p className="text-[13px] text-muted mt-2 leading-relaxed">
            Estamos reembolsando <span className="text-ink font-medium">{money(info.refund)}</span> a tu medio de pago.
            Tarda hasta 5 días hábiles en aparecer.
          </p>
        ) : info.inWindow ? (
          <p className="text-[13px] text-muted mt-2 leading-relaxed">
            No corresponde reembolso (la seña no era reembolsable).
          </p>
        ) : (
          <p className="text-[13px] text-muted mt-2 leading-relaxed">
            Cancelaste con menos de 3 horas — según la política, no hay reembolso.
          </p>
        )}
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose}
            className="min-h-[42px] bg-ink text-bg rounded-m px-5 py-2 text-[13px] font-semibold active:scale-[0.98] transition">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelConfirmDialog({
  appointment, onConfirm, onClose, pending
}: {
  appointment?: Upcoming;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  const paid = Number(appointment?.payment_amount || 0);
  const hasPaid = appointment?.payment_status === 'paid' && paid > 0;
  const servicePrice = Number(appointment?.services?.price || 0);
  const nonRefundable = Math.round(servicePrice * 20) / 100;
  const refundable = Math.max(0, paid - nonRefundable);

  // ¿Estamos a ≥3 hs del turno?
  const startsAtMs = appointment ? new Date(appointment.starts_at).getTime() : 0;
  const hoursToStart = appointment ? (startsAtMs - Date.now()) / (60 * 60 * 1000) : 0;
  const inWindow = hoursToStart >= 3;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-[340px] bg-card border border-line rounded-2xl p-5">
        <div className="font-display text-[22px] leading-tight">¿Cancelar este turno?</div>
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          Esta acción no se puede deshacer. Si querés reprogramar, cerrá este aviso y tocá Reprogramar.
        </p>

        {hasPaid && (
          <div className="mt-3 bg-bg border border-line rounded-m px-3 py-2.5 text-[12px] leading-relaxed">
            {inWindow ? (
              refundable > 0 ? (
                <>Estás a tiempo: te devolvemos <span className="font-medium text-ink">{money(refundable)}</span>. La seña dura ({money(nonRefundable)}) no es reembolsable.</>
              ) : (
                <>Cancelando ahora no corresponde reembolso (la seña pagada equivale a la seña dura no reembolsable).</>
              )
            ) : (
              <>Cancelando a menos de 3 hs del turno se pierde lo pagado (<span className="font-medium text-ink">{money(paid)}</span>).</>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={pending}
            className="flex-1 min-h-[42px] bg-transparent border border-line text-ink rounded-m px-3 py-2 text-[13px] font-medium active:scale-[0.98] transition">
            Volver
          </button>
          <button type="button" onClick={onConfirm} disabled={pending}
            className="flex-1 min-h-[42px] bg-ink text-bg rounded-m px-3 py-2 text-[13px] font-semibold disabled:opacity-50 active:scale-[0.98] transition">
            {pending ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeaturedCard({ a, reservarHref, pending, onCancel }: { a: Upcoming; reservarHref: string; pending: boolean; onCancel: (id: string) => void }) {
  const d = new Date(a.starts_at);
  const isTomorrow = (() => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    return d.toDateString() === t.toDateString();
  })();
  const isToday = d.toDateString() === new Date().toDateString();
  return (
    <div className="bg-ink text-bg rounded-2xl px-4 py-4 relative overflow-hidden">
      <div className="flex items-start gap-3.5">
        <DateChip date={d} variant="dark" />
        <div className="flex-1">
          {isToday ? <Pill tone="accent">Hoy</Pill> : isTomorrow ? <Pill tone="accent">Mañana</Pill> : null}
          <div className="text-base font-medium mt-2.5">{a.services?.name}</div>
          <div className="text-[12px] text-dark-muted mt-0.5">con {a.barbers?.name} · {a.services?.duration_mins} min</div>
          <div className="font-display text-[28px] italic mt-2.5 text-accent">
            {d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' })}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-3.5">
        <button disabled={pending} onClick={() => onCancel(a.id)}
          className="flex-1 min-h-[40px] bg-transparent text-bg border border-dark-line px-3 py-2.5 rounded-m text-[12px] font-medium disabled:opacity-50 active:scale-[0.98] transition">
          {pending ? 'Cancelando…' : 'Cancelar'}
        </button>
        <Link href={reservarHref}
          className="flex-1 min-h-[40px] bg-bg text-ink px-3 py-2.5 rounded-m text-[12px] font-semibold text-center active:scale-[0.98] transition">
          Reprogramar
        </Link>
      </div>
    </div>
  );
}

function DateChip({ date, variant }: { date: Date; variant: 'light' | 'dark' }) {
  const wd = date.toLocaleDateString('es-AR', { weekday: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.','').slice(0,3);
  const m = date.toLocaleDateString('es-AR', { month: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.','');
  return (
    <div className={`rounded-m text-center ${variant === 'dark' ? 'bg-dark-card text-bg px-3 py-2.5 min-w-[56px]' : 'bg-bg px-2.5 py-2 min-w-[48px]'}`}>
      <div className={`text-[10px] uppercase ${variant === 'dark' ? 'text-dark-muted' : 'text-muted'}`}>{wd}</div>
      <div className="font-display text-[22px] leading-none mt-0.5">{date.getDate()}</div>
      <div className={`text-[9px] ${variant === 'dark' ? 'text-dark-muted' : 'text-muted'}`}>{m}</div>
    </div>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] tracking-[2px] text-muted mb-2.5 ${className}`}>{children}</div>;
}
