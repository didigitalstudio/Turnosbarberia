import { createClient as createServerClient } from '@/lib/supabase/server';
import { isoFromARLocal, partsInAR, SHOP_OFFSET } from '@/lib/tz';

const SLOT_GRANULARITY_MIN = 30;

export type Slot = { time: string; iso: string; taken: boolean };

function pad(n: number) { return n.toString().padStart(2, '0'); }
function hmToMin(hm: string) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }
function minToHM(mins: number) { return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }

export async function getAvailableSlots(shopId: string, barberId: string, serviceId: string, dateISO: string) {
  const supabase = createServerClient();

  // Anclamos al mediodía ARG: en cualquier runtime el `dow` corresponde al
  // día de la semana en ARG (no al UTC).
  const dayAnchor = new Date(`${dateISO}T12:00:00${SHOP_OFFSET}`);
  const dayOfWeek = partsInAR(dayAnchor).dow;

  // Rango UTC equivalente a [00:00 ARG, 24:00 ARG) para filtrar appointments.
  const dayStartUTC = new Date(`${dateISO}T00:00:00${SHOP_OFFSET}`).toISOString();
  const dayEndUTC = new Date(`${dateISO}T24:00:00${SHOP_OFFSET}`).toISOString();

  // Antes de leer disponibilidad, liberamos los holds (pending_payment) cuya
  // ventana expiró. Lazy cleanup: evita mostrar como ocupados slots cuyo
  // cliente nunca pagó la seña.
  await supabase.rpc('release_expired_holds').then(() => null, () => null);

  const [{ data: service }, { data: schedule }, { data: appts }] = await Promise.all([
    supabase.from('services').select('duration_mins').eq('id', serviceId).eq('shop_id', shopId).single(),
    supabase.from('schedules').select('*')
      .eq('shop_id', shopId)
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle(),
    supabase.from('appointments')
      .select('starts_at, ends_at')
      .eq('shop_id', shopId)
      .eq('barber_id', barberId)
      .gte('starts_at', dayStartUTC)
      .lt('starts_at', dayEndUTC)
      .not('status', 'in', '("cancelled","no_show","expired")')
  ]);

  if (!service || !schedule || !schedule.is_working) return [];

  const dur = service.duration_mins;
  const startMin = hmToMin(schedule.start_time);
  const endMin = hmToMin(schedule.end_time);

  const slots: Slot[] = [];
  for (let t = startMin; t + dur <= endMin; t += SLOT_GRANULARITY_MIN) {
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    // Construimos el ISO desde la hora ARG, no desde el TZ del runtime.
    // Antes: slotStart.setHours(...) en runtime UTC producía 15:00 UTC = 12hs ARG.
    const slotIsoUTC = isoFromARLocal(dateISO, hh, mm);
    const slotStartMs = new Date(slotIsoUTC).getTime();
    const slotEndMs = slotStartMs + dur * 60_000;

    const overlaps = (appts || []).some(a => {
      const aStart = new Date(a.starts_at).getTime();
      const aEnd = new Date(a.ends_at).getTime();
      return slotStartMs < aEnd && slotEndMs > aStart;
    });

    const inPast = slotStartMs < Date.now();
    slots.push({ time: minToHM(t), iso: slotIsoUTC, taken: overlaps || inPast });
  }

  return slots;
}
