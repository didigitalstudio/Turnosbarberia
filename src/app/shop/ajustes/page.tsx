import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminShop, getUserShops } from '@/lib/shop-context';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { AjustesView } from '@/components/shop/AjustesView';
import { signOut } from '@/app/actions/auth';

export const dynamic = 'force-dynamic';

export default async function AjustesPage() {
  const shop = await getAdminShop();
  if (!shop) redirect('/login?error=no_shop');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/shop/ajustes');

  const admin = createAdminClient();

  const [
    { data: services },
    { data: barbers },
    { data: schedules },
    userShops,
    { data: paymentSettings },
    { data: whatsappSettings },
    { data: scheduleBlocks },
    { data: invoicingSettings }
  ] = await Promise.all([
    supabase.from('services').select('*').eq('shop_id', shop.id).order('created_at'),
    supabase.from('barbers').select('*').eq('shop_id', shop.id).order('created_at'),
    supabase.from('schedules').select('*').eq('shop_id', shop.id),
    getUserShops(user.id),
    admin
      .from('shop_payment_settings')
      .select('mp_access_token, mp_public_key, mp_webhook_secret, is_active')
      .eq('shop_id', shop.id)
      .maybeSingle(),
    admin
      .from('shop_whatsapp_settings')
      .select('phone_number_id, access_token, reminder_template_name, reminder_template_language, is_active')
      .eq('shop_id', shop.id)
      .maybeSingle(),
    admin
      .from('schedule_blocks')
      .select('id, barber_id, starts_at, ends_at, reason')
      .eq('shop_id', shop.id)
      .gte('ends_at', new Date().toISOString())
      .order('starts_at'),
    admin
      .from('shop_invoicing_settings')
      .select('api_key, api_token, user_token, cuit, razon_social, punto_venta, condicion_iva, is_active')
      .eq('shop_id', shop.id)
      .maybeSingle()
  ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const publicUrl = `${siteUrl.replace(/\/$/, '')}/${shop.slug}`;

  return (
    <main className="flex-1 flex flex-col mx-auto w-full max-w-[440px] md:max-w-none md:mx-0">
      <ShopHeader title="Ajustes" />
      <AjustesView
        shop={shop}
        services={(services as any) || []}
        barbers={(barbers as any) || []}
        schedules={(schedules as any) || []}
        publicUrl={publicUrl}
        userShops={userShops}
        paymentSettings={(paymentSettings as any) || null}
        whatsappSettings={(whatsappSettings as any) || null}
        scheduleBlocks={(scheduleBlocks as any) || []}
        invoicingSettings={(invoicingSettings as any) || null}
      />
      <form action={signOut} className="px-5 pb-6 md:px-8 md:max-w-3xl md:mx-auto md:w-full">
        <button className="w-full bg-dark-card border border-dark-line text-bg rounded-xl px-4 py-3 text-[13px] font-medium text-left hover:border-bg/30 transition">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
