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
      .select('id, barber_id, status, services(price)')
      .eq('shop_id', shop.id)
      .eq('status', 'completed')
      .gte('starts_at', startOfMonth.toISOString())
      .lt('starts_at', startOfNextMonth.toISOString())
  ]);

  // Agregamos por barbero: cantidad de cortes y revenue del mes.
  const monthByBarber = new Map<string, { count: number; revenue: number }>();
  for (const row of (monthAppts as any[]) || []) {
    const acc = monthByBarber.get(row.barber_id) || { count: 0, revenue: 0 };
    acc.count += 1;
    acc.revenue += Number(row.services?.price || 0);
    monthByBarber.set(row.barber_id, acc);
  }
  const monthStats = Object.fromEntries(monthByBarber);

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
