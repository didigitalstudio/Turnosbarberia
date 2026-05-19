import Link from 'next/link';
import { Icon } from '@/components/shared/Icon';
import { Stripe } from '@/components/shared/Stripe';

// Landing page de venta para TurnosBarbería. Server component: sin hooks.
// Se renderiza desde /page.tsx siempre (landing es la home pública del producto).
// `viewer` cambia los CTAs del navbar si ya hay sesión (link a su panel).

export type LandingViewer = { href: string; label: string } | null;

export function LandingPage({ viewer }: { viewer?: LandingViewer }) {
  return (
    <main className="bg-bg text-ink">
      <Navbar viewer={viewer ?? null} />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ---------- Navbar ---------- */

function Navbar({ viewer }: { viewer: LandingViewer }) {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-bg/90 backdrop-blur border-b border-line">
      <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="font-display text-2xl tracking-tight">
          TurnosBarbería
        </Link>
        <nav aria-label="Navegación principal" className="hidden md:flex items-center gap-8">
          <a href="#como-funciona" className="text-sm hover:text-ink/70 transition-colors">Cómo funciona</a>
          <a href="#features" className="text-sm hover:text-ink/70 transition-colors">Features</a>
          <a href="#precios" className="text-sm hover:text-ink/70 transition-colors">Precios</a>
          <a href="#contacto" className="text-sm hover:text-ink/70 transition-colors">Contacto</a>
          {viewer ? (
            <Link
              href={viewer.href}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-ink text-bg text-sm hover:bg-ink2 transition-colors"
            >
              {viewer.label}
              <Icon name="arrow-right" size={14} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm hover:text-ink/70 transition-colors">
                Entrar
              </Link>
              <Link
                href="/registro"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-ink text-bg text-sm hover:bg-ink2 transition-colors"
              >
                Registrate
                <Icon name="arrow-right" size={14} />
              </Link>
            </>
          )}
        </nav>
        <div className="md:hidden flex items-center gap-2">
          {viewer ? (
            <Link
              href={viewer.href}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-ink text-bg text-sm"
            >
              {viewer.label}
              <Icon name="arrow-right" size={12} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm hover:text-ink/70 transition-colors">
                Entrar
              </Link>
              <Link
                href="/registro"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-ink text-bg text-sm"
              >
                Registrate
                <Icon name="arrow-right" size={12} />
              </Link>
            </>
          )}
        </div>
      </div>
      <Stripe />
    </header>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <section className="pt-32 pb-16 md:pt-40 md:py-24">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="grid md:grid-cols-12 gap-10 md:gap-16 items-center">
          <div className="md:col-span-7">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-6">
              SaaS para barberías — multi-tenant
            </div>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.95] tracking-tight">
              Gestioná tu<br />
              barbería<br />
              <span style={{ color: '#B6754C' }}>online</span>.
            </h1>
            <p className="mt-8 text-xl md:text-2xl text-muted max-w-xl leading-relaxed">
              Agenda abierta 24/7, caja y control de equipo en una sola webapp.
              Sin descargas, sin apps, sin vueltas.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              <Link
                href="/registro"
                className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-ink text-bg text-base hover:bg-ink2 transition-colors"
              >
                Registrá tu barbería
                <Icon name="arrow-right" size={16} />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center sm:justify-start gap-1.5 px-4 py-2 text-sm text-ink/70 hover:text-ink transition-colors"
              >
                o entrá si ya tenés cuenta
                <Icon name="arrow-right" size={14} />
              </Link>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-muted">
              <span className="flex items-center gap-2"><Icon name="check" size={16} /> 2 min setup</span>
              <span className="flex items-center gap-2"><Icon name="check" size={16} /> Sin tarjeta</span>
              <span className="hidden sm:flex items-center gap-2"><Icon name="check" size={16} /> Español</span>
            </div>
          </div>

          <div className="md:col-span-5">
            <HeroMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMockup() {
  // "Teléfono" inline simulando la webapp del cliente.
  return (
    <div className="relative mx-auto max-w-[320px] md:max-w-[360px]">
      <div
        className="absolute -inset-4 rounded-[44px] opacity-20"
        style={{ background: 'radial-gradient(circle at 30% 20%, #B6754C 0%, transparent 60%)' }}
        aria-hidden="true"
      />
      <div className="relative rounded-[40px] bg-ink p-3 shadow-card">
        <div className="rounded-[32px] bg-bg overflow-hidden">
          <Stripe />
          <div className="px-5 pt-5 pb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">The Cut Club</div>
            <div className="font-display text-2xl mt-1 leading-tight">Reservá tu turno</div>
          </div>
          <div className="px-5 pb-5 space-y-2">
            <MockSlot time="10:00" barber="Lucas" taken />
            <MockSlot time="10:30" barber="Martín" />
            <MockSlot time="11:00" barber="Lucas" highlight />
            <MockSlot time="11:30" barber="Martín" />
            <MockSlot time="12:00" barber="Lucas" taken />
          </div>
          <div className="px-5 pb-5">
            <div
              className="w-full rounded-2xl py-3 text-center text-sm text-bg"
              style={{ background: '#0E0E0E' }}
            >
              Confirmar 11:00 con Lucas
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockSlot({
  time, barber, taken, highlight
}: { time: string; barber: string; taken?: boolean; highlight?: boolean }) {
  const base = 'flex items-center justify-between px-4 py-3 rounded-2xl border text-sm';
  if (taken) {
    return (
      <div className={`${base} border-line bg-transparent text-muted line-through`}>
        <span>{time}</span>
        <span className="font-mono text-xs uppercase">{barber}</span>
      </div>
    );
  }
  if (highlight) {
    return (
      <div
        className={`${base}`}
        style={{ borderColor: '#B6754C', background: 'rgba(182,117,76,0.08)' }}
      >
        <span className="font-medium">{time}</span>
        <span className="font-mono text-xs uppercase" style={{ color: '#B6754C' }}>{barber}</span>
      </div>
    );
  }
  return (
    <div className={`${base} border-line bg-card`}>
      <span>{time}</span>
      <span className="font-mono text-xs uppercase">{barber}</span>
    </div>
  );
}

/* ---------- Features ---------- */

type IconName = 'calendar' | 'cash' | 'users' | 'scissors' | 'clock' | 'check' | 'phone' | 'mail' | 'bag' | 'star' | 'settings';

function Features() {
  const items: Array<{ icon: IconName; title: string; body: string }> = [
    {
      icon: 'calendar',
      title: 'Agenda online 24/7',
      body: 'Tus clientes reservan sin llamarte. Slots inteligentes que evitan solapes.'
    },
    {
      icon: 'cash',
      title: 'Cobro anticipado · MercadoPago',
      body: 'Cobrá una seña al reservar y reducí el no-show. La plata va directo a tu cuenta MP, sin comisiones para nosotros.'
    },
    {
      icon: 'phone',
      title: 'Recordatorios por WhatsApp',
      body: 'Mensaje automático el día antes del turno. Menos olvidos, más facturación.'
    },
    {
      icon: 'mail',
      title: 'Facturación electrónica AFIP',
      body: 'Emití factura A/B/C desde Caja en un click. Integración nativa con TusFacturasAPP.'
    },
    {
      icon: 'users',
      title: 'Equipo y ocupación',
      body: 'Ocupación por barbero, horarios flexibles, bloqueos manuales.'
    },
    {
      icon: 'scissors',
      title: 'Un link único',
      body: 'Compartís tu link por Instagram o WhatsApp. Tus clientes entran, reservan y listo.'
    },
    {
      icon: 'settings',
      title: 'Diseño personalizable',
      body: 'Colores, logo y tipografías propias en tu agenda online. Tu marca, no la nuestra.'
    }
  ];
  return (
    <section id="features" className="py-16 md:py-24 border-t border-line">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="max-w-2xl mb-12 md:mb-16">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-4">Features</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight tracking-tight">
            Todo lo que necesitás,<br />nada que sobre.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {items.map((item, i) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} body={item.body} center={i === items.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, body, center }: { icon: IconName; title: string; body: string; center?: boolean }) {
  return (
    <div className={`rounded-2xl bg-card border border-line p-6 md:p-8 shadow-card${center ? ' lg:col-start-2' : ''}`}>
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'rgba(182,117,76,0.12)', color: '#B6754C' }}
      >
        <Icon name={icon} size={20} />
      </div>
      <h3 className="font-display text-2xl md:text-3xl leading-tight mb-2">{title}</h3>
      <p className="text-muted leading-relaxed">{body}</p>
    </div>
  );
}

/* ---------- How it works ---------- */

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Registrás tu barbería',
      body: 'Email + nombre + un par de datos. 2 minutos.'
    },
    {
      n: '02',
      title: 'Configurás servicios, equipo y horarios',
      body: 'Con un wizard paso a paso, sin tocar nada técnico.'
    },
    {
      n: '03',
      title: 'Compartís tu link',
      body: '/tu-barberia. Tus clientes reservan solos.'
    }
  ];
  return (
    <section id="como-funciona" className="bg-ink text-bg py-16 md:py-24">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="max-w-2xl mb-12 md:mb-16">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-dark-muted mb-4">Cómo funciona</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight tracking-tight">
            De cero a reservas<br />en una tarde.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-dark-line pt-6">
              <div className="font-display text-6xl md:text-7xl leading-none" style={{ color: '#B6754C' }}>
                {s.n}
              </div>
              <h3 className="font-display text-2xl md:text-3xl leading-tight mt-4">{s.title}</h3>
              <p className="text-dark-muted mt-2 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */

const WA_LINK = 'https://wa.me/5491169459990';

const ADDONS: Array<{ icon: IconName; name: string; sub?: string; body: string }> = [
  {
    icon: 'cash',
    name: 'Cobro anticipado',
    sub: 'MercadoPago',
    body: 'Cobrá el turno por adelantado. Los clientes pagan al reservar.',
  },
  {
    icon: 'bag',
    name: 'Facturación electrónica',
    sub: 'AFIP · TusFacturas',
    body: 'Emití facturas A, B o C automáticamente al cerrar cada turno.',
  },
  {
    icon: 'phone',
    name: 'Recordatorios por WhatsApp',
    body: 'Avisos automáticos antes del turno. Menos ausencias, más ocupación.',
  },
  {
    icon: 'star',
    name: 'Landing con dominio propio',
    body: 'Tu barbería en tu dominio. Sin /ruta compartida, con tu-barberia.com.',
  },
];

function AddonCard({ icon, name, sub, body }: { icon: IconName; name: string; sub?: string; body: string }) {
  return (
    <div className="rounded-2xl bg-card border border-dashed border-line p-6 md:p-7 shadow-card flex flex-col">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 flex-shrink-0"
        style={{ background: 'rgba(182,117,76,0.10)', color: '#B6754C' }}
      >
        <Icon name={icon} size={18} />
      </div>
      <div className="font-display text-xl md:text-2xl leading-tight">{name}</div>
      {sub && <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mt-1">{sub}</div>}
      <p className="text-muted text-sm leading-relaxed mt-2 flex-1">{body}</p>
      <a
        href={WA_LINK}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink hover:text-ink/70 transition-colors"
      >
        Consultar <Icon name="arrow-right" size={14} />
      </a>
    </div>
  );
}

function Pricing() {
  return (
    <section id="precios" className="py-16 md:py-24 border-t border-line">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="max-w-2xl mb-12 md:mb-16">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-4">Precios</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight tracking-tight">
            Elegí tu plan.<br />Empezá hoy.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          <PricingCard
            kind="starter"
            name="Starter"
            description="Para empezar a ordenar la agenda."
            features={[
              'Hasta 3 barberos',
              '1 sede',
              'Agenda ilimitada',
              'Dashboard con estadísticas',
              'Recordatorios por email',
              'Soporte por email'
            ]}
          />
          <PricingCard
            kind="pro"
            name="Pro"
            description="Para barberías que crecen."
            features={[
              'Barberos ilimitados',
              'Sedes ilimitadas',
              'Caja integrada',
              'Stock de productos',
              'Dashboard con estadísticas',
              'Soporte prioritario'
            ]}
            highlight
          />
        </div>

        <div className="mt-14 md:mt-20">
          <div className="mb-8 md:mb-10">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-2">Módulos adicionales</div>
            <p className="text-muted leading-relaxed max-w-xl">
              Sumale al plan que elijas los módulos que necesitás. Disponibles a consultar.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {ADDONS.map((a) => <AddonCard key={a.name} {...a} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  kind, name, description, features, highlight
}: {
  kind: 'starter' | 'pro';
  name: string;
  description: string;
  features: string[];
  highlight?: boolean;
}) {
  const priceKey = kind === 'starter' ? 'starter-price' : 'pro-price';
  return (
    <div
      className={`relative rounded-2xl bg-card p-8 md:p-10 shadow-card ${highlight ? 'border-2' : 'border border-line'}`}
      style={highlight ? { borderColor: '#B6754C' } : undefined}
    >
      {highlight && (
        <div
          className="absolute -top-3 left-8 px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.2em] text-bg"
          style={{ background: '#B6754C' }}
        >
          Más elegido
        </div>
      )}
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Plan</div>
      <h3 className="font-display text-4xl md:text-5xl mt-1">{name}</h3>
      <p className="text-muted mt-2">{description}</p>
      <div className="mt-6 mb-8 flex items-baseline gap-2">
        <span
          data-placeholder={priceKey}
          className="font-display text-4xl md:text-5xl"
        >
          {kind === 'starter' ? '$30.000' : '$50.000'}
        </span>
        <span className="text-muted text-sm">ARS / mes</span>
      </div>
      <ul className="space-y-3 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-sm">
            <span
              className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(182,117,76,0.14)', color: '#B6754C' }}
            >
              <Icon name="check" size={12} />
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/registro"
        className={`inline-flex items-center justify-center gap-2 w-full px-6 py-4 rounded-2xl text-base transition-colors ${
          highlight
            ? 'bg-ink text-bg hover:bg-ink2'
            : 'border border-ink/20 text-ink hover:bg-ink/5'
        }`}
      >
        Empezar
        <Icon name="arrow-right" size={16} />
      </Link>
    </div>
  );
}

/* ---------- FAQ ---------- */

function Faq() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: '¿Hay período de prueba?',
      a: 'El registro necesita aprobación manual mientras estamos en beta; mientras tanto no te cobramos nada hasta tener todo andando. Si querés ver el producto antes de registrarte, escribinos por WhatsApp y te coordinamos un acceso de prueba.'
    },
    {
      q: '¿Cobran comisión por los pagos con Mercado Pago?',
      a: 'No. La plata va directo a tu cuenta de Mercado Pago — nosotros solo facilitamos el cobro. La única comisión es la que cobra MP, igual que si vendieras por su QR.'
    },
    {
      q: '¿Cómo funciona la facturación electrónica?',
      a: 'Integramos con TusFacturasAPP. Cargás tus credenciales una sola vez en Ajustes y desde el módulo de Caja emitís facturas A/B/C en un click. El CAE y el PDF te quedan guardados en el turno.'
    },
    {
      q: '¿Qué necesito para activar WhatsApp?',
      a: 'Un número dedicado para WhatsApp Business y verificación de empresa en Meta (toma 1-2 semanas la primera vez). Después cargás tus credenciales en Ajustes y los recordatorios salen solos el día previo a cada turno.'
    },
    {
      q: '¿Qué pasa si supero los 3 barberos en el plan Starter?',
      a: 'Te avisamos cuando te estés acercando. Para pasar a Pro, escribinos por WhatsApp o mail.'
    },
    {
      q: '¿Mis clientes necesitan crear cuenta?',
      a: 'Sí. Para evitar turnos fantasma, exigimos registro al reservar (nombre, email, teléfono). El proceso es rápido y queda atado a su próxima reserva.'
    },
    {
      q: '¿Cómo comparto mi barbería con mis clientes?',
      a: 'Tenés un link único turnosbarberia.com/tu-barberia. Lo pegás en Instagram, WhatsApp, lo que quieras.'
    },
    {
      q: '¿Puedo exportar mis datos?',
      a: 'Sí. Escribinos y te los mandamos en CSV.'
    },
    {
      q: '¿Cómo se paga?',
      a: 'Transferencia bancaria o MercadoPago mensual (sin suscripción automática).'
    }
  ];
  return (
    <section id="faq" className="py-16 md:py-24 border-t border-line">
      <div className="max-w-3xl mx-auto px-5 md:px-8">
        <div className="mb-10 md:mb-12">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-4">Preguntas frecuentes</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight tracking-tight">
            Lo que<br />siempre preguntan.
          </h2>
        </div>
        <div>
          {items.map((it, i) => (
            <details
              key={it.q}
              className={`group py-5 ${i === 0 ? 'border-t' : ''} border-b border-line`}
            >
              <summary className="flex items-start justify-between gap-4 cursor-pointer list-none">
                <span className="font-display text-xl md:text-2xl leading-snug text-ink">{it.q}</span>
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 mt-1 text-muted transition-transform duration-200 group-open:rotate-180"
                >
                  <Icon name="chevron-down" size={18} />
                </span>
              </summary>
              <p className="mt-3 text-muted leading-relaxed text-[15px] max-w-[58ch]">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */

function FinalCta() {
  return (
    <section className="bg-ink text-bg py-16 md:py-24">
      <div className="max-w-6xl mx-auto px-5 md:px-8 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-dark-muted mb-6">Empezá ahora</div>
        <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-3xl mx-auto">
          ¿Listo para probarlo?
        </h2>
        <p className="text-lg md:text-xl text-dark-muted mt-6 max-w-xl mx-auto">
          Armá tu barbería en minutos. Compartí el link. Dejá de perder turnos.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
          <Link
            href="/registro"
            className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-bg text-ink text-base hover:bg-bg/90 transition-colors"
          >
            Registrá tu barbería
            <Icon name="arrow-right" size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm text-dark-muted hover:text-bg transition-colors"
          >
            o entrá si ya tenés cuenta
            <Icon name="arrow-right" size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */

function Footer() {
  return (
    <footer id="contacto" className="border-t border-line py-12 md:py-16">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10">
          <div className="col-span-2 md:col-span-2">
            <div className="font-display text-2xl tracking-tight">TurnosBarbería</div>
            <p className="text-muted text-sm mt-3 max-w-xs">
              SaaS para barberías. Hecho en Buenos Aires.
            </p>
            <p className="text-muted text-sm mt-4">
              Desarrollado por{' '}
              <a
                href="https://didigitalstudio.com"
                target="_blank"
                rel="noreferrer"
                className="text-ink hover:text-ink/70 underline underline-offset-2"
              >
                DI Digital Studio
              </a>
            </p>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-4">Producto</div>
            <ul className="space-y-2 text-sm">
              <li><Link href="/registro" className="hover:text-ink/70">Registro</Link></li>
              <li><Link href="/login" className="hover:text-ink/70">Login</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-4">Contacto</div>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="mailto:info@didigitalstudio.com"
                  className="hover:text-ink/70"
                >
                  info@didigitalstudio.com
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/5491169459990"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink/70"
                >
                  WhatsApp · Lucas
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t border-line flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="text-xs text-muted">
            © 2026 Desarrollos BA · Desarrollado por{' '}
            <a
              href="https://didigitalstudio.com"
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:text-ink/70"
            >
              DI Digital Studio
            </a>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            v1.0 — Buenos Aires, AR
          </div>
        </div>
      </div>
    </footer>
  );
}
