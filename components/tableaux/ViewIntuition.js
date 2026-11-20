/*
 * Blind Intuition view: the client receives immutable display data only.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadIntuition(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les Tableaux.');
  }
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-intuition'
  );
  const { data, error } = await supabase.functions.invoke('calcul-intuition', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  window.cidRecordProgramTraffic?.('intuition', window.cidSmartCountry?.get?.() || '');
  return assertTableauProgrammeDate(data, programmeDate, 'Intuition');
}
