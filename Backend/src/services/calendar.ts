/**
 * Calendario legal chileno para calcular plazos.
 *
 * El DS 21/2024 (reglamento de la Ley Karin) establece que sus plazos son de días hábiles, «entendiéndose que son
 * inhábiles los días sábados, domingos y festivos». Los días se cuentan según la fecha en Chile continental.
 *
 * FERIADOS: feriados nacionales (no regionales). Actualizar cada año con el calendario oficial; los feriados por
 * elecciones se agregan cuando se fijan.
 */
const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-19", "2025-05-01", "2025-05-21", "2025-06-20", "2025-06-29", "2025-07-16",
  "2025-08-15", "2025-09-18", "2025-09-19", "2025-10-12", "2025-10-31", "2025-11-01", "2025-11-16", "2025-12-08",
  "2025-12-14", "2025-12-25",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-04", "2026-05-01", "2026-05-21", "2026-06-21", "2026-06-29", "2026-07-16",
  "2026-08-15", "2026-09-18", "2026-09-19", "2026-10-12", "2026-10-31", "2026-11-01", "2026-12-08", "2026-12-25",
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-27", "2027-05-01", "2027-05-21", "2027-06-21", "2027-06-28", "2027-07-16",
  "2027-08-15", "2027-09-18", "2027-09-19", "2027-10-11", "2027-10-31", "2027-11-01", "2027-12-08", "2027-12-25",
]);

export const HOLIDAYS_UNTIL = 2027;

const TZ = "America/Santiago";
const DAY = 86_400_000;

/** Fecha calendario (año, mes, día) de un instante, en Chile. */
function chileDate(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Instante de las 23:59:59 de ese día en Chile (hasta cuándo se puede cumplir un plazo que vence ese día). */
function endOfChileDay(utcMidnight: number): Date {
  const wall = utcMidnight + DAY - 1000; // 23:59:59 «como si» fuera UTC
  // Diferencia entre la hora de Chile y UTC en ese momento (considera horario de verano).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(wall));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(wall + (wall - asUtc));
}

const isoOf = (utcMidnight: number) => new Date(utcMidnight).toISOString().slice(0, 10);

export function isBusinessDay(utcMidnight: number): boolean {
  const weekday = new Date(utcMidnight).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(isoOf(utcMidnight));
}

/** Vence al final del N-ésimo día hábil siguiente a `from` (el día de inicio no se cuenta). */
export function addBusinessDays(from: Date, days: number): Date {
  const { y, m, d } = chileDate(from);
  let t = Date.UTC(y, m - 1, d);
  let added = 0;
  while (added < days) {
    t += DAY;
    if (isBusinessDay(t)) added++;
  }
  return endOfChileDay(t);
}

/** Vence al final del N-ésimo día corrido siguiente a `from`. */
export function addCalendarDays(from: Date, days: number): Date {
  const { y, m, d } = chileDate(from);
  return endOfChileDay(Date.UTC(y, m - 1, d) + days * DAY);
}
