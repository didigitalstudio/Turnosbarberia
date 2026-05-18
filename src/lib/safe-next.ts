// Util compartido para sanitizar el parámetro `?next=` usado en login,
// registro y auth callback. Solo permitimos paths same-origin que pertenecen
// a rutas conocidas. Bloqueamos protocolos, `//dominio`, `/\dominio`,
// `/%2Fdominio` y otros bypass clásicos de open-redirect.
const SAFE_NEXT_RE = /^\/(shop(?:\/.*)?|onboarding|registro|login|desarrollo(?:\/.*)?|perfil|cuenta\/[a-z-]+|[a-z0-9][a-z0-9-]{1,40}[a-z0-9](?:\/.*)?)?$/;

export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('//') || decoded.includes('\\')) return null;
  } catch {
    return null;
  }
  return SAFE_NEXT_RE.test(raw) ? raw : null;
}
