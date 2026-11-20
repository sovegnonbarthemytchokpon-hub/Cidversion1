/*
 * Supabase browser boundary.
 *
 * The anon key is safe to expose in a browser, but it must always be
 * protected by Supabase RLS policies. The values are kept in
 * /src/auth/supabase-config.js. If Supabase is not configured, account
 * operations fail explicitly instead of switching to a local account.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.CIDGROUP_SUPABASE_CONFIG || {};
const supabaseUrl = String(config.url || '').trim();
const supabaseAnonKey = String(config.anonKey || '').trim();
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const client = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Keep OAuth callbacks out of the URL fragment. The implicit flow
        // exposes bearer tokens in copied links; PKCE returns a short-lived
        // code that the client exchanges for the session.
        flowType: 'pkce'
      }
    })
  : null;

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

const bridge = {
  client,
  functions: client?.functions || null,
  auth: client?.auth || null,
  isConfigured,
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
// future modules.
window.cidSupabase = bridge;
window.cidSupabaseReady = Promise.resolve(bridge);

if (client) {
  // Supabase has already been initialized with detectSessionInUrl, so this
  // listener runs after the callback has been consumed. Removing the
  // callback parameters prevents access tokens from being copied or stored
  // in browser history.
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
      window.setTimeout(clearAuthCallbackUrl, 0);
    }
  });
}

export const supabaseClient = client;
export const supabase = bridge;
export default client;
