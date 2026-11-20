/* Display adapter only; programme calculations are backend method facades. */
import '../../matrice/matrice-controller.js';
import '../../matrice/matrice-view.js?date-binding-v2';

export function mountMatrices() {
  return window.activateMatriceView?.();
}
