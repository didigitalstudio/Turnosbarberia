import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { NewWalkInForm } from '@/components/shop/NewWalkInForm';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AT_RE   = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewWalkInPage({
  searchParams
}: {
  searchParams: { d?: string; at?: string; barber?: string };
}) {
  const shop = await getAdminShop();
  if (!shop) redirect('/login?error=no_shop');
  const sb = createClient();
  const [{ data: services }, { data: barbers }] = await Promise.all([
    sb.from('services').select('id, name, duration_mins, price').eq('shop_id', shop.id).eq('is_active', true).order('name'),
    sb.from('barbers').select('id, name').eq('shop_id', shop.id).eq('is_active', true).order('name')
  ]);

  const defaultDate    = DATE_RE.test(searchParams.d   ?? '') ? searchParams.d                      : undefined;
  const defaultTime    = AT_RE.test(searchParams.at    ?? '') ? searchParams.at!.slice(11, 16)       : undefined;
  const defaultBarberId = UUID_RE.test(searchParams.barber ?? '') ? searchParams.barber             : undefined;

  return (
    <main className="flex-1 flex flex-col mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Nuevo turno (walk-in)" />
      <NewWalkInForm
        services={(services as any) || []}
        barbers={(barbers as any) || []}
        defaultDate={defaultDate}
        defaultTime={defaultTime}
        defaultBarberId={defaultBarberId}
      />
    </main>
  );
}
