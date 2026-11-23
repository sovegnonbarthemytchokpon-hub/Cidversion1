/*
 * Cidmap programme synchronisation: one 16:00 UTC clock, one per-account
 * subscription ledger, one device hydration routine.
 *
 * 1. Clock — programmes are generated in the database at 16:00 UTC (16:00 in
 *    Côte d'Ivoire, which is UTC all year). The boundary is computed from
 *    epoch milliseconds only (Date.UTC vs Date.now()), never from the
 *    device's local hours, so a visitor in Paris, Montréal or Abidjan
 *    triggers the refresh at the same real instant. Instead of polling the
 *    database to see whether a publication exists, a single timer is armed
 *    for the next boundary and `cid:programme-boundary` is dispatched once
 *    per boundary. Browsers suspend timers in background tabs, so the
 *    boundary is also re-checked (locally, no request) when the page becomes
 *    visible again.
 *
 * 2. Ledger — every subscription of an account (plan subscriptions, Tableaux
 *    unlocks, anticipations, Croix nationale, Boules rejetées…) is kept in
 *    localStorage under its own key, so a new unlock or a prolongation never
 *    overwrites another one. Periods are stored exactly as returned by the
 *    server (started_at / expires_at…): the browser never computes a
 *    validity date, it only compares server timestamps with Date.now().
 *
 * 3. Device hydration — when an account signs in on a device that has no
 *    ledger yet (new phone/computer, cleared storage), the active
 *    subscriptions, today's publications and the nine-entry history are read
 *    from the database once, written to localStorage, and the device then
 *    follows the same local-first / 16:00 UTC routine.
 *
 * The ledger is a paint/offline cache only. The Supabase Edge Functions stay
 * the final authority for every protected payload.
 */
(function installCidProgrammeSync() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BOUNDARY_HOUR_UTC = 16;
  // Small spread after 16:00:00 so the database generation has completed and
  // every open tab does not hit the backend in the same second.
  const BOUNDARY_SETTLE_MIN_MS = 20 * 1000;
  const BOUNDARY_SETTLE_SPREAD_MS = 40 * 1000;
  const HISTORY_LENGTH = 9;
  const CLOCK_STORAGE_KEY = 'cidmap:persistent-cache:v40:clock:programme-boundary';
  const LEDGER_NAME = 'subscription-ledger';
  const LEDGER_VERSION = 1;

  /* ------------------------------------------------------------------ */
  /* 16:00 UTC clock                                                     */
  /* ------------------------------------------------------------------ */

  function lastBoundaryMs(nowMs = Date.now()) {
    const now = new Date(nowMs);
    const today = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      BOUNDARY_HOUR_UTC, 0, 0, 0
    );
    return nowMs >= today ? today : today - DAY_MS;
  }

  function nextBoundaryMs(nowMs = Date.now()) {
    return lastBoundaryMs(nowMs) + DAY_MS;
  }

  /* Programme date (YYYY-MM-DD) currently published: after 16:00 UTC the
   * publication carries the next calendar day. */
  function programmeDateIso(nowMs = Date.now()) {
    return new Date(lastBoundaryMs(nowMs) + DAY_MS).toISOString().slice(0, 10);
  }

  /* The nine programme dates kept on the device, newest first. When a new
   * publication arrives the oldest date leaves the window. */
  function historyWindow(nowMs = Date.now()) {
    const newest = Date.parse(`${programmeDateIso(nowMs)}T00:00:00Z`);
    return Array.from({ length: HISTORY_LENGTH }, (_, index) => (
      new Date(newest - index * DAY_MS).toISOString().slice(0, 10)
    ));
  }

  function readStoredBoundary() {
    try { return Number(localStorage.getItem(CLOCK_STORAGE_KEY)) || 0; } catch (_) { return 0; }
  }

  function storeBoundary(value) {
    try { localStorage.setItem(CLOCK_STORAGE_KEY, String(value)); } catch (_) {}
  }

  let firedBoundary = lastBoundaryMs();
  let boundaryTimer = 0;

  function dispatchBoundary(boundaryMs, reason) {
    if (boundaryMs <= firedBoundary && reason !== 'startup') return;
    firedBoundary = Math.max(firedBoundary, boundaryMs);
    storeBoundary(boundaryMs);
    pruneHistoryWindow();
    const detail = {
      boundaryMs,
      programmeDate: programmeDateIso(boundaryMs),
      historyWindow: historyWindow(boundaryMs),
      reason
    };
    try {
      window.dispatchEvent(new CustomEvent('cid:programme-boundary', { detail }));
    } catch (_) {}
  }

  function armBoundaryTimer() {
    window.clearTimeout(boundaryTimer);
    const now = Date.now();
    const target = nextBoundaryMs(now)
      + BOUNDARY_SETTLE_MIN_MS
      + Math.floor(Math.random() * BOUNDARY_SETTLE_SPREAD_MS);
    // setTimeout is capped at ~24.8 days; a boundary is at most 24 h away.
    boundaryTimer = window.setTimeout(() => {
      dispatchBoundary(lastBoundaryMs(), 'timer');
      armBoundaryTimer();
    }, Math.max(1000, target - now));
  }

  /* A suspended tab or a sleeping phone may have missed the timer: compare
   * epochs locally — no network request — and catch up once. */
  function checkMissedBoundary() {
    const current = lastBoundaryMs();
    if (current > firedBoundary) {
      dispatchBoundary(current, 'resume');
      armBoundaryTimer();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkMissedBoundary();
  });
  window.addEventListener('pageshow', checkMissedBoundary);
  window.addEventListener('online', checkMissedBoundary);

  /* ------------------------------------------------------------------ */
  /* Nine-entry history window                                           */
  /* ------------------------------------------------------------------ */

  const HISTORY_PREFIX = 'cidmap:history-payload:v40:';

  /* Drops cached history entries older than the nine-date window. Keys end
   * with the programme date (see src/shared/history-cache.js). */
  function pruneHistoryWindow(nowMs = Date.now()) {
    const oldest = historyWindow(nowMs)[HISTORY_LENGTH - 1];
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(HISTORY_PREFIX)) continue;
        const date = key.slice(-10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < oldest) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Subscription ledger                                                 */
  /* ------------------------------------------------------------------ */

  const cache = () => window.cidPersistentCache;
  const userId = () => String(window.cidAuthCurrentUserId || '').trim();
  const clean = (value) => String(value ?? '').trim();
  const featureKeyOf = (item) => clean(item?.feature_key || item?.featureKey).toLowerCase();

  function emptyLedger() {
    return {
      version: LEDGER_VERSION,
      entries: {},
      deviceHydratedAt: 0,
      hydratedBoundaryMs: 0,
      updatedAt: 0
    };
  }

  function readLedger(identity = userId()) {
    if (!identity) return emptyLedger();
    const stored = cache()?.read?.(LEDGER_NAME, identity, Infinity)?.value;
    if (!stored || stored.version !== LEDGER_VERSION || typeof stored.entries !== 'object') {
      return emptyLedger();
    }
    return stored;
  }

  function writeLedger(ledger, identity = userId()) {
    if (!identity) return false;
    ledger.updatedAt = Date.now();
    const ok = cache()?.write?.(LEDGER_NAME, identity, ledger) || false;
    try {
      window.dispatchEvent(new CustomEvent('cid:subscription-ledger-changed', {
        detail: { userId: identity, entries: Object.values(ledger.entries) }
      }));
    } catch (_) {}
    return ok;
  }

  /* Server timestamps are compared, never derived. */
  function isExpired(entry, nowMs = Date.now()) {
    const end = Date.parse(entry?.expires_at || entry?.expiresAt || '');
    return Number.isFinite(end) && end <= nowMs;
  }

  /*
   * Normalises a server access snapshot into independent ledger entries.
   * Each category is keyed separately so tableaux, anticipations, Croix
   * nationale, Boules rejetées and plan subscriptions coexist.
   */
  function entriesFromAccess(access) {
    const entries = [];
    const push = (category, key, record) => {
      if (!key || !record || typeof record !== 'object') return;
      entries.push({ ...record, __category: category, __key: `${category}:${key}` });
    };

    const subscriptions = Array.isArray(access?.subscriptions) ? [...access.subscriptions] : [];
    if (access?.subscription && !subscriptions.includes(access.subscription)) {
      subscriptions.push(access.subscription);
    }
    subscriptions.forEach((subscription) => {
      const plan = subscription === access.subscription ? access.activePlan : null;
      const slug = clean(subscription.plan_slug || subscription.planSlug || plan?.slug);
      const key = slug || clean(subscription.id);
      push('plan', key, {
        ...subscription,
        plan_slug: slug || undefined,
        plan: plan || subscription.plan || undefined
      });
    });

    (Array.isArray(access?.featureUnlocks) ? access.featureUnlocks : []).forEach((unlock) => {
      const feature = featureKeyOf(unlock);
      push('feature', feature || clean(unlock.id), unlock);
    });

    const earlyKey = (item) => [
      featureKeyOf(item),
      clean(item.programme_date || item.programmeDate || item.id)
    ].filter(Boolean).join(':');
    (Array.isArray(access?.earlyAccessUnlocks) ? access.earlyAccessUnlocks : [])
      .forEach((item) => push('early', earlyKey(item), item));
    (Array.isArray(access?.earlyAccessGrants) ? access.earlyAccessGrants : [])
      .forEach((item) => push('early-grant', earlyKey(item), item));

    return entries;
  }

  /*
   * Merges a server snapshot into the ledger.
   *  - Same key: the server record replaces the stored one (prolongation:
   *    the new expires_at is stored verbatim).
   *  - Other keys: preserved, so one subscription never erases another.
   *  - complete=true (a full live read): array categories returned by the
   *    server are authoritative lists, so their missing keys are removed;
   *    the singular plan subscription keeps other still-valid plans.
   *  - Entries whose server expiry has passed are dropped.
   */
  function ingest(access, { complete = false, identity = userId() } = {}) {
    if (!identity || !access || typeof access !== 'object') return null;
    const ledger = readLedger(identity);
    const incoming = entriesFromAccess(access);
    const incomingKeys = new Set(incoming.map((entry) => entry.__key));
    const nowMs = Date.now();

    if (complete) {
      const authoritative = new Set();
      if (Array.isArray(access.featureUnlocks)) authoritative.add('feature');
      if (Array.isArray(access.earlyAccessUnlocks)) authoritative.add('early');
      if (Array.isArray(access.earlyAccessGrants)) authoritative.add('early-grant');
      if (Array.isArray(access.subscriptions)) authoritative.add('plan');
      Object.keys(ledger.entries).forEach((key) => {
        const entry = ledger.entries[key];
        if (authoritative.has(entry.__category) && !incomingKeys.has(key)) {
          delete ledger.entries[key];
        }
      });
    }

    incoming.forEach((entry) => {
      ledger.entries[entry.__key] = { ...entry, __syncedAt: nowMs };
    });
    Object.keys(ledger.entries).forEach((key) => {
      if (isExpired(ledger.entries[key], nowMs)) delete ledger.entries[key];
    });
    writeLedger(ledger, identity);
    return ledger;
  }

  function list(category = '', identity = userId()) {
    const entries = Object.values(readLedger(identity).entries)
      .filter((entry) => !isExpired(entry));
    return category ? entries.filter((entry) => entry.__category === category) : entries;
  }

  /*
   * Returns the access snapshot enriched with every still-valid subscription
   * known on this device, so a partial/offline snapshot does not hide an
   * unlock purchased earlier.
   */
  function supplementAccess(access, identity = userId()) {
    if (!access || !identity) return access;
    const entries = list('', identity);
    if (!entries.length) return access;
    const strip = ({ __category, __key, __syncedAt, ...record }) => record;
    const merge = (current, category, keyOf) => {
      const base = Array.isArray(current) ? [...current] : [];
      const seen = new Set(base.map(keyOf));
      entries.filter((entry) => entry.__category === category).forEach((entry) => {
        const record = strip(entry);
        if (!seen.has(keyOf(record))) {
          seen.add(keyOf(record));
          base.push(record);
        }
      });
      return base;
    };
    const earlyKeyOf = (item) => `${featureKeyOf(item)}:${clean(item.programme_date || item.programmeDate || item.id)}`;
    return {
      ...access,
      featureUnlocks: merge(access.featureUnlocks, 'feature', (item) => featureKeyOf(item) || clean(item.id)),
      earlyAccessUnlocks: merge(access.earlyAccessUnlocks, 'early', earlyKeyOf),
      earlyAccessGrants: merge(access.earlyAccessGrants, 'early-grant', earlyKeyOf),
      subscriptions: list('plan', identity).map(strip)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Device hydration                                                    */
  /* ------------------------------------------------------------------ */

  let hydrating = null;
  let hydratingFor = '';

  async function hydrateAccount({ force = false } = {}) {
    const identity = userId();
    if (!identity || navigator.onLine === false) return false;
    const ledger = readLedger(identity);
    const boundary = lastBoundaryMs();
    if (!force && ledger.deviceHydratedAt && ledger.hydratedBoundaryMs >= boundary) return true;
    if (hydrating && hydratingFor === identity) return hydrating;
    hydratingFor = identity;
    hydrating = (async () => {
      // 1. Active subscriptions (the feature-access listener ingests them).
      const access = await window.cidFeatureAccess?.refresh?.().catch(() => null);
      if (userId() !== identity) return false;
      if (access) ingest(access, { complete: true, identity });
      // 2. Today's publications and the nine-entry history for every
      //    subscribed section, written to the user's history cache.
      await Promise.resolve(window.cidPrefetchSubscribedHistory?.()).catch(() => {});
      // 3. Croix nationale of the current programme (stored locally by its
      //    own repository; returns at once if already cached).
      await Promise.resolve(window.croix?.fetchAndApply?.()).catch(() => {});
      if (userId() !== identity) return false;
      const next = readLedger(identity);
      next.deviceHydratedAt = next.deviceHydratedAt || Date.now();
      next.hydratedBoundaryMs = boundary;
      writeLedger(next, identity);
      pruneHistoryWindow();
      return true;
    })().finally(() => {
      hydrating = null;
      hydratingFor = '';
    });
    return hydrating;
  }

  window.addEventListener('cid:auth-sync', (event) => {
    const identity = clean(event.detail?.id || event.detail?.uid || userId());
    if (!identity) return;
    // Let the modules that react to cid:auth-sync start their own reads
    // first; hydration reuses those in-flight requests.
    window.setTimeout(() => { void hydrateAccount(); }, 0);
  });

  window.addEventListener('cid:feature-access-changed', (event) => {
    const access = event.detail;
    if (!access || access.__offline || access.__fromLedger) return;
    ingest(access, { complete: access.__complete === true });
  });

  window.addEventListener('cid:programme-boundary', () => {
    if (!userId()) return;
    // Mark the device as aligned to the new publication once the modules
    // listening to the boundary have fetched it.
    window.setTimeout(() => { void hydrateAccount(); }, 1500);
  });

  window.addEventListener('online', () => {
    if (userId()) void hydrateAccount();
  });

  /* ------------------------------------------------------------------ */
  /* Startup                                                             */
  /* ------------------------------------------------------------------ */

  pruneHistoryWindow();
  armBoundaryTimer();
  // Remember the boundary already seen on this device. Modules load the
  // current publication by themselves on startup, so a boundary passed
  // while the app was closed does not need an extra event.
  if (readStoredBoundary() < firedBoundary) storeBoundary(firedBoundary);

  window.cidProgrammeClock = Object.freeze({
    BOUNDARY_HOUR_UTC,
    HISTORY_LENGTH,
    lastBoundaryMs,
    nextBoundaryMs,
    programmeDateIso,
    historyWindow,
    isCurrentSince: (savedAtMs) => Number(savedAtMs) >= lastBoundaryMs(),
    onBoundary(listener) {
      if (typeof listener !== 'function') return () => {};
      const handler = (event) => listener(event.detail);
      window.addEventListener('cid:programme-boundary', handler);
      return () => window.removeEventListener('cid:programme-boundary', handler);
    },
    pruneHistoryWindow
  });

  window.cidSubscriptionLedger = Object.freeze({
    read: readLedger,
    list,
    ingest,
    supplementAccess,
    hydrateAccount,
    isExpired
  });
})();
