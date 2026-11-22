/*
 * Persistent, user-scoped history paint cache.
 *
 * This is not an authority and never grants access. It only keeps the last
 * validated payload so the archive can paint immediately and survive a
 * transient network failure. Entries are namespaced by the authenticated user
 * id to avoid showing one account's private archive to another account on the
 * same device.
 */
const CACHE_VERSION = 3;
const CACHE_PREFIX = 'cidmap:history-payload:v40:';
const STALE_AFTER_MS = 30 * 60 * 1000;

function identity() {
  const value = String(window.cidAuthCurrentUserId || 'visitor').trim();
  return value || 'visitor';
}

function safePart(value) {
  return String(value || 'default')
    .trim()
    .replace(/[^A-Za-z0-9._:@-]/g, '_')
    .slice(0, 140) || 'default';
}

export function historyCacheKey({ kind, date, featureKey = '' } = {}) {
  return [
    safePart(kind),
    safePart(featureKey || 'default'),
    String(date || '').slice(0, 10)
  ].join(':');
}

function storageKey(key, userId = identity()) {
  return `${CACHE_PREFIX}${safePart(userId)}:${key}`;
}

function validEnvelope(envelope, key) {
  return Boolean(
    envelope
      && envelope.version === CACHE_VERSION
      && envelope.key === key
      && Number.isFinite(Number(envelope.savedAt))
      && envelope.payload
      && typeof envelope.payload === 'object'
      && !Array.isArray(envelope.payload)
  );
}

export function readHistoryPayload(key, userId = identity()) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(storageKey(key, userId));
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    if (!validEnvelope(envelope, key)) return null;
    const savedAt = Number(envelope.savedAt);
    return {
      value: envelope.payload,
      savedAt,
      age: Math.max(0, Date.now() - savedAt),
      stale: Date.now() - savedAt > STALE_AFTER_MS
    };
  } catch (_) {
    return null;
  }
}

export function writeHistoryPayload(key, payload, userId = identity()) {
  if (!key || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  try {
    localStorage.setItem(storageKey(key, userId), JSON.stringify({
      version: CACHE_VERSION,
      key,
      savedAt: Date.now(),
      payload
    }));
    window.dispatchEvent(new CustomEvent('cid:history-cache-written', {
      detail: { key, userId: safePart(userId) }
    }));
    return true;
  } catch (_) {
    // Quota/private mode must never make a successful network response fail.
    return false;
  }
}

export function clearHistoryCache(userId = identity()) {
  const prefix = `${CACHE_PREFIX}${safePart(userId)}:`;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch (_) {}
}

const cache = Object.freeze({
  version: CACHE_VERSION,
  identity,
  key: historyCacheKey,
  read: readHistoryPayload,
  write: writeHistoryPayload,
  clear: clearHistoryCache
});
window.cidHistoryCache = cache;
