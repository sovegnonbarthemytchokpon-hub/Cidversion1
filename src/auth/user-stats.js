/*
 * Authenticated Supabase metrics store.
 *
 * Counters are read from public.user_metrics for the current auth.uid().
 * There is intentionally no localStorage mirror or fabricated seed value.
 * A zero is only the transient UI value while the first authenticated query
 * is pending.
 */
(function initCidUserStats() {
  'use strict';

  const DEFAULTS = Object.freeze({ etoilesGagnees: 0, jetons: 0, nombrePartages: 0 });
  let currentUserId = '';
  let state = { ...DEFAULTS };
  let refreshPromise = null;
  let refreshEpoch = -1;
  let authEpoch = 0;
  const listeners = new Set();
  let realtimeChannel = null;

  function normalize(row) {
    return {
      etoilesGagnees: Math.max(0, Number(row?.stars) || 0),
      jetons: Math.max(0, Number(row?.tokens) || 0),
      nombrePartages: Math.max(0, Number(row?.share_count) || 0)
    };
  }

  function emit() {
    const next = { ...state };
    listeners.forEach((listener) => {
      try { listener(next); } catch (_) {}
    });
    window.dispatchEvent(new CustomEvent('cid:user-stats-changed', {
      detail: { userId: currentUserId, stats: next }
    }));
  }

  async function getBridgeAndUser() {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client) return null;
    const user = await bridge.getUser();
    return user ? { bridge, user } : null;
  }

  async function refresh() {
    if (refreshPromise && refreshEpoch === authEpoch) return refreshPromise;
    const requestEpoch = authEpoch;
    let request;
    request = (async () => {
      const auth = await getBridgeAndUser();
      if (requestEpoch !== authEpoch) return state;
      if (!auth) {
        currentUserId = '';
        state = { ...DEFAULTS };
        emit();
        return state;
      }
      const { bridge, user } = auth;
      if (requestEpoch !== authEpoch) return state;
      currentUserId = user.id;
      const { data, error } = await bridge.client
        .from('user_metrics')
        .select('stars,tokens,share_count')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (requestEpoch !== authEpoch) return state;
      state = normalize(data);
      emit();
      if (realtimeChannel) bridge.client.removeChannel(realtimeChannel);
      realtimeChannel = bridge.client
        .channel(`cid-user-metrics-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_metrics',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            if (requestEpoch !== authEpoch || currentUserId !== user.id) return;
            state = normalize(payload.new);
            emit();
          }
        );
      await realtimeChannel.subscribe();
      return state;
    })().catch((error) => {
      console.warn('Métriques Supabase indisponibles', error);
      return state;
    }).finally(() => {
      if (refreshPromise === request) {
        refreshPromise = null;
        refreshEpoch = -1;
      }
    });
    refreshPromise = request;
    refreshEpoch = requestEpoch;
    return request;
  }

  function get() {
    return { ...state };
  }

  async function incrementStars(amount = 1) {
    throw new Error('Les étoiles sont attribuées par le serveur après une récompense validée.');
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    listeners.add(callback);
    callback(get());
    refresh();
    const onAuth = () => {
      authEpoch += 1;
      currentUserId = '';
      state = { ...DEFAULTS };
      if (realtimeChannel) {
        try {
          window.cidSupabase?.client?.removeChannel(realtimeChannel);
        } catch (_) {}
        realtimeChannel = null;
      }
      refreshPromise = null;
      refreshEpoch = -1;
      emit();
      refresh();
    };
    window.addEventListener('cid:auth-sync', onAuth);
    return () => {
      listeners.delete(callback);
      window.removeEventListener('cid:auth-sync', onAuth);
    };
  }

  window.cidUserStats = Object.freeze({
    get,
    refresh,
    // Apply a server-authoritative balance immediately after a debit. The
    // next refresh still remains responsible for persistence verification.
    adopt: (nextAccess) => {
      if (!nextAccess || typeof nextAccess !== 'object') return get();
      state = normalize(nextAccess);
      emit();
      return get();
    },
    subscribe,
    // Kept as a compatibility no-op for old profile code. Durable writes must
    // use the authenticated RPCs above, never a caller-provided user id.
    set: () => get(),
    incrementStars,
    incrementShares: () => {
      throw new Error('Les partages sont enregistrés par record_post_share.');
    },
    getCurrentCid: () => currentUserId || null
  });

  refresh();
})();
