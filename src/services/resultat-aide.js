/*
 * Public Résultat-Aide surface.
 *
 * Public surfaces may show already-published draw results and aggregate
 * percentages. Pending submissions, keys, private calculations and match
 * details stay behind the protected assistant/administrator paths.
 */
(function initResultatAide() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const translate = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const interpolate = (key, values = {}, fallback = key) => (
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
      translate(key, fallback)
    )
  );
  const isEnglishLocale = () => activeLocale().toLowerCase().startsWith('en');
  const localeText = (values) => {
    const locale = activeLocale().toLowerCase().split(/[-_]/)[0];
    return values[locale] || values.fr || '';
  };
  const localizedField = (record, field, fallback = '') => (
    window.cidTranslation?.field?.(record, field, fallback) || fallback
  );
  const formatUiDate = (value) => {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw;
    const date = new Date(`${raw}T12:00:00.000Z`);
    return window.cidTranslation?.formatDate?.(date, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }) || date.toLocaleDateString(activeLocale(), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    });
  };
  const formatUiDay = (value) => {
    const source = String(value || '').trim();
    if (!source) return '';
    const dayNames = {
      dimanche: 'schedule.sunday',
      lundi: 'schedule.monday',
      mardi: 'schedule.tuesday',
      mercredi: 'schedule.wednesday',
      jeudi: 'schedule.thursday',
      vendredi: 'schedule.friday',
      samedi: 'schedule.saturday'
    };
    const key = dayNames[source.toLocaleLowerCase('fr-FR')];
    if (!key) return source;
    const translated = translate(key, source);
    return translated.split('→')[0].trim();
  };
  const assistantCopy = (key, french, english) => translate(
    key,
    isEnglishLocale() ? english : french
  );
  const activeLocale = (snapshot = null) => String(
    window.cidTranslation?.current?.()
      || document.documentElement?.lang
      || snapshot?.localeCode
      || window.cidSiteConfig?.localization?.()?.selectedLocale
      || 'fr'
  ).trim() || 'fr';
  const SNAPSHOT_TIMEOUT_MS = 8000;
  function safeSnapshotCall(task, fallback = null) {
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = window.setTimeout(() => resolve(fallback), SNAPSHOT_TIMEOUT_MS);
    });
    const request = Promise.resolve().then(task).catch(() => fallback);
    return Promise.race([request, timeout]).finally(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }
  const languageName = (locale) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) || locale;
    } catch (_) {
      return locale;
    }
  };
  const isGreetingOnly = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[!?.,;:]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return /^(salut|bonjour|bonsoir|hello|hi|hey|hola|oi|ola|مرحبا|اهلا|أهلا)$/.test(normalized);
  };

  const PROGRAM_LABELS = Object.freeze({
    'tableaux-universelle': 'Universelle',
    'tableaux-intuition': 'Intuition',
    'tableaux-oracle': 'Oracle',
    'tableaux-lnb': 'LNB',
    'tableaux-balsa': 'Balsa Plus',
    'tableaux-standby': 'Stand-by',
    'tableaux-robot': 'Robot',
    'tableaux-created': 'Programmes personnalisés',
    croix: 'Croix nationale',
    matrice: 'Matrice',
    'boules-rejetees': 'Boules rejetées',
    'dechiffrement-plus': 'Déchiffrement Plus / MT'
  });
  const HISTORY_DOMAIN_LABELS = Object.freeze({
    results: 'Résultats',
    cross: 'Croix nationale',
    matrix: 'Matrices',
    rejected: 'Boules rejetées'
  });

  const CROSS_DAY_COLORS = Object.freeze({
    0: '#FFD700',
    1: '#1877F2',
    2: '#008000',
    3: '#6A0DAD',
    4: '#808080',
    5: '#FF0000',
    6: '#800020'
  });
  // The virtual assistant uses the same Cidmap identity as the main profile.
  // Keep this local so the icon cannot drift from the official account avatar
  // or disappear when an external illustration is unavailable.
  const VIRTUAL_ASSISTANT_IMAGE_URL = '/src/shared/images/squirrel-croix-192.png';

  function virtualAssistantCrossColor() {
    try {
      const programmeDate = window.cidDailyIllustrations?.getProgrammeDate?.();
      const official = window.cidDailyIllustrations?.getOfficialPublicationColor?.(programmeDate);
      if (/^#[0-9a-f]{6}$/i.test(String(official || ''))) return official;
    } catch (_) {}
    const cssColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--redCross-bg').trim();
    if (/^#[0-9a-f]{6}$/i.test(cssColor)) return cssColor;
    return CROSS_DAY_COLORS[new Date().getDay()] || '#0962D6';
  }

  function applyVirtualAssistantCrossColor(root = document) {
    const color = virtualAssistantCrossColor();
    root.querySelectorAll?.('[data-cid-virtual-avatar]').forEach((avatar) => {
      avatar.style.setProperty('--cid-virtual-avatar-color', color);
    });
    root.querySelectorAll?.('.cid-virtual-profile-avatar').forEach((avatar) => {
      avatar.style.setProperty('--cid-virtual-avatar-color', color);
    });
    document.documentElement.style.setProperty('--cid-virtual-avatar-color', color);
  }

  function virtualAssistantAvatar() {
    const color = virtualAssistantCrossColor();
    return `
      <span class="cid-virtual-avatar-art" data-cid-virtual-avatar style="--cid-virtual-avatar-color:${color}">
        <img src="${VIRTUAL_ASSISTANT_IMAGE_URL}" alt="" aria-hidden="true" referrerpolicy="no-referrer">
      </span>`;
  }

  const virtualAssistantName = () => `
    <span class="cid-virtual-assistant-name">${escapeHtml(translate('assistant.name', 'Cidmap virtuel'))}</span>
    <span class="cid-verified-badge" aria-label="${escapeHtml(translate('assistant.verified', 'Compte vérifié'))}">
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="m5.25 10.25 3.05 3.05 6.45-6.6"></path>
      </svg>
    </span>`;

  const labelForProgram = (value) => {
    const key = String(value || '').trim().toLowerCase();
    return translate(PROGRAM_LABELS[key]
      || PROGRAM_LABELS[`tableaux-${key}`]
      || key.replace(/^tableaux-/, '').replace(/[-_]/g, ' '));
  };

  function publicPrice(plan) {
    const currency = String(plan?.unlock_currency || '').toLowerCase() === 'stars'
      ? 'étoiles'
      : 'jetons';
    const amount = currency === 'étoiles'
      ? Number(plan?.required_stars || 0)
      : Number(plan?.required_tokens ?? plan?.regular_tokens ?? 0);
    const priceLabel = String(plan?.price_label || '').trim();
    return priceLabel || `${window.cidTranslation?.formatNumber?.(amount) || amount.toLocaleString()} ${translate(currency)}`;
  }

  function asksSubscriptionQuestion(question) {
    return /\b(prix|tarif|tarifs|co[uû]t|abonnement|abonnements|forfait|forfaits|[eé]toiles?|jetons?|price|pricing|subscription|subscriptions|plan|plans|cost)\b/i
      .test(String(question || ''));
  }

  function certaintyAnswer(question) {
    const text = normalizedQuestion(question);
    if (!/(gagner|gain|gains?|remporter|benefice|profit|win|winning)/i.test(text)
      || !/(obligatoir|certain|garanti|garantie|100\s*%|s[uû]r|assur[eé]|abonn|subscri|forfait|plan)/i.test(text)) {
      return null;
    }
    return [
      '**Une précision importante**',
      'Non. Un abonnement ne garantit jamais un gain et je ne peux pas vous promettre un résultat certain.',
      '',
      '**Ce que les plans apportent**',
      '• Des outils de calcul algorithmique et statistique.',
      '• Une aide pour explorer les données réelles, les tableaux et les historiques autorisés.',
      '• Des indicateurs dont la fiabilité dépend du pays, du programme et du nombre de résultats publiés.',
      '',
      'Si vous êtes abonné, je suis là pour vous guider à travers les données réelles et les tableaux. Les pourcentages décrivent une observation historique ; ils ne constituent pas une certitude.'
    ].join('\n');
  }

  function protectedDataAccessAnswer(question, snapshot) {
    const text = normalizedQuestion(question);
    const access = snapshot?.assistantAccess || {};
    if (access.canHelp === true || access.isAdmin === true || access.isModerator === true) return null;
    if (!/(cl[eé]|nap|satellite|combinaison|permutation|statistiques?\s+(personnelles|d[eé]taill[eé]es|priv[eé]es)|analyse\s+(personnelle|d[eé]taill[eé]e)|tableau|programme)/i.test(text)) {
      return null;
    }
    const plans = Array.isArray(snapshot?.plans) ? snapshot.plans : [];
    const offers = plans.slice(0, 5).map((plan) => {
      const name = plan.name || plan.display_name || plan.slug || 'Forfait';
      const price = plan.price || publicPrice(plan);
      const duration = Number(plan.durationDays ?? plan.duration_days) > 0
        ? ` · ${Number(plan.durationDays ?? plan.duration_days)} jours`
        : '';
      return `• ${name} : ${price || 'tarif publié non renseigné'}${duration}`;
    });
    return [
      '**Accès aux données protégées**',
      'Je peux expliquer le fonctionnement, mais je ne peux pas afficher directement une clé, un Tableau ou une statistique privée sans droit actif vérifié.',
      '',
      '**Comment lire une clé et son efficacité**',
      'Une clé est un outil de sélection issu d’un calcul. Son pourcentage est mesuré sur des résultats publiés, séparément selon le pays, le programme, l’horaire et la période observée.',
      'Un pourcentage élevé reste une observation historique : il peut évoluer avec les nouveaux tirages et ne garantit jamais un gain.',
      '',
      offers.length ? '**Offres actuellement publiées**' : '**Déblocage**',
      ...(offers.length ? offers : [
        'Les offres sont consultables dans Catégories → Offres. Je n’invente pas de prix lorsque le catalogue n’en publie pas.'
      ]),
      '',
      'Un abonnement actif ou un déblocage individuel permet d’ouvrir uniquement les tableaux prévus par l’offre. Les résultats publics, comme ceux du Bénin lorsqu’ils sont publiés, restent consultables séparément.'
    ].join('\n');
  }

  async function refreshSubscriptionCatalogue(snapshot) {
    const [config, featureAccess] = await Promise.all([
      safeSnapshotCall(
        () => window.cidSiteConfig?.load?.({ force: true }),
        null
      ),
      safeSnapshotCall(
        () => window.cidFeatureAccess?.load?.({ force: true }),
        null
      )
    ]);
    const configuredPlans = Array.isArray(featureAccess?.plans) && featureAccess.plans.length
      ? featureAccess.plans
      : Array.isArray(config?.plans)
        ? config.plans
        : [];
    const rules = Array.isArray(featureAccess?.rules) ? featureAccess.rules : [];
    const plans = configuredPlans.length
      ? configuredPlans
      : rules.map((rule) => ({
        ...rule,
        display_name: rule.display_name || rule.feature_key,
        features: [rule.feature_key],
        duration_days: rule.duration_days || 30
      }));
    if (!plans.length) return snapshot;
    return {
      ...(snapshot || {}),
      plans,
      paymentSettings: featureAccess?.settings || config?.paymentSettings || null
    };
  }

  function subscriptionPriceAnswer(question, snapshot) {
    if (!asksSubscriptionQuestion(question)) return null;
    const snapshotPlans = Array.isArray(snapshot?.plans) ? snapshot.plans : [];
    const cachedPlans = window.cidFeatureAccess?.state?.()?.plans
      || window.cidSiteConfig?.plans?.()
      || [];
    const plans = snapshotPlans.length ? snapshotPlans : cachedPlans;
    if (!plans.length) {
      return 'Je ne trouve actuellement aucun forfait actif publié dans le catalogue. Le tarif doit être configuré ou confirmé par l’administration avant d’être affiché.';
    }
    return [
      'Voici les tarifs actuellement publiés dans le catalogue :',
      ...plans.map((plan) => {
        const durationDays = Number(plan.durationDays ?? plan.duration_days) || 0;
        const duration = durationDays > 0
          ? ` · ${durationDays} jours`
          : '';
        const programmes = Array.isArray(plan.programs) && plan.programs.length
          ? ` · ${plan.programs.join(', ')}`
          : Array.isArray(plan.features) && plan.features.length
            ? ` · ${publicFeatureNames(plan.features).join(', ')}`
            : '';
        const name = plan.name || plan.display_name || plan.slug || 'Forfait';
        const price = plan.price || publicPrice(plan);
        return `• ${name} : ${price || 'tarif non renseigné'}${duration}${programmes}`;
      }),
      'Ces montants proviennent de la configuration publiée. Je n’invente pas de tarif lorsqu’une offre n’est pas renseignée.'
    ].join('\n');
  }

  function requestedAccessProgram(question) {
    const normalized = normalizedQuestion(question);
    const aliases = [
      ['dechiffrement plus', 'dechiffrement-plus'],
      ['dechiffrement', 'dechiffrement-plus'],
      ['boules rejetees', 'boules-rejetees'],
      ['croix nationale', 'croix'],
      ['programmes personnalises', 'created'],
      ['stand by', 'standby'],
      ['stand-by', 'standby'],
      ['universelle', 'universelle'],
      ['intuition', 'intuition'],
      ['oracle', 'oracle'],
      ['lnb', 'lnb'],
      ['balsa', 'balsa'],
      ['robot', 'robot'],
      ['matrice', 'matrice'],
      ['croix', 'croix']
    ].sort((left, right) => right[0].length - left[0].length);
    const match = aliases.find(([label]) => normalized.includes(label));
    if (!match) return null;
    return {
      key: match[1],
      label: labelForProgram(match[1])
    };
  }

  function accessAnswer(question, snapshot) {
    if (!/\b(acc[eè]s|accessible|autorisé|autorisee|droit|droits|peux[- ]je|ai[- ]je|mon abonnement|mon forfait|mon compte)\b/i.test(String(question || ''))) {
      return null;
    }
    const access = snapshot?.assistantAccess || {};
    const scope = access.scope || {};
    const featureState = window.cidFeatureAccess?.state?.() || {};
    const authorizedKeys = new Set(
      (Array.isArray(scope.authorizedPrograms) ? scope.authorizedPrograms : [])
        .map(canonicalProgramKey)
        .filter(Boolean)
    );
    const stateFeatures = [
      ...(Array.isArray(featureState.activePlan?.features)
        ? featureState.activePlan.features
        : []),
      ...(Array.isArray(featureState.featureUnlocks)
        ? featureState.featureUnlocks.map((item) => item?.feature_key || item?.featureKey)
        : [])
    ].map(canonicalProgramKey).filter(Boolean);
    stateFeatures.forEach((key) => authorizedKeys.add(key));
    const snapshotLabels = Array.isArray(snapshot?.allowedPrograms)
      ? snapshot.allowedPrograms.filter(Boolean)
      : [];
    const authorizedLabels = snapshotLabels.length
      ? snapshotLabels
      : stateFeatures.map(labelForProgram);
    const isAdmin = access.isAdmin === true
      || access.isModerator === true
      || snapshot?.userRole === 'admin'
      || snapshot?.userRole === 'moderator'
      || window.cidIsAdmin === true;
    const program = requestedAccessProgram(question);
    if (!program
      && /\b(r[eé]sultat|tirage)\b/i.test(String(question || ''))
      && !/\b(abonnement|forfait|compte|droit|acc[eè]s)\b/i.test(String(question || ''))) {
      return null;
    }
    if (program) {
      const hasProgram = isAdmin
        || authorizedKeys.has('tableaux')
        || authorizedKeys.has(program.key)
        || authorizedLabels.some((label) => canonicalProgramKey(label) === 'tableaux')
        || authorizedLabels.some((label) => canonicalProgramKey(label) === program.key);
      return hasProgram
        ? `Oui. Votre compte a actuellement accès à ${program.label}. Cette réponse vient de l’état d’accès synchronisé pour votre compte.`
        : `Non. Je ne trouve pas d’accès actif à ${program.label} pour votre compte. Votre abonnement ou un déblocage individuel doit l’inclure pour ouvrir ce programme.`;
    }

    if (isAdmin) {
      return `Votre compte dispose d’un accès d’administration. Les programmes autorisés actuellement synchronisés sont : ${authorizedLabels.join(', ') || 'aucun programme détaillé'}.`;
    }
    if (access.canHelp === true
      || authorizedLabels.length
      || featureState.subscription?.status === 'active') {
      const planName = access.subscription?.planName
        || snapshot?.subscription?.name
        || featureState.activePlan?.display_name
        || featureState.activePlan?.name
        || '';
      const prefix = planName
        ? `Votre forfait actif est « ${planName} ».`
        : 'Votre compte dispose d’un accès actif.';
      return [
        prefix,
        `Programmes autorisés : ${authorizedLabels.join(', ') || 'aucun programme détaillé'}.`,
        'Je vérifie ces droits depuis la configuration d’accès synchronisée, pas depuis une estimation.'
      ].join('\n');
    }
    return 'Je ne trouve aucun abonnement ou déblocage individuel actif pour ce compte. Les résultats publics restent consultables, mais les programmes privés nécessitent un accès autorisé.';
  }

  function tableauQuestionAnswer(question, snapshot) {
    const program = requestedAccessProgram(question);
    const tableauKeys = new Set([
      'universelle',
      'intuition',
      'oracle',
      'lnb',
      'balsa',
      'standby',
      'robot',
      'created'
    ]);
    if (!program || !tableauKeys.has(program.key)) return null;

    const access = snapshot?.assistantAccess || {};
    const scope = access.scope || {};
    const authorized = new Set([
      ...(Array.isArray(scope.authorizedPrograms) ? scope.authorizedPrograms : []),
      ...(Array.isArray(snapshot?.allowedPrograms) ? snapshot.allowedPrograms : [])
    ].map(canonicalProgramKey).filter(Boolean));
    const hasAccess = access.isAdmin === true
      || access.isModerator === true
      || authorized.has('tableaux')
      || authorized.has(program.key);
    if (!hasAccess) {
      return `Je reconnais votre question sur le tableau ${program.label}, mais aucun accès actif à ce tableau n’est vérifié pour votre compte. Je ne vais pas remplacer ses données par celles des résultats publics.`;
    }

    const context = snapshot?.assistantContext || {};
    const records = Array.isArray(context.records)
      ? context.records.filter((row) => (
        canonicalProgramKey(row?.programKey || row?.program || row?.programName) === program.key
      ))
      : [];
    const statistics = [
      ...(Array.isArray(context.allProgramStatistics) ? context.allProgramStatistics : []),
      ...(Array.isArray(context.dayProgramStatistics) ? context.dayProgramStatistics : [])
    ].filter((row) => (
      canonicalProgramKey(row?.programKey || row?.program || row?.programName) === program.key
    ));
    const current = Array.isArray(context.currentPrograms)
      ? context.currentPrograms.find((row) => (
        canonicalProgramKey(row?.programKey || row?.program || row?.programName) === program.key
      ))
      : null;
    const currentPayload = current?.available && current?.payload ? current.payload : null;
    const currentLine = currentPayload
      ? `Publication actuelle du ${current.programmeDate || 'jour'} : clé ${currentPayload.key || 'non publiée'} · ordre ${currentPayload.order || 'non publié'} · code ${currentPayload.code || 'non publié'} · NAP1 ${currentPayload.nap?.nap1 || 'non publié'} · NAP2 ${currentPayload.nap?.nap2 || 'non publié'}.`
      : current
        ? `Votre accès est actif, mais aucune publication actuelle de ${program.label} n’est disponible pour le ${current.programmeDate || 'jour'}.`
        : '';
    const statisticLines = statistics.slice(0, 6).map((row) => {
      const percentages = row?.percentages || row?.percentage || {};
      const overall = typeof percentages === 'object'
        ? percentages.overall ?? percentages.key ?? percentages.overall_metric
        : percentages;
      const value = Number(overall);
      return Number.isFinite(value) && value > 0
        ? `• ${row.weekKey || row.dayName || 'Période publiée'} : ${value.toLocaleString(activeLocale(), { maximumFractionDigits: 1 })} % sur ${Number(row.drawsEvaluated || 0)} tirage(s).`
        : '';
    }).filter(Boolean);
    const asksExactValue = /\b(cl[eé]|num[eé]ros?|croix|nap|satellite|combinaison|clé exacte)\b/i
      .test(String(question || ''));
    const lines = [
      `J’ai bien compris : vous parlez du tableau ${program.label}, pas des résultats publics.`,
      `Votre accès à ${program.label} est reconnu et je dois répondre uniquement avec les données autorisées pour ce tableau.`,
      currentLine,
      records.length
        ? `La mémoire du virtuel contient ${records.length} observation(s) ${program.label} que je peux comparer par pays, date, heure et tendance.`
        : statistics.length
          ? `La mémoire contient ${statistics.length} indicateur(s) publié(s) pour ${program.label}.`
          : `Aucune observation détaillée de ${program.label} n’est encore jointe à la mémoire du chat.`,
      ...statisticLines,
      asksExactValue
        ? currentPayload
          ? 'Ces valeurs proviennent de la publication actuelle autorisée et restent des données de méthode, jamais une garantie de gain.'
          : `La publication actuelle de ${program.label} n’est pas disponible dans la mémoire vérifiée. Ouvrez Catégories → Tableaux → ${program.label} pour consulter sa publication officielle lorsqu’elle sera disponible.`
        : `Indiquez le pays, la date et l’heure concernés si vous voulez une lecture précise de ${program.label}.`
    ];
    return lines.join('\n');
  }

  function databaseOnlyAnswer(question, snapshot) {
    if (!snapshot) {
      return 'Je ne peux pas actualiser les données pour le moment. Votre demande n’est pas perdue : réessayez dans un instant.';
    }
    const catalogue = subscriptionPriceAnswer(question, snapshot);
    if (catalogue) return catalogue;
    const access = accessAnswer(question, snapshot);
    if (access) return access;
    const tableau = tableauQuestionAnswer(question, snapshot);
    if (tableau) return tableau;
    const siteGuide = publicSiteGuideAnswer(question);
    if (siteGuide) return siteGuide;
    if (isGreetingOnly(question)) {
      return translate(
        'assistant.greetingResponse',
        'Bonjour ! Que souhaitez-vous faire ou savoir ?'
      );
    }
    if (/\b(r[eé]sultat|tirage|tirages)\b/i.test(question)) {
      const published = publishedResultsAnswer(question, snapshot);
      if (published) return published;
    }
    const recommendation = recommendationAnswer(question, snapshot);
    if (recommendation) return recommendation;
    const publicRows = Array.isArray(snapshot.publishedResults)
      ? snapshot.publishedResults
      : [];
    if (publicRows.length) {
      return 'Indiquez simplement le pays pour recevoir ses dernières publications.';
    }
    return [
      'Je ne trouve pas encore de donnée publiée correspondant à cette demande.',
      'Indiquez le pays souhaité et je vous enverrai la dernière publication disponible.'
    ].join('\n');
  }

  function compactResultMetadata(value) {
    if (!value?.ok) return null;
    return {
      ...value,
      schedule: Array.isArray(value.schedule)
        ? value.schedule.map((slot) => ({
          time: String(slot?.time || '').slice(0, 5),
          recorded: slot?.recorded === true,
          status: slot?.status || null
        }))
        : []
    };
  }

  function publicFeatureNames(features) {
    return (Array.isArray(features) ? features : [])
      .map(labelForProgram)
      .filter(Boolean);
  }

  function canonicalProgramKey(value) {
    return String(value || '').trim().toLowerCase()
      .replace(/^tableaux-/, '')
      .replace(/[_\s]+/g, '-')
      .replace(/^balsa-plus$/, 'balsa')
      .replace(/^stand-by$/, 'standby');
  }

  function compactRecommendationProjection(value) {
    if (!value || typeof value !== 'object') return null;
    const countries = Array.isArray(value.countries)
      ? value.countries.slice(0, 80).map((country) => ({
        countryCode: String(country?.countryCode || '').toUpperCase(),
        publishedDraws: Number(country?.publishedDraws || 0),
        firstPublishedDate: country?.firstPublishedDate || null,
        lastPublishedDate: country?.lastPublishedDate || null,
        sufficient: country?.sufficient === true,
        recommendation: country?.recommendation
          ? {
            programKey: canonicalProgramKey(country.recommendation.programKey),
            programName: String(country.recommendation.programName || ''),
            score: Number(country.recommendation.score || 0),
            observations: Number(country.recommendation.observations || 0),
            weeks: Number(country.recommendation.weeks || 0)
          }
          : null,
        programs: Array.isArray(country?.programs)
          ? country.programs.slice(0, 8).map((program) => ({
            programKey: canonicalProgramKey(program?.programKey),
            programName: String(program?.programName || ''),
            score: Number(program?.score || 0),
            observations: Number(program?.observations || 0),
            sufficient: program?.sufficient === true,
            rank: Number(program?.rank || 0)
          }))
          : []
      }))
      : [];
    const offersByProgram = {};
    Object.entries(value.offersByProgram || {}).slice(0, 12).forEach(([key, groups]) => {
      const compactOffer = (offer) => ({
        kind: offer?.kind || '',
        slug: String(offer?.slug || ''),
        name: String(offer?.name || ''),
        durationDays: Number(offer?.durationDays || 0),
        features: Array.isArray(offer?.features)
          ? offer.features.slice(0, 12).map((feature) => ({
            key: canonicalProgramKey(feature?.key),
            name: String(feature?.name || '')
          }))
          : [],
        price: offer?.price
          ? {
            currency: offer.price.currency === 'tokens' ? 'tokens' : 'stars',
            amount: Number(offer.price.amount || 0),
            regularAmount: Number(offer.price.regularAmount || 0),
            label: String(offer.price.label || ''),
            configured: offer.price.configured === true,
            promotion: offer.price.promotion === true
          }
          : null
      });
      offersByProgram[canonicalProgramKey(key)] = {
        individual: Array.isArray(groups?.individual)
          ? groups.individual.slice(0, 4).map(compactOffer)
          : [],
        bundles: Array.isArray(groups?.bundles)
          ? groups.bundles.slice(0, 6).map(compactOffer)
          : []
      };
    });
    return {
      generatedAt: value.generatedAt || '',
      source: String(value.source || ''),
      minimumPublishedDraws: Number(value.minimumPublishedDraws || 3),
      countries,
      offersByProgram,
      note: String(value.note || '')
    };
  }

  function optionalDrawNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function compactDrawNumberMemory(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      generatedAt: value.generatedAt || '',
      minimumObservations: Number(value.minimumObservations || 3),
      series: Array.isArray(value.series)
        ? value.series.slice(0, 160).map((item) => ({
          countryCode: String(item?.countryCode || '').toUpperCase(),
          drawTime: String(item?.drawTime || '').slice(0, 5),
          observations: Number(item?.observations || 0),
          observedWeekdays: Array.isArray(item?.observedWeekdays)
            ? item.observedWeekdays.map(Number).filter((day) => day >= 0 && day <= 6)
            : [],
          latest: item?.latest
            ? {
              date: item.latest.date || '',
              time: String(item.latest.time || '').slice(0, 5),
              drawNumber: optionalDrawNumber(item.latest.drawNumber)
            }
            : null,
          recent: Array.isArray(item?.recent)
            ? item.recent.slice(-30).map((row) => ({
              date: row?.date || '',
              time: String(row?.time || '').slice(0, 5),
              drawNumber: optionalDrawNumber(row?.drawNumber)
            }))
            : []
        }))
        : [],
      note: String(value.note || '')
    };
  }

  function compactAssistantContext(context) {
    if (!context || typeof context !== 'object') return null;
    return {
      generatedAt: context.generatedAt || '',
      currentDate: context.currentDate || '',
      userCountry: context.userCountry || '',
      authorizedPrograms: Array.isArray(context.authorizedPrograms)
        ? context.authorizedPrograms.slice(0, 20)
        : [],
      accessScope: context.accessScope || 'aucun',
      publishedForCountry: Array.isArray(context.publishedForCountry)
        ? context.publishedForCountry.slice(0, 30)
        : [],
      publishedCountForCountry: Number(context.publishedCountForCountry || 0),
      publishedResults: Array.isArray(context.publishedResults)
        ? context.publishedResults.slice(0, 500)
        : [],
      allProgramStatistics: Array.isArray(context.allProgramStatistics)
        ? context.allProgramStatistics.slice(0, 240)
        : [],
      dayProgramStatistics: Array.isArray(context.dayProgramStatistics)
        ? context.dayProgramStatistics.slice(0, 240)
        : [],
      records: Array.isArray(context.records) ? context.records.slice(0, 120) : [],
      currentPrograms: Array.isArray(context.currentPrograms)
        ? context.currentPrograms.slice(0, 12)
        : [],
      dayPatterns: Array.isArray(context.dayPatterns) ? context.dayPatterns.slice(0, 120) : [],
      timePatterns: Array.isArray(context.timePatterns) ? context.timePatterns.slice(0, 120) : [],
      delayPatterns: Array.isArray(context.delayPatterns)
        ? context.delayPatterns.slice(0, 240)
        : [],
      permutationObservations: Array.isArray(context.permutationObservations)
        ? context.permutationObservations.slice(0, 120)
        : [],
      delayProgramStatistics: Array.isArray(context.delayProgramStatistics)
        ? context.delayProgramStatistics.slice(0, 240)
        : [],
      currentWeek: context.currentWeek || '',
      weeklyActivity: Array.isArray(context.weeklyActivity)
        ? context.weeklyActivity.slice(0, 160)
        : [],
      crossProgramPatterns: Array.isArray(context.crossProgramPatterns)
        ? context.crossProgramPatterns.slice(0, 100)
        : [],
      recommendationProjection: compactRecommendationProjection(
        context.recommendationProjection
      ),
      drawNumberMemory: compactDrawNumberMemory(context.drawNumberMemory),
      personalPeriodStatistics: context.personalPeriodStatistics
        ? {
          available: context.personalPeriodStatistics.available === true,
          from: context.personalPeriodStatistics.from || null,
          to: context.personalPeriodStatistics.to || null,
          programmes: Array.isArray(context.personalPeriodStatistics.programmes)
            ? context.personalPeriodStatistics.programmes.slice(0, 20)
            : [],
          note: String(context.personalPeriodStatistics.note || '')
        }
        : null,
      earlyAccess: context.earlyAccess
        ? {
          rules: Array.isArray(context.earlyAccess.rules)
            ? context.earlyAccess.rules.slice(0, 30)
            : [],
          unlocks: Array.isArray(context.earlyAccess.unlocks)
            ? context.earlyAccess.unlocks.slice(0, 60)
            : [],
          grants: Array.isArray(context.earlyAccess.grants)
            ? context.earlyAccess.grants.slice(0, 60)
            : []
        }
        : null,
      dechiffrementPlus: context.dechiffrementPlus || { available: false }
    };
  }

  async function readPublicAssistantSnapshot() {
    const bridge = await safeSnapshotCall(
      () => Promise.resolve(window.cidSupabaseReady),
      null
    );
    const sessionResult = bridge?.auth?.getSession
      ? await safeSnapshotCall(() => bridge.auth.getSession(), null)
      : null;
    const session = sessionResult?.data?.session || null;
    const selectedCountry = window.cidSmartCountry?.get?.();
    const countryCode = selectedCountry && selectedCountry !== 'Tous'
      ? selectedCountry
      : undefined;
    const [catalog, account, statistics, viewer, resultMetadata, publishedResultList, publicDrawNumberMemory, pendingResult, privateAssistant] = await Promise.all([
      safeSnapshotCall(() => window.cidSiteConfig?.load?.({ force: true }), null),
      safeSnapshotCall(() => window.cidFeatureAccess?.load?.({ force: true }), null),
      safeSnapshotCall(() => invoke({ action: 'public-suggestions' }), null),
      safeSnapshotCall(() => invoke({ action: 'viewer-state' }), null),
      safeSnapshotCall(() => invoke({ action: 'result-metadata', countryCode }), null),
      safeSnapshotCall(() => invoke({ action: 'list-published' }), null),
      safeSnapshotCall(() => invoke({ action: 'public-draw-number-memory', countryCode }), null),
      session?.user
        ? safeSnapshotCall(() => invoke({ action: 'pending-draw' }), null)
        : null,
      session?.user
        ? safeSnapshotCall(() => invokeSupportChat({
          action: 'state',
          localeCode: activeLocale()
        }), null)
        : null
    ]);
    const plans = Array.isArray(catalog?.plans) && catalog.plans.length
      ? catalog.plans
      : (Array.isArray(account?.plans) ? account.plans : []);
    const settings = catalog?.paymentSettings || account?.settings || {};
    const subscriptionFeatures = account?.subscription?.features || [];
    const individualFeatures = (account?.featureUnlocks || [])
      .map((item) => item?.feature_key || item?.featureKey);
    const allowedPrograms = [
      ...new Set([
        ...subscriptionFeatures,
        ...individualFeatures
      ].map(labelForProgram).filter(Boolean))
    ];
    const earlyRules = (account?.earlyAccessRules || catalog?.earlyAccessRules || [])
      .filter((rule) => rule?.enabled === true)
      .map((rule) => ({
        program: labelForProgram(rule.feature_key),
        days: Math.max(1, Number(rule.preview_days) || 1),
        prices: [
          Number(rule.token_cost_1_day ?? rule.required_tokens) || 0,
          Number(rule.token_cost_2_days) || 0,
          Number(rule.token_cost_3_days) || 0
        ]
      }));
    const privateAccess = privateAssistant?.access;
    const authorizedPrivateKeys = new Set(
      privateAccess?.scope?.authorizedPrograms || []
    );
    const publicRowAllowed = (row) => (
      !privateAccess?.canHelp
      || authorizedPrivateKeys.has(canonicalProgramKey(
        row?.programKey || row?.program || row?.programName
      ))
    );
    const effectiveAllowedPrograms = privateAccess?.canHelp
      && Array.isArray(privateAccess.scope?.authorizedPrograms)
      ? privateAccess.scope.authorizedPrograms.map(labelForProgram)
      : allowedPrograms;
    const assistantAccess = privateAccess
      ? {
        canHelp: privateAccess.canHelp === true,
        isAdmin: privateAccess.isAdmin === true,
        isModerator: privateAccess.isModerator === true,
        scope: privateAccess.scope
          ? {
            source: privateAccess.scope.source,
            authorizedPrograms: privateAccess.scope.authorizedPrograms || []
          }
          : null,
        subscription: privateAccess.subscription
          ? {
            planName: privateAccess.subscription.planName,
            features: privateAccess.subscription.features || []
          }
          : null,
        individualUnlocks: (privateAccess.individualUnlocks || [])
          .map((item) => ({ featureKey: item.featureKey }))
        }
      : null;
    const userRole = assistantAccess?.isAdmin
      ? 'admin'
      : assistantAccess?.canHelp
        ? 'subscriber'
        : session?.user
          ? 'non-subscriber'
          : 'visitor';
    const subscriptionTier = assistantAccess?.subscription?.planName
      || account?.subscription?.planName
      || null;
    const publishedResults = Array.isArray(publishedResultList?.draws)
      ? publishedResultList.draws.slice(0, 500).map((draw) => ({
        id: draw.id,
        countryCode: draw.country_code,
        date: draw.draw_date,
        drawTime: String(draw.draw_time || '').slice(0, 5),
        drawNumber: optionalDrawNumber(draw.draw_number),
        firstNumbers: Array.isArray(draw.first_numbers) ? draw.first_numbers.slice(0, 90) : [],
        machineNumbers: Array.isArray(draw.machine_numbers) ? draw.machine_numbers.slice(0, 90) : [],
        bonusNumbers: Array.isArray(draw.bonus_numbers) ? draw.bonus_numbers.slice(0, 90) : []
      }))
      : [];

    const assistantContext = compactAssistantContext(privateAssistant?.assistantContext) || {};
    if (publicDrawNumberMemory?.drawNumberMemory) {
      assistantContext.drawNumberMemory = compactDrawNumberMemory(
        publicDrawNumberMemory.drawNumberMemory
      );
    }

    return {
      dataSource: 'supabase',
      syncedAt: new Date().toISOString(),
      today: new Date().toISOString().slice(0, 10),
      userId: session?.user?.id || null,
      userRole,
      subscriptionTier,
      subscriptionStatus: account?.subscription?.status
        || privateAccess?.subscription?.status
        || (subscriptionTier ? 'active' : 'none'),
      localeCode: privateAssistant?.access?.localeCode
        || catalog?.localeCode
        || catalog?.localization?.selectedLocale
        || activeLocale(),
      visitor: session?.user
        ? 'compte connecté'
        : 'visiteur public',
      canSubmitResult: viewer?.canSendResult === true,
      autoPublishResult: viewer?.canPublishDirectly === true,
      hasActiveResultAccess: viewer?.hasActiveAccess === true,
      requiresResultConfirmation: viewer?.requiresConfirmation === true,
      resultMetadata: compactResultMetadata(resultMetadata),
      publishedResults,
      pendingConfirmation: pendingResult?.pending || null,
      assistantAccess,
      assistantContext,
      plans: plans
        .filter((plan) => plan?.enabled !== false)
        .slice(0, 20)
        .map((plan) => ({
          name: String(plan.display_name || plan.slug || 'Forfait'),
          price: publicPrice(plan),
          durationDays: Number(plan.duration_days) || 30,
          programs: publicFeatureNames(plan.features)
        })),
      allowedPrograms: effectiveAllowedPrograms,
      subscription: account?.subscription
        ? {
          name: String(account.subscription.planName || 'Forfait actif'),
          expiresAt: account.subscription.expiresAt || null
        }
        : null,
      publicContact: {
        label: String(settings.contact_label || settings.chat_label || '').trim(),
        channel: String(settings.contact_channel || '').trim(),
        phone: String(settings.whatsapp_number || '').trim(),
        socialLinks: Array.isArray(settings.social_links)
          ? settings.social_links
            .map((item) => ({
              name: String(item?.name || '').trim(),
              url: String(item?.url || '').trim()
            }))
            .filter((item) => item.name && item.url)
            .slice(0, 20)
          : []
      },
      earlyRules,
      earlyAccess: session?.user
        ? {
          rules: earlyRules,
          unlocks: Array.isArray(account?.earlyAccessUnlocks)
            ? account.earlyAccessUnlocks.slice(0, 80)
            : [],
          grants: Array.isArray(account?.earlyAccessGrants)
            ? account.earlyAccessGrants.slice(0, 80)
            : []
        }
        : null,
      publicStatistics: {
        weekKey: statistics?.weekKey || null,
        suggestions: Array.isArray(statistics?.suggestions)
          ? statistics.suggestions.filter(publicRowAllowed).slice(0, 80).map((row) => ({
            country: row.countryCode,
            week: row.weekKey,
            program: row.programName,
            score: row.percentage,
            draws: row.drawsEvaluated
          }))
          : [],
        daySuggestions: Array.isArray(statistics?.daySuggestions)
          ? statistics.daySuggestions.filter(publicRowAllowed).slice(0, 80).map((row) => ({
            country: row.countryCode,
            day: row.dayName,
            program: row.programName,
            score: row.percentage
          }))
          : []
      }
    };
  }

  async function invoke(body) {
    const bridge = await window.cidSupabaseReady;
    const client = bridge?.client;
    if (!client?.functions) throw new Error('Connexion Supabase indisponible.');
    const result = await client.functions.invoke('result-helf', {
      body: {
        ...body,
        localeCode: body?.localeCode || activeLocale()
      }
    });
    if (result.error) {
      /*
       * Supabase wraps a non-2xx Edge Function response in a generic
       * FunctionsHttpError. Read the JSON response when it is available so
       * the contributor sees the actual validation/database message instead
       * of only "Edge Function returned a non-2xx status code".
       */
      const context = result.error?.context;
      if (context && typeof context.clone === 'function') {
        try {
          const response = context.clone();
          const contentType = String(response.headers?.get?.('content-type') || '');
          const details = contentType.includes('application/json')
            ? await response.json()
            : await response.text();
          const message = typeof details === 'string'
            ? details.trim()
            : details?.error || details?.message;
          if (message) throw new Error(String(message));
        } catch (responseError) {
          if (responseError instanceof Error && responseError.message) {
            throw responseError;
          }
        }
      }
      throw result.error;
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data || {};
  }

  async function invokeSupportChat(body) {
    const bridge = await window.cidSupabaseReady;
    const client = bridge?.client;
    if (!client?.functions) throw new Error('Connexion Supabase indisponible.');
    const result = await client.functions.invoke('support-chat', {
      body: {
        ...body,
        localeCode: body?.localeCode || activeLocale()
      }
    });
    if (result.error) throw result.error;
    if (result.data?.error) throw new Error(result.data.error);
    return result.data || {};
  }

  async function invokeVirtualChat(body = {}, method = 'POST') {
    const bridge = await safeSnapshotCall(() => Promise.resolve(window.cidSupabaseReady), null);
    const sessionResult = bridge?.auth?.getSession
      ? await safeSnapshotCall(() => bridge.auth.getSession(), null)
      : null;
    const session = sessionResult?.data?.session || null;
    const userResult = bridge?.auth?.getUser
      ? await safeSnapshotCall(() => bridge.auth.getUser(), null)
      : null;
    const user = userResult?.data?.user || null;
    if (!user?.id) throw new Error('Connexion requise pour utiliser le chat virtuel.');
    const identity = {
      cid: user.id,
      name: user.user_metadata?.full_name || user.user_metadata?.name || ''
    };
    const url = new URL('/api/virtual-chat', window.location.origin);
    if (method === 'GET') {
      if (body.sessionId) url.searchParams.set('sessionId', body.sessionId);
      if (body.localeCode) url.searchParams.set('localeCode', body.localeCode);
      url.searchParams.set('cid', identity.cid);
    }
    const timeoutMs = method === 'GET' ? 12000 : 30000;
    const requestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {})
      },
      body: method === 'GET'
        ? undefined
        : JSON.stringify({
          ...body,
          ...identity,
          userId: user.id,
          userRole: body.context?.userRole || 'visitor',
          subscriptionTier: body.context?.subscriptionTier || ''
        })
    };
    const fetchOnce = async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url.toString(), {
          ...requestInit,
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };
    const timeoutMessage = method === 'GET'
      ? 'La mémoire du chat met trop de temps à se charger. Actualisez puis réessayez.'
      : 'La réponse prend trop de temps. Votre question n’est pas perdue : réessayez dans un instant.';
    let response;
    try {
      response = await fetchOnce();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(timeoutMessage);
      }
      // A cold server wake-up or a transient network reset should not turn a
      // valid authenticated conversation into an immediate “indisponible”.
      try {
        response = await fetchOnce();
      } catch (retryError) {
        if (retryError?.name === 'AbortError') throw new Error(timeoutMessage);
        throw retryError;
      }
    }
    if (response.status >= 500) {
      try {
        response = await fetchOnce();
      } catch (retryError) {
        if (retryError?.name === 'AbortError') throw new Error(timeoutMessage);
        throw retryError;
      }
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || 'Le serveur n’a pas pu répondre à cette question.');
    }
    return payload;
  }

  // Calculation views call this without awaiting it. A telemetry failure must
  // never block a Tableau from displaying its result.
  window.cidRecordProgramTraffic = (programKey, country = '') => {
    invoke({
      action: 'record-program-view',
      programKey,
      country
    }).catch(() => {});
  };

  function score(metric) {
    const value = window.cidTranslation?.formatNumber?.(
      Number(metric?.percentage || 0),
      { maximumFractionDigits: 1 }
    ) || Number(metric?.percentage || 0).toLocaleString();
    return `${value} %`;
  }

  function renderSuggestions(data) {
    const target = get('globalStatisticsSuggestions') || get('resultatAideSuggestions');
    if (!target) return;
    const summaryTarget = get('globalStatisticsSummary');
    const dayTarget = get('globalStatisticsDaySuggestions') || get('resultatAideDaySuggestions');
    const countryMeta = (value) => {
      const code = String(value || '').trim().toUpperCase();
      return {
        code: code || '—',
        name: code ? countryLabel(code) : translate('Pays', 'Pays')
      };
    };
    const programmeName = (row) => String(
      localizedField(row, 'programName')
        || row?.programName
        || row?.programKey
        || translate('Programme non renseigné', 'Programme non renseigné')
    ).trim();
    const dayLabel = (value) => {
      const text = formatUiDay(value) || translate('Jour non renseigné', 'Jour non renseigné');
      return text ? `${text.charAt(0).toLocaleUpperCase(activeLocale())}${text.slice(1)}` : text;
    };
    const rows = Array.isArray(data?.suggestions) ? data.suggestions : [];
    const dayRows = Array.isArray(data?.daySuggestions) ? data.daySuggestions : [];
    const totalDraws = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.drawsEvaluated) || 0), 0);
    const weightedScore = totalDraws
      ? rows.reduce((sum, row) => sum + (Math.max(0, Number(row?.percentage) || 0) * Math.max(0, Number(row?.drawsEvaluated) || 0)), 0) / totalDraws
      : 0;
    const countries = new Set(rows.map((row) => String(row?.countryCode || '').trim().toUpperCase()).filter(Boolean));
    const programmes = new Set([...rows, ...dayRows].map(programmeName).filter(Boolean));
    const number = (value, options = {}) => window.cidTranslation?.formatNumber?.(Number(value) || 0, options)
      || (Number(value) || 0).toLocaleString(activeLocale(), options);

    if (summaryTarget) {
      summaryTarget.innerHTML = `
        <article class="global-statistics-metric">
          <span class="global-statistics-metric-label">${escapeHtml(translate('ui.weeklyDraws', 'Tirages évalués'))}</span>
          <strong class="global-statistics-metric-value">${escapeHtml(number(totalDraws))}</strong>
          <span class="global-statistics-metric-detail">${escapeHtml(translate('ui.weeklyDrawsDetail', 'Observations historiques retenues'))}</span>
        </article>
        <article class="global-statistics-metric">
          <span class="global-statistics-metric-label">${escapeHtml(translate('ui.averageScore', 'Score moyen observé'))}</span>
          <strong class="global-statistics-metric-value">${escapeHtml(score({ percentage: weightedScore }))}</strong>
          <span class="global-statistics-metric-detail">${escapeHtml(translate('ui.averageScoreDetail', 'Moyenne pondérée des scores calculés'))}</span>
        </article>
        <article class="global-statistics-metric">
          <span class="global-statistics-metric-label">${escapeHtml(translate('ui.followedCountries', 'Pays suivis'))}</span>
          <strong class="global-statistics-metric-value">${escapeHtml(number(countries.size))}</strong>
          <span class="global-statistics-metric-detail">${escapeHtml(translate('ui.followedCountriesDetail', 'Périmètre géographique enregistré'))}</span>
        </article>
        <article class="global-statistics-metric">
          <span class="global-statistics-metric-label">${escapeHtml(translate('ui.comparedPrograms', 'Programmes comparés'))}</span>
          <strong class="global-statistics-metric-value">${escapeHtml(number(programmes.size))}</strong>
          <span class="global-statistics-metric-detail">${escapeHtml(translate('ui.comparedProgramsDetail', 'Intuition, LNB et programmes disponibles'))}</span>
        </article>`;
    }

    target.innerHTML = rows.length
      ? `<div class="global-statistics-weekly-list">${rows.map((row, index) => {
          const country = countryMeta(row?.countryCode);
          const draws = Math.max(0, Number(row?.drawsEvaluated) || 0);
          return `<article class="global-statistics-week-card">
            <div class="global-statistics-week-card-header">
              <div class="global-statistics-week-country">
                <span class="global-statistics-country-code">${escapeHtml(country.code)}</span>
                <div>
                  <strong>${escapeHtml(country.name)}</strong>
                  <span>${escapeHtml(interpolate('ui.week', {
                    value: row?.weekKey || data?.weekKey || '—'
                  }, 'Semaine {{value}}'))}</span>
                </div>
              </div>
              <span class="global-statistics-week-index">${escapeHtml(interpolate('ui.marker', {
                value: String(index + 1).padStart(2, '0')
              }, 'Repère {{value}}'))}</span>
            </div>
            <div class="global-statistics-week-detail">
              <span>${escapeHtml(translate('ui.observedProgram', 'Programme observé'))}</span>
              <strong>${escapeHtml(programmeName(row))}</strong>
            </div>
            <div class="global-statistics-week-metrics">
              <div>
                <span>${escapeHtml(translate('ui.calculatedScore', 'Score calculé'))}</span>
                <strong class="global-statistics-score">${escapeHtml(score({ percentage: row?.percentage }))}</strong>
              </div>
              <div>
                <span>${escapeHtml(translate('ui.weeklyDraws', 'Tirages évalués'))}</span>
                <strong class="global-statistics-draws">${escapeHtml(number(draws))}</strong>
              </div>
            </div>
          </article>`;
        }).join('')}</div>`
      : `<p class="global-statistics-empty">${escapeHtml(translate('ui.noWeeklyObservations', 'Aucune observation hebdomadaire publiée pour la période sélectionnée.'))}</p>`;

    if (dayTarget) {
      const dayOrder = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      const sortedDayRows = [...dayRows].sort((a, b) => {
        const left = dayOrder.indexOf(String(a?.dayName || '').toLocaleLowerCase('fr-FR'));
        const right = dayOrder.indexOf(String(b?.dayName || '').toLocaleLowerCase('fr-FR'));
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      });
      dayTarget.innerHTML = sortedDayRows.length
        ? `<div class="global-statistics-daily-grid">${sortedDayRows.map((row, index) => {
            const country = countryMeta(row?.countryCode);
            return `<article class="global-statistics-day-card">
              <div class="global-statistics-day-card-header">
                <strong class="global-statistics-day-name">${escapeHtml(dayLabel(row?.dayName))}</strong>
                <span class="global-statistics-day-index">${escapeHtml(interpolate('ui.marker', {
                  value: String(index + 1).padStart(2, '0')
                }, 'Repère {{value}}'))}</span>
              </div>
              <span class="global-statistics-day-country">${escapeHtml(country.name)} · ${escapeHtml(country.code)}</span>
              <strong class="global-statistics-day-program">${escapeHtml(programmeName(row))}</strong>
              <div class="global-statistics-day-score">
                <span>${escapeHtml(translate('ui.calculatedScore', 'Score calculé'))}</span>
                <strong>${escapeHtml(score({ percentage: row?.percentage }))}</strong>
              </div>
            </article>`;
          }).join('')}</div>`
        : `<p class="global-statistics-empty">${escapeHtml(translate('ui.noDailyTrends', 'Aucune tendance journalière publiée pour le moment.'))}</p>`;
    }
  }

  async function loadSuggestions() {
    const country = String(get('resultatAideCountryFilter')?.value || '').trim();
    const button = get('resultatAideRefresh');
    if (button) button.disabled = true;
    const cacheIdentity = String(window.cidAuthCurrentUserId || 'visitor').trim() || 'visitor';
    const cacheKey = `resultat-suggestions:${country || 'all'}`;
    const cached = window.cidPersistentCache?.read?.(
      cacheKey,
      cacheIdentity,
      24 * 60 * 60 * 1000
    );
    if (cached?.value) renderSuggestions(cached.value);
    try {
      const data = await invoke({ action: 'public-suggestions', countryCode: country });
      renderSuggestions(data);
      window.cidPersistentCache?.write?.(cacheKey, cacheIdentity, data);
    } catch (error) {
      const target = get('globalStatisticsSuggestions') || get('resultatAideSuggestions');
      if (target) target.innerHTML = `<p class="resultat-aide-empty">${escapeHtml(error?.message || translate('ui.noStatistics', 'Statistiques indisponibles.'))}</p>`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadPublished() {
    const target = get('resultatAidePublished');
    if (!target) return;
    const cacheIdentity = String(window.cidAuthCurrentUserId || 'visitor').trim() || 'visitor';
    const cached = window.cidPersistentCache?.read?.(
      'resultat-published',
      cacheIdentity,
      24 * 60 * 60 * 1000
    );
    if (cached?.value?.draws) {
      target.dataset.draws = JSON.stringify(cached.value.draws);
      renderPublishedDraws(cached.value.draws);
    }
    try {
      const result = await invoke({ action: 'list-published' });
      const draws = Array.isArray(result?.draws) ? result.draws : [];
      target.dataset.draws = JSON.stringify(draws);
      renderPublishedDraws(draws);
      window.cidPersistentCache?.write?.('resultat-published', cacheIdentity, result);
    } catch (error) {
      target.innerHTML = `<p class="resultat-aide-empty">${escapeHtml(error?.message || translate('ui.noPublishedResults', 'Tirages publiés indisponibles.'))}</p>`;
    }
  }

  function ensureResultModal() {
    let modal = document.getElementById('resultatAideResultModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'resultatAideResultModal';
    modal.className = 'resultat-aide-result-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="resultat-aide-result-modal-backdrop" data-close-result-modal></div>
      <section class="resultat-aide-result-dialog" role="dialog" aria-modal="true" aria-labelledby="resultatAideResultModalTitle" tabindex="-1">
        <header class="resultat-aide-result-dialog-header">
          <div>
            <span class="resultat-aide-result-dialog-kicker">${escapeHtml(translate('ui.publishedResult', 'Résultat publié'))}</span>
            <h2 id="resultatAideResultModalTitle" data-result-modal-title>${escapeHtml(translate('ui.result', 'Résultat'))}</h2>
            <p data-result-modal-meta></p>
          </div>
          <button type="button" class="resultat-aide-result-modal-close" data-fluid="true" data-close-result-modal aria-label="${escapeHtml(translate('Fermer', 'Fermer'))}">×</button>
        </header>
        <div class="resultat-aide-result-dialog-body" data-result-modal-body></div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-close-result-modal]')) {
        closeResultModal();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeResultModal();
    });
    return modal;
  }

  let resultModalLastTrigger = null;
  function closeResultModal() {
    const modal = get('resultatAideResultModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('resultat-aide-modal-open');
    resultModalLastTrigger?.focus?.();
    resultModalLastTrigger = null;
  }

  function openResultModal(draw, countryName, trigger) {
    const modal = ensureResultModal();
    const dialog = modal.querySelector('.resultat-aide-result-dialog');
    const title = modal.querySelector('[data-result-modal-title]');
    const meta = modal.querySelector('[data-result-modal-meta]');
    const body = modal.querySelector('[data-result-modal-body]');
    if (!dialog || !title || !meta || !body) return;
    const first = Array.isArray(draw?.first_numbers) ? draw.first_numbers : [];
    const machine = Array.isArray(draw?.machine_numbers) ? draw.machine_numbers : [];
    const bonus = Array.isArray(draw?.bonus_numbers) ? draw.bonus_numbers : [];
    const programName = String(
      localizedField(draw, 'program_name')
        || draw?.program_name
        || countryName
        || translate('ui.result', 'Résultat')
    ).trim();
    const drawTime = String(draw?.draw_time || '').slice(0, 5);
    const timeLabel = drawTime
      ? `${Number(drawTime.slice(0, 2))}h${drawTime.slice(3) !== '00' ? ` ${drawTime.slice(3)}` : ''}`
      : '';
    const date = String(draw?.draw_date || '');
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateLabel = dateMatch ? formatUiDate(date) : date;
    const groups = [
      [translate('ui.winners', 'Gagnants :'), first, ''],
      [translate('ui.machine', 'Machine :'), machine, ' is-machines'],
      [translate('ui.bonus', 'Bonus :'), bonus, ' is-bonus']
    ].filter(([, numbers]) => numbers.length);
    title.textContent = `${programName}${timeLabel ? ` ${timeLabel}` : ''}`;
    const drawNumberLabel = draw?.draw_number !== null
      && draw?.draw_number !== undefined
      && draw?.draw_number !== ''
      ? `${translate('ui.draw', 'Tirage :')} ${String(draw.draw_number).padStart(3, '0')}`
      : '';
    meta.innerHTML = `
      <span>${escapeHtml(dateLabel)}</span>
      ${drawNumberLabel ? `<span class="resultat-aide-result-dialog-draw-number">${escapeHtml(drawNumberLabel)}</span>` : ''}`;
    body.innerHTML = groups.length
      ? groups.map(([label, numbers, extraClass]) => `
          <div class="resultat-aide-result-line${extraClass}">
            <span class="resultat-aide-result-line-label">${escapeHtml(label)}</span>
            <strong>${escapeHtml(numbers.map((number) => String(number).padStart(2, '0')).join(' – '))}</strong>
          </div>`).join('')
      : `<p class="resultat-aide-empty">${escapeHtml(translate('ui.noDrawNumbers', 'Les numéros de ce tirage ne sont pas disponibles.'))}</p>`;
    resultModalLastTrigger = trigger || null;
    modal.hidden = false;
    document.body.classList.add('resultat-aide-modal-open');
    window.requestAnimationFrame(() => dialog.focus());
  }

  function resultNumberText(numbers) {
    return (Array.isArray(numbers) ? numbers : [])
      .map((number) => String(number).padStart(2, '0'))
      .join(' – ');
  }

  function resultCardAccentColor() {
    const daily = window.cidDailyIllustrations;
    const programmeDate = daily?.getProgrammeDate?.();
    const configured = daily?.getConfiguredPublicationColor?.(programmeDate);
    if (/^#[0-9a-f]{6}$/i.test(String(configured || ''))) return configured;
    const rootColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--redCross-bg').trim();
    if (/^#[0-9a-f]{6}$/i.test(rootColor)) return rootColor;
    const official = daily?.getOfficialPublicationColor?.(programmeDate)
      || window.getOfficialPublicationColor?.(programmeDate);
    if (/^#[0-9a-f]{6}$/i.test(String(official || ''))) return official;
    return '#1877F2';
  }

  function renderPublishedDraws(draws) {
    const target = get('resultatAidePublished');
    if (!target) return;
    target.__resultPublishedDraws = Array.isArray(draws) ? draws : [];
    const accentColor = resultCardAccentColor();
    const query = String(get('resultatAideCountryFilter')?.value || '')
      .trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const picker = get('resultatAideCountryPicker');
    const countryLabelForDraw = (code) => countryLabel(code)
      || String(code || translate('Pays', 'Pays')).toUpperCase();
    const normalizedCountry = (value) => String(value || '').trim().toUpperCase();
    const searchable = (value) => String(value || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const dateLabel = (value) => {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? formatUiDate(value) : String(value || '');
    };
    const dateSortValue = (value) => {
      const raw = String(value || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '9999-99-99';
    };
    const timeSortValue = (value) => {
      const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?/);
      if (!match) return Number.MAX_SAFE_INTEGER;
      return (Number(match[1]) * 60) + Number(match[2] || 0);
    };
    const chronologicalCompare = (left, right) => (
      dateSortValue(left?.draw_date).localeCompare(dateSortValue(right?.draw_date))
      || timeSortValue(left?.draw_time) - timeSortValue(right?.draw_time)
      || Number(left?.draw_number || 0) - Number(right?.draw_number || 0)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    );
    const filtered = (Array.isArray(draws) ? draws : []).filter((draw) => {
      if (!query) return true;
      const code = normalizedCountry(draw?.country_code);
      return searchable(code).includes(query)
        || searchable(countryLabelForDraw(code)).includes(query);
    });
    if (!filtered.length) {
      if (picker) picker.innerHTML = '';
      target.__resultModalDraws = new Map();
      target.innerHTML = `<p class="resultat-aide-empty">${escapeHtml(translate('ui.noPublishedDraws', 'Aucun tirage publié pour le moment.'))}</p>`;
      return;
    }
    const groups = new Map();
    filtered
      .slice()
      .sort(chronologicalCompare)
      .forEach((draw) => {
        const code = normalizedCountry(draw?.country_code);
        const list = groups.get(code) || [];
        list.push(draw);
        groups.set(code, list);
      });

    const availableCountries = [...groups.entries()].sort(([left], [right]) => (
      countryLabelForDraw(left).localeCompare(countryLabelForDraw(right), activeLocale())
    ));
    const selectedCountry = normalizedCountry(target.dataset.selectedCountry);
    const visibleGroups = selectedCountry && groups.has(selectedCountry)
      ? availableCountries.filter(([country]) => country === selectedCountry)
      : availableCountries;

    if (picker) {
      const selected = selectedCountry && groups.has(selectedCountry) ? selectedCountry : '';
      picker.innerHTML = `
        <button type="button" class="resultat-aide-country-option${selected === '' ? ' is-active' : ''}" data-country-select="" aria-pressed="${selected === ''}">
          ${escapeHtml(translate('Tous', 'Tous'))} <span>${filtered.length}</span>
        </button>
        ${availableCountries.map(([country, countryDraws]) => `
          <button type="button" class="resultat-aide-country-option${selected === country ? ' is-active' : ''}" data-country-select="${escapeHtml(country)}" aria-pressed="${selected === country}">
            ${escapeHtml(countryLabelForDraw(country))} <span>${countryDraws.length}</span>
          </button>
        `).join('')}`;
    }

    const modalDraws = new Map();
    let resultIndex = 0;
    target.innerHTML = visibleGroups.map(([country, countryDraws]) => `
      <section class="resultat-aide-country-results" data-country-panel="${escapeHtml(country)}">
        <div class="resultat-aide-country-heading">
          <div>
            <span class="resultat-aide-country-kicker">${escapeHtml(translate('ui.publishedResults', 'Résultats publiés'))}</span>
            <h4>${escapeHtml(countryLabelForDraw(country))}</h4>
          </div>
          <span class="resultat-aide-country-count">${countryDraws.length} ${
            countryDraws.length > 1
              ? translate('ui.draws', 'tirages')
              : translate('ui.drawSingular', 'tirage')
          }</span>
        </div>
        <div class="resultat-aide-country-cards">${countryDraws.map((draw) => {
          const first = Array.isArray(draw.first_numbers) ? draw.first_numbers : [];
          const machine = Array.isArray(draw.machine_numbers) ? draw.machine_numbers : [];
          const bonus = Array.isArray(draw.bonus_numbers) ? draw.bonus_numbers : [];
          const modalKey = `result-${resultIndex++}`;
          modalDraws.set(modalKey, { draw, countryName: countryLabelForDraw(country) });
          const programName = localizedField(draw, 'program_name')
            || draw?.program_name
            || countryLabelForDraw(country);
          const time = String(draw.draw_time || '').slice(0, 5);
          const timeLabel = time
            ? `${Number(time.slice(0, 2))}h${time.slice(3) !== '00' ? ` ${time.slice(3)}` : ''}`
            : '';
          const formattedDate = dateLabel(draw.draw_date);
          const previewLine = (label, numbers, modifier = '') => numbers.length
            ? `<span class="resultat-aide-draw-preview-line${modifier}">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(resultNumberText(numbers))}</strong>
              </span>`
            : '';
          return `<article class="resultat-aide-draw-card" style="--result-card-accent:${escapeHtml(accentColor)}">
            <div class="resultat-aide-draw-card-trigger" data-fluid="true" data-open-result="${modalKey}">
              <span class="resultat-aide-draw-card-header">
                <strong>${escapeHtml(programName)}${timeLabel ? ` ${escapeHtml(timeLabel)}` : ''}</strong>
                ${formattedDate ? `<span class="resultat-aide-draw-card-date">${escapeHtml(formattedDate)}</span>` : ''}
                ${draw.draw_number !== null && draw.draw_number !== undefined && String(draw.draw_number).trim() !== ''
                  ? `<span class="resultat-aide-draw-card-number">${escapeHtml(translate('ui.draw', 'Tirage :'))} ${escapeHtml(String(draw.draw_number).padStart(3, '0'))}</span>`
                  : ''}
              </span>
              <span class="resultat-aide-draw-card-body">
                ${previewLine(first.length
                  ? translate('ui.winners', 'Gagnants :')
                  : translate('ui.results', 'Résultats :'), first.length ? first : machine)}
                ${machine.length && first.length
                  ? previewLine(translate('ui.machine', 'Machine :'), machine, ' is-machines') : ''}
                ${bonus.length ? previewLine(translate('ui.bonus', 'Bonus :'), bonus, ' is-bonus') : ''}
              </span>
            </div>
          </article>`;
        }).join('')}</div>
      </section>`).join('');
    target.__resultModalDraws = modalDraws;
  }

  function renderPanel() {
    const panel = get('resultatAideViewMount') || get('categoriesResultatPanel');
    if (!panel || panel.dataset.ready) return;
    panel.dataset.ready = 'true';
    panel.innerHTML = `
      <div class="resultat-aide-panel">
        <div class="resultat-aide-header">
          <div><h2>${escapeHtml(translate('ui.results', 'Résultats'))}</h2><p>${escapeHtml(translate('ui.resultsDescription', 'Les résultats des pays sont classés par pays et par heure.'))}</p></div>
          <button type="button" class="resultat-aide-secondary" data-open-history>${escapeHtml(translate('Historiques', 'Historiques'))}</button>
          <span class="resultat-aide-pill">${escapeHtml(translate('ui.publishedResults', 'Résultats publiés'))}</span>
        </div>
        <section class="resultat-aide-public resultat-aide-statistics" aria-labelledby="resultatAideStatisticsTitle">
          <button id="resultatAideStatisticsToggle" class="resultat-aide-statistics-toggle" type="button" data-open-global-statistics aria-label="${escapeHtml(translate('ui.globalStatistics', 'Statistiques globales'))}">
            <span id="resultatAideStatisticsTitle">${escapeHtml(translate('ui.globalStatistics', 'Statistiques globales'))}</span>
            <span class="resultat-aide-statistics-toggle-icon" aria-hidden="true">→</span>
          </button>
          <p class="resultat-aide-statistics-intro">${escapeHtml(translate('ui.historicalSearch', 'Terminal de recherche historique'))}</p>
        </section>
        <section class="resultat-aide-public" aria-labelledby="resultatAidePublicTitle">
          <h3 id="resultatAidePublicTitle">${escapeHtml(translate('ui.publishedResults', 'Résultats publiés'))}</h3>
          <p>${escapeHtml(translate('ui.selectCountry', 'Sélectionnez un pays pour afficher son bloc de résultats.'))}</p>
          <div class="resultat-aide-filters">
            <input id="resultatAideCountryFilter" maxlength="40" placeholder="${escapeHtml(translate('ui.searchCountry', 'Rechercher un pays'))}" aria-label="${escapeHtml(translate('ui.searchCountry', 'Rechercher un pays'))}">
            <button id="resultatAideRefresh" class="resultat-aide-secondary" type="button">${escapeHtml(translate('ui.refreshResults', 'Actualiser les résultats'))}</button>
          </div>
          <div id="resultatAideCountryPicker" class="resultat-aide-country-picker" role="group" aria-label="${escapeHtml(translate('ui.chooseCountry', 'Choisir un pays'))}"></div>
          <div id="resultatAidePublished"><p class="resultat-aide-empty">${escapeHtml(translate('ui.loading', 'Chargement…'))}</p></div>
        </section>
      </div>`;
    ensureResultModal();
    panel.addEventListener('click', (event) => {
      const trigger = event.target instanceof Element
        ? event.target.closest('[data-open-result]')
        : null;
      if (!trigger) return;
      const published = get('resultatAidePublished');
      const entry = published?.__resultModalDraws?.get(trigger.dataset.openResult);
      if (entry) openResultModal(entry.draw, entry.countryName, trigger);
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const trigger = event.target instanceof Element
        ? event.target.closest('[data-open-result]')
        : null;
      if (!trigger) return;
      event.preventDefault();
      const published = get('resultatAidePublished');
      const entry = published?.__resultModalDraws?.get(trigger.dataset.openResult);
      if (entry) openResultModal(entry.draw, entry.countryName, trigger);
    });
    get('resultatAideRefresh')?.addEventListener('click', () => {
      loadPublished();
      loadSuggestions();
    });
    get('resultatAideCountryPicker')?.addEventListener('click', (event) => {
      const option = event.target instanceof Element
        ? event.target.closest('[data-country-select]')
        : null;
      if (!option) return;
      const published = get('resultatAidePublished');
      if (!published) return;
      published.dataset.selectedCountry = String(option.dataset.countrySelect || '')
        .trim().toUpperCase();
      const cached = published.dataset.draws;
      if (cached) {
        try { renderPublishedDraws(JSON.parse(cached)); } catch (_) {}
      }
      loadSuggestions();
    });
    get('resultatAideCountryFilter')?.addEventListener('input', () => {
      const cached = get('resultatAidePublished')?.dataset.draws;
      if (!cached) return;
      try { renderPublishedDraws(JSON.parse(cached)); } catch (_) {}
    });
    panel.querySelector('[data-open-history]')?.addEventListener('click', () => {
      window.showHistoryView?.();
    });
    panel.querySelector('[data-open-global-statistics]')?.addEventListener('click', () => {
      window.showGlobalStatisticsView?.();
    });
    loadPublished();
  }

  function renderGlobalStatisticsPanel() {
    const panel = get('globalStatisticsViewMount');
    if (!panel || panel.dataset.ready) return;
    panel.dataset.ready = 'true';
    panel.innerHTML = `
      <div class="global-statistics-shell">
        <header class="global-statistics-toolbar">
          <button type="button" class="global-statistics-back cid-back-button" data-cid-back-button="true" data-global-statistics-back aria-label="${escapeHtml(translate('ui.backToResults', 'Retour aux résultats'))}">
            <svg class="cid-back-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m15 18-6-6 6-6"></path>
            </svg>
            <span>${escapeHtml(translate('Retour', 'Retour'))}</span>
          </button>
          <div>
            <span class="global-statistics-eyebrow">${escapeHtml(translate('ui.historicalSearch', 'Terminal de recherche historique'))}</span>
            <h1 id="globalStatisticsViewTitle" class="global-statistics-title">${escapeHtml(translate('ui.globalStatistics', 'Statistiques globales'))}</h1>
            <p class="global-statistics-subtitle">${escapeHtml(translate('ui.globalStatisticsSubtitle', 'Lecture structurée des archives enregistrées pour comparer les fréquences et les performances observées par pays, par semaine et par jour.'))}</p>
          </div>
          <span class="global-statistics-source">${escapeHtml(translate('ui.recordedArchives', 'Archives enregistrées'))}</span>
        </header>
        <p class="global-statistics-disclaimer">${escapeHtml(translate('ui.statisticsDisclaimer', 'Ces tendances statistiques reposent exclusivement sur l’analyse des archives historiques enregistrées. Elles constituent un outil d’aide à la recherche et ne garantissent en aucun cas les résultats futurs.'))}</p>
        <section class="global-statistics-section" aria-labelledby="globalStatisticsSummaryTitle">
          <div class="global-statistics-section-header">
            <div>
              <span class="global-statistics-section-label">${escapeHtml(translate('ui.summary', 'Synthèse'))}</span>
              <h2 id="globalStatisticsSummaryTitle">${escapeHtml(translate('ui.observationScope', 'Périmètre des observations'))}</h2>
            </div>
            <button type="button" class="global-statistics-refresh" data-global-statistics-refresh>${escapeHtml(translate('ui.refresh', 'Actualiser'))}</button>
          </div>
          <div id="globalStatisticsSummary" class="global-statistics-summary">
            <p class="global-statistics-empty">${escapeHtml(translate('ui.loading', 'Chargement…'))}</p>
          </div>
        </section>
        <section class="global-statistics-section" aria-labelledby="globalStatisticsWeeklyTitle">
          <div class="global-statistics-section-header">
            <div>
              <span class="global-statistics-section-label">${escapeHtml(translate('ui.weeklyAnalysis', 'Analyse hebdomadaire'))}</span>
              <h2 id="globalStatisticsWeeklyTitle">${escapeHtml(translate('ui.weeklyScores', 'Semaines et scores calculés'))}</h2>
            </div>
            <p class="global-statistics-section-note">${escapeHtml(translate('ui.weeklyComparison', 'Comparaison des programmes à partir des tirages évalués.'))}</p>
          </div>
          <div id="globalStatisticsSuggestions"><p class="global-statistics-empty">${escapeHtml(translate('ui.loading', 'Chargement…'))}</p></div>
        </section>
        <section class="global-statistics-section" aria-labelledby="globalStatisticsDailyTitle">
          <div class="global-statistics-section-header">
            <div>
              <span class="global-statistics-section-label">${escapeHtml(translate('ui.dailyAnalysis', 'Analyse journalière'))}</span>
              <h2 id="globalStatisticsDailyTitle">${escapeHtml(translate('ui.dailyGrid', 'Grille comparative par jour'))}</h2>
            </div>
            <p class="global-statistics-section-note">${escapeHtml(translate('ui.dailyDescription', 'Une lecture descriptive des tendances enregistrées.'))}</p>
          </div>
          <div id="globalStatisticsDaySuggestions"><p class="global-statistics-empty">${escapeHtml(translate('ui.loading', 'Chargement…'))}</p></div>
        </section>
      </div>`;
    panel.querySelector('[data-global-statistics-back]')?.addEventListener('click', () => {
      window.showResultatAideView?.();
    });
    panel.querySelector('[data-global-statistics-refresh]')?.addEventListener('click', () => {
      loadSuggestions();
    });
    loadSuggestions();
  }

  // The structured result intake needs several short turns (country, date,
  // time, first numbers, machine, bonus and confirmation).
  const PUBLIC_VIRTUAL_LIMIT = 12;
  // v2 intentionally drops the old conversational draft format. It could
  // reopen an obsolete "country first" flow on the next visit, even after
  // the structured result form became the primary entry point.
  const PUBLIC_RESULT_DRAFT_KEY = 'cid-public-result-draft-v2';
  let publicVirtualHistory = [];
  let publicVirtualSessionId = null;
  let publicAssistantSnapshotPromise = null;
  let publicResultDraft = (() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PUBLIC_RESULT_DRAFT_KEY) || 'null');
      return saved && typeof saved === 'object' && saved.stage ? saved : null;
    } catch (_) {
      return null;
    }
  })();
  let publicVirtualAccountState = null;

  function savePublicResultDraft() {
    try {
      if (publicResultDraft) {
        sessionStorage.setItem(PUBLIC_RESULT_DRAFT_KEY, JSON.stringify(publicResultDraft));
      } else {
        sessionStorage.removeItem(PUBLIC_RESULT_DRAFT_KEY);
      }
    } catch (_) {}
  }

  const COUNTRY_ALIASES = Object.freeze({
    benin: 'BJ',
    bj: 'BJ',
    'cote d ivoire': 'CI',
    'cote divoire': 'CI',
    ci: 'CI',
    ghana: 'GH',
    gh: 'GH',
    cameroun: 'CM',
    cameroon: 'CM',
    cm: 'CM',
    suisse: 'CH',
    switzerland: 'CH',
    ch: 'CH',
    niger: 'NE',
    ne: 'NE',
    guinee: 'GN',
    guinea: 'GN',
    gn: 'GN',
    senegal: 'SN',
    sn: 'SN',
    togo: 'TG',
    tg: 'TG',
    angola: 'AO',
    ao: 'AO'
  });
  /*
   * Country recognition is intentionally data-driven. The short aliases
   * above preserve familiar spellings, while this ISO directory lets the
   * virtual assistant understand countries that were not hard-coded into a
   * particular feature release.
   */
  const ISO_COUNTRY_CODES = Object.freeze(
    'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW'
      .split(' ')
  );
  const countryDirectoryCache = new Map();

  function countryDirectory() {
    const locale = activeLocale().toLowerCase();
    if (countryDirectoryCache.has(locale)) return countryDirectoryCache.get(locale);
    const displayLocales = [...new Set([locale, 'fr', 'en'])];
    const displays = displayLocales.map((code) => {
      try {
        return new Intl.DisplayNames([code], { type: 'region' });
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    const directory = ISO_COUNTRY_CODES.map((code) => {
      const names = [...new Set(displays.map((display) => {
        try { return display.of(code) || ''; } catch (_) { return ''; }
      }).filter(Boolean))];
      return { code, names, normalizedNames: names.map(normalizedQuestion) };
    });
    countryDirectoryCache.set(locale, directory);
    return directory;
  }

  function countryCodeFromValue(value, { contains = false } = {}) {
    const explicitCode = String(value || '').match(/\b[A-Z]{2}\b/);
    if (explicitCode && ISO_COUNTRY_CODES.includes(explicitCode[0])) {
      return explicitCode[0];
    }
    const raw = normalizedQuestion(value);
    if (!raw) return '';
    if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];
    if (/^[a-z]{2}$/i.test(raw) && ISO_COUNTRY_CODES.includes(raw.toUpperCase())) {
      return raw.toUpperCase();
    }
    const match = countryDirectory()
      .slice()
      .sort((left, right) => (
        Math.max(...right.normalizedNames.map((name) => name.length), 0)
        - Math.max(...left.normalizedNames.map((name) => name.length), 0)
      ))
      .find((entry) => entry.normalizedNames.some((name) => (
        contains ? raw.includes(name) : raw === name
      )));
    return match?.code || '';
  }

  function normalizeCountryInput(value) {
    const dialMatch = window.cidInternationalPhone?.match?.(value);
    const dialCode = dialMatch
      ? window.cidInternationalPhone?.isoByDial?.[dialMatch[0]]
      : '';
    if (dialCode) return dialCode;
    const raw = String(value || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .replace(/\s+/g, ' ');
    return countryCodeFromValue(raw)
      || (/^[a-z]{2,8}$/i.test(raw) ? raw.toUpperCase() : '');
  }

  function normalizeDateInput(value) {
    const raw = String(value || '').trim();
    const european = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : european
        ? `${european[3]}-${european[2]}-${european[1]}`
        : '';
    if (!iso) return '';
    const date = new Date(`${iso}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso)
      ? iso
      : '';
  }

  function normalizeTimeInput(value) {
    const match = String(value || '').trim().match(/^([01]\d|2[0-3])(?:[:h.]([0-5]\d))?$/i);
    return match ? `${match[1]}:${match[2] || '00'}` : '';
  }

  function numberListInput(value, max = 90) {
    return [...new Set(
      String(value || '').match(/\d{1,2}/g) || []
    )]
      .map(Number)
      .filter((number) => number >= 1 && number <= 90)
      .slice(0, max);
  }

  function countInput(value) {
    const numbers = numberListInput(value, 1);
    return numbers.length && numbers[0] >= 1 && numbers[0] <= 90
      ? numbers[0]
      : 0;
  }

  function resultDraftQuestion() {
    const stage = publicResultDraft?.stage;
    if (stage === 'country') {
      return translate(
        'assistant.askCountry',
        'Pour quel pays ? Donnez son nom ou son code pays (ex. Côte d’Ivoire, Angola, CI ou AO).'
      );
    }
    if (stage === 'date') {
      return translate(
        'assistant.askDate',
        'Quelle est la date du tirage ? Utilisez AAAA-MM-JJ ou JJ/MM/AAAA.'
      );
    }
    if (stage === 'time') {
      const slots = Array.isArray(publicResultDraft?.metadata?.schedule)
        ? publicResultDraft.metadata.schedule
        : [];
      const available = slots.filter((slot) => !slot.recorded).map((slot) => slot.time);
      return available.length
        ? interpolate(
          'assistant.askTimeOptions',
          { times: available.join(', ') },
          `Quel horaire voulez-vous enregistrer ? Choisissez parmi : ${available.join(', ')}.`
        )
        : translate(
          'assistant.askTime',
          'À quelle heure le tirage est-il arrivé ? Exemple : 08:00.'
        );
    }
    if (stage === 'drawNumber') {
      return translate(
        'assistant.askDrawNumber',
        'Quel est le numéro stratégique du tirage ? Indiquez un nombre entier (ex. 2710).'
      );
    }
    if (stage === 'firstCount') {
      return translate(
        'assistant.askFirstCount',
        isEnglishLocale()
          ? 'How many numbers are in the Winners group? Enter the number.'
          : 'Combien de numéros comporte le groupe Gagnants ? Indiquez le nombre.'
      );
    }
    if (stage === 'first') {
      return isEnglishLocale()
        ? `Send the ${publicResultDraft?.data?.firstCount || ''} Winners numbers in order.`
        : `Envoyez les ${publicResultDraft?.data?.firstCount || ''} numéros Gagnants, dans l’ordre.`;
    }
    if (stage === 'secondChoice') {
      return translate(
        'assistant.askSecondGroup',
        isEnglishLocale()
          ? 'Does the draw have a Machine group? Reply “yes” or “no”.'
          : 'Le tirage possède-t-il un groupe Machine ? Répondez « oui » ou « non ».'
      );
    }
    if (stage === 'secondCount') {
      return translate(
        'assistant.askSecondCount',
        isEnglishLocale()
          ? 'How many numbers are in the Machine group? Enter the number.'
          : 'Combien de numéros comporte le groupe Machine ? Indiquez le nombre.'
      );
    }
    if (stage === 'second') {
      return isEnglishLocale()
        ? `Send the ${publicResultDraft?.data?.secondCount || ''} Machine numbers in order.`
        : `Envoyez les ${publicResultDraft?.data?.secondCount || ''} numéros Machine, dans l’ordre.`;
    }
    if (stage === 'bonusChoice') {
      return translate(
        'assistant.askBonusChoice',
        isEnglishLocale()
          ? 'Does the draw have bonus numbers? Reply “yes” or “no”.'
          : 'Le tirage possède-t-il des numéros bonus ? Répondez « oui » ou « non ».'
      );
    }
    if (stage === 'bonusCount') {
      return translate(
        'assistant.askBonusCount',
        isEnglishLocale()
          ? 'How many bonus numbers should be entered? Enter the number.'
          : 'Combien de numéros bonus faut-il saisir ? Indiquez le nombre.'
      );
    }
    if (stage === 'bonus') {
      return isEnglishLocale()
        ? `Send the ${publicResultDraft?.data?.bonusCount || ''} bonus numbers.`
        : `Envoyez les ${publicResultDraft?.data?.bonusCount || ''} numéros bonus.`;
    }
    if (stage === 'confirm') {
      return translate(
        'assistant.askConfirm',
        isEnglishLocale()
          ? 'Reply “yes” to confirm, or “edit” to start again.'
          : 'Répondez « oui » pour confirmer, ou « modifier » pour recommencer.'
      );
    }
    return '';
  }

  function resultDraftSummary() {
    const data = publicResultDraft?.data || {};
    return [
      interpolate('assistant.summaryCountry', { country: data.country }, `Pays : ${data.country}`),
      interpolate('assistant.summaryDate', { date: data.drawDate }, `Date : ${data.drawDate}`),
      interpolate('assistant.summaryTime', { time: data.drawTime }, `Heure : ${data.drawTime}`),
      ...(data.drawNumber !== null && data.drawNumber !== undefined && String(data.drawNumber).trim() !== ''
        ? [`${assistantCopy('assistant.drawNumber', 'Numéro de tirage', 'Draw number')} : ${data.drawNumber}`]
        : []),
      `${assistantCopy('assistant.groupOne', 'Gagnants', 'Winners')} (${data.first.length}) : ${data.first.join(' · ')}`,
      ...(data.machine.length
        ? [`${assistantCopy('assistant.groupTwo', 'Machine', 'Machine')} (${data.machine.length}) : ${data.machine.join(' · ')}`]
        : []),
      ...(data.bonus.length
        ? [`${assistantCopy('assistant.bonus', 'Bonus', 'Bonus')} (${data.bonus.length}) : ${data.bonus.join(' · ')}`]
        : [`${assistantCopy('assistant.bonus', 'Bonus', 'Bonus')} : ${isEnglishLocale() ? 'none' : 'aucun'}`])
    ].join('\n');
  }

  function editableDrawLabel(draw, index = 0) {
    const country = countryLabel(draw?.country_code || '');
    const date = String(draw?.draw_date || 'date inconnue');
    const time = String(draw?.draw_time || '').slice(0, 5);
    const status = draw?.status === 'published' ? 'publié'
      : draw?.status === 'pending' ? 'en attente'
        : String(draw?.status || 'enregistré');
    return `${index + 1}. ${country || draw?.country_code || 'Pays inconnu'} · ${date} · ${time || 'heure inconnue'} · ${status}`;
  }

  function editableDrawChoices(draws) {
    return (Array.isArray(draws) ? draws : [])
      .slice(0, 12)
      .map((draw, index) => editableDrawLabel(draw, index))
      .join('\n');
  }

  function chooseEditableDraw(value, draws) {
    const list = Array.isArray(draws) ? draws : [];
    if (!list.length) return null;
    const index = Number(String(value || '').match(/\b(\d{1,2})\b/)?.[1] || 0);
    if (index >= 1 && index <= list.length) return list[index - 1];
    const normalized = normalizedQuestion(value);
    const date = normalizeDateInput(value);
    const time = normalizeTimeInput(value);
    return list.find((draw) => {
      const country = normalized.includes(String(draw.country_code || '').toLowerCase());
      const sameDate = date && String(draw.draw_date || '') === date;
      const sameTime = time && String(draw.draw_time || '').slice(0, 5) === time;
      return (country && (sameDate || sameTime)) || (sameDate && sameTime);
    }) || (list.length === 1 ? list[0] : null);
  }

  function beginEditableDraft(draw) {
    publicResultDraft = {
      mode: 'edit',
      drawId: draw.id,
      stage: 'date',
      data: {
        country: String(draw.country_code || '').toUpperCase(),
        originalDate: String(draw.draw_date || ''),
        originalTime: String(draw.draw_time || '').slice(0, 5),
        drawNumber: optionalDrawNumber(draw.draw_number),
        first: [],
        machine: [],
        bonus: []
      },
      metadata: null
    };
    savePublicResultDraft();
  }

  function normalizedQuestion(value) {
    return String(value || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function requestedResultsCountry(question, snapshot) {
    const normalized = normalizedQuestion(question);
      const countryLabels = {
      benin: ['BJ', 'Bénin'],
      'cote d ivoire': ['CI', "Côte d'Ivoire"],
      'cote divoire': ['CI', "Côte d'Ivoire"],
      ghana: ['GH', 'Ghana'],
      angola: ['AO', 'Angola'],
      ao: ['AO', 'Angola'],
      cameroun: ['CM', 'Cameroun'],
      cameroon: ['CM', 'Cameroun'],
      cm: ['CM', 'Cameroun'],
      suisse: ['CH', 'Suisse'],
      switzerland: ['CH', 'Switzerland'],
      ch: ['CH', 'Switzerland'],
      niger: ['NE', 'Niger'],
      guinee: ['GN', 'Guinée'],
      guinea: ['GN', 'Guinée'],
      senegal: ['SN', 'Sénégal'],
      togo: ['TG', 'Togo']
    };
    for (const [label, [code, name]] of Object.entries(countryLabels)) {
      if (normalized.includes(label)) return { code, name };
    }
    const code = countryCodeFromValue(question, { contains: true });
    if (code) {
      return { code, name: countryLabel(code) };
    }
    const profileCountry = snapshot?.resultMetadata?.country;
    return profileCountry?.code
      ? { code: profileCountry.code, name: profileCountry.name || profileCountry.code }
      : null;
  }

  function requestedPublishedResultCount(question) {
    const normalized = normalizedQuestion(question);
    const numeric = normalized.match(/\b([1-9]|1[0-2])\s*(?:résultats?|resultats?|tirages?)\b/i);
    if (numeric) return Number(numeric[1]);
    const words = {
      un: 1,
      une: 1,
      deux: 2,
      trois: 3,
      quatre: 4,
      cinq: 5
    };
    const word = Object.keys(words).find((key) => (
      new RegExp(`\\b${key}\\s+(?:résultats?|resultats?|tirages?)\\b`, 'i').test(normalized)
    ));
    return word ? words[word] : 0;
  }

  function addDaysIso(value, amount) {
    const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function monthBounds(value, offset = 0) {
    const base = new Date(`${String(value || '').slice(0, 10)}T12:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return null;
    const first = new Date(Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + offset,
      1,
      12
    ));
    const last = new Date(Date.UTC(
      first.getUTCFullYear(),
      first.getUTCMonth() + 1,
      0,
      12
    ));
    return {
      from: first.toISOString().slice(0, 10),
      to: last.toISOString().slice(0, 10)
    };
  }

  function requestedPublishedScope(question, snapshot) {
    const normalized = normalizedQuestion(question);
    const base = String(snapshot?.today || new Date().toISOString().slice(0, 10));
    const explicit = normalized.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b/);
    if (explicit) {
      const date = normalizeDateInput(explicit[0]);
      return date ? { from: date, to: date, weekday: null } : null;
    }
    if (/\b(mois dernier|mois derniere|mois passé|mois passe|mois précédent|mois precedent)\b/i.test(normalized)) {
      const bounds = monthBounds(base, -1);
      if (!bounds) return null;
      const weekdays = {
        dimanche: 0,
        lundi: 1,
        mardi: 2,
        mercredi: 3,
        jeudi: 4,
        vendredi: 5,
        samedi: 6
      };
      const weekdayName = Object.keys(weekdays).find((name) => normalized.includes(name));
      return { ...bounds, weekday: weekdayName ? weekdays[weekdayName] : null };
    }
    if (/\b(semaine dernière|semaine derniere|semaine passée|semaine passee|semaine précédente|semaine precedente)\b/i.test(normalized)) {
      const baseDate = new Date(`${base}T12:00:00.000Z`);
      if (Number.isNaN(baseDate.getTime())) return null;
      const mondayOffset = (baseDate.getUTCDay() + 6) % 7;
      const currentMonday = addDaysIso(base, -mondayOffset);
      return {
        from: addDaysIso(currentMonday, -7),
        to: addDaysIso(currentMonday, -1),
        weekday: null
      };
    }
    if (/\b(aujourd hui|aujourd'hui|today|hier|yesterday)\b/i.test(normalized)
      || /\b(dernier|derniere|précédent|precedent|passé|passe|suivant|prochain)\b/i.test(normalized)
      || /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(normalized)) {
      const date = requestedDrawDate(question, snapshot);
      return date ? { from: date, to: date, weekday: null } : null;
    }
    return null;
  }

  function requestsAllPublishedResults(question) {
    const normalized = normalizedQuestion(question);
    return /\b(tous?|toutes|l'ensemble|ensemble|chaque|toute la journee|toute la journée|journee entiere|journée entière|complet|complets)\b/i
      .test(normalized);
  }

  function publishedResultLines(row, countryName) {
    const date = row.date || '';
    const time = row.drawTime || '';
    const first = Array.isArray(row.firstNumbers) ? row.firstNumbers : [];
    return [
      `**${[countryName, date, time].filter(Boolean).join(' · ')}**`,
      ...(row.drawNumber !== null && row.drawNumber !== undefined && String(row.drawNumber).trim() !== ''
        ? [`• ${assistantCopy('assistant.drawNumber', 'Numéro de tirage', 'Draw number')} : ${row.drawNumber}`]
        : []),
      first.length ? `• ${assistantCopy('assistant.groupOne', 'Groupe 1', 'Group 1')} : ${first.join(' · ')}` : '',
      ...(row.machineNumbers?.length
        ? [`• ${assistantCopy('assistant.groupTwo', 'Groupe 2', 'Group 2')} : ${row.machineNumbers.join(' · ')}`]
        : []),
      ...(row.bonusNumbers?.length
        ? [`• ${assistantCopy('assistant.bonus', 'Bonus', 'Bonus')} : ${row.bonusNumbers.join(' · ')}`]
        : [])
    ].filter(Boolean);
  }

  function publishedResultsAnswer(question, snapshot) {
    if (!/\b(résultat|resultat|tirage|tirages)\b/i.test(question)) return null;
    const normalized = normalizedQuestion(question);
    const asksProgramGuide = /\b(programmes?|tableaux?|méthodes?|methodes?|horaires?|fonctionnement|navigation|guide)\b/i
      .test(normalized)
      && !(countryCodeFromValue(question, { contains: true })
        || /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b|\b(aujourd hui|today|hier|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\b\d{1,2}\s*(?:h|heure|heures|:)\s*\d{0,2}\b/i.test(normalized));
    if (asksProgramGuide) return null;
    const country = requestedResultsCountry(question, snapshot);
    if (!country) {
      return translate(
        'assistant.askCountry',
        isEnglishLocale()
          ? 'Which country would you like to see the result for? Give its name or country code (for example Côte d’Ivoire, Cameroon, CI or CM).'
          : 'Pour quel pays souhaitez-vous voir le résultat ? Donnez son nom ou son code pays (ex. Côte d’Ivoire, Cameroun, CI ou CM).'
      );
    }
    const rows = (Array.isArray(snapshot?.publishedResults) ? snapshot.publishedResults : [])
      .filter((row) => String(row.countryCode || '').toUpperCase() === country.code)
      .sort((left, right) => (
        `${right.date || ''} ${right.drawTime || ''}`.localeCompare(
          `${left.date || ''} ${left.drawTime || ''}`
        )
      ));
    if (!rows.length) {
      return interpolate(
        'assistant.resultNotFound',
        { country: country.name },
        isEnglishLocale()
          ? `No published result is currently available for ${country.name}.`
          : `Aucun résultat publié n’est disponible pour ${country.name} pour le moment.`
      );
    }
    const scope = requestedPublishedScope(question, snapshot);
    const wantsAll = requestsAllPublishedResults(question);
    const requestedCount = requestedPublishedResultCount(question);
    const latestDate = String(rows[0]?.date || '');
    const latestDayRows = rows.filter((row) => String(row.date || '') === latestDate);
    let selected = latestDayRows.slice(0, requestedCount || 1);
    let periodLabel = localeText({
      fr: 'Dernière publication',
      en: 'Latest publication',
      es: 'Última publicación',
      pt: 'Última publicação',
      ar: 'آخر نشر'
    });
    if (scope) {
      selected = rows.filter((row) => {
        const date = String(row.date || '');
        if (date < scope.from || date > scope.to) return false;
        if (scope.weekday === null || scope.weekday === undefined) return true;
        return new Date(`${date}T12:00:00.000Z`).getUTCDay() === scope.weekday;
      });
      periodLabel = scope.from === scope.to
        ? scope.from
        : `${scope.from} → ${scope.to}`;
      selected.sort((left, right) => (
        `${left.date || ''} ${left.drawTime || ''}`.localeCompare(
          `${right.date || ''} ${right.drawTime || ''}`
        )
      ));
    } else if (wantsAll) {
      selected = latestDayRows.slice();
      periodLabel = latestDate;
    }
    if (requestedCount && selected.length > requestedCount) {
      selected = selected.slice(0, requestedCount);
    }
    if (!scope && !wantsAll && !requestedCount) {
      selected = latestDayRows.slice(0, 1);
    }
    if (!selected.length) {
      return localeText({
        fr: `Aucun résultat publié n’est disponible pour ${country.name} sur la période demandée.`,
        en: `No published result is available for ${country.name} for the requested period.`,
        es: `No hay ningún resultado publicado disponible para ${country.name} en el período solicitado.`,
        pt: `Não há resultado publicado disponível para ${country.name} no período solicitado.`,
        ar: `لا توجد نتيجة منشورة متاحة لـ ${country.name} في الفترة المطلوبة.`
      });
    }
    return [
      `**${localeText({
        fr: 'Résultats publiés',
        en: 'Published results',
        es: 'Resultados publicados',
        pt: 'Resultados publicados',
        ar: 'النتائج المنشورة'
      })} — ${country.name} · ${periodLabel}${selected.length > 1
        ? ` · ${selected.length} ${localeText({
          fr: 'tirages',
          en: 'draws',
          es: 'sorteos',
          pt: 'sorteios',
          ar: 'سحوبات'
        })}`
        : ''} :**`,
      ...selected.flatMap((row) => publishedResultLines(row, country.name))
    ].join('\n');
  }

  function drawNumberQuestion(value) {
    return /\b(num(?:e|é)ro\s+(?:de\s+)?tirage|tirage\s+.*num(?:e|é)ro|combien\s+.*tirage|compte\s+.*tirage)\b/i
      .test(String(value || ''));
  }

  function requestedDrawTime(question, memory, countryCode) {
    const normalized = normalizedQuestion(question);
    const match = normalized.match(/(?:a|à|vers|heure|horaire)\s*(\d{1,2})(?:\s*(?::|h|heures?)\s*(\d{2})?)?/i);
    if (match) {
      const hour = Number(match[1]);
      const minute = Number(match[2] || 0);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }
    const candidates = (memory?.series || []).filter((series) => (
      String(series?.countryCode || '').toUpperCase() === countryCode
    ));
    return candidates.length === 1 ? String(candidates[0].drawTime || '') : '';
  }

  function addDaysToIso(value, amount) {
    const date = new Date(`${value}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function requestedDrawDate(question, snapshot) {
    const normalized = normalizedQuestion(question);
    const explicit = normalized.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b/);
    if (explicit) {
      const date = normalizeDateInput(explicit[0]);
      if (date) return date;
    }
    const base = snapshot?.today || new Date().toISOString().slice(0, 10);
    if (/\b(aujourd'hui|aujourd hui|today)\b/i.test(normalized)) return base;
    if (/\b(hier|yesterday)\b/i.test(normalized)) return addDaysToIso(base, -1);
    const weekdays = {
      dimanche: 0,
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6
    };
    const weekdayName = Object.keys(weekdays).find((name) => normalized.includes(name));
    if (!weekdayName) return base;
    const current = new Date(`${base}T12:00:00.000Z`);
    const currentDay = current.getUTCDay();
    const wanted = weekdays[weekdayName];
    let delta = (wanted - currentDay + 7) % 7;
    if (/\b(prochain|prochaine|suivant|suivante|next)\b/i.test(normalized) && delta === 0) {
      delta = 7;
    }
    if (/\b(dernier|derniere|précédent|precedent|passé|passe)\b/i.test(normalized)) {
      delta = delta === 0 ? -7 : delta - 7;
    }
    return addDaysToIso(base, delta);
  }

  function drawNumberAnswer(question, snapshot) {
    if (!drawNumberQuestion(question)) return null;
    const memory = snapshot?.assistantContext?.drawNumberMemory;
    const country = requestedResultsCountry(question, snapshot);
    if (!country) {
      return 'Pour retrouver le numéro de tirage, indiquez d’abord le pays concerné.';
    }
    const countryCode = String(country.code || '').toUpperCase();
    const series = (memory?.series || []).filter((item) => (
      String(item?.countryCode || '').toUpperCase() === countryCode
    ));
    if (!series.length) {
      return `Je n’ai pas encore de routine confirmée pour ${country.name}. Je ne vais pas deviner : il me faut plusieurs résultats publiés avec leur date, leur heure et leur numéro de tirage.`;
    }
    const drawTime = requestedDrawTime(question, memory, countryCode);
    if (!drawTime) {
      return `J’ai plusieurs horaires mémorisés pour ${country.name}. Indiquez l’heure du tirage, par exemple « ${series[0].drawTime} », afin que je sélectionne la bonne routine.`;
    }
    const selected = series.find((item) => item.drawTime === drawTime);
    if (!selected) {
      return `Je n’ai pas encore assez d’historique publié pour ${country.name} à ${drawTime}. Je préfère demander une confirmation plutôt que d’inventer un numéro.`;
    }
    const targetDate = requestedDrawDate(question, snapshot);
    const exact = (selected.recent || []).find((row) => (
      row.date === targetDate && row.time === drawTime
    ));
    if (exact) {
      return `Pour ${country.name}, le tirage de ${targetDate} à ${drawTime} est déjà mémorisé comme publié : numéro de tirage ${exact.drawNumber}.`;
    }
    return `Le numéro de tirage de ${country.name} à ${drawTime} pour ${targetDate} n’est pas encore confirmé dans les publications reçues. Le serveur remplacera cette absence dès que le résultat officiel sera publié.`;
  }

  function publicVisitorAlternativeAnswer(question) {
    const text = String(question || '').toLowerCase();
    const functionGuide = publicFunctionGuideAnswer(question);
    if (functionGuide) return functionGuide;
    const siteGuide = publicSiteGuideAnswer(question);
    if (siteGuide) return siteGuide;
    const asksForPrivateTableau = /\b(matrice|tableau|intuition|oracle|universelle|universel|lnb|balsa|stand.?by|robot|statistique|analyse|recommandation|clé|cle|nap|satellite|combinaison)\b/i
      .test(text);
    const requested = asksForPrivateTableau
      ? 'Cette demande concerne une fonction ou une analyse réservée aux comptes et aux accès autorisés.'
      : 'Je ne peux pas traiter cette demande complète en mode visiteur.';
    return [
      requested,
      'Je peux toutefois vous aider immédiatement avec les informations publiques :',
      '• les dernières publications disponibles pour un pays ;',
      '• les résultats déjà publiés et confirmés ;',
      '• les horaires publics disponibles et la manière de transmettre un résultat.',
      'Pour consulter une Matrice, un Tableau, une clé ou des statistiques personnalisées, créez un compte ou connectez-vous. Je ne vais pas inventer une donnée qui n’est pas publique.'
    ].join('\n');
  }

  function publicFunctionGuideAnswer(question) {
    const program = requestedAccessProgram(question);
    if (!program) return null;
    const language = activeLocale().toLowerCase().split(/[-_]/)[0];
    const copy = {
      universelle: {
        fr: 'Universelle est une méthode générale de lecture et de calcul. Elle peut servir de point de départ, mais elle ne remplace pas les autres tableaux.',
        en: 'Universelle is a general reading and calculation method. It can be a starting point, but it does not replace the other tables.',
        es: 'Universal es un método general de lectura y cálculo. Puede servir como punto de partida, pero no sustituye a las demás tablas.',
        pt: 'Universal é um método geral de leitura e cálculo. Pode servir como ponto de partida, mas não substitui os outros quadros.',
        ar: 'العالمية طريقة عامة للقراءة والحساب. يمكن أن تكون نقطة بداية، لكنها لا تستبدل الجداول الأخرى.'
      },
      intuition: {
        fr: 'Intuition est un tableau indépendant qui doit être lu avec ses propres publications et son propre historique.',
        en: 'Intuition is an independent table and must be read with its own publications and history.',
        es: 'Intuición es una tabla independiente y debe leerse con sus propias publicaciones e historial.',
        pt: 'Intuição é um quadro independente e deve ser lido com as suas próprias publicações e histórico.',
        ar: 'الحدس جدول مستقل ويجب قراءته مع منشوراته وسجله الخاصين.'
      },
      oracle: {
        fr: 'Oracle est un tableau indépendant avec sa propre logique et ses propres publications.',
        en: 'Oracle is an independent table with its own logic and publications.',
        es: 'Oracle es una tabla independiente con su propia lógica y publicaciones.',
        pt: 'Oracle é um quadro independente com a sua própria lógica e publicações.',
        ar: 'أوراكل جدول مستقل بمنطقه ومنشوراته الخاصة.'
      },
      lnb: {
        fr: 'LNB est un tableau distinct. Ses observations et statistiques ne doivent pas être mélangées avec celles d’un autre programme.',
        en: 'LNB is a separate table. Its observations and statistics must not be mixed with another programme.',
        es: 'LNB es una tabla separada. Sus observaciones y estadísticas no deben mezclarse con otro programa.',
        pt: 'LNB é um quadro separado. As suas observações e estatísticas não devem ser misturadas com outro programa.',
        ar: 'LNB جدول منفصل، ولا يجوز خلط ملاحظاته وإحصاءاته مع برنامج آخر.'
      },
      balsa: {
        fr: 'Balsa Plus est un tableau distinct avec ses indicateurs propres et ses comparaisons autorisées.',
        en: 'Balsa Plus is a separate table with its own indicators and authorized comparisons.',
        es: 'Balsa Plus es una tabla separada con sus propios indicadores y comparaciones autorizadas.',
        pt: 'Balsa Plus é um quadro separado com os seus próprios indicadores e comparações autorizadas.',
        ar: 'بالسا بلاس جدول منفصل بمؤشراته ومقارناته المسموح بها.'
      },
      standby: {
        fr: 'Stand-by est un programme séparé. Il ne faut pas le confondre avec Anticipé, qui est un accès à des publications futures validées.',
        en: 'Stand-by is a separate programme. It must not be confused with Anticipé, which is access to validated future publications.',
        es: 'Stand-by es un programa separado. No debe confundirse con Anticipado, que es acceso a publicaciones futuras validadas.',
        pt: 'Stand-by é um programa separado. Não deve ser confundido com Antecipado, que é acesso a publicações futuras validadas.',
        ar: 'وضع الانتظار برنامج مستقل، ولا ينبغي الخلط بينه وبين الاستباقي الذي يتيح منشورات مستقبلية متحققاً منها.'
      },
      robot: {
        fr: 'Robot est un tableau indépendant. Le virtuel conserve ses valeurs séparées et n’utilise pas celles d’un autre tableau.',
        en: 'Robot is an independent table. The assistant keeps its values separate and does not use another table’s values.',
        es: 'Robot es una tabla independiente. El asistente mantiene sus valores separados y no usa los de otra tabla.',
        pt: 'Robot é um quadro independente. O assistente mantém os seus valores separados e não usa os de outro quadro.',
        ar: 'روبوت جدول مستقل ويحافظ المساعد على قيمه منفصلة ولا يستخدم قيم جدول آخر.'
      },
      created: {
        fr: 'Les programmes personnalisés sont des tableaux créés selon la configuration autorisée du compte.',
        en: 'Custom programmes are tables created according to the account’s authorized configuration.',
        es: 'Los programas personalizados son tablas creadas según la configuración autorizada de la cuenta.',
        pt: 'Os programas personalizados são quadros criados segundo a configuração autorizada da conta.',
        ar: 'البرامج المخصصة جداول تنشأ وفق إعدادات الحساب المسموح بها.'
      }
    };
    const text = copy[program.key]?.[language] || copy[program.key]?.fr;
    if (!text) return null;
    return [
      text,
      localeText({
        fr: 'Pour une valeur privée, connectez-vous puis ouvrez Catégories → Tableaux → ' + program.label + '. Les résultats publics d’un pays restent consultables séparément, quel que soit le pays de votre compte.',
        en: 'For a private value, sign in and open Categories → Tableaux → ' + program.label + '. Public results for a country remain separately searchable regardless of your account country.',
        es: 'Para un valor privado, inicia sesión y abre Categorías → Tablas → ' + program.label + '. Los resultados públicos de un país se pueden consultar por separado sin importar el país de tu cuenta.',
        pt: 'Para um valor privado, inicie sessão e abra Categorias → Quadros → ' + program.label + '. Os resultados públicos de um país continuam pesquisáveis independentemente do país da conta.',
        ar: 'للحصول على قيمة خاصة، سجّل الدخول وافتح الفئات ← الجداول ← ' + program.label + '. تبقى النتائج العامة لأي بلد قابلة للبحث بشكل منفصل مهما كان بلد الحساب.'
      })
    ].join('\n');
  }

  function publicSiteGuideAnswer(question) {
    const text = normalizedQuestion(question);
    const asksForGuide = /\b(big|fonction|fonctions?|funcion|funciones|funcoes|programmes?|programas?|tableaux?|tablas?|quadros?|methodes?|m[eé]todos?|grille|lecture|horaires?|fonctionnement|fonctionne|funcionamiento|funciona|funcionamento|navigation|guide|gu[ií]a|guia|aide|ayuda|ajuda|site|cidmap|offres?|ofertas?|abonnements?|suscripciones?|subscri[cç][oõ]es?|forfaits?|services?|servicios?|servi[cç]os?)\b/i
      .test(text);
    if (!asksForGuide) return null;

    const asksForPublishedLookup = /\b(resultats?|tirages?|numero(?:s)?|dernier|derniere|precis|precise|historique|archive)\b/i
      .test(text) && (
        countryCodeFromValue(question, { contains: true })
        || /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b|\b(aujourd hui|today|hier|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\b\d{1,2}\s*(?:h|heure|heures|:)\s*\d{0,2}\b/i.test(text)
      );
    if (asksForPublishedLookup) return null;

    const language = activeLocale().toLowerCase().split(/[-_]/)[0];
    const guides = {
      fr: [
        'Voici comment Cidmap est organisé :',
        '• Catégories et Offres : méthodes, abonnements et déblocages individuels.',
        '• Tableaux : Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by, Robot et programmes personnalisés.',
        '• Matrice puis Déchiffrement MT : calcul de la Matrice, 10 numéros, puis couples et groupes autorisés.',
        '• Croix nationale et Boules rejetées : méthodes indépendantes.',
        '• Résultat-Aide : résultats publiés, statistiques et transmission contrôlée.',
        '• Historiques et Anticipé : archives ou publications futures uniquement selon le droit correspondant.',
        'Le virtuel peut expliquer le rôle de chaque fonction et utiliser les données publiques de n’importe quel pays. Les valeurs privées restent limitées au tableau actif du compte.'
      ],
      en: [
        'Here is how Cidmap is organized:',
        '• Categories and Offers: methods, subscriptions and individual unlocks.',
        '• Tableaux: Universelle, Intuition, Oracle, LNB, Balsa Plus, Stand-by, Robot and custom programmes.',
        '• Matrice then Déchiffrement MT: the matrix, 10 numbers, then authorized pairs and groups.',
        '• Croix nationale and Rejected balls: independent methods.',
        '• Result help: published results, statistics and controlled submission.',
        '• History and Anticipé: archives or future publications only under the corresponding entitlement.',
        'The assistant can explain every function and use public data from any country. Private values remain limited to the account’s active table.'
      ],
      es: [
        'Así está organizado Cidmap:',
        '• Categorías y Ofertas: métodos, suscripciones y desbloqueos individuales.',
        '• Tablas: Universal, Intuición, Oracle, LNB, Balsa Plus, Stand-by, Robot y programas personalizados.',
        '• Matriz y después Descifrado MT: matriz, 10 números y luego parejas y grupos autorizados.',
        '• Cruz nacional y Bolas rechazadas: métodos independientes.',
        '• Ayuda de resultados: resultados publicados, estadísticas y envío controlado.',
        '• Historial y Anticipado: archivos o publicaciones futuras solo con el derecho correspondiente.',
        'El asistente puede explicar cada función y usar datos públicos de cualquier país. Los valores privados se limitan a la tabla activa de la cuenta.'
      ],
      pt: [
        'É assim que o Cidmap está organizado:',
        '• Categorias e Ofertas: métodos, subscrições e desbloqueios individuais.',
        '• Quadros: Universal, Intuição, Oracle, LNB, Balsa Plus, Stand-by, Robot e programas personalizados.',
        '• Matriz e depois Descodificação MT: matriz, 10 números e depois pares e grupos autorizados.',
        '• Cruz nacional e Bolas rejeitadas: métodos independentes.',
        '• Ajuda de resultados: resultados publicados, estatísticas e envio controlado.',
        '• Histórico e Antecipado: arquivos ou publicações futuras apenas com o direito correspondente.',
        'O assistente pode explicar cada função e usar dados públicos de qualquer país. Os valores privados ficam limitados ao quadro ativo da conta.'
      ],
      ar: [
        'هكذا تم تنظيم Cidmap:',
        '• الفئات والعروض: الطرق والاشتراكات وعمليات الفتح الفردية.',
        '• الجداول: العالمية، الحدس، أوراكل، LNB، بالسا بلاس، وضع الانتظار وروبوت والبرامج المخصصة.',
        '• المصفوفة ثم فك التشفير MT: المصفوفة والأرقام العشرة ثم الأزواج والمجموعات المسموح بها.',
        '• الصليب الوطني والكرات المستبعدة: طرق مستقلة.',
        '• مساعدة النتائج: النتائج المنشورة والإحصاءات والإرسال المنظم.',
        '• السجل والاستباقي: الأرشيف أو المنشورات المستقبلية وفق الصلاحية المناسبة فقط.',
        'يمكن للمساعد شرح كل وظيفة واستخدام البيانات العامة من أي بلد. أما القيم الخاصة فتبقى محصورة في الجدول النشط للحساب.'
      ]
    };
    return (guides[language] || guides.fr).join('\n');
  }

  function historyQuestionParams(question, snapshot) {
    const text = String(question || '').toLowerCase();
    const year = text.match(/\b(19|20)\d{2}\b/)?.[0] || '';
    const domain = /\b(croix|croix nationale)\b/i.test(text)
      ? 'cross'
      : /\b(matrice|matrices)\b/i.test(text)
        ? 'matrix'
        : /\b(boules?\s+rejet|num(?:e|é)ros?\s+rejet)\b/i.test(text)
          ? 'rejected'
          : /\b(résultat|resultat|résultats|resultats|tirage|archives?)\b/i.test(text)
            ? 'results'
            : '';
    if (!domain || (!year && !/\b(historique|archive|ancien|ancienne)\b/i.test(text))) {
      return null;
    }
    const country = requestedResultsCountry(question, snapshot);
    return {
      domain,
      countryCode: country?.code || '',
      fromDate: year ? `${year}-01-01` : '',
      toDate: year ? `${year}-12-31` : ''
    };
  }

  async function historyQuestionAnswer(question, snapshot) {
    const params = historyQuestionParams(question, snapshot);
    if (!params || typeof window.cidHistoryChatLookup !== 'function') return null;
    try {
      const result = await window.cidHistoryChatLookup(params);
      if (result?.requiresUnlock) {
        const rule = result.rule || {};
        const cost = rule.currency === 'stars'
          ? `${rule.requiredStars || 0} étoile(s)`
          : `${rule.requiredTokens || 0} jeton(s)`;
        return `J’ai trouvé la demande historique pour ${HISTORY_DOMAIN_LABELS[params.domain] || params.domain}, mais la période demandée dépasse la période gratuite (jusqu’au ${result.cutoffDate || 'seuil configuré'}). Vous pouvez débloquer uniquement cet historique pour ${cost}, pendant ${Number(rule.durationDays) || 30} jour(s), depuis le bouton Historiques. Je ne peux pas afficher les archives anciennes avant ce déblocage.`;
      }
      if (result?.configured === false) {
        return 'Cet historique n’est pas encore configuré par l’administration. Je peux consulter les résultats publics récents en attendant.';
      }
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      if (!rows.length) {
        return `Je n’ai trouvé aucune archive publiée pour cette recherche (${params.fromDate || 'période récente'} → ${params.toDate || 'aujourd’hui'}).`;
      }
      const preview = rows.slice(0, 12).map((row) => {
        if (params.domain === 'results') {
          const drawNumber = optionalDrawNumber(row.draw_number);
          return [
            row.draw_date,
            row.country_code,
            drawNumber === null ? '' : `tirage ${drawNumber}`,
            (row.first_numbers || []).join(' · ')
          ].filter(Boolean).join(' · ');
        }
        if (params.domain === 'cross') {
          return [
            row.programme_date,
            row.signature ? `signature ${row.signature}` : '',
            (row.assignment || []).length ? `croix ${(row.assignment || []).join(' · ')}` : ''
          ].filter(Boolean).join(' · ');
        }
        if (params.domain === 'matrix') {
          return `${row.programme_date} · ${Array.isArray(row.results) ? row.results.length : 0} programme(s) Matrice archivé(s)`;
        }
        return [
          row.programme_date,
          row.first_finish !== null && row.first_finish !== undefined && String(row.first_finish).trim() !== ''
            ? `finitions ${row.first_finish}${row.second_finish !== null && row.second_finish !== undefined && String(row.second_finish).trim() !== '' ? ` / ${row.second_finish}` : ''}`
            : ''
        ].filter(Boolean).join(' · ');
      });
      return [
        `${rows.length} archive(s) trouvée(s) pour ${HISTORY_DOMAIN_LABELS[params.domain] || params.domain}.`,
        ...preview,
        rows.length > preview.length ? `Les ${rows.length - preview.length} autres lignes sont disponibles dans la page Historiques.` : ''
      ].filter(Boolean).join('\n');
    } catch (error) {
      return error?.message || 'La recherche historique est momentanément indisponible.';
    }
  }

  function requestsAnalysis(value) {
    return /\b(analyse|analyser|comparaison|comparer|statistique|statistiques|tendance|tendances|pourcentage|pourcentages|historique|rejoue|revient|retour)\b/i
      .test(String(value || ''));
  }

  function countryPublishedRows(snapshot) {
    const context = snapshot?.assistantContext || {};
    const countryCode = String(
      context.userCountry
        || snapshot?.resultMetadata?.country?.code
        || ''
    ).toUpperCase();
    const rows = Array.isArray(snapshot?.publishedResults)
      ? snapshot.publishedResults
      : [];
    return {
      countryCode,
      rows: rows.filter((row) => (
        countryCode
          && String(row.countryCode || '').toUpperCase() === countryCode
      ))
    };
  }

  function missingScheduleNotice(snapshot) {
    const missing = Array.isArray(snapshot?.resultMetadata?.schedule)
      ? snapshot.resultMetadata.schedule.filter((slot) => slot?.recorded !== true)
      : [];
    if (!missing.length) return '';
    const labels = missing.map((slot) => {
      const time = String(slot?.time || '').slice(0, 5);
      return isEnglishLocale()
        ? (time ? `slot at ${time}` : 'slot without a time')
        : (time ? `créneau de ${time}` : 'créneau sans heure');
    });
    return interpolate(
      'assistant.missingSchedule',
      { slots: labels.join(', ') },
      isEnglishLocale()
        ? `Missing time slot(s) in memory: ${labels.join(', ')}.`
        : `Créneau(x) manquant(s) dans la mémoire : ${labels.join(', ')}.`
    );
  }

  function analysisMemoryGate(question, snapshot) {
    if (!requestsAnalysis(question)) return '';
    const { countryCode, rows } = countryPublishedRows(snapshot);
    if (!countryCode) {
      return translate(
        'assistant.askCountry',
        localeText({
          fr: 'Pour analyser les résultats, indiquez d’abord le pays.',
          en: 'To analyse results, first provide the country.',
          es: 'Para analizar los resultados, indica primero el país.',
          pt: 'Para analisar os resultados, indique primeiro o país.',
          ar: 'لتحليل النتائج، حدّد البلد أولاً.'
        })
      );
    }
    if (rows.length) return '';
      return [
        localeText({
          fr: `Aucun résultat mémorisé n’est disponible pour ${countryLabel(countryCode)}.`,
          en: `No memorized result is available for ${countryLabel(countryCode)}.`,
          es: `No hay ningún resultado memorizado disponible para ${countryLabel(countryCode)}.`,
          pt: `Não há nenhum resultado memorizado disponível para ${countryLabel(countryCode)}.`,
          ar: `لا توجد نتيجة محفوظة متاحة لـ ${countryLabel(countryCode)}.`
        }),
        snapshot?.canSubmitResult
          ? localeText({
            fr: 'Je ne peux pas encore faire une analyse. Transmettez d’abord un résultat complet avec sa date, son heure et ses numéros afin qu’il puisse être validé.',
            en: 'I cannot analyse it yet. First submit a complete result with its date, time and numbers so it can be verified.',
            es: 'Todavía no puedo analizarlo. Primero envía un resultado completo con su fecha, hora y números para que pueda verificarse.',
            pt: 'Ainda não posso analisá-lo. Primeiro envie um resultado completo com data, hora e números para que seja verificado.',
            ar: 'لا أستطيع تحليله بعد. أرسل أولاً نتيجة كاملة مع تاريخها ووقتها وأرقامها للتحقق منها.'
          })
          : localeText({
            fr: 'Je ne peux pas faire d’analyse sans données publiées. Connectez-vous pour transmettre un résultat.',
            en: 'I cannot analyse without published data. Sign in to submit a result.',
            es: 'No puedo analizar sin datos publicados. Inicia sesión para enviar un resultado.',
            pt: 'Não posso analisar sem dados publicados. Entre na sua conta para enviar um resultado.',
            ar: 'لا أستطيع التحليل من دون بيانات منشورة. سجّل الدخول لإرسال نتيجة.'
          }),
        localeText({
          fr: 'Autre possibilité : consultez la méthode Universelle et les offres configurées. Elle peut servir de point de départ pour plusieurs pays, mais elle ne crée pas un résultat absent.',
          en: 'You can also consult the Universal method and the configured offers. It can be a starting point for several countries, but it does not create a missing result.',
          es: 'También puedes consultar el método Universal y las ofertas configuradas. Puede servir de punto de partida para varios países, pero no crea un resultado ausente.',
          pt: 'Você também pode consultar o método Universal e as ofertas configuradas. Ele pode servir de ponto de partida para vários países, mas não cria um resultado ausente.',
          ar: 'يمكنك أيضاً consultar الطريقة الشاملة والعروض المهيأة. قد تكون نقطة بداية لعدة بلدان، لكنها لا تنشئ نتيجة غير موجودة.'
        }),
        localeText({
          fr: 'Un déblocage individuel donne accès au Tableau choisi. Un forfait collectif ne donne accès qu’aux Tableaux réellement inclus dans l’offre.',
          en: 'An individual unlock gives access to the selected Table. A collective plan only gives access to the Tables included in the offer.',
          es: 'El desbloqueo individual da acceso a la Tabla elegida. El plan colectivo solo da acceso a las Tablas incluidas en la oferta.',
          pt: 'Um desbloqueio individual dá acesso à Tabela escolhida. Um plano coletivo só dá acesso às Tabelas incluídas na oferta.',
          ar: 'يمنح الفتح الفردي الوصول إلى الجدول المختار. ولا يمنح الاشتراك الجماعي إلا الوصول إلى الجداول الموجودة في العرض.'
        })
      ].join('\n');
  }

  function countryLabel(code) {
    const labels = isEnglishLocale()
      ? {
        AO: 'Angola',
        BJ: 'Benin',
        CI: 'Côte d’Ivoire',
        CM: 'Cameroon',
        CH: 'Switzerland',
        GH: 'Ghana',
        NE: 'Niger',
        GN: 'Guinea',
        SN: 'Senegal',
        TG: 'Togo'
      }
      : {
        AO: 'Angola',
        BJ: 'Bénin',
        CI: "Côte d'Ivoire",
        CM: 'Cameroun',
        CH: 'Suisse',
        GH: 'Ghana',
        NE: 'Niger',
        GN: 'Guinée',
        SN: 'Sénégal',
        TG: 'Togo'
      };
    const normalizedCode = String(code || '').toUpperCase();
    const dynamic = countryDirectory().find((entry) => entry.code === normalizedCode);
    return dynamic?.names?.[0] || labels[normalizedCode] || normalizedCode;
  }

  function requestsTableauRecommendation(value) {
    return /\b(recommand(?:e|er|ation)?|conseil(?:le|ler)?|quel tableau|tableau adapté|tableau adapte|plus favorable|meilleur tableau|quel abonnement|forfait global|premium|abonnement|s'abonner|debloquer.*tableau|débloquer.*tableau)\b/i
      .test(String(value || ''));
  }

  function requestedRecommendationCountry(question, snapshot) {
    const normalized = normalizedQuestion(question);
    const aliases = Object.entries(COUNTRY_ALIASES)
      .filter(([label]) => label.length > 2)
      .sort((left, right) => right[0].length - left[0].length);
    for (const [label, code] of aliases) {
      if (normalized.includes(label)) {
        return { code, name: countryLabel(code) };
      }
    }
    const code = countryCodeFromValue(question, { contains: true });
    if (code) return { code, name: countryLabel(code) };
    const profile = snapshot?.resultMetadata?.country;
    const fallback = profile?.code || snapshot?.assistantContext?.userCountry;
    return fallback
      ? { code: String(fallback).toUpperCase(), name: countryLabel(fallback) }
      : null;
  }

  function recommendationOfferPrice(offer) {
    const price = offer?.price;
    if (!price) return 'tarif non renseigné dans le catalogue';
    if (String(price.label || '').trim()) return String(price.label).trim();
    const amount = Number(price.amount || 0);
    if (!price.configured || !amount) return 'tarif non renseigné dans le catalogue';
    return `${amount.toLocaleString(activeLocale())} ${
      price.currency === 'tokens' ? 'jetons' : 'étoiles'
    }`;
  }

  function recommendationOfferLine(offer, prefix = '') {
    if (!offer) return '';
    const features = Array.isArray(offer.features)
      ? offer.features.map((feature) => feature?.name || labelForProgram(feature?.key)).filter(Boolean)
      : [];
    const duration = Number(offer.durationDays || 0);
    const durationLabel = duration ? ` · ${duration} jours` : '';
    const bundleLabel = features.length > 1
      ? ` · inclut ${features.join(', ')}`
      : '';
    return `${prefix}${offer.name || 'Forfait'} — ${recommendationOfferPrice(offer)}${durationLabel}${bundleLabel}`;
  }

  function recommendationAnswer(question, snapshot) {
    if (!requestsTableauRecommendation(question)) return null;
    const projection = snapshot?.assistantContext?.recommendationProjection;
    if (!projection || !Array.isArray(projection.countries)) {
      if (snapshot?.visitor === 'visiteur public') return null;
      return 'Je ne peux pas vérifier la comparaison des tableaux pour le moment : la projection statistique publiée est indisponible.';
    }
    const country = requestedRecommendationCountry(question, snapshot);
    if (!country) {
      return 'Pour quel pays souhaitez-vous une recommandation ? Donnez son nom ou son code, par exemple Guinée (GN), Bénin (BJ), Côte d’Ivoire (CI), Ghana (GH), Niger (NE), Sénégal (SN) ou Togo (TG).';
    }
    const row = projection.countries.find((item) => (
      String(item?.countryCode || '').toUpperCase() === country.code
    ));
    const publishedDraws = Number(row?.publishedDraws || 0);
    const minimum = Number(projection.minimumPublishedDraws || 3);
    if (!row || publishedDraws === 0) {
      return `Je n’ai trouvé aucun résultat publié et confirmé pour ${country.name}. Je ne vais donc pas inventer de recommandation. Si vous pouvez fournir au moins ${minimum} jours consécutifs — idéalement une semaine complète — puis confirmer leur publication, je pourrai comparer les tableaux sur des données réelles.`;
    }
    if (!row.recommendation || row.sufficient !== true) {
      return `J’ai trouvé ${publishedDraws} résultat(s) publié(s) pour ${country.name}, mais pas encore assez d’observations comparables pour recommander honnêtement un tableau. Il me faut au moins ${minimum} jours consécutifs, et de préférence une semaine complète, avec des résultats confirmés.`;
    }
    const recommendation = row.recommendation;
    const groups = projection.offersByProgram?.[recommendation.programKey] || {};
    const individual = Array.isArray(groups.individual) ? groups.individual[0] : null;
    const bundles = Array.isArray(groups.bundles) ? groups.bundles.slice(0, 3) : [];
    const lines = [
      `Pour ${country.name}, j’ai comparé les statistiques agrégées disponibles à partir de ${publishedDraws} résultat(s) publié(s) et confirmé(s).`,
      `${recommendation.programName || labelForProgram(recommendation.programKey)} arrive actuellement en tête de l’historique : ${Number(recommendation.score || 0).toLocaleString(activeLocale(), { maximumFractionDigits: 1 })} % sur ${Number(recommendation.observations || 0)} observation(s).`,
      'C’est une indication historique, pas une garantie. Je ne vous oblige à aucun achat.'
    ];
    if (individual) {
      lines.push(`Option tableau seul : ${recommendationOfferLine(individual)}.`);
    }
    if (bundles.length) {
      lines.push('Options forfait configurées qui incluent ce tableau :');
      bundles.forEach((offer) => lines.push(`• ${recommendationOfferLine(offer)}`));
      lines.push('Un forfait permet de comparer séparément le tableau recommandé avec les autres tableaux réellement inclus, sans mélanger leurs statistiques.');
    }
    if (!individual && !bundles.length) {
      lines.push('Je ne trouve actuellement aucune offre configurée qui corresponde à ce tableau. Je ne vais pas inventer de prix ou de forfait ; consultez les offres publiées ou contactez le support.');
    }
    return lines.join('\n');
  }

  function requestsPersonalStatistics(value) {
    return /\b(mes statistiques|statistiques personnelles|mon historique depuis|depuis mon abonnement|depuis mon accès|depuis mon acces|depuis que je suis abonné|depuis que je suis abonne)\b/i
      .test(String(value || ''));
  }

  function personalStatisticsAnswer(question, snapshot) {
    if (!requestsPersonalStatistics(question)) return null;
    const period = snapshot?.assistantContext?.personalPeriodStatistics;
    if (!period?.available) {
      return 'Les statistiques globales publiées restent disponibles, mais je ne peux pas encore ouvrir une période personnelle : aucun début d’accès actif n’est vérifiable pour ce compte.';
    }
    const rows = Array.isArray(period.programmes) ? period.programmes : [];
    const periodLabel = `du ${period.from || 'début d’accès'}${period.to ? ` au ${period.to}` : ''}`;
    if (!rows.length) {
      return `Votre suivi personnel commence ${periodLabel}. Je n’ai pas encore d’observation publiée et autorisée dans cette période ; je conserverai les statistiques globales administrateur séparément.`;
    }
    return [
      `Votre suivi personnel recommence ${periodLabel}.`,
      ...rows.map((row) => (
        `${row.programName || labelForProgram(row.programKey)} : ${Number(row.percentage || 0).toLocaleString(activeLocale(), { maximumFractionDigits: 1 })} % sur ${Number(row.drawsEvaluated || 0)} tirage(s) et ${Number(row.observations || 0)} observation(s).`
      )),
      'Ces chiffres sont calculés uniquement avec les tableaux auxquels votre accès donne droit et les résultats publiés. L’historique global de l’administration reste conservé à part.'
    ].join('\n');
  }

  function openingMemoryMessage(snapshot) {
    const context = snapshot?.assistantContext || {};
    const countryCode = String(
      context.userCountry
        || snapshot?.resultMetadata?.country?.code
        || ''
    ).toUpperCase();
    if (!countryCode) {
      return translate(
        'assistant.opening',
        'Bonjour ! Je peux vous expliquer les méthodes de Cidmap, consulter les résultats publiés ou vous aider à transmettre un résultat. Que souhaitez-vous faire ?'
      );
    }

    const rows = (Array.isArray(snapshot?.publishedResults)
      ? snapshot.publishedResults
      : [])
      .filter((row) => String(row.countryCode || '').toUpperCase() === countryCode)
      .sort((left, right) => (
        `${right.date || ''} ${right.drawTime || ''}`.localeCompare(
          `${left.date || ''} ${left.drawTime || ''}`
        )
      ));
    const country = countryLabel(countryCode);
    if (!rows.length) {
      return `${assistantCopy(
        'assistant.recognizedCountry',
        'Pays reconnu',
        'Recognized country'
      )} : ${country}. ${translate(
        'assistant.noCountryMemory',
        isEnglishLocale()
          ? 'I do not have a memorized result for this country yet. Would you like to provide one with its date, time and numbers?'
          : 'Je ne trouve encore aucun résultat mémorisé pour ce pays. Souhaitez-vous renseigner un premier résultat avec sa date, son heure et ses numéros ?'
      )}${missingScheduleNotice(snapshot) ? `\n${missingScheduleNotice(snapshot)}` : ''}`;
    }

    const latest = rows[0];
    return [
      `${assistantCopy('assistant.recognizedCountry', 'Pays reconnu', 'Recognized country')} : ${country}.`,
      `${assistantCopy('assistant.latestMemorizedResult', 'Dernier résultat mémorisé', 'Latest memorized result')} : ${latest.date || '—'} · ${latest.drawTime || '—'}.`,
      `${assistantCopy('assistant.groupOne', 'Groupe 1', 'Group 1')} : ${(latest.firstNumbers || []).join(' · ') || '—'}${latest.machineNumbers?.length
        ? ` · ${assistantCopy('assistant.groupTwo', 'Groupe 2', 'Group 2')} : ${latest.machineNumbers.join(' · ')}`
        : ''}.`,
      missingScheduleNotice(snapshot),
      translate(
        'assistant.analysisPeriodPrompt',
        isEnglishLocale()
          ? 'Would you like to compare the last 3 days or the entire last week?'
          : 'Souhaitez-vous comparer les 3 derniers jours ou toute la dernière semaine ?'
      )
    ].filter(Boolean).join('\n');
  }

  function prepareMissingResultDraft(snapshot) {
    if (publicResultDraft || snapshot?.canSubmitResult !== true) return false;
    const context = snapshot?.assistantContext || {};
    const country = String(
      context.userCountry
        || snapshot?.resultMetadata?.country?.code
        || ''
    ).toUpperCase();
    const rows = (Array.isArray(snapshot?.publishedResults)
      ? snapshot.publishedResults
      : [])
      .filter((row) => String(row.countryCode || '').toUpperCase() === country);
    if (rows.length) return false;
    publicResultDraft = {
      stage: country ? 'date' : 'country',
      data: country ? { country } : {},
      metadata: snapshot?.resultMetadata || null
    };
    savePublicResultDraft();
    return true;
  }

  async function handlePublicResultInput(question, snapshot) {
    const text = String(question || '').trim();
    const lower = text.toLowerCase();
    const managementIntent = /\b(modif(?:ier|ication)?|corriger|rectifier|supprim(?:er|e)|effacer)\b/i.test(lower)
      && /\b(résultat|resultat|tirage|numéros?|donnee?s?|donnees?)\b/i.test(lower);
    const startsFlow = /(?:je veux|je souhaite|je vais|aidez[- ]moi à|permettez[- ]moi de)\s+(?:donner|envoyer|transmettre|renseigner|saisir|ajouter|partager|fournir)\b.{0,50}\b(?:résultat|resultat|tirage|pays|mémoire)\b|(?:envoyer|transmettre|renseigner|saisir|ajouter|partager|fournir)\b.{0,40}\b(?:résultat|resultat|tirage|pays|mémoire)\b|(?:résultat|resultat|tirage).{0,30}\b(?:envoyer|transmettre|renseigner|saisir|ajouter|partager|fournir)\b/.test(lower);

    if (publicResultDraft && managementIntent && publicResultDraft.stage !== 'manageConfirm') {
      publicResultDraft = null;
      savePublicResultDraft();
    }

    if (!publicResultDraft && managementIntent) {
      try {
        const editable = await invoke({ action: 'editable-draws' });
        const draws = Array.isArray(editable?.draws) ? editable.draws : [];
        if (!draws.length) {
          return 'Je ne trouve aucun résultat que votre compte peut modifier ou supprimer.';
        }
        const mode = /\b(supprim|effac)\w*/i.test(lower) ? 'delete' : 'edit';
        if (draws.length === 1) {
          const selected = draws[0];
          if (mode === 'delete') {
            publicResultDraft = {
              mode: 'delete',
              drawId: selected.id,
              stage: 'manageConfirm',
              data: { candidate: selected }
            };
            savePublicResultDraft();
            return `Vous demandez la suppression de ce résultat :\n${editableDrawLabel(selected)}\n\nRépondez « oui » pour confirmer la suppression, ou « non » pour annuler.`;
          }
          beginEditableDraft(selected);
          return `D’accord. Je renvoie le formulaire pour corriger ce résultat :\n${editableDrawLabel(selected)}\n\n${resultDraftQuestion()}`;
        }
        publicResultDraft = {
          mode,
          stage: 'manage',
          data: { candidates: draws.slice(0, 12) }
        };
        savePublicResultDraft();
        return `J’ai trouvé plusieurs résultats. Répondez avec le numéro de la ligne, la date et l’heure :\n${editableDrawChoices(draws)}\n\n${mode === 'delete' ? 'Quel résultat voulez-vous supprimer ?' : 'Quel résultat voulez-vous modifier ?'}`;
      } catch (error) {
        return error?.message || 'Je ne peux pas accéder à vos résultats pour le moment.';
      }
    }

    if (!publicResultDraft && startsFlow) {
      if (!snapshot?.canSubmitResult) {
        return 'Connectez-vous d’abord pour transmettre un résultat. Un compte connecté peut le renseigner ; selon son accès, il sera publié directement ou envoyé en attente de confirmation.';
      }
      const knownCountry = snapshot.resultMetadata?.country?.code || '';
      publicResultDraft = {
        stage: knownCountry ? 'date' : 'country',
        data: knownCountry
          ? { country: knownCountry, first: [], machine: [], bonus: [] }
          : { first: [], machine: [], bonus: [] },
        metadata: snapshot.resultMetadata || null
      };
      savePublicResultDraft();
      const countryNotice = knownCountry
        ? (isEnglishLocale()
          ? `The suggested country is ${snapshot.resultMetadata.country.name || knownCountry}; you can choose another country in the form.`
          : `Le pays suggéré est ${snapshot.resultMetadata.country.name || knownCountry} ; vous pouvez choisir un autre pays dans le formulaire.`)
        : '';
      const publicationNotice = snapshot?.autoPublishResult
        ? (isEnglishLocale()
          ? 'Because your access is active, the result will be published directly after your confirmation.'
          : 'Comme votre accès est actif, le résultat sera publié directement après votre confirmation.')
        : (isEnglishLocale()
          ? 'The result will be saved pending confirmation; it will not be public until an active subscriber or the administration confirms it.'
          : 'Le résultat sera enregistré en attente de confirmation ; il ne sera pas visible publiquement tant qu’un abonné actif ou l’administration ne l’aura pas confirmé.');
      return `${interpolate(
        'assistant.submitIntro',
        { notice: countryNotice },
        `D’accord. Tout se passe ici dans Cidmap virtuel. ${countryNotice} ${publicationNotice}`
      )}\n\n${resultDraftQuestion()}`;
    }

    if (!publicResultDraft) return null;

    if (publicResultDraft.stage === 'manage') {
      const selected = chooseEditableDraw(
        text,
        publicResultDraft.data?.candidates
      );
      if (!selected) {
        return `Je n’ai pas identifié le résultat. Répondez avec le numéro de la ligne, la date et l’heure :\n${editableDrawChoices(publicResultDraft.data?.candidates)}`;
      }
      if (publicResultDraft.mode === 'delete') {
        publicResultDraft.stage = 'manageConfirm';
        publicResultDraft.drawId = selected.id;
        publicResultDraft.data = { candidate: selected };
        savePublicResultDraft();
        return `Vous demandez la suppression de ce résultat :\n${editableDrawLabel(selected)}\n\nRépondez « oui » pour confirmer la suppression, ou « non » pour annuler.`;
      }
      beginEditableDraft(selected);
      return `D’accord. Je renvoie le formulaire pour corriger ce résultat :\n${editableDrawLabel(selected)}\n\n${resultDraftQuestion()}`;
    }

    if (publicResultDraft.stage === 'manageConfirm') {
      if (/\b(non|annul|stop)\b/i.test(lower)) {
        publicResultDraft = null;
        savePublicResultDraft();
        return 'La suppression est annulée.';
      }
      if (!/^(oui|ok|d'accord|d accord|confirmer|confirme)\b/i.test(lower)) {
        return 'Répondez « oui » pour confirmer la suppression, ou « non » pour annuler.';
      }
      try {
        const result = await invoke({
          action: 'delete-draw',
          drawId: publicResultDraft.drawId
        });
        publicResultDraft = null;
        savePublicResultDraft();
        publicAssistantSnapshotPromise = null;
        return result.message || 'Le résultat a été supprimé.';
      } catch (error) {
        return error?.message || 'La suppression n’a pas pu être effectuée.';
      }
    }

    if (/\b(annuler|stop|oublie)\b/i.test(lower)) {
      publicResultDraft = null;
      savePublicResultDraft();
      return 'La saisie du résultat est annulée. Vous pouvez continuer à me poser une question générale.';
    }

    if (publicResultDraft.stage === 'country') {
      const country = normalizeCountryInput(text);
      if (!country) return `${translate('assistant.countryUnknown', 'Je n’ai pas reconnu ce pays.')}\n\n${resultDraftQuestion()}`;
      publicResultDraft.data.country = country;
      publicResultDraft.stage = 'date';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'date') {
      const drawDate = normalizeDateInput(text);
      if (!drawDate) return `${translate('assistant.invalidDate', 'La date n’est pas valide.')}\n\n${resultDraftQuestion()}`;
      publicResultDraft.data.drawDate = drawDate;
      try {
        const metadata = await invoke({
          action: 'result-metadata',
          countryCode: publicResultDraft.data.country,
          drawDate
        });
        if (metadata?.ok) publicResultDraft.metadata = metadata;
      } catch (_) {
        // The configured schedule is helpful but must not block a subscriber
        // from reporting a valid result if the metadata request is unavailable.
      }
      publicResultDraft.stage = 'time';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'time') {
      const drawTime = normalizeTimeInput(text);
      if (!drawTime) return `${translate('assistant.invalidTime', 'L’heure n’est pas valide.')}\n\n${resultDraftQuestion()}`;
      const slots = Array.isArray(publicResultDraft.metadata?.schedule)
        ? publicResultDraft.metadata.schedule
        : [];
      const configuredSlot = slots.find((slot) => slot.time === drawTime);
      if (slots.length && !configuredSlot) {
        return `${translate('assistant.scheduleUnavailable', 'Cet horaire ne fait pas partie des tirages configurés pour ce pays.')}\n\n${resultDraftQuestion()}`;
      }
      const keepsOriginalSlot = publicResultDraft.mode === 'edit'
        && publicResultDraft.data.drawDate === publicResultDraft.data.originalDate
        && drawTime === publicResultDraft.data.originalTime;
      if (configuredSlot?.recorded && !keepsOriginalSlot) {
        return `${interpolate(
          'assistant.duplicateResult',
          { time: drawTime },
          `Le résultat de ${drawTime} est déjà enregistré pour cette date. Choisissez un autre créneau.`
        )}\n\n${resultDraftQuestion()}`;
      }
      publicResultDraft.data.drawTime = drawTime;
      publicResultDraft.stage = 'drawNumber';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'drawNumber') {
      const drawNumber = Number.parseInt(String(text).replace(/[^\d]/g, ''), 10);
      if (!Number.isInteger(drawNumber) || drawNumber < 0) {
        return `Indiquez un numéro de tirage entier valide.\n\n${resultDraftQuestion()}`;
      }
      publicResultDraft.data.drawNumber = drawNumber;
      publicResultDraft.stage = 'firstCount';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'firstCount') {
      const count = countInput(text);
      if (!count) return `Indiquez un nombre valide de numéros (entre 1 et 90).\n\n${resultDraftQuestion()}`;
      publicResultDraft.data.firstCount = count;
      publicResultDraft.stage = 'first';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'first') {
      const expected = Number(publicResultDraft.data.firstCount || 0);
      const numbers = numberListInput(text, expected);
      if (!expected || numbers.length !== expected) {
        return `J’ai besoin de ${expected || 'tous les'} numéros distincts entre 1 et 90.\n\n${resultDraftQuestion()}`;
      }
      publicResultDraft.data.first = numbers;
      publicResultDraft.stage = 'secondChoice';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'secondChoice') {
      if (/\b(oui|yes|avec)\b/i.test(lower)) {
        publicResultDraft.stage = 'secondCount';
      } else if (/\b(non|no|aucun|sans)\b/i.test(lower)) {
        publicResultDraft.data.machine = [];
        publicResultDraft.stage = 'bonusChoice';
      } else {
        return resultDraftQuestion();
      }
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'secondCount') {
      const count = countInput(text);
      if (!count) return `Indiquez un nombre valide de numéros (entre 1 et 90).\n\n${resultDraftQuestion()}`;
      publicResultDraft.data.secondCount = count;
      publicResultDraft.stage = 'second';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'second') {
      const expected = Number(publicResultDraft.data.secondCount || 0);
      const numbers = numberListInput(text, expected);
      if (!expected || numbers.length !== expected) {
        return `J’ai besoin de ${expected || 'tous les'} numéros distincts entre 1 et 90.\n\n${resultDraftQuestion()}`;
      }
      publicResultDraft.data.machine = numbers;
      publicResultDraft.stage = 'bonusChoice';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'bonusChoice') {
      if (/\b(oui|yes|avec)\b/i.test(lower)) {
        publicResultDraft.stage = 'bonusCount';
      } else if (/\b(non|no|aucun|sans)\b/i.test(lower)) {
        publicResultDraft.data.bonus = [];
        publicResultDraft.stage = 'confirm';
      } else {
        return resultDraftQuestion();
      }
      savePublicResultDraft();
      return publicResultDraft.stage === 'confirm'
        ? (isEnglishLocale()
          ? `Here is the prepared entry:\n${resultDraftSummary()}\n\nReply “yes” to confirm the submission, or “edit” to start again.`
          : `Voici la saisie préparée :\n${resultDraftSummary()}\n\nRépondez « oui » pour confirmer l’enregistrement, ou « modifier » pour recommencer.`)
        : resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'bonusCount') {
      const count = countInput(text);
      if (!count) return `Indiquez un nombre valide de bonus (entre 1 et 90).\n\n${resultDraftQuestion()}`;
      publicResultDraft.data.bonusCount = count;
      publicResultDraft.stage = 'bonus';
      savePublicResultDraft();
      return resultDraftQuestion();
    }

    if (publicResultDraft.stage === 'bonus') {
      const expected = Number(publicResultDraft.data.bonusCount || 0);
      const numbers = numberListInput(text, expected);
      if (!expected || numbers.length !== expected) {
        return `J’ai besoin de ${expected || 'tous les'} bonus distincts entre 1 et 90.\n\n${resultDraftQuestion()}`;
      }
      publicResultDraft.data.bonus = numbers;
      publicResultDraft.stage = 'confirm';
      savePublicResultDraft();
      return isEnglishLocale()
        ? `Here is the prepared entry:\n${resultDraftSummary()}\n\nReply “yes” to confirm the submission, or “edit” to start again.`
        : `Voici la saisie préparée :\n${resultDraftSummary()}\n\nRépondez « oui » pour confirmer l’enregistrement, ou « modifier » pour recommencer.`;
    }

    if (publicResultDraft.stage === 'confirm') {
      if (/\b(modifier|recommencer|corriger)\b/i.test(lower)) {
        const knownCountry = publicResultDraft.data.country || '';
      publicResultDraft = {
        stage: knownCountry ? 'date' : 'country',
        data: knownCountry
          ? { country: knownCountry, first: [], machine: [], bonus: [] }
          : { first: [], machine: [], bonus: [] },
        metadata: publicResultDraft.metadata || null
      };
        savePublicResultDraft();
        return `${translate('assistant.restart', 'D’accord, on recommence.')}\n\n${resultDraftQuestion()}`;
      }
      if (!/^(oui|ok|d'accord|d accord|confirmer|confirme)\b/i.test(lower)) {
        return resultDraftQuestion();
      }
      const payload = {
        action: publicResultDraft.mode === 'edit' ? 'update-draw' : 'submit-draw',
        ...(publicResultDraft.mode === 'edit'
          ? { drawId: publicResultDraft.drawId }
          : {}),
        countryCode: publicResultDraft.data.country,
        drawDate: publicResultDraft.data.drawDate,
        drawTime: publicResultDraft.data.drawTime,
        drawNumber: publicResultDraft.data.drawNumber,
        first: publicResultDraft.data.first.join(' '),
        machine: publicResultDraft.data.machine.join(' '),
        bonus: publicResultDraft.data.bonus.join(' '),
        inputSchema: {
          version: 1,
          groups: [
            {
              key: 'first',
              count: publicResultDraft.data.first.length,
              required: true
            },
            ...(publicResultDraft.data.machine.length
              ? [{
                key: 'second',
                count: publicResultDraft.data.machine.length,
                required: true
              }]
              : [])
          ],
          bonus: {
            enabled: publicResultDraft.data.bonus.length > 0,
            count: publicResultDraft.data.bonus.length
          }
        },
        source: 'public-virtual-assistant'
      };
      try {
        const wasEdit = publicResultDraft.mode === 'edit';
        const result = await invoke(payload);
        publicResultDraft = null;
        savePublicResultDraft();
        publicAssistantSnapshotPromise = null;
        return result.message
          || (wasEdit
            ? (isEnglishLocale() ? 'Result updated.' : 'Résultat modifié.')
            : (isEnglishLocale()
              ? 'Result received. It will be checked before publication.'
              : 'Résultat reçu. Il sera vérifié avant toute publication.'));
      } catch (error) {
        return error?.message
          || (isEnglishLocale()
            ? 'The entry could not be sent. No result was published.'
            : 'La saisie n’a pas pu être envoyée. Aucun résultat n’a été publié.');
      }
    }

    return null;
  }

  function publicVirtualUsage() {
    try { return Number(sessionStorage.getItem('cid-public-virtual-uses') || 0); }
    catch (_) { return 0; }
  }

  async function persistVirtualTurn(question, answer, snapshot = null, source = 'deterministic') {
    if (!question || !answer) return;
    try {
      const result = await invokeVirtualChat({
        sessionId: publicVirtualSessionId,
        localeCode: activeLocale(snapshot),
        message: question,
        answer,
        mode: 'record',
        source
      });
      publicVirtualSessionId = result?.sessionId || publicVirtualSessionId;
    } catch (_) {
      // Keep the specialized result flow usable when the persistence route is
      // unavailable during a staged deployment.
    }
  }

  function appendVirtualAssistantMessage(thread, text) {
    if (!thread) return null;
    const bubble = document.createElement('div');
    bubble.className = 'support-chat-message cid-virtual-message';
    bubble.innerHTML = `
      <div class="cid-virtual-message-author">
        <span class="cid-virtual-message-avatar">${virtualAssistantAvatar()}</span>
        <span>${virtualAssistantName()}</span>
      </div>
      <div class="cid-virtual-message-body">${formatVirtualMessage(text)}</div>`;
    thread.appendChild(bubble);
    return bubble;
  }

  function formatVirtualInline(value) {
    let html = escapeHtml(value);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(
      /^((?:Bonus|Groupe \d+|Date|Heure|Numéro de tirage|Statut|Pays|Clé|NAP\d+|Pourcentage|Résultat publié)\s*:)\s*/i,
      '<strong>$1</strong> '
    );
    return html;
  }

  function formatVirtualMessage(value) {
    const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
    const output = [];
    let list = [];
    const flushList = () => {
      if (!list.length) return;
      output.push(`<ul>${list.join('')}</ul>`);
      list = [];
    };
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }
      const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
      if (heading) {
        flushList();
        output.push(`<h3>${formatVirtualInline(heading[1])}</h3>`);
        return;
      }
      const bullet = trimmed.match(/^(?:[•*-])\s+(.+)$/);
      if (bullet) {
        list.push(`<li>${formatVirtualInline(bullet[1])}</li>`);
        return;
      }
      flushList();
      if (trimmed.endsWith(':') && trimmed.length <= 84) {
        output.push(`<h3>${formatVirtualInline(trimmed)}</h3>`);
      } else {
        output.push(`<p>${formatVirtualInline(trimmed)}</p>`);
      }
    });
    flushList();
    return output.join('');
  }

  function setVirtualTyping(thread, active) {
    if (!thread) return;
    const existing = thread.querySelector('[data-cid-virtual-typing]');
    if (!active) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const typing = document.createElement('div');
    typing.className = 'cid-virtual-typing';
    typing.dataset.cidVirtualTyping = 'true';
    typing.setAttribute('role', 'status');
    typing.innerHTML = `
      <span class="cid-virtual-message-avatar">${virtualAssistantAvatar()}</span>
      <span class="cid-virtual-typing-copy">
        <span>${virtualAssistantName()}</span>
        <span class="cid-virtual-typing-label">${escapeHtml(translate('assistant.typing', 'écrit'))}</span>
        <span class="cid-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </span>`;
    thread.appendChild(typing);
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }

  function renderPendingConfirmation(snapshot, thread) {
    const pending = snapshot?.pendingConfirmation;
    if (!pending || !thread || thread.querySelector('[data-pending-confirmation]')) return;
    const card = document.createElement('section');
    card.className = 'cid-pending-confirmation';
    card.dataset.pendingConfirmation = pending.id;
    card.innerHTML = `
      <strong>Résultat en attente pour ${escapeHtml(pending.country_code)}</strong>
      <p>${escapeHtml(pending.draw_date)} · ${escapeHtml(String(pending.draw_time || '').slice(0, 5))}</p>
      <p>Groupe 1 : ${escapeHtml((pending.first_numbers || []).join(' · '))}<br>
      ${pending.machine_numbers?.length
        ? `Groupe 2 : ${escapeHtml(pending.machine_numbers.join(' · '))}<br>`
        : ''}
      <span class="cid-pending-bonus-value">Bonus : ${escapeHtml((pending.bonus_numbers || []).join(' · ') || 'aucun')}</span></p>
      <p class="cid-pending-confirmation__question">Votre abonnement actif vous permet de vérifier ce résultat, quel que soit le pays concerné. Confirmez-vous ?</p>
      <div class="cid-pending-confirmation__actions">
        <button class="resultat-aide-button" type="button" data-pending-answer="yes">Oui, confirmer</button>
        <button class="resultat-aide-secondary" type="button" data-pending-answer="no">Non, refuser</button>
      </div>
      <p class="resultat-aide-status" data-pending-status role="status"></p>`;
    const status = card.querySelector('[data-pending-status]');
    card.querySelectorAll('[data-pending-answer]').forEach((button) => {
      button.addEventListener('click', async () => {
        const approved = button.dataset.pendingAnswer === 'yes';
        const buttons = card.querySelectorAll('button');
        buttons.forEach((item) => { item.disabled = true; });
        if (status) status.textContent = translate(
          'assistant.confirming',
          'Enregistrement de votre confirmation…'
        );
        try {
          const result = await invoke({
            action: 'confirm-draw',
            drawId: pending.id,
            approved
          });
          if (status) {
            status.textContent = result.message || (approved
              ? 'Résultat publié.'
              : 'Résultat refusé.');
            status.className = `resultat-aide-status ${approved ? 'is-success' : 'is-error'}`;
          }
          card.querySelector('.cid-pending-confirmation__question')?.remove();
          card.querySelector('.cid-pending-confirmation__actions')?.remove();
        } catch (error) {
          if (status) {
            status.textContent = error?.message || translate(
              'assistant.confirmationFailed',
              'La confirmation n’a pas pu être enregistrée.'
            );
            status.className = 'resultat-aide-status is-error';
          }
          buttons.forEach((item) => { item.disabled = false; });
        }
      });
    });
    thread.prepend(card);
  }

  function openPublicVirtualAccount() {
    const open = window.showProfileView || window.openInlineAuthPanel;
    if (typeof open === 'function') {
      Promise.resolve(open({ updateHistory: true })).catch(() => {});
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('section', 'profil');
    window.location.assign(url.toString());
  }

  function showPublicVirtualAuthGate(panel, snapshotState = 'visitor') {
    if (!panel) return;
    const accessNotice = panel.querySelector('#cidPublicVirtualAccess');
    const thread = panel.querySelector('#cidPublicVirtualThread');
    const form = panel.querySelector('#cidPublicVirtualForm');
    const resultForm = panel.querySelector('#cidStructuredResultForm');
    const resultAction = panel.querySelector('[data-cid-open-result-form]');
    const limit = panel.querySelector('#cidPublicVirtualLimit');
    const gateSlot = panel.querySelector('[data-cid-virtual-gate-slot]');
    thread?.setAttribute('hidden', '');
    thread?.setAttribute('aria-hidden', 'true');
    form?.setAttribute('hidden', '');
    form?.setAttribute('aria-hidden', 'true');
    resultForm?.setAttribute('hidden', '');
    resultForm?.setAttribute('aria-hidden', 'true');
    resultAction?.setAttribute('hidden', '');
    resultAction?.parentElement?.setAttribute('hidden', '');
    gateSlot?.removeAttribute('hidden');
    gateSlot?.querySelector('[data-cid-virtual-loading]')?.remove();
    if (limit) limit.textContent = '';
    if (accessNotice) {
      accessNotice.textContent = snapshotState === 'unavailable'
        ? translate('assistant.accountVerificationUnavailable', 'La vérification du compte est momentanément indisponible.')
        : translate('assistant.accountRequired', 'Le compte est requis pour entrer dans la conversation avec Cidmap virtuel.');
    }
    let gate = panel.querySelector('[data-public-virtual-auth-gate]');
    if (!gate) {
      gate = document.createElement('section');
      gate.className = 'cid-public-virtual__auth-gate';
      gate.dataset.publicVirtualAuthGate = 'true';
      gate.setAttribute('aria-labelledby', 'cidPublicVirtualAuthTitle');
      gate.innerHTML = `
        <div class="cid-public-virtual__auth-icon" aria-hidden="true">↗</div>
        <div>
          <h3 id="cidPublicVirtualAuthTitle">${escapeHtml(translate('assistant.openAccount', 'Ouvrez votre compte pour continuer'))}</h3>
          <p>${escapeHtml(translate('assistant.publicResultsOnly', 'Les visiteurs peuvent consulter les résultats déjà publiés. La conversation avec Cidmap virtuel est réservée aux comptes créés ou connectés.'))}</p>
          <button class="resultat-aide-button" type="button" data-public-virtual-auth>
            ${escapeHtml(translate('assistant.loginOrCreate', 'Créer un compte ou se connecter'))}
          </button>
        </div>`;
      gateSlot?.appendChild(gate)
        || panel.querySelector('.cid-public-virtual')?.appendChild(gate)
        || panel.appendChild(gate);
      gate.querySelector('[data-public-virtual-auth]')
        ?.addEventListener('click', openPublicVirtualAccount);
    }
    gate.hidden = false;
  }

  function showPublicVirtualChat(snapshot, panel) {
    const accessNotice = panel?.querySelector('#cidPublicVirtualAccess');
    const thread = panel?.querySelector('#cidPublicVirtualThread');
    const form = panel?.querySelector('#cidPublicVirtualForm');
    const resultAction = panel?.querySelector('[data-cid-open-result-form]');
    const gate = panel?.querySelector('[data-public-virtual-auth-gate]');
    const gateSlot = panel?.querySelector('[data-cid-virtual-gate-slot]');
    const signedIn = snapshot?.visitor === 'compte connecté';
    thread?.removeAttribute('hidden');
    thread?.setAttribute('aria-hidden', 'false');
    form?.removeAttribute('hidden');
    form?.setAttribute('aria-hidden', 'false');
    if (signedIn) {
      resultAction?.removeAttribute('hidden');
      resultAction?.parentElement?.removeAttribute('hidden');
    } else {
      resultAction?.setAttribute('hidden', '');
      resultAction?.parentElement?.setAttribute('hidden', '');
    }
    if (gate) gate.hidden = true;
    gateSlot?.setAttribute('hidden', '');
    // Access is verified in the background and explained contextually inside
    // the assistant answer. Keep the top of the conversation visually clean.
    if (accessNotice) accessNotice.textContent = '';
  }

  async function refreshPublicVirtualSession(panel) {
    if (!panel) return null;
    const thread = panel.querySelector('#cidPublicVirtualThread');
    const form = panel.querySelector('#cidPublicVirtualForm');
    const accessNotice = panel.querySelector('#cidPublicVirtualAccess');
    const gateSlot = panel.querySelector('[data-cid-virtual-gate-slot]');
    // Hide the conversation during every session refresh. This prevents a
    // signed-out visitor from seeing a stale authenticated chat while the
    // Supabase session is being restored.
    thread?.setAttribute('hidden', '');
    form?.setAttribute('hidden', '');
    gateSlot?.removeAttribute('hidden');
    if (gateSlot && !gateSlot.querySelector('[data-cid-virtual-loading]')) {
      gateSlot.innerHTML = `
        <div class="cid-virtual-loading" data-cid-virtual-loading role="status">
          ${escapeHtml(translate('assistant.loading', 'Connexion à Cidmap virtuel…'))}
        </div>`;
    }
    accessNotice?.setAttribute('aria-busy', 'true');
    if (accessNotice) accessNotice.textContent = translate(
      'assistant.accountVerification',
      'Vérification du compte…'
    );
    publicAssistantSnapshotPromise = readPublicAssistantSnapshot();
    try {
      const snapshot = await publicAssistantSnapshotPromise;
      const signedIn = snapshot?.visitor === 'compte connecté';
      if (publicVirtualAccountState !== signedIn) {
        publicVirtualHistory = [];
        publicVirtualSessionId = null;
        publicResultDraft = null;
        savePublicResultDraft();
        publicVirtualAccountState = signedIn;
      }
      accessNotice?.removeAttribute('aria-busy');
      if (!signedIn) {
        showPublicVirtualChat(snapshot, panel);
        if (thread && !thread.dataset.cidOpeningMemoryShown) {
          appendVirtualAssistantMessage(
            thread,
            'Bonjour ! La consultation du numéro de tirage est publique. Indiquez le pays et l’heure, par exemple : « numéro de tirage du Bénin aujourd’hui à 19 heures ». Pour les statistiques, les recommandations et la transmission de résultats, créez un compte ou connectez-vous.'
          );
          thread.dataset.cidOpeningMemoryShown = 'true';
        }
        return snapshot;
      }
      showPublicVirtualChat(snapshot, panel);
      try {
        const persisted = await invokeVirtualChat({
          sessionId: publicVirtualSessionId,
          localeCode: activeLocale(snapshot)
        }, 'GET');
        publicVirtualSessionId = persisted?.sessionId || publicVirtualSessionId;
        const savedMessages = Array.isArray(persisted?.messages) ? persisted.messages : [];
        if (thread && savedMessages.length) {
          thread.querySelectorAll(':scope > :not(.cid-virtual-result-action-bar)').forEach((node) => {
            node.remove();
          });
          savedMessages.forEach((message) => {
            if (message.role === 'assistant') {
              appendVirtualAssistantMessage(thread, message.content);
            } else if (message.role === 'user') {
              const bubble = document.createElement('div');
              bubble.className = 'support-chat-message is-user';
              bubble.innerHTML = `<span class="support-chat-message-author">Vous</span><p>${escapeHtml(message.content)}</p>`;
              thread.appendChild(bubble);
            }
          });
          thread.dataset.cidOpeningMemoryShown = 'true';
          publicVirtualHistory = savedMessages
            .slice(-8)
            .map((message) => ({ role: message.role, content: message.content }));
        }
      } catch (_) {
        // The current Supabase session remains usable if the optional D1
        // history route is not deployed yet.
      }
      refreshPendingConfirmation(snapshot, thread);
      if (thread && !thread.dataset.cidOpeningMemoryShown) {
        const opening = openingMemoryMessage(snapshot);
        appendVirtualAssistantMessage(
          thread,
          opening
        );
        thread.dataset.cidOpeningMemoryShown = 'true';
      }
      return snapshot;
    } catch (error) {
      accessNotice?.removeAttribute('aria-busy');
      showPublicVirtualAuthGate(panel, 'unavailable');
      return null;
    }
  }

  function refreshPendingConfirmation(snapshot, thread) {
    if (!thread) return;
    const previous = thread.querySelector('[data-pending-confirmation]');
    if (previous) previous.remove();
    renderPendingConfirmation(snapshot, thread);
  }

  function resultFormCountryOptions(selected = '') {
    return [
      ['BJ', 'Bénin'],
      ['CI', "Côte d'Ivoire"],
      ['GH', 'Ghana'],
      ['AO', 'Angola'],
      ['CM', 'Cameroun'],
      ['CH', 'Suisse'],
      ['NE', 'Niger'],
      ['GN', 'Guinée'],
      ['SN', 'Sénégal'],
      ['TG', 'Togo'],
      ['__custom', 'Autre pays…']
    ].map(([code, name]) => (
      `<option value="${code}"${code === selected ? ' selected' : ''}>${name}${code === '__custom' ? '' : ` (${code})`}</option>`
    )).join('');
  }

  function resultFormCountryCode(form) {
    const selected = String(form?.querySelector('[name="country"]')?.value || '').trim();
    if (selected !== '__custom') return selected;
    return normalizeCountryInput(form?.querySelector('[name="countryCustom"]')?.value || '');
  }

  function resultFormSyncCountryCustom(form) {
    const select = form?.querySelector('[name="country"]');
    const customPanel = form?.querySelector('[data-cid-custom-country]');
    const customInput = form?.querySelector('[name="countryCustom"]');
    const isCustom = select?.value === '__custom';
    if (customPanel) {
      customPanel.hidden = !isCustom;
      customPanel.setAttribute('aria-hidden', String(!isCustom));
    }
    if (customInput) {
      customInput.required = isCustom;
      if (!isCustom) customInput.value = '';
    }
  }

  function resultFormNumbers(value, max = 90) {
    return parseResultNumberTokens(value, max, { allowSingle: true });
  }

  function resultFormSetStatus(form, message = '', kind = '') {
    const status = form?.querySelector('[data-cid-result-form-status]');
    if (!status) return;
    status.textContent = message;
    status.className = `cid-virtual-result-form-status${kind ? ` is-${kind}` : ''}`;
  }

  function resultFormSyncOptional(form) {
    if (!form) return;
    ['second', 'bonus'].forEach((kind) => {
      const checkbox = form.querySelector(`[data-cid-result-enable="${kind}"]`);
      const section = form.querySelector(`[data-cid-result-section="${kind}"]`);
      const enabled = checkbox?.checked === true;
      if (section) section.hidden = !enabled;
      section?.setAttribute('aria-hidden', String(!enabled));
    });
  }

  const RESULT_COUNTRY_NAMES = Object.freeze({
    BJ: 'Bénin',
    CI: "Côte d'Ivoire",
    GH: 'Ghana',
    AO: 'Angola',
    CM: 'Cameroun',
    CH: 'Suisse',
    NE: 'Niger',
    GN: 'Guinée',
    SN: 'Sénégal',
    TG: 'Togo'
  });

  function formatResultNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number < 10
      ? `0${number}`
      : String(value ?? '');
  }

  /*
   * A draw number is a token, not a digit. Keep the raw value in the input
   * while the visitor is typing so that entering "04" never becomes "0 4"
   * and deleting never gets replaced by "00".
   *
   * Both forms are accepted:
   *   - separated tokens: "04 24 30", "04,24,30"
   *   - compact pairs:    "042430"
   * A final single digit is kept out of the preview until its pair is
   * complete. A standalone 1-digit number is accepted when the field is
   * committed (blur or submit) and is formatted with a leading zero.
   */
  function parseResultNumberTokens(value, max = 90, options = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    const hasSeparator = /[\s,;|+–—-]/.test(raw);
    const compactDigits = raw.replace(/[^\d]/g, '');
    const compactPairs = compactDigits.match(/\d{2}/g) || [];
    const chunks = hasSeparator
      ? raw.split(/[\s,;|+–—-]+/).filter(Boolean)
      : (compactPairs.length
        ? compactPairs
        : (options.allowSingle && /^\d$/.test(compactDigits) ? [compactDigits] : []));
    const tokens = [];
    chunks.forEach((chunk) => {
      const digits = String(chunk).replace(/[^\d]/g, '');
      if (!digits) return;
      const pieces = hasSeparator
        ? (digits.match(/\d{1,2}/g) || [])
        : [digits];
      pieces.forEach((piece) => {
        const number = Number(piece);
        if (Number.isInteger(number) && number >= 1 && number <= 90 && !tokens.includes(number)) {
          tokens.push(number);
        }
      });
    });
    return tokens.slice(0, max);
  }

  function renderResultNumberPills(input) {
    const preview = input?.parentElement?.querySelector('[data-cid-number-pills]');
    if (!preview) return;
    const numbers = parseResultNumberTokens(input.value, 90);
    const isBonus = input?.name === 'bonus';
    preview.innerHTML = numbers.map((number) => (
      `<span class="cid-result-number-pill${isBonus ? ' is-bonus' : ''}" aria-label="${escapeHtml(translate('Numéro', 'Numéro'))} ${number}">${escapeHtml(formatResultNumber(number))}</span>`
    )).join('');
  }

  function normalizeResultNumberInput(input) {
    if (!input) return;
    const raw = String(input.value || '').trim();
    if (!raw) {
      input.value = '';
      renderResultNumberPills(input);
      return;
    }
    const values = parseResultNumberTokens(raw, 90, { allowSingle: true });
    input.value = values
      .map((value) => formatResultNumber(value))
      .join(' ');
    renderResultNumberPills(input);
  }

  function formatResultNumberInputWhileTyping(input) {
    if (!input) return;
    // Do not rewrite input.value here. Rewriting during `input` breaks
    // backspace and makes a two-digit number look like two separate values.
    renderResultNumberPills(input);
  }

  function resultFormEnhanceNumberInputs(form) {
    form?.querySelectorAll('input[data-cid-number-input]').forEach((input) => {
      if (input.dataset.numberEnhanced === 'true') return;
      input.dataset.numberEnhanced = 'true';
      input.addEventListener('input', () => {
        formatResultNumberInputWhileTyping(input);
        const countField = form.querySelector(`[name="${input.dataset.countField}"]`);
        const expected = Number(countField?.value || 0);
        const current = parseResultNumberTokens(input.value, 90).length;
        if (expected > 0 && current >= expected) {
          const next = input.dataset.nextInput
            ? form.querySelector(`[name="${input.dataset.nextInput}"]`)
            : null;
          if (next && !next.closest('[hidden]')) {
            window.setTimeout(() => next.focus({ preventScroll: true }), 0);
          }
        }
      });
      input.addEventListener('blur', () => normalizeResultNumberInput(input));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          normalizeResultNumberInput(input);
          const next = input.dataset.nextInput
            ? form.querySelector(`[name="${input.dataset.nextInput}"]`)
            : form.querySelector('button[type="submit"]');
          next?.focus({ preventScroll: true });
        }
      });
      renderResultNumberPills(input);
    });
  }

  async function resultFormLoadSchedule(form) {
    const country = resultFormCountryCode(form);
    const date = String(form?.querySelector('[name="drawDate"]')?.value || '').trim();
    const timeSlot = form?.querySelector('[data-cid-result-time-control]');
    if (!timeSlot || !country || !date) return;
    const requestId = `${country}:${date}:${Date.now()}`;
    form.dataset.scheduleRequest = requestId;
    timeSlot.innerHTML = `
      <select name="drawTime" aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}">
        <option value="">Chargement des horaires…</option>
      </select>`;
    try {
      const metadata = await invoke({ action: 'result-metadata', countryCode: country, drawDate: date });
      if (form.dataset.scheduleRequest !== requestId) return;
      const slots = Array.isArray(metadata?.schedule) ? metadata.schedule : [];
      if (country === 'BJ') {
        const beninTime = String(slots[0]?.time || '00:00').slice(0, 5);
        timeSlot.innerHTML = `
          <select name="drawTime" aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}" disabled>
            <option value="${escapeHtml(beninTime)}">${escapeHtml(beninTime)} · Bénin</option>
          </select>
          <input type="hidden" name="drawTimeLocked" value="${escapeHtml(beninTime)}">
          <p class="cid-virtual-result-form-hint">Horaire prérempli et verrouillé pour le Bénin.</p>`;
      } else if (['CI', 'GH', 'GN', 'TG'].includes(country)) {
        const datalistId = `cidResultTimes-${country}`;
        timeSlot.innerHTML = `
          <input name="drawTime" type="time" required list="${datalistId}" aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}">
          <datalist id="${datalistId}">
            ${slots.map((slot) => `<option value="${escapeHtml(String(slot.time || '').slice(0, 5))}"></option>`).join('')}
          </datalist>
          <p class="cid-virtual-result-form-hint">Choisissez librement l’heure ; les horaires configurés sont proposés en suggestion.</p>`;
      } else if (slots.length) {
        timeSlot.innerHTML = `
          <select name="drawTime" aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}" required>
            <option value="">Choisir un horaire</option>
            ${slots.filter((slot) => !slot.recorded).map((slot) => (
              `<option value="${escapeHtml(String(slot.time || '').slice(0, 5))}">${escapeHtml(String(slot.time || '').slice(0, 5))}${slot.names?.length ? ` · ${escapeHtml(slot.names.join(', '))}` : ''}</option>`
            )).join('')}
          </select>`;
      } else {
        timeSlot.innerHTML = `
          <input name="drawTime" type="time" required aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}">
          <p class="cid-virtual-result-form-hint">Aucun horaire configuré pour ce pays et cette date. Vous pouvez saisir l’heure manuellement.</p>`;
      }
      form.dataset.loadedCountry = country;
      form.dataset.loadedDate = date;
      form.dataset.metadata = JSON.stringify(metadata || {});
    } catch (_) {
      if (form.dataset.scheduleRequest !== requestId) return;
      timeSlot.innerHTML = `
        <input name="drawTime" type="time" required aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}">
        <p class="cid-virtual-result-form-hint">Les horaires configurés ne sont pas disponibles. Saisissez l’heure manuellement.</p>`;
    }
  }

  function openStructuredResultForm(panel, snapshot) {
    const form = panel?.querySelector('#cidStructuredResultForm');
    const thread = panel?.querySelector('#cidPublicVirtualThread');
    const composer = panel?.querySelector('#cidPublicVirtualForm');
    const resultAction = panel?.querySelector('[data-cid-open-result-form]');
    if (!form) return;
    const profileCountry = String(
      snapshot?.resultMetadata?.country?.code
        || snapshot?.assistantContext?.userCountry
        || ''
    ).toUpperCase();
    const today = snapshot?.today || new Date().toISOString().slice(0, 10);
    const country = ['BJ', 'CI', 'GH', 'AO', 'GN', 'NE', 'SN', 'TG'].includes(profileCountry)
      ? profileCountry
      : '';
    const countryInput = form.querySelector('[name="country"]');
    const dateInput = form.querySelector('[name="drawDate"]');
    form.querySelector('[data-cid-result-form-inner]')?.reset();
    form.querySelectorAll('[data-cid-number-pills]').forEach((preview) => {
      preview.replaceChildren();
    });
    if (countryInput) countryInput.value = country;
    resultFormSyncCountryCustom(form);
    if (dateInput) dateInput.value = today;
    setStructuredResultReview(form, null);
    form.hidden = false;
    form.setAttribute('aria-hidden', 'false');
    thread?.setAttribute('hidden', '');
    thread?.setAttribute('aria-hidden', 'true');
    composer?.setAttribute('hidden', '');
    composer?.setAttribute('aria-hidden', 'true');
    resultAction?.setAttribute('hidden', '');
    resultAction?.parentElement?.setAttribute('hidden', '');
    resultFormSyncOptional(form);
    resultFormSetStatus(form, '');
    resultFormEnhanceNumberInputs(form);
    resultFormLoadSchedule(form);
    form.querySelector('[name="country"]')?.focus({ preventScroll: true });
  }

  function closeStructuredResultForm(panel) {
    const form = panel?.querySelector('#cidStructuredResultForm');
    const thread = panel?.querySelector('#cidPublicVirtualThread');
    const composer = panel?.querySelector('#cidPublicVirtualForm');
    const resultAction = panel?.querySelector('[data-cid-open-result-form]');
    form?.setAttribute('hidden', '');
    form?.setAttribute('aria-hidden', 'true');
    thread?.removeAttribute('hidden');
    thread?.setAttribute('aria-hidden', 'false');
    composer?.removeAttribute('hidden');
    composer?.setAttribute('aria-hidden', 'false');
    resultAction?.removeAttribute('hidden');
    resultAction?.parentElement?.removeAttribute('hidden');
  }

  function readStructuredResultPayload(form) {
    if (!form) return null;
    const value = (name) => String(form.querySelector(`[name="${name}"]`)?.value || '').trim();
    const selectedCountry = resultFormCountryCode(form);
    const firstCount = Number(value('firstCount'));
    const first = resultFormNumbers(value('first'), 90);
    const hasSecond = form.querySelector('[data-cid-result-enable="second"]')?.checked === true;
    const secondCount = Number(value('secondCount'));
    const second = hasSecond ? resultFormNumbers(value('second'), 90) : [];
    const hasBonus = form.querySelector('[data-cid-result-enable="bonus"]')?.checked === true;
    const bonusCount = Number(value('bonusCount'));
    const bonus = hasBonus ? resultFormNumbers(value('bonus'), 90) : [];
    const error = (message) => {
      resultFormSetStatus(form, message);
      return false;
    };
    const selectedTime = value('drawTime') || value('drawTimeLocked');
    const drawNumberText = value('drawNumber');
    const drawNumber = drawNumberText === '' ? null : Number(drawNumberText);
    if (!selectedCountry || !value('drawDate') || !selectedTime
      || (drawNumber !== null && (!Number.isInteger(drawNumber) || drawNumber < 0))) {
      return error('Choisissez le pays et l’heure du tirage. Le numéro de tirage est facultatif.');
    }
    if (!firstCount || first.length !== firstCount) {
      return error(`Les Gagnants doivent contenir exactement ${firstCount || 'le nombre indiqué'} numéro(s) distinct(s), entre 1 et 90.`);
    }
    if (hasSecond && (!secondCount || second.length !== secondCount)) {
      return error(`La Machine doit contenir exactement ${secondCount || 'le nombre indiqué'} numéro(s) distinct(s), entre 1 et 90.`);
    }
    if (hasBonus && (!bonusCount || bonus.length !== bonusCount)) {
      return error(`Le groupe bonus doit contenir exactement ${bonusCount || 'le nombre indiqué'} numéro(s) distinct(s), entre 1 et 90.`);
    }
    return {
      countryCode: selectedCountry,
      drawDate: value('drawDate'),
      drawTime: selectedTime,
      drawNumber,
      first,
      second,
      bonus
    };
  }

  function resultReviewNumberPills(numbers, isBonus = false) {
    return numbers.map((number) => (
      `<span class="cid-result-review-pill${isBonus ? ' is-bonus' : ''}">${escapeHtml(formatResultNumber(number))}</span>`
    )).join('');
  }

  function setStructuredResultReview(form, payload = null) {
    const entryFields = form?.querySelector('[data-cid-result-entry-fields]');
    const previewButton = form?.querySelector('[data-cid-result-preview]');
    const review = form?.querySelector('[data-cid-result-review]');
    if (!form || !entryFields || !previewButton || !review) return;
    const isReviewing = Boolean(payload);
    entryFields.hidden = isReviewing;
    previewButton.hidden = isReviewing;
    review.hidden = !isReviewing;
    review.setAttribute('aria-hidden', String(!isReviewing));
    if (!isReviewing) return;
    const setText = (selector, text) => {
      const target = review.querySelector(selector);
      if (target) target.textContent = text;
    };
    setText('[data-cid-review-country]', RESULT_COUNTRY_NAMES[payload.countryCode] || payload.countryCode);
    setText('[data-cid-review-date]', payload.drawDate);
    setText('[data-cid-review-time]', payload.drawTime);
    const drawNumberRow = review.querySelector('[data-cid-review-draw-number-row]');
    if (drawNumberRow) {
      const hasDrawNumber = payload.drawNumber !== null
        && payload.drawNumber !== undefined
        && String(payload.drawNumber).trim() !== '';
      drawNumberRow.hidden = !hasDrawNumber;
      drawNumberRow.setAttribute('aria-hidden', String(!hasDrawNumber));
    }
    if (payload.drawNumber !== null && payload.drawNumber !== undefined) {
      setText('[data-cid-review-draw-number]', String(payload.drawNumber));
    }
    const firstTarget = review.querySelector('[data-cid-review-first]');
    const secondTarget = review.querySelector('[data-cid-review-second]');
    const bonusTarget = review.querySelector('[data-cid-review-bonus]');
    if (firstTarget) firstTarget.innerHTML = resultReviewNumberPills(payload.first);
    if (secondTarget) {
      secondTarget.innerHTML = payload.second.length
        ? resultReviewNumberPills(payload.second)
        : '<span class="cid-result-review-empty">Aucun</span>';
    }
    if (bonusTarget) {
      bonusTarget.innerHTML = payload.bonus.length
        ? resultReviewNumberPills(payload.bonus, true)
        : '<span class="cid-result-review-empty">Aucun</span>';
    }
  }

  function previewStructuredResultForm(panel) {
    const form = panel?.querySelector('#cidStructuredResultForm');
    if (!form || form.dataset.sending === 'true') return;
    const payload = readStructuredResultPayload(form);
    if (!payload) return;
    resultFormSetStatus(form, '');
    setStructuredResultReview(form, payload);
    form.querySelector('[data-cid-review-publish]')?.focus({ preventScroll: true });
  }

  function editStructuredResultReview(form) {
    if (!form) return;
    setStructuredResultReview(form, null);
    resultFormSetStatus(form, '');
    form.querySelector('[name="first"]')?.focus({ preventScroll: true });
  }

  async function submitStructuredResultForm(panel) {
    const form = panel?.querySelector('#cidStructuredResultForm');
    if (!form || form.dataset.sending === 'true') return;
    const payload = readStructuredResultPayload(form);
    if (!payload) return;
    form.dataset.sending = 'true';
    const publish = form.querySelector('[data-cid-review-publish]');
    if (publish) publish.disabled = true;
    resultFormSetStatus(form, 'Transmission en cours…');
    try {
      const result = await invoke({
        action: 'submit-draw',
        countryCode: payload.countryCode,
        drawDate: payload.drawDate,
        drawTime: payload.drawTime,
        drawNumber: payload.drawNumber,
        first: payload.first.join(' '),
        machine: payload.second.join(' '),
        bonus: payload.bonus.join(' '),
        inputSchema: {
          version: 1,
          groups: [
            { key: 'first', count: payload.first.length, required: true },
            ...(payload.second.length ? [{ key: 'second', count: payload.second.length, required: true }] : [])
          ],
          bonus: { enabled: payload.bonus.length > 0, count: payload.bonus.length }
        },
        source: 'structured-result-form'
      });
      const thread = panel.querySelector('#cidPublicVirtualThread');
      appendVirtualAssistantMessage(
        thread,
        result.message || 'Le résultat a été transmis avec succès.'
      );
      closeStructuredResultForm(panel);
      publicAssistantSnapshotPromise = null;
      await refreshPublicVirtualSession(panel);
      resultFormSetStatus(form, '');
    } catch (submissionError) {
      resultFormSetStatus(
        form,
        submissionError?.message || 'La transmission n’a pas pu être effectuée. Vérifiez les champs et réessayez.'
      );
    } finally {
      form.dataset.sending = 'false';
      if (publish) publish.disabled = false;
    }
  }

  function renderPublicVirtual() {
    const panel = get('virtualAssistantViewMount') || get('categoriesVirtualPanel');
    if (!panel) return;
    if (panel.dataset.ready) {
      refreshPublicVirtualSession(panel);
      return;
    }
    panel.dataset.ready = 'true';
    // Keep the messenger styling active even when an older navigation path
    // mounts the assistant inside the categories host before the dedicated
    // route controller has finished applying its body state.
    if (!document.body.dataset.cidDedicatedView) {
      document.body.dataset.cidDedicatedView = 'virtual-assistant';
    }
    panel.dataset.renderedLocale = String(
      window.cidTranslation?.current?.() || 'fr'
    ).trim() || 'fr';
    panel.innerHTML = `
      <div class="cid-public-virtual cid-virtual-chat">
        <header class="cid-virtual-chat-header">
          <button class="cid-virtual-chat-back" type="button" data-cid-back-button="true" data-cid-virtual-back aria-label="${escapeHtml(translate('assistant.back', 'Retour aux catégories'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"></path></svg>
          </button>
          <span class="cid-virtual-profile-avatar">${virtualAssistantAvatar()}</span>
          <div class="cid-virtual-profile-copy">
            <h1 id="virtualAssistantViewTitle">${virtualAssistantName()}</h1>
            <p><span class="cid-virtual-online-dot"></span>${escapeHtml(translate('assistant.online', 'Assistant officiel · En ligne'))}</p>
          </div>
        </header>
        <div class="cid-virtual-chat-main">
          <p id="cidPublicVirtualAccess" class="cid-public-virtual__access" aria-live="polite"></p>
          <div class="cid-virtual-chat-gate-slot" data-cid-virtual-gate-slot>
            <div class="cid-virtual-loading" data-cid-virtual-loading role="status">
              ${escapeHtml(translate('assistant.loading', 'Connexion à Cidmap virtuel…'))}
            </div>
          </div>
          <div id="cidPublicVirtualThread" class="support-chat-thread" hidden aria-hidden="true">
            <div class="cid-virtual-result-action-bar" hidden>
              <button class="cid-virtual-result-action" type="button" data-cid-open-result-form hidden>
                ${escapeHtml(translate('assistant.submitResult', 'Transmettre un résultat'))}
              </button>
            </div>
          </div>
          <section id="cidStructuredResultForm" class="cid-virtual-result-form" hidden aria-hidden="true" aria-labelledby="cidStructuredResultTitle">
            <div class="cid-virtual-result-form-card">
              <div class="cid-virtual-result-form-heading">
                <div>
                  <h2 id="cidStructuredResultTitle">${escapeHtml(translate('assistant.submitResultTitle', 'Transmettre un résultat'))}</h2>
                  <p>${escapeHtml(translate('assistant.submitResultHelp', 'Renseignez les informations du tirage. Les horaires disponibles sont synchronisés avec la configuration actuelle.'))}</p>
                </div>
                <button class="cid-virtual-result-form-close" type="button" data-cid-close-result-form aria-label="${escapeHtml(translate('assistant.closeForm', 'Fermer le formulaire'))}">×</button>
              </div>
              <form data-cid-result-form-inner novalidate>
                <div data-cid-result-entry-fields>
                <div class="cid-virtual-result-form-grid">
                  <div class="cid-virtual-result-field">
                    <label for="cidResultCountry">${escapeHtml(translate('assistant.resultCountry', 'Pays'))}</label>
                    <select id="cidResultCountry" name="country" required>
                      <option value="">${escapeHtml(translate('assistant.chooseCountry', 'Choisir un pays'))}</option>
                      ${resultFormCountryOptions()}
                    </select>
                    <div data-cid-custom-country hidden aria-hidden="true">
                      <input id="cidResultCountryCustom" name="countryCustom" type="text" inputmode="text" autocomplete="country-name" placeholder="${escapeHtml(translate('assistant.customCountry', 'Nom ou code du pays (ex. Angola ou AO)'))}" aria-label="${escapeHtml(translate('Autre', 'Autre'))}">
                    </div>
                  </div>
                  <div class="cid-virtual-result-field">
                    <label for="cidResultDate">${escapeHtml(translate('assistant.resultDate', 'Date du tirage'))}</label>
                    <input id="cidResultDate" name="drawDate" type="date" required>
                  </div>
                  <div class="cid-virtual-result-field">
                    <label for="cidResultDrawNumber">${escapeHtml(translate('assistant.drawNumber', 'Numéro de tirage'))}</label>
                  <input id="cidResultDrawNumber" name="drawNumber" type="number" min="0" step="1" inputmode="numeric" placeholder="${escapeHtml(translate('assistant.optionalDrawNumber', 'Facultatif — ex. 2710'))}">
                  </div>
                  <div class="cid-virtual-result-field is-wide">
                    <label>${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}</label>
                    <div data-cid-result-time-control>
                      <input name="drawTime" type="time" required aria-label="${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}">
                    </div>
                  </div>
                </div>

                <div class="cid-virtual-result-form-section">
                  <span class="cid-virtual-result-group-title">${escapeHtml(translate('assistant.winnersGroup', 'Gagnants'))}</span>
                  <div class="cid-virtual-result-group">
                    <div class="cid-virtual-result-field">
                      <label for="cidResultFirstCount">${escapeHtml(translate('assistant.numberCount', 'Nombre'))}</label>
                      <input id="cidResultFirstCount" name="firstCount" type="number" min="1" max="90" step="1" value="5" required>
                    </div>
                    <div class="cid-virtual-result-field">
                      <label for="cidResultFirst">${escapeHtml(translate('assistant.numbers', 'Numéros'))}</label>
                      <input id="cidResultFirst" name="first" type="text" inputmode="numeric" data-cid-number-input data-count-field="firstCount" data-next-input="second" placeholder="${escapeHtml(translate('assistant.firstNumbersPlaceholder', 'Ex. 04 18 27 36 72'))}" required>
                      <div class="cid-result-number-pills" data-cid-number-pills aria-live="polite"></div>
                    </div>
                  </div>
                  <p class="cid-virtual-result-form-hint">${escapeHtml(translate('assistant.numbersHint', 'Écrivez chaque numéro en entier (ex. 04 24 30), séparé par un espace ou une virgule. Chaque numéro doit être distinct et compris entre 1 et 90.'))}</p>
                </div>

                <label class="cid-virtual-result-optional">
                  <input type="checkbox" data-cid-result-enable="second">
                  <span>${escapeHtml(translate('assistant.hasMachineGroup', 'Ajouter la Machine'))}</span>
                </label>
                <div class="cid-virtual-result-form-section" data-cid-result-section="second" hidden aria-hidden="true">
                  <span class="cid-virtual-result-group-title">${escapeHtml(translate('assistant.machineGroup', 'Machine'))}</span>
                  <div class="cid-virtual-result-group">
                    <div class="cid-virtual-result-field">
                      <label for="cidResultSecondCount">${escapeHtml(translate('assistant.numberCount', 'Nombre'))}</label>
                      <input id="cidResultSecondCount" name="secondCount" type="number" min="1" max="90" step="1" value="5">
                    </div>
                    <div class="cid-virtual-result-field">
                      <label for="cidResultSecond">${escapeHtml(translate('assistant.numbers', 'Numéros'))}</label>
                      <input id="cidResultSecond" name="second" type="text" inputmode="numeric" data-cid-number-input data-count-field="secondCount" data-next-input="bonus" placeholder="${escapeHtml(translate('assistant.secondNumbersPlaceholder', 'Ex. 03 11 22 48 69'))}">
                      <div class="cid-result-number-pills" data-cid-number-pills aria-live="polite"></div>
                    </div>
                  </div>
                </div>

                <label class="cid-virtual-result-optional">
                  <input type="checkbox" data-cid-result-enable="bonus">
                  <span>${escapeHtml(translate('assistant.hasBonus', 'Ajouter un groupe bonus'))}</span>
                </label>
                <div class="cid-virtual-result-form-section" data-cid-result-section="bonus" hidden aria-hidden="true">
                  <span class="cid-virtual-result-group-title">${escapeHtml(translate('assistant.bonusGroup', 'Groupe bonus'))}</span>
                  <div class="cid-virtual-result-group">
                    <div class="cid-virtual-result-field">
                      <label for="cidResultBonusCount">${escapeHtml(translate('assistant.numberCount', 'Nombre'))}</label>
                      <input id="cidResultBonusCount" name="bonusCount" type="number" min="1" max="90" step="1" value="1">
                    </div>
                    <div class="cid-virtual-result-field">
                      <label for="cidResultBonus">${escapeHtml(translate('assistant.numbers', 'Numéros'))}</label>
                      <input id="cidResultBonus" name="bonus" type="text" inputmode="numeric" data-cid-number-input data-count-field="bonusCount" placeholder="${escapeHtml(translate('assistant.bonusNumbersPlaceholder', 'Ex. 09'))}">
                      <div class="cid-result-number-pills" data-cid-number-pills aria-live="polite"></div>
                    </div>
                  </div>
                </div>
                </div>

                <p class="cid-virtual-result-form-status" data-cid-result-form-status role="status" aria-live="polite"></p>
                <button class="resultat-aide-button cid-virtual-result-form-submit" type="button" data-cid-result-preview>
                  ${escapeHtml(translate('assistant.previewResult', 'Voir le récapitulatif'))}
                </button>
                <section class="cid-result-review" data-cid-result-review hidden aria-hidden="true" aria-labelledby="cidResultReviewTitle">
                  <div class="cid-result-review-heading">
                    <div>
                      <h3 id="cidResultReviewTitle">${escapeHtml(translate('assistant.resultSummary', 'Récapitulatif du résultat'))}</h3>
                      <p>${escapeHtml(translate('assistant.resultSummaryHelp', 'Vérifiez l’organisation des numéros avant de publier.'))}</p>
                    </div>
                  </div>
                  <dl class="cid-result-review-meta">
                    <div><dt>${escapeHtml(translate('assistant.resultCountry', 'Pays'))}</dt><dd data-cid-review-country></dd></div>
                    <div><dt>${escapeHtml(translate('assistant.resultDate', 'Date du tirage'))}</dt><dd data-cid-review-date></dd></div>
                    <div><dt>${escapeHtml(translate('assistant.resultTime', 'Heure du tirage'))}</dt><dd data-cid-review-time></dd></div>
                  <div data-cid-review-draw-number-row hidden aria-hidden="true"><dt>${escapeHtml(translate('assistant.drawNumber', 'Numéro de tirage'))}</dt><dd data-cid-review-draw-number></dd></div>
                  </dl>
                  <div class="cid-result-review-groups">
                    <div class="cid-result-review-group">
                      <strong>${escapeHtml(translate('assistant.winnersGroup', 'Gagnants'))}</strong>
                      <div class="cid-result-review-pills" data-cid-review-first></div>
                    </div>
                    <div class="cid-result-review-group">
                      <strong>${escapeHtml(translate('assistant.machineGroup', 'Machine'))}</strong>
                      <div class="cid-result-review-pills" data-cid-review-second></div>
                    </div>
                    <div class="cid-result-review-group is-bonus">
                      <strong>${escapeHtml(translate('assistant.bonusGroup', 'Groupe bonus'))}</strong>
                      <div class="cid-result-review-pills" data-cid-review-bonus></div>
                    </div>
                  </div>
                  <div class="cid-result-review-actions">
                    <button class="cid-result-review-edit" type="button" data-cid-review-edit>
                      ${escapeHtml(translate('assistant.editResult', 'Modifier la saisie'))}
                    </button>
                    <button class="resultat-aide-button cid-result-review-publish" type="button" data-cid-review-publish>
                      ${escapeHtml(translate('assistant.publishResult', 'Publier le résultat'))}
                    </button>
                  </div>
                </section>
              </form>
            </div>
          </section>
          <p id="cidPublicVirtualLimit" class="resultat-aide-status"></p>
          <form id="cidPublicVirtualForm" class="support-chat-compose" hidden aria-hidden="true">
            <textarea name="question" rows="1" maxlength="1000" inputmode="text" enterkeyhint="send" placeholder="${escapeHtml(translate('assistant.messagePlaceholder', 'Écrire un message…'))}" aria-label="${escapeHtml(translate('assistant.messageLabel', 'Écrire un message'))}"></textarea>
            <button class="cid-virtual-compose-icon cid-virtual-mic-button" type="button" data-cid-virtual-mic aria-label="${escapeHtml(translate('assistant.dictate', 'Dicter un message'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"></path></svg>
            </button>
            <button class="resultat-aide-button cid-virtual-send-button" type="submit" aria-label="${escapeHtml(translate('assistant.send', 'Envoyer le message'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 4 18 8-18 8 3.5-8L3 4Z"></path><path d="M6 12h15"></path></svg>
            </button>
          </form>
        </div>
      </div>`;
    const form = get('cidPublicVirtualForm');
    const structuredForm = get('cidStructuredResultForm');
    const structuredFormInner = structuredForm?.querySelector('[data-cid-result-form-inner]');
    const textarea = form?.querySelector('textarea');
    const submit = form?.querySelector('button[type="submit"]');
    const thread = get('cidPublicVirtualThread');
    const limit = get('cidPublicVirtualLimit');
    const accessNotice = get('cidPublicVirtualAccess');
    const chat = panel.querySelector('.cid-virtual-chat');
    const micButton = panel.querySelector('[data-cid-virtual-mic]');
    const resultAction = panel.querySelector('[data-cid-open-result-form]');
    applyVirtualAssistantCrossColor(panel);
    const syncComposerMode = () => {
      chat?.classList.toggle('is-composing', Boolean(textarea?.value.trim()));
    };

    const syncVisibleChatHeight = () => {
      if (!chat) return;
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const top = Math.max(0, Number(viewport?.offsetTop) || 0);
      const visibleHeight = Math.max(220, Math.round(height));
      const surface = document.getElementById('virtualAssistantViewContainer') || panel;
      surface.style.setProperty('--cid-visible-chat-top', `${Math.round(top)}px`);
      surface.style.setProperty('--cid-visible-chat-height', `${visibleHeight}px`);
      chat.style.setProperty('--cid-visible-chat-height', `${visibleHeight}px`);
    };
    syncVisibleChatHeight();
    syncComposerMode();
    if (!panel.dataset.viewportSyncBound) {
      panel.dataset.viewportSyncBound = 'true';
      window.visualViewport?.addEventListener('resize', syncVisibleChatHeight);
      window.visualViewport?.addEventListener('scroll', syncVisibleChatHeight);
      window.addEventListener('resize', syncVisibleChatHeight);
    }

    panel.querySelector('[data-cid-virtual-back]')?.addEventListener('click', () => {
      if (typeof window.cidNavigateBack === 'function') {
        window.cidNavigateBack();
      } else {
        window.showCategoriesView?.();
      }
    });
    resultAction?.addEventListener('click', async () => {
      const snapshot = await (publicAssistantSnapshotPromise || readPublicAssistantSnapshot());
      if (snapshot?.visitor === 'compte connecté') {
        openStructuredResultForm(panel, snapshot);
      } else {
        showPublicVirtualAuthGate(panel, 'visitor');
      }
    });
    panel.querySelector('[data-cid-close-result-form]')?.addEventListener('click', () => {
      closeStructuredResultForm(panel);
    });
    structuredFormInner?.addEventListener('submit', (event) => {
      event.preventDefault();
      previewStructuredResultForm(panel);
    });
    structuredForm?.querySelector('[data-cid-result-preview]')?.addEventListener('click', () => {
      previewStructuredResultForm(panel);
    });
    structuredForm?.querySelector('[data-cid-review-edit]')?.addEventListener('click', () => {
      editStructuredResultReview(structuredForm);
    });
    structuredForm?.querySelector('[data-cid-review-publish]')?.addEventListener('click', () => {
      submitStructuredResultForm(panel);
    });
    structuredForm?.querySelectorAll('[data-cid-result-enable]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => resultFormSyncOptional(structuredForm));
    });
    structuredForm?.querySelector('[name="country"]')?.addEventListener('change', () => {
      resultFormSyncCountryCustom(structuredForm);
      resultFormLoadSchedule(structuredForm);
    });
    structuredForm?.querySelector('[name="countryCustom"]')?.addEventListener('input', () => {
      resultFormLoadSchedule(structuredForm);
    });
    structuredForm?.querySelector('[name="drawDate"]')?.addEventListener('change', () => {
      resultFormLoadSchedule(structuredForm);
    });
    micButton?.addEventListener('click', () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        textarea?.focus({ preventScroll: true });
        if (limit) limit.textContent = translate(
          'assistant.dictationUnavailable',
          'La dictée n’est pas disponible sur ce navigateur.'
        );
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = document.documentElement.lang || activeLocale();
      recognition.interimResults = false;
      recognition.onstart = () => micButton.classList.add('is-listening');
      recognition.onend = () => micButton.classList.remove('is-listening');
      recognition.onerror = () => micButton.classList.remove('is-listening');
      recognition.onresult = (event) => {
        const spoken = String(event.results?.[0]?.[0]?.transcript || '').trim();
        if (!spoken || !textarea) return;
        textarea.value = `${textarea.value.trim()}${textarea.value.trim() ? ' ' : ''}${spoken}`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus({ preventScroll: true });
      };
      try { recognition.start(); } catch (_) {}
    });

    refreshPublicVirtualSession(panel);

    const updateLimit = () => {
      const used = publicVirtualUsage();
      const remaining = Math.max(0, PUBLIC_VIRTUAL_LIMIT - used);
      if (limit) {
        limit.textContent = remaining === 0
          ? translate('assistant.sessionLimit', 'La limite de questions pour cette session est atteinte.')
          : '';
      }
      if (submit) {
        submit.disabled = remaining === 0 || !String(textarea?.value || '').trim();
      }
    };
    updateLimit();
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form?.dataset.sending === 'true') return;
      const question = String(textarea?.value || '').trim();
      if (!question || publicVirtualUsage() >= PUBLIC_VIRTUAL_LIMIT) return;
      if (form) form.dataset.sending = 'true';
      let responseSnapshot = null;
      try {
        const isResultTurn = Boolean(publicResultDraft)
          || /résultat|resultat|tirage|publier|envoyer|ajouter.*pays|mémoire/i.test(question);
        if (!isResultTurn || publicVirtualAccountState !== true) {
          const used = publicVirtualUsage() + 1;
          try { sessionStorage.setItem('cid-public-virtual-uses', String(used)); } catch (_) {}
          publicVirtualHistory = [
            ...publicVirtualHistory,
            { role: 'user', content: question }
          ].slice(-8);
        }
        const userBubble = document.createElement('div');
        userBubble.className = 'support-chat-message is-user';
        userBubble.innerHTML = `<span class="support-chat-message-author">Vous</span><p>${escapeHtml(question)}</p>`;
        thread?.appendChild(userBubble);
        if (textarea) textarea.value = '';
        if (textarea) {
          textarea.style.height = 'auto';
        }
        syncComposerMode();
        if (submit) submit.disabled = true;
        setVirtualTyping(thread, true);
        thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
        /*
         * A conversation turn must use a fresh authorized snapshot. The
         * opening snapshot is only for first paint and must not become the
         * source of truth for later questions.
         */
        const freshSnapshot = await readPublicAssistantSnapshot();
        const snapshot = freshSnapshot
          || await (publicAssistantSnapshotPromise || Promise.resolve(null));
        responseSnapshot = snapshot;
        const signedIn = snapshot?.visitor === 'compte connecté';
        if (!snapshot) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(
            thread,
            'Je ne peux pas vérifier les données publiques pour le moment. Réessayez dans un instant.'
          );
          return;
        }
        /*
         * The browser snapshot is useful for immediate rendering, but it is
         * not an authority. Every connected turn performs a server-side
         * Supabase access check before any local deterministic answer can
         * expose a Tableau, key or statistic.
         */
        let verifiedSnapshot = snapshot;
        if (signedIn) {
          const verification = await invokeVirtualChat({
            sessionId: publicVirtualSessionId,
            localeCode: activeLocale(snapshot),
            message: question,
            context: snapshot,
            mode: 'verify',
            source: 'access-preflight'
          });
          if (verification?.accessVerified !== true) {
            throw new Error(translate(
              'assistant.rightsVerificationFailed',
              'La vérification des droits est momentanément indisponible. Réessayez dans un instant.'
            ));
          }
          const verifiedContext = verification.verifiedContext || {};
          const verifiedAssistantContext = verification.assistantContext || {};
          verifiedSnapshot = {
            ...snapshot,
            userRole: verifiedContext.userRole || snapshot.userRole,
            subscriptionTier: verifiedContext.subscriptionTier || '',
            subscriptionStatus: verifiedContext.subscriptionStatus || 'none',
            allowedPrograms: Array.isArray(verifiedContext.allowedPrograms)
              ? verifiedContext.allowedPrograms
              : [],
            assistantAccess: verification.access || snapshot.assistantAccess,
            subscription: verification.access?.subscription
              ? {
                name: verification.access.subscription.planName || 'Forfait actif',
                expiresAt: verification.access.subscription.expiresAt || null
              }
              : null,
            publishedResults: Array.isArray(verifiedContext.publishedResults)
              ? verifiedContext.publishedResults
              : [],
            assistantContext: {
              ...(snapshot.assistantContext || {}),
              ...verifiedAssistantContext
            }
          };
          responseSnapshot = verifiedSnapshot;
        }
        const effectiveSnapshot = verifiedSnapshot;
        const ethicalAnswer = certaintyAnswer(question);
        if (ethicalAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, ethicalAnswer);
          if (signedIn) {
            void persistVirtualTurn(question, ethicalAnswer, effectiveSnapshot, 'ethics');
          }
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const catalogueSnapshot = asksSubscriptionQuestion(question)
          ? await refreshSubscriptionCatalogue(effectiveSnapshot)
          : effectiveSnapshot;
        const catalogueAnswer = subscriptionPriceAnswer(question, catalogueSnapshot);
        if (catalogueAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, catalogueAnswer);
          if (signedIn) {
            void persistVirtualTurn(question, catalogueAnswer, effectiveSnapshot, 'catalogue');
          }
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const accountAccessAnswer = accessAnswer(question, effectiveSnapshot);
        if (accountAccessAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, accountAccessAnswer);
          if (signedIn) {
            void persistVirtualTurn(question, accountAccessAnswer, effectiveSnapshot, 'access-state');
          }
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const protectedAnswer = protectedDataAccessAnswer(question, effectiveSnapshot);
        if (protectedAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, protectedAnswer);
          void persistVirtualTurn(question, protectedAnswer, effectiveSnapshot, 'protected-access');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const structuredIntent = !publicResultDraft
          && /\b(transmettre|envoyer|saisir|renseigner|ajouter|partager)\b/i.test(question)
          && /\b(résultat|resultat|tirage)\b/i.test(question);
        if (structuredIntent) {
          if (!signedIn) {
            setVirtualTyping(thread, false);
            appendVirtualAssistantMessage(thread, publicVisitorAlternativeAnswer(question));
            thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
            return;
          }
          setVirtualTyping(thread, false);
          openStructuredResultForm(panel, effectiveSnapshot);
          appendVirtualAssistantMessage(
            thread,
            translate(
              'assistant.formOpened',
              'Le formulaire de transmission est ouvert. Les champs sont organisés par groupe et les horaires sont synchronisés avec la configuration actuelle.'
            )
          );
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        if (isGreetingOnly(question)) {
          setVirtualTyping(thread, false);
          const answer = translate(
            'assistant.greetingResponse',
            'Bonjour ! Que souhaitez-vous faire ou savoir ?'
          );
          appendVirtualAssistantMessage(thread, answer);
          void persistVirtualTurn(question, answer, snapshot, 'greeting');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const intakeAnswer = await handlePublicResultInput(question, effectiveSnapshot);
        if (intakeAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, intakeAnswer);
          void persistVirtualTurn(question, intakeAnswer, snapshot, 'result-intake');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const personalStatistics = personalStatisticsAnswer(question, effectiveSnapshot);
        if (personalStatistics) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, personalStatistics);
          void persistVirtualTurn(question, personalStatistics, snapshot, 'personal-statistics');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const drawNumber = drawNumberAnswer(question, effectiveSnapshot);
        if (drawNumber) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, drawNumber);
          void persistVirtualTurn(question, drawNumber, snapshot, 'draw-number-memory');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const historyAnswer = await historyQuestionAnswer(question, effectiveSnapshot);
        if (historyAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, historyAnswer);
          void persistVirtualTurn(question, historyAnswer, snapshot, 'history-search');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        /*
         * A named Tableau owns the conversation turn. Do this before the
         * public-results handler so a question such as "détails sur
         * Intuition" cannot fall through to the unrelated generic
         * "résultats publiés" answer.
         */
        const tableauAnswer = tableauQuestionAnswer(question, effectiveSnapshot);
        if (tableauAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, tableauAnswer);
          void persistVirtualTurn(question, tableauAnswer, snapshot, 'tableau-context');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const recommendation = recommendationAnswer(question, effectiveSnapshot);
        if (recommendation) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, recommendation);
          void persistVirtualTurn(question, recommendation, snapshot, 'tableau-recommendation');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const publishedAnswer = publishedResultsAnswer(question, effectiveSnapshot);
        if (publishedAnswer) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, publishedAnswer);
          void persistVirtualTurn(question, publishedAnswer, snapshot, 'published-results');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const memoryGate = analysisMemoryGate(question, effectiveSnapshot);
        if (memoryGate) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, memoryGate);
          void persistVirtualTurn(question, memoryGate, snapshot, 'memory-gate');
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        if (!signedIn) {
          setVirtualTyping(thread, false);
          appendVirtualAssistantMessage(thread, publicVisitorAlternativeAnswer(question));
          thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          return;
        }
        const localeCode = activeLocale(snapshot);
        const result = await invokeVirtualChat({
          sessionId: publicVirtualSessionId,
          localeCode,
          message: question,
            context: {
            ...effectiveSnapshot,
            currentSurface: window.__currentCategory || 'virtual-assistant',
            siteSurfaces: [
              'Accueil',
              'Catégories',
              'Tableaux',
              'Matrice',
              'Déchiffrement MT',
              'Croix nationale',
              'Boules rejetées',
              'Anticipé',
              'Résultat-Aide',
              'Historiques',
              'Compte'
            ]
          },
          source: 'public-virtual-assistant'
        });
        publicVirtualSessionId = result?.sessionId || publicVirtualSessionId;
        const answer = String(result?.answer || 'Je peux vous présenter les méthodes générales de Cidmap.');
        publicVirtualHistory = [...publicVirtualHistory, { role: 'assistant', content: answer }].slice(-8);
        setVirtualTyping(thread, false);
        appendVirtualAssistantMessage(thread, answer);
        thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
      } catch (error) {
        setVirtualTyping(thread, false);
        const message = databaseOnlyAnswer(question, responseSnapshot)
          || 'J’ai consulté les données autorisées, mais je n’ai pas trouvé de réponse vérifiable pour cette demande.';
        appendVirtualAssistantMessage(thread, message);
        if (limit) limit.textContent = '';
      } finally {
        setVirtualTyping(thread, false);
        if (form) form.dataset.sending = 'false';
        updateLimit();
      }
    });
    textarea?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      form?.requestSubmit();
    });
    textarea?.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 116)}px`;
      syncComposerMode();
      updateLimit();
    });
    textarea?.addEventListener('focus', () => {
      // Let iOS finish its keyboard resize before keeping the newest message
      // and the active composer visible, just like a native messenger.
      window.requestAnimationFrame(() => {
        thread?.scrollTo({ top: thread.scrollHeight, behavior: 'auto' });
        syncVisibleChatHeight();
      });
    });
  }

  window.cidShowResultatAide = renderPanel;
  window.cidShowGlobalStatistics = renderGlobalStatisticsPanel;
  window.cidShowPublicVirtual = renderPublicVirtual;
  window.addEventListener('cidgroup:illustrations-updated', () => {
    applyVirtualAssistantCrossColor();
    const published = get('resultatAidePublished');
    if (published?.__resultPublishedDraws) {
      renderPublishedDraws(published.__resultPublishedDraws);
    }
  });
  window.addEventListener('cid:resultat-aide-show', renderPanel);
  window.addEventListener('cid:language-change', (event) => {
    const resultPanel = get('resultatAideViewMount') || get('categoriesResultatPanel');
    if (resultPanel?.dataset.ready) {
      delete resultPanel.dataset.ready;
      renderPanel();
    }
    const statisticsPanel = get('globalStatisticsViewMount');
    if (statisticsPanel?.dataset.ready) {
      delete statisticsPanel.dataset.ready;
      renderGlobalStatisticsPanel();
    }
    const panel = get('virtualAssistantViewMount') || get('categoriesVirtualPanel');
    if (!panel?.dataset.ready) return;
    const nextLocale = String(
      event.detail?.locale
        || window.cidTranslation?.current?.()
        || document.documentElement?.lang
        || localStorage.getItem('cid_i18n_locale')
        || 'fr'
    ).trim() || 'fr';
    // Loading the account/catalogue can emit a language-change event even
    // when the locale did not actually change. Rebuilding the messenger for
    // that event would call refreshPublicVirtualSession again, which reloads
    // the catalogue and creates an endless loading loop.
    if (panel.dataset.renderedLocale === nextLocale) return;
    // Rebuild the small messenger shell so placeholders, status labels and
    // the first assistant message use the newly selected catalog.
    delete panel.dataset.ready;
    renderPublicVirtual();
  });
})();
