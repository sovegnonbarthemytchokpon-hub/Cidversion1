/*
 * Client boundary for protected programme calculations.
 *
 * The calculation code is not imported here. Supabase Edge Functions own the
 * method, the anti-repetition lookup and the database write; this module only
 * sends input and receives the validated public result.
 */

async function getSupabaseBridge() {
  const bridge = await window.cidSupabaseReady;
  if (!bridge?.client) throw new Error('Supabase est indisponible.');
  return bridge;
}

export async function generateCroixNationaleProgramme({ date = null, scope = 'year' } = {}) {
  const bridge = await getSupabaseBridge();
  // The deployed Supabase function currently uses the name "smart-processor".
  // Keep the client aligned with that deployed name so the phone setup does
  // not require copying the full Edge Function into a second function.
  const { data, error } = await bridge.client.functions.invoke('smart-processor', {
    body: {
      date: date || undefined,
      scope: scope === 'month' ? 'month' : 'year'
    }
  });
  if (error) throw error;
  if (!data?.ok || !data?.record) {
    throw new Error(data?.error || 'La fonction sécurisée n’a pas retourné de programme.');
  }
  return data.record;
}

export const secureProgrammeApi = Object.freeze({
  generateCroixNationaleProgramme
});

export default secureProgrammeApi;
