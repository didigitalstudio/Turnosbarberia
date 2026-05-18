/**
 * Emails transaccionales vía Resend.
 *
 * No tira si falta RESEND_API_KEY — en dev devuelve `{ ok: true, skipped: true }`.
 * Hasta que verifiquemos un dominio propio usamos el remitente default de Resend.
 */

// Default usable solo en sandbox: Resend SOLO permite mandar al email del
// owner de la cuenta cuando from = onboarding@resend.dev. Para mandar a
// terceros (clientes y dueños random) hay que verificar un dominio propio
// en Resend y setear EMAIL_FROM en producción, ej:
//   EMAIL_FROM="TurnosBarbería <notificaciones@didigitalstudio.com>"
const DEFAULT_FROM = process.env.EMAIL_FROM || 'TurnosBarbería <onboarding@resend.dev>';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'info@didigitalstudio.com';

export type SendResult =
  | { ok: true; id?: string; skipped?: boolean }
  | { ok: false; error: string };

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY no configurada — mail skip:', params.subject, '→', params.to);
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: params.from || DEFAULT_FROM,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        reply_to: params.replyTo
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Loguear detallado para que aparezca en Vercel logs cuando falla.
      console.error('[email] Resend rechazó:', res.status, text.slice(0, 400),
        '— from:', params.from || DEFAULT_FROM, '→', params.to);
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: data?.id };
  } catch (e: any) {
    console.error('[email] fetch falló:', e?.message);
    return { ok: false, error: e?.message || 'fetch failed' };
  }
}

// ─── Helpers de composición ─────────────────────────────────────────────────

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F3EE;font-family:Helvetica,Arial,sans-serif;color:#0E0E0E;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border:1px solid #E3DFD6;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #E3DFD6;">
          <div style="font-family:'Instrument Serif',Times,serif;font-size:22px;letter-spacing:-0.3px;color:#0E0E0E;">TurnosBarbería</div>
        </td></tr>
        <tr><td style="padding:24px;font-size:14px;line-height:1.55;color:#0E0E0E;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #E3DFD6;background:#F5F3EE;font-size:11px;color:#7A766E;">
          Este email fue enviado automáticamente por TurnosBarbería.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(label: string, href: string): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:#0E0E0E;color:#F5F3EE;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600;font-size:13px;">${escapeHtml(label)}</a>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

// ─── Templates ───────────────────────────────────────────────────────────────

export async function sendAppointmentReminderToCustomer(args: {
  to: string;
  customerName: string;
  shopName: string;
  shopSlug: string;
  serviceName: string;
  barberName: string;
  startsAt: string; // ISO
  /** Si tuvo seña, monto restante a pagar el día del turno. Si no aplica, omitir. */
  balanceDue?: number;
}): Promise<SendResult> {
  const when = formatWhen(args.startsAt);
  const link = `${siteUrl()}/${args.shopSlug}/mis-turnos`;
  const balance = Number(args.balanceDue || 0);
  const balanceLine = balance > 0
    ? `<li>Saldo a pagar en el local: <b>${escapeHtml(formatMoney(balance))}</b></li>`
    : '';
  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:26px;line-height:1.15;margin:0 0 6px;">Recordatorio de turno</div>
    <div style="color:#7A766E;font-size:12px;margin-bottom:16px;">en ${escapeHtml(args.shopName)}</div>
    <p>Hola ${escapeHtml(args.customerName)}, te esperamos mañana:</p>
    <ul style="padding-left:18px;margin:8px 0 18px;">
      <li><b>${escapeHtml(args.serviceName)}</b> con <b>${escapeHtml(args.barberName)}</b></li>
      <li>${escapeHtml(when)}</li>
      ${balanceLine}
    </ul>
    <p style="margin:18px 0 6px;">${button('Ver mi turno', link)}</p>
    <p style="color:#7A766E;font-size:12px;margin-top:18px;">Si no vas a poder ir, cancelalo desde la app así liberamos el horario para alguien más.</p>
  `;
  return sendEmail({ to: args.to, subject: `Mañana: ${args.serviceName} en ${args.shopName}`, html: shell('Recordatorio', body) });
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
}

export async function sendBookingConfirmationToCustomer(args: {
  to: string;
  customerName: string;
  shopName: string;
  shopSlug: string;
  serviceName: string;
  barberName: string;
  startsAt: string; // ISO
  /** Si entró pago de seña vía MP, monto. Sin esto, se omite el bloque de recibo. */
  depositPaid?: number;
  servicePrice?: number;
}): Promise<SendResult> {
  const when = formatWhen(args.startsAt);
  const link = `${siteUrl()}/${args.shopSlug}/mis-turnos`;
  const deposit = Number(args.depositPaid || 0);
  const price = Number(args.servicePrice || 0);
  const balance = Math.max(0, price - deposit);
  const receiptBlock = deposit > 0 ? `
    <div style="margin:16px 0;padding:14px 16px;background:#F5F3EE;border:1px solid #E3DFD6;border-radius:10px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#7A766E;margin-bottom:6px;">Recibo de seña</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">
        <tr><td style="color:#7A766E;">Seña pagada</td><td align="right" style="font-family:monospace;font-weight:600;">${escapeHtml(formatMoney(deposit))}</td></tr>
        ${price > 0 ? `<tr><td style="color:#7A766E;">Precio total</td><td align="right" style="font-family:monospace;">${escapeHtml(formatMoney(price))}</td></tr>` : ''}
        ${balance > 0 ? `<tr><td style="color:#7A766E;">Saldo el día del turno</td><td align="right" style="font-family:monospace;font-weight:600;">${escapeHtml(formatMoney(balance))}</td></tr>` : ''}
      </table>
    </div>
    <p style="color:#7A766E;font-size:11px;margin:8px 0 0;">Política de cancelación: hasta 3 hs antes del turno te devolvemos todo menos el 20% del precio del servicio. Después no hay reembolso.</p>
  ` : '';

  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:26px;line-height:1.15;margin:0 0 6px;">Turno confirmado</div>
    <div style="color:#7A766E;font-size:12px;margin-bottom:16px;">en ${escapeHtml(args.shopName)}</div>
    <p>Hola ${escapeHtml(args.customerName)}, reservaste:</p>
    <ul style="padding-left:18px;margin:8px 0 18px;">
      <li><b>${escapeHtml(args.serviceName)}</b> con <b>${escapeHtml(args.barberName)}</b></li>
      <li>${escapeHtml(when)}</li>
    </ul>
    ${receiptBlock}
    <p style="margin:18px 0 6px;">${button('Ver mis turnos', link)}</p>
    <p style="color:#7A766E;font-size:12px;margin-top:18px;">Si no vas a poder ir, cancelá desde la app así liberamos el horario.</p>
  `;
  return sendEmail({ to: args.to, subject: `Turno confirmado en ${args.shopName}`, html: shell('Turno confirmado', body) });
}

export async function sendBookingNotificationToAdmin(args: {
  to: string;
  shopName: string;
  customerName: string;
  serviceName: string;
  barberName: string;
  startsAt: string;
}): Promise<SendResult> {
  const when = formatWhen(args.startsAt);
  const time = new Date(args.startsAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:24px;line-height:1.15;margin:0 0 6px;">Nuevo turno</div>
    <div style="color:#7A766E;font-size:12px;margin-bottom:16px;">${escapeHtml(args.shopName)}</div>
    <p><b>${escapeHtml(args.customerName)}</b> reservó a las <b>${escapeHtml(time)}</b> con <b>${escapeHtml(args.barberName)}</b>.</p>
    <p style="color:#7A766E;">${escapeHtml(when)} · ${escapeHtml(args.serviceName)}</p>
    <p style="margin-top:16px;">${button('Abrir agenda', `${siteUrl()}/shop`)}</p>
  `;
  return sendEmail({ to: args.to, subject: `Nuevo turno: ${args.customerName} a las ${time} con ${args.barberName}`, html: shell('Nuevo turno', body) });
}

export async function sendNewShopNotificationToSuperAdmin(args: {
  slug: string;
  name: string;
  ownerEmail: string;
}): Promise<SendResult> {
  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:24px;line-height:1.15;margin:0 0 6px;">Nueva barbería — aprobar</div>
    <p>Se registró una barbería nueva:</p>
    <ul style="padding-left:18px;">
      <li><b>${escapeHtml(args.name)}</b></li>
      <li>Slug: <code>${escapeHtml(args.slug)}</code></li>
      <li>Owner: ${escapeHtml(args.ownerEmail)}</li>
    </ul>
    <p style="margin-top:16px;">${button('Revisar en /desarrollo', `${siteUrl()}/desarrollo`)}</p>
  `;
  return sendEmail({
    to: SUPER_ADMIN_EMAIL,
    subject: `Nueva barbería registrada: ${args.name}`,
    html: shell('Nueva barbería', body)
  });
}

export async function sendShopActivatedToOwner(args: {
  to: string;
  shopName: string;
  shopSlug: string;
}): Promise<SendResult> {
  const link = `${siteUrl()}/${args.shopSlug}`;
  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:24px;line-height:1.15;margin:0 0 6px;">Tu barbería está activa</div>
    <p>Felicitaciones, <b>${escapeHtml(args.shopName)}</b> ya está visible para tus clientes.</p>
    <p>Tu link público:</p>
    <p><a href="${escapeAttr(link)}" style="color:#B6754C;font-weight:600;">${escapeHtml(link)}</a></p>
    <p style="margin-top:16px;">${button('Abrir mi panel', `${siteUrl()}/shop`)}</p>
  `;
  return sendEmail({ to: args.to, subject: `Tu barbería está activa: ${args.shopName}`, html: shell('Barbería activa', body) });
}

export async function sendOwnerPasswordReset(args: {
  to: string;
  tempPassword: string;
  shopName: string;
}): Promise<SendResult> {
  const link = `${siteUrl()}/login`;
  const body = `
    <div style="font-family:'Instrument Serif',Times,serif;font-size:24px;line-height:1.15;margin:0 0 6px;">Contraseña restablecida</div>
    <p>Para <b>${escapeHtml(args.shopName)}</b>. Entrá con esta contraseña temporal:</p>
    <p style="margin:14px 0;">
      <code style="display:inline-block;background:#F5F3EE;border:1px solid #E3DFD6;border-radius:8px;padding:10px 14px;font-size:16px;letter-spacing:1px;">${escapeHtml(args.tempPassword)}</code>
    </p>
    <p style="color:#7A766E;">Cambiala desde Ajustes apenas ingreses.</p>
    <p style="margin-top:16px;">${button('Ir a login', link)}</p>
  `;
  return sendEmail({ to: args.to, subject: 'Contraseña temporal de TurnosBarbería', html: shell('Contraseña', body) });
}

function formatWhen(iso: string): string {
  // Forzamos timeZone ARG: si no lo hacemos, el render server-side cae en
  // UTC y el dueño/cliente recibe el mail con una hora distinta a la real.
  return new Date(iso).toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires'
  });
}
