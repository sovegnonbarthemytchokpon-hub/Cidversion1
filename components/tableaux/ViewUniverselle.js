/*
 * Blind Universelle view: lucky numbers and all calculated values come from
 * the dedicated Supabase Edge Function.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadUniverselle(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les Tableaux.');
  }
  /*
   * With no historical date selected, let the early-access controller choose
   * either the normal programme or the following programme unlocked at 16:00.
   * An explicit date remains reserved for the date picker/archive.
   */
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-universelle'
  );
  const { data, error } = await supabase.functions.invoke('calcule-universelle', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  window.cidRecordProgramTraffic?.('universelle', window.cidSmartCountry?.get?.() || '');
  return assertTableauProgrammeDate(data, programmeDate, 'Universelle');
}
