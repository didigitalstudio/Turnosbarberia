'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';

const WhatsappSettingsSchema = z.object({
  phone_number_id: z.string().trim().max(50).optional().or(z.literal('')),
  access_token: z.string().trim().max(500).optional().or(z.literal('')),
  reminder_template_name: z.string().trim().min(1).max(60).optional().default('appointment_reminder'),
  reminder_template_language: z.string().trim().min(2).max(10).optional().default('es_AR'),
  is_active: z.boolean().optional().default(false)
});

export async function upsertShopWhatsappSettings(input: z.infer<typeof WhatsappSettingsSchema>) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = WhatsappSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const d = parsed.data;

  const admin = createAdminClient();
  const row = {
    shop_id: shop.id,
    phone_number_id: (d.phone_number_id || '').trim() || null,
    access_token: (d.access_token || '').trim() || null,
    reminder_template_name: (d.reminder_template_name || 'appointment_reminder').trim(),
    reminder_template_language: (d.reminder_template_language || 'es_AR').trim(),
    is_active: d.is_active ?? false
  };
  const { error } = await admin
    .from('shop_whatsapp_settings')
    .upsert(row, { onConflict: 'shop_id' });
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  return { ok: true };
}
