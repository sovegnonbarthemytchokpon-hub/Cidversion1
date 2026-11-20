/*
 * Supabase browser boundary.
 *
 * The anon key is safe to expose in a browser, but it must always be
 * protected by Supabase RLS policies. The values are kept in
 * /src/auth/supabase-config.js. If Supabase is not configured, account
 * operations fail explicitly instead of switching to a local account.
 */
/*
 * Offline-first loading: the SDK lives on a CDN. A static cross-origin import
 * that fails while offline would abort this module AND every module that
 * imports it (feed, cross, history, account…), leaving the installed app on
 * its skeletons. The SDK is therefore loaded dynamically and never awaited
 * for longer than SDK_WAIT_MS: without it, the client stays null, cached
 * localStorage content keeps rendering, and the client is attached as soon as
 * the SDK becomes available (late response or reconnection).
 */
const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SDK_WAIT_MS = 2500;

const config = window.CIDGROUP_SUPABASE_CONFIG || {};
const supabaseUrl = String(config.url || '').trim();
const supabaseAnonKey = String(config.anonKey || '').trim();
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client = null;
let sdkPromise = null;
// Live bindings: importers see the client once it is attached.
export let supabaseClient = null;

function createConfiguredClient(createClient) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Keep OAuth callbacks out of the URL fragment. The implicit flow
      // exposes bearer tokens in copied links; PKCE returns a short-lived
      // code that the client exchanges for the session.
      flowType: 'pkce'
    }
  });
}

function clearAuthCallbackUrl() {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  const hasAuthFragment = /(?:^|&)(?:access_token|refresh_token|provider_token|expires_at|expires_in|token_type)=/i
    .test(url.hash.replace(/^#/, ''));
  const authQueryKeys = ['code', 'error', 'error_code', 'error_description'];
  const hasAuthQuery = authQueryKeys.some((key) => url.searchParams.has(key));
  if (!hasAuthFragment && !hasAuthQuery) return;
  url.hash = '';
  authQueryKeys.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export const supabase = {
  client: null,
  functions: null,
  auth: null,
  isConfigured,
  // True while the SDK could not be loaded (offline / CDN unreachable).
  offline: isConfigured,
  whenClient() { return loadSdk().then(() => client); },
  async getUser() {
    if (!client) return null;
    /*
     * `auth.getUser()` always validates against the Auth service. For a
     * visitor who has never signed in, that produces an expected 401 network
     * response on every public page load. Read the local session envelope
     * first so anonymous visits stay completely quiet and avoid an
     * unnecessary round trip. When a session exists, retain the server-side
     * validation before exposing the user to callers.
     */
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.user?.id) return null;
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return data?.user || null;
  },
  async getSession() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data?.session || null;
  }
};

// auth.js is intentionally kept as a classic script for legacy embeds.
// Expose the small bridge globally while retaining named module exports for
// future modules. The bridge resolves immediately (never blocks on the
// network); `client` is null until the SDK is available.
const bridge = supabase;
window.cidSupabase = bridge;
window.cidSupabaseReady = Promise.resolve(bridge);

function attachClient(createClient) {
  if (client || !isConfigured) return client;
  client = createConfiguredClient(createClient);
  bridge.client = client;
  bridge.functions = client.functions || null;
  bridge.auth = client.auth || null;
  bridge.offline = false;
  supabaseClient = client;
  // Supabase has already been initialized with detectSessionInUrl, so this
  // listener runs after the callback has been consumed. Removing the
  // callback parameters prevents access tokens from being copied or stored
  // in browser history.
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
      window.setTimeout(clearAuthCallbackUrl, 0);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('cid:supabase-ready', { detail: { bridge } }));
  } catch (_) {}
  return client;
}

function loadSdk() {
  if (!isConfigured || client) return Promise.resolve(client);
  if (sdkPromise) return sdkPromise;
  sdkPromise = import(SUPABASE_SDK_URL)
    .then((module) => attachClient(module.createClient))
    .catch((error) => {
      // Allow a new attempt on reconnection.
      sdkPromise = null;
      console.warn('Supabase SDK indisponible (hors connexion ?)', error?.message || error);
      return null;
    });
  return sdkPromise;
}

if (isConfigured) {
  window.addEventListener('online', () => { void loadSdk(); });
  // Bounded wait: the module graph continues with a null client after the
  // timeout, and the client is attached later if the SDK arrives.
  await Promise.race([
    loadSdk(),
    new Promise((resolve) => window.setTimeout(resolve, SDK_WAIT_MS))
  ]);
}

export default bridge;
