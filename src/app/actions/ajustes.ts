'use server';
import { revalidatePath } from 'next/cache';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';
import { slugify } from '@/lib/slug';
import { initialsFrom } from '@/lib/barber';
import {
  UpdateShopSchema,
  UpsertServiceSchema,
  UpsertBarberSchema,
  UpdateSchedulesItemSchema,
  AddShopSchema,
  SwitchShopSchema,
  TIMEZONE_RE,
  formatZodError
} from '@/lib/validation';
import { z } from 'zod';

// ─── Shop ────────────────────────────────────────────────────────────────────

export async function updateShop(input: {
  name: string;
  address?: string;
  phone?: string;
  timezone?: string;
}) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = UpdateShopSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;

  const name = d.name;
  const address = (d.address || '').trim() || null;
  const phone = (d.phone || '').trim() || null;
  if (phone && !/^[+\d\s()-]{6,30}$/.test(phone)) return { error: 'Teléfono inválido' };
  const tzInput = (d.timezone || '').trim();
  const timezone = tzInput || shop.timezone;
  if (tzInput && !TIMEZONE_RE.test(tzInput)) return { error: 'Timezone inválida' };

  const supabase = createClient();

  // Cambio de timezone bloqueado si hay turnos próximos: los `schedules`
  // están guardados en hora local del shop (HH:MM strings), así que mover
  // la TZ desplaza efectivamente el horario de atención. Pedimos cancelar
  // o esperar a que terminen para evitar inconsistencias en agenda y caja.
  if (tzInput && tzInput !== shop.timezone) {
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .gte('starts_at', new Date().toISOString())
      .in('status', ['pending', 'confirmed', 'in_progress']);
    if ((count ?? 0) > 0) {
      return {
        error: 'No podés cambiar la zona horaria mientras haya turnos próximos. Cancelálos o esperá a que se completen.'
      };
    }
  }

  const { error } = await supabase
    .from('shops')
    .update({ name, address, phone, timezone })
    .eq('id', shop.id);
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop');
  return { ok: true };
}

// ─── Services ────────────────────────────────────────────────────────────────

export async function upsertService(input: {
  id?: string;
  name: string;
  duration_mins: number;
  price: number;
  description?: string;
  deposit_type?: 'none' | 'percent' | 'fixed' | 'full';
  deposit_amount?: number;
}) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = UpsertServiceSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;
  const description = (d.description || '').trim() || null;
  // 'full' = 100% del precio: el monto guardado se ignora desde la UI, pero
  // lo normalizamos a 0 para que no quede ruido en la DB.
  const depositAmount = d.deposit_type === 'full' || d.deposit_type === 'none' ? 0 : d.deposit_amount;

  const supabase = createClient();
  if (d.id) {
    const { error } = await supabase
      .from('services')
      .update({
        name: d.name,
        duration_mins: d.duration_mins,
        price: d.price,
        description,
        deposit_type: d.deposit_type,
        deposit_amount: depositAmount
      })
      .eq('id', d.id)
      .eq('shop_id', shop.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from('services')
      .insert({
        shop_id: shop.id,
        name: d.name,
        duration_mins: d.duration_mins,
        price: d.price,
        description,
        is_active: true,
        deposit_type: d.deposit_type,
        deposit_amount: depositAmount
      });
    if (error) return { error: error.message };
  }
  revalidatePath('/shop/ajustes');
  revalidatePath(`/${shop.slug}`);
  return { ok: true };
}

export async function toggleService(id: string, active: boolean) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };
  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' };

  const supabase = createClient();
  const { error } = await supabase
    .from('services')
    .update({ is_active: !!active })
    .eq('id', id)
    .eq('shop_id', shop.id);
  if (error) return { error: error.message };
  revalidatePath('/shop/ajustes');
  revalidatePath(`/${shop.slug}`);
  return { ok: true };
}

// ─── Barbers ─────────────────────────────────────────────────────────────────

const STARTER_BARBER_LIMIT = 3;

export async function upsertBarber(input: {
  id?: string;
  name: string;
  role?: string;
  commission_pct?: number;
}) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = UpsertBarberSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;

  const role = (d.role || '').trim() || null;
  const supabase = createClient();

  if (d.id) {
    // Edit: no cuenta contra el límite del plan.
    const update: Record<string, any> = { name: d.name, role, initials: initialsFrom(d.name) };
    if (d.commission_pct != null) update.commission_pct = d.commission_pct;
    const { error } = await supabase
      .from('barbers')
      .update(update)
      .eq('id', d.id)
      .eq('shop_id', shop.id);
    if (error) return { error: error.message };
  } else {
    // B.1 · Plan enforcement: Starter = hasta 3 barberos activos por sede.
    if (shop.plan === 'starter') {
      const { count } = await supabase
        .from('barbers')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .eq('is_active', true);
      if ((count ?? 0) >= STARTER_BARBER_LIMIT) {
        return {
          error:
            'Alcanzaste el límite de 3 barberos del plan Starter. Pasá a Pro para sumar más.'
        };
      }
    }

    // Compute unique slug within shop.
    const base = slugify(d.name) || 'barbero';
    let slug = base;
    let n = 2;
    while (true) {
      const { data: exists } = await supabase
        .from('barbers')
        .select('id')
        .eq('shop_id', shop.id)
        .eq('slug', slug)
        .maybeSingle();
      if (!exists) break;
      slug = `${base}-${n++}`;
      if (n > 50) return { error: 'No se pudo generar un slug único' };
    }
    const { data: inserted, error } = await supabase
      .from('barbers')
      .insert({
        shop_id: shop.id,
        name: d.name,
        slug,
        role,
        initials: initialsFrom(d.name),
        hue: Math.floor(Math.random() * 360),
        is_active: true,
        commission_pct: d.commission_pct ?? 50
      })
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error || !inserted) return { error: error?.message || 'Error al crear barbero' };

    // Default schedules (Domingo cerrado).
    const scheds = Array.from({ length: 7 }, (_, day) => ({
      shop_id: shop.id,
      barber_id: inserted.id,
      day_of_week: day,
      start_time: '10:00',
      end_time: '20:00',
      is_working: day !== 0
    }));
    await supabase.from('schedules').insert(scheds);
  }

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop/equipo');
  revalidatePath(`/${shop.slug}`);
  return { ok: true };
}

export async function toggleBarber(id: string, active: boolean) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };
  if (!z.string().uuid().safeParse(id).success) return { error: 'ID inválido' };

  // Si reactivamos, también chequeamos el límite del plan.
  if (active && shop.plan === 'starter') {
    const supabase = createClient();
    const { count } = await supabase
      .from('barbers')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('is_active', true);
    if ((count ?? 0) >= STARTER_BARBER_LIMIT) {
      return {
        error: 'Alcanzaste el límite de 3 barberos del plan Starter. Pasá a Pro para sumar más.'
      };
    }
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('barbers')
    .update({ is_active: !!active })
    .eq('id', id)
    .eq('shop_id', shop.id);
  if (error) return { error: error.message };
  revalidatePath('/shop/ajustes');
  revalidatePath('/shop/equipo');
  return { ok: true };
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export async function updateSchedules(
  barberId: string,
  days: Array<{ day_of_week: number; start_time: string; end_time: string; is_working: boolean }>
) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  if (!z.string().uuid().safeParse(barberId).success) return { error: 'ID de barbero inválido' };

  const parsed = z.array(UpdateSchedulesItemSchema).min(1).max(7).safeParse(days);
  if (!parsed.success) return { error: formatZodError(parsed.error) };

  // Validar que el barbero pertenezca al shop.
  const supabase = createClient();
  const { data: b } = await supabase
    .from('barbers').select('id').eq('id', barberId).eq('shop_id', shop.id).maybeSingle();
  if (!b) return { error: 'Barbero no encontrado' };

  // Upsert via delete + insert.
  const { error: delErr } = await supabase
    .from('schedules').delete().eq('shop_id', shop.id).eq('barber_id', barberId);
  if (delErr) return { error: delErr.message };

  const rows = parsed.data.map(d => ({
    shop_id: shop.id,
    barber_id: barberId,
    day_of_week: d.day_of_week,
    start_time: d.start_time,
    end_time: d.end_time,
    is_working: d.is_working
  }));
  const { error } = await supabase.from('schedules').insert(rows);
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop/equipo');
  revalidatePath(`/${shop.slug}`);
  return { ok: true };
}

// ─── Multi-sede ──────────────────────────────────────────────────────────────

/**
 * Agrega una nueva sede. Requiere que:
 *   - El user ya sea admin (tiene al menos un shop).
 *   - Su plan actual sea 'pro' (starter = 1 sede fija).
 *
 * El trigger `on_shop_created` en la migración 0006 se encarga de:
 *   - Insertar al owner en shop_members.
 *   - Mover profile.shop_id al nuevo shop (queda como sede "actual").
 */
export async function addShop(input: {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autorizado' };

  const currentShop = await getAdminShop();
  if (!currentShop) return { error: 'Primero tenés que crear tu primera sede desde Onboarding.' };

  // B.2 · Plan enforcement.
  if ((currentShop as any).plan !== 'pro') {
    return {
      error: 'El plan Starter incluye solo 1 sede. Pasá a Pro para sedes ilimitadas.'
    };
  }

  const parsed = AddShopSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('shops').select('id').eq('slug', d.slug).maybeSingle();
  if (existing) return { error: 'Ese slug ya está en uso, elegí otro' };

  const { error: shopErr } = await admin
    .from('shops')
    .insert({
      name: d.name,
      slug: d.slug,
      address: (d.address || '').trim() || null,
      phone: (d.phone || '').trim() || null,
      owner_id: user.id,
      // Plan ya validado arriba: sólo Pro llega acá. Auto-activamos y aprobamos
      // porque ya es un cliente existente que paga — no requiere revisión manual.
      is_active: true,
      aprobado: true,
      // Nuevas sedes heredan el plan del owner (si es pro, seguirá siendo pro).
      plan: currentShop.plan || 'starter'
    });
  if (shopErr) return { error: 'No se pudo crear la sede: ' + shopErr.message };

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Cambia la sede "actual" del user via RPC. */
export async function switchShop(shopId: string) {
  const parsed = SwitchShopSchema.safeParse({ shopId });
  if (!parsed.success) return { error: formatZodError(parsed.error) };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autorizado' };

  const { error } = await supabase.rpc('switch_current_shop', {
    target_shop_id: parsed.data.shopId
  });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true };
}

// ─── Products / Stock ────────────────────────────────────────────────────────

const UpsertProductSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  price: z.number().min(0).max(10_000_000),
  stock: z.number().int().min(0).max(100_000),
  unit: z.string().trim().max(20).optional().default('unidad'),
  provider: z.string().trim().max(80).optional().nullable(),
  cost: z.number().min(0).max(10_000_000).optional().nullable()
});

export async function upsertProduct(input: z.infer<typeof UpsertProductSchema>) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };
  const parsed = UpsertProductSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;
  const row = {
    name: d.name,
    price: d.price,
    stock: d.stock,
    unit: d.unit || 'unidad',
    provider: d.provider?.trim() || null,
    cost: d.cost ?? null
  };
  const supabase = createClient();
  if (d.id) {
    const { error } = await supabase
      .from('products').update(row).eq('id', d.id).eq('shop_id', shop.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from('products').insert({ ...row, shop_id: shop.id, is_active: true });
    if (error) return { error: error.message };
  }
  revalidatePath('/shop/stock');
  revalidatePath('/shop/caja');
  return { ok: true };
}

export async function toggleProduct(id: string, active: boolean) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };
  if (!/^[0-9a-f-]{10,}$/i.test(id)) return { error: 'id inválido' };
  const supabase = createClient();
  const { error } = await supabase
    .from('products').update({ is_active: active }).eq('id', id).eq('shop_id', shop.id);
  if (error) return { error: error.message };
  revalidatePath('/shop/stock');
  revalidatePath('/shop/caja');
  return { ok: true };
}

// ─── Walk-in (admin-side booking) ────────────────────────────────────────────

const CreateWalkInSchema = z.object({
  serviceId: z.string().uuid(),
  barberId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().max(30).optional().default(''),
  startsAt: z.string().datetime()
});

export async function createWalkIn(input: z.infer<typeof CreateWalkInSchema>) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };
  const parsed = CreateWalkInSchema.safeParse(input);
  if (!parsed.success) return { error: formatZodError(parsed.error) };
  const d = parsed.data;

  const startsAt = new Date(d.startsAt);
  if (isNaN(startsAt.getTime())) return { error: 'Fecha inválida' };

  const admin = createAdminClient();
  const { data: service } = await admin
    .from('services').select('id, duration_mins, shop_id, is_active')
    .eq('id', d.serviceId).eq('shop_id', shop.id).maybeSingle<{ id: string; duration_mins: number; is_active: boolean }>();
  if (!service || !service.is_active) return { error: 'Servicio inválido' };

  const { data: barber } = await admin
    .from('barbers').select('id')
    .eq('id', d.barberId).eq('shop_id', shop.id).eq('is_active', true).maybeSingle();
  if (!barber) return { error: 'Barbero inválido' };

  const endsAt = new Date(startsAt.getTime() + service.duration_mins * 60_000);

  const { error } = await admin.from('appointments').insert({
    shop_id: shop.id,
    profile_id: null,
    barber_id: d.barberId,
    service_id: d.serviceId,
    customer_name: d.customerName,
    customer_phone: (d.customerPhone || '').trim() || '—',
    customer_email: 'walkin@local',
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: 'confirmed',
    notes: '[WALK-IN]'
  });
  if (error) {
    if (error.message.toLowerCase().includes('exclude')) {
      return { error: 'Ese horario se superpone con otro turno del barbero.' };
    }
    return { error: error.message };
  }
  revalidatePath('/shop');
  return { ok: true };
}
