'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminShop, getShopBySlug } from '@/lib/shop-context';
import { createMpPreference } from '@/lib/mercadopago';

// ─── Ajustes de pago (admin) ────────────────────────────────────────────────

const PaymentSettingsSchema = z.object({
  mp_access_token: z.string().trim().max(500).optional().or(z.literal('')),
  mp_public_key: z.string().trim().max(200).optional().or(z.literal('')),
  mp_webhook_secret: z.string().trim().max(200).optional().or(z.literal('')),
  is_active: z.boolean().optional().default(false)
});

export async function upsertShopPaymentSettings(input: z.infer<typeof PaymentSettingsSchema>) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = PaymentSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const d = parsed.data;

  const admin = createAdminClient();
  const row = {
    shop_id: shop.id,
    mp_access_token: (d.mp_access_token || '').trim() || null,
    mp_public_key: (d.mp_public_key || '').trim() || null,
    mp_webhook_secret: (d.mp_webhook_secret || '').trim() || null,
    is_active: d.is_active ?? false
  };
  const { error } = await admin
    .from('shop_payment_settings')
    .upsert(row, { onConflict: 'shop_id' });
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  return { ok: true };
}

// ─── Inicio del flow de pago (cliente) ───────────────────────────────────────

const StartPaymentSchema = z.object({
  shopSlug: z.string().min(1).max(50),
  appointmentId: z.string().uuid()
});

export async function startMpPaymentForAppointment(input: z.infer<typeof StartPaymentSchema>) {
  const parsed = StartPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos' };
  const { shopSlug, appointmentId } = parsed.data;

  const shop = await getShopBySlug(shopSlug);
  if (!shop) return { error: 'Barbería no disponible' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const admin = createAdminClient();

  // 1. Validar que el turno existe, pertenece al user y está pending_payment.
  const { data: appt } = await admin
    .from('appointments')
    .select('id, shop_id, profile_id, status, payment_status, payment_amount, payment_expires_at, service_id, customer_email, services(name)')
    .eq('id', appointmentId)
    .eq('shop_id', shop.id)
    .maybeSingle<{
      id: string;
      shop_id: string;
      profile_id: string | null;
      status: string;
      payment_status: string;
      payment_amount: number | null;
      payment_expires_at: string | null;
      service_id: string;
      customer_email: string;
      services: { name: string } | null;
    }>();
  if (!appt) return { error: 'Turno no encontrado' };
  if (appt.profile_id !== user.id) return { error: 'Este turno no es tuyo' };
  if (appt.status !== 'pending_payment' || appt.payment_status !== 'pending') {
    return { error: 'Este turno no necesita pago.' };
  }
  if (!appt.payment_amount || appt.payment_amount <= 0) {
    return { error: 'Monto de seña inválido.' };
  }
  if (appt.payment_expires_at && new Date(appt.payment_expires_at).getTime() < Date.now()) {
    return { error: 'El tiempo para pagar venció. Reservá el turno de nuevo.', code: 'HOLD_EXPIRED' as const };
  }

  // 2. Leer la configuración de MP del shop.
  const { data: settings } = await admin
    .from('shop_payment_settings')
    .select('mp_access_token, is_active')
    .eq('shop_id', shop.id)
    .maybeSingle<{ mp_access_token: string | null; is_active: boolean }>();
  if (!settings?.is_active || !settings.mp_access_token) {
    return { error: 'La barbería todavía no configuró Mercado Pago.', code: 'MP_NOT_CONFIGURED' as const };
  }

  // 3. Construir URLs absolutas.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const successUrl = `${siteUrl}/${shopSlug}/confirmacion/${appt.id}?pay=success`;
  const failureUrl = `${siteUrl}/${shopSlug}/confirmacion/${appt.id}?pay=failure`;
  const pendingUrl = `${siteUrl}/${shopSlug}/confirmacion/${appt.id}?pay=pending`;
  const webhookUrl = `${siteUrl}/api/webhooks/mercadopago`;

  // 4. Crear preferencia en MP.
  let pref;
  try {
    pref = await createMpPreference({
      accessToken: settings.mp_access_token,
      externalReference: appt.id,
      notificationUrl: webhookUrl,
      backUrls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
      item: {
        title: `Seña · ${appt.services?.name || 'Turno'}`,
        quantity: 1,
        unit_price: Number(appt.payment_amount)
      },
      payerEmail: appt.customer_email,
      // Cerramos la preferencia automáticamente cuando vence el hold.
      expirationDateTo: appt.payment_expires_at || undefined
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear el pago';
    console.error('[startMpPaymentForAppointment]', msg);
    return { error: 'No pudimos iniciar el pago. Probá de nuevo.' };
  }

  // 5. Guardar el provider + external id en el appointment (idempotencia: si
  // el cliente vuelve a tocar "Pagar", reusamos la misma preferencia).
  await admin
    .from('appointments')
    .update({
      payment_provider: 'mercadopago',
      payment_external_id: pref.id
    })
    .eq('id', appt.id);

  return { ok: true, initPoint: pref.init_point };
}
