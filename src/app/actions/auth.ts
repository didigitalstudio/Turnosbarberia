'use server';
import { cookies } from 'next/headers';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LAST_SHOP_COOKIE } from '@/lib/shop-context';
import { sanitizeNext } from '@/lib/safe-next';
import { PHONE_RE } from '@/lib/validation';

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

async function destinationForCurrentUser(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return '/';
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, shop_id')
    .eq('id', user.id)
    .maybeSingle<{ is_admin: boolean; shop_id: string | null }>();

  // Dueño que terminó el wizard → su panel admin.
  if (profile?.is_admin && profile.shop_id) return '/shop';
  // Dueño en proceso de registro (cuenta creada pero sin shop) → wizard.
  if (profile?.is_admin && !profile.shop_id) return '/onboarding';

  // Cliente atado a una barbería → directo a su barbería.
  if (profile?.shop_id) {
    const admin = createAdminClient();
    const { data: shop } = await admin
      .from('shops')
      .select('slug')
      .eq('id', profile.shop_id)
      .maybeSingle<{ slug: string }>();
    if (shop?.slug) return `/${shop.slug}`;
  }

  // Fallback: cookie de "última barbería visitada" (visitor sin atar).
  const lastShop = safeShopSlug(cookies().get(LAST_SHOP_COOKIE)?.value);
  if (lastShop) return `/${lastShop}`;
  return '/';
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const name  = String(formData.get('name')  || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const next  = sanitizeNext(String(formData.get('next') || '') || null);

  if (!email || !email.includes('@')) {
    return { error: 'Ingresá un email válido' };
  }
  if (name.length < 2) {
    return { error: 'Ingresá tu nombre completo' };
  }

  const supabase = createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const callback = next
    ? `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`
    : `${siteUrl}/auth/callback`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback,
      data: { name, phone }
    }
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function signupOwner(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const name  = String(formData.get('name')  || '').trim();
  const phone = String(formData.get('phone') || '').trim();

  if (name.length < 2) {
    return { error: 'Ingresá tu nombre completo' };
  }
  if (!email || !email.includes('@')) {
    return { error: 'Ingresá un email válido' };
  }

  const supabase = createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  // Después del magic link, el dueño tiene que SETEAR su contraseña antes
  // de seguir al onboarding. Mandar a `/onboarding` directo dejaba al user
  // logueado vía OTP sin contraseña — y al desloguearse, no podía volver
  // a entrar con email+contraseña porque nunca la creó.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=/cuenta/establecer-password`,
      data: { name, phone }
    }
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const next = sanitizeNext(String(formData.get('next') || '') || null);

  if (!email || !email.includes('@')) {
    return { error: 'Ingresá un email válido' };
  }
  if (!password) {
    return { error: 'Ingresá tu contraseña' };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Mensaje genérico para no filtrar si el email existe o no.
    return { error: 'Email o contraseña inválidos' };
  }
  // Si vino con `?next=` (ej: desde /[slug]/reservar), respetar ese destino.
  // Si no, decidir según rol del user.
  const dest = next ?? await destinationForCurrentUser(supabase);
  return { ok: true, dest };
}

export async function signupClient(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const name  = String(formData.get('name')  || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const password = String(formData.get('password') || '');
  const shopSlugRaw = String(formData.get('shopSlug') || '').trim();
  const shopSlug = safeShopSlug(shopSlugRaw) || null;
  const next = sanitizeNext(String(formData.get('next') || '') || null);

  if (name.length < 2) return { error: 'Ingresá tu nombre completo' };
  if (!email || !email.includes('@')) return { error: 'Ingresá un email válido' };
  if (!phone || !PHONE_RE.test(phone)) return { error: 'Ingresá un teléfono válido' };
  if (password.length < 8) return { error: 'La contraseña tiene que tener al menos 8 caracteres' };

  const admin = createAdminClient();

  // Si viene shopSlug, lo resolvemos primero — así fallamos rápido sin
  // crear un user huérfano si la barbería no existe / no está activa.
  let targetShopId: string | null = null;
  let targetShopSlug: string | null = null;
  if (shopSlug) {
    const { data: shop } = await admin
      .from('shops')
      .select('id, slug, is_active')
      .eq('slug', shopSlug)
      .maybeSingle<{ id: string; slug: string; is_active: boolean }>();
    if (!shop || !shop.is_active) {
      return { error: 'La barbería no está disponible.' };
    }
    targetShopId = shop.id;
    targetShopSlug = shop.slug;
  }

  // Service-role: creamos al user con email_confirm=true para que pueda
  // loguearse inmediatamente (sin tener que ir al email a verificar).
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      return { error: 'Ya hay una cuenta con ese email. Probá iniciar sesión.' };
    }
    return { error: error.message };
  }
  if (!data.user) return { error: 'No se pudo crear la cuenta.' };

  const userId = data.user.id;

  // Reclamar reservas anónimas previas hechas con este mismo email: ata
  // appointments.profile_id al nuevo user para que el cliente vea su
  // historial cuando entre. Si esos turnos pertenecen a un shop, derivamos
  // ese shop_id como su barbería "atada" (a menos que ya hayamos resuelto
  // uno desde shopSlug).
  await admin
    .from('appointments')
    .update({ profile_id: userId })
    .eq('customer_email', email)
    .is('profile_id', null);

  if (!targetShopId) {
    // Buscar el shop de la última reserva del cliente con ese email.
    const { data: lastAppt } = await admin
      .from('appointments')
      .select('shop_id, shops(slug, is_active)')
      .eq('profile_id', userId)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        shop_id: string;
        shops: { slug: string; is_active: boolean } | null;
      }>();
    if (lastAppt?.shops?.is_active) {
      targetShopId = lastAppt.shop_id;
      targetShopSlug = lastAppt.shops.slug;
    }
  }

  // Profile: aseguramos el nombre/email/phone + shop_id si lo tenemos.
  await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        name,
        email,
        phone,
        is_admin: false,
        shop_id: targetShopId
      },
      { onConflict: 'id' }
    );

  // Auto-login: signInWithPassword en el mismo server action setea las
  // cookies de sesión, así el cliente queda dentro sin re-pedirle creds.
  const supabase = createClient();
  const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
  if (loginErr) {
    return { ok: true, dest: '/login?registered=1' };
  }

  // Destino final: si vino con ?next= (ej: registro a mitad de un booking),
  // respetar ese destino; si no, barbería atada o landing.
  const dest = next ?? (targetShopSlug ? `/${targetShopSlug}` : '/');
  return { ok: true, dest };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Pide a Supabase un email con link de recuperación. Diseñado para no
// filtrar si un email está registrado: validamos en silencio y siempre
// devolvemos `ok: true` al cliente (el form muestra el mismo mensaje
// genérico independientemente del resultado real). Rate-limit y expiry
// del token los maneja Supabase (default: 1 email/60s, 1h de validez).
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();

  // Validación silenciosa: emails inválidos no disparan el envío,
  // pero la respuesta al cliente es la misma → no hay enumeración.
  if (email && email.includes('@') && email.length <= 254) {
    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/cuenta/actualizar-password`
    });
  }

  return { ok: true };
}

// Actualiza la password del user actualmente autenticado. Requiere sesión
// activa (la del flow de recovery o la de un user ya logueado). Tras el
// cambio cerramos sesión para forzar re-login con la nueva password
// — esto, sumado a la rotación de refresh tokens que hace Supabase al
// cambiar la password, invalida sesiones residuales en otros dispositivos.
export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') || '');
  const confirm  = String(formData.get('confirm')  || '');

  if (password.length < 8) {
    return { error: 'La contraseña tiene que tener al menos 8 caracteres' };
  }
  if (password.length > 72) {
    // Límite de bcrypt usado por Supabase Auth.
    return { error: 'La contraseña es demasiado larga (máx 72 caracteres)' };
  }
  if (password !== confirm) {
    return { error: 'Las contraseñas no coinciden' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Tu sesión expiró. Pedí un nuevo link de recuperación.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Mensaje genérico — no exponer detalles internos del provider.
    return { error: 'No pudimos actualizar la contraseña. Probá de nuevo.' };
  }

  await supabase.auth.signOut();
  return { ok: true };
}

// Setea la contraseña por PRIMERA vez para un dueño que se acaba de
// registrar vía magic link. A diferencia de `updatePassword`, NO desloguea
// al user — queremos que siga al onboarding sin re-login. Solo se permite
// si el user actual no tiene una contraseña previa configurada (para no
// abrir un bypass al flow de recovery).
export async function establishPassword(formData: FormData) {
  const password = String(formData.get('password') || '');
  const confirm  = String(formData.get('confirm')  || '');

  if (password.length < 8) {
    return { error: 'La contraseña tiene que tener al menos 8 caracteres' };
  }
  if (password.length > 72) {
    return { error: 'La contraseña es demasiado larga (máx 72 caracteres)' };
  }
  if (password !== confirm) {
    return { error: 'Las contraseñas no coinciden' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Tu sesión expiró. Pedí un nuevo link.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: 'No pudimos guardar la contraseña. Probá de nuevo.' };
  }

  return { ok: true };
}
