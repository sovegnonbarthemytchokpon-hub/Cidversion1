// /src/matrice/matrice-controller.js
// Controller that organizes Matrice-specific logic and exposes initMatrice().
// Ensure Matrice view is ready and country buttons are rendered.

import '/src/matrice/displayResults.js';

export function initMatrice() {
  try {
    window.matrice = window.matrice || {};
    // Ensure renderCountryButtons defined and results area ready
    if (typeof window.renderCountryButtons !== 'function') {
      window.renderCountryButtons = window.renderCountryButtons || function(){ /* fallback */ };
    }
    // Ensure Matrice view is ready (no-op if displayResults already manages it)
    const results = document.getElementById('results');
    if (results) results.setAttribute('role','main');
  } catch (e) {
    console.warn('initMatrice failed', e);
  }
}

if (document.readyState !== 'loading') initMatrice(); else document.addEventListener('DOMContentLoaded', initMatrice);