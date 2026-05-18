'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/shared/Icon';
import { Avatar } from '@/components/shared/Avatar';
import { Toast } from '@/components/shared/Toast';
import { SlotsSkeleton } from '@/components/shared/Skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { money } from '@/lib/format';
import { createBooking } from '@/app/actions/booking';
import type { Service, Barber } from '@/types/db';

type Slot = { time: string; iso: string; taken: boolean };

export function BookingFlow({
  shopSlug, services, barbers, preselectedService, preselectedBarber, profile, workingDays, rescheduleFromId
}: {
  shopSlug: string;
  services: Service[]; barbers: Barber[];
  preselectedService?: string; preselectedBarber?: string;
  profile: { name: string; email: string | null; phone: string | null } | null;
  /** Días de la semana en los que al menos un barbero trabaja (0=Dom..6=Sab). Si no se pasa, se asumen todos abiertos. */
  workingDays?: number[];
  /** Si se pasa, después de confirmar el nuevo turno se cancela el viejo (reprogramación). */
  rescheduleFromId?: string;
}) {
  const [step, setStep] = useState<1|2|3>(preselectedService ? 2 : 1);
  const [prevStep, setPrevStep] = useState<1|2|3>(step);
  const [serviceId, setServiceId] = useState<string | null>(preselectedService || null);
  const [confirmingSvc, setConfirmingSvc] = useState<string | null>(null);
  const [barberId,  setBarberId]  = useState<string>(preselectedBarber || 'any');
  const [dateISO,   setDateISO]   = useState<string | null>(null);
  const [slotISO,   setSlotISO]   = useState<string | null>(null);

  const [name,  setName]  = useState(profile?.name  || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [phone, setPhone] = useState(profile?.phone || '');

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => services.find(s => s.id === serviceId) || null, [services, serviceId]);
  const days = useMemo(() => buildNextDays(14, workingDays), [workingDays]);

  const goStep = (next: 1|2|3) => { setPrevStep(step); setStep(next); };

  // Scroll selected date chip into view
  const dayPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dateISO || !dayPickerRef.current) return;
    const el = dayPickerRef.current.querySelector<HTMLElement>(`[data-day="${dateISO}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [dateISO]);

  useEffect(() => {
    if (!serviceId || !dateISO) { setSlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    fetch(`/api/availability?shopSlug=${shopSlug}&barberId=${barberId}&serviceId=${serviceId}&date=${dateISO}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setSlots(d.slots || []); })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setError('No pudimos cargar los horarios. Revisá tu conexión y volvé a intentar.');
        }
      })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [barberId, serviceId, dateISO, shopSlug]);

  const total = service ? Number(service.price) : 0;
  const stepAnimClass = step > prevStep ? 'step-enter' : step < prevStep ? 'step-enter-back' : '';

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-5 pt-3 pb-3 flex items-center gap-3.5">
        {step === 1 ? (
          <Link href={`/${shopSlug}`} className="w-11 h-11 -ml-1 rounded-l bg-card border border-line grid place-items-center active:scale-95 transition" aria-label="Volver al inicio">
            <Icon name="arrow-left" size={18}/>
          </Link>
        ) : (
          <button type="button" onClick={() => goStep((step - 1) as 1|2|3)}
            className="w-11 h-11 -ml-1 rounded-l bg-card border border-line grid place-items-center active:scale-95 transition"
            aria-label="Volver al paso anterior">
            <Icon name="arrow-left" size={18}/>
          </button>
        )}
        <div className="text-base font-semibold -tracking-[0.2px]">Nueva reserva</div>
        <div className="flex-1"/>
        <div className="font-mono text-[11px] text-muted" aria-label={`Paso ${step} de 3`}>{step}/3</div>
      </header>

      <div className="px-5">
        <div className="flex gap-1" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3}>
          {[1,2,3].map(i => (
            <div key={i}
              className={`flex-1 h-[3px] rounded transition-colors duration-200 ${i <= step ? 'bg-ink' : 'bg-line'}`}/>
          ))}
        </div>
      </div>

      <div key={step} className={`flex-1 overflow-auto px-5 pt-4 pb-4 ${stepAnimClass}`}>
        {step === 1 && (
          <>
            <SectionLabel>ELEGÍ EL SERVICIO</SectionLabel>
            <div className="flex flex-col gap-2">
              {services.map(s => {
                const sel = s.id === serviceId;
                const pulse = confirmingSvc === s.id;
                return (
                  <button key={s.id} type="button"
                    disabled={!!confirmingSvc}
                    onClick={() => {
                      setServiceId(s.id);
                      setConfirmingSvc(s.id);
                      // micro-pausa visual antes de avanzar
                      setTimeout(() => { setConfirmingSvc(null); goStep(2); }, 400);
                    }}
                    className={`text-left min-h-[60px] rounded-xl px-4 py-3 flex items-center justify-between border transition active:scale-[0.99]
                      ${sel || pulse ? 'bg-ink text-bg border-transparent' : 'bg-card border-line hover:border-ink/30'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-[34px] h-[34px] rounded-m grid place-items-center ${sel || pulse ? 'bg-dark-card' : 'bg-bg'}`}>
                        {pulse ? (
                          <Icon name="check" size={16} color="#B6754C"/>
                        ) : (
                          <Icon name="scissors" size={16}/>
                        )}
                      </div>
                      <div>
                        <div className="text-[15px] font-medium">{s.name}</div>
                        <div className={`text-[11px] mt-0.5 ${sel || pulse ? 'text-dark-muted' : 'text-muted'}`}>{s.duration_mins} min</div>
                      </div>
                    </div>
                    <div className="font-mono text-[14px] font-medium">{money(Number(s.price))}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && service && (
          <>
            {error && (
              <div className="mb-3">
                <Toast tone="error" message={error} onClose={() => setError(null)} />
              </div>
            )}
            <SectionLabel>SERVICIO</SectionLabel>
            <div className="bg-ink text-bg rounded-xl px-4 py-3.5 flex items-center justify-between">
              <div>
                <div className="text-[15px] font-medium">{service.name}</div>
                <div className="text-[11px] text-dark-muted mt-0.5">{service.duration_mins} min · {money(Number(service.price))}</div>
              </div>
              <button type="button" onClick={() => goStep(1)}
                className="text-[11px] text-dark-muted underline py-2 px-1 active:opacity-60 transition"
                aria-label="Cambiar servicio">
                Cambiar
              </button>
            </div>

            <SectionLabel className="mt-5">BARBERO</SectionLabel>
            <div className="flex gap-2">
              {([{ id: 'any', name: 'Cualquiera', initials: '*', hue: 55 } as Pick<Barber, 'id' | 'name' | 'initials' | 'hue'>, ...barbers]).map(b => {
                const sel = b.id === barberId;
                return (
                  <button key={b.id} type="button" onClick={() => setBarberId(b.id)}
                    className={`flex-1 min-h-[88px] px-2 py-3 rounded-xl text-center transition active:scale-[0.97]
                      ${sel ? 'bg-ink text-bg border-0' : 'bg-card border border-line hover:border-ink/30'}`}
                    aria-pressed={sel}>
                    {b.id === 'any' ? (
                      <div className={`w-9 h-9 mx-auto rounded-full grid place-items-center text-lg ${sel ? 'border border-dashed border-dark-muted' : 'border border-dashed border-muted'}`}>*</div>
                    ) : (
                      <div className="flex justify-center"><Avatar name={b.initials} size={36} hue={b.hue}/></div>
                    )}
                    <div className="text-xs mt-2 font-medium">{b.name}</div>
                  </button>
                );
              })}
            </div>

            <SectionLabel className="mt-5">FECHA</SectionLabel>
            <div ref={dayPickerRef} className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
              {days.map(d => {
                const sel = d.iso === dateISO;
                return (
                  <button key={d.iso} type="button"
                    data-day={d.iso}
                    onClick={() => { if (!d.closed) { setDateISO(d.iso); setSlotISO(null); } }}
                    disabled={d.closed}
                    aria-pressed={sel}
                    aria-label={`${d.wd} ${d.day}${d.closed ? ' (cerrado)' : ''}`}
                    className={`min-w-[56px] min-h-[64px] py-2.5 rounded-l text-center transition active:scale-[0.96]
                      ${sel ? 'bg-accent text-white border-0' :
                        d.closed ? 'border border-dashed border-line text-muted opacity-50 cursor-not-allowed' :
                        'bg-card border border-line text-ink hover:border-ink/30'}`}>
                    <div className="text-[10px] uppercase tracking-wide">{d.wd}</div>
                    <div className="font-display text-[22px] leading-none mt-1">{d.day}</div>
                    <div className="text-[9px] mt-1 opacity-80">{d.closed ? 'Cerrado' : d.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between items-baseline mt-5 mb-2.5">
              <SectionLabel className="!m-0">HORARIO</SectionLabel>
              <div className="text-[11px] text-muted font-mono">
                {dateISO && !loadingSlots
                  ? `${slots.filter(s => !s.taken).length} libres`
                  : dateISO ? '...' : 'Elegí una fecha'}
              </div>
            </div>

            {!dateISO ? (
              <div className="text-[12px] text-muted py-6 text-center">Elegí una fecha para ver los horarios</div>
            ) : loadingSlots ? (
              <>
                <div className="sr-only">Buscando horarios disponibles…</div>
                <SlotsSkeleton count={12} />
              </>
            ) : slots.length === 0 ? (
              <EmptyState
                icon="clock"
                title="Este día no tiene horarios libres"
                description="Probá con otro día o cambiá de barbero."
              />
            ) : slots.filter(s => !s.taken).length === 0 ? (
              <EmptyState
                icon="clock"
                title="Todos los turnos están tomados"
                description="Probá con otro día o elegí otro barbero."
              />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map(s => {
                  const sel = s.iso === slotISO;
                  return (
                    <button key={s.iso} type="button" disabled={s.taken}
                      onClick={() => setSlotISO(s.iso)}
                      aria-pressed={sel}
                      aria-disabled={s.taken}
                      aria-label={s.taken ? `${s.time} ocupado` : `Elegir ${s.time}`}
                      title={s.taken ? 'Ocupado' : undefined}
                      className={`min-h-[44px] py-3 rounded-m text-center font-mono text-[13px] font-medium transition active:scale-[0.95]
                        ${sel ? 'bg-ink text-bg border-0' :
                          s.taken ? 'border border-dashed border-line bg-bg text-muted line-through opacity-50 cursor-not-allowed' :
                          'bg-card border border-line text-ink hover:border-ink/30'}`}>
                      {s.time}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {step === 3 && service && (
          <>
            <SectionLabel>RESUMEN</SectionLabel>
            <div className="bg-card border border-line rounded-xl p-4 flex flex-col gap-2">
              <Row label="Servicio" value={service.name}/>
              <Row label="Duración" value={`${service.duration_mins} min`}/>
              <Row label="Barbero" value={
                barberId === 'any' ? 'Te asignamos el disponible' : barbers.find(b => b.id === barberId)?.name || ''
              }/>
              <Row label="Cuándo" value={slotISO ? new Date(slotISO).toLocaleString('es-AR', {
                weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false,
                timeZone:'America/Argentina/Buenos_Aires'
              }).replace('.', '') : ''}/>
            </div>

            <SectionLabel className="mt-5">TUS DATOS</SectionLabel>
            <div className="flex flex-col gap-2">
              <label className="bg-card border border-line rounded-xl px-4 py-2.5 block focus-within:border-ink/50 transition">
                <span className="block text-[10px] text-muted uppercase tracking-[1.5px] mb-0.5">Nombre</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Joaquín Méndez"
                  autoComplete="name"
                  enterKeyHint="next"
                  className="bg-transparent text-ink w-full outline-none"
                />
              </label>
              <label className="bg-card border border-line rounded-xl px-4 py-2.5 block focus-within:border-ink/50 transition">
                <span className="block text-[10px] text-muted uppercase tracking-[1.5px] mb-0.5">Email</span>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="vos@email.com"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  enterKeyHint="next"
                  className="bg-transparent text-ink w-full outline-none font-mono"
                />
              </label>
              <label className="bg-card border border-line rounded-xl px-4 py-2.5 block focus-within:border-ink/50 transition">
                <span className="block text-[10px] text-muted uppercase tracking-[1.5px] mb-0.5">Teléfono</span>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+54 9 11 5823 4412"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  enterKeyHint="done"
                  className="bg-transparent text-ink w-full outline-none font-mono"
                />
              </label>
            </div>

            {error && (
              <div className="mt-3">
                <Toast tone="error" message={error} onClose={() => setError(null)} />
              </div>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-line bg-card px-5 pt-3.5 pb-7 flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[11px] text-muted">Total</div>
          <div className="font-display text-[24px] leading-none">{money(total)}</div>
        </div>
        {step === 1 && (
          <div className="text-[12px] text-muted">{serviceId ? 'Avanzando…' : 'Elegí un servicio'}</div>
        )}
        {step === 2 && (
          <button type="button"
            disabled={!serviceId || !dateISO || !slotISO}
            onClick={() => goStep(3)}
            className="bg-accent text-white px-6 py-3.5 rounded-xl text-[14px] font-semibold flex items-center gap-2 disabled:opacity-40 active:scale-[0.97] transition">
            Seguir <Icon name="arrow-right" size={16} color="#fff"/>
          </button>
        )}
        {step === 3 && (
          <button type="button"
            disabled={pending || !name || !email || !phone || !slotISO || !serviceId}
            onClick={() => start(async () => {
              setError(null);
              const takenIso = slotISO!;
              const res = await createBooking({
                shopSlug,
                serviceId: serviceId!,
                barberId: barberId as any,
                startsAt: takenIso,
                customerName: name,
                customerPhone: phone,
                customerEmail: email,
                ...(rescheduleFromId ? { rescheduleFromId } : {})
              });
              if (res?.error) {
                if ((res as any).code === 'SLOT_TAKEN') {
                  setSlots(prev => prev.map(s => s.iso === takenIso ? { ...s, taken: true } : s));
                  setSlotISO(null);
                  setError(res.error);
                  goStep(2);
                } else {
                  setError(res.error);
                }
              }
            })}
            className="bg-accent text-white px-6 py-3.5 rounded-xl text-[14px] font-semibold flex items-center gap-2 disabled:opacity-50 active:scale-[0.97] transition">
            {pending ? 'Confirmando…' : (<>Confirmar turno <Icon name="arrow-right" size={16} color="#fff"/></>)}
          </button>
        )}
      </footer>
    </main>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] tracking-[2px] text-muted mb-2.5 ${className}`}>{children}</div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}

function buildNextDays(n: number, workingDays?: number[]) {
  const out = [];
  const today = new Date(); today.setHours(0,0,0,0);
  // Si no se pasa workingDays, asumimos que todos los días están abiertos (no bloqueamos nada)
  const openDays: Set<number> | null = workingDays ? new Set(workingDays) : null;
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const dow = d.getDay();
    out.push({
      iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
      day: d.getDate(),
      wd: d.toLocaleDateString('es-AR', { weekday: 'short' , timeZone: 'America/Argentina/Buenos_Aires' }).replace('.','').slice(0,3),
      label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : '',
      closed: openDays ? !openDays.has(dow) : false
    });
  }
  return out;
}
