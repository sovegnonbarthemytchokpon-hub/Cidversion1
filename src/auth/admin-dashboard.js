/*
 * Compatibility entry point.
 *
 * The administrator dashboard is now an ES module mounted by
 * account-view.js from admin-dashboard-view.js. This file remains as a
 * harmless compatibility asset for older pages that still include the
 * historic script URL.
 */
(function keepLegacyAdminEntryPoint() {
  'use strict';
  window.initCidAdminDashboard = function initCidAdminDashboard() {};
})();
