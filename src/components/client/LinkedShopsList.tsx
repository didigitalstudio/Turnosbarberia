'use client';
import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shared/Icon';
import { setPrimaryClientShop } from '@/app/actions/client-shops';

type LinkedShop = {
  id: string;
  slug: string;
  name: string;
  is_primary: boolean;
};

export function LinkedShopsList({ shops, currentSlug }: { shops: LinkedShop[]; currentSlug: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const makePrimary = (shopId: string) => start(async () => {
    const r = await setPrimaryClientShop({ shopId });
    if (!r?.error) router.refresh();
  });

  if (shops.length === 0) return null;
  if (shops.length === 1) {
    const s = shops[0];
    return (
      <div className="mt-1.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-m bg-bg grid place-items-center flex-shrink-0">
          <Icon name="scissors" size={16}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold truncate">{s.name}</div>
          <div className="text-[11px] text-muted font-mono truncate">/{s.slug}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {shops.map(s => {
        const isCurrent = s.slug === currentSlug;
        return (
          <div key={s.id} className={`flex items-center gap-3 px-2 py-2 rounded-m border ${isCurrent ? 'border-ink/30 bg-bg' : 'border-line'}`}>
            <div className="w-9 h-9 rounded-m bg-bg grid place-items-center flex-shrink-0">
              <Icon name="scissors" size={14}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                {s.name}
                {s.is_primary && (
                  <span className="font-mono text-[9px] tracking-[1.5px] text-accent uppercase">Primaria</span>
                )}
              </div>
              <div className="text-[11px] text-muted font-mono truncate">/{s.slug}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {!isCurrent && (
                <Link
                  href={`/${s.slug}`}
                  className="text-[11px] px-2 py-1 rounded-xs border border-line text-ink hover:border-ink/40 transition">
                  Abrir
                </Link>
              )}
              {!s.is_primary && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => makePrimary(s.id)}
                  className="text-[11px] px-2 py-1 rounded-xs border border-line text-muted hover:text-ink hover:border-ink/40 transition disabled:opacity-50">
                  Primaria
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
