import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { RegisterForm } from '@/components/client/RegisterForm';
import { MobileShell } from '@/components/shared/MobileShell';
import { sanitizeNext } from '@/lib/safe-next';

export const dynamic = 'force-dynamic';

type RoleParam = 'cliente' | 'duenio' | 'dueno';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;

export default async function RegistroPage({
  searchParams
}: {
  searchParams: { role?: string; shop?: string; next?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Si vino con `?next=` válido (ej: redirigido a registro a mitad de un
    // booking), respetamos ese destino aunque el user ya esté logueado.
    const nextSafe = sanitizeNext(searchParams.next);
    if (nextSafe) redirect(nextSafe);

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, shop_id')
      .eq('id', user.id)
      .maybeSingle<{ is_admin: boolean; shop_id: string | null }>();

    // Dueño con shop → panel.
    if (profile?.is_admin && profile.shop_id) redirect('/shop');
    // Dueño en proceso (sin shop) → onboarding.
    if (profile?.is_admin && !profile.shop_id) redirect('/onboarding');
    // Cliente con shop atado → su barbería.
    if (profile?.shop_id) {
      const admin = createAdminClient();
      const { data: shop } = await admin
        .from('shops')
        .select('slug')
        .eq('id', profile.shop_id)
        .maybeSingle<{ slug: string }>();
      if (shop?.slug) redirect(`/${shop.slug}`);
    }
    // Cliente sin shop atado → landing (igual está logueado, así que /login
    // lo lleva a destino al hacer click).
    redirect('/');
  }

  // Deep link: /registro?role=cliente o ?role=duenio salta el selector.
  const roleParam = (searchParams.role || '').toLowerCase() as RoleParam;
  const initialRole =
    roleParam === 'cliente' ? 'client'
    : (roleParam === 'duenio' || roleParam === 'dueno') ? 'owner'
    : null;

  // ?shop=barberia-xyz: contexto del shop por el que llegó el cliente. Si
  // existe y está activo, mostramos su nombre y atamos al registrar.
  let shopContext: { slug: string; name: string } | null = null;
  const shopParam = (searchParams.shop || '').trim().toLowerCase();
  if (shopParam && SLUG_RE.test(shopParam)) {
    const admin = createAdminClient();
    const { data: shop } = await admin
      .from('shops')
      .select('slug, name, is_active')
      .eq('slug', shopParam)
      .maybeSingle<{ slug: string; name: string; is_active: boolean }>();
    if (shop?.is_active) {
      shopContext = { slug: shop.slug, name: shop.name };
    }
  }

  return (
    <MobileShell>
      <RegisterForm initialRole={initialRole} shopContext={shopContext} />
    </MobileShell>
  );
}
