import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getShopBySlug } from '@/lib/shop-context';
import { Icon } from '@/components/shared/Icon';
import { Avatar } from '@/components/shared/Avatar';
import { Stripe } from '@/components/shared/Stripe';
import { TabBar } from '@/components/client/TabBar';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ShopHomePage({ params }: { params: { slug: string } }) {
  const shop = await getShopBySlug(params.slug);
  if (!shop) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: services }, { data: barbers }, { data: nextAppt }] = await Promise.all([
    user
      ? supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('services').select('*').eq('shop_id', shop.id).eq('is_active', true).order('price'),
    supabase.from('barbers').select('*').eq('shop_id', shop.id).eq('is_active', true).order('created_at'),
    user
      ? supabase
          .from('appointments')
          .select('id, starts_at, ends_at, customer_name, services(name, duration_mins, price), barbers(name, initials, hue)')
          .eq('shop_id', shop.id)
          .eq('profile_id', user.id)
          .not('status', 'in', '("cancelled","expired")')
          .gte('starts_at', new Date().toISOString())
          .order('starts_at')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const greetingName = (profile as { name?: string } | null)?.name?.split(' ')[0] || 'Hola';
  const next = nextAppt as any;
  const slug = params.slug;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-5 md:px-8 pt-3 md:pt-6 pb-3 flex items-center justify-between max-w-5xl w-full mx-auto">
        <div>
          <div className="text-xs text-muted">Hola,</div>
          <div className="text-xl md:text-2xl font-semibold -tracking-[0.3px]">{greetingName}</div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 md:px-8 pb-6 max-w-5xl w-full mx-auto md:grid md:grid-cols-[1.1fr_1fr] md:gap-8">
        <div>
        {/* Hero / next appointment */}
        {next ? (
          <div className="bg-ink text-bg rounded-3xl px-5 py-5 mt-1 relative overflow-hidden">
            <Stripe className="absolute top-0 left-0 right-0" />
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted mt-2">TU PRÓXIMO TURNO</div>
            <div className="flex items-baseline gap-2.5 mt-2.5">
              <div className="font-display text-[44px] leading-none">
                {new Date(next.starts_at).toLocaleDateString('es-AR', { weekday:'short', day:'numeric', timeZone:'America/Argentina/Buenos_Aires' }).replace('.', '')}
              </div>
              <div className="font-display text-[30px] italic text-accent">
                {new Date(next.starts_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'America/Argentina/Buenos_Aires' })}
              </div>
            </div>
            <div className="flex items-center gap-2.5 mt-3.5">
              <Avatar name={next.barbers?.initials || '??'} size={28} hue={next.barbers?.hue || 55} dark/>
              <div>
                <div className="text-[13px] font-medium">{next.services?.name} · {next.barbers?.name}</div>
                <div className="text-[11px] text-dark-muted mt-0.5">{next.services?.duration_mins} min · {money(Number(next.services?.price || 0))}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Link href={`/${slug}/mis-turnos`} className="flex-1 bg-transparent text-bg border border-dark-line px-3 py-2.5 rounded-m text-[13px] font-medium text-center active:scale-[0.98] transition">Reprogramar</Link>
              <Link href={`/${slug}/mis-turnos`} className="flex-1 bg-bg text-ink px-3 py-2.5 rounded-m text-[13px] font-semibold text-center active:scale-[0.98] transition">Ver detalles</Link>
            </div>
          </div>
        ) : (
          <div className="bg-ink text-bg rounded-3xl px-5 py-6 mt-1 relative overflow-hidden">
            <Stripe className="absolute top-0 left-0 right-0" />
            <div className="font-mono text-[10px] tracking-[2px] text-dark-muted mt-2">SIN TURNOS PRÓXIMOS</div>
            <div className="font-display text-[28px] leading-tight mt-2">Reservá tu próximo corte en {shop.name}</div>
            <div className="text-[12px] text-dark-muted mt-2 max-w-[260px]">Te lleva 30 segundos. Elegís servicio, barbero y listo.</div>
          </div>
        )}

        <Link
          href={`/${slug}/reservar`}
          className="mt-3.5 w-full bg-accent text-white border-0 px-4 py-4 rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2.5 active:scale-[0.98] transition"
        >
          <Icon name="plus" size={18}/> Reservar nuevo turno
        </Link>

        {!user && (
          <Link
            href={`/registro?role=cliente&shop=${slug}`}
            className="mt-2.5 w-full bg-card border border-line text-ink px-4 py-3 rounded-xl text-[13px] font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition"
          >
            <Icon name="user" size={14}/> Crear cuenta para guardar tu historial
          </Link>
        )}
        </div>

        <div>
        {/* Services */}
        <div className="mt-6 md:mt-0 flex items-baseline justify-between">
          <h2 className="font-display text-[22px] -tracking-[0.3px]">Servicios</h2>
          <Link href={`/${slug}/reservar`} className="text-xs text-muted active:opacity-60 transition">Ver todos</Link>
        </div>
        <div className="flex flex-col gap-2 mt-3">
          {(services || []).slice(0,4).map(s => (
            <Link
              key={s.id}
              href={`/${slug}/reservar?service=${s.id}`}
              className="bg-card border border-line rounded-xl px-4 py-3 flex items-center justify-between active:scale-[0.99] active:bg-bg transition"
            >
              <div className="flex items-center gap-3">
                <div className="w-[34px] h-[34px] rounded-m bg-bg grid place-items-center"><Icon name="scissors" size={16}/></div>
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted">{s.duration_mins} min</div>
                </div>
              </div>
              <div className="font-mono text-[13px] font-medium">{money(Number(s.price))}</div>
            </Link>
          ))}
        </div>

        {/* Barbers */}
        <div className="mt-6 flex items-baseline justify-between">
          <h2 className="font-display text-[22px] -tracking-[0.3px]">Nuestro equipo</h2>
        </div>
        <div className="flex gap-2.5 mt-3 overflow-x-auto no-scrollbar -mx-5 px-5 md:mx-0 md:px-0 md:grid md:grid-cols-2 md:gap-2.5 md:overflow-visible pb-1">
          {(barbers || []).map(b => (
            <Link
              key={b.id}
              href={`/${slug}/reservar?barber=${b.id}`}
              className="min-w-[132px] md:min-w-0 bg-card border border-line rounded-xl p-3.5 text-center active:scale-[0.98] transition"
            >
              <div className="flex justify-center"><Avatar name={b.initials} size={48} hue={b.hue}/></div>
              <div className="text-sm font-medium mt-2.5">{b.name}</div>
              <div className="text-[10px] text-muted mt-0.5">{b.role}</div>
            </Link>
          ))}
        </div>
        </div>
      </div>

      <TabBar slug={slug} />
    </main>
  );
}
