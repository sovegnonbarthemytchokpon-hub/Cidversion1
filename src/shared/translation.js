/*
 * Cidmap translation boundary.
 *
 * There is intentionally one client-side translation runtime. Supabase can
 * override these stable browser phrases through site-config, while this
 * catalogue keeps the public site usable when translation_entries is empty.
 * Technical identifiers, programme keys, URLs and numeric results are never
 * passed through this layer.
 */
(function initTranslationBoundary() {
  'use strict';

  const FALLBACK_LOCALE = 'fr';
  const LOCAL_CATALOGS = {
    fr: '/locales/fr.json',
    en: '/locales/en.json',
    es: '/locales/es.json',
    pt: '/locales/pt.json',
    ar: '/locales/ar.json'
  };
  const LANGUAGE_STORAGE_KEY = 'cid_i18n_locale';
  const LEGACY_LANGUAGE_STORAGE_KEY = 'userLang';

  // Keys are the French source phrase used by the existing templates. Keeping
  // the source phrase as the key lets older dynamically-created DOM continue
  // to work while it is progressively moved to data-i18n keys.
  const ENGLISH = {
    'Accueil': 'Home',
    'Catégories': 'Categories',
    'Tableaux': 'Tables',
    'Matrice': 'Matrix',
    'Croix': 'Cross',
    'Croix nationale': 'National Cross',
    'Numéros rejetés': 'Rejected numbers',
    'Boules rejetées': 'Rejected balls',
    'Horaires': 'Schedule',
    'Horaires des programmes': 'Program schedules',
    'Pays': 'Country',
    'Tous les pays': 'All countries',
    'Tous': 'All',
    'Compte': 'Account',
    'Connexion': 'Login',
    'Se connecter': 'Log in',
    "Se connecter / S'inscrire": 'Log in / Sign up',
    "S'inscrire": 'Sign up',
    "S'inscrire / lier avec Google": 'Sign up / Link with Google',
    'Se connecter avec Google': 'Sign in with Google',
    'Déconnexion': 'Log out',
    'Partager': 'Share',
    'Partager avec votre lien': 'Share with your link',
    'partage': 'share',
    'partages': 'shares',
    'Solde': 'Balance',
    'Jetons': 'Tokens',
    'Étoiles': 'Stars',
    'Notifications': 'Notifications',
    'Actions principales': 'Main actions',
    'Barre de catégories': 'Category bar',
    'Plant du pied': 'Footer navigation',
    'Sections disponibles': 'Available sections',
    'Afficher les tableaux': 'Show tables',
    'Ouvrir mon compte': 'Open my account',
    'Voir mon solde': 'View my balance',
    'Voir mon solde d’étoiles et de jetons': 'View my stars and token balance',
    'Ouvrir les notifications': 'Open notifications',
    'Changer de langue': 'Change language',
    'Changer de langue — Anglais': 'Change language — English',
    'Changer de langue — Français': 'Change language — French',
    'Bouton Nationale': 'National button',
    'Retour à la page précédente': 'Back to the previous page',
    'Retour à la page précédente': 'Back to the previous page',
    'Toutes': 'All',
    'Non lues': 'Unread',
    'Tout marquer comme lu': 'Mark all as read',
    'Aucune notification': 'No notifications',
    'Vous êtes à jour.': 'You are up to date.',
    'Recherche': 'Search',
    'Rechercher produits, programmes, pays...': 'Search products, programmes, countries...',
    'Rechercher une langue...': 'Search for a language...',
    'Choisir la langue': 'Choose a language',
    'Langue': 'Language',
    'Choisir': 'Choose',
    'Détecter automatiquement': 'Detect automatically',
    'Retour': 'Back',
    'Fermer': 'Close',
    'Annuler': 'Cancel',
    'Continuer': 'Continue',
    'Copier': 'Copy',
    'Copier le lien': 'Copy link',
    'Copier tous': 'Copy all',
    'Copier tous les résultats': 'Copy all results',
    'Copier résultats': 'Copy results',
    'Copier la clé': 'Copy key',
    'Copie impossible': 'Copy failed',
    'Copié': 'Copied',
    'Voir plus': 'See more',
    'Aide': 'Help',
    'Nos réseaux': 'Our social networks',
    'Déchiffrement MT': 'MT decoding',
    'Déchiffrement avancé': 'Advanced decoding',
    'Anticiper': 'Preview',
    'Anticiper les tableaux': 'Preview the tables',
    'Anticipation inactive': 'Preview unavailable',
    'Générer la clé': 'Generate key',
    'Choisir une date': 'Choose a date',
    'Sélectionner une date': 'Select a date',
    'historique matrice': 'Matrix history',
    'Fermer la fenêtre des résultats': 'Close results window',
    'Résultat du calcul': 'Calculation result',
    'Résultat — 10 numéros': 'Result — 10 numbers',
    'Les résultats sont insérés automatiquement; modifiez-les ou effacez-les si nécessaire.': 'The 10 numbers are used by default; replace them with your manual selection if you prefer.',
    'Utilisez les 10 numéros proposés ou saisissez-les directement.': 'The 10 calculated numbers are prefilled; replace them with as many distinct numbers as you want.',
    '10 numéros à analyser (facultatif)': 'Numbers to analyse (optional)',
    'Collez la Matrice / Clavier / Cerveau (texte brut)': 'Paste the Matrix / Keyboard / Brain (plain text)',
    'Ajouter à l’écran d’accueil': 'Add to home screen',
    "Ajouter à l'écran d'accueil": 'Add to home screen',
    'Sur l’écran d’accueil': 'On the home screen',
    "Sur l'écran d'accueil": 'On the home screen',
    'J’ai compris': 'Got it',
    "J'ai compris": 'Got it',
    'Enregistrer': 'Save',
    'Calculer': 'Calculate',
    'Effacer': 'Clear',
    'Passer': 'Skip',
    'Autre': 'Other',
    'Code': 'Code',
    'Event': 'Event',
    'Vos 10 numéros': 'Your 10 numbers',
    'Les 10 numéros calculés': 'The 10 calculated numbers',
    'Les numéros sont prêts pour Déchiffrement avancé.': 'The numbers are ready for Advanced decoding.',
    'Aucune donnée disponible.': 'No data available.',
    'Aucun programme disponible.': 'No programme available.',
    'Aucun programme disponible pour ce pays.': 'No programme is available for this country.',
    'Programme du jour': 'Programme of the day',
    'Programmes créés': 'Created programmes',
    'Clés et numéros du jour': 'Today’s keys and numbers',
    'Tableaux du jour': 'Today’s tables',
    'Matrice du jour': 'Today’s matrix',
    'Boules rejetées du jour': 'Today’s rejected balls',
    'Tableaux de': 'Tables for',
    'Matrice de': 'Matrix for',
    'Boules rejetées de': 'Rejected balls for',
    'Croix nationale pour le #divertissement': 'National Cross for #entertainment',
    'Matrice du jour sur Cidmap': 'Today’s matrix on Cidmap',
    'Boules rejetées du jour sur Cidmap': 'Today’s rejected balls on Cidmap',
    'Tableaux du jour sur Cidmap': 'Today’s tables on Cidmap',
    'Horaires des programmes sur Cidmap': 'Programme schedules on Cidmap',
    'Horaires des programmes de': 'Programme schedules for',
    'Horaires des programmes — tous les pays': 'Programme schedules — all countries',
    'Votre matrice d’aujourd’hui': 'Your matrix for today',
    "Votre matrice d'aujourd'hui": 'Your matrix for today',
    'Résultats pour :': 'Results for:',
    'Numéro de tirage :': 'Draw number:',
    'Créneaux horaires disponibles': 'Available time slots',
    'Voir le programme': 'View programme',
    'Terminaison': 'Terminal',
    'Terminal': 'Terminal',
    'NATIONALE': 'NATIONAL',
    'Nationale': 'National',
    'Notre site officiel : www.cidmap.com': 'Official website: www.cidmap.com',
    'Notre site fonctionne. Allez sur www.cidmap.com': 'Our website is working. Visit www.cidmap.com',
    'Pour installer Cidmap comme une application native :': 'To install Cidmap as a native app:',
    'Sur Android (Chrome/Edge) : appuyez sur': 'On Android (Chrome/Edge), tap',
    'Sur iOS (Safari) : appuyez sur le bouton de partage (⬆︎) puis choisissez': 'On iOS (Safari), tap the share button (⬆︎), then choose',
    'dans la barre du navigateur ou utilisez le menu ⋮ →': 'in the browser bar or use the ⋮ menu →',
    'Méthode de la Croix Nationale — Mode d’emploi (version actualisée)': 'National Cross Method — Instructions (updated)',
    "Méthode de la Croix Nationale — Mode d'emploi (version actualisée)": 'National Cross Method — Instructions (updated)',
    'La méthode de la Croix Nationale est protégée.': 'The National Cross Method is protected.',
    'Les programmes affichés sont validés par le serveur officiel.': 'The displayed programmes are validated by the official server.',
    'Couleurs de la Croix (par jour)': 'Cross colours (by day)',
    'Bienvenue — Choisissez votre pays et langue': 'Welcome — Choose your country and language',
    '-- Sélectionner --': '-- Select --',
    'Nom du pack': 'Pack name',
    'Quantité de jetons': 'Token quantity',
    'Prix en XOF': 'Price in XOF',
    'Ajouter le pack': 'Add pack',
    'Packs configurés': 'Configured packs',
    'Configuration synchronisée': 'Configuration synchronized',
    'Lecture des commentaires…': 'Loading comments…',
    'Grille de': 'Grid for',
    'chargée.': 'loaded.',
    'Dernière lecture :': 'Last read:',
    'CROIX': 'CROSS',
    'État du système': 'System status',
    'Lecture en attente.': 'Waiting for a read.',
    'Prévisualisation': 'Preview',
    'La prévisualisation apparaîtra ici.': 'The preview will appear here.',
    'La prévisualisation est indisponible.': 'The preview is unavailable.',
    'Programme dupliqué en brouillon.': 'Programme duplicated as a draft.',
    'Code pays': 'Country code',
    'Nom du pays': 'Country name',
    'Nom du tirage': 'Draw name',
    'Nom affiché': 'Display name',
    'Nom public': 'Public name',
    'Nom public (facultatif)': 'Public name (optional)',
    'Clé de fonctionnalité': 'Feature key',
    'Fournisseur': 'Provider',
    'Contact': 'Contact',
    'Lien de paiement en ligne': 'Online payment link',
    'Mode de paiement': 'Payment method',
    'Manuel': 'Manual',
    'En ligne Paystack': 'Paystack online',
    'Activer le paiement en ligne Paystack': 'Enable Paystack online payment',
    'Identifiant': 'Identifier',
    'Lien Paystack': 'Paystack link',
    'Motif du crédit manuel': 'Reason for manual credit',
    'Référence facultative': 'Optional reference',
    'facultatif : 08:00, 16:00': 'optional: 08:00, 16:00',
    'Programme Espoir': 'Hope programme',
    'ex. espoir': 'e.g. espoir',
    'ex. premium': 'e.g. premium',
    'Abonnement Premium': 'Premium subscription',
    'Grille de numéros en cours de configuration par l’administrateur.': 'Number grid is being configured by the administrator.',
    'Grille de numéros en cours de configuration par l’administrateur.': 'Number grid is being configured by the administrator.',
    'Lecture des Boules rejetées…': 'Reading rejected balls…',
    'Page vérifiée': 'Verified page',
    'Compte vérifié': 'Verified account',
    'Réactions': 'Reactions',
    'J’aime': 'Like',
    "Je n’aime pas": 'Dislike',
    'Commenter': 'Comment',
    'Répondre': 'Reply',
    'Annuler la réponse': 'Cancel reply',
    'Voir le profil public de': 'View public profile of',
    'Publier le commentaire': 'Post comment',
    'Ajouter un emoji ou un sticker': 'Add an emoji or sticker',
    'Emojis et stickers': 'Emojis and stickers',
    'Commentez…': 'Comment…',
    'Chargement des commentaires…': 'Loading comments…',
    'Les commentaires sont désactivés sur cette publication.': 'Comments are disabled for this post.',
    'Tirer pour actualiser': 'Pull to refresh',
    'Actualisation...': 'Refreshing…',
    'Relâchez pour actualiser': 'Release to refresh',
    'Impossible d’afficher cette section. Rechargez la page.': 'This section cannot be displayed. Reload the page.',
    'Connexion réussie.': 'Login successful.',
    'Compte créé avec succès.': 'Account created successfully.',
    'Veuillez saisir email et mot de passe.': 'Please enter your email and password.',
    'Le mot de passe doit faire au moins 6 caractères.': 'The password must contain at least 6 characters.',
    'Connexion via Google…': 'Signing in with Google…',
    'Connecté via Google.': 'Connected with Google.',
    'Connexion Google indisponible.': 'Google login is unavailable.',
    'Échec de la connexion.': 'Login failed.',
    'La connexion du compte est indisponible pour le moment.': 'Account login is temporarily unavailable.',
    'Création…': 'Creating…',
    'Compte créé, redirection…': 'Account created, redirecting…',
    'Échec de l’inscription.': 'Sign-up failed.',
    'La création du compte est indisponible pour le moment.': 'Account creation is temporarily unavailable.',
    'Les étoiles sont créditées quand un filleul crée son compte ou valide une conversion.': 'Stars are credited when a referral creates an account or completes a conversion.',
    'Inviter un proche': 'Invite someone',
    'Lien personnel': 'Personal link',
    'Votre solde': 'Your balance',
    'Options de partage': 'Sharing options',
    'Solde disponible': 'Available balance',
    'Packs disponibles': 'Available packs',
    'Calcul du solde nécessaire': 'Required balance calculation',
    'Pack de jetons': 'Token pack',
    'Télécharger la croix': 'Download the cross',
    'Copier l’image de la croix': 'Copy the cross image',
    'Copier l\'image de la croix': 'Copy the cross image',
    'Tableau administrateur': 'Admin dashboard',
    'Tableau administrateur indisponible': 'Admin dashboard unavailable',
    'Rubriques administrateur': 'Admin sections',
    'Espace protégé': 'Protected area',
    'Supabase connecté': 'Supabase connected',
    'Vue d’ensemble': 'Overview',
    'Pays, matrices & horaires': 'Countries, matrices & schedules',
    'Règles d’accès & tarifs': 'Access rules & pricing',
    'Fonctions / images': 'Functions / images',
    'Paiements & jetons': 'Payments & tokens',
    'Accès anticipé': 'Early access',
    'Recharger jetons & étoiles': 'Top up tokens & stars',
    'Contrôle avancé': 'Advanced control',
    'Top Ventes': 'Top sales',
    'Promotions': 'Promotions',
    'Universelle': 'Universal',
    'universelle': 'universal',
    'Espoir': 'Hope',
    'espoir': 'hope',
    'Stand-by': 'Standby',
    'standby': 'standby',
    'Matrice universelle': 'Universal matrix',
    'Aucune publication anticipée configurée.': 'No early publication configured.'
  };

  /*
   * Dynamic views still contain a few legacy French source phrases because
   * they are rendered after the initial HTML pass. Keep one alias boundary
   * here so the Supabase catalogue can translate those phrases by their
   * stable keys as well. This also lets the MutationObserver translate
   * attributes and fragments created by older modules without each module
   * inventing a second i18n runtime.
   */
  const SOURCE_KEY_ALIASES = Object.freeze({
    'Chargement des publications…': 'feed.loading',
    'Chargement des publications...': 'feed.loading',
    'Aucune publication disponible.': 'feed.empty',
    'J’aime': 'feed.like',
    'Commenter': 'feed.comment',
    'Commentaires': 'feed.comments',
    'Partager': 'feed.share',
    'partages': 'feed.shares',
    'Partager cette publication': 'feed.shareThis',
    'Sur mon profil': 'feed.onProfile',
    'Par message': 'feed.byMessage',
    'Copier le lien': 'feed.copyLink',
    'Les commentaires sont désactivés sur cette publication.': 'feed.commentsDisabled',
    'Chargement des commentaires…': 'feed.loadingComments',
    'Chargement des commentaires...': 'feed.loadingComments',
    'Les commentaires sont indisponibles pour le moment.': 'feed.commentsUnavailable',
    'Tirer pour actualiser': 'feed.pullToRefresh',
    'Actualisation...': 'feed.refreshing',
    'Relâchez pour actualiser': 'feed.releaseToRefresh',
    'Commentez…': 'feed.writeComment',
    'Écrivez un commentaire…': 'feed.writeComment',
    'Publier le commentaire': 'feed.postComment',
    'Aucun commentaire': 'feed.noComments',

    'Chargement des tableaux': 'tableaux.loading',
    'Vos tableaux débloqués': 'tableaux.unlocked',
    'Schémas du jour': 'tableaux.dailySchemes',
    'Masquer les tableaux verrouillés': 'tableaux.hideLocked',
    'Découvrir les autres tableaux': 'tableaux.discoverOther',
    'Programmes personnalisés': 'tableaux.createdPrograms',
    'Modèle visuel': 'tableaux.visualModel',
    'Grille de numéros en cours de configuration par l’administrateur.': 'tableaux.adminConfiguring',
    'Confirmation d’achat': 'tableaux.confirmation',
    'Ce déblocage concerne uniquement ce tableau.': 'tableaux.onlyThisTable',
    'Accès requis': 'tableaux.accessRequired',
    'Débloquer': 'tableaux.unlock',

    'Ouvrir les notifications': 'notifications.open',
    'Toutes': 'notifications.all',
    'Non lues': 'notifications.unread',
    'Tout marquer comme lu': 'notifications.markAllRead',
    'Aucune notification': 'notifications.empty',
    'Vous êtes à jour.': 'notifications.upToDate',
    'À l’instant': 'notifications.justNow',

    'Télécharger la croix': 'croix.download',
    'Copier l’image de la croix': 'croix.copyImage',
    "Copier l'image de la croix": 'croix.copyImage',
    'Couleurs de la Croix (par jour)': 'croix.colorsByDay',
    'Générer la clé': 'croix.generateKey',
    'Copier la clé': 'croix.copyKey',
    'Votre clé du jour': 'croix.dailyKey',
    'CROIX': 'croix.cross',

    'Compte': 'account.title',
    'Connexion': 'account.login',
    'Déconnexion': 'account.logout',
    'Créer un compte': 'account.signup',
    'Compte vérifié': 'account.verified',
    'Pays': 'account.country',
    'Langue': 'account.language',
    'Abonnement': 'account.subscription',
    'Forfait': 'account.plan',
    'Actif': 'account.active',
    'Expiré': 'account.expired',
    'Aucun abonnement actif': 'account.noSubscription',
    'Mode public': 'account.publicMode',
    'Accès privé': 'account.privateAccess',
    'Solde': 'account.balance',
    'Étoiles': 'account.stars',
    'Jetons': 'account.tokens',
    'étoile': 'balance.starSingular',
    'étoiles': 'balance.starPlural',
    'jeton': 'balance.tokenSingular',
    'jetons': 'balance.tokenPlural',
    'Inviter un proche': 'account.invite',
    'Lien personnel': 'account.personalLink',
    'Copié': 'account.copied',

    'Paiement': 'payment.title',
    'Configuration du paiement': 'payment.configuration',
    'Choisir le mode de paiement': 'payment.chooseMethod',
    'Paiement manuel': 'payment.manual',
    'Paiement en ligne': 'payment.online',
    'Paiement par Paystack': 'payment.paystack',
    'Montant': 'payment.amount',
    'Quantité': 'payment.quantity',
    'Total': 'payment.total',
    'Confirmer le paiement': 'payment.confirm',
    'Redirection vers le paiement...': 'payment.redirecting',
    'Paiement en attente de confirmation.': 'payment.pending',
    'Paiement effectué avec succès.': 'payment.success',
    'Le paiement a échoué.': 'payment.failed',
    'Le paiement est momentanément indisponible.': 'payment.unavailable',

    'Tableau administrateur': 'admin.title',
    'Vue d’ensemble': 'admin.overview',
    'Vue d\'ensemble': 'admin.overview',
    'Accès anticipé': 'admin.earlyAccess',
    'Contrôle avancé': 'admin.advancedControl',
    'Promotions': 'admin.promotions',
    'Espace protégé': 'admin.protectedArea',
    'Supabase connecté': 'admin.supabaseConnected'
  });

  let currentLocale = FALLBACK_LOCALE;
  let currentCatalog = {};
  let fallbackCatalog = {};
  let languageState = Object.freeze({
    locale: FALLBACK_LOCALE,
    catalog: Object.freeze({})
  });
  let languageRequestId = 0;
  let preferredLocaleOverride = '';
  let observer = null;
  let applying = false;
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();

  function normalizeLocale(value) {
    const raw = String(value || '').trim().replace('_', '-');
    if (!raw) return '';
    return /^[a-z]{2,3}-[A-Z]{2}$/.test(raw) ? raw : raw.split('-')[0].toLowerCase();
  }

  function readPersistedLocale() {
    try {
      return localStorage.getItem(LANGUAGE_STORAGE_KEY)
        || localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)
        || '';
    } catch (_) {
      return '';
    }
  }

  function persistLocale(locale) {
    const normalized = normalizeLocale(locale) || FALLBACK_LOCALE;
    try {
      // Keep the legacy key in sync for older modules, but make the
      // namespaced key the single source of truth for new code.
      localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
      localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, normalized);
    } catch (_) {
      // Private browsing can reject storage writes. The in-memory state still
      // remains authoritative for the current document.
    }
    return normalized;
  }

  function localizationState() {
    return window.cidSiteConfig?.localization?.()
      || window.cidSiteConfig?.state?.()?.localization
      || null;
  }

  function databaseLocale() {
    const localization = localizationState();
    return normalizeLocale(
      localization?.userLocaleCode
        || readPersistedLocale()
        || localization?.selectedLocale
        || ''
    );
  }

  function enabledLocales() {
    const rows = localizationState()?.locales;
    return Array.isArray(rows) && rows.length
      ? rows.filter((item) => item?.enabled !== false && item?.catalog_ready !== false)
      : [];
  }

  function resolveLocale(requested) {
    const wanted = normalizeLocale(requested) || FALLBACK_LOCALE;
    const rows = enabledLocales();
    if (!rows.length) return LOCAL_CATALOGS[wanted] ? wanted : FALLBACK_LOCALE;
    const exact = rows.find((row) => row.code === wanted);
    if (exact) return exact.code;
    const base = rows.find((row) => String(row.code).split('-')[0] === wanted.split('-')[0]);
    return base?.code || rows.find((row) => row.is_default)?.code || FALLBACK_LOCALE;
  }

  async function loadJsonCatalog(locale) {
    const path = LOCAL_CATALOGS[locale] || LOCAL_CATALOGS[FALLBACK_LOCALE];
    try {
      const response = await fetch(path, { cache: 'no-store' });
      const json = response.ok ? await response.json() : {};
      return json && typeof json === 'object' ? json : {};
    } catch (_) {
      return {};
    }
  }

  function localizedValue(value, fallback = '') {
    const locale = currentLocale || FALLBACK_LOCALE;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return localizedValue(parsed, fallback);
          }
        } catch (_) {
          // Keep the historical text when a legacy field contains invalid
          // JSON instead of turning a harmless label into an exception.
        }
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const baseLocale = locale.split('-')[0];
      return String(
        value[locale]
          ?? value[baseLocale]
          ?? value[FALLBACK_LOCALE]
          ?? Object.values(value).find((item) => item !== null && item !== undefined)
          ?? fallback
      );
    }
    return String(value ?? fallback);
  }

  function localizedField(record, field, fallback = '') {
    const source = record && typeof record === 'object' ? record : {};
    const locale = currentLocale || FALLBACK_LOCALE;
    const baseLocale = locale.split('-')[0];
    const localized = source[`${field}_${locale}`]
      ?? source[`${field}_${baseLocale}`]
      ?? source[`${field}_i18n`];
    const legacy = localizedValue(source[field], fallback);
    const translated = localizedValue(localized, legacy);
    return translated || legacy;
  }

  function databaseTranslations(locale) {
    const state = localizationState();
    return state?.selectedLocale === locale && state.translations && typeof state.translations === 'object'
      ? state.translations
      : {};
  }

  function sourceText(node) {
    if (!originalText.has(node)) originalText.set(node, (node.nodeValue || '').trim());
    return originalText.get(node);
  }

  function translatePhrase(source, locale = currentLocale) {
    const key = String(source ?? '');
    if (!key) return key;
    const alias = SOURCE_KEY_ALIASES[key];
    const direct = currentCatalog[key]
      ?? (alias ? currentCatalog[alias] : undefined)
      ?? (locale === 'en' ? ENGLISH[key] : undefined);
    if (direct !== undefined && direct !== null) return String(direct);
    // Dynamic phrases emitted by the feed and result cards.
    if (locale === 'en') {
      let match = key.match(/^Terminaison\s+(.+)$/i);
      if (match) return `Terminal ${match[1]}`;
      match = key.match(/^Croix nationale pour le (.+)$/i);
      if (match) return `National Cross for ${match[1]}`;
      match = key.match(/^Matrice du jour sur Cidmap$/i);
      if (match) return 'Today’s matrix on Cidmap';
      match = key.match(/^Programme\s+(.+)$/i);
      if (match) return `Programme ${match[1]}`;
      match = key.match(/^Copier\s+(.+)$/i);
      if (match) return `Copy ${match[1]}`;
      match = key.match(/^Grille du\s+(.+)\s+chargée\.$/i);
      if (match) return `Grid for ${match[1]} loaded.`;
      match = key.match(/^Dernière lecture\s*:\s*(.+)$/i);
      if (match) return `Last read: ${match[1]}`;
      match = key.match(/^(\d+)\s+jetons?$/i);
      if (match) return `${match[1]} token${match[1] === '1' ? '' : 's'}`;
      match = key.match(/^Voir\s+(\d+)\s+commentaire/i);
      if (match) return `View ${match[1]} comment${match[1] === '1' ? '' : 's'}`;
    }
    return key;
  }

  function translateTextNodes(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach((textNode) => {
      const parent = textNode.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(parent.tagName)) return;
      const raw = textNode.nodeValue || '';
      const key = sourceText(textNode);
      if (!key || key.length > 180) return;
      const translated = translatePhrase(key);
      if (translated !== key) textNode.nodeValue = raw.replace(key, translated);
      else if (currentLocale === FALLBACK_LOCALE && raw.trim() !== key) textNode.nodeValue = raw.replace(raw.trim(), key);
    });
  }

  function translateAttributes(root = document.body) {
    if (!root) return;
    const elements = root.querySelectorAll('*');
    elements.forEach((element) => {
      ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        let originals = originalAttributes.get(element);
        if (!originals) {
          originals = {};
          originalAttributes.set(element, originals);
        }
        if (!(attribute in originals)) originals[attribute] = element.getAttribute(attribute);
        const source = originals[attribute];
        const translated = translatePhrase(source);
        if (translated !== source) element.setAttribute(attribute, translated);
        else if (currentLocale === FALLBACK_LOCALE) element.setAttribute(attribute, source);
      });
    });
  }

  function setDocumentDirection(locale) {
    const row = enabledLocales().find((item) => item.code === locale);
    const rtl = row?.direction === 'rtl' || locale === 'ar' || locale === 'he';
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.body?.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    document.body?.classList.toggle('cid-rtl', rtl);
  }

  function applyCatalog(catalog, locale, fallback = {}) {
    fallbackCatalog = { ...fallback };
    currentCatalog = {
      ...fallbackCatalog,
      ...(locale === 'en' ? ENGLISH : {}),
      ...catalog,
      ...databaseTranslations(locale)
    };
    currentLocale = locale;
    languageState = Object.freeze({
      locale,
      catalog: Object.freeze({ ...currentCatalog })
    });
    document.documentElement.dataset.cidLocale = locale;
    setDocumentDirection(locale);
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const value = translatePhrase(key, locale);
      if (value === key) return;
      if (['INPUT', 'TEXTAREA'].includes(element.tagName) && 'value' in element) element.value = value;
      else element.textContent = value;
    });
    translateTextNodes();
    translateAttributes();
  }

  function translate(key, fallback = key) {
    const value = translatePhrase(String(key || ''), currentLocale);
    return value === String(key || '') && fallback !== key ? fallback : value;
  }

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || '')
      : new Intl.DateTimeFormat(currentLocale || FALLBACK_LOCALE, options).format(date);
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat(currentLocale || FALLBACK_LOCALE, options).format(number)
      : String(value ?? '');
  }

  function relativeTime(value, unit = 'second') {
    try {
      return new Intl.RelativeTimeFormat(currentLocale || FALLBACK_LOCALE, { numeric: 'always' }).format(Number(value), unit);
    } catch (_) {
      return String(value ?? '');
    }
  }

  async function persistUserLocale(locale) {
    try {
      const bridge = await Promise.resolve(window.cidSupabaseReady);
      const session = await bridge?.auth?.getSession?.();
      if (!session?.data?.session?.user?.id || !bridge?.client?.functions?.invoke) return;
      await bridge.client.functions.invoke('subscription-access', {
        body: { action: 'set-language', localeCode: locale }
      });
    } catch (_) {
      // A catalog can still be applied for this session when the preference
      // write is unavailable. The next authenticated refresh remains safe.
    }
  }

  async function changeLanguage(requested, options = {}) {
    const locale = resolveLocale(requested);
    if (options.persistRemote !== false) {
      // A manual choice must remain authoritative while the remote preference
      // is being saved. Otherwise an older account preference can immediately
      // restore the previous language during a catalogue refresh.
      preferredLocaleOverride = locale;
    }
    const requestId = ++languageRequestId;
    // Persist on intent, before the catalog request. A later site-config
    // event or route change can therefore never restore the old locale.
    persistLocale(locale);
    const [catalog, fallback] = await Promise.all([
      loadJsonCatalog(locale),
      locale === FALLBACK_LOCALE
        ? Promise.resolve({})
        : loadJsonCatalog(FALLBACK_LOCALE)
    ]);
    // A visitor may click twice before either catalog arrives. Only the most
    // recent request is allowed to mutate the DOM or emit a language event.
    if (requestId !== languageRequestId) return currentLocale;
    applyCatalog(catalog, locale, fallback);
    persistLocale(locale);
    window.dispatchEvent(new CustomEvent('cid:language-change', {
      detail: {
        locale,
        catalog: currentCatalog,
        state: languageState
      }
    }));
    /*
     * Finish the remote preference write before a manual language switch
     * reloads the current route. The helper is best-effort and catches its
     * own errors, so visitors without an account are not blocked.
     */
    if (options.persistRemote !== false) await persistUserLocale(locale);
    return locale;
  }

  async function loadSavedLanguage() {
    const saved = preferredLocaleOverride || databaseLocale() || readPersistedLocale();
    return changeLanguage(saved || FALLBACK_LOCALE, { persistRemote: false });
  }

  function availableLocaleCodes() {
    const rows = enabledLocales();
    return rows.length ? rows.map((row) => row.code) : Object.keys(LOCAL_CATALOGS);
  }

  function installObserver() {
    if (observer || !document.body) return;
    /*
     * Coalesce DOM mutations into one translation pass per frame. Tableaux
     * hydration writes many cells in a burst; walking every text node for
     * each mutation record made taps and scrolling stall on phones.
     */
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (applying) return;
      applying = true;
      try {
        translateTextNodes();
        translateAttributes();
      } finally {
        applying = false;
        // Drop the records produced by this pass itself.
        observer?.takeRecords?.();
      }
    };
    observer = new MutationObserver(() => {
      if (applying || frame) return;
      frame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(flush)
        : window.setTimeout(flush, 16);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.changeLanguage = changeLanguage;
  window.loadSavedLanguage = loadSavedLanguage;
  window.cidTranslate = translate;
  window.cidTranslation = Object.freeze({
    current: () => currentLocale,
    catalog: () => ({ ...currentCatalog }),
    state: () => languageState,
    available: availableLocaleCodes,
    t: translate,
    localized: localizedValue,
    field: localizedField,
    formatDate,
    formatNumber,
    relativeTime
  });

  // Compatibility surface for modules written against the former runtime.
  window.cidI18n = {
    translatePage: (locale) => changeLanguage(locale || currentLocale),
    translate: (key, locale) => locale && locale !== currentLocale
      ? (locale === 'en' ? ENGLISH[String(key)] || String(key) : String(key))
      : translate(key),
    availableLocales: availableLocaleCodes(),
    currentLocale: () => currentLocale
  };
  window.i18n = window.cidI18n;

  window.addEventListener('cid:site-config-loaded', () => loadSavedLanguage().catch(() => {}));
  window.addEventListener('cid:auth-sync', () => {
    // The authenticated catalogue contains the authoritative
    // user_language_preferences row. Reapply it after login/logout so a
    // previous account's locale can never remain visible in this SPA tab.
    preferredLocaleOverride = '';
    window.cidSiteConfig?.refresh?.().catch?.(() => {});
  });
  window.addEventListener('cid:language-change', () => {
    // Dynamic modules may have rendered after the first pass.
    setTimeout(() => {
      translateTextNodes();
      translateAttributes();
    }, 0);
  });

  const start = () => {
    installObserver();
    loadSavedLanguage().catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
