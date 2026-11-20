// /src/croix/croix-controller.js
// Controller that encapsulates Croix-specific wiring: redCrossService, download/capture, scanner, and UI tweaks.

import { applyPayload, fetchAndApply } from '/src/croix/redCrossService.js';

export function initCroix() {
  try {
    // ensure service applied canonical payload
    fetchAndApply().catch(() => {});
    // export a small API to other modules
    window.croix = window.croix || {};
    window.croix.applyPayload = applyPayload;
    window.croix.fetchAndApply = fetchAndApply;
    // defensive: ensure copy/download handlers exist (/src/croix/downloadCross.js wires click handlers globally)
    // ensure Croix DOM exists before trying to act
    const rc = document.getElementById('redCross');
    if (rc) {
      // keep cross hidden until Croix section requested
      rc.style.display = rc.style.display || 'none';
    }
  } catch (e) {
    console.warn('initCroix failed', e);
  }
}

// Auto-init when imported
if (document.readyState !== 'loading') initCroix(); else document.addEventListener('DOMContentLoaded', initCroix);