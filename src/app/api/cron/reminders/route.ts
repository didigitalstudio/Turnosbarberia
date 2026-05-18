import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { sendAppointmentReminderToCustomer } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Cron diario: manda recordatorio a clientes con turno para MAÑANA.
// Vercel Cron llama a este endpoint con header `Authorization: Bearer CRON_SECRET`.
// Idempotente: usa un flag `notes` con marca `[REMINDER_SENT]` para no duplicar.

const REMINDER_TAG = '[REMINDER_SENT]';

function auth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!auth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Rango: desde "mañana 00:00 AR" hasta "mañana 23:59:59 AR".
  // AR no tiene DST desde 2009, así que usar offset fijo -03 está OK.
  const now = new Date();
  const tomorrowStart = new Date(now.getTime() + 24 * 60 * 60_000);
  tomorrowStart.setUTCHours(3, 0, 0, 0); // 00:00 AR = 03:00 UTC
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60_000);

  const { data: appointments, error } = await admin
    .from('appointments')
    .select('id, starts_at, customer_name, customer_email, notes, shop_id, payment_status, payment_amount, barbers(name), services(name, price), shops(name, slug)')
    .gte('starts_at', tomorrowStart.toISOString())
    .lt('starts_at', tomorrowEnd.toISOString())
    .in('status', ['pending', 'confirmed'])
    .order('starts_at');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const a of appointments || []) {
    const row = a as any;
    const notes = String(row.notes || '');
    if (notes.includes(REMINDER_TAG)) { skipped++; continue; }
    if (!row.customer_email) { skipped++; continue; }

    // Si pagó seña, calculamos el saldo restante para incluirlo en el recordatorio.
    const price = Number(row.services?.price || 0);
    const deposit = row.payment_status === 'paid' ? Number(row.payment_amount || 0) : 0;
    const balanceDue = Math.max(0, price - deposit);

    const result = await sendAppointmentReminderToCustomer({
      to: row.customer_email,
      customerName: row.customer_name || '',
      shopName: row.shops?.name || 'tu barbería',
      shopSlug: row.shops?.slug || '',
      serviceName: row.services?.name || 'servicio',
      barberName: row.barbers?.name || '',
      startsAt: row.starts_at,
      balanceDue: deposit > 0 ? balanceDue : undefined
    });

    if ('ok' in result && result.ok) {
      sent++;
      // Marca anti-duplicado en notes.
      const newNotes = notes ? `${notes} ${REMINDER_TAG}` : REMINDER_TAG;
      await admin.from('appointments').update({ notes: newNotes }).eq('id', row.id);
    } else {
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: (appointments || []).length,
    sent,
    skipped,
    failed
  });
}
