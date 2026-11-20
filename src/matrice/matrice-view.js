/*
 * Matrice view controller.
 *
 * This is intentionally framework-free because the project is served as static
 * files. It owns the Matrice transition and stops the legacy click handlers
 * from competing with it. Navigation stays in the current document: no
 * window.location assignment and no full-page reload.
 */

(() => {
  let resultsPromise = null;
  let viewRequest = 0;
  let selectedCountry = null;
  let selectedProgram = null;
  let matrixIllustrationCleanup = null;
  /*
   * Isolated preview session (Anticipé). It holds a server payload for a
   * future date and is used only by this view instance: it never replaces
   * window.generatedResults, the localStorage cache or the Croix state.
   */
  let previewState = null;
  let activeProgrammeDate = '';
  const activeResults = () => (
    previewState ? previewState.results : window.generatedResults
  );

  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const ti = (key, values = {}, fallback = key) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
    t(key, fallback)
  );

  const DEFAULT_COUNTRY_ORDER = [
    "Côte d'Ivoire",
    'Niger',
    'Ghana',
    'Bénin',
    'Sénégal',
    'Togo'
  ];

  try {
    const stateBridge = {
      selectedCountry: {
        configurable: true,
        get: () => selectedCountry,
        set: (value) => { selectedCountry = value; }
      },
      selectedProgram: {
        configurable: true,
        get: () => selectedProgram,
        set: (value) => { selectedProgram = value; }
      },
      // Compatibility alias for older code that read the previous state name.
      selectedMatriceCountry: {
        configurable: true,
        get: () => selectedCountry,
        set: (value) => { selectedCountry = value; }
      }
    };
    Object.defineProperties(window, stateBridge);
  } catch (error) {
    console.warn('Unable to expose Matrice state bridge', error);
  }

  const normalize = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const matrixBannerContext = (date) => {
    const country = String(
      window.cidSmartCountry?.get?.()
        || window.__cidUserCountry
        || localStorage.getItem('firstVisitCountry')
        || ''
    ).trim();
    const options = country === "Côte d'Ivoire"
      ? [ti('matrix.special', { country }, 'Spécial {{country}}'), t('matrix.ivorianKey', 'Clé du jour ivoirienne'), t('matrix.custom', 'Votre matrice personnalisée')]
      : country === 'Bénin'
        ? [t('rejected.beninFestival', 'Bonne fête Bénin'), t('matrix.beninKey', 'Clé du jour béninoise'), t('matrix.custom', 'Votre matrice personnalisée')]
        : country && country !== 'Tous'
          ? [ti('matrix.special', { country }, 'Spécial {{country}}'), t('matrix.keyOfDay', 'Clé du jour'), t('matrix.custom', 'Votre matrice personnalisée')]
          : [t('matrix.keyOfDay', 'Clé du jour'), t('matrix.personalized', 'La matrice qui vous ressemble'), t('matrix.edition', 'Édition personnalisée')];
    const hash = Array.from(`${date}:${country}`)
      .reduce((total, char) => total + char.charCodeAt(0), 0);
    return options[hash % options.length];
  };

  const matrixBannerInk = (hex) => {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return '#ffffff';
    const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
    const luminance = channels
      .map((channel) => channel <= .03928
        ? channel / 12.92
        : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance > .48 ? '#10233f' : '#ffffff';
  };

  const ensureStyles = () => {
    if (document.getElementById('matriceViewStyles')) return;
    const style = document.createElement('style');
    style.id = 'matriceViewStyles';
    style.textContent = `
      .matrice-loader,
      .matrice-error {
        display:flex; align-items:center; justify-content:center; gap:10px;
        min-height:96px; margin:12px auto; padding:18px; box-sizing:border-box;
        border-radius:12px; color:#0A1840; background:#fff;
        border:1px solid rgba(9,98,214,.1);
      }
      .matrice-error { flex-direction:column; text-align:center; }
      .matrice-error p { margin:0; }
      .matrice-loader-dot {
        width:12px; height:12px; border-radius:50%; background:#0962D6;
        animation:matrice-loader-pulse 900ms ease-in-out infinite alternate;
      }
      #matrixPageTitle {
        margin:0 auto 10px;
        text-align:center;
        color:#0A1840;
        line-height:1.2;
      }
      #countryButtons.matrix-country-buttons {
        position:static;
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        justify-content:center;
        gap:10px;
        width:min(100%, 920px);
        max-width:920px;
        margin:0 auto;
        padding:0 18px;
        overflow:visible;
        box-sizing:border-box;
      }
      #countryButtons.matrix-country-buttons .country-filter-btn {
        flex:0 0 auto;
        margin:0;
        min-width:112px;
        min-height:44px;
      }
      .matrix-copy-button {
        display:block;
        width:min(100% - 36px, 440px);
        margin:16px auto;
      }
      .matrix-actions {
        width:100%;
        display:flex;
        justify-content:center;
      }
      #results.matrix-results {
        width:min(100%, 1200px);
        margin:0 auto;
        box-sizing:border-box;
      }
      .matrix-level {
        width:100%;
        margin:0;
        padding:16px 0 120px;
        box-sizing:border-box;
      }
      .matrix-level-header {
        display:flex;
        align-items:center;
        gap:8px;
        width:100%;
        margin:0 0 16px;
      }
      .matrix-back-button {
        display:inline-flex;
        align-items:center;
        gap:4px;
        flex:0 0 auto;
        min-height:44px;
        margin:0;
        padding:8px 4px 8px 0;
        border:0;
        background:transparent;
        color:#0962D6;
        font:inherit;
        font-weight:800;
        cursor:pointer;
      }
      .matrix-back-button svg {
        width:20px;
        height:20px;
        fill:none;
        stroke:currentColor;
        stroke-linecap:round;
        stroke-linejoin:round;
        stroke-width:2.25;
      }
      .matrix-level-title {
        min-width:0;
        margin:0;
        color:#0A1840;
        font-size:clamp(18px, 4vw, 24px);
        line-height:1.2;
        text-align:left;
      }
      .matrix-country-copy,
      .matrix-program-copy,
      .matrix-program-slot {
        width:100%;
        box-sizing:border-box;
        border-radius:12px;
        font:inherit;
        cursor:pointer;
      }
      .matrix-country-copy,
      .matrix-program-copy {
        display:block;
        margin:0 0 20px;
        padding:13px 16px;
        border:0;
        background:#0962D6;
        color:#fff;
        font-weight:800;
      }
      .matrix-program-slots {
        display:flex;
        flex-direction:column;
        gap:10px;
      }
      .matrix-program-slot {
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        gap:4px;
        padding:14px 16px;
        border:1px solid rgba(9,98,214,.14);
        background:#fff;
        color:#0A1840;
        text-align:left;
        box-shadow:0 5px 16px rgba(10,24,64,.05);
      }
      .matrix-program-slot strong { font-size:16px; }
      .matrix-program-slot span { color:#5c667a; font-size:13px; }
      .matrix-program-details {
        display:flex;
        flex-direction:column;
        gap:12px;
        padding:16px;
        border:1px solid rgba(9,98,214,.12);
        border-radius:12px;
        background:#fff;
        color:#0A1840;
      }
      .matrix-detail-row {
        display:flex;
        justify-content:space-between;
        gap:16px;
        padding-bottom:10px;
        border-bottom:1px solid #edf1f7;
      }
      .matrix-detail-row:last-child { border-bottom:0; padding-bottom:0; }
      .matrix-detail-row strong { text-align:right; white-space:pre-line; }
      .matrix-detail-values {
        display:grid;
        grid-template-columns:1fr;
        gap:3px;
        white-space:normal !important;
      }
      .matrix-detail-values > span {
        display:block;
        min-height:1.25em;
      }
      .matrix-empty {
        margin:0;
        padding:16px;
        border-radius:12px;
        color:#5c667a;
        background:#f7f9fc;
      }
      @media (max-width:520px) {
        .matrix-level { padding-inline:14px; }
        .matrix-detail-row { flex-direction:column; gap:5px; }
        .matrix-detail-row strong { text-align:left; }
      }
      @keyframes matrice-loader-pulse {
        from { opacity:.35; transform:scale(.8); }
        to { opacity:1; transform:scale(1); }
      }`;
    document.head.appendChild(style);
  };

  const isMatriceTarget = (target) => {
    const element = target instanceof Element ? target.closest('button, a, [role="button"], .category-item, .plant-btn') : null;
    if (!element) return false;
    return element.id === 'submenuMatrice' ||
      element.id === 'plantMatriceBtn' ||
      (element.id !== 'categoryCategoriesButton' && normalize(element.textContent) === 'matrice' &&
        (element.closest('#categoriesView') || element.classList.contains('plant-btn')));
  };

  const setVisible = (id, display, hidden) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.style.display = display;
    element.hidden = hidden;
    element.setAttribute('aria-hidden', String(hidden));
  };

  const showLocalError = (message, retry) => {
    const results = document.getElementById('results');
    if (!results) return;
    results.style.display = '';
    results.hidden = false;
    results.setAttribute('aria-busy', 'false');
    clearMatrixContent();

    const panel = document.createElement('div');
    panel.className = 'matrice-error';
    panel.setAttribute('role', 'alert');
    panel.innerHTML = `<p>${message}</p>`;

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'copy-button';
    retryButton.textContent = t('balance.retry', 'Réessayer');
    retryButton.addEventListener('click', () => {
      resultsPromise = null;
      retryButton.disabled = true;
      retry();
    });
    panel.appendChild(retryButton);
    results.appendChild(panel);
  };

  const showLocalLoader = () => {
    const results = document.getElementById('results');
    if (!results) return;
    results.style.display = '';
    results.hidden = false;
    results.setAttribute('aria-busy', 'true');
    clearMatrixContent();
    const loader = document.createElement('div');
    loader.className = 'matrice-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML = `
      <span class="matrice-loader-dot" aria-hidden="true"></span>
      <span>Préparation de la matrice…</span>`;
    results.appendChild(loader);
  };

  const clearMatrixContent = () => {
    const results = document.getElementById('results');
    if (results) {
      /*
       * #results is shared with Accueil. Keep the prepared feed and its
       * skeleton nodes mounted; only remove the transient Matrice children.
       */
      Array.from(results.children).forEach((child) => {
        if (
          child.id === 'cid-home-feed'
          || child.id === 'cid-home-skeleton'
          || child.id === 'cid-feed-loader'
        ) return;
        child.remove();
      });
      const feed = results.querySelector('#cid-home-feed');
      if (feed) {
        feed.hidden = true;
        feed.setAttribute('aria-hidden', 'true');
        feed.style.display = 'none';
      }
      results.setAttribute('aria-busy', 'false');
    }
    window.__matrixCopyResults = [];
  };

  // The daily illustration is mounted beside #matrixPageTitle, not inside
  // #results. Clearing the results surface alone therefore used to leave a
  // live SVG/image layer behind after leaving Matrice.
  const removeMatrixIllustration = () => {
    if (typeof matrixIllustrationCleanup === 'function') {
      matrixIllustrationCleanup();
      matrixIllustrationCleanup = null;
    }
    document.querySelectorAll(
      '#dailyMatrixIllustrationFrame, #dailyMatrixIllustration, ' +
      '.matrix-daily-illustration, .matrix-daily-illustration-frame'
    ).forEach((element) => element.remove());
  };

  const setMatrixState = (country, program) => {
    selectedCountry = country;
    selectedProgram = program;
    window.__matrixCopyResults = [];
  };

  const getProgramTime = (program) => {
    if (typeof program?.hour === 'number') return `${String(program.hour).padStart(2, '0')}h`;
    if (program?.time) return String(program.time);
    return 'Programme';
  };

  const getProgramsForCountry = (allResults, country) => {
    if (!Array.isArray(allResults)) return [];
    return country === 'Tous'
      ? allResults.filter(Boolean)
      : allResults.filter((program) => program && program.country === country);
  };

  const availableCountries = (results = activeResults()) => {
    const names = Array.isArray(results)
      ? results
        .map((program) => String(program?.country || '').trim())
        .filter(Boolean)
      : [];
    const present = new Set(names);
    const known = DEFAULT_COUNTRY_ORDER.filter(
      (country) => !names.length || present.has(country)
    );
    const additional = [...new Set(names)]
      .filter((country) => !DEFAULT_COUNTRY_ORDER.includes(country))
      .sort((left, right) => left.localeCompare(right, 'fr'));
    return [...known, ...additional, 'Tous'];
  };

  /*
   * Keep the familiar order for existing countries, then append every country
   * returned by the server. New administrator-configured countries therefore
   * appear without a front-end code change.
   */
  const renderMatrixCountryButtons = (results = activeResults()) => {
    const container = document.getElementById('countryButtons');
    if (!container) return;
    const selected = selectedCountry;
    const countries = availableCountries(results);
    const signature = `${window.cidTranslation?.current?.() || ''}|${countries.join('|')}`;
    /*
     * Same list as the one already painted: only sync the pressed state.
     * Rebuilding identical buttons on every open was a visible flash.
     */
    if (container.dataset.matrixCountrySignature === signature
      && container.childElementCount === countries.length) {
      container.querySelectorAll('.country-filter-btn').forEach((button) => {
        const active = button.dataset.country === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return;
    }
    container.dataset.matrixCountrySignature = signature;
    container.replaceChildren();
    countries.forEach((country) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'country-filter-btn';
      button.dataset.country = country;
      button.textContent = country;
      button.setAttribute('aria-pressed', String(country === selected));
      button.classList.toggle('active', country === selected);
      button.addEventListener('click', () => window.selectMatriceCountry?.(country));
      container.appendChild(button);
    });
  };

  const makeButton = (label, className, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  const ensureCopyAllButton = () => {
    let actions = document.getElementById('matrixActions');
    if (actions) return actions;
    const countryButtons = document.getElementById('countryButtons');
    if (!countryButtons) return null;
    actions = document.createElement('div');
    actions.id = 'matrixActions';
    actions.className = 'matrix-actions';
    actions.dataset.matriceOnly = 'true';
    const button = makeButton(
      'Copier toutes les matrices',
      'copy-button matrix-copy-button',
      () => {
        if (previewState) {
          copyText(previewState.results.map(formatProgramText).join('\n\n'), button);
          return;
        }
        window.copyAllResults?.();
      }
    );
    button.id = 'matrixCopyAllButton';
    button.setAttribute('aria-label', 'Copier toutes les matrices');
    actions.appendChild(button);
    countryButtons.insertAdjacentElement('afterend', actions);
    return actions;
  };

  const removeCopyAllButton = () => {
    document.getElementById('matrixActions')?.remove();
  };

  const makeBackButton = (label, onClick) => {
    const button = makeButton('', 'cid-back-button matrix-back-button', onClick);
    button.setAttribute('data-cid-back-button', 'true');
    button.setAttribute('aria-label', label);
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m15 18-6-6 6-6"></path>
      </svg>
      <span>${label}</span>
    `;
    return button;
  };

  const copyText = async (text, button) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      const original = button.textContent;
      button.textContent = t('account.copied', 'Copié');
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    } catch (error) {
      console.warn('Matrice copy failed', error);
    }
  };

  const formatDrawDate = (value) => {
    const date = String(value ?? '').trim();
    const isoMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;

    const dmyMatch = date.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) {
      return `${dmyMatch[1].padStart(2, '0')}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[3]}`;
    }
    return date;
  };

  const valuesAsLines = (values) => (
    Array.isArray(values)
      ? values.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
  );

  const formatProgramText = (program) => {
    const lines = [
      String(program.name || program.country || 'Programme').replace(/\s*Cidmap\s*$/i, '').trim(),
      formatDrawDate(program.date),
      'Matrice',
      ...valuesAsLines(program.matrix)
    ];

    if (Array.isArray(program.keyboard) && program.keyboard.length) {
      lines.push('Clavier', ...valuesAsLines(program.keyboard));
    }
    if (Array.isArray(program.cerveau) && program.cerveau.length) {
      lines.push('Cerveau', ...valuesAsLines(program.cerveau));
    }

    lines.push(`Code: ${program.code || ''}`, `Event: ${program.event || ''}`);

    // Keep the clipboard payload vertical and remove a legacy trailing marker
    // if one is ever present in the source data.
    return lines.join('\n').replace(/\nCidmap\s*$/i, '').trim();
  };

  const setResultsVisible = (visible) => {
    const results = document.getElementById('results');
    if (!results) return;
    results.classList.add('matrix-results');
    results.style.display = visible ? '' : 'none';
    results.hidden = !visible;
    results.setAttribute('aria-hidden', String(!visible));
  };

  const showMatrixChrome = (level) => {
    const title = document.getElementById('matrixPageTitle');
    const countriesContainer = document.getElementById('countryButtons');
    const copyAll = document.getElementById('matrixCopyAllButton');
    const showLevelOne = level === 1;
    document.body.classList.toggle('matrix-level-one', showLevelOne);
    if (title) {
      title.style.display = showLevelOne ? '' : 'none';
      title.hidden = !showLevelOne;
    }
    if (countriesContainer) {
      countriesContainer.style.display = showLevelOne ? 'flex' : 'none';
      countriesContainer.hidden = !showLevelOne;
    }
    if (copyAll) copyAll.style.display = showLevelOne ? 'block' : 'none';
    setResultsVisible(!showLevelOne);
  };

  const renderLevelOne = () => {
    ++viewRequest;
    setMatrixState(null, null);
    removeMatrixIllustration();
    showMatrixChrome(1);
    clearMatrixContent();

    const title = document.getElementById('matrixPageTitle');
    if (!title || document.getElementById('dailyMatrixIllustration')) return;
    const bannerDate = previewState?.date || activeProgrammeDate || '';
    const illustration = (bannerDate
      ? window.getDailyIllustration?.('matrix', bannerDate)
      : window.getDailyIllustration?.('matrix')) || (bannerDate ? { date: bannerDate } : null);

    const frame = document.createElement('div');
    frame.className = 'daily-illustration-frame matrix-daily-illustration matrix-daily-publication-frame';
    frame.id = 'dailyMatrixIllustrationFrame';
    frame.style.setProperty(
      '--daily-illustration-color',
      window.getDailyIllustrationColor?.(illustration?.date)
        || illustration?.color
        || '#2f73c5'
    );

    const visual = document.createElement('div');
    visual.id = 'dailyMatrixIllustration';
    visual.className = 'daily-publication-visual';
    frame.appendChild(visual);

    const paintVisual = (next = illustration) => {
      const date = bannerDate || next?.date || '';
      const dateObject = new Date(`${date}T12:00:00.000Z`);
      const weekday = Number.isNaN(dateObject.getTime())
        ? ''
        : window.cidTranslation?.formatDate?.(dateObject, {
          weekday: 'long',
          timeZone: 'Africa/Abidjan'
        }) || dateObject.toLocaleDateString(
          window.cidTranslation?.current?.() || document.documentElement?.lang || 'fr',
          {
          weekday: 'long',
          timeZone: 'Africa/Abidjan'
          }
        );
      const capitalizedWeekday = weekday
        ? weekday.charAt(0).toUpperCase() + weekday.slice(1)
        : '';
      const fullDate = Number.isNaN(dateObject.getTime())
        ? date
        : window.cidTranslation?.formatDate?.(dateObject, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Africa/Abidjan'
        }) || dateObject.toLocaleDateString(
          window.cidTranslation?.current?.() || document.documentElement?.lang || 'fr',
          {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Africa/Abidjan'
          }
        );
      const configuredColor = window.getDailyIllustrationColor?.(date)
        || next?.color
        || '#2f73c5';
      const themeColor = window.getOfficialPublicationColor?.(date)
        || configuredColor;
      visual.style.setProperty(
        '--daily-publication-color',
        themeColor
      );
      visual.style.setProperty('--daily-publication-ink', matrixBannerInk(themeColor));
      visual.innerHTML = `
        <div class="daily-banner-copy">
          <span class="daily-banner-brand"><span class="daily-banner-brand-mark">✦</span> CIDMAP</span>
          <span class="daily-publication-eyebrow">${t('matrix.dayProgram', 'Programme du jour')}</span>
          <strong>${ti('matrix.titleForDay', { day: capitalizedWeekday }, 'Matrice {{day}}')}</strong>
          <span class="daily-banner-context">${matrixBannerContext(date)}</span>
          <small>${fullDate} · ${t('matrix.today', 'Matrice du jour')}</small>
          <span class="daily-banner-contact"><span aria-hidden="true">◌</span> ${t('matrix.dailyKey', 'Votre clé du jour')}</span>
        </div>
      `;
      visual.setAttribute(
        'aria-label',
        `Matrice ${capitalizedWeekday} — ${fullDate}`
      );
      frame.style.setProperty(
        '--daily-illustration-color',
        themeColor
      );
    };
    paintVisual();
    title.insertAdjacentElement('afterend', frame);

    const updateImage = (event) => {
      const next = bannerDate
        ? (window.getDailyIllustration?.('matrix', bannerDate) || illustration)
        : event.detail?.matrix;
      if (!visual.isConnected) return;
      paintVisual(next);
    };
    window.addEventListener('cidgroup:illustrations-updated', updateImage);
    matrixIllustrationCleanup = () => {
      window.removeEventListener('cidgroup:illustrations-updated', updateImage);
    };
  };

  const renderLevelTwo = (programs) => {
    removeMatrixIllustration();
    showMatrixChrome(2);
    const results = document.getElementById('results');
    if (!results) return;
    clearMatrixContent();

    const level = document.createElement('section');
    level.className = 'matrix-level matrix-level-two';
    level.setAttribute('aria-labelledby', 'matrixCountryTitle');

    const title = document.createElement('h2');
    title.id = 'matrixCountryTitle';
    title.className = 'matrix-level-title';
    title.textContent = `${t('Matrice', 'Matrice')} — ${selectedCountry}`;
    const levelHeader = document.createElement('div');
    levelHeader.className = 'matrix-level-header';
    levelHeader.append(makeBackButton(t('matrix.back', 'Retour'), renderLevelOne), title);
    level.appendChild(levelHeader);

    const copyButton = makeButton(
      t('matrix.copyCountry', 'Copier tous les résultats de ce pays'),
      'matrix-country-copy',
      () => copyText(programs.map(formatProgramText).join('\n\n'), copyButton)
    );
    level.appendChild(copyButton);

    const slots = document.createElement('div');
    slots.className = 'matrix-program-slots';
    slots.setAttribute('aria-label', t('matrix.availableSlots', 'Créneaux horaires disponibles'));
    if (!programs.length) {
      const empty = document.createElement('p');
      empty.className = 'matrix-empty';
      empty.textContent = t('matrix.noProgramForCountry', 'Aucun programme disponible pour ce pays.');
      slots.appendChild(empty);
    } else {
      programs.forEach((program) => {
        const time = getProgramTime(program);
        const countryPrefix = selectedCountry === 'Tous' ? `${program.country} — ` : '';
        const slot = makeButton(`${countryPrefix}${time} — 1 ${t('programme', 'programme')}`, 'matrix-program-slot', () => {
          selectedProgram = { time, data: program };
          renderLevelThree();
        });
        const subtitle = document.createElement('span');
        subtitle.textContent = program.name || t('matrix.viewProgram', 'Voir le programme');
        slot.appendChild(subtitle);
        slots.appendChild(slot);
      });
    }
    level.appendChild(slots);
    results.appendChild(level);
  };

  const renderLevelThree = () => {
    removeMatrixIllustration();
    showMatrixChrome(3);
    const results = document.getElementById('results');
    if (!results || !selectedProgram) return;
    clearMatrixContent();

    const program = selectedProgram.data || {};
    const countryTitle = selectedCountry === 'Tous' ? (program.country || 'Tous') : selectedCountry;
    const level = document.createElement('section');
    level.className = 'matrix-level matrix-level-three';
    level.setAttribute('aria-labelledby', 'matrixProgramTitle');
    const title = document.createElement('h2');
    title.id = 'matrixProgramTitle';
    title.className = 'matrix-level-title';
    title.textContent = `${t('Programme', 'Programme')} ${countryTitle} — ${selectedProgram.time}`;
    const levelHeader = document.createElement('div');
    levelHeader.className = 'matrix-level-header';
    levelHeader.appendChild(makeBackButton(t('matrix.back', 'Retour'), () => {
      selectedProgram = null;
      renderLevelTwo(getProgramsForCountry(activeResults() || [], selectedCountry));
    }));
    levelHeader.appendChild(title);
    level.appendChild(levelHeader);

    const details = document.createElement('div');
    details.className = 'matrix-program-details';
    const hasDetailValue = (value) => {
      if (Array.isArray(value)) return value.some((entry) => hasDetailValue(entry));
      if (value && typeof value === 'object') {
        return Object.values(value).some((entry) => hasDetailValue(entry));
      }
      return value !== null && value !== undefined && String(value).trim() !== '';
    };
    const numberValues = (value) => {
      const entries = Array.isArray(value)
        ? value
        : value === null || value === undefined
          ? []
          : [value];
      return entries
        .flatMap((entry) => (
          entry && typeof entry === 'object' ? Object.values(entry) : [entry]
        ))
        .flatMap((entry) => String(entry ?? '').split(/[\s,;·|/]+/))
        .map((entry) => entry.trim())
        .filter(Boolean);
    };
    const addDetail = (label, value, vertical = false) => {
      if (!hasDetailValue(value)) return;
      const row = document.createElement('div');
      row.className = 'matrix-detail-row';
      const name = document.createElement('span');
      name.textContent = label;
      const content = document.createElement('strong');
      if (vertical) {
        content.className = 'matrix-detail-values';
        numberValues(value).forEach((entry) => {
          const item = document.createElement('span');
          item.textContent = entry;
          content.appendChild(item);
        });
      } else {
        content.textContent = String(value).trim();
      }
      row.append(name, content);
      details.appendChild(row);
    };
    addDetail(t('matrix.name', 'Nom'), program.name || program.country);
    addDetail(t('matrix.date', 'Date'), program.date);
    addDetail(t('Code', 'Code'), program.code);
    addDetail(t('matrix.event', 'Événement'), program.event);
    addDetail(t('Matrice', 'Matrice'), program.matrix, true);
    addDetail(t('Clavier', 'Clavier'), program.keyboard, true);
    addDetail(t('Cerveau', 'Cerveau'), program.cerveau, true);
    if (details.childElementCount) level.appendChild(details);

    const copyButton = makeButton(t('matrix.copy', 'Copier'), 'matrix-program-copy', () => {
      copyText(formatProgramText(program), copyButton);
    });
    level.appendChild(copyButton);
    results.appendChild(level);
  };

  const getResults = (requestedProgrammeDate = '') => {
    if (previewState) return Promise.resolve(previewState.results);
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedProgrammeDate || activeProgrammeDate || '').slice(0, 10))
      ? String(requestedProgrammeDate || activeProgrammeDate).slice(0, 10)
      : '';
    if (!requestedDate && Array.isArray(window.generatedResults)) {
      return Promise.resolve(window.generatedResults);
    }
    // The requested day is already on the device (memory or localStorage):
    // answer synchronously; the adapter revalidates silently.
    if (requestedDate && Array.isArray(window.generatedResults)
      && window.cidMatrixProgrammeDate?.() === requestedDate) {
      return Promise.resolve(window.generatedResults);
    }
    if (!requestedDate && resultsPromise) return resultsPromise;

    const generate = window.generateLottoResults;
    if (typeof generate !== 'function') return Promise.resolve([]);

    /*
     * Start generation before marking Matrice active. The legacy generator
     * deliberately suppresses generation while Matrice is active, so this
     * ordering also avoids that guard turning a first visit into an empty view.
     */
    try {
      if (requestedDate) resultsPromise = null;
      resultsPromise = Promise.resolve(generate({
        reason: 'matrice-navigation',
        programmeDate: requestedDate || undefined,
        // Never force: the adapter reads localStorage first and only goes to
        // the network for a date that is not on the device yet.
        force: false
      }))
        .then((value) => Array.isArray(window.generatedResults)
          ? window.generatedResults
          : (Array.isArray(value) ? value : []))
        .catch((error) => {
          console.warn('Matrice data loading failed', error);
          throw error;
        });
    } catch (error) {
      resultsPromise = Promise.reject(error);
    }
    return resultsPromise;
  };

  const closeMenus = () => {
    const submenu = document.getElementById('categoriesView');
    if (submenu) {
      submenu.hidden = true;
      submenu.style.display = 'none';
      submenu.setAttribute('aria-hidden', 'true');
    }
    const trigger = document.getElementById('categoryCategoriesButton');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  };

  const activateMatrice = ({ updateHistory = true, programmeDate = '', preview = null } = {}) => {
    ++viewRequest;
    const activationRequest = viewRequest;
    const previewDate = String(preview?.programmeDate || '').slice(0, 10);
    previewState = preview && /^\d{4}-\d{2}-\d{2}$/.test(previewDate)
      && Array.isArray(preview.results)
      ? {
        date: previewDate,
        results: preview.results.filter(Boolean),
        onBack: typeof preview.onBack === 'function' ? preview.onBack : null
      }
      : null;
    activeProgrammeDate = previewState
      ? previewState.date
      : (/^\d{4}-\d{2}-\d{2}$/.test(String(programmeDate || '').slice(0, 10))
        ? String(programmeDate).slice(0, 10)
        : '');
    if (previewState) updateHistory = false;
    // localStorage first: the day's programme is in memory before the first
    // paint, so the country list is drawn once with its final content.
    if (!previewState) window.cidHydrateMatrixCache?.(activeProgrammeDate || undefined);
    ensureStyles();
    window.hideAnticipationView?.();
    window.cidCloseBalancePanel?.({ fromHistory: true });
    window.rejectedController?.leave?.();
    const previewBack = previewState?.onBack;
    window.cidShowDedicatedView?.({
      id: 'matrice',
      title: 'Matrice',
      onBack: () => (previewBack ? previewBack() : window.showCategoriesView?.())
    });
    window.hideTableauxView?.();
    window.scrollTo(0, 0);
    document.querySelectorAll(
      'main, #results, #categoriesView, #tableauxViewContainer, ' +
      '#profileViewContainer, #croixViewContainer, #matrixCalculatorPanel'
    ).forEach((surface) => {
      surface.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    });

    closeMenus();
    document.querySelectorAll('.category-item.active, .plant-btn.active').forEach((item) => {
      item.classList.remove('active');
    });
    document.getElementById('plantMatriceBtn')?.classList.add('active');
    // Keep the bottom bar's single-selection state even though the legacy
    // Matrice shortcut also highlights its plant button.
    window.setBottomNavActiveTab?.(previewState ? 'anticipe' : 'categories');
    window.__currentCategory = 'matrice';
    window.__matriceViewOwned = true;
    if (!previewState) window.cidRoutePersistence?.remember('matrice');
    if (updateHistory && history.state?.view !== 'matrice') {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'matrice');
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(programmeDate || ''))) {
        url.searchParams.set('date', String(programmeDate).slice(0, 10));
      } else {
        url.searchParams.delete('date');
      }
      history.pushState({
        view: 'matrice',
        date: String(programmeDate || '').slice(0, 10) || null
      }, '', url.toString());
    }

    document.body.classList.remove('accueil-active', 'categories-active', 'archive-active', 'tableaux-active');
    document.body.classList.add('matrice-active');
    ensureCopyAllButton();
    setVisible('topBanner', 'none', true);
    setVisible('redCross', 'none', true);
    setVisible('tableauxViewContainer', 'none', true);

    ['currentDateTime', 'nextAvailableTime', 'nextDay'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    });
    const heading = document.getElementById('matrixPageTitle');
    if (heading) heading.style.display = '';
    const archiveButton = document.getElementById('showArchiveButton');
    if (archiveButton) archiveButton.style.display = 'none';
    const copyAll = document.getElementById('matrixCopyAllButton');
    if (copyAll) {
      copyAll.classList.add('matrix-copy-button');
      copyAll.style.display = 'block';
    }
    try {
      if (typeof window.toggleArchive === 'function') window.toggleArchive(false);
    } catch (error) {
      console.warn('Unable to close archive before Matrice render', error);
    }
    try {
      if (typeof window.renderCountryButtons === 'function') window.renderCountryButtons();
    } catch (error) {
      console.warn('Unable to render Matrice country filters', error);
    }
    renderLevelOne();
    getResults(activeProgrammeDate)
      .then((results) => {
        if (activationRequest !== viewRequest
          || !document.body.classList.contains('matrice-active')
          || selectedCountry !== null) return;
        renderMatrixCountryButtons(results);
      })
      .catch(() => {});
  };

  const hideMatriceView = () => {
    ++viewRequest;
    previewState = null;
    activeProgrammeDate = '';
    selectedCountry = null;
    selectedProgram = null;
    removeMatrixIllustration();
    clearMatrixContent();
    removeCopyAllButton();
    document.getElementById('results')?.classList.remove('matrix-results');
    document.getElementById('matriceViewStyles')?.remove();
    document.body.classList.remove('matrice-active', 'matrix-level-one');
    window.__matriceViewOwned = false;
  };

  const selectMatriceCountry = (country) => {
    const selected = String(country || '').trim();
    const validCountries = availableCountries();
    if (!validCountries.includes(selected)) return;

    const requestId = ++viewRequest;
    selectedCountry = selected;
    selectedProgram = null;
    document.querySelectorAll('#countryButtons .country-filter-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.country === selected);
      button.setAttribute('aria-pressed', String(button.dataset.country === selected));
    });

    const results = document.getElementById('results');
    // Data already on the device: render the level directly, no loader flash.
    const ready = previewState
      || (Array.isArray(window.generatedResults)
        && (!activeProgrammeDate || window.cidMatrixProgrammeDate?.() === activeProgrammeDate));
    if (!ready) showLocalLoader();

    getResults().then((data) => {
      if (requestId !== viewRequest) return;
      const allResults = Array.isArray(data) ? data : [];
      const displayedResults = selected === 'Tous'
        ? allResults
        : allResults.filter((item) => item && item.country === selected);
      window.__matrixCopyResults = displayedResults;
      renderLevelTwo(displayedResults);
      if (results) results.setAttribute('aria-busy', 'false');
    }).catch(() => {
      if (requestId !== viewRequest) return;
      showLocalError('La matrice ne peut pas être affichée pour le moment.', () => selectMatriceCountry(selected));
    });
  };

  const toggleCategories = (event, trigger) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const submenu = document.getElementById('categoriesView');
    if (!submenu) return;
    const open = submenu.style.display !== 'none' && submenu.style.display !== '';
    submenu.hidden = open;
    submenu.style.display = open ? 'none' : 'flex';
    submenu.setAttribute('aria-hidden', String(open));
    trigger?.setAttribute('aria-expanded', String(!open));
  };

  const onClick = (event) => {
    const target = event.target;
    const categoryButton = target instanceof Element
      ? target.closest('#categoryCategoriesButton, [data-category-trigger="categories"]')
      : null;
    if (categoryButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof window.setActiveTab === 'function') {
        window.setActiveTab('categories');
      } else if (typeof window.showCategoriesView === 'function') {
        window.showCategoriesView();
      } else {
        toggleCategories(event, categoryButton);
      }
      return;
    }
    if (!isMatriceTarget(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    activateMatrice();
  };

  const init = () => {
    if (window.__matriceViewInitialized) return;
    window.__matriceViewInitialized = true;
    ensureStyles();
    window.renderCountryButtons = renderMatrixCountryButtons;
    window.selectedMatriceCountry = null;
    window.activateMatriceView = activateMatrice;
  window.selectMatriceCountry = selectMatriceCountry;
  window.hideMatriceView = hideMatriceView;
    /*
     * The adapter only emits this when the server answer differs from the
     * local copy. Repaint the visible level once; identical data never
     * touches the DOM.
     */
    window.addEventListener('cid:matrix-results-updated', (event) => {
      if (previewState || !document.body.classList.contains('matrice-active')) return;
      const date = String(event.detail?.programmeDate || '');
      if (activeProgrammeDate && date !== activeProgrammeDate) return;
      if (selectedProgram) return; // keep the open programme stable
      if (selectedCountry) {
        const programs = getProgramsForCountry(activeResults() || [], selectedCountry);
        window.__matrixCopyResults = programs;
        renderLevelTwo(programs);
      } else {
        renderMatrixCountryButtons();
      }
    });
    window.cidShowMatricePreview = ({ programmeDate, results, onBack } = {}) => activateMatrice({
      updateHistory: false,
      preview: { programmeDate, results, onBack }
    });
    window.addEventListener('cid:language-change', () => {
      if (!document.body.classList.contains('matrice-active')) return;
      renderMatrixCountryButtons();
      if (selectedCountry) selectMatriceCountry(selectedCountry);
    });
    document.addEventListener('click', onClick, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
