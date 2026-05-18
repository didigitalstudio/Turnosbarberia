'use server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getShopBySlug } from '@/lib/shop-context';
import {
  RECENT_BOOKINGS_COOKIE,
  RECENT_BOOKINGS_MAX_AGE,
  appendRecentBooking
} from '@/lib/booking-cookie';
import {
  sendBookingConfirmationToCustomer,
  sendBookingNotificationToAdmin
} from '@/lib/email';
import { partsInAR } from '@/lib/tz';

const NAME_RE  = /^[\p{L}\s'.-]{2,80}$/u;
const PHONE_RE = /^[+\d\s()-]{6,30}$/;

/**
 * Monto de seña requerido para un servicio. Devuelve 0 si no exige seña.
 * - 'percent': % del precio (redondeado a 2 decimales).
 * - 'fixed': monto fijo en pesos.
 * - 'full': 100% del precio.
 * - 'none': 0.
 */
function computeDepositAmount(service: {
  price: number;
  deposit_type: 'none' | 'percent' | 'fixed' | 'full';
  deposit_amount: number;
}): number {
  const price = Number(service.price) || 0;
  switch (service.deposit_type) {
    case 'percent':
      return Math.round(price * (Number(service.deposit_amount) || 0)) / 100;
    case 'fixed':
      return Math.min(price, Number(service.deposit_amount) || 0);
    case 'full':
      return price;
    case 'none':
    default:
      return 0;
  }
}

const BookingSchema = z.object({
  shopSlug:          z.string().min(1).max(50),
  serviceId:         z.string().uuid(),
  barberId:          z.string().uuid().or(z.literal('any')),
  startsAt:          z.string().datetime(),
  customerName:      z.string().trim().regex(NAME_RE, 'Nombre inválido'),
  customerPhone:     z.string().trim().regex(PHONE_RE, 'Teléfono inválido'),
  customerEmail:     z.string().trim().email().max(120),
  // Si el user está reprogramando un turno existente, mandamos el id viejo
  // para cancelarlo después del insert exitoso. Sólo se cancela si el viejo
  // pertenece al user logueado y al mismo shop (defense-in-depth).
  rescheduleFromId:  z.string().uuid().optional()
});

export async function createBooking(input: z.infer<typeof BookingSchema>) {
  const parsed = BookingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'Revisá los datos: ' + parsed.error.issues.map(i => i.message).join(', ') };
  }
  const data = parsed.data;

  const shop = await getShopBySlug(data.shopSlug);
  if (!shop) return { error: 'La barbería no está disponible.' };

  // Validar rango razonable de fecha de inicio (no pasado, no más de 180 días futuro).
  const startsAt = new Date(data.startsAt);
  const now = new Date();
  const maxFuture = new Date(now.getTime() + 180 * 24 * 60 * 60_000);
  if (!(startsAt instanceof Date) || isNaN(startsAt.getTime())) {
    return { error: 'Fecha inválida.' };
  }
  if (startsAt.getTime() < now.getTime() - 60_000) {
    return { error: 'La fecha es pasada.' };
  }
  if (startsAt.getTime() > maxFuture.getTime()) {
    return { error: 'La fecha es demasiado lejana.' };
  }

  const admin = createAdminClient();

  // Antes de buscar conflictos y reservar, liberamos los holds vencidos
  // para que un slot pending_payment ya caducado no bloquee al cliente actual.
  await admin.rpc('release_expired_holds').then(() => null, () => null);

  const { data: service } = await admin
    .from('services')
    .select('id, duration_mins, price, is_active, shop_id, deposit_type, deposit_amount')
    .eq('id', data.serviceId)
    .eq('shop_id', shop.id)
    .eq('is_active', true)
    .maybeSingle<{
      id: string;
      duration_mins: number;
      price: number;
      is_active: boolean;
      shop_id: string;
      deposit_type: 'none' | 'percent' | 'fixed' | 'full';
      deposit_amount: number;
    }>();
  if (!service) {
    return { error: 'Ese servicio ya no está disponible.' };
  }

  let barberId = data.barberId;
  const endsAt = new Date(startsAt.getTime() + service.duration_mins * 60_000);

  if (barberId === 'any') {
    const { data: barbers } = await admin
      .from('barbers').select('id').eq('shop_id', shop.id).eq('is_active', true);
    for (const b of barbers || []) {
      const { data: conflicts } = await admin
        .from('appointments')
        .select('id')
        .eq('shop_id', shop.id)
        .eq('barber_id', b.id)
        .not('status', 'in', '("cancelled","no_show","expired")')
        .lt('starts_at', endsAt.toISOString())
        .gt('ends_at', startsAt.toISOString())
        .limit(1);
      if (!conflicts || conflicts.length === 0) { barberId = b.id; break; }
    }
    if (barberId === 'any') return { error: 'Ese horario ya está ocupado. Elegí otro.', code: 'SLOT_TAKEN' as const };
  } else {
    const { data: barber } = await admin
      .from('barbers').select('id').eq('id', barberId).eq('shop_id', shop.id).eq('is_active', true).maybeSingle();
    if (!barber) return { error: 'Ese barbero no pertenece a esta barbería.' };
  }

  // Validar que el horario caiga dentro del schedule del barbero para ese día,
  // SIEMPRE en hora local ARG. Si usáramos getDay()/getHours() directos,
  // Vercel (UTC) interpretaría las horas en UTC y la validación pasaría por
  // azar (o rebotaría reservas válidas).
  const startAR = partsInAR(startsAt);
  const endAR = partsInAR(endsAt);
  const { data: schedule } = await admin
    .from('schedules')
    .select('start_time, end_time, is_working')
    .eq('shop_id', shop.id)
    .eq('barber_id', barberId)
    .eq('day_of_week', startAR.dow)
    .maybeSingle();
  if (!schedule || !schedule.is_working) {
    return { error: 'El barbero no trabaja ese día.' };
  }
  const slotStart = `${startAR.hh}:${startAR.mm}`;
  const slotEnd = `${endAR.hh}:${endAR.mm}`;
  if (slotStart < schedule.start_time || slotEnd > schedule.end_time) {
    return { error: 'Ese horario está fuera del horario del barbero.' };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Para reservar tenés que iniciar sesión.', code: 'AUTH_REQUIRED' as const };
  }

  // Reprogramación: validamos PRIMERO que el turno viejo existe y pertenece
  // al user, así no terminamos con dos turnos activos si el cancel falla
  // después del insert. Si la validación falla, abortamos antes de tocar
  // nada.
  let rescheduleTargetId: string | null = null;
  if (data.rescheduleFromId) {
    const { data: oldAppt } = await admin
      .from('appointments')
      .select('id, status')
      .eq('id', data.rescheduleFromId)
      .eq('shop_id', shop.id)
      .eq('profile_id', user.id)
      .maybeSingle<{ id: string; status: string }>();
    if (!oldAppt) {
      return { error: 'No encontramos el turno a reprogramar.' };
    }
    if (oldAppt.status === 'cancelled') {
      return { error: 'Ese turno ya estaba cancelado.' };
    }
    rescheduleTargetId = oldAppt.id;
  }

  // Si el servicio exige seña, calculamos el monto y el turno se crea como
  // 'pending_payment' con un hold de 10 minutos. Sin pago confirmado en
  // ese tiempo, release_expired_holds() lo marca como 'expired' y el slot
  // queda libre nuevamente. La transición a 'confirmed' la hace el webhook
  // del payment provider (Hito 4).
  const depositAmount = computeDepositAmount(service);
  const requiresDeposit = depositAmount > 0;
  const PAYMENT_HOLD_MS = 10 * 60 * 1000;
  const expiresAt = requiresDeposit
    ? new Date(Date.now() + PAYMENT_HOLD_MS).toISOString()
    : null;

  const { data: appointment, error: insErr } = await admin
    .from('appointments')
    .insert({
      shop_id: shop.id,
      profile_id: user.id,
      barber_id: barberId,
      service_id: data.serviceId,
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      customer_email: data.customerEmail,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: requiresDeposit ? 'pending_payment' : 'confirmed',
      payment_status: requiresDeposit ? 'pending' : 'not_required',
      payment_amount: requiresDeposit ? depositAmount : null,
      payment_expires_at: expiresAt
    })
    .select('id')
    .single();

  if (insErr) {
    if (insErr.message.toLowerCase().includes('exclude')) {
      return { error: 'Ese horario se acaba de ocupar. Elegí otro.', code: 'SLOT_TAKEN' as const };
    }
    return { error: insErr.message };
  }

  // Cancel del viejo: ahora con el id ya validado. Si falla acá (red, RLS),
  // hacemos rollback del turno nuevo para no dejar dos turnos activos.
  if (rescheduleTargetId) {
    const { error: cancelErr } = await admin
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', rescheduleTargetId)
      .neq('status', 'cancelled');
    if (cancelErr) {
      console.error('[booking] reschedule cancel failed:', cancelErr.message);
      await admin.from('appointments').delete().eq('id', appointment!.id);
      return { error: 'No pudimos reprogramar tu turno. Intentá de nuevo.' };
    }
  }

  // Atar el cliente a esta barbería en su PRIMERA reserva. A partir de acá,
  // el login lo manda derecho a `/{slug}` sin que tenga que recordar la URL.
  // Si el user ya tiene shop_id (vino de otro shop) no lo pisamos: queda con
  // el primero. Si is_admin = true (es dueño), tampoco — el shop_id del
  // dueño es su panel, no una barbería de cliente.
  // También guardamos el teléfono del profile si todavía no lo tenía (legacy
  // users registrados antes de que el campo fuera obligatorio).
  const { data: prof } = await admin
    .from('profiles')
    .select('is_admin, shop_id, phone')
    .eq('id', user.id)
    .maybeSingle<{ is_admin: boolean; shop_id: string | null; phone: string | null }>();
  if (prof) {
    const patch: Record<string, unknown> = {};
    if (!prof.is_admin && !prof.shop_id) patch.shop_id = shop.id;
    if (!prof.phone && data.customerPhone) patch.phone = data.customerPhone;
    if (Object.keys(patch).length > 0) {
      await admin.from('profiles').update(patch).eq('id', user.id);
    }
  }

  // Whitelist cookie para que invitados puedan ver la página de confirmación.
  const cookieStore = cookies();
  const existing = cookieStore.get(RECENT_BOOKINGS_COOKIE)?.value;
  cookieStore.set(RECENT_BOOKINGS_COOKIE, appendRecentBooking(existing, appointment!.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: RECENT_BOOKINGS_MAX_AGE
  });

  // Emails transaccionales (best-effort, no bloquean el flujo). Skipeamos
  // los turnos pending_payment: si la seña nunca se paga, no queremos haber
  // mandado confirmación. El webhook del provider va a disparar los emails
  // cuando el pago entre.
  if (!requiresDeposit) try {
    const [{ data: svcRow }, { data: bbRow }, { data: shopOwner }] = await Promise.all([
      admin.from('services').select('name').eq('id', data.serviceId).maybeSingle<{ name: string }>(),
      admin.from('barbers').select('name').eq('id', barberId).maybeSingle<{ name: string }>(),
      shop.owner_id
        ? admin.auth.admin.getUserById(shop.owner_id)
        : Promise.resolve({ data: null } as any)
    ]);
    const serviceName = svcRow?.name || 'Servicio';
    const barberName = bbRow?.name || 'tu barbero';

    await sendBookingConfirmationToCustomer({
      to: data.customerEmail,
      customerName: data.customerName,
      shopName: shop.name,
      shopSlug: shop.slug,
      serviceName,
      barberName,
      startsAt: startsAt.toISOString()
    });

    const ownerEmail = (shopOwner as any)?.data?.user?.email;
    if (ownerEmail) {
      await sendBookingNotificationToAdmin({
        to: ownerEmail,
        shopName: shop.name,
        customerName: data.customerName,
        serviceName,
        barberName,
        startsAt: startsAt.toISOString()
      });
    }
  } catch {
    // Silencioso: un fallo de mail no debe tumbar la reserva.
  }

  revalidatePath(`/${data.shopSlug}`);
  revalidatePath(`/${data.shopSlug}/mis-turnos`);
  revalidatePath('/shop');
  redirect(`/${data.shopSlug}/confirmacion/${appointment!.id}`);
}

/**
 * Política de cancelación con reembolso parcial.
 *
 * - ≥3 hs antes del turno: se reembolsa todo lo pagado MENOS el 20% del
 *   precio del servicio (la "seña dura" no reembolsable).
 * - <3 hs antes o no-show: se pierde lo pagado.
 * - Sin pago (seña no requerida) → cancelación libre, sin reembolso que
 *   procesar.
 */
const CANCEL_WINDOW_HOURS = 3;
const NON_REFUNDABLE_PCT = 20;

export async function cancelAppointment(id: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const admin = createAdminClient();

  // Leemos el turno completo antes de cancelarlo: necesitamos saber si lleva
  // pago, cuánto, y a cuánto del turno faltamos para aplicar la política.
  const { data: appt } = await admin
    .from('appointments')
    .select('id, shop_id, profile_id, status, starts_at, payment_status, payment_amount, payment_external_id, payment_provider, service_id, services(price)')
    .eq('id', id)
    .eq('profile_id', user.id)
    .maybeSingle<{
      id: string;
      shop_id: string;
      profile_id: string;
      status: string;
      starts_at: string;
      payment_status: string;
      payment_amount: number | null;
      payment_external_id: string | null;
      payment_provider: string | null;
      service_id: string;
      services: { price: number } | null;
    }>();
  if (!appt) return { error: 'Turno no encontrado' };
  if (appt.status === 'cancelled' || appt.status === 'expired') {
    return { error: 'Ese turno ya está cancelado.' };
  }

  // Calcular cuánto reembolsar.
  const startsAtMs = new Date(appt.starts_at).getTime();
  const nowMs = Date.now();
  const hoursToStart = (startsAtMs - nowMs) / (60 * 60 * 1000);
  const inWindow = hoursToStart >= CANCEL_WINDOW_HOURS;

  let refundAmount = 0;
  let newPaymentStatus = appt.payment_status;
  let refundError: string | null = null;

  if (appt.payment_status === 'paid' && Number(appt.payment_amount || 0) > 0) {
    if (inWindow) {
      const paid = Number(appt.payment_amount);
      const servicePrice = Number(appt.services?.price || 0);
      const nonRefundable = Math.round(servicePrice * NON_REFUNDABLE_PCT) / 100;
      refundAmount = Math.max(0, paid - nonRefundable);
      // Si el refund es exactamente el monto pagado, payment_status='refunded';
      // si es parcial, 'partial_refund'; si es 0, sigue 'paid' pero el turno
      // queda cancelado igual.
      if (refundAmount > 0 && appt.payment_provider === 'mercadopago' && appt.payment_external_id) {
        try {
          const { data: settings } = await admin
            .from('shop_payment_settings')
            .select('mp_access_token, is_active')
            .eq('shop_id', appt.shop_id)
            .maybeSingle<{ mp_access_token: string | null; is_active: boolean }>();
          if (settings?.is_active && settings.mp_access_token) {
            const { refundMpPayment } = await import('@/lib/mercadopago');
            await refundMpPayment(settings.mp_access_token, appt.payment_external_id, refundAmount);
            newPaymentStatus = refundAmount >= paid ? 'refunded' : 'partial_refund';
          } else {
            refundError = 'No pudimos procesar el reembolso automáticamente. El dueño te va a contactar.';
          }
        } catch (e) {
          console.error('[cancelAppointment] MP refund failed:', e);
          refundError = 'No pudimos procesar el reembolso automáticamente. El dueño te va a contactar.';
        }
      } else if (refundAmount === 0) {
        // El reembolso da 0 (pagó exactamente la seña dura) → no llamamos a MP
        // pero igual marcamos como partial_refund para que quede el rastro de
        // que se aplicó la política.
        newPaymentStatus = 'partial_refund';
      }
    }
    // Fuera de ventana: se pierde lo pagado → payment_status sigue 'paid'.
  }

  const { error: updErr } = await admin
    .from('appointments')
    .update({ status: 'cancelled', payment_status: newPaymentStatus })
    .eq('id', id);
  if (updErr) return { error: updErr.message };

  const { data: shop } = await admin
    .from('shops').select('slug').eq('id', appt.shop_id).maybeSingle<{ slug: string }>();
  if (shop?.slug) revalidatePath(`/${shop.slug}/mis-turnos`);

  return {
    ok: true,
    refundAmount,
    inWindow,
    refundError
  };
}

const MoveSchema = z.object({
  id:        z.string().uuid(),
  startsAt:  z.string().datetime(),
  barberId:  z.string().uuid().optional()
});

export async function moveAppointment(input: z.infer<typeof MoveSchema>) {
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { error: 'Datos inválidos.' };
  const { id, startsAt, barberId: maybeBarberId } = parsed.data;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Solo admins pueden mover; y solo dentro de su shop.
  const { data: profile } = await supabase
    .from('profiles').select('is_admin, shop_id').eq('id', user.id)
    .maybeSingle<{ is_admin: boolean; shop_id: string | null }>();
  if (!profile?.is_admin || !profile.shop_id) return { error: 'Solo admins' };

  const admin = createAdminClient();
  const { data: appt } = await admin
    .from('appointments')
    .select('id, shop_id, barber_id, service_id, status, starts_at')
    .eq('id', id)
    .eq('shop_id', profile.shop_id)
    .maybeSingle<{ id: string; shop_id: string; barber_id: string; service_id: string; status: string; starts_at: string }>();
  if (!appt) return { error: 'Turno no encontrado' };
  if (TERMINAL_STATUSES.has(appt.status)) {
    return { error: 'Ese turno ya está cerrado y no se puede mover.' };
  }

  const { data: service } = await admin
    .from('services').select('id, duration_mins, is_active')
    .eq('id', appt.service_id).maybeSingle<{ id: string; duration_mins: number; is_active: boolean }>();
  if (!service) return { error: 'Servicio no disponible.' };

  const newStart = new Date(startsAt);
  if (isNaN(newStart.getTime())) return { error: 'Fecha inválida.' };
  const now = new Date();
  const maxFuture = new Date(now.getTime() + 180 * 24 * 60 * 60_000);
  if (newStart.getTime() < now.getTime() - 60_000) return { error: 'La fecha es pasada.' };
  if (newStart.getTime() > maxFuture.getTime()) return { error: 'La fecha es demasiado lejana.' };
  const newEnd = new Date(newStart.getTime() + service.duration_mins * 60_000);

  const targetBarberId = maybeBarberId || appt.barber_id;
  const { data: barber } = await admin
    .from('barbers').select('id').eq('id', targetBarberId).eq('shop_id', appt.shop_id).eq('is_active', true).maybeSingle();
  if (!barber) return { error: 'Ese barbero no pertenece a esta barbería.' };

  // Schedule del barbero ese día (en hora ARG, igual que en createBooking).
  const startAR = partsInAR(newStart);
  const endAR = partsInAR(newEnd);
  const { data: schedule } = await admin
    .from('schedules')
    .select('start_time, end_time, is_working')
    .eq('shop_id', appt.shop_id)
    .eq('barber_id', targetBarberId)
    .eq('day_of_week', startAR.dow)
    .maybeSingle();
  if (!schedule || !schedule.is_working) return { error: 'El barbero no trabaja ese día.' };
  const slotStart = `${startAR.hh}:${startAR.mm}`;
  const slotEnd = `${endAR.hh}:${endAR.mm}`;
  if (slotStart < schedule.start_time || slotEnd > schedule.end_time) {
    return { error: 'Ese horario está fuera del horario del barbero.' };
  }

  // Conflictos: cualquier otro turno activo del mismo barbero que se solape.
  const { data: conflicts } = await admin
    .from('appointments')
    .select('id')
    .eq('shop_id', appt.shop_id)
    .eq('barber_id', targetBarberId)
    .neq('status', 'cancelled')
    .neq('id', id)
    .lt('starts_at', newEnd.toISOString())
    .gt('ends_at', newStart.toISOString())
    .limit(1);
  if (conflicts && conflicts.length > 0) {
    return { error: 'Ese horario ya está ocupado.' };
  }

  const { error: updErr } = await admin
    .from('appointments')
    .update({
      barber_id: targetBarberId,
      starts_at: newStart.toISOString(),
      ends_at: newEnd.toISOString()
    })
    .eq('id', id);
  if (updErr) {
    if (updErr.message.toLowerCase().includes('exclude')) {
      return { error: 'Ese horario se acaba de ocupar.' };
    }
    return { error: updErr.message };
  }

  revalidatePath('/shop');
  return { ok: true };
}

// Estados que se consideran "cerrados" para drag&drop: no tiene sentido
// arrastrar un turno que ya pasó / no ocurrió / fue cancelado. El admin
// puede *cambiar* el estado desde el menú (incluso revertir un no_show
// si se equivocó), pero para mover el turno en el tiempo, primero
// debería revertirlo.
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

export async function setAppointmentStatus(
  id: string,
  status: 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Defense-in-depth: también validamos en el action, no solo en RLS.
  const { data: profile } = await supabase
    .from('profiles').select('is_admin, shop_id').eq('id', user.id).maybeSingle<{ is_admin: boolean; shop_id: string | null }>();
  if (!profile?.is_admin || !profile.shop_id) return { error: 'Solo admins' };

  const { data: current } = await supabase
    .from('appointments')
    .select('status')
    .eq('id', id)
    .eq('shop_id', profile.shop_id)
    .maybeSingle<{ status: string }>();
  if (!current) return { error: 'Turno no encontrado' };

  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', id)
    .eq('shop_id', profile.shop_id);
  if (error) return { error: error.message };
  revalidatePath('/shop');
  return { ok: true };
}
