// ============================================================================
// WhatsApp Cloud API — wrapper minimal.
//
// Cada shop trae sus propias credenciales (phone_number_id + access_token)
// emitidas por Meta. Para mandar mensajes de negocio (business-initiated)
// hay que usar TEMPLATES pre-aprobados — no se puede mandar texto libre.
//
// Template que asumimos pre-registrado en el WA Business Manager del cliente
// con nombre `appointment_reminder` (configurable por shop):
//
//   Hola {{1}}, te recordamos tu turno mañana a las {{2}} en {{3}} con {{4}}.
//
// Parámetros:
//   {{1}} = nombre del cliente
//   {{2}} = hora (HH:MM)
//   {{3}} = nombre del shop
//   {{4}} = nombre del barbero
//
// El cliente registra el template en business.facebook.com → WhatsApp Manager
// → Plantillas → Crear plantilla → "Utility" / es_AR.
// ============================================================================

const WA_API = 'https://graph.facebook.com/v21.0';

export type WaSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string };

/**
 * Normaliza un teléfono argentino al formato esperado por WhatsApp Cloud API
 * (E.164 sin "+", solo dígitos). Si no logra normalizar a algo razonable,
 * devuelve null.
 *
 * Reglas:
 *   - Strip todo lo que no sea dígito o "+".
 *   - Si arranca con 549... → ya OK (AR mobile internacional).
 *   - Si arranca con 54 (sin 9) → meto el 9 entre 54 y el resto (AR mobile).
 *   - Si arranca con 9... y tiene 11 dígitos → asumo AR y prepend 54.
 *   - Si tiene 10 dígitos y arranca con 11/15... → AR, prepend 549.
 *   - Si tiene < 10 dígitos → no lo mando, está mal.
 */
export function normalizeArPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length < 8) return null;

  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) {
    // AR fijo o mobile sin el "9" — para WhatsApp mobile necesitamos el 9.
    const rest = digits.slice(2);
    return `549${rest}`;
  }
  // Sin código de país. Le agregamos 549.
  if (digits.length >= 10) return `549${digits}`;
  return null;
}

export type WaReminderInput = {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  to: string;
  /** Parámetros del template, en orden ({{1}}, {{2}}, ...) */
  variables: string[];
};

export async function sendWhatsappTemplate(input: WaReminderInput): Promise<WaSendResult> {
  const payload = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.templateLanguage },
      components: [{
        type: 'body',
        parameters: input.variables.map(v => ({ type: 'text', text: v }))
      }]
    }
  };

  try {
    const res = await fetch(`${WA_API}/${input.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      // Logueamos detallado para diagnosticar templates rechazados o
      // tokens vencidos.
      console.error('[whatsapp] envío rechazado:', res.status, text.slice(0, 400));
      return { ok: false, error: `WA ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => null) as { messages?: Array<{ id: string }> } | null;
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (e: any) {
    console.error('[whatsapp] fetch falló:', e?.message);
    return { ok: false, error: e?.message || 'fetch failed' };
  }
}
