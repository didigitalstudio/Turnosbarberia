import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getShopBySlug } from '@/lib/shop-context';
import { TabBar } from '@/components/client/TabBar';
import { MyAppointmentsView } from '@/components/client/MyAppointmentsView';

export const dynamic = 'force-dynamic';

export default async function MisTurnosPage({ params }: { params: { slug: string } }) {
  const shop = await getShopBySlug(params.slug);
  if (!shop) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/${params.slug}/mis-turnos`);

  const nowISO = new Date().toISOString();
  const [{ data: upcoming }, { data: history }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, status, payment_status, payment_amount, payment_expires_at, service_id, services(name, duration_mins, price), barbers(name)')
      .eq('shop_id', shop.id)
      .eq('profile_id', user.id)
      .not('status', 'in', '("cancelled","expired")')
      .gte('starts_at', nowISO)
      .order('starts_at'),
    supabase
      .from('appointments')
      .select('id, starts_at, status, service_id, services(name), barbers(name)')
      .eq('shop_id', shop.id)
      .eq('profile_id', user.id)
      .lt('starts_at', nowISO)
      .order('starts_at', { ascending: false })
      .limit(10)
  ]);

  return (
    <main className="min-h-screen flex flex-col">
      <MyAppointmentsView
        slug={params.slug}
        upcoming={(upcoming as any) || []}
        history={(history as any) || []}
      />
      <TabBar slug={params.slug} />
    </main>
  );
}
