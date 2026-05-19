import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getShopBySlug, LAST_SHOP_COOKIE } from '@/lib/shop-context';
import { TabBar } from '@/components/client/TabBar';
import { Icon } from '@/components/shared/Icon';
import { Avatar } from '@/components/shared/Avatar';
import { LinkedShopsList } from '@/components/client/LinkedShopsList';
import { signOut } from '@/app/actions/auth';

export const dynamic = 'force-dynamic';

const APP_VERSION = 'v0.1.0';

async function clearLastShopCookie() {
  'use server';
  cookies().delete(LAST_SHOP_COOKIE);
  redirect('/');
}

export default async function PerfilPage({ params }: { params: { slug: string } }) {
  const shop = await getShopBySlug(params.slug);
  if (!shop) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/${params.slug}/perfil`);

  const { data: profile } = await supabase
    .from('profiles').select('name, email, phone, is_admin').eq('id', user.id).maybeSingle<{
      name: string | null; email: string | null; phone: string | null; is_admin: boolean;
    }>();

  // Todas las barberías vinculadas al cliente. Usamos admin client porque
  // necesitamos JOIN con shops.* (RLS de shops sólo devuelve is_active=true,
  // pero acá queremos mostrar incluso si la sede está temporalmente off).
  const admin = createAdminClient();
  const { data: linkedRows } = await admin
    .from('client_shops')
    .select('shop_id, is_primary, shops(id, slug, name)')
    .eq('profile_id', user.id);
  const linkedShops = ((linkedRows as any[]) || [])
    .map(r => ({
      id: r.shops?.id,
      slug: r.shops?.slug,
      name: r.shops?.name,
      is_primary: r.is_primary
    }))
    .filter(s => s.id && s.slug && s.name);

  const initials = (profile?.name || user.email || 'U')
    .split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-5 pt-3 pb-3">
        <h1 className="font-display text-[30px] -tracking-[0.5px]">Perfil</h1>
      </header>

      <div className="flex-1 px-5 pb-6 overflow-auto">
        <div className="bg-card border border-line rounded-2xl p-5 flex items-center gap-4">
          <Avatar name={initials} size={64} hue={55}/>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold truncate">{profile?.name || 'Sin nombre'}</div>
            <div className="text-[12px] text-muted mt-0.5 font-mono truncate">{profile?.email || user.email}</div>
            {profile?.phone && <div className="text-[12px] text-muted mt-0.5 font-mono">{profile.phone}</div>}
          </div>
        </div>

        {/* Barberías vinculadas */}
        <div className="mt-3 bg-card border border-line rounded-2xl p-4">
          <div className="font-mono text-[10px] tracking-[2px] text-muted">
            {linkedShops.length > 1 ? `BARBERÍAS (${linkedShops.length})` : 'BARBERÍA'}
          </div>
          <LinkedShopsList shops={linkedShops} currentSlug={params.slug} />
          <form action={clearLastShopCookie} className="mt-3">
            <button
              type="submit"
              className="w-full bg-transparent border border-line text-ink rounded-xl px-4 py-2.5 text-[13px] font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition">
              <Icon name="search" size={14}/>
              Buscar otra barbería
            </button>
          </form>
        </div>

        {profile?.is_admin && (
          <Link href="/shop" className="mt-3 bg-ink text-bg rounded-2xl p-4 flex items-center justify-between active:scale-[0.99] transition">
            <div>
              <div className="text-[10px] tracking-[2px] uppercase text-dark-muted font-mono">Modo</div>
              <div className="text-[15px] font-semibold mt-1">Panel de la barbería</div>
            </div>
            <Icon name="chevron-right" size={20} color="#F5F3EE"/>
          </Link>
        )}

        <form action={signOut} className="mt-3">
          <button className="w-full min-h-[48px] bg-card border border-line rounded-xl px-4 py-3.5 text-left text-[14px] font-medium flex items-center gap-3 active:scale-[0.99] transition">
            <Icon name="arrow-right" size={16}/> Cerrar sesión
          </button>
        </form>

        <div className="mt-8 text-center font-mono text-[10px] tracking-[2px] text-muted">
          {shop.name.toUpperCase()} · {APP_VERSION}
        </div>
      </div>

      <TabBar slug={params.slug} />
    </main>
  );
}
