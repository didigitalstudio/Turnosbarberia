import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getShopBySlug } from '@/lib/shop-context';
import { Icon } from '@/components/shared/Icon';
import { Stripe } from '@/components/shared/Stripe';
import { ConfirmationActions } from '@/components/client/ConfirmationActions';
import { PayDepositButton } from '@/components/client/PayDepositButton';
import { money } from '@/lib/format';
import { RECENT_BOOKINGS_COOKIE } from '@/lib/booking-cookie';

export const dynamic = 'force-dynamic';

export default async function ConfirmationPage({ params }: { params: { slug: string; id: string } }) {
  const shop = await getShopBySlug(params.slug);
  if (!shop) notFound();

  // Authorization chain:
  // 1. User logueado cuyo profile_id === appointment.profile_id (RLS lo permite).
  // 2. Browser cookie `recent_bookings` contiene este ID (invitado que reservó).
  // 3. Admin del shop (ve todas).
  // Si ninguno, 404.
  const userClient = createClient();
  const { data: { user } } = await userClient.auth.getUser();

  let appt: any = null;
  const baseSelect = 'id, starts_at, ends_at, customer_name, status, payment_status, payment_amount, payment_expires_at, services(name, duration_mins, price), barbers(name)';

  // Trip 1: via RLS (user logueado)
  const { data: viaRls } = await userClient
    .from('appointments')
    .select(baseSelect)
    .eq('id', params.id)
    .eq('shop_id', shop.id)
    .maybeSingle();
  if (viaRls) {
    appt = viaRls;
  } else {
    // Trip 2: cookie whitelist (invitado o user sin profile_id match)
    const recentRaw = cookies().get(RECENT_BOOKINGS_COOKIE)?.value;
    const recentList = (recentRaw || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (recentList.includes(params.id)) {
      const admin = createAdminClient();
      const { data: viaCookie } = await admin
        .from('appointments')
        .select(baseSelect)
        .eq('id', params.id)
        .eq('shop_id', shop.id)
        .maybeSingle();
      if (viaCookie) appt = viaCookie;
    }
  }

  if (!appt) return notFound();
  const a = appt as any;
  const isPendingPayment = a.status === 'pending_payment' && a.payment_status === 'pending';

  const start = new Date(a.starts_at);
  const end = new Date(a.ends_at || new Date(start.getTime() + (a.services?.duration_mins || 30) * 60_000).toISOString());
  const orderNum = String(params.id).slice(-5).toUpperCase();
  const dateLabel = start.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).replace(/\./g, '').toUpperCase();
  const timeLabel = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });

  const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  const mapEmbedUrl = shop.address && googleMapsKey
    ? `https://www.google.com/maps/embed/v1/place?key=${googleMapsKey}&q=${encodeURIComponent(shop.address + ', ' + shop.name)}`
    : null;
  const mapsLinkUrl = shop.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`
    : null;

  return (
    <main className="min-h-screen flex flex-col px-5 md:px-8 pt-5 pb-7 max-w-5xl w-full mx-auto">
      <div className="flex justify-end">
        <Link
          href={`/${params.slug}`}
          className="w-9 h-9 rounded-l bg-card border border-line grid place-items-center active:scale-95 transition"
          aria-label="Cerrar y volver al inicio"
        >
          <Icon name="close" size={18} />
        </Link>
      </div>

      <div className="text-center mt-7">
        <div
          className={`pop-in w-[72px] h-[72px] rounded-full mx-auto grid place-items-center ${isPendingPayment ? 'bg-accent/15 border-2 border-accent' : 'bg-ink'}`}
          aria-hidden="true"
        >
          <Icon
            name={isPendingPayment ? 'clock' : 'check'}
            size={32}
            stroke={2.4}
            color={isPendingPayment ? '#B6754C' : '#B6754C'}
          />
        </div>
        <h1 className="fade-in-up font-display text-[34px] leading-tight mt-5 -tracking-[0.5px]">
          {isPendingPayment ? 'Reservá pagando la seña' : 'Turno confirmado'}
        </h1>
        <p className="fade-in-up text-[13px] text-muted mt-2 max-w-[290px] mx-auto" style={{ animationDelay: '60ms' }}>
          {isPendingPayment
            ? `Tu turno queda reservado por 10 min mientras completás el pago de la seña (${money(Number(a.payment_amount || 0))}).`
            : 'Guardá este ticket. Cancelación gratuita hasta 2 hs antes.'}
        </p>
      </div>

      {isPendingPayment && (
        <div className="mt-5 bg-accent/10 border border-accent/30 rounded-xl px-4 py-3.5 text-[13px] text-ink">
          <div className="font-semibold mb-1">Pago pendiente</div>
          <div className="text-muted text-[12px] leading-relaxed">
            Tocá el botón de abajo para pagar la seña vía Mercado Pago. Si no completás el pago en 10 min,
            el turno se libera automáticamente.
          </div>
          <PayDepositButton
            shopSlug={params.slug}
            appointmentId={a.id}
            amount={Number(a.payment_amount || 0)}
          />
        </div>
      )}

      <article
        className="fade-in-up mt-6 bg-card rounded-2xl border border-line overflow-hidden shadow-card"
        style={{ animationDelay: '120ms' }}
      >
        <Stripe />
        <div className="px-5 py-4">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] tracking-[2px] text-muted">N° {orderNum}</div>
            <div className="font-mono text-[10px] tracking-[2px] text-muted">{dateLabel}</div>
          </div>
          <div className="mt-3 font-display text-[44px] leading-none">{timeLabel}</div>
          <div className="text-[13px] text-muted mt-1.5">Llegá 5 minutos antes</div>

          <div className="border-t border-dashed border-line mt-4 mb-3.5" />

          <div className="flex flex-col gap-2.5">
            <Row icon="scissors" label="Servicio" value={a.services?.name || ''} />
            <Row icon="user" label="Barbero" value={a.barbers?.name || ''} />
            <Row icon="clock" label="Duración" value={`${a.services?.duration_mins || 0} min`} />
            <Row icon="cash" label="Total" value={money(Number(a.services?.price || 0))} />
          </div>
        </div>

        <div className="relative h-[18px] bg-bg">
          <div className="absolute -left-[9px] top-0 bottom-0 w-[18px] rounded-full bg-bg border border-line" />
          <div className="absolute -right-[9px] top-0 bottom-0 w-[18px] rounded-full bg-bg border border-line" />
          <div className="border-t border-dashed border-line absolute left-3 right-3 top-1/2" />
        </div>

        <div className="px-5 py-4 flex items-center gap-3.5">
          <div className="text-[11px] text-muted flex-1">
            {shop.address ? (<>{shop.address}<br /></>) : null}
            {shop.name}
          </div>
          <div
            className="w-14 h-14 rounded-s"
            style={{
              background: '#0E0E0E',
              backgroundImage: `repeating-conic-gradient(#0E0E0E 0 25%, transparent 0 50%)`,
              backgroundSize: '12px 12px'
            }}
            aria-label="Código QR del turno"
            role="img"
          />
        </div>
      </article>

      {/* Mapa o link a maps — solo desktop, debajo del ticket */}
      {mapEmbedUrl ? (
        <div className="hidden md:block mt-5 rounded-2xl overflow-hidden border border-line">
          <iframe
            src={mapEmbedUrl}
            width="100%"
            height="240"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`Mapa de ${shop.name}`}
          />
        </div>
      ) : mapsLinkUrl ? (
        <a
          href={mapsLinkUrl}
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex mt-5 bg-card border border-line rounded-2xl px-4 py-3 items-center gap-3 hover:border-ink/30 transition">
          <Icon name="calendar" size={18} />
          <div className="flex-1">
            <div className="text-[13px] font-medium">Cómo llegar</div>
            <div className="text-[11px] text-muted">{shop.address}</div>
          </div>
          <Icon name="arrow-right" size={14} color="#7A766E" />
        </a>
      ) : null}

      <div className="flex-1" />

      <ConfirmationActions
        shopName={shop.name}
        shopAddress={shop.address}
        startISO={a.starts_at}
        endISO={end.toISOString()}
        service={a.services?.name || 'Turno'}
        barber={a.barbers?.name || 'nuestro equipo'}
        orderNum={orderNum}
      />

      <Link
        href={`/${params.slug}/mis-turnos`}
        className="text-center text-[13px] text-muted underline mt-4 py-2"
      >
        Ver mis turnos
      </Link>
    </main>
  );
}

function Row({ icon, label, value }: { icon: 'scissors' | 'user' | 'clock' | 'cash'; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-s bg-bg grid place-items-center">
        <Icon name={icon} size={14} />
      </div>
      <div className="text-[12px] text-muted flex-1">{label}</div>
      <div className="text-[14px] font-medium">{value}</div>
    </div>
  );
}
