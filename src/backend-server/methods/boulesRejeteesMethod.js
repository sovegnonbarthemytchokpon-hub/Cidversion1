/*
 * Boules rejetées client adapter.
 *
 * Les règles de calcul sont exclusivement dans la fonction Supabase
 * rejected-balls. Ce fichier ne contient plus de méthode propriétaire :
 * il invoque le serveur et conserve les noms historiques attendus par les
 * contrôleurs de l'interface.
 */

const REJECTED_FUNCTION_NAME = 'rejected-balls';

async function getSupabaseClient() {
  const bridge = await window.cidSupabaseReady;
  const client = bridge?.client;
  if (!client?.functions?.invoke) {
    throw new Error('Supabase n’est pas configuré pour lire les Boules rejetées.');
  }
  return client;
}

export function programmeDateAt16h(referenceDate = new Date()) {
  const source = referenceDate instanceof Date
    ? new Date(referenceDate)
    : new Date(referenceDate);
  const safe = Number.isNaN(source.getTime()) ? new Date() : source;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(safe);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day') + (part('hour') >= 16 ? 1 : 0),
    12
  ));
}

export async function fetchRejectedBalls({ programmeDate = null } = {}) {
  const client = await getSupabaseClient();
  const body = programmeDate
    ? { programmeDate: programmeDate instanceof Date
      ? programmeDate.toISOString().slice(0, 10)
      : String(programmeDate).slice(0, 10),
      localeCode: window.cidTranslation?.current?.() || 'fr' }
    : { localeCode: window.cidTranslation?.current?.() || 'fr' };
  const { data, error } = await client.functions.invoke(
    REJECTED_FUNCTION_NAME,
    { body }
  );

  if (error) throw error;
  if (!data?.groups || !data?.meta) {
    throw new Error(
      data?.error || 'La fonction rejected-balls n’a pas retourné de résultats.'
    );
  }
  return data;
}

// Compatibility name retained for old callers. It is now asynchronous and
// always returns the archived/server response.
export async function calculateRejectedBalls(targetDate = null) {
  return fetchRejectedBalls({ programmeDate: targetDate });
}

export function formatRejectedBalls(result) {
  return String(result?.formattedText || '').trim();
}
