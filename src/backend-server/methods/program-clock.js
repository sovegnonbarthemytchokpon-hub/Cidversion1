/*
 * Shared programme clock.
 *
 * Every programme belongs to the next calendar day once the generation
 * boundary (16:00 local time) has been reached. Keeping this in one module
 * prevents the Tableaux, Croix, Matrice and rejected-balls views from using
 * different programme dates.
 */

export const PROGRAM_GENERATION_HOUR = 16;
export const PROGRAM_TIME_ZONE = 'Africa/Abidjan';

function clockParts(referenceDate) {
  const source = referenceDate instanceof Date
    ? referenceDate
    : new Date(referenceDate);
  const safe = Number.isNaN(source.getTime()) ? new Date() : source;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROGRAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(safe);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    source: safe,
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour')
  };
}

export function getProgrammeDate(referenceDate = new Date()) {
  const parts = clockParts(referenceDate);
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + (parts.hour >= PROGRAM_GENERATION_HOUR ? 1 : 0),
    12
  ));
}

/*
 * Returns the real instant of the next 16:00 Africa/Abidjan boundary.
 * Abidjan is UTC year-round, but the calendar parts are still read through
 * Intl so a visitor's device timezone can never move the refresh to another
 * day.
 */
export function getNextProgrammeBoundary(referenceDate = new Date()) {
  const parts = clockParts(referenceDate);
  const todayBoundary = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    PROGRAM_GENERATION_HOUR,
    0,
    0,
    0
  );
  const boundary = parts.source.getTime() < todayBoundary
    ? todayBoundary
    : Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day + 1,
        PROGRAM_GENERATION_HOUR,
        0,
        0,
        0
      );
  return new Date(boundary);
}

export const programmeDateAt16h = getProgrammeDate;
