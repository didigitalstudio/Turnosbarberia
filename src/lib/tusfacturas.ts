// ============================================================================
// TusFacturasAPP — wrapper minimal de la REST API.
//
// Emite comprobantes electrónicos AFIP usando las credenciales (api_key,
// api_token, user_token) que el shop guarda en shop_invoicing_settings.
//
// Por qué fetch() directo: TusFacturas no tiene SDK oficial JS y los payloads
// son JSON estables. Manteniendo el wrapper acá es fácil cambiar de proveedor
// (AfipSDK, WSFE directo) sin tocar las server actions.
// ============================================================================

import type { ClienteCondicionIva, IvaCondition, TipoDoc } from '@/types/db';

const TF_API_BASE = (process.env.TUSFACTURAS_API_BASE || 'https://www.tusfacturas.app/app/api/v2').replace(/\/$/, '');

export type TusFacturasCreds = {
  apiKey: string;
  apiToken: string;
  userToken: string;
};

export type TusFacturasItem = {
  descripcion: string;
  cantidad: number;
  precio_unitario_sin_iva: number;
  alicuota_iva: number; // 0, 10.5, 21, 27
};

export type TusFacturasInvoiceInput = {
  creds: TusFacturasCreds;
  // Datos fiscales del emisor.
  emisor: {
    cuit: string;
    razon_social: string;
    punto_venta: number;
    condicion_iva: IvaCondition;
  };
  // Cliente: si es Consumidor Final sin DNI/CUIT, dejá vacíos.
  cliente: {
    tipo_doc: TipoDoc;
    nro_doc?: string;
    razon_social?: string;
    condicion_iva: ClienteCondicionIva;
    email?: string;
    domicilio?: string;
  };
  // Tipo de comprobante: 'FACTURA A', 'FACTURA B', 'FACTURA C', 'NOTA DE CREDITO B'...
  // Si no se pasa, lo deducimos por la condición IVA emisor + cliente.
  tipo?: string;
  items: TusFacturasItem[];
  // Fecha de emisión. Default = hoy.
  fecha?: Date;
  // Si querés que TusFacturas mandé el PDF por email al cliente.
  envia_por_mail?: boolean;
  external_reference?: string;
};

export type TusFacturasInvoiceResult = {
  ok: boolean;
  cae?: string;
  cae_vencimiento?: string; // ISO date (YYYY-MM-DD)
  numero?: number;
  punto_venta?: number;
  comprobante_tipo?: string;
  pdf_url?: string;
  external_id?: string;
  error_msg?: string;
  raw: unknown;
};

// Mapeo de condición IVA al código de TusFacturas/AFIP.
function condicionIvaCode(c: ClienteCondicionIva): string {
  switch (c) {
    case 'RI':          return 'RI';
    case 'MONOTRIBUTO': return 'M';
    case 'EXENTO':      return 'E';
    case 'CF':          return 'CF';
  }
}

// Determina el tipo de factura cuando no viene explícito. Regla AFIP:
//   - Emisor RI → A si cliente RI/Monotributo (con CUIT), B en otro caso
//   - Emisor Monotributo → siempre C
//   - Emisor Exento → C
function inferTipo(emisorIva: IvaCondition, clienteIva: ClienteCondicionIva): string {
  if (emisorIva === 'MONOTRIBUTO' || emisorIva === 'EXENTO') return 'FACTURA C';
  // RI
  if (clienteIva === 'RI' || clienteIva === 'MONOTRIBUTO') return 'FACTURA A';
  return 'FACTURA B';
}

// dd/mm/yyyy para TusFacturas.
function formatFechaAR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// AFIP/TusFacturas espera fechas como dd/mm/yyyy. Re-parseo a ISO para guardar.
function parseFechaAR(s: string | undefined): string | undefined {
  if (!s || !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return undefined;
  const [dd, mm, yyyy] = s.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createTusFacturasInvoice(input: TusFacturasInvoiceInput): Promise<TusFacturasInvoiceResult> {
  const tipo = input.tipo || inferTipo(input.emisor.condicion_iva, input.cliente.condicion_iva);
  const fecha = formatFechaAR(input.fecha || new Date());

  // En factura A se discrimina IVA: el item lleva precio sin IVA y alícuota.
  // En B/C el precio del item ya es el total con IVA (no se discrimina).
  const esA = tipo.toUpperCase().includes('FACTURA A');

  const detalle = input.items.map(it => {
    const precioBase = esA ? it.precio_unitario_sin_iva : round2(it.precio_unitario_sin_iva * (1 + it.alicuota_iva / 100));
    return {
      cantidad: String(it.cantidad),
      afecta_stock: 'N',
      actualiza_precio: 'N',
      bonificacion_porcentaje: '0',
      producto: {
        descripcion: it.descripcion,
        unidad_bulto: '1',
        precio_unitario_sin_iva: precioBase.toFixed(2),
        alicuota: String(it.alicuota_iva)
      }
    };
  });

  const total = round2(
    input.items.reduce((sum, it) => sum + it.cantidad * it.precio_unitario_sin_iva * (1 + it.alicuota_iva / 100), 0)
  );

  const body = {
    apikey: input.creds.apiKey,
    apitoken: input.creds.apiToken,
    usertoken: input.creds.userToken,
    cliente: {
      documento_tipo: input.cliente.tipo_doc,
      documento_nro: input.cliente.nro_doc || '0',
      razon_social: input.cliente.razon_social || 'Consumidor Final',
      email: input.cliente.email || '',
      domicilio: input.cliente.domicilio || '',
      provincia: '2',
      envia_por_mail: input.envia_por_mail && input.cliente.email ? 'S' : 'N',
      condicion_pago: '201',
      condicion_iva: condicionIvaCode(input.cliente.condicion_iva)
    },
    comprobante: {
      fecha,
      tipo,
      operacion: 'V',
      punto_venta: String(input.emisor.punto_venta).padStart(5, '0'),
      numero: '',
      moneda: 'PES',
      cotizacion: '1',
      concepto: '2', // 1=Productos, 2=Servicios, 3=Productos+Servicios
      detalle,
      total: total.toFixed(2),
      external_reference: input.external_reference || ''
    }
  };

  const res = await fetch(`${TF_API_BASE}/facturacion/nuevo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let raw: unknown = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }

  if (!res.ok) {
    return { ok: false, error_msg: `TusFacturas HTTP ${res.status}: ${text.slice(0, 300)}`, raw };
  }

  const r = raw as {
    error?: string;
    errores?: string[] | string;
    cae?: string;
    vencimientoCae?: string;
    comprobante_nro?: string | number;
    comprobante_tipo?: string;
    comprobante_pdf_url?: string;
    external_reference?: string;
  };

  if (r.error === 'S') {
    const msg = Array.isArray(r.errores) ? r.errores.join(' · ') : (r.errores || 'error desconocido');
    return { ok: false, error_msg: String(msg), raw };
  }

  return {
    ok: true,
    cae: r.cae,
    cae_vencimiento: parseFechaAR(r.vencimientoCae),
    numero: r.comprobante_nro ? Number(r.comprobante_nro) : undefined,
    punto_venta: input.emisor.punto_venta,
    comprobante_tipo: r.comprobante_tipo || tipo,
    pdf_url: r.comprobante_pdf_url,
    external_id: r.external_reference,
    raw
  };
}

// Test de conectividad / credenciales. Útil al guardar settings para
// avisar al user antes de intentar emitir una factura.
export async function pingTusFacturas(creds: TusFacturasCreds): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${TF_API_BASE}/clientes/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: creds.apiKey,
      apitoken: creds.apiToken,
      usertoken: creds.userToken,
      cliente: { documento_tipo: 'DNI', documento_nro: '0' }
    })
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const data = await res.json().catch(() => null) as { error?: string; errores?: string | string[] } | null;
  if (!data) return { ok: false, error: 'Respuesta inválida' };
  // 'cliente no encontrado' es ok (creds funcionan, solo no existe el cliente fake).
  if (data.error === 'S') {
    const msg = Array.isArray(data.errores) ? data.errores.join(' · ') : (data.errores || '');
    if (/no encontrado|inexistente/i.test(String(msg))) return { ok: true };
    return { ok: false, error: String(msg) };
  }
  return { ok: true };
}
