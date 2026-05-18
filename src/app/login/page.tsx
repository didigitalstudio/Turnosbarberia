import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { LoginForm } from '@/components/client/LoginForm';
import { MobileShell } from '@/components/shared/MobileShell';
import { sanitizeNext } from '@/lib/safe-next';

export const dynamic = 'force-dynamic';

// Si el user entra a /login ya logueado, lo llevamos directo a donde
// corresponde según rol: dueño → panel u onboarding, cliente → su barbería
// si la tiene atada, o landing como fallback. Si vino con `?next=` (ej:
// desde /[slug]/reservar) y el path es seguro, prevalece sobre el default.
export default async function LoginPage({
  searchParams
}: {
  searchParams: { next?: string; shop?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const next = sanitizeNext(searchParams.next);
    if (next) redirect(next);

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, shop_id')
      .eq('id', user.id)
      .maybeSingle<{ is_admin: boolean; shop_id: string | null }>();

    if (profile?.is_admin && profile.shop_id) redirect('/shop');
    if (profile?.is_admin && !profile.shop_id) redirect('/onboarding');

    if (profile?.shop_id) {
      const admin = createAdminClient();
      const { data: shop } = await admin
        .from('shops')
        .select('slug')
        .eq('id', profile.shop_id)
        .maybeSingle<{ slug: string }>();
      if (shop?.slug) redirect(`/${shop.slug}`);
    }
    redirect('/');
  }
  return <MobileShell><LoginForm /></MobileShell>;
}
