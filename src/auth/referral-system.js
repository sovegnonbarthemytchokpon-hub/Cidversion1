/*
 * Cidmap referral experience.
 *
 * Pending referral state is kept in memory until the server accepts the
 * authenticated event.
 * Share rewards are configured server-side and credited once per qualifying
 * channel/link event. Signup and conversion rewards remain separate events.
 * The Supabase Edge Function is called best-effort for durable, idempotent
 * rewards.
 * The public hooks are intentionally small so a future checkout can call:
 * window.cidReferralSystem.recordPaidConversion({ conversionId: '...' })
 */
(() => {
  'use strict';

  const memory = { pending: null, visitor: '', events: Object.create(null) };
  let dialog = null;
  let status = null;
  let dialogHistoryActive = false;
  const PUBLIC_ORIGIN = 'https://cidmap.com';

  const read = (key, fallback) => memory[key] ?? fallback;
  const write = (key, value) => { memory[key] = value; };
  const codeOf = (value) => {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9_-]{3,40}$/.test(code) ? code : '';
  };
  const getProfile = () => window.cidAuth?.getCurrentProfile?.() || null;
  const currentCode = () => codeOf(getProfile()?.cid);

  function visitorKey() {
    let value = memory.visitor || '';
    if (!value) {
      const random = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      value = `visitor-${random}`;
      memory.visitor = value;
    }
    return value;
  }

  function pendingReferral() {
    const value = read('pending', null);
    const referrerCode = codeOf(value?.referrerCode || value?.cid);
    return referrerCode ? { ...value, referrerCode, visitorKey: value?.visitorKey || visitorKey() } : null;
  }

  function captureReferral() {
    const params = new URLSearchParams(window.location.search);
    const referrerCode = codeOf(params.get('ref') || params.get('parrain'));
    if (!referrerCode || referrerCode === currentCode()) return null;
    const pending = {
      referrerCode,
      visitorKey: visitorKey(),
      capturedAt: new Date().toISOString()
    };
    write('pending', pending);
    return pending;
  }

  function referralUrl(code = currentCode()) {
    const safeCode = codeOf(code);
    // Shared links always use the official public domain while retaining the
    // current path and query parameters in preview and production contexts.
    try {
      const target = new URL(window.location.href);
      target.hash = '';
      target.searchParams.delete('ref');
      target.searchParams.delete('parrain');
      target.searchParams.delete('ref_share');
      target.protocol = 'https:';
      target.hostname = 'cidmap.com';
      target.port = '';
      if (safeCode) target.searchParams.set('ref', safeCode);
      return target.toString();
    } catch (_) {
      return safeCode
        ? `${PUBLIC_ORIGIN}/?ref=${encodeURIComponent(safeCode)}`
        : `${PUBLIC_ORIGIN}/`;
    }
  }

  function shareUrl(url = window.location.href) {
    const safeCode = currentCode();
    const original = String(url || window.location.href);
    try {
      const target = new URL(original, window.location.origin);
      target.hash = '';
      target.searchParams.delete('ref');
      target.searchParams.delete('parrain');
      target.searchParams.delete('ref_share');
      target.protocol = 'https:';
      target.hostname = 'cidmap.com';
      target.port = '';
      if (safeCode) target.searchParams.set('ref', safeCode);
      return target.toString();
    } catch (_) {
      return `${PUBLIC_ORIGIN}/`;
    }
  }

  function eventStore() {
    const value = read('events', {});
    return value && typeof value === 'object' ? value : {};
  }

  function rememberEvent(key) {
    const events = eventStore();
    if (events[key]) return false;
    events[key] = new Date().toISOString();
    write('events', events);
    return true;
  }

  async function supabaseReferralEvent(payload) {
    try {
      const bridge = await window.cidSupabaseReady;
      if (!bridge?.client?.functions?.invoke) return null;
      const { data, error } = await bridge.client.functions.invoke('referral-reward', {
        body: payload
      });
      if (error || !data?.ok) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function ensureSupabaseReferralAccount(profile = getProfile()) {
    const accountCode = codeOf(profile?.cid);
    if (!accountCode) return null;
    return supabaseReferralEvent({ action: 'ensure', accountCode });
  }

  async function syncState(code = currentCode()) {
    const safeCode = codeOf(code);
    if (!safeCode) return null;
    return supabaseReferralEvent({ action: 'ensure', accountCode: safeCode });
  }

  function showReward(kind, amount = 1) {
    document.querySelectorAll('.cid-referral-reward').forEach((node) => node.remove());
    const reward = document.createElement('div');
    reward.className = `cid-referral-reward${kind === 'star' ? ' is-star' : ''}`;
    reward.textContent = kind === 'both'
      ? `+${amount}`
      : `+${amount} ${kind === 'token' ? 'jeton gagné' : 'étoile gagnée'}`;
    document.body.appendChild(reward);
    window.setTimeout(() => reward.remove(), 1600);
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function closeDialog({ fromHistory = false } = {}) {
    if (!dialog) return;
    const shouldRestoreHistory = !fromHistory && dialogHistoryActive;
    dialogHistoryActive = false;
    dialog.classList.remove('is-open');
    dialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cid-referral-modal-open');
    window.cidResetScrollLock?.({ resetSurfaces: false });
    window.setTimeout(() => {
      if (dialog && !dialog.classList.contains('is-open')) dialog.hidden = true;
    }, 220);
    if (shouldRestoreHistory) {
      try { window.history.back(); } catch (_) {}
    }
  }

  function closeDialogFromHistory() {
    if (!dialogHistoryActive) return;
    dialogHistoryActive = false;
    closeDialog({ fromHistory: true });
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.className = 'cid-referral-dialog';
    dialog.id = 'cidReferralDialog';
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
    dialog.innerHTML = `
      <section class="cid-referral-card" aria-labelledby="cidReferralTitle">
        <div class="cid-referral-card__head">
          <div>
            <p class="cid-referral-card__eyebrow">Lien personnel</p>
            <h2 id="cidReferralTitle">Inviter un proche</h2>
          </div>
          <button class="cid-referral-close" type="button" data-referral-close aria-label="Retour">‹</button>
        </div>
        <div class="cid-referral-card__body">
          <p>Chaque filleul qui crée son compte via ce lien peut déclencher la récompense configurée. Une conversion validée peut également créditer la récompense définie pour son abonnement.</p>
          <div class="cid-referral-link"><span data-referral-url></span></div>
          <div class="cid-referral-options" aria-label="Options de partage">
            <button class="cid-referral-option" type="button" data-share-action="whatsapp">
              <span class="cid-referral-option__icon" aria-hidden="true">◔</span><span>WhatsApp</span>
            </button>
            <button class="cid-referral-option" type="button" data-share-action="facebook">
              <span class="cid-referral-option__icon" aria-hidden="true">f</span><span>Facebook</span>
            </button>
            <button class="cid-referral-option" type="button" data-share-action="copy">
              <span class="cid-referral-option__icon" aria-hidden="true">⧉</span><span>Copier le lien</span>
            </button>
          </div>
          <p class="cid-referral-status" data-referral-status role="status" aria-live="polite"></p>
        </div>
      </section>`;
    document.body.appendChild(dialog);
    status = dialog.querySelector('[data-referral-status]');
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-referral-close]')) closeDialog();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDialog();
    });
    bindShareOptions();
    return dialog;
  }

  function bindShareOptions() {
    dialog?.querySelectorAll('[data-share-action]').forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => handleShareAction(button.dataset.shareAction));
    });
  }

  function requireProfile() {
    const code = currentCode();
    if (code) return code;
    setStatus('Connectez-vous pour créer votre lien personnel.');
    window.showProfileView?.();
    return '';
  }

  function openShare() {
    const code = requireProfile();
    if (!code) return false;
    const root = ensureDialog();
    root.querySelector('[data-referral-url]').textContent = referralUrl(code);
    setStatus('');
    // Give the in-page share sheet its own history entry. On mobile, the
    // browser Back button now closes the sheet instead of leaving the app on
    // a blank/error document.
    if (!dialogHistoryActive) {
      try {
        history.pushState(
          { ...(history.state || {}), cidReferralDialog: true },
          '',
          window.location.href
        );
        dialogHistoryActive = true;
      } catch (_) {}
    }
    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add('is-open');
      root.setAttribute('aria-hidden', 'false');
      root.querySelector('[data-share-action="copy"]')?.focus();
    });
    document.body.classList.add('cid-referral-modal-open');
    return true;
  }

  async function handleShareAction(action) {
    const code = requireProfile();
    if (!code) return;
    const url = referralUrl(code);
    const text = 'Rejoignez-moi sur Cidmap avec mon lien de parrainage !';
    if (action === 'whatsapp') {
      const popup = window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener,noreferrer');
      if (popup) {
        await window.cidSocialRepository?.recordPostShare?.('site-share', 'whatsapp').catch?.(() => {});
        await recordShare('whatsapp', url);
        setStatus('WhatsApp est prêt à envoyer votre invitation. La récompense sera créditée lorsque ce filleul débloquera sa première section.');
      } else {
        await copyFallback(url);
      }
      return;
    }
    if (action === 'facebook') {
      const popup = window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
      if (popup) {
        await window.cidSocialRepository?.recordPostShare?.('site-share', 'facebook').catch?.(() => {});
        await recordShare('facebook', url);
        setStatus('Fenêtre Facebook ouverte. La récompense sera créditée lorsque ce filleul débloquera sa première section.');
      } else {
        await copyFallback(url);
      }
      return;
    }
    await copyFallback(url);
  }

  async function copyFallback(url) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      await window.cidSocialRepository?.recordPostShare?.('site-share', 'copy').catch?.(() => {});
      await recordShare('copy', url);
      setStatus('Lien copié. La récompense sera créditée lorsque ce filleul débloquera sa première section.');
    } catch (_) {
      setStatus('Partage indisponible ici : copiez le lien affiché.');
    }
  }

  async function recordShare(channel = 'unknown', sharedUrl = '') {
    const accountCode = requireProfile();
    if (!accountCode) return { ok: false, credited: false, reason: 'not-signed-in' };
    const normalizedChannel = String(channel || 'unknown').trim().toLowerCase() || 'unknown';
    const shareKey = `${normalizedChannel}:${String(sharedUrl || referralUrl(accountCode))}`;
    const eventKey = `share:${accountCode}:${shareKey}`;
    if (eventStore()[eventKey]) return { ok: true, credited: false, duplicate: true };
    const response = await supabaseReferralEvent({
      action: 'share',
      accountCode,
      channel: normalizedChannel,
      shareKey
    });
    if (response?.ok) {
      rememberEvent(eventKey);
    }
    if (response?.credited) {
      showReward(
        response.currency === 'tokens' ? 'token' : response.currency === 'both' ? 'both' : 'star',
        Number(response.amount) || 1
      );
      await window.cidUserStats?.refresh?.();
    }
    return response || { ok: false, credited: false, reason: 'unavailable' };
  }

  async function registerSignup(profile = getProfile(), explicitReferrer = '') {
    const childCode = codeOf(profile?.cid);
    const pending = pendingReferral() || (codeOf(explicitReferrer || profile?.referredBy)
      ? { referrerCode: codeOf(explicitReferrer || profile?.referredBy), visitorKey: visitorKey() }
      : null);
    if (!childCode || !pending || pending.referrerCode === childCode) return null;
    const eventKey = `register:${childCode}:${pending.referrerCode}:${pending.visitorKey}`;
    const payload = {
      action: 'register',
      accountCode: childCode,
      referrerCode: pending.referrerCode,
      visitorKey: pending.visitorKey,
      accountCreatedAt: profile?.createdAt || new Date().toISOString()
    };
    const response = await supabaseReferralEvent(payload);
    // Keep the pending referral when the backend is temporarily unavailable
    // so the signup can be retried on the next auth sync/focus event.
    if (response?.ok) {
      rememberEvent(eventKey);
      write('pending', null);
    }
    if (response?.credited) {
      showReward(
        response.currency === 'tokens' ? 'token' : response.currency === 'both' ? 'both' : 'star',
        Number(response.amount) || 1
      );
      await window.cidUserStats?.refresh?.();
    }
    return response;
  }

  async function recordPaidConversion({ conversionId = '', referrerCode = '' } = {}) {
    const childCode = currentCode();
    if (!childCode) return { ok: false, reason: 'not-signed-in' };
    const profile = getProfile();
    const effectiveReferrer = codeOf(profile?.referredBy || referrerCode);
    if (!effectiveReferrer || effectiveReferrer === childCode) {
      return { ok: false, reason: 'no-referrer' };
    }
    const eventKey = `conversion:${childCode}:${conversionId || Date.now()}`;
    if (!rememberEvent(eventKey)) return { ok: true, credited: false, duplicate: true };
    const payload = {
      action: 'conversion',
      accountCode: childCode,
      referrerCode: effectiveReferrer,
      conversionId,
      eventKey
    };
    const response = (await supabaseReferralEvent(payload)) || { ok: true, credited: false, offline: true };
    if (response.credited) {
      showReward(
        response.currency === 'tokens' ? 'token' : 'star',
        Number(response.amount) || 1
      );
    }
    await window.cidUserStats?.refresh?.();
    return response;
  }

  function showStars() {
    const code = currentCode();
    if (!code) {
      window.showProfileView?.();
      return;
    }
    const stars = window.cidUserStats?.get?.(code)?.etoilesGagnees || 0;
    ensureDialog();
    dialog.querySelector('.cid-referral-card__head h2').textContent = `${stars} étoile${stars === 1 ? '' : 's'}`;
    dialog.querySelector('.cid-referral-card__eyebrow').textContent = 'Votre solde';
    dialog.querySelector('.cid-referral-card__body > p').textContent = 'La récompense d’affiliation est créditée une seule fois lorsque le filleul débloque sa première section.';
    dialog.querySelector('.cid-referral-options').innerHTML = `
      <button class="cid-referral-option" type="button" data-share-action="copy">
        <span class="cid-referral-option__icon" aria-hidden="true">↗</span><span>Inviter un proche</span>
      </button>`;
    bindShareOptions();
    dialog.querySelector('[data-referral-url]').textContent = referralUrl(code);
    setStatus('Partagez votre lien pour développer votre réseau.');
    dialog.hidden = false;
    requestAnimationFrame(() => {
      dialog.classList.add('is-open');
      dialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('cid-referral-modal-open');
    });
  }

  function restoreShareDialog() {
    if (!dialog) return;
    dialog.querySelector('.cid-referral-card__head h2').textContent = 'Inviter un proche';
    dialog.querySelector('.cid-referral-card__eyebrow').textContent = 'Lien personnel';
    dialog.querySelector('.cid-referral-card__body > p').textContent = 'Chaque filleul qui crée son compte via ce lien peut déclencher la récompense configurée. Une conversion validée peut également créditer la récompense définie pour son abonnement.';
    dialog.querySelector('.cid-referral-options').innerHTML = `
      <button class="cid-referral-option" type="button" data-share-action="whatsapp"><span class="cid-referral-option__icon">◔</span><span>WhatsApp</span></button>
      <button class="cid-referral-option" type="button" data-share-action="facebook"><span class="cid-referral-option__icon">f</span><span>Facebook</span></button>
      <button class="cid-referral-option" type="button" data-share-action="copy"><span class="cid-referral-option__icon">⧉</span><span>Copier le lien</span></button>`;
    bindShareOptions();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#shareBtn, [data-native-share], [data-referral-share]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      restoreShareDialog();
      openShare();
      return;
    }
    if (target.closest('#starBtn')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof window.cidOpenBalancePanel === 'function') {
        window.cidOpenBalancePanel({});
      } else {
        showStars();
      }
    }
  }, true);

  window.addEventListener('popstate', () => {
    if (dialogHistoryActive) closeDialogFromHistory();
  });

  window.addEventListener('pageshow', () => {
    // A social app can restore the page from its bfcache after a share. Make
    // sure no stale modal layer can turn that return into an apparent blank
    // page or trap touch input.
    if (dialog && document.visibilityState === 'visible') {
      dialog.style.pointerEvents = '';
    }
  });

  window.addEventListener('cid:referral-registered', (event) => {
    registerSignup(event.detail?.profile || getProfile(), event.detail?.referrerCode || '').catch(() => {});
  });
  window.addEventListener('cid:auth-sync', (event) => {
    const profile = event.detail || getProfile();
    if (profile?.cid) {
      syncState(profile.cid).catch(() => {});
      ensureSupabaseReferralAccount(profile).catch(() => {});
    }
  });
  window.addEventListener('cid:paid-conversion', (event) => {
    recordPaidConversion(event.detail || {}).catch(() => {});
  });
  window.addEventListener('focus', () => syncState().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncState().catch(() => {});
  });

  captureReferral();
  window.cidReferralSystem = {
    captureReferral,
    getPendingReferral: pendingReferral,
    getReferralUrl: referralUrl,
    getShareUrl: shareUrl,
    openShare,
    recordShare,
    registerSignup,
    recordPaidConversion,
    syncState
  };
})();
