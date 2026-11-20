/*
 * Autonomous Tableau component controller.
 *
 * This module deliberately has no knowledge of Supabase schemas or of the
 * visual contract of a specific programme. The parent view supplies one
 * authorised loader per component. Each instance owns its request token,
 * local DOM state and history action.
 */

export const TABLEAU_COMPONENT_STATES = Object.freeze([
  'idle',
  'loading',
  'ready',
  'error',
  'locked'
]);

const stateLabel = Object.freeze({
  idle: '',
  loading: 'Chargement local…',
  ready: 'Données à jour',
  error: 'Données indisponibles',
  locked: 'Accès requis'
});

function safeMessage(error) {
  return String(error?.message || error?.name || 'Chargement indisponible')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function currentProgrammeDateKey() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + (Number(parts.hour) >= 16 ? 1 : 0)
  ));
  return date.toISOString().slice(0, 10);
}

export function createTableauComponent({
  id,
  featureKey,
  label,
  selector,
  onData,
  onError
} = {}) {
  const componentId = String(id || '').trim();
  let host = null;
  let state = 'idle';
  let accessAllowed = true;
  let requestToken = 0;
  let status = null;

  const dispatch = (type, detail = {}) => {
    if (!host) return;
    host.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      detail: {
        componentId,
        featureKey,
        label,
        state,
        ...detail
      }
    }));
  };

  const ensureStatus = () => {
    if (!host) return null;
    if (status?.isConnected) return status;
    status = document.createElement('div');
    status.className = 'tableaux-local-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.innerHTML = `
      <span class="tableaux-local-status__spinner" aria-hidden="true"></span>
      <span class="tableaux-local-status__label"></span>`;
    host.appendChild(status);
    return status;
  };

  const paintState = (nextState, message = '') => {
    state = TABLEAU_COMPONENT_STATES.includes(nextState) ? nextState : 'idle';
    if (!host) return;
    host.dataset.tableauComponent = componentId;
    host.dataset.tableauFeature = featureKey || '';
    host.dataset.tableauComponentState = state;
    host.dataset.tableauComponentAccess = accessAllowed ? 'allowed' : 'locked';
    const node = ensureStatus();
    if (!node) return;
    const labelNode = node.querySelector('.tableaux-local-status__label');
    if (labelNode) {
      labelNode.textContent = message || stateLabel[state] || '';
    }
    node.dataset.state = state;
    node.hidden = !['loading', 'error'].includes(state);
    node.setAttribute('aria-hidden', String(node.hidden));
  };

  const mount = (nextHost) => {
    if (!nextHost || (selector && !nextHost.matches(selector))) return false;
    if (host !== nextHost) {
      host = nextHost;
      host.dataset.tableauComponent = componentId;
      host.dataset.tableauFeature = featureKey || '';
      host.dataset.tableauLabel = label || '';
      paintState(accessAllowed ? state : 'locked');
    } else {
      paintState(state);
    }
    return true;
  };

  const setAccess = (allowed) => {
    accessAllowed = Boolean(allowed);
    if (!accessAllowed) {
      requestToken += 1;
      paintState('locked');
      return;
    }
    if (state === 'locked') paintState('idle');
    else paintState(state);
  };

  const load = async (loader, { requestKey = '', metadata = {} } = {}) => {
    if (typeof loader !== 'function') {
      const error = new Error(`Loader absent pour ${label || componentId}.`);
      paintState('error', safeMessage(error));
      onError?.(error, { componentId, featureKey, requestKey, metadata });
      throw error;
    }
    if (!host) {
      const error = new Error(`Composant non monté : ${componentId}.`);
      onError?.(error, { componentId, featureKey, requestKey, metadata });
      throw error;
    }
    const currentRequest = ++requestToken;
    const cache = window.cidComponentRuntime?.cache;
    const cacheIdentity = cache?.identity?.() || 'visitor';
    const programmeDate = requestKey
      || metadata.programmeDate
      || currentProgrammeDateKey();
    const cacheKey = `tableau:${featureKey || componentId}:${programmeDate}`;

    /*
     * Paint the last validated result synchronously for the current account.
     * This is intentionally gated by the component's access decision; a
     * revoked/locked component never reads or paints a protected cache entry.
     * The network loader still runs below and remains authoritative.
     */
    if (accessAllowed && cache?.read && cache?.identity) {
      const cached = cache.read(cacheKey, {
        identity: cacheIdentity,
        maxAgeMs: 36 * 60 * 60 * 1000
      });
      if (cached?.value) {
        paintState('ready', 'Données locales');
        onData?.(cached.value, {
          componentId,
          featureKey,
          requestKey,
          metadata,
          cached: true,
          stale: cached.stale
        });
      }
    }
    paintState('loading');
    dispatch('tableau:loading', { requestKey, metadata });
    try {
      const value = await loader();
      if (currentRequest !== requestToken) return value;
      if (accessAllowed && cache?.write) {
        cache.write(cacheKey, value, {
          identity: cacheIdentity,
          meta: { featureKey, requestKey }
        });
      }
      paintState('ready');
      onData?.(value, { componentId, featureKey, requestKey, metadata });
      dispatch('tableau:ready', { value, requestKey, metadata });
      return value;
    } catch (error) {
      if (currentRequest !== requestToken) throw error;
      paintState('error', safeMessage(error));
      onError?.(error, { componentId, featureKey, requestKey, metadata });
      dispatch('tableau:error', {
        error,
        message: safeMessage(error),
        requestKey,
        metadata
      });
      throw error;
    }
  };

  const openHistory = () => {
    if (typeof window.cidShowPublicationHistory !== 'function') return false;
    window.cidShowPublicationHistory({
      kind: 'tableaux',
      featureKey,
      returnTo: () => window.showTableauxView?.({ updateHistory: false })
    });
    dispatch('tableau:history-requested');
    return true;
  };

  return Object.freeze({
    id: componentId,
    featureKey,
    label,
    selector,
    mount,
    load,
    setAccess,
    openHistory,
    state: () => state,
    host: () => host
  });
}
