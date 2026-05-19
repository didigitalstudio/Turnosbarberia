# Plan: dejar TurnosBarbería listo para vender

> Branch: `cambios-pagos-y-facturador` (worktree `.claude/worktrees/crazy-sutherland-c92768/`)
> Estado al cierre: backend AFIP + UI ajustes listos; modal "Facturar desde Caja" a medias; resto del plan documentado abajo.
> Dividido en dos ramas de trabajo: **Agustín** (backend / integraciones / datos / bugs técnicos) y **Lucas** (UI / UX / layouts / landing).

---

## 📌 Estado actual del worktree (sin commit)

Archivos nuevos o modificados que **ya están escritos** y compilan (`npx tsc --noEmit` OK):

| Archivo | Estado | Qué hace |
|---------|--------|----------|
| `supabase/migrations/0014_invoicing.sql` | ✅ NUEVO | Tabla `shop_invoicing_settings` + tabla `invoices` + RLS + triggers |
| `src/lib/tusfacturas.ts` | ✅ NUEVO | Cliente fetch del API de TusFacturas — `createTusFacturasInvoice`, `pingTusFacturas` |
| `src/app/actions/invoicing.ts` | ✅ NUEVO | Server actions `upsertShopInvoicingSettings` + `emitInvoice` |
| `src/types/db.ts` | ✅ MODIFICADO | Tipos `Invoice`, `ShopInvoicingSettings`, `IvaCondition`, `TipoDoc`, etc. |
| `src/components/shared/MobileShell.tsx` | ✅ MODIFICADO | Fix responsive: `max-w-[440px] md:max-w-[720px]` + fondo decorativo en desktop |
| `src/components/shop/AjustesView.tsx` | ✅ MODIFICADO | Nuevo tab "Facturación" con form completo (creds + CUIT + condición IVA) |
| `src/app/shop/ajustes/page.tsx` | ✅ MODIFICADO | Fetch de `shop_invoicing_settings` |
| `src/app/shop/caja/page.tsx` | ⚠️ MODIFICADO (parcial) | Fetch de `invoices` del día listo, pero CashView no usa los props todavía |
| `src/components/shop/CashView.tsx` | ⚠️ MODIFICADO (parcial) | Imports + props `invoicingActive` / `invoicedSales` agregados pero SIN integrar al UI |

**Migration pendiente de aplicar:** `0014_invoicing.sql` no está aún en Supabase. Aplicar con `npx supabase db push --linked` o pegar en el dashboard SQL editor del proyecto `jjtknobjfljnlnurvbey`.

**Credenciales de prueba MP:** `.env.local` tiene `MP_DEV_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_DEV_PUBLIC_KEY`, `MP_DEV_USER_ID` de la cuenta DI en modo TEST (la integración real de MP la hizo Lucas en PR #17 con modelo "token por shop" en `shop_payment_settings`, no usa estos vars; quedan para fallback dev futuro).

---

## 🟦 Rama AGUSTÍN — Backend, integraciones, datos, bugs técnicos

> Para ejecutar en una sesión de Claude Code. Los items están ordenados por prioridad de cara a la venta.

### A1. Terminar UI "Facturar desde Caja" (modal + botón inline)

**Por qué:** La parte más visible de AFIP. Sin esto, el dueño tiene la configuración pero no puede emitir facturas. Está a medias.

**Archivos:**
- `src/components/shop/CashView.tsx` (ya tiene imports y props, falta la UI)
- `src/app/shop/caja/page.tsx` (ya pasa los props)

**Qué falta hacer:**
1. En `CashView` propagar `invoicingActive` e `invoicedSales` a `SalesList`
2. En `SalesList` (mobile cards + desktop table), por cada sale:
   - Si `invoicedSales[sale.id]` existe → badge "Facturado · {tipo} {numero}" + link al PDF (`pdf_url`)
   - Si no, y `invoicingActive` → botón pequeño "Facturar"
   - Si no, y no `invoicingActive` → nada (no mostrar nada)
3. Estado en CashView: `const [invoiceFor, setInvoiceFor] = useState<Sale | null>(null)` (ya está)
4. Render condicional `{invoiceFor && <InvoiceModal sale={invoiceFor} onClose={...} onDone={...} />}`
5. Componente `InvoiceModal` al final del archivo, con form:
   - Cliente: `tipo_doc` (CF/DNI/CUIT), `nro_doc`, `razon_social`, `condicion_iva` (CF/RI/MONOTRIBUTO/EXENTO), `email`
   - Checkbox "Enviar factura por mail al cliente"
   - Submit llama `emitInvoice({ saleId: sale.id, cliente: {...}, envia_por_mail })`
   - Si OK: toast "Factura emitida · CAE {cae}", `router.refresh()`, link al PDF si vino
   - Si error: toast con `r.error`

**Prompt ejecutable:**
```
Completar la UI de "Facturar desde Caja" en src/components/shop/CashView.tsx.
Ya están agregados los imports (emitInvoice, ClienteCondicionIva, TipoDoc) y los
props opcionales invoicingActive + invoicedSales. Falta:

1. Pasar invoicedSales e invoicingActive desde CashView a SalesList.
2. En SalesList agregar por cada sale: si invoicedSales[sale.id] existe, mostrar
   badge "Facturada {tipo} {numero}" + link al pdf_url. Si invoicingActive y no
   facturada, botón "Facturar" que llama setInvoiceFor(sale).
3. Crear componente InvoiceModal (al final del archivo) que recibe sale y maneja
   form de cliente (tipo_doc, nro_doc, razon_social, condicion_iva, email,
   envia_por_mail) y llama a emitInvoice({ saleId, cliente, envia_por_mail }).
4. Mostrar resultado con Toast existente + router.refresh() en éxito.

Patrón visual: copiar el estilo de SaleModal/ExpenseModal del mismo archivo.
Tipos: ver src/types/db.ts (TipoDoc, ClienteCondicionIva).
Action: src/app/actions/invoicing.ts (emitInvoice ya devuelve { ok, invoiceId,
cae, pdfUrl, numero } o { error }).

No olvidarte de verificar npx tsc --noEmit al terminar.
```

**Criterio de éxito:** En caja, click "Facturar" sobre un sale → modal → datos cliente → submit → CAE devuelto + badge "Facturada" + link al PDF.

---

### A2. Bug: precargar día/hora/barbero en `/shop/nuevo` desde la agenda

**Por qué:** Click en slot vacío de agenda → URL trae `?d=YYYY-MM-DD&at=YYYY-MM-DDTHH:mm:00&barber=ID`, pero `/shop/nuevo/page.tsx` ignora todos esos params y abre con valores por defecto (hora actual).

**Archivos:**
- `src/app/shop/nuevo/page.tsx` — leer `searchParams.d`, `at`, `barber` y pasarlos a `NewWalkInForm`
- `src/components/shop/NewWalkInForm.tsx` — aceptar props `defaultDate`, `defaultTime`, `defaultBarberId` e inicializar state con esos valores
- `src/components/shop/AgendaView.tsx:683` — URL del cell-click (ya está bien, deja como está)

**Prompt ejecutable:**
```
Fix bug: click en celda vacía de AgendaView lleva a /shop/nuevo?d=...&at=...&barber=...
pero la page ignora esos params. Tareas:

1. En src/app/shop/nuevo/page.tsx: aceptar searchParams ({ d?: string; at?: string;
   barber?: string }), validarlos (DATE_RE para d, ISO datetime sin Z para at,
   uuid para barber) y pasarlos a NewWalkInForm como defaultDate, defaultTime,
   defaultBarberId.
2. En src/components/shop/NewWalkInForm.tsx: aceptar esos props opcionales y usarlos
   para inicializar el state de fecha/hora/barbero. Si vienen, pre-seleccionar.
3. Validar npx tsc --noEmit + testear: en /shop, click en slot 15:30 de Tomás →
   /shop/nuevo debe abrir con fecha del slot, hora 15:30, barbero=Tomás
   pre-cargado.

Patrón de validation: ver isoFromARLocal en src/lib/tz.ts.
```

**Criterio de éxito:** Click en cualquier slot vacío de la agenda → form de nuevo turno abre con esos datos ya cargados.

---

### A3. Demo seed enriquecido (para mostrar a prospectos)

**Por qué:** El seed actual `scripts/setup-demo-users.mjs` activa el shop demo y crea cuentas, pero deja la base sin turnos, sin MP configurado, sin sales. Si el prospecto entra al panel, ve "zero state" → no se demoea nada.

**Archivos:**
- `scripts/setup-demo-users.mjs`

**Qué agregar al script (después del cleanup actual):**
1. Asegurar `shops.aprobado = true` (no solo `is_active`)
2. Upsert `shop_payment_settings` con `mp_access_token = process.env.MP_DEV_ACCESS_TOKEN`, `mp_public_key = process.env.NEXT_PUBLIC_MP_DEV_PUBLIC_KEY`, `is_active = true`
3. Crear 6-8 appointments distribuidos: 2 paid con seña (status `confirmed`, payment_status `paid`), 2 hoy a futuro (`confirmed`), 1 in_progress (ahora), 1 completed, 1 cancelled
4. Crear 3-4 sales del día: 2 services (uno mercadopago, otro efectivo), 1 product, 1 walk-in
5. Crear 1 expense del día (ej: "Insumos - tijeras nuevas")
6. (Opcional) Crear 1 `shop_invoicing_settings` con `is_active=false` para que se vea el tab y el dueño "actívelo después"

**Prompt ejecutable:**
```
Enriquecer scripts/setup-demo-users.mjs para que la barberia-demo arranque con
datos realistas. Después del bloque actual de cleanup de tablas transaccionales
(line ~140), agregar:

1. Setear shops.aprobado = true (además de is_active y plan).
2. Upsert en shop_payment_settings:
   { shop_id, mp_access_token: process.env.MP_DEV_ACCESS_TOKEN,
     mp_public_key: process.env.NEXT_PUBLIC_MP_DEV_PUBLIC_KEY, is_active: true }
3. Lookup de los 3 barberos del shop demo (ya creados por seed.sql) y de los
   servicios (corte, barba, etc).
4. Insert 6-8 appointments con timestamps distribuidos: 2 paid+confirmed con
   payment_status='paid', payment_amount = seña del service, 2 futuros confirmed,
   1 in_progress (starts_at = now - 10min, ends_at = now + 20min), 1 completed
   (ayer), 1 cancelled.
   Para profile_id usar el cliente demo. Para barber/service alternar entre los
   disponibles.
5. Insert 3-4 sales del día con appointment_id matching los completed/in_progress
   donde corresponda. Mix de payment_method: efectivo, mercadopago, debito.
6. Insert 1 expense del día (categoría "insumos", monto 8500).

Las inserciones deben ser idempotentes (revisar si ya existen o usar timestamps
únicos basados en now).

Criterio de éxito: tras correr el script, login con dueno.demo / Demo1234 ve la
agenda cargada y la caja con plata.
```

**Criterio de éxito:** El dueño demo arranca con agenda cargada, sales del día, MP configurado.

---

### A4. Aplicar migration 0014 a Supabase prod

**Por qué:** Sin esto, todo el código AFIP que ya está escrito da error en runtime ("table does not exist").

**Comando:**
```powershell
npx supabase db push --linked
```
o pegar `supabase/migrations/0014_invoicing.sql` en el SQL editor del dashboard de Supabase del proyecto `jjtknobjfljnlnurvbey`.

**Criterio de éxito:** Las tablas `shop_invoicing_settings` y `invoices` existen en prod.

---

### A5. Cuenta TusFacturas para demo

**Por qué:** Sin credenciales reales TusFacturas, no se puede emitir factura siquiera en demo. Opciones:
- Crear cuenta gratuita en `tusfacturas.app` con CUIT de DI (modo prueba)
- O usar el modo "demo" de TusFacturas si lo tienen
- Cargar creds en el shop demo via la UI nueva de Ajustes → Facturación

**Acción:** Vos (Agustín) creás cuenta, pasás credenciales para cargarlas vía UI en barberia-demo. **Esto es manual y NO bloquea código.**

---

### A6. Refinar `release_expired_holds()` para que se llame en background

**Por qué:** La función ya existe en migration 0011 pero no veo en `/api/cron/reminders/route.ts` que se llame periódicamente. Sin esto, los `pending_payment` que vencieron pueden quedar bloqueando slots aunque MP cerró la preference.

**Archivos a inspeccionar:** `src/app/api/cron/reminders/route.ts`, `supabase/migrations/0011_appointment_payments.sql`.

**Prompt ejecutable:**
```
Verificar si el cron de recordatorios (src/app/api/cron/reminders/route.ts) está
llamando a la función Postgres release_expired_holds() definida en migration
0011. Si no, agregar la llamada antes (o después) de los recordatorios. La idea
es que cada vez que corre el cron, libere los holds de turnos pending_payment
con payment_expires_at vencido, para que esos slots se liberen.

Si el cron actual está config'd a correr cada N horas y eso es demasiado lento
para liberar holds (típicamente vencen en 10min), considerar agregar un endpoint
separado tipo /api/cron/release-holds que corra cada 5min via vercel.json.
```

**Criterio de éxito:** Los `pending_payment` vencidos quedan en `expired` y el slot se libera para que otro cliente lo tome.

---

### A7. Commit limpio y push

**Por qué:** Cerrar el trabajo backend en un commit ordenado.

**Comando sugerido:**
```bash
git add supabase/migrations/0014_invoicing.sql \
        src/lib/tusfacturas.ts \
        src/app/actions/invoicing.ts \
        src/types/db.ts \
        src/components/shared/MobileShell.tsx \
        src/components/shop/AjustesView.tsx \
        src/app/shop/ajustes/page.tsx \
        src/app/shop/caja/page.tsx \
        src/components/shop/CashView.tsx

git commit -m "feat(invoicing): integracion AFIP via TusFacturas + UI ajustes + fix responsive"
git push origin cambios-pagos-y-facturador
```
Hacer PR a main. Tras squash merge, branch lista para próxima iteración.

---

## 🟪 Rama LUCAS — UI/UX, layouts, landing, mejoras visuales

> Para ejecutar en una sesión de Claude Code de Lucas. Orden por impacto en venta.

### L1. Landing de venta: sumar features nuevos

**Por qué:** La landing en `LandingPage.tsx` no menciona los features que más venden a una barbería: cobro de seña vía MP, recordatorios WhatsApp, facturación AFIP.

**Archivos:**
- `src/components/marketing/LandingPage.tsx`

**Qué cambiar:**
1. **Sección Features (línea ~217-257)**: agregar 3 cards nuevos o reemplazar genéricos:
   - "Cobro anticipado · MercadoPago" — "Cobrá una seña al reservar y reducí el no-show. La plata va directo a tu cuenta MP."
   - "Recordatorios por WhatsApp" — "Mensaje automático el día antes del turno. Menos olvidos, más facturación."
   - "Facturación electrónica AFIP" — "Emití factura A/B/C desde caja en un click. Integración con TusFacturasAPP."
2. **Pricing Pro (línea ~347-357)**: agregar bullets:
   - "Cobro anticipado vía Mercado Pago"
   - "Recordatorios automáticos por WhatsApp"
   - "Facturación electrónica AFIP integrada"
3. **FAQ (línea ~430-488)**: agregar 2-3 preguntas:
   - "¿Cobran comisión por los pagos con Mercado Pago?" → "No. La plata va directo a tu cuenta MP. Nosotros solo facilitamos el cobro."
   - "¿Cómo funciona la facturación electrónica?" → "Integramos con TusFacturasAPP. Cargás tus credenciales y emitís facturas A/B/C desde el módulo de Caja."

**Prompt ejecutable:**
```
Actualizar src/components/marketing/LandingPage.tsx para sumar features nuevos:

1. En la sección Features (alrededor de línea 217-257), agregar/sustituir items
   genéricos con:
   - "Cobro anticipado · MercadoPago" — copy: cobrá seña al reservar, reducí no-show, plata directo a tu cuenta MP
   - "Recordatorios por WhatsApp" — copy: mensaje automático día previo, menos olvidos
   - "Facturación AFIP" — copy: factura A/B/C desde caja en un click, integración TusFacturas

2. En la card Pro del Pricing (alrededor de línea 347-357) agregar 3 bullets nuevos
   para esos features.

3. En el FAQ (alrededor de línea 430-488) agregar 2-3 preguntas/respuestas sobre
   MP (no cobramos comisión, plata directa) y facturación (integración TusFacturas).

Mantener el tono y estilo visual existente. Validar npx tsc --noEmit.
```

**Criterio de éxito:** Landing menciona MP, WhatsApp y AFIP claramente. Sirve como argumento de venta.

---

### L2. Vista cliente: mejorar responsive desktop (más allá del fix de MobileShell)

**Por qué:** El fix actual de MobileShell le da 720px en desktop con un fondo decorativo, pero sigue siendo "una app mobile centrada". Para que se vea profesional en desktop hay que rediseñar páginas clave (reservar, mis-turnos, confirmación) con layouts de 2 columnas o cards más generosas.

**Archivos:**
- `src/app/[slug]/page.tsx` — landing del shop
- `src/components/client/BookingFlow.tsx` — wizard de reserva
- `src/components/client/MyAppointmentsView.tsx` — mis turnos
- `src/app/[slug]/confirmacion/[id]/page.tsx` — confirmación

**Qué hacer:**
1. En `[slug]/page.tsx`: en desktop, layout 2-columnas: izq info shop + servicios, der next appointment / CTA
2. En `BookingFlow.tsx`: en desktop, mostrar el wizard en una vista más ancha con servicios + barberos + calendario en grilla 2-col en lugar de stack vertical
3. En `MyAppointmentsView.tsx`: en desktop, grid de cards (3 por fila) en lugar de stack
4. En `confirmacion/[id]/page.tsx`: en desktop, layout 2-columnas: izq info turno + acciones, der mapa de ubicación (si hay shop.address) + QR

**Prompt ejecutable:**
```
Mejorar responsive desktop de la vista cliente. El wrapper MobileShell ya da
hasta 720px en desktop (md:max-w-[720px]), pero las páginas internas siguen
viéndose como "app mobile centrada". Hacer redesign desktop para:

1. src/app/[slug]/page.tsx (landing del shop): en md+ layout grid 2-col, izq
   info shop + servicios, der next appointment + CTA "Reservar".
2. src/components/client/BookingFlow.tsx (wizard): en md+ mostrar selección de
   servicio + barbero + fecha en grilla 2-col en lugar de stack vertical.
3. src/components/client/MyAppointmentsView.tsx: en md+ grid 2-col de cards.
4. src/app/[slug]/confirmacion/[id]/page.tsx: en md+ layout 2-col, izq turno +
   acciones, der mapa Google Maps embed (usando shop.address) + número
   emergencia.

Para el mapa embed, usar https://www.google.com/maps/embed/v1/place con la API
key NEXT_PUBLIC_GOOGLE_MAPS_KEY (agregar a .env.example). Si no hay API key,
fallback a un link "Ver en Google Maps" con la address.

Mantener mobile-first: todos los breakpoints son md:/lg: aditivos, mobile
debe seguir igual. Usar Tailwind. Validar npx tsc --noEmit.
```

**Criterio de éxito:** En desktop (≥1024px) las páginas cliente NO se ven como "app mobile pinned al centro", aprovechan el ancho.

---

### L3. Vinculación cliente multi-shop

**Por qué:** Hoy `profile.shop_id` se ata SOLO al primer booking (`booking.ts:240-259`) y no se cambia más. Si un cliente reserva en barbería A, después visita barbería B, queda confundido (su "casa" es A). Debería poder usar N barberías.

**Diseño propuesto:**
- Nueva tabla `client_shops(profile_id, shop_id, primary boolean, created_at)` — relación N:M cliente-shop
- Backfill: cada `profile.shop_id` actual → fila en client_shops con `primary=true`
- En reserva, en lugar de pisar `profile.shop_id`, hacer upsert en client_shops (sin primary)
- UI: en `/[slug]/mis-turnos` o nueva `/perfil`, listar las barberías vinculadas y permitir cambiar "primaria"
- Header del cliente: mostrar shop actual + dropdown para cambiar

**Archivos:**
- Nueva migration `0015_client_shops.sql`
- `src/types/db.ts` — type `ClientShop`
- `src/app/actions/booking.ts:240-259` — cambiar lógica de pisar shop_id
- `src/components/client/MyAppointmentsView.tsx` o nueva `/perfil/page.tsx` — UI
- `src/components/shared/MobileShell.tsx` o header — dropdown de shops vinculados

**Prompt ejecutable:**
```
Implementar vinculación cliente multi-shop. Hoy un cliente queda atado al primer
shop donde reserva (profile.shop_id, en booking.ts:240-259). Esto bloquea uso
multi-barbería. Tareas:

1. Crear supabase/migrations/0015_client_shops.sql con tabla:
   client_shops(profile_id uuid FK, shop_id uuid FK, is_primary bool default true,
                created_at timestamptz, PK (profile_id, shop_id))
   + RLS: profile_id = auth.uid()
   + Backfill: insert from profiles where shop_id is not null with is_primary=true
2. En src/types/db.ts agregar type ClientShop.
3. En src/app/actions/booking.ts cambiar el bloque que setea profile.shop_id:
   - Si cliente ya tiene una fila en client_shops para ese shop → no hacer nada
   - Si no tiene → insert nueva con is_primary=false (no pisar la primaria)
   - Si nunca tuvo ningún shop → insert con is_primary=true
4. Crear src/app/[slug]/perfil/page.tsx (o reusar mis-turnos): listar shops del
   cliente con badge "Primaria", botón "Hacer primaria" para cambiar.
5. En MobileShell o header del cliente, si client_shops.length > 1, mostrar
   dropdown para "ir a mis turnos de otra barbería".

Validar npx tsc --noEmit + correr migration en dev.
```

**Criterio de éxito:** Un cliente puede reservar en 3 barberías distintas y verlas todas en su perfil; cambiar la primaria libremente.

---

### L4. UI: botones cancelar/reprogramar inline en MyAppointments

**Por qué:** Hoy solo la "featured card" (próximo turno) tiene botones; el resto en "Más adelante" no tiene actions visibles → cliente tiene que tap para abrir y desde ahí cancelar/reprogramar.

**Archivos:**
- `src/components/client/MyAppointmentsView.tsx`

**Prompt ejecutable:**
```
En src/components/client/MyAppointmentsView.tsx, en la lista "Más adelante",
agregar a cada card de turno los mismos 2 botones que tiene el FeaturedCard:
"Reprogramar" (link a /[slug]/reservar?reschedule=ID) y "Cancelar" (modal de
confirmación, llama a cancelAppointment).

Mantener el diseño compacto: botones chiquitos en el footer de la card, no
ocupar más alto innecesario.

Reusar el modal de cancelación que ya existe para la featured card. Si el
turno tiene seña pagada, mostrar el aviso de política de reembolso.

Validar npx tsc --noEmit.
```

**Criterio de éxito:** Desde la lista de turnos futuros, el cliente puede cancelar/reprogramar sin tener que entrar a cada turno.

---

### L5. Onboarding del dueño: agregar checklist post-registro

**Por qué:** Después del wizard, el dueño nuevo cae en `/shop` sin guía clara de qué configurar (servicios, barberos, MP, WhatsApp, AFIP, etc). El `ShopActivationChecklist` existe pero solo cubre lo básico.

**Archivos:**
- `src/app/shop/page.tsx`
- `src/components/shop/ShopActivationChecklist.tsx`

**Qué agregar al checklist:**
- ☐ Configurá tus servicios y precios
- ☐ Agregá al menos 1 barbero
- ☐ Definí los horarios de cada barbero
- ☐ (Opcional) Cobrá seña con MercadoPago → link a Ajustes/Pagos
- ☐ (Opcional) Activá recordatorios WhatsApp → link a Ajustes/WhatsApp
- ☐ (Opcional) Configurá facturación AFIP → link a Ajustes/Facturación
- ☐ Compartí tu link público con clientes

Cada ítem con un check verde si ya está hecho (verificable contra DB).

**Prompt ejecutable:**
```
Mejorar src/components/shop/ShopActivationChecklist.tsx (y su uso en /shop/page.tsx
si hace falta) para mostrar un checklist completo de pasos de configuración:

1. Servicios cargados (≥1 service activo)
2. Barberos cargados (≥1 barber activo)
3. Horarios definidos (≥1 schedule por barbero)
4. (Opcional) Cobro anticipado MP → check si shop_payment_settings.is_active
5. (Opcional) Recordatorios WhatsApp → check si shop_whatsapp_settings.is_active
6. (Opcional) Facturación AFIP → check si shop_invoicing_settings.is_active
7. Link público compartido (check si shop tiene al menos 1 appointment via slug)

Cada ítem con check verde si OK, link "Configurar" si pendiente. Los opcionales
visualmente más sutiles que los obligatorios.

Diseño: progressbar arriba (X/7 completos), lista debajo. Si todos OK, ocultar
el checklist por completo (return null).

Validar npx tsc --noEmit.
```

**Criterio de éxito:** El dueño nuevo ve un checklist claro de qué configurar, y sabe que MP/WhatsApp/AFIP son opcionales pero recomendados.

---

### L6. Mejorar bloqueo de agenda (vacaciones, feriados, descansos)

**Por qué:** Hoy solo se puede definir horarios por día de la semana (schedules). No hay forma de bloquear "del 24 al 31 de diciembre" o "el 1 de mayo es feriado". El dueño tiene que cargarlos manualmente como turnos con descripción "Vacaciones".

**Diseño propuesto:**
- Nueva tabla `schedule_blocks(id, shop_id, barber_id nullable, starts_at, ends_at, reason)`. Si barber_id null → afecta a todos. RLS por shop.
- En `lib/availability.ts`: al calcular slots disponibles, excluir los que solapan con un block activo.
- UI: en Ajustes → tab nuevo "Bloqueos" o sub-sección de Horarios. Form: barbero (todos/uno), desde, hasta, motivo. Lista de bloqueos activos con opción "borrar".

**Archivos:**
- Nueva migration `0016_schedule_blocks.sql`
- `src/lib/availability.ts`
- `src/app/actions/ajustes.ts` (agregar create/delete block)
- `src/components/shop/AjustesView.tsx` (nuevo tab "Bloqueos" o sub-sección)

**Criterio de éxito:** El dueño puede marcar "del 24 al 31 todos cerrado" y esos slots no se ofrecen al cliente.

---

### L7. Agenda: indicador visual cuando hay seña paga vs no

**Por qué:** Hoy en AgendaView el badge "$✓" aparece pero es chiquito. Sería útil que las cards de turnos con seña paga tengan un color/borde distinto para que el dueño los vea de un vistazo y sepa "este ya pagó la seña".

**Archivos:**
- `src/components/shop/AgendaView.tsx` (función `AppointmentCard`, línea ~775)

**Criterio de éxito:** Al abrir agenda, los turnos con seña paga se distinguen visualmente sin tener que leer el badge.

---

### L8. Dashboard: overview visual del día al abrir el panel

**Por qué:** Hoy `/shop` redirige a agenda. El dueño no tiene un home con "tarjetón del día" (ocupación, próximo turno, ingresos hoy, etc).

**Archivos:**
- `src/app/shop/page.tsx`
- Probablemente nuevo `src/components/shop/DayOverview.tsx`

**Criterio de éxito:** Al abrir `/shop`, el dueño ve KPIs del día arriba y la agenda debajo (no solo agenda).

---

### L9. Stock conectado a Caja + alertas de stock bajo

**Por qué:** Hoy stock y caja están desconectados. La venta de producto desde Caja no decrementa stock (o lo hace pero no avisa). Tampoco hay alerta cuando un producto está por agotarse.

**Archivos:**
- `src/components/shop/StockView.tsx`
- `src/components/shop/CashView.tsx`
- Posiblemente nueva action o trigger SQL

**Criterio de éxito:** Vender un producto en caja decrementa stock. Si quedan ≤3 unidades, aparece warning en Stock + en Dashboard.

---

## 🌿 Workflow de ramas

**Regla:** cada uno trabaja en SU PROPIA rama, NO en `main`. Al terminar cada tanda de cambios, se hace PR a `main` y squash merge. Esto evita pisarse y mantiene main estable para deploys.

### Agustín
Sigue trabajando en la rama actual: **`cambios-pagos-y-facturador`** (ya tiene el commit base de AFIP backend + responsive fix + tab Facturación). Para arrancar:

```powershell
cd C:\Users\aducculli\Desktop\Dev\TURNOSBARBERIA
git checkout cambios-pagos-y-facturador
git pull origin main --rebase   # traer cambios nuevos de main si los hay
```

Al terminar:
```powershell
git push origin cambios-pagos-y-facturador
gh pr create --base main --title "feat: AFIP + bug fixes + demo seed" --fill
# tras review: squash merge en GitHub
```

### Lucas
Crea una rama NUEVA desde `main` actualizado. Sugerencia de nombre: **`feat/ui-pre-launch`** (o el que prefiera).

```powershell
cd C:\Users\aducculli\Desktop\Dev\TURNOSBARBERIA
git checkout main
git pull origin main
git checkout -b feat/ui-pre-launch
```

Al terminar:
```powershell
git push -u origin feat/ui-pre-launch
gh pr create --base main --title "feat: landing + responsive desktop + UX cliente" --fill
# tras review: squash merge en GitHub
```

### Orden de merges a main
1. **Agustín mergea primero** — su trabajo es backend/datos, base sobre la que Lucas eventualmente apoya UI (ej: tab Facturación necesita la migration aplicada para no romper en preview).
2. Cuando agustín mergea, **Lucas hace `git pull origin main --rebase`** en su rama para traer los cambios y resolver conflictos chicos si los hay.
3. Lucas mergea su rama después.
4. Si surgen conflictos serios al rebase, se resuelven en la rama de quien rebasea (no en main).

### Convención de commits
Mismo estilo que ya usa el repo (visible en `git log`):
- `feat: nombre corto` para features
- `fix: nombre corto` para bugs
- `feat(scope): nombre` cuando hay scope claro (ej. `feat(invoicing): ...`)
- Co-autoría con Claude: agregar al final del mensaje `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

---

## ⚙️ Coordinación

### Orden sugerido para no pisarse

**Hoy (después de leer este plan):**
1. Agustín aplica migration 0014 (A4) → desbloquea backend AFIP en cualquier ambiente
2. Agustín hace commit del trabajo actual + push (A7) → libera la branch
3. Agustín y Lucas pullean main, arrancan sus respectivas ramas

**Mañana / próximos días:**
- Agustín: A1 (terminar UI facturar), A2 (bug agenda), A3 (demo seed), A5 (cuenta TusFacturas), A6 (release_expired_holds)
- Lucas: L1 (landing) primero, después L2-L9 según prioridad

### Conflictos esperables

- L4 (botones inline mis-turnos) y la posible mejora L3 (multi-shop) pueden tocar `MyAppointmentsView.tsx`. Hacer L3 primero, después L4.
- L8 (dashboard) y A3 (demo seed con turnos) son independientes pero el seed se ve mejor cuando hay un dashboard que mostrar. Coordinar.
- L1 (landing) es totalmente aislada — no hay conflicto.

### Cómo testear todo end-to-end antes de la demo

Una vez que A1, A3, A4, A5 estén listos:
1. `node --env-file=.env.production.local scripts/setup-demo-users.mjs`
2. Loguearse con `dueno.demo@turnosbarberia.app` / `Demo1234`
3. Verificar que agenda tiene turnos, caja tiene plata, Ajustes muestra MP activo
4. Cargar credenciales TusFacturas en Ajustes/Facturación
5. Ir a Caja → "Facturar" sobre un sale → form → ver CAE devuelto + PDF
6. Loguearse con `cliente.demo@turnosbarberia.app` → reservar turno con servicio que tenga seña → pagar con user de test MP (`TESTUSER1439678993824298885` / `sLQpym1Jji`) → ver que el dueño lo recibe en agenda con `$✓`

---

## 📎 Credenciales y links rápidos

- **Supabase project ref:** `jjtknobjfljnlnurvbey`
- **Vercel project:** `turnosbarberia` → `https://barberiaonline.vercel.app`
- **Demo dueño:** `dueno.demo@turnosbarberia.app` / `Demo1234`
- **Demo cliente:** `cliente.demo@turnosbarberia.app` / `Demo1234`
- **MP user comprador test:** `TESTUSER1439678993824298885` / `sLQpym1Jji` (código 212952)
- **MP access token DI (test):** `MP_DEV_ACCESS_TOKEN` en `.env.local`
- **MCP de MercadoPago:** ya configurado a user-level, expone tools para crear preferences, consultar pagos, etc.
- **Plugin oficial MP:** instalado a user-level, ofrece skills `mp-integrate`, `mp-webhooks`, `mp-test-setup`, `mp-review`

---

*Última actualización: 2026-05-18*
