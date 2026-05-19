export type AppointmentStatus =
  | 'pending'
  | 'pending_payment'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';
export type SaleType = 'service' | 'product' | 'other';
export type PaymentMethod = 'efectivo' | 'transferencia' | 'debito' | 'credito';
export type ShopPlan = 'starter' | 'pro';
export type DepositType = 'none' | 'percent' | 'fixed' | 'full';
export type PaymentStatus =
  | 'not_required'
  | 'pending'
  | 'paid'
  | 'refund_pending'
  | 'refunded'
  | 'partial_refund'
  | 'expired';

export type Shop = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  owner_id: string | null;
  is_active: boolean;
  plan: ShopPlan | string;
  created_at: string;
};

export type Service = {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  duration_mins: number;
  price: number;
  is_active: boolean;
  // Cobro anticipado (seña): 'none' = sin seña, 'percent' = % del precio,
  // 'fixed' = monto fijo en pesos, 'full' = 100% del precio.
  deposit_type: DepositType;
  deposit_amount: number;
  created_at: string;
};

export type Barber = {
  id: string;
  shop_id: string;
  name: string;
  slug: string;
  role: string | null;
  initials: string;
  hue: number;
  bio: string | null;
  is_active: boolean;
  rating: number;
  commission_pct: number;
  created_at: string;
};

export type Schedule = {
  id: string;
  shop_id: string;
  barber_id: string;
  day_of_week: number; // 0=Dom, 1=Lun ... 6=Sab
  start_time: string; // 'HH:MM'
  end_time: string;
  is_working: boolean;
};

export type Profile = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_admin: boolean;
  shop_id: string | null;
  created_at: string;
};

export type Appointment = {
  id: string;
  shop_id: string;
  profile_id: string | null;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  starts_at: string; // ISO timestamp
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  // Pagos (cobro anticipado): si la seña fue requerida y a qué nivel del flow va.
  payment_status: PaymentStatus;
  payment_provider: string | null;
  payment_external_id: string | null;
  payment_amount: number | null;
  payment_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  shop_id: string;
  name: string;
  price: number;
  stock: number;
  is_active: boolean;
  provider: string | null;
  unit: string;
  cost: number | null;
  created_at: string;
};

export type Sale = {
  id: string;
  shop_id: string;
  type: SaleType;
  appointment_id: string | null;
  product_id: string | null;
  amount: number;
  payment_method: PaymentMethod;
  customer_name: string | null;
  description: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  shop_id: string;
  category: string;
  description: string | null;
  amount: number;
  payment_method: PaymentMethod;
  paid_at: string;
  created_at: string;
};

export type ClientShop = {
  profile_id: string;
  shop_id: string;
  is_primary: boolean;
  created_at: string;
};

export type ShopMemberRole = 'owner' | 'admin';

export type ShopMember = {
  profile_id: string;
  shop_id: string;
  role: ShopMemberRole;
  created_at: string;
};

// ─── Facturación AFIP ───────────────────────────────────────────────────────

export type InvoicingProvider = 'tusfacturas';
export type IvaCondition = 'RI' | 'MONOTRIBUTO' | 'EXENTO';
export type ClienteCondicionIva = IvaCondition | 'CF';
export type TipoDoc = 'CUIT' | 'DNI' | 'CF';
export type InvoiceStatus = 'pending' | 'emitted' | 'error' | 'cancelled';

export type ShopInvoicingSettings = {
  shop_id: string;
  provider: InvoicingProvider;
  api_key: string | null;
  api_token: string | null;
  user_token: string | null;
  cuit: string | null;
  razon_social: string | null;
  punto_venta: number;
  condicion_iva: IvaCondition | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type InvoiceClienteData = {
  tipo_doc?: TipoDoc;
  nro_doc?: string;
  razon_social?: string;
  condicion_iva?: ClienteCondicionIva;
  email?: string;
  domicilio?: string;
};

export type Invoice = {
  id: string;
  shop_id: string;
  sale_id: string | null;
  appointment_id: string | null;
  tipo_comprobante: string;
  punto_venta: number;
  numero: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  monto_total: number;
  monto_neto: number | null;
  monto_iva: number | null;
  cliente_data: InvoiceClienteData;
  status: InvoiceStatus;
  pdf_url: string | null;
  external_id: string | null;
  provider: InvoicingProvider | string;
  error_msg: string | null;
  emitida_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      shops: { Row: Shop; Insert: Partial<Shop>; Update: Partial<Shop> };
      services: { Row: Service; Insert: Partial<Service>; Update: Partial<Service> };
      barbers: { Row: Barber; Insert: Partial<Barber>; Update: Partial<Barber> };
      schedules: { Row: Schedule; Insert: Partial<Schedule>; Update: Partial<Schedule> };
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      appointments: { Row: Appointment; Insert: Partial<Appointment>; Update: Partial<Appointment> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      sales: { Row: Sale; Insert: Partial<Sale>; Update: Partial<Sale> };
      expenses: { Row: Expense; Insert: Partial<Expense>; Update: Partial<Expense> };
      shop_members: { Row: ShopMember; Insert: Partial<ShopMember>; Update: Partial<ShopMember> };
      shop_invoicing_settings: { Row: ShopInvoicingSettings; Insert: Partial<ShopInvoicingSettings>; Update: Partial<ShopInvoicingSettings> };
      invoices: { Row: Invoice; Insert: Partial<Invoice>; Update: Partial<Invoice> };
    };
  };
};
