// Resetea COMPLETAMENTE el shop barberia-demo y recrea todo desde cero:
// usuarios, barberos, servicios, horarios, productos, turnos, ventas, gastos.
//
// Uso:
//   node --env-file=.env.production.local scripts/setup-demo-users.mjs
//
// Idempotente: borra todos los datos previos y los recrea siempre.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Corré con: node --env-file=.env.production.local scripts/setup-demo-users.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const PASSWORD = 'Demo1234';
const SHOP_SLUG = 'barberia-demo';

const OWNER = {
  email: 'dueno.demo@turnosbarberia.app',
  name:  'Dueño Demo',
  phone: '+5491111111111',
  isAdmin: true
};

const CLIENT = {
  email: 'cliente.demo@turnosbarberia.app',
  name:  'Cliente Demo',
  phone: '+5491122222222',
  isAdmin: false
};

// Datos estáticos a recrear
const BARBERS_DATA = [
  { name: 'Tomás', slug: 'tomas', role: 'Senior · 8 años',   initials: 'TM', hue:  55, rating: 4.9 },
  { name: 'Iván',  slug: 'ivan',  role: 'Barbero · 4 años',  initials: 'IV', hue: 200, rating: 4.8 },
  { name: 'Nico',  slug: 'nico',  role: 'Barbero · 2 años',  initials: 'NC', hue: 120, rating: 4.7 },
];

const SERVICES_DATA = [
  { name: 'Corte de pelo',   description: 'Corte clásico o moderno', duration_mins: 30, price: 8500  },
  { name: 'Arreglo de barba',description: 'Diseño y perfilado',      duration_mins: 20, price: 5500  },
  { name: 'Corte + Barba',   description: 'Combo completo',          duration_mins: 50, price: 12500 },
  { name: 'Diseño · Navaja', description: 'Detalles con navaja',     duration_mins: 30, price: 7000  },
];

const PRODUCTS_DATA = [
  { name: 'Pomada Mate',   price: 6200, stock: 14 },
  { name: 'Cera Fuerte',   price: 5800, stock:  9 },
  { name: 'Shampoo Barba', price: 7400, stock:  6 },
  { name: 'Aceite Barba',  price: 5200, stock: 11 },
  { name: 'Peine madera',  price: 3200, stock: 22 },
];

// ─────────────────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 20) return null;
  }
}

async function ensureUser({ email, name, phone }) {
  let user = await findUserByEmail(email);
  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name, phone }
    });
    if (error) throw error;
    console.log(`  ✓ user reseteado: ${email}`);
    return user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name, phone }
  });
  if (error) throw error;
  console.log(`  ✓ user creado: ${email}`);
  return data.user;
}

async function deleteAll(shopId) {
  // Orden de borrado respeta FKs: primero hijos, después padres.
  const steps = [
    { table: 'invoices',        col: 'shop_id' },
    { table: 'sales',           col: 'shop_id' },
    { table: 'appointments',    col: 'shop_id' },
    { table: 'schedule_blocks', col: 'shop_id' },
    { table: 'schedules',       col: 'shop_id' },
    { table: 'expenses',        col: 'shop_id' },
    { table: 'products',        col: 'shop_id' },
    { table: 'barbers',         col: 'shop_id' },
    { table: 'services',        col: 'shop_id' },
  ];
  for (const s of steps) {
    const { error, count } = await supabase
      .from(s.table).delete({ count: 'exact' }).eq(s.col, shopId);
    if (error) console.warn(`  ⚠ no se pudo limpiar ${s.table}: ${error.message}`);
    else console.log(`  ✓ ${s.table} limpiado (${count ?? 0} filas)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('▶ Buscando shop barberia-demo…');
  const { data: shop, error: shopErr } = await supabase
    .from('shops')
    .select('id, slug, name, is_active, plan, aprobado, owner_id')
    .eq('slug', SHOP_SLUG)
    .maybeSingle();
  if (shopErr) throw shopErr;
  if (!shop) {
    console.error(`  ✗ Shop "${SHOP_SLUG}" no encontrado. Asegurá que las migrations corrieron.`);
    process.exit(1);
  }
  console.log(`  ✓ shop_id = ${shop.id}`);

  if (!shop.is_active || shop.plan !== 'pro' || !shop.aprobado) {
    console.log('▶ Activando shop (is_active=true · plan=pro · aprobado=true)…');
    const { error } = await supabase
      .from('shops')
      .update({ is_active: true, plan: 'pro', aprobado: true })
      .eq('id', shop.id);
    if (error) throw error;
    console.log('  ✓ shop listo');
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('▶ Asegurando demo users…');
  const ownerUser  = await ensureUser(OWNER);
  const clientUser = await ensureUser(CLIENT);

  // ── Profiles ───────────────────────────────────────────────────────────────
  console.log('▶ Upsert profiles…');
  const { error: profErr } = await supabase
    .from('profiles')
    .upsert([
      { id: ownerUser.id,  name: OWNER.name,  email: OWNER.email,  phone: OWNER.phone,  is_admin: true,  shop_id: shop.id },
      { id: clientUser.id, name: CLIENT.name, email: CLIENT.email, phone: CLIENT.phone, is_admin: false, shop_id: shop.id }
    ], { onConflict: 'id' });
  if (profErr) throw profErr;
  console.log('  ✓ profiles OK');

  console.log('▶ Upsert shop_members…');
  const { error: memErr } = await supabase
    .from('shop_members')
    .upsert([{ profile_id: ownerUser.id, shop_id: shop.id, role: 'owner' }],
      { onConflict: 'profile_id,shop_id' });
  if (memErr) throw memErr;
  console.log('  ✓ shop_members OK');

  if (!shop.owner_id || shop.owner_id !== ownerUser.id) {
    console.log('▶ Seteando owner_id…');
    const { error } = await supabase.from('shops').update({ owner_id: ownerUser.id }).eq('id', shop.id);
    if (error) console.warn('  ⚠ owner_id:', error.message);
    else console.log('  ✓ owner_id seteado');
  }

  // ── Borrado completo ───────────────────────────────────────────────────────
  console.log('▶ Borrando todos los datos del shop demo…');
  await deleteAll(shop.id);

  // ── Barberos ───────────────────────────────────────────────────────────────
  console.log('▶ Creando barberos…');
  const { data: barbers, error: barbErr } = await supabase
    .from('barbers')
    .insert(BARBERS_DATA.map(b => ({ ...b, shop_id: shop.id })))
    .select('id, name, slug');
  if (barbErr) throw barbErr;
  console.log(`  ✓ ${barbers.length} barberos: ${barbers.map(b => b.name).join(', ')}`);

  // ── Servicios ──────────────────────────────────────────────────────────────
  console.log('▶ Creando servicios…');
  const { data: services, error: svcErr } = await supabase
    .from('services')
    .insert(SERVICES_DATA.map(s => ({ ...s, shop_id: shop.id })))
    .select('id, name, duration_mins, price');
  if (svcErr) throw svcErr;
  console.log(`  ✓ ${services.length} servicios: ${services.map(s => s.name).join(', ')}`);

  // ── Horarios (lun–sáb activos, domingo cerrado) ────────────────────────────
  console.log('▶ Creando horarios…');
  const scheduleRows = [];
  for (const b of barbers) {
    for (let day = 0; day <= 6; day++) {
      scheduleRows.push({
        shop_id: shop.id,
        barber_id: b.id,
        day_of_week: day,
        start_time: '10:00',
        end_time: '20:00',
        is_working: day !== 0
      });
    }
  }
  const { error: schedErr } = await supabase.from('schedules').insert(scheduleRows);
  if (schedErr) throw schedErr;
  console.log(`  ✓ ${scheduleRows.length} horarios insertados (lun–sáb activo, dom cerrado)`);

  // ── Productos ──────────────────────────────────────────────────────────────
  console.log('▶ Creando productos…');
  const { error: prodErr } = await supabase
    .from('products')
    .insert(PRODUCTS_DATA.map(p => ({ ...p, shop_id: shop.id })));
  if (prodErr) throw prodErr;
  console.log(`  ✓ ${PRODUCTS_DATA.length} productos`);

  // ── Datos transaccionales ──────────────────────────────────────────────────
  const [b0, b1, b2] = barbers;
  const [s0, s1, s2] = services; // Corte, Barba, Combo

  const now = new Date();
  const addMin = (m) => new Date(now.getTime() + m * 60_000).toISOString();
  const dur = (svc) => svc.duration_mins || 30;
  const yday = (h, m = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, h, m, 0).toISOString();

  // ── Turnos ────────────────────────────────────────────────────────────────
  console.log('▶ Insertando turnos…');
  const appts = [
    // 2 confirmados con seña paga
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b0.id, service_id: s0.id,
      customer_name: CLIENT.name, customer_phone: CLIENT.phone, customer_email: CLIENT.email,
      starts_at: addMin(90), ends_at: addMin(90 + dur(s0)),
      status: 'confirmed', payment_status: 'paid',
      payment_amount: Math.round(s0.price * 0.3)
    },
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b1.id, service_id: s1.id,
      customer_name: CLIENT.name, customer_phone: CLIENT.phone, customer_email: CLIENT.email,
      starts_at: addMin(150), ends_at: addMin(150 + dur(s1)),
      status: 'confirmed', payment_status: 'paid',
      payment_amount: Math.round(s1.price * 0.3)
    },
    // 2 confirmados sin seña
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b2.id, service_id: s0.id,
      customer_name: 'Rodrigo Martínez', customer_phone: '+5491133333333', customer_email: '',
      starts_at: addMin(210), ends_at: addMin(210 + dur(s0)),
      status: 'confirmed', payment_status: 'not_required'
    },
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b0.id, service_id: s2.id,
      customer_name: 'Lucas Fernández', customer_phone: '+5491144444444', customer_email: '',
      starts_at: addMin(270), ends_at: addMin(270 + dur(s2)),
      status: 'confirmed', payment_status: 'not_required'
    },
    // 1 en curso ahora
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b1.id, service_id: s0.id,
      customer_name: 'Martín Sosa', customer_phone: '+5491155555555', customer_email: '',
      starts_at: addMin(-10), ends_at: addMin(20),
      status: 'in_progress', payment_status: 'not_required'
    },
    // 1 completado ayer
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b0.id, service_id: s1.id,
      customer_name: CLIENT.name, customer_phone: CLIENT.phone, customer_email: CLIENT.email,
      starts_at: yday(15, 0), ends_at: yday(15, dur(s1)),
      status: 'completed', payment_status: 'not_required'
    },
    // 1 cancelado
    {
      shop_id: shop.id, profile_id: clientUser.id,
      barber_id: b2.id, service_id: s0.id,
      customer_name: 'Pablo Giménez', customer_phone: '+5491166666666', customer_email: '',
      starts_at: addMin(330), ends_at: addMin(330 + dur(s0)),
      status: 'cancelled', payment_status: 'not_required'
    }
  ];

  const { data: insertedAppts, error: apptErr } = await supabase
    .from('appointments').insert(appts).select('id, status');
  if (apptErr) console.warn('  ⚠ appointments:', apptErr.message);
  else console.log(`  ✓ ${insertedAppts.length} turnos`);

  const completedAppt = insertedAppts?.find(a => a.status === 'completed');

  // ── Ventas ────────────────────────────────────────────────────────────────
  console.log('▶ Insertando ventas…');
  const sales = [
    {
      shop_id: shop.id,
      appointment_id: completedAppt?.id ?? null,
      type: 'service',
      description: s1.name,
      amount: s1.price,
      payment_method: 'mercadopago',
      customer_name: CLIENT.name
    },
    {
      shop_id: shop.id,
      type: 'service',
      description: `${s0.name} · Walk-in`,
      amount: s0.price,
      payment_method: 'efectivo',
      customer_name: 'Matías Romero'
    },
    {
      shop_id: shop.id,
      type: 'product',
      description: 'Pomada Mate',
      amount: 6200,
      payment_method: 'debito'
    },
    {
      shop_id: shop.id,
      type: 'other',
      description: 'Propina',
      amount: 2000,
      payment_method: 'efectivo'
    }
  ];
  const { error: salesErr } = await supabase.from('sales').insert(sales);
  if (salesErr) console.warn('  ⚠ sales:', salesErr.message);
  else console.log(`  ✓ ${sales.length} ventas`);

  // ── Gastos ────────────────────────────────────────────────────────────────
  console.log('▶ Insertando gasto…');
  const { error: expErr } = await supabase.from('expenses').insert([{
    shop_id: shop.id,
    category: 'insumos',
    description: 'Tijeras nuevas',
    amount: 8500,
    payment_method: 'efectivo'
  }]);
  if (expErr) console.warn('  ⚠ expenses:', expErr.message);
  else console.log('  ✓ gasto insertado');

  // MP y facturación AFIP se dejan sin configurar intencionalmente:
  // cada dueño conecta su propia cuenta MP y sus creds TusFacturas desde Ajustes.

  console.log('');
  console.log('✅ Demo lista. Credenciales:');
  console.log(`   Dueño:   ${OWNER.email}  /  ${PASSWORD}`);
  console.log(`   Cliente: ${CLIENT.email}  /  ${PASSWORD}`);
  console.log(`   Shop:    /${SHOP_SLUG}`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
