/*
 * Small offline-first cache boundary.
 *
 * This is deliberately dependency-free so classic scripts and ES modules can
 * share the same cache. It is a paint cache only: Supabase/API responses
 * remain authoritative and every consumer revalidates in the background.
 */
(function installCidPersistentCache() {
  'use strict';

  const VERSION = 2;
  const PREFIX = 'cidmap:persistent-cache:v40:';

  function safeIdentity(value = 'visitor') {
    const normalized = String(value || 'visitor').trim();
    return normalized.replace(/[^A-Za-z0-9._:@-]/g, '_').slice(0, 140) || 'visitor';
  }

  function storageKey(name, identity = 'visitor') {
    return `${PREFIX}${safeIdentity(identity)}:${String(name || 'data').trim()}`;
  }

  function read(name, identity = 'visitor', maxAgeMs = Infinity) {
    try {
      const raw = localStorage.getItem(storageKey(name, identity));
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || payload.version !== VERSION || !payload.savedAt) return null;
      const age = Date.now() - Number(payload.savedAt);
      if (!Number.isFinite(age) || age > maxAgeMs) return null;
      return {
        value: payload.value,
        savedAt: Number(payload.savedAt),
        age,
        stale: age > Math.min(maxAgeMs, 15 * 60 * 1000)
      };
    } catch (_) {
      return null;
    }
  }

  function write(name, identity, value) {
    try {
      localStorage.setItem(storageKey(name, identity), JSON.stringify({
        version: VERSION,
        savedAt: Date.now(),
        value
      }));
      return true;
    } catch (_) {
      // Quota/private browsing errors must never block the live request.
      return false;
    }
  }

  function remove(name, identity = 'visitor') {
    try { localStorage.removeItem(storageKey(name, identity)); } catch (_) {}
  }

  function clearIdentity(identity) {
    const prefix = `${PREFIX}${safeIdentity(identity)}:`;
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  async function identity() {
    const known = String(window.cidAuthCurrentUserId || '').trim();
    if (known) return known;
    try {
      const bridge = await Promise.resolve(window.cidSupabaseReady);
      const result = await bridge?.auth?.getSession?.();
      return String(result?.data?.session?.user?.id || 'visitor').trim() || 'visitor';
    } catch (_) {
      return 'visitor';
    }
  }

  window.cidPersistentCache = Object.freeze({
    version: VERSION,
    read,
    write,
    remove,
    clearIdentity,
    identity,
    key: storageKey
  });
})();
