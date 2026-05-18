'use client';
import { useState, useTransition } from 'react';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import { startMpPaymentForAppointment } from '@/app/actions/payments';

export function PayDepositButton({
  shopSlug, appointmentId, amount
}: {
  shopSlug: string;
  appointmentId: string;
  amount: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pay = () => start(async () => {
    setError(null);
    const r = await startMpPaymentForAppointment({ shopSlug, appointmentId });
    if (r?.error) {
      setError(r.error);
      return;
    }
    if (r?.initPoint) {
      // Redirect a Mercado Pago Checkout Pro.
      window.location.href = r.initPoint;
    }
  });

  return (
    <>
      <button
        type="button"
        onClick={pay}
        disabled={pending}
        className="mt-3 w-full bg-accent text-white px-4 py-3 rounded-m text-[14px] font-semibold disabled:opacity-50 active:scale-[0.98] transition"
      >
        {pending ? 'Redirigiendo a Mercado Pago…' : `Pagar seña · ${money(amount)}`}
      </button>
      {error && (
        <div className="mt-2">
          <Toast tone="error" message={error} onClose={() => setError(null)} />
        </div>
      )}
    </>
  );
}
