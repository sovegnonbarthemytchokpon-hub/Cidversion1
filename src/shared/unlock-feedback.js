/*
 * Success feedback for paid access unlocks.
 *
 * The server notification remains the durable record. This is only the
 * immediate in-app confirmation shown after the debit and unlock succeed.
 */
(function initCidUnlockFeedback() {
  'use strict';

  let toast = null;
  let hideTimer = null;
  let successSound = null;

  const amount = (value) => Math.max(0, Math.trunc(Number(value) || 0));
  const label = (currency) => currency === 'tokens'
    ? (window.cidTranslation?.t?.('balance.tokenPlural', 'jetons') || 'jetons')
    : (window.cidTranslation?.t?.('balance.starPlural', 'étoiles') || 'étoiles');
  const dateLabel = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function playSuccessSound() {
    try {
      if (!successSound) {
        successSound = new Audio('/sfx/unlock-success.wav');
        successSound.preload = 'auto';
        successSound.volume = 0.55;
      }
      const playback = successSound.cloneNode();
      playback.volume = 0.55;
      playback.play().catch(() => {
        // Some browsers block a sound after an asynchronous server response.
        // The visible success message remains the reliable confirmation.
      });
    } catch (_) {}
  }

  function hide() {
    if (!toast) return;
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (toast && !toast.classList.contains('is-visible')) toast.remove();
    }, 220);
  }

  function show(details = {}) {
    if (toast) toast.remove();
    const currency = details.currency === 'tokens' ? 'tokens' : 'stars';
    const planName = escapeHtml(details.planName || 'votre section');
    const spent = amount(details.spent);
    const remaining = amount(details.remaining);
    const isAnticipation = details.kind === 'anticipation';
    const unlock = details.unlock || {};
    const canAnticipate = details.canAnticipate === true
      && String(details.featureKey || '').startsWith('tableaux-');
    const totalDays = amount(
      unlock.totalDurationDays || unlock.durationDays || details.durationDays
    );
    const expiresLabel = dateLabel(unlock.expiresAt);
    const durationMessage = totalDays > 0
      ? `${totalDays} jour(s) d’accès pour ce tableau`
      : '';
    const renewalMessage = unlock.isRenewal && unlock.startedAt
      ? `Renouvellement pris en compte à partir du ${dateLabel(unlock.startedAt)}`
      : '';
    const expiryMessage = expiresLabel
      ? `Valable jusqu’au ${expiresLabel}.`
      : '';
    toast = document.createElement('aside');
    toast.className = 'cid-unlock-success';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <span class="cid-unlock-success__icon" aria-hidden="true">✓</span>
      <div class="cid-unlock-success__copy">
        <strong>${isAnticipation ? 'Anticipation confirmée !' : 'Félicitations, accès débloqué !'}</strong>
        <span>${isAnticipation
          ? `${planName} est maintenant disponible en anticipation.`
          : `${planName} est maintenant disponible.`}</span>
        <small>${spent} ${label(currency)} prélevé(s) · solde restant : ${remaining} ${label(currency)}</small>
        ${durationMessage || renewalMessage || expiryMessage
          ? `<small>${[durationMessage, renewalMessage, expiryMessage].filter(Boolean).join(' · ')}</small>`
          : ''}
        ${canAnticipate
          ? `<div class="cid-unlock-success__next">
               <span>Vous pouvez maintenant anticiper la prochaine publication de ce tableau.</span>
               <button type="button" data-cid-unlock-anticipate>
                 Anticiper la prochaine publication
               </button>
             </div>`
          : ''}
      </div>
      <button type="button" class="cid-unlock-success__close" aria-label="Fermer">×</button>`;
    document.body.appendChild(toast);
    toast.querySelector('.cid-unlock-success__close')?.addEventListener('click', hide);
    toast.querySelector('[data-cid-unlock-anticipate]')?.addEventListener('click', () => {
      hide();
      window.showAnticipationView?.({
        focusFeature: details.featureKey
      });
    });
    window.requestAnimationFrame(() => toast?.classList.add('is-visible'));
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, canAnticipate ? 12000 : 6500);
    playSuccessSound();
  }

  window.cidShowUnlockSuccess = show;
})();
