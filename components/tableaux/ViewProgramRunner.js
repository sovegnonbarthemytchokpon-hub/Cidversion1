/*
 * Client boundary for programmes created from the administrator panel.
 * The calculation itself stays in the program-runner Edge Function.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

export async function loadCreatedPrograms(selectedDate) {
  const bridge = await Promise.resolve(window.cidSupabaseReady);
  const supabase = bridge?.client;
  if (!supabase?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour les programmes créés.');
  }
  /*
   * A grant for LNB, Balsa or another Tableau must never make custom
   * programmes jump to the same future date. Each feature owns its own
   * anticipation entitlement.
   */
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-created'
  );
  const { data, error } = await supabase.functions.invoke('program-runner', {
    body: programmeDate ? { date: programmeDate } : {}
  });
  if (error) throw error;
  /*
   * The official Tableaux already render these programmes from their own
   * Edge Functions. Older catalogues can still contain an `oracle` (or
   * another built-in key) row, so do not let program-runner mount a second
   * copy under “Programmes personnalisés”.
   */
  const builtInKeys = new Set([
    'universal',
    'universelle',
    'intuition',
    'oracle',
    'lnb',
    'balsa',
    'balsa-plus',
    'standby',
    'stand-by',
    'robot'
  ]);
  const seen = new Set();
  const dateChecked = assertTableauProgrammeDate(
    data,
    programmeDate,
    'Programmes personnalisés'
  );
  return (Array.isArray(dateChecked?.programs) ? dateChecked.programs : []).filter((program) => {
    const key = String(program?.id || program?.programKey || program?.program_key || '')
      .trim()
      .toLowerCase()
      .replace(/^tableaux[-_]/, '');
    if (!key || builtInKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
