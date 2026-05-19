'use server';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/slug';
import { initialsFrom } from '@/lib/barber';
import { revalidatePath } from 'next/cache';
import { sendNewShopNotificationToSuperAdmin } from '@/lib/email';
import {
  NAME_LINE_RE,
  SLUG_RE,
  RESERVED_SLUGS,
  slugSchema,
  shopNameSchema,
  phoneSchema,
  addressSchema,
  timeSchema,
  formatZodError
} from '@/lib/validation';

export type DaySchedule = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
};

export type CreateShopInput = {
  shop: { name: string; slug: string; address?: string; phone?: string };
  services: Array<{ name: string; duration_mins: number; price: number }>;
  barbers: Array<{ name: string; role?: string }>;
  schedules: {
    perBarber: boolean;
    general?: DaySchedule[];
    byBarber?: Record<string, DaySchedule[]>;
  };
};

function validateSlugShape(slug: string): { ok: true } | { ok: false; reason: string } {
  if (!slug || slug.length < 3) return { ok: false, reason: 'Muy corto (mínimo 3 caracteres)' };
  if (slug.length > 42) return { ok: false, reason: 'Muy largo (máximo 42 caracteres)' };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'Solo letras minúsculas, números y guiones' };
  if (slug.includes('--')) return { ok: false, reason: 'No uses guiones dobles' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'Este nombre está reservado' };
  return { ok: true };
}

export async function checkSlugAvailable(slug: string): Promise<{ available: boolean; reason?: string }> {
  const normalized = (slug || '').trim().toLowerCase();
  const shape = validateSlugShape(normalized);
  if (!shape.ok) return { available: false, reason: shape.reason };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('shops')
    .select('id')
    .eq('slug', normalized)
    .maybeSingle();
  if (error) return { available: false, reason: 'No se pudo validar, reintentá' };
  if (data) return { available: false, reason: 'Ya está en uso' };
  return { available: true };
}

function dedupeBarberSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base; }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const out = `${base}-${n}`;
  used.add(out);
  return out;
}

// ── Schemas para createShop ────────────────────────────────────────────────

const ShopCoreSchema = z.object({
  name: shopNameSchema,
  slug: slugSchema,
  address: addressSchema,
  phone: z.string().trim().max(30).optional().or(z.literal(''))
    .refine(v => !v || /^[+\d\s()-]{6,30}$/.test(v), 'Teléfono inválido')
});

const ServiceInputSchema = z.object({
  name: z.string().trim().regex(NAME_LINE_RE, 'Nombre de servicio inválido'),
  duration_mins: z.coerce.number().int().min(5).max(480),
  price: z.coerce.number().min(0).max(10_000_000)
});

const BarberInputSchema = z.object({
  name: z.string().trim().regex(NAME_LINE_RE, 'Nombre de barbero inválido'),
  role: z.string().trim().max(60).optional().or(z.literal(''))
});

const DayScheduleSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: timeSchema,
  end_time: timeSchema,
  is_working: z.boolean()
});

const CreateShopSchema = z.object({
  shop: ShopCoreSchema,
  services: z.array(ServiceInputSchema).min(1, 'Agregá al menos un servicio').max(30, 'Máximo 30 servicios'),
  barbers: z.array(BarberInputSchema).min(1, 'Agregá al menos un barbero').max(50, 'Máximo 50 barberos'),
  schedules: z.object({
    perBarber: z.boolean(),
    general: z.array(DayScheduleSchema).optional(),
    byBarber: z.record(z.array(DayScheduleSchema)).optional()
  })
});

/**
 * Heurística B.3: en el wizard el user puede crear hasta 50 barberos. Si el
 * plan default es "starter" (límite = 3) y creó más de 3, queda inconsistente.
 *
 * Decisión: auto-upgrade a 'pro' cuando crea más de 3 barberos.
 * Razonamiento: es menos molesto que bloquear el wizard en el paso final
 * después de que el user ya armó todo. El super-admin igual aprueba la
 * activación (is_active = false al crearse) y puede ajustar el plan desde
 * /desarrollo antes de activar. Esto evita atrapar al user en un estado donde
 * tiene 5 barberos en la UI pero el plan no se los permite.
 */
const AUTO_PRO_BARBER_THRESHOLD = 3;

export async function createShop(input: CreateShopInput): Promise<{ error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Necesitás iniciar sesión' };

  // Pre-normalización: el user mandó strings "sucias" — limpiamos antes del parse.
  const normalized = {
    shop: {
      name: (input.shop?.name || '').trim(),
      slug: (input.shop?.slug || '').trim().toLowerCase(),
      address: (input.shop?.address || '').trim(),
      phone: (input.shop?.phone || '').trim()
    },
    services: (input.services || []).map(s => ({
      name: (s.name || '').trim(),
      duration_mins: Math.floor(Number(s.duration_mins) || 0),
      price: Math.max(0, Number(s.price) || 0)
    })),
    barbers: (input.barbers || []).map(b => ({
      name: (b.name || '').trim(),
      role: (b.role || '').trim()
    })),
    schedules: {
      perBarber: !!input.schedules?.perBarber,
      general: (input.schedules?.general || []) as DaySchedule[],
      byBarber: (input.schedules?.byBarber || {}) as Record<string, DaySchedule[]>
    }
  };

  const parsed = CreateShopSchema.safeParse(normalized);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;

  const perBarber = d.schedules.perBarber;
  const generalSched = (d.schedules.general || []) as DaySchedule[];
  const byBarberSched = (d.schedules.byBarber || {}) as Record<string, DaySchedule[]>;
  if (!perBarber && generalSched.length === 0) {
    return { error: 'Falta configurar los horarios' };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('shops')
    .select('id')
    .eq('slug', d.shop.slug)
    .maybeSingle();
  if (existing) return { error: 'Ese slug ya está en uso, elegí otro' };

  // Heurística: si el user configuró más de 3 barberos, va a Pro.
  const plan: 'starter' | 'pro' =
    d.barbers.length > AUTO_PRO_BARBER_THRESHOLD ? 'pro' : 'starter';

  const { data: shopRow, error: shopErr } = await admin
    .from('shops')
    .insert({
      name: d.shop.name,
      slug: d.shop.slug,
      address: d.shop.address || null,
      phone: d.shop.phone || null,
      owner_id: user.id,
      is_active: false,
      plan
    })
    .select('id, slug')
    .single();

  if (shopErr || !shopRow) {
    return { error: 'No se pudo crear la barbería: ' + (shopErr?.message || 'desconocido') };
  }

  const shopId = shopRow.id as string;

  const cleanup = async () => {
    await admin.from('shops').delete().eq('id', shopId);
  };

  const { error: svcErr } = await admin.from('services').insert(
    d.services.map(s => ({
      shop_id: shopId,
      name: s.name,
      duration_mins: s.duration_mins,
      price: s.price,
      is_active: true
    }))
  );
  if (svcErr) {
    await cleanup();
    return { error: 'No se pudieron crear los servicios: ' + svcErr.message };
  }

  const usedSlugs = new Set<string>();
  const barberRows = d.barbers.map((b, idx) => {
    const baseSlug = slugify(b.name) || `barbero-${idx + 1}`;
    const slug = dedupeBarberSlug(baseSlug, usedSlugs);
    return {
      shop_id: shopId,
      name: b.name,
      slug,
      role: b.role || null,
      initials: initialsFrom(b.name),
      hue: Math.floor(Math.random() * 360),
      is_active: true
    };
  });

  const { data: insertedBarbers, error: barErr } = await admin
    .from('barbers')
    .insert(barberRows)
    .select('id');
  if (barErr || !insertedBarbers) {
    await cleanup();
    return { error: 'No se pudieron crear los barberos: ' + (barErr?.message || 'desconocido') };
  }

  const schedInserts: Array<{
    shop_id: string;
    barber_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_working: boolean;
  }> = [];

  insertedBarbers.forEach((bRow: any, idx: number) => {
    const source: DaySchedule[] = perBarber
      ? (byBarberSched[String(idx)] || generalSched || [])
      : generalSched;
    for (let day = 0; day < 7; day++) {
      const slot = source.find(x => x.day_of_week === day);
      schedInserts.push({
        shop_id: shopId,
        barber_id: bRow.id,
        day_of_week: day,
        start_time: slot?.start_time || '10:00',
        end_time: slot?.end_time || '20:00',
        is_working: slot ? !!slot.is_working : false
      });
    }
  });

  if (schedInserts.length > 0) {
    const { error: schedErr } = await admin.from('schedules').insert(schedInserts);
    if (schedErr) {
      await cleanup();
      return { error: 'No se pudieron crear los horarios: ' + schedErr.message };
    }
  }

  // Aviso al super-admin (no bloqueante).
  try {
    await sendNewShopNotificationToSuperAdmin({
      slug: shopRow.slug,
      name: d.shop.name,
      ownerEmail: user.email || '(sin email)'
    });
  } catch { /* silencioso */ }

  // Webhook al panel admin DI (no bloqueante).
  try {
    const webhookUrl = process.env.DI_ADMIN_WEBHOOK_URL
    const webhookSecret = process.env.DI_ADMIN_WEBHOOK_SECRET
    if (webhookUrl && webhookSecret) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookSecret}` },
        body: JSON.stringify({
          proyecto: 'turnosbarberia',
          entity_type: 'shop',
          entity_id: shopId,
          auth_user_id: user.id,
          email: user.email || '',
          nombre: user.email || '',
          datos_extra: { shop_name: d.shop.name, slug: shopRow.slug },
        }),
      }).catch(() => {})
    }
  } catch { /* silencioso */ }

  revalidatePath('/shop');
  revalidatePath(`/${shopRow.slug}`);
  revalidatePath('/', 'layout');
  return {};
}
