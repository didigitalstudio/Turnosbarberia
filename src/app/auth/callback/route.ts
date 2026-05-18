import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { LAST_SHOP_COOKIE } from '@/lib/shop-context';
import { sanitizeNext } from '@/lib/safe-next';

const RESERVED_SLUGS = new Set([
  'api', 'auth', 'shop', 'login', 'registro', 'cuenta',
  'demo', 'desarrollo', 'onboarding', 'admin', 's', 'desa'
]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;

function safeShopSlug(raw: string | undefined): string | null {
  if (!raw) return null;
  if (RESERVED_SLUGS.has(raw)) return null;
  if (!SLUG_RE.test(raw)) return null;
  return raw;
}

// Cuando el caller no pasó `?next=...`, decidimos el destino post-login en
// base al rol del user. El default `/` (landing) es UX malo: el dueño
// abre el magic link y queda en la página de venta en vez de su panel.
async function defaultDestination(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return '/';

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, shop_id')
    .eq('id', user.id)
    .maybeSingle<{ is_admin: boolean; shop_id: string | null }>();

  // Dueño que terminó el wizard → panel admin.
  if (profile?.is_admin && profile.shop_id) return '/shop';
  // Dueño en proceso de registro → wizard.
  if (profile?.is_admin && !profile.shop_id) return '/onboarding';

  // Cliente atado a una barbería → su barbería.
  if (profile?.shop_id) {
    const admin = createAdminClient();
    const { data: shop } = await admin
      .from('shops')
      .select('slug')
      .eq('id', profile.shop_id)
      .maybeSingle<{ slug: string }>();
    if (shop?.slug) return `/${shop.slug}`;
  }

  // Fallback: cookie de última barbería visitada.
  const lastShop = safeShopSlug(cookies().get(LAST_SHOP_COOKIE)?.value);
  if (lastShop) return `/${lastShop}`;

  return '/';
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const explicitNext = sanitizeNext(searchParams.get('next'));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const dest = explicitNext ?? await defaultDestination(supabase);
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
