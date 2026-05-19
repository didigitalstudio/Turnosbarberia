'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';

const CreateBlockSchema = z.object({
  // null = bloqueo de todo el shop (todos los barberos)
  barberId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().trim().max(120).optional().or(z.literal(''))
});

export async function createScheduleBlock(input: z.infer<typeof CreateBlockSchema>) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = CreateBlockSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const d = parsed.data;

  const startsAtMs = new Date(d.startsAt).getTime();
  const endsAtMs = new Date(d.endsAt).getTime();
  if (endsAtMs <= startsAtMs) return { error: 'El fin del bloqueo tiene que ser posterior al inicio.' };

  // Si pasaron un barbero, verificamos que pertenezca al shop (defensa en
  // profundidad — la RLS también lo verifica).
  const admin = createAdminClient();
  if (d.barberId) {
    const { data: barber } = await admin
      .from('barbers')
      .select('id')
      .eq('id', d.barberId)
      .eq('shop_id', shop.id)
      .maybeSingle();
    if (!barber) return { error: 'Ese barbero no pertenece a esta barbería.' };
  }

  const { error } = await admin
    .from('schedule_blocks')
    .insert({
      shop_id: shop.id,
      barber_id: d.barberId || null,
      starts_at: d.startsAt,
      ends_at: d.endsAt,
      reason: (d.reason || '').trim() || null
    });
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop');
  return { ok: true };
}

export async function deleteScheduleBlock(id: string) {
  if (!id || typeof id !== 'string') return { error: 'ID inválido' };

  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const supabase = createClient();
  const { error } = await supabase
    .from('schedule_blocks')
    .delete()
    .eq('id', id)
    .eq('shop_id', shop.id);
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  revalidatePath('/shop');
  return { ok: true };
}
