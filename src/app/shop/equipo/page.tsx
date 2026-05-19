import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { TeamView } from '@/components/shop/TeamView';

export const dynamic = 'force-dynamic';

export default async function ShopTeamPage() {
  const shop = await getAdminShop();
  if (!shop) redirect('/login?error=no_shop');

  const supabase = createClient();
  const startOfWeek = new Date();
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - ((day + 6) % 7)); // Monday
  startOfWeek.setHours(0,0,0,0);
  const endOfWeek = new Date(startOfWeek.getTime() + 7 * 86400000);

  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today.getTime() + 86400000);

  // Mes corriente (calendario, hora local del runtime). Para el cálculo de
  // comisiones tomamos solo turnos COMPLETADOS — los confirmados no son
  // ingreso real todavía. Los cancelados / no_show los descartamos.
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const [{ data: barbers }, { data: weekAppts }, { data: schedules }, { data: monthAppts }] = await Promise.all([
    supabase.from('barbers').select('*').eq('shop_id', shop.id).eq('is_active', true),
    supabase
      .from('appointments')
      .select('id, barber_id, starts_at, status')
      .eq('shop_id', shop.id)
      .gte('starts_at', startOfWeek.toISOString())
      .lt('starts_at', endOfWeek.toISOString())
      .not('status', 'in', '("cancelled","expired","pending_payment")'),
    supabase.from('schedules').select('*').eq('shop_id', shop.id),
    supabase
      .from('appointments')
      .select('id, barber_id, status, services(name, price)')
      .eq('shop_id', shop.id)
      .in('status', ['completed', 'no_show'])
      .gte('starts_at', startOfMonth.toISOString())
      .lt('starts_at', startOfNextMonth.toISOString())
  ]);

  // Agrega por barbero: cortes completados, revenue, no-shows y servicio más pedido.
  const monthByBarber = new Map<string, { count: number; revenue: number; noShow: number; svcCount: Record<string, number> }>();
  for (const row of (monthAppts as any[]) || []) {
    const acc = monthByBarber.get(row.barber_id) || { count: 0, revenue: 0, noShow: 0, svcCount: {} };
    if (row.status === 'completed') {
      acc.count += 1;
      acc.revenue += Number(row.services?.price || 0);
      const svcName: string = row.services?.name || 'Otro';
      acc.svcCount[svcName] = (acc.svcCount[svcName] || 0) + 1;
    } else if (row.status === 'no_show') {
      acc.noShow += 1;
    }
    monthByBarber.set(row.barber_id, acc);
  }
  const monthStats = Object.fromEntries(
    Array.from(monthByBarber.entries()).map(([id, d]) => {
      const topService = Object.entries(d.svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const totalTracked = d.count + d.noShow;
      const showPct = totalTracked > 0 ? Math.round((d.count / totalTracked) * 100) : null;
      return [id, { count: d.count, revenue: d.revenue, topService, showPct }];
    })
  );

  return (
    <main className="flex-1 flex flex-col mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Equipo" />
      <TeamView
        barbers={barbers || []}
        weekAppts={(weekAppts as any) || []}
        schedules={schedules || []}
        startOfWeek={startOfWeek.toISOString()}
        todayISO={today.toISOString()}
        tomorrowISO={tomorrow.toISOString()}
        monthStats={monthStats}
      />
    </main>
  );
}
