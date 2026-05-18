// ============================================================================
// Esquemas Zod compartidos entre actions (booking, onboarding, ajustes).
// Centraliza regex y constraints para evitar drift entre módulos.
// ============================================================================
import { z } from 'zod';

// ── Regex base ──────────────────────────────────────────────────────────────

/** Nombres de personas (booking). Letras, espacios, guiones, puntos, apóstrofes. */
export const NAME_RE = /^[\p{L}\s'.-]{2,80}$/u;

/** Líneas de texto cortas: nombres de shop/servicios/barberos. Más permisivo que NAME_RE. */
export const NAME_LINE_RE = /^[\p{L}\p{N}\s'.,&·()+\/:#%°-]{2,80}$/u;

/** Teléfonos: dígitos, espacios, paréntesis, guiones, signo +. */
export const PHONE_RE = /^[+\d\s()-]{6,30}$/;

/** Slug público: [a-z0-9][a-z0-9-]{1,40}[a-z0-9] */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;

/** Hora en formato HH:MM (00-29, 00-59). */
export const TIME_RE = /^[0-2]\d:[0-5]\d$/;

/** IANA timezone básica (Area/City[/Sub]). No exhaustiva, pero razonable. */
export const TIMEZONE_RE = /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/;

// Ojo: incluye no solo rutas top-level, sino también subpaths del `/[slug]/*`
// que colisionarían (`perfil`, `reservar`, `mis-turnos`, etc.), para que
// nadie registre una barbería con slug "perfil" que pise esas rutas.
export const RESERVED_SLUGS = new Set([
  's', 'shop', 'admin', 'api', 'auth', 'login', 'registro', 'onboarding',
  'demo', 'desarrollo', 'desa', 'cuenta',
  'perfil', 'confirmacion', 'reservar', 'mis-turnos', 'equipo'
]);

// ── Helpers de schema ───────────────────────────────────────────────────────

/** trim + validar contra NAME_LINE_RE. */
export const shopNameSchema = z
  .string()
  .trim()
  .regex(NAME_LINE_RE, 'Nombre inválido (2-80 caracteres)');

export const personNameSchema = z
  .string()
  .trim()
  .regex(NAME_RE, 'Nombre inválido');

export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(PHONE_RE, 'Teléfono inválido');

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .or(z.literal(''))
  .transform(v => (v || '').trim())
  .refine(v => v === '' || PHONE_RE.test(v), 'Teléfono inválido');

export const addressSchema = z
  .string()
  .trim()
  .max(160, 'Dirección demasiado larga')
  .optional()
  .or(z.literal(''));

export const timezoneSchema = z
  .string()
  .trim()
  .max(60)
  .regex(TIMEZONE_RE, 'Timezone inválida');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE, 'Slug inválido (solo minúsculas, números y guiones)')
  .refine(s => !s.includes('--'), 'No uses guiones dobles')
  .refine(s => !RESERVED_SLUGS.has(s), 'Este slug está reservado');

export const timeSchema = z
  .string()
  .regex(TIME_RE, 'Hora inválida (HH:MM)');

export const uuidSchema = z.string().uuid('ID inválido');

// ── Schemas por entidad ─────────────────────────────────────────────────────

export const UpdateShopSchema = z.object({
  name: shopNameSchema,
  address: addressSchema,
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  timezone: z.string().trim().max(60).optional().or(z.literal(''))
});

export const UpsertServiceSchema = z.object({
  id: uuidSchema.optional(),
  name: shopNameSchema,
  duration_mins: z.coerce.number().int().min(5, 'Mínimo 5 min').max(480, 'Máximo 480 min'),
  price: z.coerce.number().min(0, 'Precio negativo').max(10_000_000, 'Precio demasiado alto'),
  description: z.string().trim().max(240).optional().or(z.literal('')),
  deposit_type: z.enum(['none', 'percent', 'fixed', 'full']).optional().default('none'),
  deposit_amount: z.coerce.number().min(0).max(10_000_000).optional().default(0)
}).refine(
  (d) => d.deposit_type !== 'percent' || (d.deposit_amount >= 0 && d.deposit_amount <= 100),
  { message: 'El porcentaje de seña debe estar entre 0 y 100', path: ['deposit_amount'] }
).refine(
  (d) => d.deposit_type === 'none' || d.deposit_amount > 0 || d.deposit_type === 'full',
  { message: 'La seña debe ser mayor a 0', path: ['deposit_amount'] }
);

export const UpsertBarberSchema = z.object({
  id: uuidSchema.optional(),
  name: shopNameSchema,
  role: z.string().trim().max(60).optional().or(z.literal('')),
  initials: z.string().trim().max(4).optional(),
  hue: z.coerce.number().int().min(0).max(360).optional(),
  commission_pct: z.coerce.number().min(0, 'Mínimo 0%').max(100, 'Máximo 100%').optional()
});

export const UpdateSchedulesItemSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: timeSchema,
  end_time: timeSchema,
  is_working: z.boolean()
});

export const AddShopSchema = z.object({
  name: shopNameSchema,
  slug: slugSchema,
  address: addressSchema,
  phone: z.string().trim().max(30).optional().or(z.literal(''))
});

export const SwitchShopSchema = z.object({
  shopId: uuidSchema
});

// ── Util: formatear issues zod como string amistoso ─────────────────────────

export function formatZodError(err: z.ZodError): string {
  return err.issues.map(i => i.message).join(', ');
}
