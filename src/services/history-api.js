/*
 * Read-only history API boundary.
 *
 * Historical calculations and database access stay in the Supabase Edge
 * Functions. The view layer only knows this small contract and never invokes
 * a database client directly. Keeping the boundary here also gives every
 * history consumer the same date validation and response checks.
 */
import { fetchRejectedBalls } from '/src/backend-server/methods/boulesRejeteesMethod.js';
import '/src/shared/tableau-history-cache-paint.js?tableau-history-cache-paint-v1';

const HISTORY_KINDS = new Set(['matrix', 'rejected', 'tableaux']);

function safeDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function assertPayload(kind, payload, date) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Réponse historique vide pour ${kind} (${date}).`);
  }
  if (kind === 'matrix' && !Array.isArray(payload.results)) {
    throw new Error('La réponse Matrice est invalide.');
  }
  if (kind === 'rejected' && (!payload.groups || !payload.meta)) {
    throw new Error('La réponse Boules rejetées est invalide.');
  }
  return payload;
}

export async function fetchHistoryPayload({ kind, date, featureKey = '' } = {}) {
  if (!HISTORY_KINDS.has(kind)) {
    throw new Error('Type d’historique inconnu.');
  }
  const programmeDate = safeDate(date);
  if (!programmeDate) {
    throw new Error('Date historique invalide.');
  }

  let payload;
  if (kind === 'matrix') {
    payload = await window.cidFetchProgrammeForDate?.(programmeDate);
  } else if (kind === 'rejected') {
    payload = await fetchRejectedBalls({ programmeDate });
  } else {
    payload = await window.cidFetchTableauxForDate?.(programmeDate);
    // The existing Tableaux loader returns the date bundle in one response.
    void featureKey;
  }
  return assertPayload(kind, payload, programmeDate);
}

export async function invokeHistoryAccess(body = {}) {
  const bridge = await window.cidSupabaseReady;
  const client = bridge?.client;
  if (!client?.functions?.invoke) {
    throw new Error('Connexion Supabase indisponible.');
  }
  const result = await client.functions.invoke('history-access', { body });
  if (result.error) throw result.error;
  if (result.data?.error) throw new Error(result.data.error);
  return result.data || {};
}

const api = Object.freeze({ fetchHistoryPayload, invokeHistoryAccess });
window.cidHistoryApi = api;
