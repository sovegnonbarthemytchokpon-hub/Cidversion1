/*
 * Blind Oracle view: presentation only; all Oracle rules stay in Supabase.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadOracle(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les Tableaux.');
  }
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-oracle'
  );
  const { data, error } = await supabase.functions.invoke('calcul-oracle', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  window.cidRecordProgramTraffic?.('oracle', window.cidSmartCountry?.get?.() || '');
  return assertTableauProgrammeDate(data, programmeDate, 'Oracle');
}
