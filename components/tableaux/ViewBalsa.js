/*
 * Balsa Plus display boundary: the browser only requests the official
 * date-specific result from the protected database-backed Edge Function.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadBalsa(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les Tableaux.');
  }
  const requestedDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-balsa'
  );
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error('Date Balsa Plus invalide.');
  }
  /*
   * Always send the date selected by Anticipé. Omitting it makes the Edge
   * Function resolve its clock again and can silently return the current
   * programme instead of the future one.
   */
  const programmeDate = requestedDate || undefined;
  const { data, error } = await supabase.functions.invoke('calcul-balsa', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  window.cidRecordProgramTraffic?.('balsa', window.cidSmartCountry?.get?.() || '');
  return assertTableauProgrammeDate(data, programmeDate, 'Balsa Plus');
}
