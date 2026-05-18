// ============================================================================
// Webhook de Mercado Pago.
//
// MP nos avisa cuando pasa algo con un pago. El body típico es:
//   { type: 'payment', action: 'payment.created'|'payment.updated', data: { id: '...' } }
//
// Para confirmar el evento, fetchamos /v1/payments/<id> con el access token
// del shop dueño. Si el pago está approved, marcamos el turno como confirmed
// + payment_status=paid. Si está rejected/cancelled, lo dejamos en pending
// para que el cliente vuelva a intentar (o vence el hold y se libera).
//
// Idempotencia: la operación de update es segura de re-ejecutar — si el turno
// ya está confirmed, nada cambia. MP a veces manda duplicados; está OK.
// ============================================================================

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchMpPayment } from '@/lib/mercadopago';
import {
  sendBookingConfirmationToCustomer,
  sendBookingNotificationToAdmin
} from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // MP a veces manda como query, a veces en body. Soportamos ambos.
  const url = new URL(request.url);
  const topicFromQuery = url.searchParams.get('topic') || url.searchParams.get('type');
  const idFromQuery = url.searchParams.get('id') || url.searchParams.get('data.id');
  const topic = body?.type || body?.topic || topicFromQuery;
  const paymentId = body?.data?.id || idFromQuery;

  // Solo procesamos eventos de payment. El resto (merchant_order, etc.) los
  // aceptamos para que MP no reintente, pero no hacemos nada.
  if (topic !== 'payment' || !paymentId) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const admin = createAdminClient();

  // Para fetchar el pago necesitamos saber qué shop lo originó. Lo más
  // confiable: cuando crearmos la preferencia guardamos payment_external_id
  // = preference.id en el appointment, pero el webhook nos manda el
  // payment.id (no preference.id). MP no nos permite mappear un payment.id
  // sin haber consultado el pago primero — para eso necesitamos UN access
  // token. Estrategia: el primer cliente MP del shop por external_reference
  // del payment. Pero no lo tenemos hasta fetchear.
  //
  // Por ahora: probamos contra todos los shops que tengan MP activo. Es N+1
  // pero N es chico (un puñado de shops con MP) y el webhook se ejecuta una
  // vez por pago. Si crece, vamos a indexar por payment_id en una tabla
  // mp_payments_index.
  const { data: shopsWithMp } = await admin
    .from('shop_payment_settings')
    .select('shop_id, mp_access_token')
    .eq('is_active', true)
    .not('mp_access_token', 'is', null);

  if (!shopsWithMp || shopsWithMp.length === 0) {
    return NextResponse.json({ ok: true, no_active_shops: true }, { status: 200 });
  }

  let payment = null;
  let usedToken: string | null = null;
  for (const s of shopsWithMp) {
    try {
      payment = await fetchMpPayment(s.mp_access_token!, paymentId);
      usedToken = s.mp_access_token!;
      break;
    } catch {
      // Token incorrecto para este pago — probamos el siguiente shop.
      continue;
    }
  }

  if (!payment) {
    console.error('[mp-webhook] no se pudo recuperar el pago', paymentId);
    // Devolvemos 200 igual para que MP no reintente eternamente.
    return NextResponse.json({ ok: true, payment_not_found: true }, { status: 200 });
  }

  const externalRef = payment.external_reference;
  if (!externalRef) {
    return NextResponse.json({ ok: true, no_external_ref: true }, { status: 200 });
  }

  // Estados terminales de MP: approved | rejected | cancelled | refunded | charged_back
  // En aprovado, el turno pasa a confirmed. En los otros, dejamos en pending
  // para que vuelva a intentar o vencerá el hold.
  if (payment.status === 'approved') {
    const { data: updated } = await admin
      .from('appointments')
      .update({
        status: 'confirmed',
        payment_status: 'paid',
        payment_amount: payment.transaction_amount,
        payment_external_id: String(payment.id),
        payment_expires_at: null
      })
      .eq('id', externalRef)
      .eq('status', 'pending_payment')
      .select('id, shop_id, customer_email, customer_name, customer_phone, starts_at, service_id, barber_id')
      .maybeSingle<{
        id: string;
        shop_id: string;
        customer_email: string;
        customer_name: string;
        customer_phone: string;
        starts_at: string;
        service_id: string;
        barber_id: string;
      }>();

    // Mandamos los emails que skipeamos en createBooking — ahora sí.
    if (updated) {
      try {
        const [{ data: shop }, { data: svc }, { data: barber }] = await Promise.all([
          admin.from('shops').select('name, slug, owner_id').eq('id', updated.shop_id).maybeSingle<{ name: string; slug: string; owner_id: string | null }>(),
          admin.from('services').select('name, price').eq('id', updated.service_id).maybeSingle<{ name: string; price: number }>(),
          admin.from('barbers').select('name').eq('id', updated.barber_id).maybeSingle<{ name: string }>()
        ]);
        if (shop) {
          await sendBookingConfirmationToCustomer({
            to: updated.customer_email,
            customerName: updated.customer_name,
            shopName: shop.name,
            shopSlug: shop.slug,
            serviceName: svc?.name || 'Servicio',
            barberName: barber?.name || 'tu barbero',
            startsAt: updated.starts_at,
            depositPaid: payment.transaction_amount,
            servicePrice: Number(svc?.price || 0)
          });
          if (shop.owner_id) {
            const { data: ownerRes } = await admin.auth.admin.getUserById(shop.owner_id);
            const ownerEmail = ownerRes?.user?.email;
            if (ownerEmail) {
              await sendBookingNotificationToAdmin({
                to: ownerEmail,
                shopName: shop.name,
                customerName: updated.customer_name,
                serviceName: svc?.name || 'Servicio',
                barberName: barber?.name || 'tu barbero',
                startsAt: updated.starts_at
              });
            }
          }
        }
      } catch (e) {
        console.error('[mp-webhook] email send failed:', e);
      }
    }
  } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
    // No tocamos el appointment: queda como pending_payment y el cliente
    // puede volver a intentar. Si nunca lo logra, el hold vence solo.
  } else if (payment.status === 'refunded' || payment.status === 'charged_back') {
    // Reembolso fuera de banda (alguien lo hizo desde MP directamente).
    // Cancelamos el turno para que el barbero no espere a alguien que ya
    // pidió la plata de vuelta.
    await admin
      .from('appointments')
      .update({
        status: 'cancelled',
        payment_status: payment.status === 'refunded' ? 'refunded' : 'partial_refund'
      })
      .eq('id', externalRef)
      .neq('status', 'cancelled');
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// MP también pega a GET con ?topic=...&id=... a veces (legacy). Lo
// soportamos por compatibilidad.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const topic = url.searchParams.get('topic') || url.searchParams.get('type');
  const id = url.searchParams.get('id') || url.searchParams.get('data.id');
  if (topic === 'payment' && id) {
    // Reenviamos al POST handler para no duplicar lógica.
    return POST(new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'payment', data: { id } })
    }));
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
