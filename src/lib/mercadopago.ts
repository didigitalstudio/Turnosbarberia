// ============================================================================
// Mercado Pago — wrapper minimal de la REST API.
//
// Usamos Checkout Pro (el cliente paga en el portal de MP). El access token
// del owner se guarda en shop_payment_settings y se pasa como Bearer.
//
// Por qué fetch() directo en vez de SDK: el SDK oficial (mercadopago) trae
// dependencias innecesarias y un wrapper que cambia frecuentemente. Para los
// dos endpoints que usamos (crear preferencia + leer payment) el JSON es
// estable y queda más explícito a nivel código qué se manda.
// ============================================================================

const MP_API = 'https://api.mercadopago.com';

export type MpPreferenceInput = {
  accessToken: string;
  externalReference: string;
  notificationUrl: string;
  backUrls: { success: string; failure: string; pending: string };
  item: { title: string; quantity: number; unit_price: number };
  /** ISO 8601. MP cierra la preferencia automáticamente si no se paga antes. */
  expirationDateTo?: string;
  payerEmail?: string;
};

export type MpPreferenceResult = {
  id: string;
  init_point: string;
  sandbox_init_point: string;
};

export async function createMpPreference(input: MpPreferenceInput): Promise<MpPreferenceResult> {
  const body = {
    external_reference: input.externalReference,
    notification_url: input.notificationUrl,
    back_urls: input.backUrls,
    auto_return: 'approved',
    binary_mode: true,
    items: [{
      title: input.item.title,
      quantity: input.item.quantity,
      unit_price: input.item.unit_price,
      currency_id: 'ARS'
    }],
    ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
    ...(input.expirationDateTo ? {
      expires: true,
      expiration_date_to: input.expirationDateTo
    } : {})
  };

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MP preferences ${res.status}: ${text}`);
  }
  return await res.json() as MpPreferenceResult;
}

export type MpPaymentStatus = 'approved' | 'pending' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';

export type MpPayment = {
  id: number;
  status: MpPaymentStatus;
  status_detail: string;
  external_reference: string | null;
  transaction_amount: number;
};

export async function fetchMpPayment(accessToken: string, paymentId: string | number): Promise<MpPayment> {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MP fetch payment ${res.status}: ${text}`);
  }
  return await res.json() as MpPayment;
}

/**
 * Reembolso parcial (o total) de un pago. MP API:
 *   POST /v1/payments/{id}/refunds  → { amount?: number }
 * Si no se manda amount, reembolsa el total. Si se manda, debe ser <= monto
 * disponible para reembolsar.
 */
export async function refundMpPayment(accessToken: string, paymentId: string | number, amount?: number) {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}/refunds`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${paymentId}-${amount ?? 'full'}-${Date.now()}`
    },
    body: JSON.stringify(amount && amount > 0 ? { amount } : {})
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MP refund ${res.status}: ${text}`);
  }
  return await res.json();
}
