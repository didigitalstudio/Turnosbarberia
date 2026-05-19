'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getAdminShop } from '@/lib/shop-context';
import {
  createTusFacturasInvoice,
  pingTusFacturas
} from '@/lib/tusfacturas';
import type {
  IvaCondition,
  ClienteCondicionIva,
  TipoDoc,
  Invoice
} from '@/types/db';

// ─── Ajustes de facturación (admin) ─────────────────────────────────────────

const InvoicingSettingsSchema = z.object({
  api_key:        z.string().trim().max(200).optional().or(z.literal('')),
  api_token:      z.string().trim().max(200).optional().or(z.literal('')),
  user_token:     z.string().trim().max(200).optional().or(z.literal('')),
  cuit:           z.string().trim().regex(/^\d{11}$/, 'CUIT inválido').optional().or(z.literal('')),
  razon_social:   z.string().trim().max(200).optional().or(z.literal('')),
  punto_venta:    z.number().int().positive().max(99999).optional(),
  condicion_iva:  z.enum(['RI','MONOTRIBUTO','EXENTO']).optional(),
  is_active:      z.boolean().optional().default(false)
});

export async function upsertShopInvoicingSettings(
  input: z.infer<typeof InvoicingSettingsSchema>
) {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = InvoicingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', ') };
  }
  const d = parsed.data;

  // Si se activa, exigimos todas las credenciales + datos fiscales.
  if (d.is_active) {
    if (!d.api_key || !d.api_token || !d.user_token) {
      return { error: 'Para activar necesitás cargar api_key, api_token y user_token.' };
    }
    if (!d.cuit) return { error: 'Para activar necesitás cargar el CUIT.' };
    if (!d.condicion_iva) return { error: 'Para activar elegí la condición de IVA del shop.' };

    const ping = await pingTusFacturas({
      apiKey:    d.api_key,
      apiToken:  d.api_token,
      userToken: d.user_token
    });
    if (!ping.ok) {
      return { error: 'TusFacturas rechazó las credenciales: ' + (ping.error || 'sin detalle') };
    }
  }

  const admin = createAdminClient();
  const row = {
    shop_id:       shop.id,
    provider:      'tusfacturas' as const,
    api_key:       (d.api_key    || '').trim() || null,
    api_token:     (d.api_token  || '').trim() || null,
    user_token:    (d.user_token || '').trim() || null,
    cuit:          (d.cuit       || '').trim() || null,
    razon_social:  (d.razon_social || '').trim() || null,
    punto_venta:   d.punto_venta ?? 1,
    condicion_iva: d.condicion_iva ?? null,
    is_active:     d.is_active ?? false
  };
  const { error } = await admin
    .from('shop_invoicing_settings')
    .upsert(row, { onConflict: 'shop_id' });
  if (error) return { error: error.message };

  revalidatePath('/shop/ajustes');
  return { ok: true };
}

// ─── Emitir factura ─────────────────────────────────────────────────────────

const ClienteSchema = z.object({
  tipo_doc:      z.enum(['CUIT','DNI','CF']),
  nro_doc:       z.string().trim().max(20).optional(),
  razon_social:  z.string().trim().max(200).optional(),
  condicion_iva: z.enum(['RI','MONOTRIBUTO','EXENTO','CF']),
  email:         z.string().trim().email().max(120).optional().or(z.literal('')),
  domicilio:     z.string().trim().max(200).optional()
});

const EmitInvoiceSchema = z.object({
  saleId:         z.string().uuid().optional(),
  appointmentId:  z.string().uuid().optional(),
  cliente:        ClienteSchema,
  envia_por_mail: z.boolean().optional().default(false),
  // Override del IVA del item. Default 21 (servicios). 0 si exento.
  alicuota_iva:   z.number().min(0).max(27).optional()
}).refine(
  d => Boolean(d.saleId) !== Boolean(d.appointmentId),
  { message: 'Pasá saleId o appointmentId, no ambos.' }
);

export type EmitInvoiceResult =
  | { ok: true; invoiceId: string; cae: string; pdfUrl?: string; numero?: number }
  | { error: string; invoiceId?: string };

export async function emitInvoice(
  input: z.infer<typeof EmitInvoiceSchema>
): Promise<EmitInvoiceResult> {
  const shop = await getAdminShop();
  if (!shop) return { error: 'No autorizado' };

  const parsed = EmitInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', ') };
  }
  const d = parsed.data;

  const admin = createAdminClient();

  // 1. Settings de facturación del shop.
  const { data: settings } = await admin
    .from('shop_invoicing_settings')
    .select('api_key, api_token, user_token, cuit, razon_social, punto_venta, condicion_iva, is_active')
    .eq('shop_id', shop.id)
    .maybeSingle<{
      api_key: string | null;
      api_token: string | null;
      user_token: string | null;
      cuit: string | null;
      razon_social: string | null;
      punto_venta: number;
      condicion_iva: IvaCondition | null;
      is_active: boolean;
    }>();
  if (!settings?.is_active || !settings.api_key || !settings.api_token || !settings.user_token ||
      !settings.cuit || !settings.condicion_iva) {
    return { error: 'La barbería todavía no configuró facturación.', invoiceId: undefined };
  }

  // 2. Resolver monto + descripción según origen.
  let amount = 0;
  let description = 'Servicio';
  let saleId: string | null = d.saleId ?? null;
  let appointmentId: string | null = d.appointmentId ?? null;
  let defaultEmail = '';
  let defaultName  = '';

  if (d.saleId) {
    const { data: sale } = await admin
      .from('sales')
      .select('id, shop_id, amount, description, appointment_id, customer_name, type, appointments:appointment_id(customer_email, services:service_id(name))')
      .eq('id', d.saleId)
      .eq('shop_id', shop.id)
      .maybeSingle<{
        id: string;
        shop_id: string;
        amount: number;
        description: string | null;
        appointment_id: string | null;
        customer_name: string | null;
        type: string;
        appointments: { customer_email: string; services: { name: string } | null } | null;
      }>();
    if (!sale) return { error: 'Cobro no encontrado' };

    amount = Number(sale.amount);
    description = sale.description || sale.appointments?.services?.name || 'Servicio';
    appointmentId = sale.appointment_id;
    defaultEmail = sale.appointments?.customer_email || '';
    defaultName  = sale.customer_name || '';

    // Evitamos facturar dos veces el mismo sale (el unique index DB lo blinda igual).
    const { data: prev } = await admin
      .from('invoices')
      .select('id')
      .eq('sale_id', sale.id)
      .eq('status', 'emitted')
      .maybeSingle();
    if (prev) return { error: 'Ese cobro ya tiene factura emitida' };
  } else if (d.appointmentId) {
    const { data: appt } = await admin
      .from('appointments')
      .select('id, shop_id, payment_amount, payment_status, customer_name, customer_email, services:service_id(name)')
      .eq('id', d.appointmentId)
      .eq('shop_id', shop.id)
      .maybeSingle<{
        id: string;
        shop_id: string;
        payment_amount: number | null;
        payment_status: string;
        customer_name: string;
        customer_email: string;
        services: { name: string } | null;
      }>();
    if (!appt) return { error: 'Turno no encontrado' };
    if (appt.payment_status !== 'paid' || !appt.payment_amount || appt.payment_amount <= 0) {
      return { error: 'El turno no tiene una seña pagada para facturar' };
    }

    amount = Number(appt.payment_amount);
    description = `Seña · ${appt.services?.name || 'Turno'}`;
    defaultEmail = appt.customer_email;
    defaultName  = appt.customer_name;

    const { data: prev } = await admin
      .from('invoices')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('status', 'emitted')
      .maybeSingle();
    if (prev) return { error: 'Esa seña ya tiene factura emitida' };
  }

  if (amount <= 0) return { error: 'Monto inválido' };

  const cliente = {
    tipo_doc:      d.cliente.tipo_doc as TipoDoc,
    nro_doc:       d.cliente.nro_doc,
    razon_social:  d.cliente.razon_social || defaultName || 'Consumidor Final',
    condicion_iva: d.cliente.condicion_iva as ClienteCondicionIva,
    email:         d.cliente.email || defaultEmail || undefined,
    domicilio:     d.cliente.domicilio
  };

  // Alícuota: 21% por default para servicios. Si el emisor es Monotributo/Exento,
  // se manda igual pero TusFacturas no la discrimina (factura C).
  const alicuota = d.alicuota_iva ?? 21;

  // 3. Insert "pending" en invoices para tener rastro aunque falle el API.
  const { data: pendingRow, error: pendingErr } = await admin
    .from('invoices')
    .insert({
      shop_id: shop.id,
      sale_id: saleId,
      appointment_id: appointmentId,
      tipo_comprobante: 'PENDING',
      punto_venta: settings.punto_venta,
      monto_total: amount,
      cliente_data: cliente,
      provider: 'tusfacturas',
      status: 'pending'
    } as Partial<Invoice>)
    .select('id')
    .single<{ id: string }>();
  if (pendingErr || !pendingRow) {
    return { error: pendingErr?.message || 'No pudimos registrar la factura' };
  }
  const invoiceId = pendingRow.id;

  // 4. Llamada a TusFacturas.
  const tfResult = await createTusFacturasInvoice({
    creds: {
      apiKey:    settings.api_key,
      apiToken:  settings.api_token,
      userToken: settings.user_token
    },
    emisor: {
      cuit:          settings.cuit,
      razon_social:  settings.razon_social || 'Mi Barbería',
      punto_venta:   settings.punto_venta,
      condicion_iva: settings.condicion_iva
    },
    cliente,
    items: [{
      descripcion: description,
      cantidad: 1,
      precio_unitario_sin_iva: alicuota > 0 ? amount / (1 + alicuota / 100) : amount,
      alicuota_iva: alicuota
    }],
    envia_por_mail: d.envia_por_mail && Boolean(cliente.email),
    external_reference: invoiceId
  });

  // 5. Actualizar la invoice con el resultado.
  if (!tfResult.ok) {
    await admin
      .from('invoices')
      .update({ status: 'error', error_msg: tfResult.error_msg || 'Error desconocido' })
      .eq('id', invoiceId);
    return { error: tfResult.error_msg || 'TusFacturas rechazó la factura', invoiceId };
  }

  const montoNeto = alicuota > 0 ? Math.round((amount / (1 + alicuota / 100)) * 100) / 100 : amount;
  const montoIva  = Math.round((amount - montoNeto) * 100) / 100;

  await admin
    .from('invoices')
    .update({
      tipo_comprobante: tfResult.comprobante_tipo || 'PENDING',
      numero:           tfResult.numero ?? null,
      cae:              tfResult.cae ?? null,
      cae_vencimiento:  tfResult.cae_vencimiento ?? null,
      pdf_url:          tfResult.pdf_url ?? null,
      external_id:      tfResult.external_id ?? null,
      monto_neto:       montoNeto,
      monto_iva:        montoIva,
      status:           'emitted',
      emitida_at:       new Date().toISOString(),
      error_msg:        null
    })
    .eq('id', invoiceId);

  revalidatePath('/shop/caja');
  revalidatePath('/shop/facturas');
  revalidatePath('/shop');

  return {
    ok: true,
    invoiceId,
    cae: tfResult.cae || '',
    pdfUrl: tfResult.pdf_url,
    numero: tfResult.numero
  };
}
