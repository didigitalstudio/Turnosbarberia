'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Icon } from '@/components/shared/Icon';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import {
  updateShop,
  upsertService, toggleService,
  upsertBarber, toggleBarber,
  updateSchedules,
  addShop, switchShop
} from '@/app/actions/ajustes';
import { upsertShopPaymentSettings } from '@/app/actions/payments';
import { upsertShopWhatsappSettings } from '@/app/actions/whatsapp';
import { createScheduleBlock, deleteScheduleBlock } from '@/app/actions/schedule-blocks';
import { slugify } from '@/lib/slug';
import type { Shop, Service, Barber, Schedule } from '@/types/db';

export type ScheduleBlockLite = {
  id: string;
  barber_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

type Tab = 'shop' | 'services' | 'team' | 'hours' | 'sedes' | 'pagos' | 'whatsapp';

export type ShopPaymentSettings = {
  mp_access_token: string | null;
  mp_public_key: string | null;
  mp_webhook_secret: string | null;
  is_active: boolean;
};

export type ShopWhatsappSettings = {
  phone_number_id: string | null;
  access_token: string | null;
  reminder_template_name: string;
  reminder_template_language: string;
  is_active: boolean;
};

const DAYS = [
  { idx: 1, short: 'Lun', long: 'Lunes' },
  { idx: 2, short: 'Mar', long: 'Martes' },
  { idx: 3, short: 'Mié', long: 'Miércoles' },
  { idx: 4, short: 'Jue', long: 'Jueves' },
  { idx: 5, short: 'Vie', long: 'Viernes' },
  { idx: 6, short: 'Sáb', long: 'Sábado' },
  { idx: 0, short: 'Dom', long: 'Domingo' }
];

export function AjustesView({
  shop, services, barbers, schedules, publicUrl, userShops, paymentSettings, whatsappSettings, scheduleBlocks
}: {
  shop: Shop;
  services: Service[];
  barbers: Barber[];
  schedules: Schedule[];
  publicUrl: string;
  userShops: Shop[];
  paymentSettings: ShopPaymentSettings | null;
  whatsappSettings: ShopWhatsappSettings | null;
  scheduleBlocks: ScheduleBlockLite[];
}) {
  const [tab, setTab] = useState<Tab>('shop');
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  return (
    <div className="flex-1 overflow-auto px-5 pt-4 pb-8 md:px-8">
      {toast && (
        <div className="mb-3">
          <Toast dark tone={toast.tone} message={toast.text} onClose={() => setToast(null)} />
        </div>
      )}

      {/* Link público */}
      <PublicLinkBanner publicUrl={publicUrl} />

      {/* Tabs */}
      <div className="mt-5 flex gap-1 bg-dark-card border border-dark-line rounded-xl p-1 w-full md:max-w-2xl overflow-x-auto no-scrollbar">
        {(['shop', 'services', 'team', 'hours', 'sedes', 'pagos', 'whatsapp'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 min-w-[80px] px-3 py-2 rounded-l text-[12px] font-medium transition whitespace-nowrap
              ${tab === t ? 'bg-bg text-ink' : 'text-dark-muted hover:text-bg'}`}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      <div className="mt-4 md:max-w-3xl">
        {tab === 'shop' && <ShopSection shop={shop} onToast={setToast} />}
        {tab === 'services' && <ServicesSection services={services} onToast={setToast} />}
        {tab === 'team' && <TeamSection barbers={barbers} onToast={setToast} />}
        {tab === 'hours' && <HoursSection barbers={barbers} schedules={schedules} blocks={scheduleBlocks} onToast={setToast} />}
        {tab === 'sedes' && <SedesSection shop={shop} userShops={userShops} onToast={setToast} />}
        {tab === 'pagos' && <PagosSection settings={paymentSettings} onToast={setToast} />}
        {tab === 'whatsapp' && <WhatsappSection settings={whatsappSettings} onToast={setToast} />}
      </div>
    </div>
  );
}

function tabLabel(t: Tab) {
  return t === 'shop' ? 'Barbería'
    : t === 'services' ? 'Servicios'
    : t === 'team' ? 'Equipo'
    : t === 'hours' ? 'Horarios'
    : t === 'sedes' ? 'Sedes'
    : t === 'pagos' ? 'Pagos'
    : 'WhatsApp';
}

// ─── Public link banner ──────────────────────────────────────────────────────

function PublicLinkBanner({ publicUrl }: { publicUrl: string }) {
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`Reservá tu turno en ${publicUrl}`)}`;
  const ig = `https://www.instagram.com/`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* noop */ }
  };

  return (
    <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-3.5 md:px-5 md:py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">TU LINK PÚBLICO</div>
          <div className="text-[13px] md:text-[14px] font-mono text-bg mt-1 truncate">{publicUrl}</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="text-[12px] px-3 py-2 rounded-m border border-dark-line text-bg hover:border-bg/30 transition">
            {copied ? '¡Copiado!' : 'Copiar'}
          </button>
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="text-[12px] px-3 py-2 rounded-m border border-dark-line text-bg hover:border-bg/30 transition">
            WhatsApp
          </a>
          <a href={ig} target="_blank" rel="noopener noreferrer"
            className="text-[12px] px-3 py-2 rounded-m border border-dark-line text-bg hover:border-bg/30 transition">
            Instagram
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Shop section ────────────────────────────────────────────────────────────

function ShopSection({ shop, onToast }: { shop: Shop; onToast: (t: { tone: 'success' | 'error'; text: string }) => void }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address || '');
  const [phone, setPhone] = useState(shop.phone || '');
  const [tz, setTz] = useState(shop.timezone);

  const save = () => start(async () => {
    const r = await updateShop({ name, address, phone, timezone: tz });
    if (r?.error) onToast({ tone: 'error', text: r.error });
    else onToast({ tone: 'success', text: 'Datos actualizados' });
  });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Nombre">
        <input value={name} onChange={e => setName(e.target.value)}
          className="bg-transparent text-bg w-full outline-none text-[15px]" />
      </Field>
      <Field label="Dirección">
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="Av. Santa Fe 3200, CABA"
          className="bg-transparent text-bg w-full outline-none text-[15px]" />
      </Field>
      <Field label="Teléfono">
        <input value={phone} onChange={e => setPhone(e.target.value)}
          placeholder="+54 9 11 5823 4412"
          className="bg-transparent text-bg w-full outline-none font-mono text-[14px]" />
      </Field>
      <Field label="Timezone">
        <input value={tz} onChange={e => setTz(e.target.value)}
          className="bg-transparent text-bg w-full outline-none font-mono text-[13px]" />
      </Field>

      <div className="flex gap-2 mt-2">
        <button type="button" onClick={save} disabled={pending}
          className="bg-accent text-white px-5 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

// ─── Services section ────────────────────────────────────────────────────────

type ServiceDraft = {
  id?: string;
  name: string;
  duration: number;
  price: number;
  description: string;
  depositType: 'none' | 'percent' | 'fixed' | 'full';
  depositAmount: number;
};

function ServicesSection({ services, onToast }: { services: Service[]; onToast: (t: { tone: 'success' | 'error'; text: string }) => void }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<ServiceDraft | null>(null);

  const save = () => {
    if (!draft) return;
    start(async () => {
      const r = await upsertService({
        id: draft.id,
        name: draft.name,
        duration_mins: draft.duration,
        price: draft.price,
        description: draft.description,
        deposit_type: draft.depositType,
        deposit_amount: draft.depositAmount
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else { onToast({ tone: 'success', text: draft.id ? 'Servicio actualizado' : 'Servicio agregado' }); setDraft(null); }
    });
  };

  const formatDepositLabel = (s: Service): string | null => {
    if (s.deposit_type === 'none') return null;
    if (s.deposit_type === 'full') return 'Pago anticipado · 100%';
    if (s.deposit_type === 'percent') return `Seña · ${s.deposit_amount}%`;
    return `Seña · ${money(Number(s.deposit_amount))}`;
  };

  const toggle = (s: Service) => start(async () => {
    const r = await toggleService(s.id, !s.is_active);
    if (r?.error) onToast({ tone: 'error', text: r.error });
    else onToast({ tone: 'success', text: s.is_active ? 'Servicio desactivado' : 'Servicio activado' });
  });

  return (
    <div className="flex flex-col gap-3">
      {services.length === 0 && (
        <div className="text-[13px] text-dark-muted bg-dark-card border border-dark-line rounded-xl px-4 py-3">
          Todavía no tenés servicios.
        </div>
      )}
      {services.map(s => {
        const depositLabel = formatDepositLabel(s);
        return (
          <div key={s.id} className={`bg-dark-card border border-dark-line rounded-xl px-4 py-3 flex items-center gap-3 ${!s.is_active ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-bg truncate">{s.name}</div>
              <div className="text-[11px] text-dark-muted mt-0.5 font-mono">
                {s.duration_mins} min · {money(Number(s.price))}
              </div>
              {depositLabel && (
                <div className="text-[10px] text-accent mt-1 font-mono uppercase tracking-[1px]">
                  {depositLabel}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setDraft({
              id: s.id,
              name: s.name,
              duration: s.duration_mins,
              price: Number(s.price),
              description: s.description || '',
              depositType: (s.deposit_type || 'none') as ServiceDraft['depositType'],
              depositAmount: Number(s.deposit_amount || 0)
            })}
              className="text-[11px] px-2.5 py-1.5 rounded-xs border border-dark-line text-bg hover:border-bg/30 transition">
              Editar
            </button>
            <button type="button" onClick={() => toggle(s)} disabled={pending}
              className="text-[11px] px-2.5 py-1.5 rounded-xs border border-dark-line text-bg hover:border-bg/30 transition">
              {s.is_active ? 'Pausar' : 'Activar'}
            </button>
          </div>
        );
      })}

      {!draft && (
        <button type="button"
          onClick={() => setDraft({ name: '', duration: 30, price: 0, description: '', depositType: 'none', depositAmount: 0 })}
          className="mt-1 rounded-xl border border-dashed border-dark-line px-4 py-3 text-[13px] text-dark-muted flex items-center justify-center gap-2 hover:border-bg/30 hover:text-bg transition">
          <Icon name="plus" size={16} /> Agregar servicio
        </button>
      )}

      {draft && (
        <div className="bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
          <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">
            {draft.id ? 'EDITAR SERVICIO' : 'NUEVO SERVICIO'}
          </div>
          <Field label="Nombre">
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
              className="bg-transparent text-bg w-full outline-none text-[15px]" placeholder="Corte de pelo" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Duración (min)">
              <input type="number" min={5} max={480} value={draft.duration}
                onChange={e => setDraft({ ...draft, duration: Math.max(5, Number(e.target.value) || 0) })}
                className="bg-transparent text-bg w-full outline-none font-mono text-[14px]" />
            </Field>
            <Field label="Precio">
              <input type="number" min={0} value={draft.price}
                onChange={e => setDraft({ ...draft, price: Math.max(0, Number(e.target.value) || 0) })}
                className="bg-transparent text-bg w-full outline-none font-mono text-[14px]" />
            </Field>
          </div>
          <Field label="Descripción (opcional)">
            <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
              className="bg-transparent text-bg w-full outline-none text-[14px]" />
          </Field>

          {/* Configuración de seña / cobro anticipado */}
          <div className="mt-2 border-t border-dark-line pt-3">
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted mb-2">COBRO ANTICIPADO</div>
            <div className="flex flex-wrap gap-1.5">
              {([
                { v: 'none', label: 'Sin seña' },
                { v: 'percent', label: '% del precio' },
                { v: 'fixed', label: 'Monto fijo' },
                { v: 'full', label: 'Pago total' }
              ] as Array<{ v: ServiceDraft['depositType']; label: string }>).map(opt => {
                const sel = draft.depositType === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setDraft({ ...draft, depositType: opt.v, depositAmount: opt.v === 'none' || opt.v === 'full' ? 0 : draft.depositAmount })}
                    className={`text-[11px] px-2.5 py-1.5 rounded-xs border transition ${sel ? 'border-accent bg-accent/15 text-bg' : 'border-dark-line text-dark-muted hover:text-bg'}`}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {(draft.depositType === 'percent' || draft.depositType === 'fixed') && (
              <div className="mt-2">
                <Field label={draft.depositType === 'percent' ? 'Porcentaje (0-100)' : 'Monto fijo en pesos'}>
                  <input
                    type="number"
                    min={0}
                    max={draft.depositType === 'percent' ? 100 : undefined}
                    value={draft.depositAmount}
                    onChange={e => setDraft({ ...draft, depositAmount: Math.max(0, Number(e.target.value) || 0) })}
                    className="bg-transparent text-bg w-full outline-none font-mono text-[14px]" />
                </Field>
                <div className="mt-1.5 text-[11px] text-dark-muted">
                  El cliente deberá pagar esta seña al reservar para confirmar el turno.
                </div>
              </div>
            )}
            {draft.depositType === 'full' && (
              <div className="mt-2 text-[11px] text-dark-muted">
                El cliente paga el 100% del precio al reservar.
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-1">
            <button type="button" onClick={save} disabled={pending}
              className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setDraft(null)}
              className="px-4 py-2.5 rounded-m border border-dark-line text-bg text-[13px] hover:border-bg/30 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team section ────────────────────────────────────────────────────────────

function TeamSection({ barbers, onToast }: { barbers: Barber[]; onToast: (t: { tone: 'success' | 'error'; text: string }) => void }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ id?: string; name: string; role: string; commission_pct: number } | null>(null);

  const save = () => {
    if (!draft) return;
    start(async () => {
      const r = await upsertBarber({
        id: draft.id,
        name: draft.name,
        role: draft.role,
        commission_pct: draft.commission_pct
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else { onToast({ tone: 'success', text: draft.id ? 'Barbero actualizado' : 'Barbero agregado' }); setDraft(null); }
    });
  };

  const toggle = (b: Barber) => start(async () => {
    const r = await toggleBarber(b.id, !b.is_active);
    if (r?.error) onToast({ tone: 'error', text: r.error });
    else onToast({ tone: 'success', text: b.is_active ? 'Barbero desactivado' : 'Barbero activado' });
  });

  return (
    <div className="flex flex-col gap-3">
      {barbers.length === 0 && (
        <div className="text-[13px] text-dark-muted bg-dark-card border border-dark-line rounded-xl px-4 py-3">
          Todavía no tenés barberos.
        </div>
      )}
      {barbers.map(b => (
        <div key={b.id} className={`bg-dark-card border border-dark-line rounded-xl px-4 py-3 flex items-center gap-3 ${!b.is_active ? 'opacity-60' : ''}`}>
          <div className="w-10 h-10 rounded-full bg-dark text-bg grid place-items-center font-mono text-[12px] font-semibold flex-shrink-0"
            style={{ background: `oklch(0.3 0.05 ${b.hue})` }}>
            {b.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-bg truncate">{b.name}</div>
            <div className="text-[11px] text-dark-muted mt-0.5 truncate">
              {b.role || '—'}<span className="text-dark-muted/60"> · </span>{Number(b.commission_pct).toFixed(0)}%
            </div>
          </div>
          <button type="button" onClick={() => setDraft({ id: b.id, name: b.name, role: b.role || '', commission_pct: Number(b.commission_pct ?? 50) })}
            className="text-[11px] px-2.5 py-1.5 rounded-xs border border-dark-line text-bg hover:border-bg/30 transition">
            Editar
          </button>
          <button type="button" onClick={() => toggle(b)} disabled={pending}
            className="text-[11px] px-2.5 py-1.5 rounded-xs border border-dark-line text-bg hover:border-bg/30 transition">
            {b.is_active ? 'Pausar' : 'Activar'}
          </button>
        </div>
      ))}

      {!draft && (
        <button type="button"
          onClick={() => setDraft({ name: '', role: '', commission_pct: 50 })}
          className="mt-1 rounded-xl border border-dashed border-dark-line px-4 py-3 text-[13px] text-dark-muted flex items-center justify-center gap-2 hover:border-bg/30 hover:text-bg transition">
          <Icon name="plus" size={16} /> Agregar barbero
        </button>
      )}

      {draft && (
        <div className="bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
          <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">
            {draft.id ? 'EDITAR BARBERO' : 'NUEVO BARBERO'}
          </div>
          <Field label="Nombre">
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
              className="bg-transparent text-bg w-full outline-none text-[15px]" placeholder="Tomás Aguirre" />
          </Field>
          <Field label="Rol (opcional)">
            <input value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })}
              className="bg-transparent text-bg w-full outline-none text-[14px]" placeholder="Senior · 5 años" />
          </Field>
          <Field label="Comisión por corte (%)">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={Number.isFinite(draft.commission_pct) ? draft.commission_pct : 50}
              onChange={e => setDraft({ ...draft, commission_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className="bg-transparent text-bg w-full outline-none text-[14px] font-mono"
              placeholder="50"
            />
          </Field>
          <div className="flex gap-2 mt-1">
            <button type="button" onClick={save} disabled={pending}
              className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setDraft(null)}
              className="px-4 py-2.5 rounded-m border border-dark-line text-bg text-[13px] hover:border-bg/30 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hours section ───────────────────────────────────────────────────────────

type DraftSched = Record<number, { start: string; end: string; on: boolean }>;

function HoursSection({ barbers, schedules, blocks, onToast }: { barbers: Barber[]; schedules: Schedule[]; blocks: ScheduleBlockLite[]; onToast: (t: { tone: 'success' | 'error'; text: string }) => void }) {
  const [pending, start] = useTransition();
  const active = useMemo(() => barbers.filter(b => b.is_active), [barbers]);
  const [barberId, setBarberId] = useState<string>(active[0]?.id || '');
  const [draft, setDraft] = useState<DraftSched>({});

  useEffect(() => {
    if (!barberId && active[0]) setBarberId(active[0].id);
  }, [active, barberId]);

  useEffect(() => {
    if (!barberId) return;
    const next: DraftSched = {};
    for (let d = 0; d < 7; d++) {
      const row = schedules.find(s => s.barber_id === barberId && s.day_of_week === d);
      next[d] = {
        start: (row?.start_time || '10:00').slice(0, 5),
        end: (row?.end_time || '20:00').slice(0, 5),
        on: row?.is_working ?? (d !== 0)
      };
    }
    setDraft(next);
  }, [barberId, schedules]);

  const patch = (day: number, v: Partial<{ start: string; end: string; on: boolean }>) => {
    setDraft(prev => ({ ...prev, [day]: { ...prev[day], ...v } }));
  };

  const save = () => {
    if (!barberId) return;
    start(async () => {
      const days = Array.from({ length: 7 }, (_, i) => ({
        day_of_week: i,
        start_time: draft[i]?.start || '10:00',
        end_time: draft[i]?.end || '20:00',
        is_working: !!draft[i]?.on
      }));
      const r = await updateSchedules(barberId, days);
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else onToast({ tone: 'success', text: 'Horarios actualizados' });
    });
  };

  if (active.length === 0) {
    return (
      <div className="text-[13px] text-dark-muted bg-dark-card border border-dark-line rounded-xl px-4 py-3">
        Agregá barberos en la pestaña Equipo primero.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {active.map(b => (
          <button key={b.id} type="button"
            onClick={() => setBarberId(b.id)}
            className={`px-3 py-2 rounded-l text-[12px] font-medium transition whitespace-nowrap
              ${b.id === barberId ? 'bg-bg text-ink' : 'bg-dark-card border border-dark-line text-bg'}`}>
            {b.name}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {DAYS.map(d => {
          const row = draft[d.idx] || { start: '10:00', end: '20:00', on: false };
          return (
            <div key={d.idx} className={`bg-dark-card border border-dark-line rounded-xl px-3 py-2.5 flex items-center gap-3 ${!row.on ? 'opacity-60' : ''}`}>
              <div className="w-12 text-[13px] font-medium text-bg">{d.short}</div>
              <button type="button"
                onClick={() => patch(d.idx, { on: !row.on })}
                aria-pressed={row.on}
                className={`w-9 h-5 rounded-full transition flex-shrink-0 ${row.on ? 'bg-accent' : 'bg-dark-line'} relative`}>
                <span className={`absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all ${row.on ? 'left-[18px]' : 'left-[2px]'}`} />
              </button>
              <div className="flex-1 flex items-center gap-2 justify-end">
                <input type="time" value={row.start} disabled={!row.on}
                  onChange={e => patch(d.idx, { start: e.target.value })}
                  className="bg-transparent text-bg outline-none font-mono text-[13px] border border-dark-line rounded-m px-2 py-1 disabled:opacity-50" />
                <span className="text-dark-muted text-[11px]">—</span>
                <input type="time" value={row.end} disabled={!row.on}
                  onChange={e => patch(d.idx, { end: e.target.value })}
                  className="bg-transparent text-bg outline-none font-mono text-[13px] border border-dark-line rounded-m px-2 py-1 disabled:opacity-50" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2">
        <button type="button" onClick={save} disabled={pending}
          className="bg-accent text-white px-5 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
          {pending ? 'Guardando…' : 'Guardar horarios'}
        </button>
      </div>

      {/* Bloqueos puntuales: vacaciones, feriados, días libres extra */}
      <BlocksSubsection barbers={active} blocks={blocks} onToast={onToast} />
    </div>
  );
}

function BlocksSubsection({ barbers, blocks, onToast }: { barbers: Barber[]; blocks: ScheduleBlockLite[]; onToast: (t: { tone: 'success' | 'error'; text: string }) => void }) {
  const [pending, start] = useTransition();
  // Form en bottom-sheet style abajo de la lista, expandible.
  const [showForm, setShowForm] = useState(false);
  const [barberId, setBarberId] = useState<'all' | string>('all');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!startsAt || !endsAt) {
      onToast({ tone: 'error', text: 'Completá las fechas/horas de inicio y fin.' });
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      onToast({ tone: 'error', text: 'El fin tiene que ser posterior al inicio.' });
      return;
    }
    start(async () => {
      // El input datetime-local viene sin TZ. Lo interpretamos en hora local
      // del browser (en AR, GMT-3).
      const startsIso = new Date(startsAt).toISOString();
      const endsIso = new Date(endsAt).toISOString();
      const r = await createScheduleBlock({
        barberId: barberId === 'all' ? null : barberId,
        startsAt: startsIso,
        endsAt: endsIso,
        reason
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else {
        onToast({ tone: 'success', text: 'Bloqueo agregado' });
        setShowForm(false);
        setStartsAt(''); setEndsAt(''); setReason(''); setBarberId('all');
      }
    });
  };

  const remove = (id: string) => start(async () => {
    const r = await deleteScheduleBlock(id);
    if (r?.error) onToast({ tone: 'error', text: r.error });
    else onToast({ tone: 'success', text: 'Bloqueo eliminado' });
  });

  const now = Date.now();
  // Mostramos los activos/futuros arriba; los pasados se ocultan.
  const visible = blocks.filter(b => new Date(b.ends_at).getTime() >= now);

  const barberName = (id: string | null) => id ? (barbers.find(b => b.id === id)?.name || 'Barbero') : 'Toda la sede';

  return (
    <div className="mt-6 border-t border-dark-line pt-5">
      <div className="font-mono text-[10px] tracking-[2px] text-dark-muted mb-2">
        BLOQUEOS DE AGENDA
      </div>
      <div className="text-[11px] text-dark-muted mb-3 leading-relaxed">
        Vacaciones, feriados o días sueltos sin trabajar. Estos slots no se ofrecen al cliente al reservar.
      </div>

      {visible.length === 0 && !showForm && (
        <div className="bg-dark-card border border-dark-line rounded-xl px-3 py-2.5 text-[12px] text-dark-muted">
          No hay bloqueos vigentes.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map(b => (
          <div key={b.id} className="bg-dark-card border border-dark-line rounded-xl px-3 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-bg truncate">
                {barberName(b.barber_id)}
                {b.reason && <span className="text-dark-muted font-normal"> · {b.reason}</span>}
              </div>
              <div className="text-[11px] text-dark-muted font-mono">
                {formatBlockRange(b.starts_at, b.ends_at)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(b.id)}
              disabled={pending}
              className="text-[11px] px-2 py-1 rounded-xs border border-dark-line text-dark-muted hover:text-bg hover:border-bg/40 transition disabled:opacity-50">
              Quitar
            </button>
          </div>
        ))}
      </div>

      {showForm ? (
        <div className="mt-3 bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
          <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">NUEVO BLOQUEO</div>

          <Field label="Aplicar a">
            <select
              value={barberId}
              onChange={e => setBarberId(e.target.value as 'all' | string)}
              className="bg-transparent text-bg w-full outline-none text-[14px]">
              <option value="all" className="bg-dark-card">Toda la sede</option>
              {barbers.map(b => (
                <option key={b.id} value={b.id} className="bg-dark-card">{b.name}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Desde">
              <input
                type="datetime-local"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
                className="bg-transparent text-bg w-full outline-none font-mono text-[12px]" />
            </Field>
            <Field label="Hasta">
              <input
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                className="bg-transparent text-bg w-full outline-none font-mono text-[12px]" />
            </Field>
          </div>

          <Field label="Motivo (opcional)">
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Vacaciones / Feriado / Curso"
              maxLength={120}
              className="bg-transparent text-bg w-full outline-none text-[13px]" />
          </Field>

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
              {pending ? 'Guardando…' : 'Crear bloqueo'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-m border border-dark-line text-bg text-[13px] hover:border-bg/30 transition">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 rounded-xl border border-dashed border-dark-line px-4 py-2.5 text-[12px] text-dark-muted flex items-center justify-center gap-2 hover:border-bg/30 hover:text-bg transition">
          <Icon name="plus" size={14} /> Agregar bloqueo
        </button>
      )}
    </div>
  );
}

function formatBlockRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const fmt = (d: Date) => d.toLocaleString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires'
  }).replace(/\./g, '');
  if (sameDay) {
    const endTime = end.toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires'
    });
    return `${fmt(start)} → ${endTime}`;
  }
  return `${fmt(start)} → ${fmt(end)}`;
}

// ─── Sedes section ───────────────────────────────────────────────────────────

const UPSELL_MAIL = 'info@didigitalstudio.com';
const UPSELL_WHATSAPP = '5491169459990';

function SedesSection({
  shop, userShops, onToast
}: {
  shop: Shop;
  userShops: Shop[];
  onToast: (t: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ name: string; slug: string; address: string; phone: string } | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const isPro = (shop.plan || 'starter') === 'pro';
  const canAdd = isPro || userShops.length === 0;

  const switchTo = (id: string) => {
    if (id === shop.id) return;
    start(async () => {
      const r = await switchShop(id);
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else window.location.reload();
    });
  };

  const save = () => {
    if (!draft) return;
    start(async () => {
      const r = await addShop({
        name: draft.name,
        slug: draft.slug,
        address: draft.address,
        phone: draft.phone
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else {
        onToast({ tone: 'success', text: 'Sede creada y activa.' });
        setDraft(null);
        // Al crearse, el trigger cambia profile.shop_id al nuevo shop → refresh.
        window.location.reload();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">PLAN</div>
            <div className="text-[14px] font-semibold text-bg mt-0.5">
              {isPro ? 'Pro · sedes ilimitadas' : 'Starter · 1 sede'}
            </div>
          </div>
          {!isPro && (
            <a
              href={`mailto:${UPSELL_MAIL}?subject=${encodeURIComponent('Pasar a Plan Pro')}`}
              className="text-[12px] px-3 py-2 rounded-m bg-accent text-white font-semibold hover:opacity-90 transition">
              Pasar a Pro
            </a>
          )}
        </div>
      </div>

      {userShops.length === 0 && (
        <div className="text-[13px] text-dark-muted bg-dark-card border border-dark-line rounded-xl px-4 py-3">
          Todavía no tenés sedes registradas.
        </div>
      )}

      {userShops.map(s => {
        const isCurrent = s.id === shop.id;
        return (
          <div
            key={s.id}
            className={`bg-dark-card border rounded-xl px-4 py-3 flex items-center gap-3
              ${isCurrent ? 'border-accent/60' : 'border-dark-line'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-bg truncate">{s.name}</span>
                {isCurrent && (
                  <span className="font-mono text-[9px] tracking-[2px] text-accent uppercase">Actual</span>
                )}
                {!s.is_active && (
                  <span className="font-mono text-[9px] tracking-[2px] text-dark-muted uppercase">Pendiente</span>
                )}
              </div>
              <div className="text-[11px] text-dark-muted mt-0.5 font-mono truncate">/{s.slug}</div>
            </div>
            {!isCurrent && (
              <button
                type="button"
                onClick={() => switchTo(s.id)}
                disabled={pending}
                className="text-[11px] px-2.5 py-1.5 rounded-xs border border-dark-line text-bg hover:border-bg/30 transition disabled:opacity-50">
                Cambiar a esta
              </button>
            )}
          </div>
        );
      })}

      {!draft && canAdd && isPro && (
        <button
          type="button"
          onClick={() => setDraft({ name: '', slug: '', address: '', phone: '' })}
          className="mt-1 rounded-xl border border-dashed border-dark-line px-4 py-3 text-[13px] text-dark-muted flex items-center justify-center gap-2 hover:border-bg/30 hover:text-bg transition">
          <Icon name="plus" size={16} /> Agregar sede
        </button>
      )}

      {!isPro && userShops.length >= 1 && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3.5 text-[13px] text-bg">
          <div className="font-semibold mb-1">Sedes ilimitadas con Plan Pro</div>
          <div className="text-dark-muted">
            El plan Starter incluye 1 sede. Pasate a Pro para agregar todas las sucursales que necesites.
          </div>
          <div className="flex gap-2 mt-2.5">
            <a
              href={`mailto:${UPSELL_MAIL}?subject=${encodeURIComponent('Pasar a Plan Pro')}`}
              className="text-[12px] px-3 py-2 rounded-m bg-accent text-white font-semibold hover:opacity-90 transition">
              Escribirnos por mail
            </a>
            <a
              href={`https://wa.me/${UPSELL_WHATSAPP}?text=${encodeURIComponent('Hola! Quiero pasar a Plan Pro en TurnosBarbería.')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] px-3 py-2 rounded-m border border-dark-line text-bg hover:border-bg/30 transition">
              WhatsApp
            </a>
          </div>
        </div>
      )}

      {draft && (
        <div className="bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
          <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">NUEVA SEDE</div>
          <Field label="Nombre">
            <input
              value={draft.name}
              onChange={e => {
                const name = e.target.value;
                setDraft(d => d && ({
                  ...d,
                  name,
                  slug: slugTouched ? d.slug : slugify(name)
                }));
              }}
              className="bg-transparent text-bg w-full outline-none text-[15px]"
              placeholder="Barbería Palermo" />
          </Field>
          <Field label="Slug (URL pública)">
            <div className="flex items-center gap-1">
              <span className="text-dark-muted font-mono text-[13px]">/</span>
              <input
                value={draft.slug}
                onChange={e => {
                  setSlugTouched(true);
                  setDraft(d => d && ({ ...d, slug: e.target.value.toLowerCase() }));
                }}
                className="bg-transparent text-bg w-full outline-none font-mono text-[14px]"
                placeholder="barberia-palermo" />
            </div>
          </Field>
          <Field label="Dirección (opcional)">
            <input
              value={draft.address}
              onChange={e => setDraft(d => d && ({ ...d, address: e.target.value }))}
              className="bg-transparent text-bg w-full outline-none text-[14px]"
              placeholder="Av. Santa Fe 3200, CABA" />
          </Field>
          <Field label="Teléfono (opcional)">
            <input
              value={draft.phone}
              onChange={e => setDraft(d => d && ({ ...d, phone: e.target.value }))}
              className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
              placeholder="+54 9 11 5823 4412" />
          </Field>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={save}
              disabled={pending || !draft.name.trim() || !draft.slug.trim()}
              className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
              {pending ? 'Creando…' : 'Crear sede'}
            </button>
            <button
              type="button"
              onClick={() => { setDraft(null); setSlugTouched(false); }}
              className="px-4 py-2.5 rounded-m border border-dark-line text-bg text-[13px] hover:border-bg/30 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pagos section (Mercado Pago) ────────────────────────────────────────────

function PagosSection({
  settings, onToast
}: {
  settings: ShopPaymentSettings | null;
  onToast: (t: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [pending, start] = useTransition();
  const [accessToken, setAccessToken] = useState(settings?.mp_access_token || '');
  const [publicKey, setPublicKey] = useState(settings?.mp_public_key || '');
  const [isActive, setIsActive] = useState(Boolean(settings?.is_active));
  const [showToken, setShowToken] = useState(false);

  const save = () => {
    start(async () => {
      const r = await upsertShopPaymentSettings({
        mp_access_token: accessToken.trim() || '',
        mp_public_key: publicKey.trim() || '',
        is_active: isActive
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else onToast({ tone: 'success', text: 'Configuración de pagos guardada' });
    });
  };

  const toggleActive = () => {
    if (!accessToken.trim() && !isActive) {
      onToast({ tone: 'error', text: 'Cargá primero el access token de Mercado Pago' });
      return;
    }
    setIsActive(v => !v);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">MERCADO PAGO</div>
            <div className="text-[14px] font-semibold text-bg mt-0.5">
              {isActive ? 'Activo · cobrás señas al reservar' : 'Inactivo · no se cobran señas'}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleActive}
            className={`text-[11px] px-3 py-2 rounded-m font-semibold transition ${isActive ? 'bg-bg text-ink' : 'bg-accent text-white'}`}>
            {isActive ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
        <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">CREDENCIALES</div>
        <div className="text-[12px] text-dark-muted leading-relaxed">
          Pegá las credenciales de <span className="text-bg">producción</span> de tu cuenta de Mercado Pago.
          Las encontrás en <span className="font-mono text-bg">mercadopago.com.ar → Tu negocio → Configuración → Credenciales</span>.
          Las guardamos cifradas y solo las usamos para cobrar a tu nombre.
        </div>

        <Field label="Access token (privado)">
          <div className="flex items-center gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder="APP_USR-..."
              className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="text-[10px] text-dark-muted hover:text-bg transition uppercase tracking-[1px]">
              {showToken ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </Field>

        <Field label="Public key (opcional, para checkout embebido)">
          <input
            value={publicKey}
            onChange={e => setPublicKey(e.target.value)}
            placeholder="APP_USR-..."
            className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
          />
        </Field>

        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
            {pending ? 'Guardando…' : 'Guardar credenciales'}
          </button>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-line rounded-xl p-4 text-[12px] text-dark-muted leading-relaxed">
        <div className="font-semibold text-bg mb-1.5">Cómo funciona</div>
        <ol className="list-decimal pl-4 flex flex-col gap-1">
          <li>Configurá la seña por servicio (en la pestaña <span className="text-bg">Servicios</span>).</li>
          <li>El cliente reserva, paga la seña vía Mercado Pago y el turno queda confirmado.</li>
          <li>Si no paga en 10 min, el slot vuelve a estar libre.</li>
          <li>El día del turno, en Caja figura el saldo restante (precio total menos seña ya cobrada).</li>
          <li>Si el cliente cancela con ≥3 hs de anticipación, le devolvemos todo menos el 20% del precio (seña dura). Después no.</li>
        </ol>
      </div>
    </div>
  );
}

// ─── WhatsApp section (Meta Cloud API) ───────────────────────────────────────

function WhatsappSection({
  settings, onToast
}: {
  settings: ShopWhatsappSettings | null;
  onToast: (t: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [pending, start] = useTransition();
  const [phoneNumberId, setPhoneNumberId] = useState(settings?.phone_number_id || '');
  const [accessToken, setAccessToken] = useState(settings?.access_token || '');
  const [templateName, setTemplateName] = useState(settings?.reminder_template_name || 'appointment_reminder');
  const [templateLanguage, setTemplateLanguage] = useState(settings?.reminder_template_language || 'es_AR');
  const [isActive, setIsActive] = useState(Boolean(settings?.is_active));
  const [showToken, setShowToken] = useState(false);

  const save = () => {
    start(async () => {
      const r = await upsertShopWhatsappSettings({
        phone_number_id: phoneNumberId.trim() || '',
        access_token: accessToken.trim() || '',
        reminder_template_name: templateName.trim(),
        reminder_template_language: templateLanguage.trim(),
        is_active: isActive
      });
      if (r?.error) onToast({ tone: 'error', text: r.error });
      else onToast({ tone: 'success', text: 'Configuración de WhatsApp guardada' });
    });
  };

  const toggleActive = () => {
    if (!accessToken.trim() && !isActive) {
      onToast({ tone: 'error', text: 'Cargá primero el access token y el phone number ID' });
      return;
    }
    if (!phoneNumberId.trim() && !isActive) {
      onToast({ tone: 'error', text: 'Falta el phone number ID' });
      return;
    }
    setIsActive(v => !v);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">WHATSAPP</div>
            <div className="text-[14px] font-semibold text-bg mt-0.5">
              {isActive ? 'Activo · recordatorios automáticos' : 'Inactivo · sin envíos'}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleActive}
            className={`text-[11px] px-3 py-2 rounded-m font-semibold transition ${isActive ? 'bg-bg text-ink' : 'bg-accent text-white'}`}>
            {isActive ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-line rounded-xl p-4 flex flex-col gap-2.5">
        <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">CREDENCIALES</div>
        <div className="text-[12px] text-dark-muted leading-relaxed">
          Las generás en <span className="text-bg">business.facebook.com → WhatsApp → API Setup</span>.
          Necesitás un número verificado con Meta (sin línea celular activa de WhatsApp normal) y un
          access token de tipo <span className="text-bg">System User</span> con permisos
          <span className="font-mono text-bg"> whatsapp_business_messaging</span>.
        </div>

        <Field label="Phone Number ID">
          <input
            value={phoneNumberId}
            onChange={e => setPhoneNumberId(e.target.value)}
            placeholder="123456789012345"
            className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
          />
        </Field>

        <Field label="Access token (System User)">
          <div className="flex items-center gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder="EAA..."
              className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="text-[10px] text-dark-muted hover:text-bg transition uppercase tracking-[1px]">
              {showToken ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Nombre del template">
            <input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="appointment_reminder"
              className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
            />
          </Field>
          <Field label="Idioma del template">
            <input
              value={templateLanguage}
              onChange={e => setTemplateLanguage(e.target.value)}
              placeholder="es_AR"
              className="bg-transparent text-bg w-full outline-none font-mono text-[13px]"
            />
          </Field>
        </div>

        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold disabled:opacity-50 active:scale-[0.97] transition">
            {pending ? 'Guardando…' : 'Guardar credenciales'}
          </button>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-line rounded-xl p-4 text-[12px] text-dark-muted leading-relaxed">
        <div className="font-semibold text-bg mb-1.5">Template necesario en Meta</div>
        <p>Antes de activar, registrá este template en el WhatsApp Manager del cliente:</p>
        <div className="mt-2 p-3 bg-dark border border-dark-line rounded-m font-mono text-[11px] text-bg whitespace-pre-wrap">
{`Nombre: appointment_reminder
Categoría: Utility
Idioma: es_AR
Cuerpo:
Hola {{1}}, te recordamos tu turno mañana a las {{2}} en {{3}} con {{4}}. Si no podés venir, cancelalo desde la app.`}
        </div>
        <p className="mt-2.5 text-[11px]">
          Variables: <span className="text-bg">{`{{1}}`}</span> nombre del cliente · <span className="text-bg">{`{{2}}`}</span> hora · <span className="text-bg">{`{{3}}`}</span> nombre del shop · <span className="text-bg">{`{{4}}`}</span> nombre del barbero.
        </p>
        <p className="mt-2.5 text-[11px]">
          La aprobación de Meta tarda entre 5 minutos y 24 hs. Una vez aprobado, el cron de recordatorios
          (que ya se ejecuta diariamente para email) va a mandar también el WhatsApp.
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bg-dark-card border border-dark-line rounded-xl px-4 py-2.5 block focus-within:border-bg/30 transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-0.5">{label}</span>
      {children}
    </label>
  );
}
