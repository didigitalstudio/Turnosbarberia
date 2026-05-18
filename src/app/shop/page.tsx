import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminShop, getUserShops } from '@/lib/shop-context';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { AgendaView } from '@/components/shop/AgendaView';
import { ShopActivationChecklist } from '@/components/shop/ShopActivationChecklist';

export const dynamic = 'force-dynamic';

export default async function ShopAgendaPage({ searchParams }: { searchParams: { d?: string; view?: string } }) {
  const shop = await getAdminShop();
  if (!shop) redirect('/login?error=no_shop');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const dayISO = searchParams.d || todayISO();
  const view: 'day' | 'week' = searchParams.view === 'week' ? 'week' : 'day';

  // Vista día: rango de 1 día. Vista semana: rango [lunes, lunes+7).
  const dayStart = new Date(dayISO + 'T00:00:00-03:00');
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const weekStart = view === 'week' ? mondayOf(dayISO) : dayISO;
  const weekStartDate = new Date(weekStart + 'T00:00:00-03:00');
  const weekEndDate = new Date(weekStartDate.getTime() + 7 * 86400000);

  // Query principal: siempre cargamos el día actual (para stats). Si es vista semana,
  // además cargamos la semana entera.
  const apptSelect = 'id, starts_at, ends_at, customer_name, status, services(name, duration_mins, price), barbers(id, name, initials, hue)';

  const queries: any[] = [
    supabase
      .from('appointments')
      .select(apptSelect)
      .eq('shop_id', shop.id)
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .not('status', 'in', '("cancelled","expired","pending_payment")')
      .order('starts_at'),
    supabase.from('barbers').select('*').eq('shop_id', shop.id).eq('is_active', true),
    supabase.from('schedules').select('day_of_week, start_time, end_time, is_working').eq('shop_id', shop.id),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id),
    supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
  ];

  if (view === 'week') {
    queries.push(
      supabase
        .from('appointments')
        .select(apptSelect)
        .eq('shop_id', shop.id)
        .gte('starts_at', weekStartDate.toISOString())
        .lt('starts_at', weekEndDate.toISOString())
        .not('status', 'in', '("cancelled","expired","pending_payment")')
        .order('starts_at')
    );
  }

  const results = await Promise.all(queries);
  const [{ data: appts }, { data: barbers }, { data: schedules }, { count: totalAppts }, { count: totalSales }] = results;
  const weekAppts = view === 'week' ? (results[5]?.data || []) : [];

  const appointments = (appts as any) || [];

  const workingDays: number[] = Array.from(new Set(
    (schedules || [])
      .filter((s: any) => s.is_working)
      .map((s: any) => Number(s.day_of_week))
  )).sort() as number[];

  const zeroState = (totalAppts || 0) === 0 && (totalSales || 0) === 0;

  const userShops = user ? await getUserShops(user.id) : [];

  return (
    <main className="flex-1 flex flex-col min-w-0 mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Agenda" />
      {zeroState ? (
        <ShopActivationChecklist shopName={shop.name} slug={shop.slug}/>
      ) : (
        <AgendaView
          appointments={appointments}
          barbers={barbers || []}
          dayISO={dayISO}
          workingDays={workingDays.length > 0 ? workingDays : undefined}
          view={view}
          weekAppointments={weekAppts as any}
          weekStartISO={weekStart}
          schedules={(schedules as any) || []}
          currentShop={{ id: shop.id, name: shop.name, slug: shop.slug, plan: shop.plan }}
          userShops={userShops.map(s => ({ id: s.id, name: s.name, slug: s.slug, plan: s.plan }))}
        />
      )}
    </main>
  );
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(dayISO: string) {
  const d = new Date(dayISO + 'T12:00:00');
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
