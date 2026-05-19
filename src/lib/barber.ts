/**
 * Genera las iniciales de un nombre para usar como avatar fallback.
 *   "Juan Pérez"   → "JP"
 *   "Tomás"        → "TO"
 *   ""             → "??"
 */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
