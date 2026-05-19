'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/shared/Icon';

export type ChecklistState = {
  servicesCount: number;
  barbersCount: number;
  schedulesCount: number;
  mpActive: boolean;
  waActive: boolean;
};

type Item = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  required: boolean;
};

export function ShopActivationChecklist({
  shopName, slug, state
}: {
  shopName: string;
  slug: string;
  state: ChecklistState;
}) {
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState(`/${slug}`);
  // 'shared' lo trackeamos en localStorage porque no hay forma simple de
  // saber server-side si el dueño ya copió/compartió el link. Es el único
  // ítem que no se chequea contra la DB.
  const sharedKey = `share_done_${slug}`;
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPublicUrl(`${window.location.origin}/${slug}`);
      try { setShared(window.localStorage.getItem(sharedKey) === '1'); } catch { /* noop */ }
    }
  }, [slug, sharedKey]);

  const markShared = () => {
    setShared(true);
    try { window.localStorage.setItem(sharedKey, '1'); } catch { /* noop */ }
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(publicUrl);
    } catch { /* noop */ }
    markShared();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const items: Item[] = [
    {
      id: 'services',
      title: 'Cargá tus servicios y precios',
      description: 'Al menos 1 servicio activo para que tus clientes puedan reservar.',
      done: state.servicesCount > 0,
      href: '/shop/ajustes?tab=services',
      cta: 'Configurar',
      required: true
    },
    {
      id: 'barbers',
      title: 'Sumá al menos un barbero',
      description: 'El equipo que va a atender los turnos.',
      done: state.barbersCount > 0,
      href: '/shop/ajustes?tab=team',
      cta: 'Agregar',
      required: true
    },
    {
      id: 'schedules',
      title: 'Definí los horarios de tu equipo',
      description: 'Sin horarios no aparecen slots disponibles para reservar.',
      done: state.schedulesCount > 0,
      href: '/shop/ajustes?tab=hours',
      cta: 'Configurar',
      required: true
    },
    {
      id: 'shared',
      title: 'Compartí tu link público',
      description: 'Pegalo en Instagram, WhatsApp o donde quieras.',
      done: shared,
      href: '#',
      cta: copied ? 'Copiado' : 'Copiar',
      required: true
    },
    {
      id: 'mp',
      title: 'Cobro anticipado con Mercado Pago',
      description: 'Reducí el no-show cobrando una seña al reservar. La plata va a tu cuenta MP.',
      done: state.mpActive,
      href: '/shop/ajustes?tab=pagos',
      cta: 'Activar',
      required: false
    },
    {
      id: 'wa',
      title: 'Recordatorios por WhatsApp',
      description: 'Mensaje automático el día previo al turno.',
      done: state.waActive,
      href: '/shop/ajustes?tab=whatsapp',
      cta: 'Activar',
      required: false
    }
  ];

  const requiredItems = items.filter(i => i.required);
  const optionalItems = items.filter(i => !i.required);
  const requiredDone = requiredItems.filter(i => i.done).length;
  const requiredAll = requiredItems.length;
  const requiredProgress = requiredAll > 0 ? requiredDone / requiredAll : 1;
  const allDone = requiredItems.every(i => i.done);

  // Si todo lo obligatorio está hecho, no tiene sentido seguir mostrando el
  // checklist en el dashboard — devolvemos null y la página renderiza
  // directamente la agenda en vez del onboarding.
  if (allDone) return null;

  const shareText = `Reservá tu turno en ${shopName}: ${publicUrl}`;

  return (
    <div className="flex-1 overflow-auto px-5 md:px-8 pt-4 pb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[2px] bg-accent text-white">
          {requiredDone}/{requiredAll}
        </span>
        <span className="text-[11px] text-dark-muted">
          Pasos para tener tu barbería lista
        </span>
      </div>

      {/* Progressbar de items requeridos */}
      <div className="h-1 bg-dark-card rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${Math.round(requiredProgress * 100)}%` }}
        />
      </div>

      {/* Link público — banner destacado */}
      <div className="bg-dark-card border border-dark-line rounded-2xl px-4 py-4">
        <div className="font-mono text-[10px] tracking-[2px] text-dark-muted">TU LINK PÚBLICO</div>
        <div className="font-mono text-[13px] text-bg mt-1 break-all">{publicUrl}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className="bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold flex items-center gap-2 active:scale-[0.98] transition">
            <Icon name="check" size={14} color="#fff"/>
            {copied ? '¡Copiado!' : 'Copiar link'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            onClick={markShared}
            className="bg-bg text-ink px-4 py-2.5 rounded-m text-[13px] font-semibold active:scale-[0.98] transition">
            WhatsApp
          </a>
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noreferrer"
            onClick={markShared}
            className="bg-transparent text-bg border border-dark-line px-4 py-2.5 rounded-m text-[13px] font-semibold active:scale-[0.98] transition">
            Instagram Story
          </a>
        </div>
      </div>

      {/* Required */}
      <div className="mt-5 font-mono text-[10px] tracking-[2px] text-dark-muted">PASOS OBLIGATORIOS</div>
      <ul className="mt-2 flex flex-col gap-2">
        {requiredItems.map(item => (
          <ChecklistRow
            key={item.id}
            done={item.done}
            title={item.title}
            description={item.description}
            cta={item.cta}
            href={item.href}
            onClick={item.id === 'shared' ? copy : undefined}
            required
          />
        ))}
      </ul>

      {/* Opcional */}
      <div className="mt-5 font-mono text-[10px] tracking-[2px] text-dark-muted">RECOMENDADOS · OPCIONAL</div>
      <ul className="mt-2 flex flex-col gap-2">
        {optionalItems.map(item => (
          <ChecklistRow
            key={item.id}
            done={item.done}
            title={item.title}
            description={item.description}
            cta={item.cta}
            href={item.href}
          />
        ))}
      </ul>
    </div>
  );
}

function ChecklistRow({
  done, title, description, cta, href, onClick, required
}: {
  done: boolean;
  title: string;
  description: string;
  cta: string;
  href: string;
  onClick?: () => void | Promise<void>;
  required?: boolean;
}) {
  return (
    <li className={`bg-dark-card border rounded-xl px-3.5 py-3 flex items-start gap-3 ${required ? 'border-dark-line' : 'border-dark-line/60 opacity-90'}`}>
      <div
        aria-hidden="true"
        className={`mt-0.5 w-5 h-5 rounded-[5px] border flex-shrink-0 grid place-items-center transition
          ${done ? 'bg-accent border-accent' : 'border-dark-line bg-transparent'}`}
      >
        {done && <Icon name="check" size={12} color="#fff"/>}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold ${done ? 'text-dark-muted line-through' : 'text-bg'}`}>{title}</div>
        <div className="text-[11px] text-dark-muted mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="text-[11px] text-accent underline underline-offset-4 py-2 px-1">
            {cta}
          </button>
        ) : (
          <Link
            href={href}
            className="text-[11px] text-accent underline underline-offset-4 py-2 px-1">
            {cta}
          </Link>
        )}
      </div>
    </li>
  );
}
