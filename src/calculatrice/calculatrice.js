/*
 * Déchiffrement — client adapter only.
 *
 * Le navigateur détecte les groupes collés et transmet les valeurs au serveur.
 * Le classement des chiffres et des combinaisons est effectué par l’Edge
 * Function autonome ; aucune formule propriétaire n’est calculée ici.
 */
(function secureMatrixCalculator() {
  const openButton = document.getElementById('matrixCalcBtn');
  const panel = document.getElementById('matrixCalculatorPanel');
  const input = document.getElementById('matrixCalcInput');
  const codeInput = document.getElementById('matrixCalcCode');
  const eventInput = document.getElementById('matrixCalcEvent');
  const clearButton = document.getElementById('matrixCalcClear');
  const runButton = document.getElementById('matrixCalcRun');
  const copyButton = document.getElementById('matrixCalcCopy');
  const plusPanel = document.getElementById('matrixCalcPlusPanel');
  const plusButton = document.getElementById('matrixCalcPlus');
  const plusStatus = document.getElementById('matrixCalcPlusStatus');
  const plusOutput = document.getElementById('matrixCalcPlusOutput');
  const plusDescription = document.getElementById('matrixCalcPlusDescription');
  const plusManualNumbers = document.getElementById('matrixCalcPlusManualNumbers');
  const plusManualClear = document.getElementById('matrixCalcPlusManualClear');
  const initialStep = document.getElementById('matrixCalcInitialStep');
  const backButton = document.getElementById('matrixCalcBack');
  const likeButton = document.getElementById('matrixCalcLike');
  const likeCount = document.getElementById('matrixCalcLikeCount');
  const likeStatus = document.getElementById('matrixCalcLikeStatus');
  const status = document.getElementById('matrixCalcStatus');
  const output = document.getElementById('matrixCalcOutput');
  const list = document.getElementById('matrixCalcList');
  const resultsModal = document.getElementById('matrixCalcResultsModal');
  const resultsModalList = document.getElementById('matrixCalcResultsModalList');
  const resultsModalTitle = document.getElementById('matrixCalcResultsModalTitle');
  const resultsModalClose = document.getElementById('matrixCalcResultsModalClose');
  const resultsModalDone = document.getElementById('matrixCalcResultsModalDone');

  if (!panel || !runButton || !list) return;

  const CALCULATOR_LIKE_KEY = 'calculator:dechiffrement-mt';
  let calculationEpoch = 0;
  let modalReturnFocus = null;
  let likeOperationPending = false;
  let likeRealtimeCleanup = null;
  let latestLikeMetrics = { likes: 0, liked: false };
  const keyboardFields = [
    input,
    codeInput,
    eventInput,
    plusManualNumbers
  ].filter(Boolean);

  const setKeyboardMode = (active, target = null) => {
    document.body.classList.toggle('matrix-keyboard-open', active);
    panel.classList.toggle('matrix-keyboard-open', active);
    if (!active || !target) return;
    window.setTimeout(() => {
      if (document.activeElement !== target) return;
      target.scrollIntoView?.({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth'
      });
    }, 140);
  };

  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? '#D62828' : '#0A1840';
  };

  const setPlusStatus = (message, error = false) => {
    if (!plusStatus) return;
    plusStatus.textContent = message;
    plusStatus.style.color = error ? '#B42318' : '#6B4A1A';
  };

  const formatAccessAmount = (value) => Math.max(
    0,
    Math.trunc(Number(value) || 0)
  ).toLocaleString(window.cidTranslation?.current?.() || 'fr');

  const accessDurationDays = (rule) => Math.max(
    1,
    Math.trunc(Number(rule?.duration_days) || 30)
  );

  const accessEndDateLabel = (days) => {
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, Number(days) || 30));
    return new Intl.DateTimeFormat(
      window.cidTranslation?.current?.() || 'fr',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Abidjan'
      }
    ).format(end);
  };

  const plusUnlockExplanation = [
    'Après le déblocage, le service analyse par défaut les 10 numéros calculés. Vous pouvez les remplacer par autant de numéros distincts que vous souhaitez saisir manuellement.',
    'Il scanne les méthodes miroir impair, Kanta, complément, intervalle, multiplication, addition et soustraction pour former les couples et groupes liés.',
    'Le traitement est effectué par le serveur selon la méthode configurée ; aucun résultat n’est débité avant votre confirmation.'
  ];

  const requestPlusUnlockConfirmation = ({ rule, access, trigger }) => {
    const currency = rule?.unlock_currency === 'stars' ? 'stars' : 'tokens';
    const label = currency === 'tokens' ? 'jeton' : 'étoile';
    const plural = currency === 'tokens' ? 'jetons' : 'étoiles';
    const required = Math.max(0, Math.trunc(Number(
      currency === 'tokens' ? rule?.required_tokens : rule?.required_stars
    ) || 0));
    const current = Math.max(0, Math.trunc(Number(access?.[currency]) || 0));
    const missing = Math.max(0, required - current);
    const enoughBalance = current >= required;
    const remaining = Math.max(0, current - required);
    const durationDays = accessDurationDays(rule);
    const durationLabel = `${durationDays} jour${durationDays === 1 ? '' : 's'}`;
    const endDateLabel = accessEndDateLabel(durationDays);

    return new Promise((resolve) => {
      let settled = false;
      const modal = document.createElement('div');
      modal.className = [
        'modal-overlay',
        'cid-payment-overlay',
        'cid-unlock-confirmation',
        'cid-plus-unlock-confirmation',
        enoughBalance ? 'is-balance-sufficient' : 'is-balance-insufficient',
        'open'
      ].join(' ');
      modal.setAttribute('role', 'presentation');
      modal.setAttribute(
        'aria-label',
        enoughBalance ? 'Confirmation du déblocage' : 'Solde insuffisant'
      );
      modal.innerHTML = `
        <section class="cid-unlock-confirmation__card"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="cidPlusUnlockTitle">
          <span class="cid-unlock-confirmation__eyebrow">${
            enoughBalance ? 'Déblocage sécurisé' : 'Solde insuffisant'
          }</span>
          <h2 id="cidPlusUnlockTitle">${
            enoughBalance ? 'Déchiffrement avancé' : 'Déblocage nécessaire'
          }</h2>
          <p>${
            enoughBalance
              ? 'Votre compte peut débloquer ce service. Vérifiez le coût et confirmez pour continuer.'
              : `Il vous manque ${formatAccessAmount(missing)} ${missing === 1 ? label : plural} pour utiliser ce service.`
          }</p>
          <div class="cid-unlock-confirmation__included">
            <strong>Comment le service fonctionne après déblocage</strong>
            <ul>
              ${plusUnlockExplanation.map((item) => `<li>${item}</li>`).join('')}
            </ul>
            <small>Les 10 numéros calculés sont utilisés par défaut ; vous pouvez les remplacer par votre propre sélection.</small>
            <div class="cid-plus-unlock-validity">
              <span>Validité configurée</span>
              <b>${durationLabel}</b>
              <span>Début</span>
              <b>à partir de la confirmation</b>
              <span>Fin prévue si confirmé aujourd’hui</span>
              <b>${endDateLabel}</b>
            </div>
          </div>
          <dl class="cid-unlock-confirmation__summary">
            <div>
              <dt>Coût du déchiffrement</dt>
              <dd>${formatAccessAmount(required)} ${required === 1 ? label : plural}</dd>
            </div>
            <div>
              <dt>Solde actuel</dt>
              <dd>${formatAccessAmount(current)} ${current === 1 ? label : plural}</dd>
            </div>
            <div class="${enoughBalance ? 'is-total' : 'is-insufficient'}">
              <dt>${enoughBalance ? 'Solde après déblocage' : 'Solde manquant'}</dt>
              <dd>${formatAccessAmount(enoughBalance ? remaining : missing)} ${
                (enoughBalance ? remaining : missing) === 1 ? label : plural
              }</dd>
            </div>
          </dl>
          <div class="cid-unlock-confirmation__actions">
            <button type="button"
                    class="tableaux-button tableaux-button--secondary"
                    data-cid-plus-unlock-cancel>Annuler</button>
            <button type="button"
                    class="tableaux-button tableaux-button--primary cid-buy-button"
                    data-cid-plus-unlock-action>
              ${enoughBalance
                ? 'Confirmer le déblocage'
                : `Acheter ${formatAccessAmount(missing)} ${missing === 1 ? label : plural}`}
            </button>
          </div>
        </section>`;

      const cancelButton = modal.querySelector('[data-cid-plus-unlock-cancel]');
      const actionButton = modal.querySelector('[data-cid-plus-unlock-action]');
      const settle = (result) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.remove();
        trigger?.focus?.({ preventScroll: true });
        resolve(result);
      };
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        settle({ confirmed: false, cancelled: true });
      };

      cancelButton?.addEventListener('click', () => (
        settle({ confirmed: false, cancelled: true })
      ));
      actionButton?.addEventListener('click', () => (
        settle(enoughBalance
          ? { confirmed: true }
          : { buyTokens: true, missing, currency })
      ));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          settle({ confirmed: false, cancelled: true });
        }
      });
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(modal);
      cancelButton?.focus({ preventScroll: true });
    });
  };

  const setLikeStatus = (message, error = false) => {
    document.querySelectorAll('[data-matrix-like-status]').forEach((element) => {
      element.textContent = message;
      element.style.color = error ? '#B42318' : '#667085';
    });
  };

  const showInitialStep = ({ focus = false } = {}) => {
    if (initialStep) initialStep.hidden = false;
    if (plusPanel) {
      plusPanel.style.display = 'block';
      plusPanel.hidden = false;
    }
    if (output) output.style.display = 'none';
    if (copyButton) copyButton.style.display = 'none';
    panel.classList.remove('matrix-calc-plus-active');
    panel.classList.remove('matrix-calc-plus-dedicated');
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    if (focus) {
      window.setTimeout(() => input?.focus({ preventScroll: true }), 0);
    }
  };

  const showPlusStep = ({ focus = false } = {}) => {
    if (initialStep) initialStep.hidden = true;
    if (plusPanel) {
      plusPanel.hidden = false;
      plusPanel.style.display = 'block';
    }
    if (output) output.style.display = 'block';
    if (copyButton) copyButton.style.display = 'inline-flex';
    panel.classList.add('matrix-calc-plus-active');
    panel.classList.add('matrix-calc-plus-dedicated');
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    if (focus) {
      window.setTimeout(() => plusButton?.focus({ preventScroll: true }), 0);
    }
  };

  const clearCalculator = () => {
    calculationEpoch += 1;
    [
      input,
      codeInput,
      eventInput,
      plusManualNumbers
    ].forEach((field) => {
      if (field) field.value = '';
    });

    panel.removeAttribute('data-last-results');
    list.innerHTML = '';
    output.style.display = 'none';
    if (copyButton) copyButton.style.display = 'none';
    if (plusPanel) plusPanel.style.display = 'block';
    if (plusPanel) plusPanel.hidden = false;
    if (initialStep) initialStep.hidden = false;
    panel.classList.remove('matrix-calc-plus-active');
    panel.classList.remove('matrix-calc-plus-dedicated');
    if (plusOutput) {
      plusOutput.innerHTML = '';
      plusOutput.style.display = 'none';
    }
    setStatus('');
    setPlusStatus('');
    closeResultsModal();
  };

  const closeResultsModal = () => {
    if (!resultsModal || resultsModal.hidden) return;
    resultsModal.hidden = true;
    resultsModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('matrix-calc-modal-open');
    window.cidResetScrollLock?.({ resetSurfaces: false });
    const returnTarget = modalReturnFocus;
    modalReturnFocus = null;
    if (returnTarget && document.contains(returnTarget)) {
      window.setTimeout(() => returnTarget.focus({ preventScroll: true }), 0);
    }
  };

  const openResultsModal = (numbers, program = {}) => {
    if (!resultsModal || !resultsModalList) return;
    const formattedNumbers = numbers.map((value) => String(value).padStart(2, '0'));
    resultsModalList.innerHTML = '';
    formattedNumbers.forEach((value, index) => {
      const item = document.createElement('div');
      item.className = 'matrix-calc-results-number';
      item.setAttribute('role', 'listitem');
      const order = document.createElement('span');
      order.className = 'matrix-calc-results-index';
      order.textContent = String(index + 1);
      const number = document.createElement('strong');
      number.textContent = value;
      item.append(order, number);
      resultsModalList.appendChild(item);
    });
    if (resultsModalTitle) {
      resultsModalTitle.textContent = `${program.name || program.country || 'Matrice'} · 10 numéros`;
    }
    modalReturnFocus = document.activeElement;
    resultsModal.hidden = false;
    resultsModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('matrix-calc-modal-open');
    window.requestAnimationFrame(() => resultsModalClose?.focus({ preventScroll: true }));
  };

  const renderLikeMetrics = (metrics = {}) => {
    const likes = Math.max(0, Number(metrics.likes) || 0);
    const label = `${likes} ${likes === 1 ? 'personne aime' : 'personnes aiment'}`;
    const liked = Boolean(metrics.liked);
    latestLikeMetrics = { likes, liked };
    document.querySelectorAll('[data-matrix-like-count]').forEach((element) => {
      element.textContent = label;
    });
    document.querySelectorAll('[data-matrix-like]').forEach((button) => {
      button.setAttribute('aria-pressed', String(liked));
      button.classList.toggle('is-liked', liked);
    });
  };

  const refreshCalculatorLikes = async () => {
    const repository = window.cidSocialRepository;
    if (!repository?.getPostMetrics) return;
    try {
      const metrics = await repository.getPostMetrics(CALCULATOR_LIKE_KEY);
      renderLikeMetrics(metrics);
      setLikeStatus('');
    } catch (error) {
      console.warn('Compteur de likes de la calculatrice indisponible', error);
      setLikeStatus('Compteur momentanément indisponible.', true);
    }
  };

  const startCalculatorLikeRealtime = async () => {
    if (likeRealtimeCleanup || !window.cidSocialRepository?.subscribeToFeed) return;
    try {
      likeRealtimeCleanup = await window.cidSocialRepository.subscribeToFeed((event) => {
        const payload = event?.payload || {};
        const row = payload.new || payload.old || {};
        if (
          String(row.draw_id || '') !== CALCULATOR_LIKE_KEY
          && payload.eventType !== 'DELETE'
        ) return;
        refreshCalculatorLikes().catch(() => {});
      });
    } catch (error) {
      // Realtime is an enhancement; refresh on navigation/visibility remains
      // available when an older Supabase deployment has no publication.
      console.warn('Synchronisation temps réel du like indisponible', error);
    }
  };

  const refreshPlusOffer = async (providedAccess = null) => {
    if (!plusButton) return;
    const access = providedAccess
      || await Promise.resolve(window.cidFeatureAccess?.refresh?.()).catch(() => null);
    if (!access || typeof access !== 'object') {
      plusButton.disabled = true;
      plusButton.textContent = 'Déchiffrement avancé indisponible';
      plusButton.classList.remove('is-access-active', 'cid-buy-button');
      if (plusDescription) {
        plusDescription.textContent = 'Configuration des accès indisponible.';
      }
      return null;
    }
    const rule = access?.rules?.find((item) => (
      String(item?.feature_key || item?.featureKey || '').trim().toLowerCase()
        === 'tableaux-dechiffrement-plus'
    ));
    if (!rule || rule.enabled === false) {
      // No active rule means the administrator removed the lock. The feature
      // stays available without an unlock transaction.
      plusButton.disabled = false;
      plusButton.textContent = 'Déchiffrer maintenant';
      plusButton.classList.remove('cid-buy-button', 'is-access-active');
      if (plusDescription) {
        plusDescription.textContent = 'Les 10 numéros calculés sont utilisés par défaut ; remplacez-les si vous préférez saisir votre propre sélection.';
      }
      return {
        featureIsActive: true,
        balanceIsSufficient: true,
        required: 0,
        current: 0,
        currency: 'tokens'
      };
    }
    const currency = rule.unlock_currency === 'stars' ? 'stars' : 'tokens';
    const required = Math.max(0, Math.trunc(Number(
      currency === 'tokens' ? rule.required_tokens : rule.required_stars
    ) || 0));
    const current = Math.max(0, Math.trunc(Number(access?.[currency]) || 0));
    const featureIsActive = window.cidFeatureAccess?.has?.(
      'tableaux-dechiffrement-plus'
    ) === true;
    const balanceIsSufficient = required === 0 || current >= required;
    const durationDays = accessDurationDays(rule);
    const durationLabel = `${durationDays} jour${durationDays === 1 ? '' : 's'}`;
    plusButton.disabled = false;
    if (featureIsActive) {
      plusButton.classList.remove('cid-buy-button');
      plusButton.classList.add('is-access-active');
      plusButton.innerHTML = '<span>Déchiffrer maintenant</span>';
      plusButton.setAttribute(
        'aria-label',
        'Déchiffrer maintenant — accès actif'
      );
    } else if (required > 0 && balanceIsSufficient) {
      plusButton.classList.add('cid-buy-button');
      plusButton.classList.remove('is-access-active');
      plusButton.innerHTML = '<span>Débloquer</span>';
      plusButton.setAttribute(
        'aria-label',
        `Débloquer le déchiffrement avancé — coût ${required} ${
          currency === 'tokens' ? 'jetons' : 'étoiles'
        }`
      );
    } else {
      plusButton.classList.toggle('cid-buy-button', required > 0);
      plusButton.classList.remove('is-access-active');
      plusButton.innerHTML = required > 0
        ? `<span class="cid-token-icon" aria-hidden="true"></span><span>Achat</span><span class="cid-inline-cost" aria-hidden="true">${required}</span>`
        : '<span>Déchiffrement avancé</span>';
      plusButton.setAttribute('aria-label', required > 0
        ? `Achat du déchiffrement avancé — coût ${required}`
        : 'Déchiffrement avancé');
    }
    if (plusDescription) {
      plusDescription.textContent = featureIsActive
        ? `Accès actif : cliquez sur « Déchiffrer maintenant » pour analyser les numéros saisis — validité : ${durationLabel}.`
        : required > 0 && balanceIsSufficient
          ? `Votre solde est suffisant. Confirmez le déblocage de l’analyse pour ${required} ${currency === 'tokens' ? 'jetons' : 'étoiles'} — validité : ${durationLabel}.`
          : required > 0
            ? `Débloquez d’abord la recherche de correspondances pour les numéros calculés ou votre sélection manuelle — coût : ${required} ${currency === 'tokens' ? 'jetons' : 'étoiles'} · validité : ${durationLabel} à partir de la confirmation.`
            : `Les 10 numéros calculés sont utilisés par défaut ; les appels extérieurs fortement soutenus sont classés à part — validité : ${durationLabel}.`;
    }
    return {
      featureIsActive,
      balanceIsSufficient,
      required,
      current,
      currency
    };
  };

  const detectCodeAndEvent = () => {
    const parser = window.parseMatrixProgramme;
    if (typeof parser !== 'function' || !input?.value.trim()) return false;

    let parsed;
    try {
      parsed = parser(input.value);
    } catch (_) {
      return false;
    }

    const records = Array.isArray(parsed?.records)
      ? parsed.records.filter(Boolean)
      : [];
    if (!records.length) return false;

    /*
     * Un programme copié depuis la Matrice contient normalement un seul
     * bloc. Dans le cas de plusieurs blocs, on utilise le premier afin de
     * remplir les champs sans demander une saisie manuelle.
     */
    const record = records[0];
    const detectedCode = String(record.code || '')
      .replace(/\D/g, '')
      .slice(0, 3);
    const detectedEvent = String(record.event || '')
      .replace(/\D/g, '')
      .slice(0, 4);
    let detected = false;

    if (detectedCode && codeInput && codeInput.value.trim() !== detectedCode) {
      codeInput.value = detectedCode;
      detected = true;
    }
    if (detectedEvent && eventInput && eventInput.value.trim() !== detectedEvent) {
      eventInput.value = detectedEvent;
      detected = true;
    }

    if (detected) {
      setStatus('Code et Event détectés automatiquement.');
    }
    return detected;
  };

  const formatManualPlusNumbers = (value, { completeLastNumber = false } = {}) => {
    const raw = String(value || '').trim();
    const tokens = raw.split(/[\s;,|/]+/).filter(Boolean);
    if (tokens.length && tokens.length <= 90 && tokens.every((token) => /^\d{1,2}$/.test(token))) {
      return tokens
        .slice(0, 90)
        .map((token) => completeLastNumber ? token.padStart(2, '0') : token)
        .join(' ');
    }

    let digits = raw.replace(/\D/g, '').slice(0, 180);
    if (completeLastNumber && digits.length % 2 === 1) {
      digits = `${digits.slice(0, -1)}0${digits.slice(-1)}`;
    }
    return (digits.match(/\d{1,2}/g) || []).join(' ');
  };

  const caretAfterManualDigits = (formatted, digitCount) => {
    if (digitCount <= 0) return 0;
    let seen = 0;
    for (let index = 0; index < formatted.length; index += 1) {
      if (!/\d/.test(formatted[index])) continue;
      seen += 1;
      if (seen >= digitCount) return index + 1;
    }
    return formatted.length;
  };

  const syncManualPlusNumbers = ({ completeLastNumber = false } = {}) => {
    if (!plusManualNumbers) return;
    const before = String(plusManualNumbers.value || '');
    const selectionStart = Number.isFinite(plusManualNumbers.selectionStart)
      ? plusManualNumbers.selectionStart
      : before.length;
    const digitsBefore = before
      .slice(0, selectionStart)
      .replace(/\D/g, '')
      .length;
    const formatted = formatManualPlusNumbers(before, { completeLastNumber });
    plusManualNumbers.value = formatted;
    const digitCount = Math.min(
      digitsBefore,
      formatted.replace(/\D/g, '').length
    );
    const caret = caretAfterManualDigits(formatted, digitCount);
    try {
      plusManualNumbers.setSelectionRange(caret, caret);
    } catch (_) {}
  };

  const readManualPlusNumbers = () => {
    const raw = String(plusManualNumbers?.value || '').trim();
    if (!raw) return null;

    const parts = raw
      .replace(/[;,|/]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length > 90 || parts.some((part) => !/^\d{1,2}$/.test(part))) {
      throw new Error('Saisissez de 1 à 90 numéros entre 01 et 90.');
    }

    const numbers = parts.map(Number);
    if (
      numbers.some((number) => number < 1 || number > 90) ||
      new Set(numbers).size !== numbers.length
    ) {
      throw new Error('Les numéros doivent être distincts et compris entre 01 et 90.');
    }

    return numbers;
  };

  const renderNumbers = (program) => {
    const numbers = Array.isArray(program?.ten_numbers)
      ? program.ten_numbers.map((value) => String(value)).slice(0, 10)
      : [];

    if (numbers.length !== 10) {
      setStatus('Le serveur n’a pas produit les 10 numéros attendus.', true);
      return;
    }

    list.innerHTML = '';
    const info = document.createElement('div');
    info.style.cssText = 'font-weight:800;margin:6px 0;color:#0A1840;';
    info.textContent = `${program.name || program.country || 'Matrice'} — 10 numéros proposés`;
    list.appendChild(info);

    const grid = document.createElement('div');
    grid.className = 'matrix-calc-number-grid';
    grid.style.cssText = [
      'display:grid',
      'grid-template-columns:repeat(5,1fr)',
      'gap:8px',
      'margin-top:8px',
      'align-items:center',
      'justify-items:center',
      'width:100%'
    ].join(';');

    numbers.forEach((value) => {
      const cell = document.createElement('div');
      cell.className = 'matrix-calc-number';
      cell.style.cssText = [
        'width:64px',
        'height:64px',
        'border-radius:10px',
        'background:#fff',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'border:2px solid #0962D6',
        'font-weight:900',
        'color:#0962D6',
        'font-size:18px',
        'box-sizing:border-box'
      ].join(';');
      cell.textContent = value;
      grid.appendChild(cell);
    });

    list.appendChild(grid);
    output.style.display = 'block';
    if (copyButton) copyButton.style.display = 'inline-flex';
    panel.dataset.lastResults = JSON.stringify(numbers);
    if (plusManualNumbers) {
      plusManualNumbers.value = numbers.map((value) => String(value).padStart(2, '0')).join(' ');
    }
    if (initialStep) initialStep.hidden = false;
    if (plusPanel) {
      plusPanel.style.display = 'block';
      plusPanel.hidden = false;
    }
    panel.classList.remove('matrix-calc-plus-active');
    if (plusOutput) {
      plusOutput.innerHTML = '';
      plusOutput.style.display = 'none';
    }
    setPlusStatus('');
    refreshPlusOffer().catch(() => {});
    setStatus('10 numéros calculés à partir des valeurs saisies.');
    openResultsModal(numbers, program);
  };

  const continueToPlusStep = () => {
    closeResultsModal();
    showPlusStep({ focus: true });
    setStatus('10 numéros prêts. Déchiffrement avancé est prêt.');
  };

  const renderPlus = (plus) => {
    if (!plusOutput) return;
    const calls = Array.isArray(plus?.calls) ? plus.calls : [];
    const highProbabilityCalls = Array.isArray(plus?.highProbabilityCalls)
      ? plus.highProbabilityCalls
      : [];
    plusOutput.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:900;color:#7A4700;margin-bottom:8px;';
    heading.textContent = calls.length || highProbabilityCalls.length
      ? 'Déchiffrement avancé — ' + calls.length + ' groupes les mieux classés (3 couples, 2 triplets, 1 quadruplet max)'
      : 'Aucun croisement fort trouvé pour cette sélection.';
    plusOutput.appendChild(heading);

    if (highProbabilityCalls.length) {
      const section = document.createElement('section');
      section.style.cssText = 'display:grid;gap:6px;margin-top:10px;';
      const sectionHeading = document.createElement('div');
      sectionHeading.style.cssText = 'font-weight:900;color:#7A4700;';
      sectionHeading.textContent = `Top candidats extérieurs fortement soutenus (${highProbabilityCalls.length})`;
      section.appendChild(sectionHeading);
      highProbabilityCalls.forEach((call) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:9px 10px;border-radius:8px;background:#fff4dc;border:1px solid rgba(171,103,0,0.3);color:#513100;font-weight:800;';
        const callers = Array.isArray(call.callers) ? call.callers : [];
        const methods = Array.isArray(call.methods) ? call.methods : [];
        const methodLabels = {
          'miroir-impair': 'Miroir impair',
          kanta: 'Kanta',
          'complement-90': 'Complément à 90',
          'complement-99': 'Complément à 99',
          intervalle: 'Intervalle',
          multiplication: 'Multiplication',
          addition: 'Addition',
          soustraction: 'Soustraction'
        };
        const expressions = Array.isArray(call.expressions) ? call.expressions : [];
        const support = Number(call.support) || callers.length;
        const total = Number(call.matrixCount) || 10;
        const percent = Number(call.supportPercent) || Math.round(support / total * 100);
        const methodCount = Number(call.methodCount) || methods.length;
        const repeatedRelations = Number(call.repeatedRelations) || expressions.length;
        row.textContent = `${call.confidence || 'Forte correspondance'} : ${String(call.number || '').padStart(2, '0')} — appelé par ${callers.map((value) => String(value).padStart(2, '0')).join(' · ')} — appui ${support}/${total} (${percent} %), ${methodCount} méthode(s), ${repeatedRelations} relation(s)${methods.length ? ` · ${methods.map((method) => methodLabels[method] || method).join(', ')}` : ''}${expressions.length ? ` · ${expressions.join(' ; ')}` : ''}`;
        section.appendChild(row);
      });
      plusOutput.appendChild(section);
    }

    const categories = [
      { label: 'Couples', matches: (call) => call.label === 'Couple' },
      { label: 'Triplets puissants', matches: (call) => call.label === 'Triplet puissant' },
      { label: 'Triplets', matches: (call) => call.label === 'Triplet' },
      { label: 'Quadruplets', matches: (call) => call.label === 'Quadruplet' },
      {
        label: 'Autres groupes',
        matches: (call) => !['Couple', 'Triplet puissant', 'Triplet', 'Quadruplet'].includes(call.label)
      }
    ];
    const groups = categories.map((category) => ({
      label: category.label,
      calls: calls.filter(category.matches)
    })).filter((group) => group.calls.length);
    const operationLabels = {
      'miroir-impair': 'Miroir impair',
      kanta: 'Kanta (+45 / -45)',
      'complement-90': 'Complément à 90',
      'complement-90-puissant': 'Triplet puissant — complément à 90',
      'complement-99': 'Complément à 99',
      intervalle: 'Intervalle',
      multiplication: 'Multiplication',
      addition: 'Addition',
      soustraction: 'Soustraction',
      hub: 'Correspondance croisée',
      'coincidence-forte': 'Clé forte',
      croisement: 'Convergence entre méthodes'
    };

    groups.forEach((group) => {
      const section = document.createElement('section');
      section.style.cssText = 'display:grid;gap:6px;margin-top:10px;';
      const sectionHeading = document.createElement('div');
      sectionHeading.style.cssText = 'font-weight:900;color:#513100;';
      sectionHeading.textContent = group.label + ' (' + group.calls.length + ')';
      section.appendChild(sectionHeading);

      group.calls.forEach((call) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 10px;border-radius:8px;background:#fff;border:1px solid rgba(171,103,0,0.16);color:#513100;font-weight:800;';
        const values = Array.isArray(call.numbers)
          ? call.numbers
          : Array.isArray(call.triplet)
            ? call.triplet
            : call.caller != null && call.called != null
              ? [call.caller, call.called]
              : [];
        const label = call.label || (
          values.length === 2
            ? 'Couple'
            : values.length === 3
              ? 'Triplet'
              : values.length === 4
                ? 'Quadruplet'
                : values.length + ' numéros liés'
        );
        const formulas = Array.isArray(call.expressions)
          ? call.expressions.filter(Boolean).join(' ; ')
          : '';
        const operation = operationLabels[call.operation] || '';
        const explanation = formulas
          ? ' — ' + (operation ? operation + ' : ' : '') + formulas
          : '';
        const methods = Array.isArray(call.methods) ? call.methods : [];
        const methodSummary = methods.length
          ? ' — Méthodes : ' + methods.map((method) => operationLabels[method] || method).join(', ')
          : '';
        const confidence = call.confidence ? call.confidence + ' · ' : '';
        const sourceSupport = Number(call.supportCount) > 0
          ? ', ' + call.supportCount + '/' + call.supportTotal + ' numéros sources'
          : '';
        const crossScore = Number(call.crossScore) > 0
          ? ' — Score de convergence : ' + call.crossScore + ' (' + call.methodCount + ' méthodes, ' + call.evidenceCount + ' preuves, ' + call.inputSupport + ' numéros saisis' + sourceSupport + ')'
          : '';
        row.textContent = values.length
          ? confidence + label + ' : ' + values.map((value) =>
              String(value).padStart(2, '0')
            ).join(' · ') + explanation + methodSummary + crossScore
          : 'Groupe indisponible.';
        section.appendChild(row);
      });
      plusOutput.appendChild(section);
    });
    plusOutput.style.display = 'block';
  };

  openButton?.addEventListener('click', () => {
    panel.style.display = 'block';
    if (!panel.dataset.lastResults) showInitialStep();
    panel.scrollTop = 0;
    panel.scrollLeft = 0;
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo(0, 0);
    refreshPlusOffer().catch(() => {});
    refreshCalculatorLikes().catch(() => {});
    startCalculatorLikeRealtime().catch(() => {});
  });

  document.addEventListener('click', async (event) => {
    const clickedLike = event.target.closest?.('[data-matrix-like]');
    if (!clickedLike || likeOperationPending) return;
    const repository = window.cidSocialRepository;
    if (!repository?.togglePostLike) {
      setLikeStatus('Le bouton J’aime est momentanément indisponible.', true);
      return;
    }

    event.preventDefault();
    likeOperationPending = true;
    document.querySelectorAll('[data-matrix-like]').forEach((button) => {
      button.disabled = true;
    });
    setLikeStatus('Enregistrement…');
    try {
      await repository.togglePostLike(CALCULATOR_LIKE_KEY);
      await refreshCalculatorLikes();
    } catch (error) {
      setLikeStatus(
        error?.message || 'Connectez-vous pour aimer cette calculatrice.',
        true,
      );
    } finally {
      likeOperationPending = false;
      document.querySelectorAll('[data-matrix-like]').forEach((button) => {
        button.disabled = false;
      });
    }
  });

  input?.addEventListener('input', detectCodeAndEvent);
  input?.addEventListener('paste', () => {
    window.setTimeout(detectCodeAndEvent, 0);
  });

  [
    [codeInput, 3],
    [eventInput, 4]
  ].forEach(([field, maxLength]) => {
    field?.addEventListener('input', () => {
      const normalized = String(field.value || '')
        .replace(/\D/g, '')
        .slice(0, maxLength);
      if (field.value !== normalized) field.value = normalized;
    });
  });

  clearButton?.addEventListener('click', clearCalculator);
  backButton?.addEventListener('click', () => {
    showInitialStep({ focus: true });
    setStatus('Vous pouvez refaire un calcul avec une nouvelle matrice.');
  });

  plusManualClear?.addEventListener('click', () => {
    if (!plusManualNumbers) return;
    plusManualNumbers.value = '';
    plusManualNumbers.dispatchEvent(new Event('input', { bubbles: true }));
    plusManualNumbers.focus({ preventScroll: true });
  });
  plusManualNumbers?.addEventListener('input', () => {
    syncManualPlusNumbers();
  });
  plusManualNumbers?.addEventListener('blur', () => {
    syncManualPlusNumbers({ completeLastNumber: true });
  });

  resultsModalClose?.addEventListener('click', closeResultsModal);
  resultsModalDone?.addEventListener('click', continueToPlusStep);
  resultsModal?.addEventListener('click', (event) => {
    if (event.target === resultsModal) closeResultsModal();
  });
  document.addEventListener('keydown', (event) => {
    if (!resultsModal || resultsModal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResultsModal();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [resultsModalClose, resultsModalDone].filter(Boolean);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus({ preventScroll: true });
    }
  });

  keyboardFields.forEach((field) => {
    field.addEventListener('focus', () => {
      setKeyboardMode(true, field);
    });
    field.addEventListener('blur', () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (!activeElement || !panel.contains(activeElement)) {
          setKeyboardMode(false);
        }
      }, 180);
    });
  });

  runButton.addEventListener('click', async () => {
    const operationEpoch = ++calculationEpoch;
    runButton.disabled = true;
    setStatus('Déchiffrement sécurisé en cours…');

    try {
      const parsed = typeof window.parseMatrixProgramme === 'function'
        ? window.parseMatrixProgramme(input?.value || '')
        : { records: [], errors: [] };
      const record = Array.isArray(parsed.records) ? parsed.records[0] : null;
      const normalizedCode = String(codeInput?.value || '').trim();
      const normalizedEvent = String(eventInput?.value || '').trim();
      const europeanDate = String(record?.date || '').match(
        /^(\d{2})-(\d{2})-(\d{4})$/
      );
      const programmeDate = europeanDate
        ? `${europeanDate[3]}-${europeanDate[2]}-${europeanDate[1]}`
        : undefined;
      const response = await window.invokeDechiffrement?.({
        countryName: record?.name || undefined,
        programmeDate,
        matrix: record?.matrix || undefined,
        keyboard: record?.keyboard || undefined,
        cerveau: record?.brain || undefined,
        code: normalizedCode || record?.code || undefined,
        event: normalizedEvent || record?.event || undefined,
        saveHistory: true
      });
      if (!response?.program) {
        throw new Error('Le serveur de déchiffrement est indisponible.');
      }

      if (operationEpoch !== calculationEpoch) return;
      renderNumbers(response.program);
      if (response.fallback) {
        setStatus(
          'Résultats affichés. La synchronisation de la base serveur est momentanément indisponible.',
          true
        );
      } else if (response.existing) {
        setStatus('Cette Matrice existe déjà : les mêmes résultats ont été réutilisés.');
      } else if (response.history?.saved) {
        setStatus('Résultats validés et enregistrés dans votre historique.');
      }
    } catch (error) {
      console.warn('Lecture du déchiffrement impossible', error);
      setStatus(error?.message || 'Le calcul de la Matrice est indisponible.', true);
    } finally {
      runButton.disabled = false;
    }
  });

  plusButton?.addEventListener('click', async () => {
    const operationEpoch = ++calculationEpoch;
    plusButton.disabled = true;
    setPlusStatus('Vérification des numéros…');
    try {
      const selectedNumbers = readManualPlusNumbers();
      if (!selectedNumbers) {
        throw new Error('Saisissez les numéros à analyser, ou calculez la Matrice pour préremplir automatiquement les 10 numéros.');
      }
      setPlusStatus('Vérification du déblocage…');
      const unlock = window.cidUnlockFeature;
      if (typeof unlock !== 'function') {
        throw new Error('Le service de déblocage est indisponible.');
      }
      const access = await Promise.resolve(
        window.cidFeatureAccess?.refresh?.()
      ).catch(() => null);
      if (!access || typeof access !== 'object') {
        throw new Error('Configuration des accès indisponible.');
      }
      const rule = access?.rules?.find((item) => (
        String(item?.feature_key || item?.featureKey || '').trim().toLowerCase()
          === 'tableaux-dechiffrement-plus'
      ));
      const activeRule = rule?.enabled === false ? null : rule;
      if (activeRule && !window.cidFeatureAccess?.has?.(
        'tableaux-dechiffrement-plus'
      )) {
        const decision = await requestPlusUnlockConfirmation({
          rule: activeRule,
          access,
          trigger: plusButton
        });
        if (decision?.buyTokens) {
          const currency = decision.currency === 'stars' ? 'stars' : 'tokens';
          const missing = Math.max(1, Math.trunc(Number(decision.missing) || 0));
          window.cidOpenBalancePanel?.({
            currency,
            quantity: missing,
            requiredTokens: currency === 'tokens'
              ? Number(activeRule.required_tokens) || 0
              : undefined,
            currentTokens: currency === 'tokens'
              ? Number(access.tokens) || 0
              : undefined,
            requiredStars: currency === 'stars'
              ? Number(activeRule.required_stars) || 0
              : undefined,
            currentStars: currency === 'stars'
              ? Number(access.stars) || 0
              : undefined,
            planSlug: 'tableaux-dechiffrement-plus',
            planName: 'Déchiffrement avancé',
            durationDays: Number(activeRule.duration_days) || 30,
            returnToTableaux: true,
            sectionId: 'dechiffrement-mt',
            notice: `Il vous manque ${formatAccessAmount(missing)} ${
              currency === 'tokens' ? 'jetons' : 'étoiles'
            } pour utiliser le Déchiffrement avancé.`,
            noticeKind: 'error'
          });
          setPlusStatus('Achetez les unités manquantes pour activer le service.', true);
          return;
        }
        if (!decision?.confirmed) {
          setPlusStatus('Déblocage nécessaire pour utiliser cette analyse.', true);
          return;
        }

        const unlocked = await unlock(
          'tableaux-dechiffrement-plus',
          {
            label: 'Déchiffrement avancé',
            requiredTokens: Number(activeRule.required_tokens) || 0,
            requiredStars: Number(activeRule.required_stars) || 0
          }
        );
        if (!unlocked?.ok) {
          setPlusStatus(
            unlocked?.error || 'Déblocage impossible.',
            true
          );
          return;
        }
      }

      const parsed = typeof window.parseMatrixProgramme === 'function'
        ? window.parseMatrixProgramme(input?.value || '')
        : { records: [] };
      const record = Array.isArray(parsed.records) ? parsed.records[0] : null;
      const response = await window.invokeDechiffrement?.({
        action: 'plus',
        numbers: selectedNumbers,
        name: record?.name || 'Matrice manuelle',
        date: record?.date || undefined,
        matrix: record?.matrix || undefined,
        keyboard: record?.keyboard || undefined,
        cerveau: record?.brain || undefined,
        code: String(codeInput?.value || '').trim() || record?.code || undefined,
        event: String(eventInput?.value || '').trim() || record?.event || undefined,
        saveHistory: true
      });
      if (!response?.plus) {
        throw new Error('Le serveur Déchiffrement avancé n’a pas retourné d’analyse.');
      }
      if (operationEpoch !== calculationEpoch) return;
      renderPlus(response.plus);
      setPlusStatus('Déchiffrement avancé terminé.');
    } catch (error) {
      console.warn('Analyse Déchiffrement avancé impossible', error);
      const message = error?.name === 'DechiffrementTimeoutError'
        ? 'Votre accès est bien actif : aucun nouvel achat n’est nécessaire. Le serveur de calcul avancé ne répond pas actuellement ; réessayez plus tard.'
        : error?.message || 'Déchiffrement avancé indisponible.';
      setPlusStatus(message, true);
    } finally {
      plusButton.disabled = false;
    }
  });

  window.addEventListener('cid:feature-access-changed', (event) => {
    refreshPlusOffer(event.detail || null).catch(() => {});
  });
  /*
   * A Paystack top-up only credits the account; it must never debit the
   * feature automatically. Re-read the authoritative access snapshot so the
   * button changes from "Achat" to "Débloquer" as soon as the new balance is
   * available, or to the active state when the feature was already unlocked.
   */
  window.addEventListener('cid:payment-validated', async () => {
    const access = await Promise.resolve(
      window.cidFeatureAccess?.refresh?.()
    ).catch(() => null);
    const offer = await refreshPlusOffer(access).catch(() => null);
    if (access && plusStatus && offer) {
      if (offer.featureIsActive) {
        setPlusStatus('Accès actif : le déchiffrement avancé est débloqué.', false);
      } else if (offer.balanceIsSufficient) {
        setPlusStatus(
          'Solde actualisé. Cliquez sur « Débloquer » pour confirmer l’activation.',
          false
        );
      } else {
        setPlusStatus(
          `Solde actualisé. Il manque encore ${formatAccessAmount(
            Math.max(0, offer.required - offer.current)
          )} ${offer.currency === 'tokens' ? 'jetons' : 'étoiles'}.`,
          true
        );
      }
    }
  });
  window.addEventListener('cid:home-view-restored', () => {
    refreshCalculatorLikes().catch(() => {});
  });
  window.addEventListener('cid:auth-sync', () => {
    refreshCalculatorLikes().catch(() => {});
    startCalculatorLikeRealtime().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCalculatorLikes().catch(() => {});
  });
  window.addEventListener('focus', () => {
    refreshCalculatorLikes().catch(() => {});
  });
  window.addEventListener('load', () => {
    refreshCalculatorLikes().catch(() => {});
    startCalculatorLikeRealtime().catch(() => {});
  }, { once: true });

  const likeSurfaceObserver = new MutationObserver(() => {
    if (document.querySelector('[data-matrix-like]')) {
      renderLikeMetrics(latestLikeMetrics);
    }
  });
  likeSurfaceObserver.observe(document.body, { childList: true, subtree: true });

  copyButton?.addEventListener('click', async () => {
    const values = panel.dataset.lastResults;
    if (!values) return;
    try {
      await navigator.clipboard.writeText(JSON.parse(values).join('\n'));
      setStatus('Résultats copiés.');
    } catch (_) {
      setStatus('Impossible de copier les résultats.', true);
    }
  });

  // Navigation can leave the calculator while a virtual keyboard or the
  // results dialog is active. The home route calls this hook to release every
  // calculator-owned scroll lock before it restores the feed.
  window.__cidReleaseCalculatorScrollLocks = () => {
    closeResultsModal();
    document.body.classList.remove('matrix-keyboard-open', 'matrix-calc-modal-open');
    panel.classList.remove('matrix-keyboard-open');
  };
})();
