'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const SetPrimarySchema = z.object({ shopId: z.string().uuid() });

/**
 * Cambia cuál de las barberías vinculadas al cliente es la "primaria" (la
 * que se usa por defecto al loguearse). El trigger en client_shops baja a
 * false la primaria anterior y sincroniza profile.shop_id automáticamente,
 * así que el server-side solo tiene que actualizar is_primary=true en la
 * fila destino.
 */
export async function setPrimaryClientShop(input: z.infer<typeof SetPrimarySchema>) {
  const parsed = SetPrimarySchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Validamos que el cliente esté vinculado a ese shop (RLS también lo
  // garantiza, pero defensa en profundidad).
  const { data: link } = await supabase
    .from('client_shops')
    .select('shop_id')
    .eq('profile_id', user.id)
    .eq('shop_id', parsed.data.shopId)
    .maybeSingle();
  if (!link) return { error: 'No estás vinculado a esa barbería' };

  const { error } = await supabase
    .from('client_shops')
    .update({ is_primary: true })
    .eq('profile_id', user.id)
    .eq('shop_id', parsed.data.shopId);
  if (error) return { error: error.message };

  // Revalidamos las pages que muestran la barbería actual del cliente.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Quita una vinculación del cliente con una barbería. No borramos la
 * primaria si es la única; si era la primaria y hay otras, ascendemos
 * a primaria la siguiente más reciente.
 */
export async function unlinkClientShop(input: z.infer<typeof SetPrimarySchema>) {
  const parsed = SetPrimarySchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('client_shops')
    .select('shop_id, is_primary')
    .eq('profile_id', user.id)
    .eq('shop_id', parsed.data.shopId)
    .maybeSingle<{ shop_id: string; is_primary: boolean }>();
  if (!target) return { error: 'No encontrada' };

  // Si era la primaria, ascendemos otra primero (si hay).
  if (target.is_primary) {
    const { data: next } = await admin
      .from('client_shops')
      .select('shop_id')
      .eq('profile_id', user.id)
      .neq('shop_id', parsed.data.shopId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ shop_id: string }>();
    if (next) {
      await admin
        .from('client_shops')
        .update({ is_primary: true })
        .eq('profile_id', user.id)
        .eq('shop_id', next.shop_id);
    }
  }

  const { error } = await admin
    .from('client_shops')
    .delete()
    .eq('profile_id', user.id)
    .eq('shop_id', parsed.data.shopId);
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true };
}
