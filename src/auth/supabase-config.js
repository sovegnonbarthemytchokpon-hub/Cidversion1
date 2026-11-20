/*
 * Supabase public browser configuration.
 *
 * Replace these two values with:
 *   Supabase Dashboard → Project Settings → API
 *
 * Only the publishable/anon key belongs here. Never put a service_role key
 * in a browser file. RLS policies remain the actual security boundary.
 */
(function configureCidgroupSupabase() {
  'use strict';

  const current = window.CIDGROUP_SUPABASE_CONFIG;
  if (!window.cidProgrammeState) {
    window.cidProgrammeState = {
      selectedDate: null,
      removedDigits: [],
      positions: Object.create(null),
      canonical: Object.create(null),
      lottoState: null,
      latestResultsPayload: null
    };
  }
  if (current && typeof current === 'object') return;

  window.CIDGROUP_SUPABASE_CONFIG = {
    url: 'https://vgebpqzyawnoezgarmfn.supabase.co',
    anonKey: 'sb_publishable_W55jL4xLKmxITLe_sZP9XQ_AXhQWjMb'
  };
})();
