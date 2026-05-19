'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shared/Icon';
import { Stripe } from '@/components/shared/Stripe';
import { EmptyState } from '@/components/shared/EmptyState';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import type { Sale, Product, Expense, PaymentMethod, TipoDoc, ClienteCondicionIva } from '@/types/db';
import {
  recordAppointmentSale,
  recordWalkInSale,
  recordProductSale,
  recordExpense
} from '@/app/actions/caja';
import { emitInvoice } from '@/app/actions/invoicing';

export type InvoiceRef = { id: string; pdf_url: string | null; numero: number | null; tipo: string };

type ApptLite = {
  id: string;
  customer_name: string;
  starts_at: string;
  service_name: string | null;
  service_price: number;
  deposit_paid: number;
  balance_due: number;
  barber_name: string | null;
  already_charged: boolean;
};

export function CashView({
  sales, products, expenses, todayAppointments, date, todayDate,
  invoicingActive, invoicedSales
}: {
  sales: Sale[];
  products: Product[];
  expenses: Expense[];
  todayAppointments: ApptLite[];
  /** Fecha seleccionada en formato YYYY-MM-DD (en TZ del shop). */
  date: string;
  /** Hoy en TZ del shop (YYYY-MM-DD). Se usa para etiquetar y para el límite del input. */
  todayDate: string;
  /** Si la facturación AFIP está habilitada y configurada para este shop. */
  invoicingActive?: boolean;
  /** Map sale_id → invoice emitida (status='emitted'). */
  invoicedSales?: Record<string, InvoiceRef>;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | 'sale' | 'expense'>(null);
  const [invoiceFor, setInvoiceFor] = useState<Sale | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const ingresos = useMemo(() => sales.reduce((s, x) => s + Number(x.amount || 0), 0), [sales]);
  const egresos = useMemo(() => expenses.reduce((s, x) => s + Number(x.amount || 0), 0), [expenses]);
  const utilidad = ingresos - egresos;
  const totServ = sales.filter(s => s.type === 'service').reduce((a, x) => a + Number(x.amount), 0);
  const totProd = sales.filter(s => s.type === 'product').reduce((a, x) => a + Number(x.amount), 0);
  const totOther = sales.filter(s => s.type === 'other').reduce((a, x) => a + Number(x.amount), 0);

  const isToday = date === todayDate;
  const dateLabel = (() => {
    if (isToday) return 'INGRESOS DE HOY';
    const [y, m, d] = date.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    return `INGRESOS · ${local.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '').toUpperCase()}`;
  })();

  const goToDate = (next: string) => {
    if (next === todayDate) router.push('/shop/caja');
    else router.push(`/shop/caja?date=${next}`);
  };
  const yesterday = (() => {
    const [y, m, d] = todayDate.split('-').map(Number);
    const t = new Date(y, m - 1, d - 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  return (
    <div className="flex-1 overflow-auto px-5 pt-4 pb-5 md:px-8">
      {toast && (
        <div className="mb-3">
          <Toast dark tone={toast.tone} message={toast.text} onClose={() => setToast(null)} />
        </div>
      )}

      {/* Date picker */}
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={() => goToDate(todayDate)} disabled={isToday}
          className={`px-3 py-2 rounded-m text-[12px] font-medium transition active:scale-[0.97] ${isToday ? 'bg-ink text-bg cursor-default' : 'bg-card border border-line text-ink hover:border-ink/30'}`}>
          Hoy
        </button>
        <button type="button" onClick={() => goToDate(yesterday)} disabled={date === yesterday}
          className={`px-3 py-2 rounded-m text-[12px] font-medium transition active:scale-[0.97] ${date === yesterday ? 'bg-ink text-bg cursor-default' : 'bg-card border border-line text-ink hover:border-ink/30'}`}>
          Ayer
        </button>
        <input
          type="date"
          value={date}
          max={todayDate}
          onChange={(e) => { if (e.target.value) goToDate(e.target.value); }}
          className="ml-auto bg-card border border-line rounded-m px-3 py-2 text-[12px] font-mono text-ink outline-none focus:border-ink/30 transition"
          aria-label="Elegir fecha"
        />
      </div>

      {/* Big total con egresos + utilidad */}
      <div className="bg-bg text-ink rounded-2xl px-5 py-4 relative overflow-hidden md:px-7 md:py-6">
        <Stripe className="absolute top-0 left-0 right-0" />
        <div className="font-mono text-[10px] tracking-[2px] text-muted mt-2">{dateLabel}</div>
        <div className="font-display text-[44px] leading-none mt-1.5 -tracking-[1px] md:text-[56px]">{money(ingresos)}</div>
        <div className="flex gap-2.5 mt-3.5 md:max-w-2xl">
          <Tile l="Servicios" v={money(totServ)} />
          <Tile l="Productos" v={money(totProd)} />
          <Tile l="Otros" v={money(totOther)} />
        </div>
        <div className="flex gap-2.5 mt-2 md:max-w-2xl">
          <Tile l="Egresos" v={money(egresos)} />
          <Tile l="Utilidad" v={money(utilidad)} accent={utilidad >= 0} />
        </div>
      </div>

      {/* CTAs */}
      <div className="flex gap-2 mt-3.5 md:max-w-xl">
        <button
          type="button"
          onClick={() => setModal('expense')}
          className="flex-1 min-h-[48px] bg-dark-card text-bg border border-dark-line px-3 py-3 rounded-l text-[13px] font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition hover:border-bg/30">
          <Icon name="close" size={14} /> Registrar gasto
        </button>
        <button
          type="button"
          onClick={() => setModal('sale')}
          className="flex-1 min-h-[48px] text-white px-3 py-3 rounded-l text-[13px] font-semibold flex items-center justify-center gap-1.5 bg-accent active:scale-[0.98] transition">
          <Icon name="plus" size={16} color="#fff" /> Registrar cobro
        </button>
      </div>

      {/* Ventas */}
      <SectionLabel className="mt-6">VENTAS · {sales.length}</SectionLabel>
      {sales.length === 0 ? (
        <EmptyState
          dark
          icon="cash"
          title="Caja vacía por ahora"
          description="Cuando cobres un servicio o vendas un producto, va a aparecer acá."
        />
      ) : (
        <SalesList
          sales={sales}
          products={products}
          invoicingActive={invoicingActive}
          invoicedSales={invoicedSales}
          onInvoice={setInvoiceFor}
        />
      )}

      {/* Gastos */}
      <SectionLabel className="mt-6">GASTOS · {expenses.length}</SectionLabel>
      {expenses.length === 0 ? (
        <div className="bg-dark-card border border-dark-line rounded-xl px-4 py-4 text-[13px] text-dark-muted">
          Sin egresos registrados hoy.
        </div>
      ) : (
        <ExpensesList expenses={expenses} />
      )}

      {modal === 'sale' && (
        <SaleModal
          onClose={() => setModal(null)}
          onDone={(text) => { setModal(null); setToast({ tone: 'success', text }); }}
          onError={(text) => setToast({ tone: 'error', text })}
          todayAppointments={todayAppointments}
          products={products}
        />
      )}
      {modal === 'expense' && (
        <ExpenseModal
          onClose={() => setModal(null)}
          onDone={(text) => { setModal(null); setToast({ tone: 'success', text }); }}
          onError={(text) => setToast({ tone: 'error', text })}
        />
      )}
      {invoiceFor && (
        <InvoiceModal
          sale={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onDone={(text) => { setInvoiceFor(null); router.refresh(); setToast({ tone: 'success', text }); }}
          onError={(text) => setToast({ tone: 'error', text })}
        />
      )}
    </div>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function SalesList({
  sales, products, invoicingActive, invoicedSales, onInvoice
}: {
  sales: Sale[];
  products: Product[];
  invoicingActive?: boolean;
  invoicedSales?: Record<string, InvoiceRef>;
  onInvoice?: (sale: Sale) => void;
}) {
  const label = (s: Sale) => {
    if (s.type === 'product') {
      return products.find(p => p.id === s.product_id)?.name || s.description || 'Producto';
    }
    if (s.type === 'other') {
      return s.description || 'Cobro libre';
    }
    return s.description || 'Servicio';
  };
  return (
    <>
      <div className="bg-dark-card border border-dark-line rounded-xl overflow-hidden md:hidden">
        {sales.map((s, i) => (
          <div key={s.id} className={`flex items-center gap-3 px-3.5 py-3 ${i < sales.length - 1 ? 'border-b border-dark-line' : ''}`}>
            <div className="w-[30px] h-[30px] rounded-s bg-dark grid place-items-center text-bg">
              <Icon name={s.type === 'product' ? 'bag' : s.type === 'other' ? 'cash' : 'scissors'} size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-bg truncate">{label(s)}</div>
              <div className="text-[11px] text-dark-muted mt-0.5 truncate">
                {new Date(s.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' })}
                {s.customer_name ? ` · ${s.customer_name}` : ''} · {labelMethod(s.payment_method)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <div className="font-mono text-[13px] font-semibold text-bg">{money(Number(s.amount))}</div>
              {(() => {
                const inv = invoicedSales?.[s.id];
                if (inv) return inv.pdf_url
                  ? <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent underline whitespace-nowrap">Fact. {inv.tipo} {inv.numero}</a>
                  : <span className="text-[10px] text-dark-muted whitespace-nowrap">Fact. {inv.tipo} {inv.numero}</span>;
                if (invoicingActive) return (
                  <button type="button" onClick={() => onInvoice?.(s)}
                    className="text-[10px] text-accent border border-accent/30 rounded px-1.5 py-0.5 hover:border-accent transition whitespace-nowrap">
                    Facturar
                  </button>
                );
                return null;
              })()}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-dark-card border border-dark-line rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-dark-line bg-dark/40">
              <Th>HORA</Th><Th>TIPO</Th><Th>DESCRIPCIÓN</Th><Th>CLIENTE</Th><Th>MÉTODO</Th><Th className="text-right">MONTO</Th><th></th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s, i) => (
              <tr key={s.id} className={`${i < sales.length - 1 ? 'border-b border-dark-line' : ''} hover:bg-dark/30 transition`}>
                <td className="px-4 py-3 font-mono text-[12px] text-bg whitespace-nowrap">
                  {new Date(s.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' })}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-bg">
                    <Icon name={s.type === 'product' ? 'bag' : s.type === 'other' ? 'cash' : 'scissors'} size={14} />
                    {s.type === 'product' ? 'Producto' : s.type === 'other' ? 'Otro' : 'Servicio'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] text-bg">{label(s)}</td>
                <td className="px-4 py-3 text-[12px] text-dark-muted">{s.customer_name || '—'}</td>
                <td className="px-4 py-3 text-[12px] text-dark-muted">{labelMethod(s.payment_method)}</td>
                <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-bg whitespace-nowrap">{money(Number(s.amount))}</td>
                <td className="px-4 py-3 text-right">
                  {(() => {
                    const inv = invoicedSales?.[s.id];
                    if (inv) return inv.pdf_url
                      ? <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent underline whitespace-nowrap">Fact. {inv.tipo} {inv.numero}</a>
                      : <span className="text-[11px] text-dark-muted whitespace-nowrap">Fact. {inv.tipo} {inv.numero}</span>;
                    if (invoicingActive) return (
                      <button type="button" onClick={() => onInvoice?.(s)}
                        className="text-[11px] text-accent border border-accent/30 rounded px-2 py-0.5 hover:border-accent transition whitespace-nowrap">
                        Facturar
                      </button>
                    );
                    return null;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExpensesList({ expenses }: { expenses: Expense[] }) {
  return (
    <div className="bg-dark-card border border-dark-line rounded-xl overflow-hidden">
      <div className="md:hidden">
        {expenses.map((e, i) => (
          <div key={e.id} className={`flex items-center gap-3 px-3.5 py-3 ${i < expenses.length - 1 ? 'border-b border-dark-line' : ''}`}>
            <div className="w-[30px] h-[30px] rounded-s bg-dark grid place-items-center text-accent">
              <Icon name="close" size={12} color="#B6754C" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-bg truncate capitalize">{e.category}</div>
              <div className="text-[11px] text-dark-muted mt-0.5 truncate">
                {new Date(e.paid_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' })}
                {e.description ? ` · ${e.description}` : ''} · {labelMethod(e.payment_method)}
              </div>
            </div>
            <div className="font-mono text-[13px] font-semibold text-accent">-{money(Number(e.amount))}</div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-dark-line bg-dark/40">
              <Th>HORA</Th><Th>CATEGORÍA</Th><Th>DESCRIPCIÓN</Th><Th>MÉTODO</Th><Th className="text-right">MONTO</Th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e, i) => (
              <tr key={e.id} className={`${i < expenses.length - 1 ? 'border-b border-dark-line' : ''}`}>
                <td className="px-4 py-3 font-mono text-[12px] text-bg">
                  {new Date(e.paid_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' })}
                </td>
                <td className="px-4 py-3 text-[13px] text-bg capitalize">{e.category}</td>
                <td className="px-4 py-3 text-[12px] text-dark-muted">{e.description || '—'}</td>
                <td className="px-4 py-3 text-[12px] text-dark-muted">{labelMethod(e.payment_method)}</td>
                <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-accent whitespace-nowrap">-{money(Number(e.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

type SaleTab = 'appointment' | 'walkin' | 'product';

function SaleModal({
  onClose, onDone, onError, todayAppointments, products
}: {
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
  todayAppointments: ApptLite[];
  products: Product[];
}) {
  const [tab, setTab] = useState<SaleTab>('appointment');
  const [pending, start] = useTransition();

  // Appointment state
  const pendingAppts = todayAppointments.filter(a => !a.already_charged);
  const [apptId, setApptId] = useState(pendingAppts[0]?.id || '');
  const selectedAppt = pendingAppts.find(a => a.id === apptId);
  // Pre-cargamos el saldo (precio total menos seña ya cobrada por MP), no el
  // precio total. Si nunca hubo seña, balance_due == service_price.
  const [apptAmount, setApptAmount] = useState(selectedAppt?.balance_due || selectedAppt?.service_price || 0);
  const [apptMethod, setApptMethod] = useState<PaymentMethod>('efectivo');

  // Walk-in state
  const [wDesc, setWDesc] = useState('');
  const [wAmount, setWAmount] = useState(0);
  const [wMethod, setWMethod] = useState<PaymentMethod>('efectivo');

  // Product state
  const activeProducts = products.filter(p => p.is_active);
  const [pid, setPid] = useState(activeProducts[0]?.id || '');
  const product = activeProducts.find(p => p.id === pid);
  const [qty, setQty] = useState(1);
  const [pMethod, setPMethod] = useState<PaymentMethod>('efectivo');

  const submit = () => start(async () => {
    if (tab === 'appointment') {
      if (!apptId) return onError('Elegí un turno');
      const r = await recordAppointmentSale({ appointmentId: apptId, amount: apptAmount, paymentMethod: apptMethod });
      if (r?.error) return onError(r.error);
      onDone('Cobro registrado');
    } else if (tab === 'walkin') {
      const r = await recordWalkInSale({ description: wDesc, amount: wAmount, paymentMethod: wMethod });
      if (r?.error) return onError(r.error);
      onDone('Cobro libre registrado');
    } else {
      if (!pid) return onError('Elegí un producto');
      const r = await recordProductSale({ productId: pid, quantity: qty, paymentMethod: pMethod });
      if (r?.error) return onError(r.error);
      onDone('Venta registrada');
    }
  });

  return (
    <ModalShell title="Registrar cobro" onClose={onClose}>
      <div className="flex gap-1 bg-dark border border-dark-line rounded-l p-1 mb-3">
        <TabBtn active={tab === 'appointment'} onClick={() => setTab('appointment')}>Turno</TabBtn>
        <TabBtn active={tab === 'walkin'} onClick={() => setTab('walkin')}>Walk-in</TabBtn>
        <TabBtn active={tab === 'product'} onClick={() => setTab('product')}>Producto</TabBtn>
      </div>

      {tab === 'appointment' && (
        <div className="flex flex-col gap-2.5">
          {pendingAppts.length === 0 ? (
            <div className="text-[13px] text-dark-muted">No hay turnos pendientes de cobro para hoy.</div>
          ) : (
            <>
              <Select label="Turno de hoy" value={apptId} onChange={(v) => {
                setApptId(v);
                const a = pendingAppts.find(x => x.id === v);
                if (a) setApptAmount(a.balance_due || a.service_price);
              }}>
                {pendingAppts.map(a => (
                  <option key={a.id} value={a.id}>
                    {formatTime(a.starts_at)} · {a.customer_name} · {a.service_name || '—'}{a.barber_name ? ` (${a.barber_name})` : ''}
                  </option>
                ))}
              </Select>
              {selectedAppt && selectedAppt.deposit_paid > 0 && (
                <div className="bg-accent/10 border border-accent/30 rounded-m px-3 py-2 text-[12px] text-bg leading-relaxed">
                  <div className="font-mono text-[10px] tracking-[1.5px] text-accent uppercase mb-0.5">Seña ya cobrada</div>
                  El cliente pagó <span className="font-mono">{money(selectedAppt.deposit_paid)}</span> al reservar vía Mercado Pago.
                  Queda por cobrar <span className="font-mono font-semibold">{money(selectedAppt.balance_due)}</span> del precio total ({money(selectedAppt.service_price)}).
                </div>
              )}
              <NumberField label={selectedAppt && selectedAppt.deposit_paid > 0 ? 'Saldo a cobrar' : 'Monto'} value={apptAmount} onChange={setApptAmount} />
              <MethodSelect value={apptMethod} onChange={setApptMethod} />
            </>
          )}
        </div>
      )}

      {tab === 'walkin' && (
        <div className="flex flex-col gap-2.5">
          <TextField label="Descripción del servicio" value={wDesc} onChange={setWDesc} placeholder="Corte walk-in" />
          <NumberField label="Monto" value={wAmount} onChange={setWAmount} />
          <MethodSelect value={wMethod} onChange={setWMethod} />
        </div>
      )}

      {tab === 'product' && (
        <div className="flex flex-col gap-2.5">
          {activeProducts.length === 0 ? (
            <div className="text-[13px] text-dark-muted">No hay productos activos. Agregalos desde Ajustes.</div>
          ) : (
            <>
              <Select label="Producto" value={pid} onChange={setPid}>
                {activeProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(Number(p.price))} · stock {p.stock}
                  </option>
                ))}
              </Select>
              <NumberField label="Cantidad" value={qty} onChange={v => setQty(Math.max(1, Math.floor(v)))} />
              <div className="text-[12px] text-dark-muted">
                Total: <span className="font-mono text-bg">{money((product?.price || 0) * qty)}</span>
              </div>
              <MethodSelect value={pMethod} onChange={setPMethod} />
            </>
          )}
        </div>
      )}

      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} />
    </ModalShell>
  );
}

function ExpenseModal({
  onClose, onDone, onError
}: {
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [pending, start] = useTransition();
  const [category, setCategory] = useState('insumos');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');

  const submit = () => start(async () => {
    const r = await recordExpense({ category, description, amount, paymentMethod: method });
    if (r?.error) return onError(r.error);
    onDone('Gasto registrado');
  });

  return (
    <ModalShell title="Registrar gasto" onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <Select label="Categoría" value={category} onChange={setCategory}>
          <option value="alquiler">Alquiler</option>
          <option value="insumos">Insumos</option>
          <option value="servicios">Servicios</option>
          <option value="sueldos">Sueldos</option>
          <option value="otros">Otros</option>
        </Select>
        <TextField label="Descripción (opcional)" value={description} onChange={setDescription} placeholder="Detalle del gasto" />
        <NumberField label="Monto" value={amount} onChange={setAmount} />
        <MethodSelect value={method} onChange={setMethod} />
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Registrar gasto" />
    </ModalShell>
  );
}

function InvoiceModal({
  sale, onClose, onDone, onError
}: {
  sale: Sale;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [pending, start] = useTransition();
  const [tipoDoc, setTipoDoc] = useState<TipoDoc>('CF');
  const [nroDoc, setNroDoc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [condicionIva, setCondicionIva] = useState<ClienteCondicionIva>('CF');
  const [email, setEmail] = useState('');
  const [enviaPorMail, setEnviaPorMail] = useState(false);

  const submit = () => start(async () => {
    const r = await emitInvoice({
      saleId: sale.id,
      cliente: {
        tipo_doc: tipoDoc,
        nro_doc: nroDoc || undefined,
        razon_social: razonSocial || undefined,
        condicion_iva: condicionIva,
        email: email || undefined,
      },
      envia_por_mail: enviaPorMail,
    });
    if ('error' in r) return onError(r.error);
    if (r.pdfUrl) window.open(r.pdfUrl, '_blank', 'noopener,noreferrer');
    onDone(`Factura emitida · CAE ${r.cae}`);
  });

  return (
    <ModalShell title="Emitir factura" onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <div className="bg-dark border border-dark-line rounded-m px-3 py-2 text-[12px] text-dark-muted">
          <span className="text-bg">{sale.description || 'Servicio'}</span>
          <span className="font-mono font-semibold text-bg ml-2">{money(Number(sale.amount))}</span>
        </div>
        <Select label="Tipo de documento" value={tipoDoc} onChange={v => {
          setTipoDoc(v as TipoDoc);
          if (v === 'CF') { setNroDoc(''); setRazonSocial(''); setCondicionIva('CF'); }
        }}>
          <option value="CF">Consumidor Final (sin datos)</option>
          <option value="DNI">DNI</option>
          <option value="CUIT">CUIT</option>
        </Select>
        {tipoDoc !== 'CF' && (
          <TextField
            label={tipoDoc === 'DNI' ? 'Número de DNI' : 'Número de CUIT'}
            value={nroDoc}
            onChange={setNroDoc}
            placeholder={tipoDoc === 'DNI' ? '12345678' : '20-12345678-9'}
          />
        )}
        {tipoDoc === 'CUIT' && (
          <TextField label="Razón social" value={razonSocial} onChange={setRazonSocial} placeholder="Nombre o empresa" />
        )}
        {tipoDoc !== 'CF' && (
          <Select label="Condición IVA" value={condicionIva} onChange={v => setCondicionIva(v as ClienteCondicionIva)}>
            <option value="CF">Consumidor Final</option>
            <option value="RI">Responsable Inscripto</option>
            <option value="MONOTRIBUTO">Monotributista</option>
            <option value="EXENTO">Exento</option>
          </Select>
        )}
        <TextField label="Email del cliente (opcional)" value={email} onChange={setEmail} placeholder="cliente@email.com" />
        <label className="flex items-center gap-2 text-[13px] text-dark-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enviaPorMail}
            disabled={!email}
            onChange={e => setEnviaPorMail(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          Enviar factura por email al cliente
        </label>
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Emitir factura" />
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[460px] bg-dark-card border border-dark-line rounded-xl p-5 md:p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-[22px] text-bg">{title}</div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-m border border-dark-line grid place-items-center text-bg hover:border-bg/30 transition">
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSubmit, pending, submitLabel = 'Registrar cobro' }: {
  onClose: () => void; onSubmit: () => void; pending: boolean; submitLabel?: string;
}) {
  return (
    <div className="flex gap-2 mt-4">
      <button type="button" onClick={onClose} disabled={pending}
        className="flex-1 px-3 py-2.5 rounded-m border border-dark-line text-bg text-[13px] font-medium hover:border-bg/30 transition">
        Cancelar
      </button>
      <button type="button" onClick={onSubmit} disabled={pending}
        className="flex-1 px-3 py-2.5 rounded-m bg-accent text-white text-[13px] font-semibold disabled:opacity-50 active:scale-[0.98] transition">
        {pending ? 'Guardando…' : submitLabel}
      </button>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 px-3 py-1.5 rounded-m text-[12px] font-medium transition
        ${active ? 'bg-bg text-ink' : 'text-dark-muted hover:text-bg'}`}>
      {children}
    </button>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="bg-dark border border-dark-line rounded-m px-3 py-2 block focus-within:border-bg/30 transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-0.5">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-transparent text-bg w-full outline-none text-[13px]">
        {children}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="bg-dark border border-dark-line rounded-m px-3 py-2 block focus-within:border-bg/30 transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-0.5">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="bg-transparent text-bg w-full outline-none text-[14px]" />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="bg-dark border border-dark-line rounded-m px-3 py-2 block focus-within:border-bg/30 transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-0.5">{label}</span>
      <input type="number" min={0} inputMode="numeric" value={value}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="bg-transparent text-bg w-full outline-none font-mono text-[14px]" />
    </label>
  );
}

function MethodSelect({ value, onChange }: { value: PaymentMethod; onChange: (v: PaymentMethod) => void }) {
  return (
    <Select label="Método de pago" value={value} onChange={v => onChange(v as PaymentMethod)}>
      <option value="efectivo">Efectivo</option>
      <option value="transferencia">Transferencia</option>
      <option value="debito">Débito</option>
      <option value="credito">Crédito</option>
    </Select>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Tile({ l, v, accent }: { l: string; v: string; accent?: boolean }) {
  return (
    <div className={`flex-1 border px-3 py-2.5 rounded-m ${accent ? 'bg-bg/60 border-line' : 'bg-bg border-line'}`}>
      <div className="text-[10px] text-muted uppercase">{l}</div>
      <div className={`font-mono text-[15px] font-semibold mt-0.5 ${accent ? 'text-accent' : ''}`}>{v}</div>
    </div>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] tracking-[2px] text-dark-muted mb-2.5 ${className}`}>{children}</div>;
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`font-mono text-[10px] tracking-[2px] text-dark-muted font-normal px-4 py-3 ${className}`}>{children}</th>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false , timeZone: 'America/Argentina/Buenos_Aires' });
}

function labelMethod(m: string) {
  switch (m) {
    case 'efectivo': return 'Efectivo';
    case 'transferencia': return 'Transferencia';
    case 'debito': return 'Débito';
    case 'credito': return 'Crédito';
    default: return m;
  }
}
