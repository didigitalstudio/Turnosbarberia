'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shared/Icon';
import { Toast } from '@/components/shared/Toast';
import { createWalkIn } from '@/app/actions/ajustes';

type Svc = { id: string; name: string; duration_mins: number; price: number };
type Barber = { id: string; name: string };

function isoLocalNow(offsetMinutes = 10): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewWalkInForm({
  services, barbers, defaultDate, defaultTime, defaultBarberId
}: {
  services: Svc[];
  barbers: Barber[];
  defaultDate?: string;
  defaultTime?: string;
  defaultBarberId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serviceId, setServiceId] = useState<string>(services[0]?.id || '');
  const [barberId, setBarberId] = useState<string>(
    (defaultBarberId && barbers.some(b => b.id === defaultBarberId)) ? defaultBarberId : (barbers[0]?.id || '')
  );
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [when, setWhen] = useState<string>(
    (defaultDate && defaultTime) ? `${defaultDate}T${defaultTime}` : isoLocalNow(5)
  );
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = !!serviceId && !!barberId && name.trim().length >= 2 && !!when && !pending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(null);
    start(async () => {
      const iso = new Date(when).toISOString();
      const r = await createWalkIn({
        serviceId,
        barberId,
        customerName: name.trim(),
        customerPhone: phone.trim() || '',
        startsAt: iso
      });
      if (r?.error) setErr(r.error);
      else router.push('/shop');
    });
  };

  const noData = services.length === 0 || barbers.length === 0;

  return (
    <div className="flex-1 overflow-auto px-5 pt-4 pb-6 md:px-8">
      {noData ? (
        <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-6 text-center text-dark-muted">
          Necesitás al menos un servicio y un barbero activo para cargar turnos.
          <div className="mt-3">
            <a href="/shop/ajustes" className="text-[12px] px-3 py-2 rounded-m border border-dark-line text-bg hover:border-bg/30 transition inline-block">
              Ir a ajustes
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-xl">
          <Field label="Servicio">
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="bg-transparent text-bg text-[15px] w-full outline-none">
              {services.map(s => (
                <option key={s.id} value={s.id} className="bg-dark">
                  {s.name} · {s.duration_mins}min
                </option>
              ))}
            </select>
          </Field>

          <Field label="Barbero">
            <select
              value={barberId}
              onChange={(e) => setBarberId(e.target.value)}
              className="bg-transparent text-bg text-[15px] w-full outline-none">
              {barbers.map(b => (
                <option key={b.id} value={b.id} className="bg-dark">{b.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Cliente (nombre)">
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Juan Pérez"
              className="bg-transparent text-bg text-[15px] w-full outline-none placeholder:text-dark-muted/60"
            />
          </Field>

          <Field label="Teléfono (opcional)">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 11 5555 5555"
              className="bg-transparent text-bg text-[15px] w-full outline-none placeholder:text-dark-muted/60"
            />
          </Field>

          <Field label="Fecha y hora">
            <input
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="bg-transparent text-bg text-[15px] w-full outline-none"
            />
          </Field>

          {err && (
            <Toast dark tone="error" message={err} onClose={() => setErr(null)} />
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 bg-accent text-white border-0 px-4 py-3.5 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition">
            {pending ? 'Guardando…' : (<>Crear turno <Icon name="arrow-right" size={18} color="#fff"/></>)}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line block focus-within:border-accent transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">{label}</span>
      {children}
    </label>
  );
}
