import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';
import { getShopFeatures } from '@/lib/subscriptions';
import { partsInAR, SHOP_OFFSET } from '@/lib/tz';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { CashView } from '@/components/shop/CashView';
import { FeatureGate } from '@/components/ui/feature-gate';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bounds [00:00, 24:00) del día en hora local del shop, expresados en UTC.
function dayBoundsAR(dateStr: string): { startISO: string; endISO: string } {
  const start = new Date(`${dateStr}T00:00:00${SHOP_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export default async function ShopCashPage({
  searchParams
}: {
  searchParams: { date?: string };
}) {
  const shop = await getAdminShop();
  if (!shop) redirect('/login?error=no_shop');

  const features = await getShopFeatures();
  const todayAR = partsInAR(new Date()).date;
  const date = searchParams.date && DATE_RE.test(searchParams.date) ? searchParams.date : todayAR;
  const { startISO, endISO } = dayBoundsAR(date);

  const supabase = createClient();

  const [{ data: sales }, { data: products }, { data: expenses }, { data: appts }] = await Promise.all([
    supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shop.id)
      .gte('created_at', startISO)
      .lt('created_at', endISO)
      .order('created_at', { ascending: false }),
    supabase.from('products').select('*').eq('shop_id', shop.id).eq('is_active', true).order('name'),
    supabase
      .from('expenses').select('*')
      .eq('shop_id', shop.id)
      .gte('paid_at', startISO)
      .lt('paid_at', endISO)
      .order('paid_at', { ascending: false }),
    supabase
      .from('appointments')
      .select('id, customer_name, starts_at, status, services(name, price), barbers(name)')
      .eq('shop_id', shop.id)
      .gte('starts_at', startISO)
      .lt('starts_at', endISO)
      .not('status', 'in', '("cancelled","expired","pending_payment")')
      .order('starts_at')
  ]);

  // IDs de turnos ya cobrados para marcar "already_charged".
  const apptIds = ((appts as any[]) || []).map(a => a.id);
  let chargedSet = new Set<string>();
  if (apptIds.length) {
    const { data: charged } = await supabase
      .from('sales')
      .select('appointment_id')
      .eq('shop_id', shop.id)
      .in('appointment_id', apptIds);
    chargedSet = new Set(((charged as any[]) || []).map(s => s.appointment_id).filter(Boolean));
  }

  const todayAppointments = ((appts as any[]) || []).map(a => ({
    id: a.id,
    customer_name: a.customer_name,
    starts_at: a.starts_at,
    service_name: a.services?.name || null,
    service_price: Number(a.services?.price || 0),
    barber_name: a.barbers?.name || null,
    already_charged: chargedSet.has(a.id)
  }));

  return (
    <main className="flex-1 flex flex-col mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Caja" />
      <FeatureGate enabled={features.caja_plus ?? false} message="La Caja está disponible en el plan Pro">
        <CashView
          sales={(sales as any) || []}
          products={(products as any) || []}
          expenses={(expenses as any) || []}
          todayAppointments={todayAppointments}
          date={date}
          todayDate={todayAR}
        />
      </FeatureGate>
    </main>
  );
}
