'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shared/Icon';
import { Toast } from '@/components/shared/Toast';
import { money } from '@/lib/format';
import { upsertProduct, toggleProduct } from '@/app/actions/ajustes';
import type { Product } from '@/types/db';

type Props = { products: Product[] };

type Draft = {
  id?: string;
  name: string;
  price: string;
  stock: string;
  unit: string;
  provider: string;
  cost: string;
};

const EMPTY_DRAFT: Draft = {
  name: '', price: '', stock: '0', unit: 'unidad', provider: '', cost: ''
};

export function StockView({ products }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<Draft | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const total = products.length;
  // Tier de alertas: <=3 es crítico (rojo, se está agotando ya); <10 es bajo
  // (warning, conviene reponer). El umbral lo decidió el dueño en la reunión
  // de producto — fácil de hacer configurable más adelante.
  const critical = products.filter(p => p.stock <= 3);
  const low = products.filter(p => p.stock < 10);
  const valorInventario = products.reduce((s, p) => s + Number(p.price || 0) * Number(p.stock || 0), 0);
  const costoInventario = products.reduce((s, p) => s + Number(p.cost || 0) * Number(p.stock || 0), 0);

  const open = (p?: Product) => {
    if (p) {
      setModal({
        id: p.id,
        name: p.name,
        price: String(p.price ?? ''),
        stock: String(p.stock ?? 0),
        unit: p.unit || 'unidad',
        provider: p.provider || '',
        cost: p.cost != null ? String(p.cost) : ''
      });
    } else {
      setModal({ ...EMPTY_DRAFT });
    }
  };

  const submit = () => {
    if (!modal) return;
    const name = modal.name.trim();
    const price = Number(modal.price);
    const stock = Number(modal.stock);
    const cost = modal.cost === '' ? null : Number(modal.cost);
    if (name.length < 2) { setToast({ tone: 'error', text: 'Nombre muy corto.' }); return; }
    if (!Number.isFinite(price) || price < 0) { setToast({ tone: 'error', text: 'Precio inválido.' }); return; }
    if (!Number.isInteger(stock) || stock < 0) { setToast({ tone: 'error', text: 'Stock inválido.' }); return; }
    start(async () => {
      const r = await upsertProduct({
        id: modal.id,
        name, price, stock,
        unit: modal.unit || 'unidad',
        provider: modal.provider.trim() || null,
        cost: cost as any
      });
      if (r?.error) setToast({ tone: 'error', text: r.error });
      else {
        setModal(null);
        setToast({ tone: 'success', text: modal.id ? 'Producto actualizado.' : 'Producto agregado.' });
        router.refresh();
      }
    });
  };

  const deactivate = (p: Product) => {
    if (!confirm(`Desactivar "${p.name}"? Dejará de estar disponible en caja.`)) return;
    start(async () => {
      const r = await toggleProduct(p.id, false);
      if (r?.error) setToast({ tone: 'error', text: r.error });
      else {
        setToast({ tone: 'success', text: 'Producto desactivado.' });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex-1 overflow-auto px-5 pt-3 pb-6 md:px-8">
      {/* Header acciones */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="grid grid-cols-3 gap-2 flex-1 md:max-w-2xl">
          <Stat label="Productos" value={String(total)} />
          <Stat label="Stock bajo" value={String(low.length)} accent={low.length > 0} />
          <Stat label="Inventario" value={money(valorInventario)} />
        </div>
        <button
          type="button"
          onClick={() => open()}
          className="shrink-0 bg-accent text-white px-3 py-2 rounded-m text-[12px] font-semibold flex items-center gap-1.5 active:scale-95 transition">
          <Icon name="plus" size={14} color="#fff"/>
          <span className="hidden md:inline">Agregar producto</span>
          <span className="md:hidden">Nuevo</span>
        </button>
      </div>

      {toast && (
        <div className="mb-3">
          <Toast dark tone={toast.tone} message={toast.text} onClose={() => setToast(null)} />
        </div>
      )}

      {total === 0 ? (
        <div className="bg-dark-card border border-dark-line rounded-xl px-6 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-dark-card border border-dark-line grid place-items-center mx-auto mb-4">
            <Icon name="bag" size={20}/>
          </div>
          <div className="font-display text-[22px] text-bg">Sin productos cargados</div>
          <div className="text-[13px] text-dark-muted mt-2 max-w-[300px] mx-auto">
            Agregá productos para manejar stock y venderlos desde la caja.
          </div>
          <button
            type="button"
            onClick={() => open()}
            className="mt-4 bg-accent text-white px-4 py-2.5 rounded-m text-[13px] font-semibold flex items-center gap-2 mx-auto active:scale-95 transition">
            <Icon name="plus" size={14} color="#fff"/>
            Agregar primer producto
          </button>
        </div>
      ) : (
        <>
          {critical.length > 0 && (
            <div className="mb-2 bg-accent/15 border-2 border-accent rounded-xl px-4 py-3 flex items-center gap-2">
              <Icon name="bag" size={14} color="#B6754C" />
              <span className="text-[12px] text-accent font-semibold">
                {critical.length} producto{critical.length === 1 ? '' : 's'} con 3 o menos unidades — reponer urgente.
              </span>
            </div>
          )}
          {low.length > critical.length && (
            <div className="mb-4 bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 flex items-center gap-2">
              <Icon name="bag" size={14} color="#B6754C" />
              <span className="text-[12px] text-accent">
                {low.length - critical.length} producto{low.length - critical.length === 1 ? '' : 's'} con menos de 10 unidades.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
            {products.map(p => {
              const isCritical = p.stock <= 3;
              const isLow = p.stock < 10;
              const margin = p.cost ? Number(p.price) - Number(p.cost) : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => open(p)}
                  className={`bg-dark-card border rounded-xl px-4 py-3 text-left hover:border-bg/30 transition active:scale-[0.99] ${isCritical ? 'border-accent' : 'border-dark-line'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-bg truncate">{p.name}</div>
                      {p.provider && (
                        <div className="text-[10px] text-dark-muted uppercase tracking-[1px] mt-0.5 truncate">
                          {p.provider}
                        </div>
                      )}
                    </div>
                    {isCritical ? (
                      <span className="shrink-0 text-[9px] font-bold tracking-[1.5px] uppercase bg-accent text-white border border-accent rounded-xs px-1.5 py-0.5">
                        Crítico
                      </span>
                    ) : isLow && (
                      <span className="shrink-0 text-[9px] font-bold tracking-[1.5px] uppercase bg-accent/20 text-accent border border-accent/40 rounded-xs px-1.5 py-0.5">
                        Bajo
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <div className="font-mono text-[18px] text-bg font-semibold">
                      {p.stock}
                      <span className="text-[11px] text-dark-muted font-normal ml-1">
                        {p.unit && p.unit !== 'unidad' ? p.unit : 'u'}
                      </span>
                    </div>
                    <div className="text-[13px] text-accent font-medium">{money(Number(p.price))}</div>
                  </div>
                  {margin !== null && (
                    <div className="text-[10px] text-dark-muted mt-1">
                      Costo {money(Number(p.cost))} · Margen {money(margin)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {costoInventario > 0 && (
            <div className="mt-5 bg-dark-card/60 border border-dark-line rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-dark-muted uppercase tracking-[1.5px]">Inversión estimada</div>
                <div className="font-display text-[20px] text-bg leading-none mt-1">{money(costoInventario)}</div>
              </div>
            </div>
          )}
        </>
      )}

      {modal && (
        <ProductModal
          draft={modal}
          setDraft={setModal}
          pending={pending}
          onClose={() => setModal(null)}
          onSubmit={submit}
          onDeactivate={modal.id ? () => deactivate(products.find(p => p.id === modal.id)!) : undefined}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-dark-card border rounded-xl px-3 py-2.5 ${accent ? 'border-accent/40' : 'border-dark-line'}`}>
      <div className="text-[9px] text-dark-muted uppercase tracking-[1.5px]">{label}</div>
      <div className={`font-display text-[18px] md:text-[20px] leading-none mt-1 ${accent ? 'text-accent' : 'text-bg'}`}>
        {value}
      </div>
    </div>
  );
}

function ProductModal({
  draft, setDraft, pending, onClose, onSubmit, onDeactivate
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onDeactivate?: () => void;
}) {
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v });
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink/60 backdrop-blur-sm">
      <div className="w-full md:max-w-md bg-dark border border-dark-line rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-[22px] text-bg">
            {draft.id ? 'Editar producto' : 'Nuevo producto'}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-m grid place-items-center border border-dark-line text-bg hover:border-bg/30 transition">
            <Icon name="close" size={14}/>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Nombre">
            <input value={draft.name} onChange={(e) => set('name', e.target.value)}
              placeholder="Ej. Pomada mate 120ml" maxLength={80}
              className="bg-transparent text-bg text-[15px] w-full outline-none placeholder:text-dark-muted/60"/>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Precio venta">
              <input type="number" inputMode="decimal" value={draft.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="0"
                className="bg-transparent text-bg text-[15px] w-full outline-none"/>
            </Field>
            <Field label="Stock">
              <input type="number" inputMode="numeric" value={draft.stock}
                onChange={(e) => set('stock', e.target.value)}
                placeholder="0"
                className="bg-transparent text-bg text-[15px] w-full outline-none"/>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidad">
              <select value={draft.unit} onChange={(e) => set('unit', e.target.value)}
                className="bg-transparent text-bg text-[15px] w-full outline-none">
                {['unidad', 'ml', 'g', 'kg', 'l', 'cc'].map(u => (
                  <option key={u} value={u} className="bg-dark">{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Costo (opcional)">
              <input type="number" inputMode="decimal" value={draft.cost}
                onChange={(e) => set('cost', e.target.value)}
                placeholder="0"
                className="bg-transparent text-bg text-[15px] w-full outline-none"/>
            </Field>
          </div>
          <Field label="Proveedor (opcional)">
            <input value={draft.provider} onChange={(e) => set('provider', e.target.value)}
              placeholder="Ej. Distribuidor XYZ" maxLength={80}
              className="bg-transparent text-bg text-[15px] w-full outline-none placeholder:text-dark-muted/60"/>
          </Field>
        </div>

        <div className="mt-5 flex gap-2">
          {onDeactivate && (
            <button type="button" onClick={onDeactivate} disabled={pending}
              className="px-3 py-2.5 rounded-xl border border-dark-line text-[12px] text-dark-muted hover:text-bg hover:border-bg/30 transition disabled:opacity-60">
              Desactivar
            </button>
          )}
          <div className="flex-1"/>
          <button type="button" onClick={onClose} disabled={pending}
            className="px-3 py-2.5 rounded-xl border border-dark-line text-[13px] text-bg disabled:opacity-60 hover:border-bg/30 transition">
            Cancelar
          </button>
          <button type="button" onClick={onSubmit} disabled={pending}
            className="px-4 py-2.5 rounded-xl bg-accent text-white text-[13px] font-semibold disabled:opacity-60 active:scale-[0.98] transition">
            {pending ? 'Guardando…' : (draft.id ? 'Guardar' : 'Agregar')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line block focus-within:border-accent transition">
      <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">{label}</span>
      {children}
    </label>
  );
}
