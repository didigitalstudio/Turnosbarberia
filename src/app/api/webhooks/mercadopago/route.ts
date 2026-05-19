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
// SEGURIDAD:
// - Validamos el header `x-signature` con HMAC-SHA256 usando el
//   mp_webhook_secret guardado por shop. Sin firma válida, rechazamos.
//   (Doble protección: el manifest incluye data.id + request-id + ts.)
// - Cross-shop: después de identificar qué token de qué shop pudo leer
//   el pago, el UPDATE del appointment exige `.eq('shop_id', usedShopId)`
//   para que un atacante con cuenta MP propia no pueda confirmar turnos
//   de otro shop usando un external_reference forjado.
//
// Idempotencia: la operación de update es segura de re-ejecutar — si el turno
// ya está confirmed, nada cambia. MP a veces manda duplicados; está OK.
// ============================================================================

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchMpPayment } from '@/lib/mercadopago';
import {
  sendBookingConfirmationToCustomer,
  sendBookingNotificationToAdmin
} from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Verifica el header x-signature emitido por MP.
 *
 * Formato del header: `ts=<unix-seconds>,v1=<hex-hmac>`
 * Manifest a firmar: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * Hash: HMAC-SHA256(secret, manifest) en hex.
 *
 * Devolvemos true sólo si el secret está configurado y el hash coincide.
 * Si secret está vacío (shop no configuró el secret), devolvemos false →
 * el webhook se rechaza. Eso obliga al dueño a setear el secret antes de
 * empezar a cobrar — fail-closed.
 */
function verifyMpSignature(params: {
  secret: string | null;
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | number | null;
}): boolean {
  if (!params.secret || !params.xSignature || !params.dataId) return false;

  // Parseamos ts y v1 del header. MP a veces incluye otros pares; tomamos
  // los conocidos y el resto los ignoramos.
  const parts = params.xSignature.split(',').map(p => p.trim());
  let ts: string | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const [k, v] = p.split('=', 2);
    if (k === 'ts') ts = v;
    else if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return false;

  const manifest = `id:${params.dataId};request-id:${params.xRequestId || ''};ts:${ts};`;
  const expected = crypto.createHmac('sha256', params.secret).update(manifest).digest('hex');

  // Comparación constant-time para evitar timing attacks.
  if (expected.length !== v1.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

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

  // Traemos sólo los shops con MP activo. Si un atacante manda un payload
  // contra este endpoint sin tener un shop activo en el sistema, salimos.
  const { data: shopsWithMp } = await admin
    .from('shop_payment_settings')
    .select('shop_id, mp_access_token, mp_webhook_secret')
    .eq('is_active', true)
    .not('mp_access_token', 'is', null);

  if (!shopsWithMp || shopsWithMp.length === 0) {
    return NextResponse.json({ ok: true, no_active_shops: true }, { status: 200 });
  }

  // Validamos la firma contra cada secret de shop activo. El primer secret
  // que verifique nos dice de qué shop viene el evento sin tener que
  // adivinar/iterar tokens de MP. Esto previene el ataque cross-shop.
  const xSignature = request.headers.get('x-signature');
  const xRequestId = request.headers.get('x-request-id');
  let verifiedShopId: string | null = null;
  let verifiedToken: string | null = null;
  for (const s of shopsWithMp) {
    if (verifyMpSignature({
      secret: s.mp_webhook_secret,
      xSignature,
      xRequestId,
      dataId: paymentId
    })) {
      verifiedShopId = s.shop_id;
      verifiedToken = s.mp_access_token;
      break;
    }
  }

  if (!verifiedShopId || !verifiedToken) {
    // Fail-closed: si la firma no valida contra ningún shop, rechazamos.
    // MP reintenta unas veces; si no podemos validar nunca, es porque el
    // shop no configuró el secret o porque es un ataque.
    console.warn('[mp-webhook] firma inválida o secret no configurado', { paymentId });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // Fetchamos el pago con el token del shop verificado. Si MP responde 4xx
  // significa que el pago no pertenece a ese shop — alguien intentó cross-shop
  // con secret y payment válidos pero de cuentas distintas.
  let payment;
  try {
    payment = await fetchMpPayment(verifiedToken, paymentId);
  } catch (e) {
    console.error('[mp-webhook] no se pudo recuperar el pago', paymentId, e);
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
      // CRÍTICO: limitar al shop verificado. Sin esto un atacante con cuenta
      // MP propia podría crear un payment con external_reference apuntando a
      // un appointment de otro shop y confirmarlo sin que el shop víctima
      // cobre nada.
      .eq('shop_id', verifiedShopId)
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
    // pidió la plata de vuelta. Mismo lock por shop_id.
    await admin
      .from('appointments')
      .update({
        status: 'cancelled',
        payment_status: payment.status === 'refunded' ? 'refunded' : 'partial_refund'
      })
      .eq('id', externalRef)
      .eq('shop_id', verifiedShopId)
      .neq('status', 'cancelled');
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// El handler GET legacy quedó sin uso real: MP hace POST con x-signature, y
// un GET sin header no puede pasar la validación HMAC. Lo dejamos respondiendo
// 200 vacío por compatibilidad (algunos scrapers/checkers de MP pegan a GET).
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
