-- ============================================================================
-- TurnosBarbería — agrega 'refund_pending' a payment_status.
--
-- Cuando un cliente cancela y corresponde reembolso, marcamos el appointment
-- como payment_status='refund_pending' ANTES de llamar a la API de Mercado
-- Pago. Si el call de MP falla y el cliente reintenta, el código ve que el
-- pago ya está en flow y no dispara un segundo refund. Sumado al idempotency
-- key determinístico en refundMpPayment, blinda contra doble reembolso.
--
-- Safe to re-run.
-- ============================================================================

alter table public.appointments
  drop constraint if exists appointments_payment_status_check;

alter table public.appointments
  add constraint appointments_payment_status_check
  check (payment_status in (
    'not_required',
    'pending',
    'paid',
    'refund_pending',
    'refunded',
    'partial_refund',
    'expired'
  ));
