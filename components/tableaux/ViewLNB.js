/*
 * Blind LNB view: the browser only requests and displays the server payload.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadLNB(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les Tableaux.');
  }
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-lnb'
  );
  const { data, error } = await supabase.functions.invoke('calcul-lnb', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  window.cidRecordProgramTraffic?.('lnb', window.cidSmartCountry?.get?.() || '');
  return assertTableauProgrammeDate(data, programmeDate, 'LNB');
}
