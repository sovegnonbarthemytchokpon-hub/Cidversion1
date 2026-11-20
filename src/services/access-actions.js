/*
 * Account-first access actions.
 *
 * Tableaux access is granted per schema. A locked card either opens the
 * account surface for authentication or performs one server-authoritative
 * feature unlock without mounting a content modal. Paid anticipation uses a
 * dedicated confirmation dialog before its server-authoritative debit.
 */
(function initCidAccessActions() {
  'use strict';

  const clean = (value, fallback = '') => {
    const text = String(value ?? '').trim();
    return text || fallback;
  };
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function openAccount() {
    const result = window.showProfileView?.();
    window.setTimeout(() => window.cidSetAccountTab?.('history'), 0);
    return result;
  }

  let unlockInFlight = false;
  let subscriptionPurchaseInFlight = false;

  function amount(value) {
    return Math.max(0, Math.trunc(Number(value) || 0));
  }

  function earlyAccessCost(rule, days) {
    if (days <= 0) return 0;
    // Anticipation is a paid add-on. Treat legacy zero-valued rows as the
    // minimum one-token offer instead of confirming an unlock with no debit.
    const one = Math.max(1, amount(rule?.token_cost_1_day ?? rule?.required_tokens));
    const two = Math.max(2, amount(rule?.token_cost_2_days ?? one * 2));
    const three = Math.max(3, amount(rule?.token_cost_3_days ?? one * 3));
    return days === 3 ? three : days === 2 ? two : one;
  }

  function contiguousEarlyDays(access, key, startDate, maxDays) {
    const rollingGrant = access?.earlyAccessGrants?.find((grant) => (
      clean(grant?.feature_key || grant?.featureKey).toLowerCase() === key
      && Number(grant?.days) > 0
      && (!grant?.expires_at || Date.parse(grant.expires_at) > Date.now())
    ));
    if (rollingGrant) {
      return Math.min(maxDays, Number(rollingGrant.days) || 0);
    }
    let count = 0;
    for (let offset = 0; offset < maxDays; offset += 1) {
      const date = new Date(`${startDate}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const dateKey = date.toISOString().slice(0, 10);
      const found = access?.earlyAccessUnlocks?.some((item) => (
        clean(item?.feature_key || item?.featureKey).toLowerCase() === key
        && String(item?.programme_date || '').slice(0, 10) === dateKey
        && (!item?.expires_at || Date.parse(item.expires_at) > Date.now())
      ));
      if (!found) break;
      count += 1;
    }
    return count;
  }

  function currencyLabel(currency, plural = true) {
    if (currency === 'tokens') {
      return window.cidTranslation?.t?.(
        plural ? 'balance.tokenPlural' : 'balance.tokenSingular',
        plural ? 'jetons' : 'jeton'
      ) || (plural ? 'jetons' : 'jeton');
    }
    return window.cidTranslation?.t?.(
      plural ? 'balance.starPlural' : 'balance.starSingular',
      plural ? 'étoiles' : 'étoile'
    ) || (plural ? 'étoiles' : 'étoile');
  }

  function formatAmount(value) {
    return amount(value).toLocaleString(
      window.cidTranslation?.current?.() || 'fr'
    );
  }

  function dateKey(value) {
    const text = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function addDays(value, days) {
    const key = dateKey(value);
    if (!key) return '';
    const date = new Date(`${key}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + Math.max(0, amount(days)));
    return date.toISOString().slice(0, 10);
  }

  function dateLabel(value) {
    const key = dateKey(value);
    if (!key) return 'date non renseignée';
    const date = new Date(`${key}T12:00:00.000Z`);
    return date.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    });
  }

  function validityDateLabel(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'date non renseignée';
    return date.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    });
  }

  function validityEndDate(startValue, durationDays) {
    const date = startValue instanceof Date
      ? new Date(startValue)
      : new Date(startValue || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + Math.max(1, amount(durationDays) || 30));
    return date;
  }

  function earlyAccessConfirmation({
    label,
    rule,
    access,
    programmeDate,
    days,
    required,
    current,
    trigger
  }) {
    const safeDays = Math.max(1, amount(days));
    const firstDate = dateKey(programmeDate);
    const lastDate = addDays(firstDate, safeDays - 1);
    const availableFromDate = dateKey(
      window.cidEarlyAccessUi?.programmeDate?.()
    );
    const missing = Math.max(0, required - current);
    const enoughBalance = current >= required;
    const costText = `${formatAmount(required)} ${currencyLabel('tokens', required !== 1)}`;
    const balanceText = `${formatAmount(current)} ${currencyLabel('tokens', current !== 1)}`;
    const normalDatesText = safeDays === 1
      ? dateLabel(firstDate)
      : `${dateLabel(firstDate)} au ${dateLabel(lastDate)}`;
    const validityDays = Math.max(1, amount(rule?.duration_days) || 30);
    const validityEnd = validityEndDate(Date.now(), validityDays);

    return new Promise((resolve) => {
      let settled = false;
      const modal = document.createElement('div');
      modal.className = 'modal-overlay cid-payment-overlay cid-unlock-confirmation cid-early-access-confirmation open';
      modal.setAttribute('role', 'presentation');
      modal.setAttribute('aria-label', 'Confirmation de l’anticipation');
      modal.innerHTML = `
        <section class="cid-unlock-confirmation__card"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="cidEarlyAccessConfirmationTitle">
          <span class="cid-unlock-confirmation__eyebrow">Avant le débit</span>
          <h2 id="cidEarlyAccessConfirmationTitle">Confirmer l’anticipation</h2>
          <p>
            L’anticipation rend la publication future accessible avant sa date
            normale. Elle ne supprime pas la publication prévue au calendrier.
            Aucun jeton ne sera retiré sans votre validation.
          </p>
          <div class="cid-unlock-confirmation__included">
            <strong>Ce que vous allez obtenir</strong>
            <ul>
              <li>Publication : <b>${escapeHtml(clean(label, 'Publication'))}</b></li>
              <li>Date(s) normale(s) : <b>${escapeHtml(normalDatesText)}</b></li>
              <li>Disponible par anticipation dès : <b>${escapeHtml(
                availableFromDate ? dateLabel(availableFromDate) : 'immédiatement après confirmation'
              )}</b></li>
              <li>Nombre de jours : <b>${safeDays}</b></li>
              <li>Validité du droit : <b>${validityDays} jour${validityDays === 1 ? '' : 's'}</b></li>
              <li>Début de validité : <b>à partir de la confirmation</b></li>
              <li>Fin prévue : <b>${escapeHtml(validityDateLabel(validityEnd))}</b></li>
            </ul>
            <small>
              Le droit est activé immédiatement après la confirmation du
              paiement. La date de fin réelle est enregistrée par le serveur
              selon la durée configurée.
            </small>
          </div>
          <dl class="cid-unlock-confirmation__summary">
            <div>
              <dt>Coût de l’anticipation</dt>
              <dd>${escapeHtml(costText)}</dd>
            </div>
            <div>
              <dt>Solde actuel</dt>
              <dd>${escapeHtml(balanceText)}</dd>
            </div>
            <div class="is-total${enoughBalance ? '' : ' is-insufficient'}">
              <dt>${enoughBalance ? 'Solde après confirmation' : 'Solde insuffisant'}</dt>
              <dd>${enoughBalance
                ? `${formatAmount(current - required)} ${currencyLabel('tokens', current - required !== 1)}`
                : `Il manque ${formatAmount(missing)} ${currencyLabel('tokens', missing !== 1)}`}</dd>
            </div>
          </dl>
          <div class="cid-unlock-confirmation__actions">
            <button type="button"
                    class="tableaux-button tableaux-button--secondary"
                    data-cid-early-cancel>Annuler</button>
            <button type="button"
                    class="tableaux-button tableaux-button--primary cid-buy-button"
                    data-cid-early-confirm>
              ${enoughBalance ? 'Confirmer et anticiper' : 'Voir les jetons nécessaires'}
            </button>
          </div>
        </section>`;

      const cancelButton = modal.querySelector('[data-cid-early-cancel]');
      const confirmButton = modal.querySelector('[data-cid-early-confirm]');
      const settle = (confirmed) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.remove();
        trigger?.focus?.({ preventScroll: true });
        resolve(confirmed);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      };

      cancelButton?.addEventListener('click', () => settle(false));
      confirmButton?.addEventListener('click', () => settle(true));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) settle(false);
      });
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(modal);
      cancelButton?.focus({ preventScroll: true });
    });
  }

  function isIndividualUnlockKey(key) {
    return /^[a-z][a-z0-9_-]{1,59}$/.test(key);
  }

  /*
   * Supabase JS puts the JSON body of a non-2xx Edge Function response on
   * FunctionsHttpError.context, not in response.data. The unlock function
   * deliberately uses 409 for an insufficient balance, so reading only
   * response.data made the useful deficit disappear and sent the visitor to
   * the account screen instead of the purchase panel.
   */
  async function responseFailure(response) {
    let payload = response?.data && typeof response.data === 'object'
      ? response.data
      : null;
    const context = response?.error?.context;
    if (!payload && context) {
      try {
        const readable = typeof context.clone === 'function' ? context.clone() : context;
        if (typeof readable?.json === 'function') payload = await readable.json();
      } catch (_) {
        payload = null;
      }
    }
    const message = payload?.error
      || response?.error?.message
      || 'Déblocage impossible.';
    return {
      payload,
      message,
      status: Number(context?.status) || 0
    };
  }

  function insufficientBalance(
    payload,
    message,
    fallbackCurrency = 'stars',
    fallbackAmounts = {}
  ) {
    const currency = fallbackCurrency === 'tokens' ? 'tokens' : 'stars';
    const code = String(payload?.code || '').toUpperCase();
    // Keep a text fallback for an older deployed function that does not yet
    // return the structured `code/current/required` fields.
    const hasStructuredSignal = code === 'INSUFFICIENT_STARS'
      || code === 'INSUFFICIENT_TOKENS';
    const match = String(message || '').match(/solde insuffisant[^0-9]*(\d+)[^0-9]+(\d+)/i);
    const hasTextSignal = Boolean(match);
    if (!hasStructuredSignal && !hasTextSignal) return null;

    // The selected plan is authoritative for the purchase destination. This
    // also keeps token plans on the token purchase side if an old SQL RPC
    // still reports its generic/star-only error format.
    const payloadCurrent = currency === 'tokens'
      ? payload?.currentTokens
      : payload?.currentStars;
    const payloadRequired = currency === 'tokens'
      ? payload?.requiredTokens
      : payload?.requiredStars;
    const current = Math.max(0, Number(
      payloadCurrent ?? fallbackAmounts.current ?? (match ? match[1] : 0)
    ) || 0);
    const required = Math.max(0, Number(
      payloadRequired ?? fallbackAmounts.required ?? (match ? match[2] : 0)
    ) || 0);
    return {
      currency,
      current,
      required,
      missing: Math.max(1, required - current)
    };
  }

  /*
   * Individual feature unlock. This path intentionally does not create or
   * update a subscription: one debit creates or extends one timed feature
   * grant without changing any global subscription.
   * The card stays in the page while the server verifies and hydrates it.
   */
  async function unlockFeature(featureKey, details = {}) {
    const key = clean(featureKey).toLowerCase();
    if (!isIndividualUnlockKey(key)) {
      return { ok: false, error: 'Élément à débloquer invalide.' };
    }
    if (unlockInFlight) return { ok: false, pending: true };
    unlockInFlight = true;

    try {
      const bridge = await window.cidSupabaseReady;
      const sessionResult = bridge?.auth?.getSession
        ? await bridge.auth.getSession()
        : null;
      const session = sessionResult?.data?.session || await bridge?.getSession?.();
      const user = session?.user || null;
      if (!user?.id) {
        openAccount();
        return { ok: false, requiresAuth: true };
      }
      if (!bridge?.client?.functions?.invoke) {
        return { ok: false, error: 'Service de déblocage indisponible.' };
      }

      const access = await Promise.resolve(
        window.cidFeatureAccess?.refresh?.()
      ).catch(() => null);
      const rule = access?.rules?.find((item) => (
        clean(item?.feature_key || item?.featureKey).toLowerCase() === key
      )) || {};
      if (!rule.feature_key && details.requiredTokens == null && details.requiredStars == null) {
        return { ok: false, error: 'Cette fonctionnalité n’est pas configurée dans Supabase.' };
      }
      const currency = rule.unlock_currency === 'stars'
        ? 'stars'
        : rule.unlock_currency === 'tokens'
          ? 'tokens'
          : details.currency === 'stars' ? 'stars' : 'tokens';
      const configuredAmount = currency === 'tokens'
        ? (rule.required_tokens ?? details.requiredTokens)
        : (rule.required_stars ?? details.requiredStars);
      const requiredNumber = Number(configuredAmount);
      if (!Number.isFinite(requiredNumber) || requiredNumber < 0) {
        return { ok: false, error: 'Le coût de cette fonctionnalité est indisponible.' };
      }
      const required = amount(requiredNumber);
      const current = amount(access?.[currency]);
      // A rule with a zero cost is intentionally public. Do not call the
      // purchase RPC in that case: purchase_feature_unlock uses a minimum
      // debit for paid unlocks and would turn an administrator-configured
      // free option into a charge.
      if (required === 0) {
        return { ok: true, access, free: true };
      }
      if (required > current) {
        window.cidOpenBalancePanel?.({
          currency,
          quantity: Math.max(1, required - current),
          requiredTokens: currency === 'tokens' ? required : undefined,
          currentTokens: currency === 'tokens' ? current : undefined,
          requiredStars: currency === 'stars' ? required : undefined,
          currentStars: currency === 'stars' ? current : undefined,
          notice: `Solde insuffisant : il vous manque ${formatAmount(required - current)} ${currencyLabel(currency)}.`,
        });
        return { ok: false, insufficientBalance: true };
      }

      const response = await bridge.client.functions.invoke('subscription-access', {
        body: { action: 'unlock-feature', featureKey: key }
      });
      if (response.error || !response.data?.ok) {
        const failure = await responseFailure(response);
        const balance = insufficientBalance(
          failure.payload,
          failure.message,
          currency,
          { current, required }
        );
        if (balance) {
          window.cidOpenBalancePanel?.({
            currency: balance.currency,
            quantity: balance.missing,
            notice: failure.message,
          });
        }
        return { ok: false, error: failure.message };
      }

      const finalAccess = await window.cidFeatureAccess?.refresh?.()
        || response.data.access
        || access
        || {};
      await window.cidUserStats?.refresh?.();
      const anticipationRule = Array.isArray(finalAccess?.earlyAccessRules)
        ? finalAccess.earlyAccessRules.find((item) => (
          clean(item?.feature_key || item?.featureKey).toLowerCase() === key
          && item?.enabled === true
        ))
        : null;
      window.cidShowUnlockSuccess?.({
        planName: clean(details.label, rule.display_name || key),
        currency,
        spent: required,
        remaining: finalAccess[currency],
        unlock: response.data.unlock || null,
        durationDays: Number(rule.duration_days) || 0,
        featureKey: key,
        canAnticipate: Boolean(anticipationRule)
      });
      window.dispatchEvent(new CustomEvent('cid:feature-unlocked', {
        detail: {
          access: finalAccess,
          featureKey: key,
          spent: required,
          currency,
          label: clean(details.label, rule.display_name || key)
        }
      }));
      return { ok: true, access: finalAccess };
    } catch (error) {
      return { ok: false, error: error?.message || 'Déblocage impossible.' };
    } finally {
      unlockInFlight = false;
    }
  }

  function currentProgrammeDate() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Abidjan',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const part = (type) => Number(
      parts.find((entry) => entry.type === type)?.value
    );
    return new Date(Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + (part('hour') >= 16 ? 1 : 0)
    )).toISOString().slice(0, 10);
  }

  async function unlockEarlyAccess(featureKey, details = {}) {
    const key = clean(featureKey).toLowerCase();
    if (!key) return { ok: false, error: 'Publication anticipée invalide.' };
    if (unlockInFlight) return { ok: false, pending: true };
    unlockInFlight = true;

    try {
      const bridge = await window.cidSupabaseReady;
      const sessionResult = bridge?.auth?.getSession
        ? await bridge.auth.getSession()
        : null;
      const session = sessionResult?.data?.session || await bridge?.getSession?.();
      const user = session?.user || null;
      if (!user?.id) {
        openAccount();
        return { ok: false, requiresAuth: true };
      }
      if (!bridge?.client?.functions?.invoke) {
        return { ok: false, error: 'Service d’accès anticipé indisponible.' };
      }

      const access = await Promise.resolve(
        window.cidFeatureAccess?.refresh?.()
      ).catch(() => null);
      if (
        typeof window.cidFeatureAccess?.has === 'function'
        && !window.cidFeatureAccess.has(key)
      ) {
        window.cidFeatureAccess.require?.(key);
        return {
          ok: false,
          requiresFeatureUnlock: true,
          error: 'Débloquez d’abord cette section avant de l’anticiper.'
        };
      }
      const rule = access?.earlyAccessRules?.find((item) => (
        clean(item?.feature_key || item?.featureKey).toLowerCase() === key
        && item.enabled !== false
      )) || {
        feature_key: key,
        enabled: true,
        early_hour: 16,
        required_tokens: 0,
        defaultFree: true
      };
      const days = Math.max(
        1,
        Math.min(3, Math.trunc(Number(details.days ?? details.targetDays) || 1))
      );
      const previewDays = Math.max(
        1,
        Math.min(3, Number(rule.preview_days) || 1)
      );
      if (days > previewDays) {
        return { ok: false, error: 'Ce nombre de jours dépasse la fenêtre configurée.' };
      }
      const programmeDate = clean(
        details.programmeDate,
        currentProgrammeDate()
      );
      const alreadyDays = contiguousEarlyDays(access, key, programmeDate, days);
      const required = Math.max(
        0,
        earlyAccessCost(rule, days) - earlyAccessCost(rule, alreadyDays)
      );
      const current = amount(access?.tokens);
      if (!details.skipConfirmation) {
        const confirmed = await earlyAccessConfirmation({
          label: details.label,
          rule,
          access,
          programmeDate,
          days,
          required,
          current,
          trigger: details.trigger
        });
        if (!confirmed) return { ok: false, cancelled: true };
      }
      if (required > current) {
        window.cidOpenBalancePanel?.({
          currency: 'tokens',
          quantity: Math.max(1, required - current),
          requiredTokens: required,
          currentTokens: current,
          notice: `Solde insuffisant : il vous manque ${formatAmount(required - current)} jeton(s).`,
        });
        return { ok: false, insufficientBalance: true };
      }

      const response = await bridge.client.functions.invoke('subscription-access', {
        body: {
          action: 'unlock-early-access',
          featureKey: key,
          programmeDate,
          days
        }
      });
      if (response.error || !response.data?.ok) {
        const failure = await responseFailure(response);
        const balance = insufficientBalance(
          failure.payload,
          failure.message,
          'tokens',
          { current, required }
        );
        if (balance) {
          window.cidOpenBalancePanel?.({
            currency: 'tokens',
            quantity: balance.missing,
            notice: failure.message,
          });
        }
        return { ok: false, error: failure.message };
      }

      const serverAccess = response.data?.access
        && typeof response.data.access === 'object'
        ? response.data.access
        : null;
      if (serverAccess) {
        window.cidFeatureAccess?.adopt?.(serverAccess);
      }
      const finalAccess = serverAccess
        || await window.cidFeatureAccess?.refresh?.()
        || access
        || {};
      const spent = amount(
        response.data?.unlock?.amount
        ?? response.data?.requiredTokens
        ?? required
      );
      await window.cidUserStats?.refresh?.();
      window.cidUserStats?.adopt?.(finalAccess);
      window.cidShowUnlockSuccess?.({
        planName: `Accès anticipé — ${clean(details.label, key)}`,
        currency: 'tokens',
        spent,
        remaining: finalAccess.tokens,
        kind: 'anticipation',
        featureKey: key
      });
      window.dispatchEvent(new CustomEvent('cid:early-access-unlocked', {
        detail: {
          access: finalAccess,
          featureKey: key,
          programmeDate,
          days,
          spent,
          source: clean(details.source)
        }
      }));
      // Account, wallet and header surfaces use this event to re-read their
      // authoritative balance/history snapshot after a confirmed debit.
      window.dispatchEvent(new CustomEvent('cid:payment-validated', {
        detail: {
          kind: 'early-access',
          featureKey: key,
          programmeDate,
          spent,
          remaining: finalAccess.tokens
        }
      }));
      return { ok: true, access: finalAccess };
    } catch (error) {
      return { ok: false, error: error?.message || 'Accès anticipé impossible.' };
    } finally {
      unlockInFlight = false;
    }
  }

  /*
   * Collective subscriptions use the same server-authoritative RPC as the
   * administration/account surfaces. The browser only sends the configured
   * plan slug; price, currency, duration and renewal dates are re-read and
   * validated by the Edge Function.
   */
  async function purchaseSubscriptionPlan(planSlug, details = {}) {
    const slug = clean(planSlug).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(slug)) {
      return { ok: false, error: 'Abonnement invalide.' };
    }
    if (subscriptionPurchaseInFlight) return { ok: false, pending: true };
    subscriptionPurchaseInFlight = true;

    try {
      const bridge = await window.cidSupabaseReady;
      const sessionResult = bridge?.auth?.getSession
        ? await bridge.auth.getSession()
        : null;
      const session = sessionResult?.data?.session || await bridge?.getSession?.();
      const user = session?.user || null;
      if (!user?.id) {
        openAccount();
        return { ok: false, requiresAuth: true };
      }
      if (!bridge?.client?.functions?.invoke) {
        return { ok: false, error: 'Service d’abonnement indisponible.' };
      }

      const access = await Promise.resolve(
        window.cidFeatureAccess?.refresh?.()
      ).catch(() => null);
      const plan = (Array.isArray(access?.plans) ? access.plans : [])
        .find((item) => String(item?.slug || '').toLowerCase() === slug);
      if (!plan || plan.enabled === false) {
        return { ok: false, error: 'Cette offre n’est plus disponible.' };
      }

      const currency = plan.unlock_currency === 'stars' ? 'stars' : 'tokens';
      const required = amount(
        currency === 'stars'
          ? plan.required_stars
          : plan.required_tokens ?? plan.regular_tokens
      );
      const current = amount(access?.[currency]);
      if (required > current) {
        window.cidOpenBalancePanel?.({
          currency,
          quantity: Math.max(1, required - current),
          requiredStars: currency === 'stars' ? required : undefined,
          currentStars: currency === 'stars' ? current : undefined,
          requiredTokens: currency === 'tokens' ? required : undefined,
          currentTokens: currency === 'tokens' ? current : undefined,
          notice: `Solde insuffisant : il vous manque ${formatAmount(required - current)} ${currencyLabel(currency)}.`,
        });
        return { ok: false, insufficientBalance: true };
      }

      if (details.skipConfirmation !== true) {
        const label = clean(plan.display_name, slug);
        const duration = Math.max(1, Math.trunc(Number(plan.duration_days) || 30));
        const price = `${formatAmount(required)} ${currencyLabel(currency, required !== 1)}`;
        const currentExpiry = access?.subscription?.expires_at
          && Date.parse(access.subscription.expires_at) > Date.now()
          ? new Date(access.subscription.expires_at)
          : null;
        const validityStart = currentExpiry
          ? `après la fin de l’accès actuel (${validityDateLabel(currentExpiry)})`
          : 'à partir de la confirmation';
        const validityEnd = validityEndDate(currentExpiry || Date.now(), duration);
        const confirmed = window.confirm(
          `${details.isRenewal ? 'Prolonger' : 'Activer'} « ${label} » pour ${price} pendant ${duration} jour${duration > 1 ? 's' : ''}.\n\n` +
          `Début de validité : ${validityStart}.\n` +
          `Fin prévue : ${validityDateLabel(validityEnd)}.\n\n` +
          'Confirmer le déblocage ?'
        );
        if (!confirmed) return { ok: false, cancelled: true };
      }

      const response = await bridge.client.functions.invoke('subscription-access', {
        body: {
          action: 'purchase-subscription',
          planSlug: slug
        }
      });
      if (response.error || !response.data?.ok) {
        const failure = await responseFailure(response);
        const balance = insufficientBalance(
          failure.payload,
          failure.message,
          currency,
          { current, required }
        );
        if (balance) {
          window.cidOpenBalancePanel?.({
            currency: balance.currency,
            quantity: balance.missing,
            notice: failure.message,
          });
        }
        return { ok: false, error: failure.message };
      }

      const finalAccess = await window.cidFeatureAccess?.refresh?.()
        || response.data.access
        || access
        || {};
      const purchase = response.data.purchase || {};
      const spent = amount(
        currency === 'stars'
          ? purchase.spentStars ?? required
          : purchase.spentTokens ?? required
      );
      await window.cidUserStats?.refresh?.();
      window.cidShowUnlockSuccess?.({
        planName: clean(plan.display_name, slug),
        currency,
        spent,
        remaining: finalAccess[currency]
      });
      window.dispatchEvent(new CustomEvent('cid:subscription-unlocked', {
        detail: {
          access: finalAccess,
          plan: purchase.planSlug || slug,
          purchase
        }
      }));
      return { ok: true, access: finalAccess, purchase };
    } catch (error) {
      return { ok: false, error: error?.message || 'Abonnement impossible.' };
    } finally {
      subscriptionPurchaseInFlight = false;
    }
  }

  window.cidUnlockFeature = unlockFeature;
  window.cidUnlockEarlyAccess = unlockEarlyAccess;
  window.cidPurchaseSubscriptionPlan = purchaseSubscriptionPlan;
})();
