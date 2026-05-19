import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminShop, getUserShops } from '@/lib/shop-context';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { AgendaView } from '@/components/shop/AgendaView';
import { ShopActivationChecklist } from '@/components/shop/ShopActivationChecklist';
import { DayOverview } from '@/components/shop/DayOverview';

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
  const apptSelect = 'id, starts_at, ends_at, customer_name, status, payment_status, payment_amount, services(name, duration_mins, price), barbers(id, name, initials, hue)';

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
      .eq('shop_id', shop.id),
    // KPIs del día para el DayOverview: traemos los amounts (no count) para
    // sumarlos client-side. Cantidad de filas chica → no vale la pena un RPC.
    supabase
      .from('sales')
      .select('amount')
      .eq('shop_id', shop.id)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString()),
    supabase
      .from('expenses')
      .select('amount')
      .eq('shop_id', shop.id)
      .gte('paid_at', dayStart.toISOString())
      .lt('paid_at', dayEnd.toISOString())
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
  const [{ data: appts }, { data: barbers }, { data: schedules }, { count: totalAppts }, { count: totalSales }, { data: todaySales }, { data: todayExpenses }] = results;
  // El query de semana, si existe, queda al final (índice 7 con los KPIs nuevos).
  const weekAppts = view === 'week' ? (results[7]?.data || []) : [];

  const appointments = (appts as any) || [];

  const incomeToday = ((todaySales as any[]) || []).reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const expensesToday = ((todayExpenses as any[]) || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const workingDays: number[] = Array.from(new Set(
    (schedules || [])
      .filter((s: any) => s.is_working)
      .map((s: any) => Number(s.day_of_week))
  )).sort() as number[];

  const zeroState = (totalAppts || 0) === 0 && (totalSales || 0) === 0;

  const userShops = user ? await getUserShops(user.id) : [];

  // Pre-fetch del estado de configuración para el checklist. Se queda con
  // counts/flags livianos — no tiramos abajo el dashboard si alguna query falla.
  let checklistState = {
    servicesCount: 0,
    barbersCount: (barbers || []).length,
    schedulesCount: ((schedules as any[]) || []).filter(s => s.is_working).length,
    mpActive: false,
    waActive: false
  };
  // Productos con stock crítico (≤3): si hay, mostramos banner arriba de la
  // agenda. Best-effort; si la query falla no rompe el dashboard.
  let criticalStockCount = 0;
  try {
    const admin = createAdminClient();
    const [svcCount, mp, wa, criticalProducts] = await Promise.all([
      supabase.from('services').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true),
      admin.from('shop_payment_settings').select('is_active').eq('shop_id', shop.id).maybeSingle<{ is_active: boolean }>(),
      admin.from('shop_whatsapp_settings').select('is_active').eq('shop_id', shop.id).maybeSingle<{ is_active: boolean }>(),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true).lte('stock', 3)
    ]);
    checklistState = {
      servicesCount: svcCount.count || 0,
      barbersCount: (barbers || []).length,
      schedulesCount: ((schedules as any[]) || []).filter(s => s.is_working).length,
      mpActive: Boolean(mp.data?.is_active),
      waActive: Boolean(wa.data?.is_active)
    };
    criticalStockCount = criticalProducts.count || 0;
  } catch { /* checklist es best-effort, no rompe la página */ }

  return (
    <main className="flex-1 flex flex-col min-w-0 mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Agenda" />
      {zeroState ? (
        <ShopActivationChecklist
          shopName={shop.name}
          slug={shop.slug}
          state={checklistState}
        />
      ) : (
        <>
          {/* Banner de stock crítico (≤3 unidades): visible solo si hay
              productos en estado crítico — no quema espacio si no aplica. */}
          {criticalStockCount > 0 && (
            <a
              href="/shop/stock"
              className="mx-5 md:mx-8 mt-2 bg-accent/15 border-2 border-accent rounded-xl px-4 py-2.5 flex items-center gap-2 hover:bg-accent/25 transition">
              <span className="text-[16px]">⚠️</span>
              <span className="text-[12px] text-bg font-medium">
                {criticalStockCount} producto{criticalStockCount === 1 ? '' : 's'} con stock crítico (≤3 unidades).
                <span className="text-accent ml-1">Revisar stock →</span>
              </span>
            </a>
          )}
          {/* Tira de KPIs del día, solo en vista día (en semana no aplica). */}
          {view === 'day' && (
            <DayOverview
              appointments={appointments}
              totalIncomeToday={incomeToday}
              totalExpensesToday={expensesToday}
            />
          )}
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
        </>
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
