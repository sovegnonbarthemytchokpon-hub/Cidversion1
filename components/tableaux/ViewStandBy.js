/*
 * Blind StandBy view: country rankings are produced only by Supabase.
 */
import {
  assertTableauProgrammeDate,
  resolveTableauProgrammeDate
} from '../../src/tableaux/tableau-contract.js';

const pendingRequests = new Map();

async function getFunctionError(error) {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return error;
  try {
    const body = await response.clone().json();
    if (body?.error) return new Error(`calcul-standby: ${body.error}`);
  } catch (_) {
    // Keep Supabase's original error when the response is not JSON.
  }
  return error;
}

export async function loadStandBy(selectedDate) {
  // A current-programme request must be resolved by the server clock. Avoid
  // sharing a current-programme response across the 16:00 boundary.
  const programmeDate = resolveTableauProgrammeDate(
    selectedDate,
    'tableaux-standby'
  );
  const cacheKey = programmeDate || '';
  if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const request = (async () => {
    const bridge = await Promise.resolve(window.cidSupabaseReady);
    const supabase = bridge?.client;
    if (!supabase?.functions?.invoke) {
      throw new Error('Supabase n’est pas configuré pour les Tableaux.');
    }
    const { data, error } = await supabase.functions.invoke('calcul-standby', {
      body: programmeDate ? { date: programmeDate } : {}
    });
    if (error) throw await getFunctionError(error);
    if (!data || !Array.isArray(data.rows)) {
      throw new Error('calcul-standby: réponse invalide.');
    }
    window.cidRecordProgramTraffic?.('standby', window.cidSmartCountry?.get?.() || '');
    return assertTableauProgrammeDate(data, programmeDate, 'Stand-by');
  })();

  pendingRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingRequests.delete(cacheKey);
  }
}
