/*
 * Reset only the app-owned scroll surface on a cold load.
 *
 * Safari can restore a nested scroller after the document-level
 * scrollRestoration flag has already been set. Running this while the parser
 * has mounted #results prevents the header from opening against a translated
 * content surface on the first frame.
 */
(function resetAppScrollOnColdLoad() {
  'use strict';

  const results = document.getElementById('results');
  if (!results) return;

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  results.scrollTop = 0;
  results.scrollLeft = 0;
  results.setAttribute('data-cid-cold-scroll-reset', 'true');
})();
