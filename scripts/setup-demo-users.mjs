// Crea/asegura las 2 cuentas demo del shop barberia-demo y limpia datos
// transaccionales (turnos, ventas, egresos) del shop demo.
//
// Uso:
//   node --env-file=.env.production.local scripts/setup-demo-users.mjs
//
// Idempotente: corrédolo cuantas veces quieras. Si las cuentas ya existen,
// resetea password y reasegura sus profiles + shop_members.

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

const SHOP_SLUG = 'barberia-demo';

async function findUserByEmail(email) {
  // listUsers no filtra server-side, paginamos.
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
    console.log(`  ✓ user existente reseteado: ${email}`);
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
  console.log(`  ✓ shop_id = ${shop.id} · is_active=${shop.is_active} · plan=${shop.plan}`);

  if (!shop.is_active || shop.plan !== 'pro' || !shop.aprobado) {
    console.log('▶ Activando shop + plan pro + aprobado…');
    const { error } = await supabase
      .from('shops')
      .update({ is_active: true, plan: 'pro', aprobado: true })
      .eq('id', shop.id);
    if (error) throw error;
    console.log('  ✓ shop activado, plan pro, aprobado=true');
  }

  console.log('▶ Asegurando demo users…');
  const ownerUser  = await ensureUser(OWNER);
  const clientUser = await ensureUser(CLIENT);

  console.log('▶ Upsert profiles…');
  const profileRows = [
    { id: ownerUser.id,  name: OWNER.name,  email: OWNER.email,  phone: OWNER.phone,  is_admin: true,  shop_id: shop.id },
    { id: clientUser.id, name: CLIENT.name, email: CLIENT.email, phone: CLIENT.phone, is_admin: false, shop_id: shop.id }
  ];
  const { error: profErr } = await supabase
    .from('profiles')
    .upsert(profileRows, { onConflict: 'id' });
  if (profErr) throw profErr;
  console.log('  ✓ profiles seteados (is_admin + shop_id)');

  console.log('▶ Upsert shop_members (owner)…');
  const { error: memErr } = await supabase
    .from('shop_members')
    .upsert(
      [{ profile_id: ownerUser.id, shop_id: shop.id, role: 'owner' }],
      { onConflict: 'profile_id,shop_id' }
    );
  if (memErr) throw memErr;
  console.log('  ✓ shop_member owner asegurado');

  // Asegurar que el shop tenga owner_id seteado al demo owner
  if (!shop.owner_id || shop.owner_id !== ownerUser.id) {
    console.log('▶ Seteando shops.owner_id al demo owner…');
    const { error } = await supabase
      .from('shops')
      .update({ owner_id: ownerUser.id })
      .eq('id', shop.id);
    if (error) console.warn('  ⚠ no se pudo setear owner_id (probablemente ya está):', error.message);
    else console.log('  ✓ owner_id seteado');
  }

  console.log('▶ Limpiando datos transaccionales del shop demo…');
  const tables = [
    { name: 'sales',        col: 'shop_id' },
    { name: 'expenses',     col: 'shop_id' },
    { name: 'appointments', col: 'shop_id' }
  ];
  for (const t of tables) {
    const { error, count } = await supabase
      .from(t.name)
      .delete({ count: 'exact' })
      .eq(t.col, shop.id);
    if (error) {
      console.warn(`  ⚠ no se pudo limpiar ${t.name}: ${error.message}`);
    } else {
      console.log(`  ✓ ${t.name} limpiado (${count ?? 0} filas)`);
    }
  }

  // ── Configurar MP ────────────────────────────────────────────────────────
  console.log('▶ Configurando shop_payment_settings (MP)…');
  const mpAccessToken = process.env.MP_DEV_ACCESS_TOKEN;
  const mpPublicKey   = process.env.NEXT_PUBLIC_MP_DEV_PUBLIC_KEY;
  if (mpAccessToken && mpPublicKey) {
    const { error: mpErr } = await supabase
      .from('shop_payment_settings')
      .upsert(
        { shop_id: shop.id, mp_access_token: mpAccessToken, mp_public_key: mpPublicKey, is_active: true },
        { onConflict: 'shop_id' }
      );
    if (mpErr) console.warn('  ⚠ shop_payment_settings:', mpErr.message);
    else console.log('  ✓ MP configurado (is_active=true)');
  } else {
    console.warn('  ⚠ MP_DEV_ACCESS_TOKEN / NEXT_PUBLIC_MP_DEV_PUBLIC_KEY no están en .env — skipping MP');
  }

  // ── Seed datos transaccionales ──────────────────────────────────────────
  console.log('▶ Buscando barberos y servicios del shop demo…');
  const { data: barbers }  = await supabase.from('barbers').select('id, name').eq('shop_id', shop.id).eq('is_active', true);
  const { data: services } = await supabase.from('services').select('id, name, duration_mins, price, deposit_amount').eq('shop_id', shop.id).eq('is_active', true);

  if (!barbers?.length || !services?.length) {
    console.warn('  ⚠ Sin barberos o servicios activos — skipping seed de turnos y ventas');
  } else {
    console.log(`  ✓ ${barbers.length} barberos, ${services.length} servicios`);

    const b0 = barbers[0];
    const b1 = barbers[Math.min(1, barbers.length - 1)];
    const b2 = barbers[Math.min(2, barbers.length - 1)];
    const s0 = services[0];
    const s1 = services[Math.min(1, services.length - 1)];
    const now = new Date();
    const addMin = (m) => new Date(now.getTime() + m * 60_000).toISOString();
    const durMin = (svc) => svc.duration_mins || 30;
    const yesterday15 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15, 0, 0).toISOString();
    const yesterday15end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15, durMin(s1), 0).toISOString();

    // ── Appointments ────────────────────────────────────────────────────
    console.log('▶ Insertando turnos demo…');
    const appts = [
      // 2 confirmados con seña paga
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b0.id, service_id: s0.id,
        customer_name: CLIENT.name,
        starts_at: addMin(90), ends_at: addMin(90 + durMin(s0)),
        status: 'confirmed', payment_status: 'paid',
        payment_amount: s0.deposit_amount || Math.round(s0.price * 0.3)
      },
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b1.id, service_id: s1.id,
        customer_name: CLIENT.name,
        starts_at: addMin(150), ends_at: addMin(150 + durMin(s1)),
        status: 'confirmed', payment_status: 'paid',
        payment_amount: s1.deposit_amount || Math.round(s1.price * 0.3)
      },
      // 2 confirmados sin seña
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b2.id, service_id: s0.id,
        customer_name: 'Rodrigo Martínez',
        starts_at: addMin(210), ends_at: addMin(210 + durMin(s0)),
        status: 'confirmed'
      },
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b0.id, service_id: s1.id,
        customer_name: 'Lucas Fernández',
        starts_at: addMin(270), ends_at: addMin(270 + durMin(s1)),
        status: 'confirmed'
      },
      // 1 en curso
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b1.id, service_id: s0.id,
        customer_name: 'Martín Sosa',
        starts_at: addMin(-10), ends_at: addMin(20),
        status: 'in_progress'
      },
      // 1 completado ayer
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b0.id, service_id: s1.id,
        customer_name: CLIENT.name,
        starts_at: yesterday15, ends_at: yesterday15end,
        status: 'completed'
      },
      // 1 cancelado
      {
        shop_id: shop.id, profile_id: clientUser.id, barber_id: b2.id, service_id: s0.id,
        customer_name: 'Pablo Giménez',
        starts_at: addMin(330), ends_at: addMin(330 + durMin(s0)),
        status: 'cancelled'
      }
    ];
    const { data: insertedAppts, error: apptErr } = await supabase.from('appointments').insert(appts).select('id, status');
    if (apptErr) console.warn('  ⚠ appointments:', apptErr.message);
    else console.log(`  ✓ ${insertedAppts.length} turnos insertados`);

    const completedAppt = insertedAppts?.find(a => a.status === 'completed');

    // ── Sales ───────────────────────────────────────────────────────────
    console.log('▶ Insertando ventas demo…');
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
        description: 'Pomada efecto mate',
        amount: 4500,
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
    else console.log(`  ✓ ${sales.length} ventas insertadas`);

    // ── Expenses ─────────────────────────────────────────────────────────
    console.log('▶ Insertando gasto demo…');
    const { error: expErr } = await supabase.from('expenses').insert([{
      shop_id: shop.id,
      category: 'insumos',
      description: 'Tijeras nuevas',
      amount: 8500,
      payment_method: 'efectivo'
    }]);
    if (expErr) console.warn('  ⚠ expenses:', expErr.message);
    else console.log('  ✓ gasto insertado');
  }

  console.log('');
  console.log('✅ Listo. Credenciales demo:');
  console.log(`   Dueño:   ${OWNER.email}  /  ${PASSWORD}`);
  console.log(`   Cliente: ${CLIENT.email}  /  ${PASSWORD}`);
  console.log(`   Shop:    /${SHOP_SLUG}`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
