/*
 * Cidmap admin workspace
 *
 * The dashboard is deliberately split into two layers:
 *  - a compact home route made of action cards;
 *  - one dedicated route per administrative domain.
 *
 * Routing stays local to the account surface (hash + history API), while all
 * reads and writes continue to use the authenticated admin-service boundary.
 */
import {
  requestAdmin,
  fetchAdminData,
  fetchAdminConfig,
  fetchProgramsData,
  fetchValidNumbers,
  saveAdminPayment,
  saveAdminPlan,
  deleteAdminPlan,
  deleteAdminAccessRule,
  deleteAdminEarlyAccessRule,
  saveAdminTokenPrice,
  deleteAdminTokenPrice,
  searchAdminUsers,
  grantAdminBalance,
  grantAdminSubscription,
  fetchAdminTableauAccess,
  grantAdminTableauAccess,
  revokeAdminTableauAccess,
  generateAdminDrawSource,
  deleteAdminDrawSource,
  fetchAdminCrossGenerations,
  deleteAdminCrossGeneration,
  createProgram,
  publishProgram,
  duplicateAdminProgram,
  previewAdminProgram,
  listPromoBanners,
  savePromoBanner,
  deletePromoBanner,
  deleteAdminProgram,
  testProgramDraft,
  fetchResultatAideDashboard,
  validateResultatAideDraw,
  deleteResultatAideDraw,
  importAdminResultatAideDraws,
  fetchAdminResultSchedules,
  saveAdminResultSchedules,
  fetchAdminReferralSettings,
  saveAdminReferralSettings,
  fetchAdminChatKnowledge,
  saveAdminChatKnowledge,
  deleteAdminChatKnowledge
} from './admin-service.js';
import { createAdminResultImport } from './admin-result-import.js';

const ROUTES = {
  overview: {
    title: 'Vue d’ensemble',
    description: 'Les indicateurs essentiels et l’état de la configuration.',
    icon: 'overview'
  },
  sources: {
    title: 'Pays, matrices & horaires',
    description: 'Gérer les sources et la génération automatique.',
    icon: 'sources'
  },
  rules: {
    title: 'Règles d’accès & tarifs',
    description: 'Configurer les clés de fonctionnalités et les jetons.',
    icon: 'rules'
  },
  functions: {
    title: 'Fonctions / images',
    description: 'Consulter les fiches détaillées des fonctions serveur.',
    icon: 'functions'
  },
  payments: {
    title: 'Paiements & jetons',
    description: 'Gérer les packs et les modes de paiement Paystack.',
    icon: 'payments'
  },
  balances: {
    title: 'Attributions manuelles',
    description: 'Créditer des étoiles ou des jetons à un utilisateur.',
    icon: 'payments'
  },
  tableauAccess: {
    title: 'Accès aux Tableaux',
    description: 'Consulter, attribuer ou révoquer un Tableau par utilisateur.',
    icon: 'rules'
  },
  early: {
    title: 'Accès anticipé',
    description: 'Paramétrer la publication anticipée des fonctionnalités.',
    icon: 'early'
  },
  promotions: {
    title: 'Bannières promotionnelles',
    description: 'Mettre en avant un Tableau et sa clé.',
    icon: 'overview'
  },
  resultats: {
    title: 'Résultats & statistiques',
    description: 'Vérifier les tirages, les victoires, les heures et le trafic.',
    icon: 'overview'
  },
  chat: {
    title: 'Gestion du chat virtuel',
    description: 'Administrer les réponses officielles et les priorités du moteur.',
    icon: 'chat'
  },
  referral: {
    title: 'Affiliation & partages',
    description: 'Configurer les récompenses de partage, d’inscription et d’abonnement.',
    icon: 'payments'
  },
  history: {
    title: 'Historique du site',
    description: 'Configurer les domaines historiques, les jours gratuits et les tarifs d’accès.',
    icon: 'overview'
  }
};

const HOME_SECTIONS = [
  {
    title: 'Vue générale',
    description: 'Un aperçu rapide de l’activité et de la configuration.',
    cards: [
      ['overview', 'Vue d’ensemble', 'État global', 'overview']
    ]
  },
  {
    title: 'Finances & paiements',
    description: 'Configurez les paiements et les opérations de solde.',
    cards: [
      ['payments', 'Paiements & jetons', 'Paystack, monnaie et packs', 'payments'],
      ['balances', 'Crédits utilisateurs', 'Attributions manuelles', 'payments']
    ]
  },
  {
    title: 'Gestion des accès',
    description: 'Contrôlez les règles, les abonnements et les accès individuels.',
    cards: [
      ['rules', 'Accès & tarifs', 'Règles et abonnements', 'rules'],
      ['rules', 'Récompenses d’affiliation', 'Étoiles et jetons par abonnement', 'payments'],
      ['history', 'Historique du site', 'Configurer Résultats, Croix, Matrices et Boules rejetées', 'overview'],
      ['tableauAccess', 'Accès aux Tableaux', 'Déblocages individuels', 'rules'],
      ['early', 'Accès anticipé', 'Publications planifiées', 'early']
    ]
  },
  {
    title: 'Publications, paramètres & catalogue',
    description: 'Gérez les sources, les programmes et les contenus visibles.',
    cards: [
      ['sources', 'Sources & horaires', 'Pays et tirages', 'sources'],
      ['functions', 'Numéros valides du jour', 'Voir les grilles privées générées', 'functions'],
      ['functions', 'Fonctions serveur', 'Catalogue admin', 'functions'],
      ['promotions', 'Bannières', 'Schémas et clés mises en avant', 'overview'],
      ['resultats', 'Résultats & statistiques', 'Mémoire et trafic Résultat-Aide', 'overview'],
      ['chat', 'Gestion du chat virtuel', 'Base de connaissances officielle', 'chat'],
      ['referral', 'Affiliation & partages', 'Récompenses de partage et d’inscription', 'payments']
    ]
  }
];

const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return value;
  }
};

const node = (tag, className = '', ...children) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  children.forEach((child) => {
    if (child === undefined || child === null) return;
    element.appendChild(child instanceof Node
      ? child
      : document.createTextNode(String(child)));
  });
  return element;
};

const button = (label, className, handler) => {
  const element = node('button', className, label);
  element.type = 'button';
  if (handler) {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      handler(event);
    });
  }
  return element;
};

const makeIcon = (name) => {
  const paths = {
    overview: '<path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-3H4v3Zm10-3h6v-4h-6v4Z"/><path d="M6 7h2M16 8h2M16 15h2"/>',
    sources: '<path d="M4 5.5 12 3l8 2.5-8 2.5-8-2.5Z"/><path d="M4 5.5v6L12 14l8-2.5v-6M4 11.5v6L12 20l8-2.5v-6"/><path d="M12 8v12"/>',
    rules: '<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M8 8h7M8 12h7M8 16h4"/><path d="m7 3 1 2h6l1-2"/>',
    functions: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h3M14 13h2M8 17h8"/><circle cx="6.5" cy="9" r=".5" fill="currentColor"/>',
    payments: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h4"/><path d="M16 14v4M14 16h4"/>',
    early: '<path d="m12 3 1.7 5.3H19l-4.3 3.2 1.6 5.2-4.3-3.2-4.3 3.2 1.6-5.2L5 8.3h5.3L12 3Z"/><path d="M12 17v4M9 21h6"/>',
    chat: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.4-.7L4 20l1.7-3.3A7.3 7.3 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5a7.5 7.5 0 0 1 8 7Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.8-4L3 10"/><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14"/><path d="M21 19v-5h-5"/>'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  // Keep the launcher icons bounded even while the dashboard stylesheet is
  // loading or when an older account stylesheet is still cached.
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.style.display = 'block';
  svg.style.width = '24px';
  svg.style.height = '24px';
  svg.style.maxWidth = '24px';
  svg.style.maxHeight = '24px';
  svg.style.fill = 'none';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = paths[name] || paths.overview;
  return svg;
};

const iconBox = (name) => {
  const box = node('span', `admin-home-icon admin-home-icon--${name}`);
  box.appendChild(makeIcon(name));
  return box;
};

let adminFieldId = 0;

const field = (labelText, name, options = {}) => {
  /*
   * Keep the field container a neutral block. Using the whole field as a
   * <label> made it vulnerable to legacy label rules from the account shell
   * (inline/flex layouts could place the next field's label beside the
   * previous control on mobile). The visible label is now explicitly linked
   * to its control, which is the stable form pattern used by admin consoles.
   */
  const wrapper = node('div', 'admin-v3-field');
  const inputId = options.id || `adminV3-${name}-${++adminFieldId}`;
  const label = node('label', 'admin-v3-field-label', labelText);
  label.id = `${inputId}-label`;
  label.htmlFor = inputId;
  wrapper.style.display = 'grid';
  wrapper.style.gridTemplateColumns = 'minmax(0, 1fr)';
  wrapper.style.gridTemplateRows = 'auto auto';
  wrapper.style.gap = '8px';
  let input;
  if (options.type === 'select') {
    input = node('select');
    (options.options || []).forEach(([value, text]) => {
      const option = node('option', '', text);
      option.value = value;
      input.appendChild(option);
    });
  } else {
    input = node(options.multiline ? 'textarea' : 'input');
    if (!options.multiline) input.type = options.type || 'text';
  }
  input.name = name;
  input.id = inputId;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.value !== undefined) input.value = options.value;
  if (options.required) input.required = true;
  if (options.checked) input.checked = true;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.rows) input.rows = String(options.rows);
  if (options.type === 'checkbox') {
    const rowLabel = node('label', 'admin-v3-checkbox-row');
    rowLabel.id = label.id;
    rowLabel.htmlFor = inputId;
    input.setAttribute('aria-labelledby', rowLabel.id);
    input.style.display = 'block';
    input.style.width = '16px';
    input.style.minWidth = '16px';
    rowLabel.append(input, node('span', '', labelText));
    wrapper.classList.add('is-checkbox');
    wrapper.appendChild(rowLabel);
    return wrapper;
  }
  wrapper.appendChild(label);
  label.style.display = 'block';
  label.style.width = '100%';
  input.style.display = 'block';
  input.style.width = '100%';
  input.style.minWidth = '0';
  input.setAttribute('aria-labelledby', label.id);
  wrapper.appendChild(input);
  return wrapper;
};

const formValue = (form, name) => String(new FormData(form).get(name) || '').trim();
const numberValue = (form, name, fallback = 0) => {
  const value = Number(formValue(form, name));
  return Number.isFinite(value) ? value : fallback;
};
const optionalNumberValue = (form, name) => {
  const raw = formValue(form, name);
  return raw === '' ? null : numberValue(form, name, 0);
};

function featureCatalog(state) {
  const entries = [
    ['matrice', 'Matrice'],
    ['croix', 'Croix nationale'],
    ['boules-rejetees', 'Boules rejetées'],
    ['tableaux-universelle', 'Universelle'],
    ['tableaux-intuition', 'Intuition'],
    ['tableaux-oracle', 'Oracle'],
    ['tableaux-lnb', 'LNB'],
    ['tableaux-balsa', 'Balsa Plus'],
    ['tableaux-standby', 'Stand-by'],
    ['tableaux-robot', 'Robot'],
    ['tableaux-created', 'Programmes personnalisés'],
    ['tableaux-dechiffrement-plus', 'Déchiffrement avancé'],
    ['historique-resultats', 'Historique — Résultats'],
    ['historique-croix', 'Historique — Croix nationale'],
    ['historique-matrice', 'Historique — Matrices'],
    ['historique-rejetees', 'Historique — Boules rejetées'],
    ['historique-tous', 'Historique — Tous les domaines']
  ];
  (state.programs?.programs || []).forEach((program) => {
    const key = `tableaux-${program.program_key}`;
    if (!entries.some(([value]) => value === key)) {
      entries.push([key, program.display_name || program.program_key]);
    }
  });
  (state.access?.rules || []).forEach((rule) => {
    const key = String(rule.feature_key || '').trim().toLowerCase();
    if (key && !entries.some(([value]) => value === key)) {
      entries.push([key, rule.display_name || key]);
    }
  });
  (state.access?.earlyAccessRules || []).forEach((rule) => {
    const key = String(rule.feature_key || '').trim().toLowerCase();
    if (key && !entries.some(([value]) => value === key)) {
      entries.push([key, rule.display_name || key]);
    }
  });
  return entries.sort((left, right) => left[1].localeCompare(right[1], 'fr'));
}

function featurePicker(name, state) {
  const wrapper = node('div', 'admin-v3-feature-picker');
  featureCatalog(state).forEach(([value, label], index) => {
    const item = node('label', 'admin-v3-feature-option');
    const input = node('input');
    input.type = 'checkbox';
    input.id = `adminFeature-${name}-${index}`;
    input.name = name;
    input.value = value;
    item.htmlFor = input.id;
    item.append(input, node('span', '', label));
    wrapper.appendChild(item);
  });
  return wrapper;
}

function programCatalogOptions(state) {
  const entries = [
    ['universelle', 'Universelle'],
    ['intuition', 'Intuition'],
    ['oracle', 'Oracle'],
    ['lnb', 'LNB'],
    ['balsa', 'Balsa Plus'],
    ['standby', 'Stand-by'],
    ['robot', 'Robot']
  ];
  (state.programs?.programs || []).forEach((program) => {
    if (!entries.some(([value]) => value === program.program_key)) {
      entries.push([program.program_key, program.display_name || program.program_key]);
    }
  });
  return entries.sort((left, right) => left[1].localeCompare(right[1], 'fr'));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(
      window.cidTranslation?.current?.() || 'fr',
      { dateStyle: 'medium' }
    ).format(date);
}

function formatTime(value) {
  return String(value || '—').slice(0, 5);
}

const GENERATION_WEEK_DAYS = Object.freeze([
  [1, 'Lundi'],
  [2, 'Mardi'],
  [3, 'Mercredi'],
  [4, 'Jeudi'],
  [5, 'Vendredi'],
  [6, 'Samedi'],
  [0, 'Dimanche']
]);

function generationDaysLabel(source) {
  const raw = source?.settings?.generationDays;
  if (!Array.isArray(raw)) return 'Tous les jours';
  const days = new Set(raw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (days.size === 7) return 'Tous les jours';
  if (!days.size) return 'Aucun jour';
  return GENERATION_WEEK_DAYS
    .filter(([value]) => days.has(value))
    .map(([, label]) => label.slice(0, 3))
    .join(', ');
}

function setBusy(element, busy, idleLabel, busyLabel = 'Enregistrement…') {
  if (!element) return;
  if (busy) {
    element.dataset.idleLabel = idleLabel || element.textContent;
    element.textContent = busyLabel;
    element.classList.add('is-busy');
    element.disabled = true;
    element.setAttribute('aria-busy', 'true');
  } else {
    element.disabled = false;
    element.textContent = element.dataset.idleLabel || idleLabel || element.textContent;
    element.classList.remove('is-busy');
    delete element.dataset.idleLabel;
    element.removeAttribute('aria-busy');
  }
}

function setStatus(element, message, type = '') {
  if (!element) return;
  element.textContent = message || '';
  element.className = `admin-v3-status${type ? ` is-${type}` : ''}`;
}

function inlineConfirmation(row, trigger, message, confirmLabel, onConfirm) {
  if (!row || !trigger || row.dataset.confirming === 'true') return;
  row.dataset.confirming = 'true';
  trigger.hidden = true;
  const confirmPanel = node(
    'div',
    'admin-v3-inline-confirm',
    node('span', '', message)
  );
  const cancel = button('Annuler', 'admin-v3-button admin-v3-button--secondary', () => {
    confirmPanel.remove();
    trigger.hidden = false;
    delete row.dataset.confirming;
  });
  const confirm = button(confirmLabel, 'admin-v3-button admin-v3-button--danger', async () => {
    setBusy(confirm, true, confirmLabel, 'En cours…');
    try {
      await onConfirm();
    } catch (_) {
      setBusy(confirm, false, confirmLabel);
    }
  });
  confirmPanel.append(cancel, confirm);
  row.appendChild(confirmPanel);
}

function makeStatus() {
  return node('p', 'admin-v3-status');
}

function makeCard(title, description, content, className = '') {
  const card = node('article', `admin-v3-card ${className}`.trim());
  const heading = node('div', 'admin-v3-card-heading', node('h3', '', title));
  if (description) heading.appendChild(node('p', '', description));
  card.append(heading, content);
  return card;
}

function makeFormActions(submit, status, ...extra) {
  return node('div', 'admin-v3-form-actions', submit, ...extra, status);
}

function listTarget(attribute) {
  const target = node('div');
  target.dataset[attribute] = '';
  return target;
}

export function renderAdminDashboard(actions = {}) {
  const initialHash = String(window.location.hash || '').match(/^#admin\/([a-z-]+)$/i)?.[1];
  const state = {
    route: ROUTES[initialHash] ? initialHash : 'home',
    access: { rules: [], tokenPrices: [], settings: {}, earlyAccessRules: [] },
    config: {
      drawSources: [],
      generationPolicy: {
        generationTime: '16:00',
        timeZone: 'Africa/Abidjan',
        scope: 'global',
        enabled: true
      }
    },
    programs: { programs: [], methods: [], modules: [], controls: [] },
    programsLoading: false,
    tableauAccess: [],
    tableauAccessLoading: false,
    resultatAide: null,
    resultatAideLoading: false,
    resultatAideView: 'home',
    chatKnowledge: [],
    chatKnowledgeLoading: false,
    referralSettings: null,
    referralSettingsLoading: false,
    valid: null,
    validLoading: false,
    loadedAt: null
  };

  const root = node('section', 'admin-dashboard admin-dashboard-v3');
  root.setAttribute('aria-label', 'Tableau administrateur');
  const content = node('div', 'admin-v3-content');
  const toastRegion = node('div', 'admin-v3-toast-region');
  toastRegion.setAttribute('aria-live', 'polite');

  function toast(message, type = 'success') {
    if (!message) return;
    const item = node('div', `admin-v3-toast is-${type}`, message);
    toastRegion.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function go(route, replace = false) {
    if (route !== 'home' && !ROUTES[route]) return;
    state.route = route;
    const nextHash = route === 'home' ? '' : `#admin/${route}`;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ adminRoute: route }, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    renderRoute();
    if (route === 'referral') void loadReferralSettings();
    window.scrollTo(0, 0);
  }

  function onPopState() {
    const route = String(window.location.hash || '').match(/^#admin\/([a-z-]+)$/i)?.[1];
    state.route = ROUTES[route] ? route : 'home';
    renderRoute();
    if (state.route === 'referral') void loadReferralSettings();
    window.scrollTo(0, 0);
  }

  function runForm(form, submit, operation, statusNode, closeOnSuccess = true) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit?.disabled) return;
      const idleLabel = submit.textContent;
      setBusy(submit, true, idleLabel);
      setStatus(statusNode, 'Synchronisation avec Supabase…');
      try {
        await operation(new FormData(form));
        setStatus(statusNode, 'Enregistré dans Supabase.', 'success');
        toast(closeOnSuccess
          ? 'Mise à jour validée. Fermeture de l’administration.'
          : 'Mise à jour validée.');
        /*
         * The dashboard is mounted as the account's dedicated admin route,
         * not as a browser dialog. Close it only after the operation has
         * resolved successfully, leaving the route open on every error.
         */
        if (closeOnSuccess) {
          window.setTimeout(() => actions.closeAdmin?.(), 1200);
        }
      } catch (error) {
        const message = error?.message || 'La modification n’a pas pu être enregistrée.';
        setStatus(statusNode, message, 'error');
        toast(message, 'error');
      } finally {
        setBusy(submit, false, idleLabel);
      }
    });
  }

  async function refreshData(showToast = false) {
    const [access, config] = await Promise.all([fetchAdminData(), fetchAdminConfig()]);
    state.access = clone(access || state.access);
    state.config = clone(config || state.config);
    state.loadedAt = new Date();
    window.dispatchEvent(new CustomEvent('cid:admin-access-updated', {
      detail: { access: state.access, config: state.config }
    }));
    window.dispatchEvent(new CustomEvent('cid:admin-config-updated', {
      detail: { access: state.access, config: state.config }
    }));
    renderRoute();
    if (showToast) toast('Configuration actualisée depuis Supabase.');
  }

  async function loadPrograms(showToast = false) {
    if (state.programsLoading) return;
    state.programsLoading = true;
    const status = root.querySelector('[data-admin-v3-functions-status]');
    setStatus(status, 'Chargement des fonctions…');
    try {
      state.programs = clone(await fetchProgramsData());
      renderRoute();
      setStatus(root.querySelector('[data-admin-v3-functions-status]'), `${state.programs.programs.length} fonction(s) chargée(s) depuis Supabase.`, 'success');
      if (showToast) toast('Fonctions actualisées.');
    } catch (error) {
      setStatus(root.querySelector('[data-admin-v3-functions-status]'), error?.message || 'Les fonctions ne peuvent pas être chargées.', 'error');
      toast(error?.message || 'Les fonctions ne peuvent pas être chargées.', 'error');
    } finally {
      state.programsLoading = false;
    }
  }

  async function loadChatKnowledge(showToast = false) {
    if (state.chatKnowledgeLoading) return;
    state.chatKnowledgeLoading = true;
    try {
      state.chatKnowledge = clone(await fetchAdminChatKnowledge());
      renderRoute();
      if (showToast) toast('Base de connaissances actualisée.');
    } catch (error) {
      toast(error?.message || 'La base de connaissances ne peut pas être chargée.', 'error');
    } finally {
      state.chatKnowledgeLoading = false;
    }
  }

  async function loadReferralSettings(showToast = false) {
    if (state.referralSettingsLoading) return;
    state.referralSettingsLoading = true;
    try {
      state.referralSettings = clone(await fetchAdminReferralSettings());
      renderRoute();
      if (showToast) toast('Réglages d’affiliation actualisés.');
    } catch (error) {
      toast(error?.message || 'Les réglages d’affiliation ne peuvent pas être chargés.', 'error');
    } finally {
      state.referralSettingsLoading = false;
    }
  }

  async function loadTableauAccess(showToast = false) {
    if (state.tableauAccessLoading) return;
    state.tableauAccessLoading = true;
    try {
      state.tableauAccess = clone(await fetchAdminTableauAccess());
      renderRoute();
      if (showToast) toast('Accès aux Tableaux actualisés.');
    } catch (error) {
      toast(error?.message || 'Les accès aux Tableaux ne peuvent pas être chargés.', 'error');
    } finally {
      state.tableauAccessLoading = false;
    }
  }

  async function loadValidNumbers(form, submit) {
    const status = root.querySelector('[data-admin-v3-valid-status]');
    setBusy(submit, true, 'Charger les numéros', 'Chargement…');
    setStatus(status, 'Lecture de la grille depuis Supabase…');
    try {
      const date = formValue(form, 'date');
      state.valid = await fetchValidNumbers(date);
      renderRoute();
      setStatus(root.querySelector('[data-admin-v3-valid-status]'), `Grille du ${formatDate(state.valid.date)} chargée.`, 'success');
      toast('Grille des numéros actualisée.');
    } catch (error) {
      setStatus(status, error?.message || 'La grille n’a pas pu être chargée.', 'error');
      toast(error?.message || 'La grille n’a pas pu être chargée.', 'error');
    } finally {
      setBusy(submit, false, 'Charger les numéros');
    }
  }

  async function loadResultatAide(filters = {}, showToast = false) {
    if (state.resultatAideLoading) return;
    state.resultatAideLoading = true;
    try {
      state.resultatAide = clone(await fetchResultatAideDashboard(filters));
      renderRoute();
      if (showToast) toast('Mémoire Résultat-Aide actualisée.');
    } catch (error) {
      toast(error?.message || 'Les données Résultat-Aide ne peuvent pas être chargées.', 'error');
    } finally {
      state.resultatAideLoading = false;
    }
  }

  function renderSourceList(target) {
    target.replaceChildren();
    const rows = Array.isArray(state.config.drawSources) ? state.config.drawSources : [];
    if (!rows.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucune source configurée.'));
      return;
    }
    rows.forEach((source) => {
      const row = node('div', 'admin-v3-list-row');
      const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger');
      row.append(
        node('div', 'admin-v3-row-copy',
          node('strong', '', `${source.country_name || 'Pays'} · ${source.draw_name || 'Source'}`),
          node('span', '', `${source.module_key || '—'} · ${formatTime(source.draw_time)} · ${generationDaysLabel(source)} · Code ${source.code || '—'}`)
        ),
        remove
      );
      remove.addEventListener('click', () => {
        inlineConfirmation(
          row,
          remove,
          `Supprimer ${source.country_name || 'cette source'} ?`,
          'Confirmer',
          async () => {
            try {
              await deleteAdminDrawSource(source.id);
              await refreshData();
              toast('Source supprimée.');
            } catch (error) {
              toast(error?.message || 'La source n’a pas pu être supprimée.', 'error');
              throw error;
            }
          }
        );
      });
      target.appendChild(row);
    });
  }

  function renderRulesList(target, handlers = {}) {
    target.replaceChildren();
    const rows = (Array.isArray(state.access.rules) ? state.access.rules : [])
      .filter((rule) => (
        typeof handlers.filter === 'function' ? handlers.filter(rule) : true
      ));
    if (!rows.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucune règle d’accès enregistrée.'));
      return;
    }
    rows.forEach((rule) => {
      const currency = rule.unlock_currency === 'stars' ? 'étoiles' : 'jetons';
      const amount = rule.unlock_currency === 'stars' ? rule.required_stars : rule.required_tokens;
      const referralSummary = rule.referral_reward_stars == null
        && rule.referral_reward_tokens == null
        ? 'global'
        : `${Number(rule.referral_reward_stars) || 0} étoile(s) / ${Number(rule.referral_reward_tokens) || 0} jeton(s)`;
      const row = node('div', 'admin-v3-list-row');
      const actions = node('div', 'admin-v3-row-actions');
      if (handlers.onEdit) {
        actions.appendChild(button(
          'Modifier',
          'admin-v3-button admin-v3-button--secondary',
          () => handlers.onEdit(rule)
        ));
      }
      if (handlers.onDelete) {
        const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger');
        remove.addEventListener('click', () => {
          inlineConfirmation(
            row,
            remove,
            `Supprimer la règle ${rule.display_name || rule.feature_key} ? Les historiques seront conservés et la fonctionnalité pourra redevenir publique si aucun abonnement ne la couvre.`,
            'Confirmer',
            () => handlers.onDelete(rule)
          );
        });
        actions.appendChild(remove);
      }
      row.append(
        node('div', 'admin-v3-row-copy',
          node('strong', '', rule.display_name || rule.feature_key),
          node('div', 'admin-v3-row-meta', `${rule.feature_key} · ${amount || 0} ${currency} · ${Number(rule.duration_days) || 30} jour(s)${String(rule.feature_key || '').startsWith('historique-') ? ` · ${Number(rule.history_free_days) || 0} jour(s) gratuits` : ''} · parrain : ${referralSummary}`)
        ),
        node('span', `admin-v3-status-badge ${rule.enabled === false ? 'is-muted' : 'is-active'}`,
          rule.enabled === false ? 'Inactif' : 'Actif')
      );
      if (actions.childNodes.length) row.appendChild(actions);
      target.appendChild(row);
    });
  }

  function renderEarlyList(target, handlers = {}) {
    target.replaceChildren();
    const rows = Array.isArray(state.access.earlyAccessRules) ? state.access.earlyAccessRules : [];
    if (!rows.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucune publication anticipée configurée.'));
      return;
    }
    rows.forEach((rule) => {
      const referralSummary = rule.referral_reward_stars == null
        && rule.referral_reward_tokens == null
        ? 'global'
        : `${Number(rule.referral_reward_stars) || 0} étoile(s) / ${Number(rule.referral_reward_tokens) || 0} jeton(s)`;
      const row = node('div', 'admin-v3-list-row');
      const actions = node('div', 'admin-v3-row-actions');
      if (handlers.onEdit) {
        actions.appendChild(button(
          'Modifier',
          'admin-v3-button admin-v3-button--secondary',
          () => handlers.onEdit(rule)
        ));
      }
      if (handlers.onDelete) {
        const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger');
        remove.addEventListener('click', () => {
          inlineConfirmation(
            row,
            remove,
            `Supprimer la règle d’anticipation ${rule.display_name || rule.feature_key} ?`,
            'Confirmer',
            () => handlers.onDelete(rule)
          );
        });
        actions.appendChild(remove);
      }
      row.append(
        node('div', 'admin-v3-row-copy',
          node('strong', '', rule.display_name || rule.feature_key),
          node('div', 'admin-v3-row-meta', rule.enabled
          ? `Actif à 16h · ${Number(rule.preview_days) || 1} date(s) · ${Number(rule.token_cost_1_day ?? rule.required_tokens) || 0}/${Number(rule.token_cost_2_days ?? ((Number(rule.token_cost_1_day ?? rule.required_tokens) || 0) * 2)) || 0}/${Number(rule.token_cost_3_days ?? ((Number(rule.token_cost_1_day ?? rule.required_tokens) || 0) * 3)) || 0} jetons · validité ${Number(rule.duration_days) || 30} jour(s) · parrain : ${referralSummary}`
          : 'Désactivé')
      ),
      node('span', `admin-v3-status-badge ${rule.enabled ? 'is-active' : 'is-muted'}`, rule.enabled ? 'Actif' : 'Inactif')
      );
      if (actions.childNodes.length) row.appendChild(actions);
      target.appendChild(row);
    });
  }

  function renderTokenList(target) {
    target.replaceChildren();
    const rows = Array.isArray(state.access.tokenPrices) ? state.access.tokenPrices : [];
    if (!rows.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucun pack de jetons configuré.'));
      return;
    }
    rows.forEach((pack) => {
      const row = node('div', 'admin-v3-list-row');
      const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger');
      row.append(
        node('div', 'admin-v3-row-copy',
          node('strong', '', pack.name || pack.pack_id),
          node('div', 'admin-v3-row-meta', `${Number(pack.quantity) || 0} jetons · ${Number(pack.price_xof) || 0} XOF`)
        ),
        remove
      );
      remove.addEventListener('click', () => {
        inlineConfirmation(
          row,
          remove,
          `Supprimer le pack ${pack.name || pack.pack_id} ?`,
          'Confirmer',
          async () => {
            try {
              await deleteAdminTokenPrice(pack.pack_id);
              await refreshData();
              toast('Pack supprimé.');
            } catch (error) {
              toast(error?.message || 'Le pack n’a pas pu être supprimé.', 'error');
              throw error;
            }
          }
        );
      });
      target.appendChild(row);
    });
  }

  function renderFunctionsList(target) {
    target.replaceChildren();
    const programs = Array.isArray(state.programs.programs) ? state.programs.programs : [];
    const modules = Array.isArray(state.programs.modules) ? state.programs.modules : [];
    const rows = programs.length ? programs : modules;
    if (!rows.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucune fonction publiée.'));
      return;
    }
    rows.forEach((item) => {
      const key = item.program_key || item.module_key || item.id || 'fonction';
      const status = item.status || (item.enabled === false ? 'Désactivée' : 'Active');
      const latestDraft = (state.programs.controls || [])
        .filter((control) => (
          control.program_key === key
          && control.status === 'draft'
        ))
        .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
      const latestControl = (state.programs.controls || [])
        .filter((control) => control.program_key === key)
        .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
      const row = node(
        'div',
        'admin-v3-list-row',
        node('div', 'admin-v3-row-copy',
          node('strong', '', item.display_name || item.name || key),
          node('span', '', `${key} · ${status}`)
        )
      );
      const actions = node('div', 'admin-v3-row-actions');
      /*
       * Keep the maintenance actions visible even when a generic programme
       * has an empty tests array. An empty array is a valid draft state; the
       * server still validates the rule and returns a clear 0-test result.
       */
      if (latestControl) {
        const test = button('Tester', 'admin-v3-button admin-v3-button--secondary', async () => {
          setBusy(test, true, 'Tester', 'Test…');
          try {
            const result = await testProgramDraft({
              program: key,
              rule: latestControl.rule || {},
              tests: Array.isArray(latestControl.tests) ? latestControl.tests : []
            });
            const count = Number(result?.testsRecus) || 0;
            toast(
              result?.pretPourPublication
                ? `${key} validé (${count} test(s)).`
                : `${key} contient des erreurs de validation.`,
              result?.pretPourPublication ? 'success' : 'error'
            );
          } catch (error) {
            toast(error?.message || 'Le test du programme a échoué.', 'error');
          } finally {
            setBusy(test, false, 'Tester');
          }
        });
        actions.appendChild(test);
      }
      if (item.enabled === false && latestDraft) {
        const publish = button('Publier', 'admin-v3-button admin-v3-button--secondary', async () => {
          setBusy(publish, true, 'Publier', 'Publication…');
          try {
            await publishProgram(key, latestDraft.version);
            await loadPrograms(true);
            toast(`Le programme ${item.display_name || key} est maintenant actif.`);
          } catch (error) {
            toast(error?.message || 'Le programme n’a pas pu être publié.', 'error');
            setBusy(publish, false, 'Publier');
          }
        });
        actions.appendChild(publish);
      }
      const builtIn = new Set(['universelle', 'intuition', 'oracle', 'lnb', 'balsa', 'standby', 'robot']);
      if (!builtIn.has(String(key).toLowerCase())) {
        const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger', () => {
          inlineConfirmation(
            row,
            remove,
            `Supprimer le programme ${item.display_name || key} et ses brouillons ?`,
            'Confirmer',
            async () => {
              await deleteAdminProgram(key);
              await loadPrograms(true);
              toast(`Le programme ${item.display_name || key} a été supprimé.`);
            }
          );
        });
        actions.appendChild(remove);
      }
      row.appendChild(
        actions.childNodes.length
          ? actions
          : node('span', 'admin-v3-status-badge', item.category || 'Supabase')
      );
      target.appendChild(row);
    });
  }

  function renderValidList(target) {
    target.replaceChildren();
    if (state.validLoading && !state.valid) {
      target.appendChild(node('p', 'admin-v3-empty', 'Chargement privé des numéros du jour…'));
      return;
    }
    const entries = Object.entries(state.valid?.plans || {});
    if (!entries.length) {
      target.appendChild(node('p', 'admin-v3-empty', 'Aucune grille retournée pour cette date.'));
      return;
    }
    entries.forEach(([key, value]) => {
      const numbers = Array.isArray(value?.validNumbers)
        ? value.validNumbers
        : Array.isArray(value) ? value : [];
      const luckyNumbers = Array.isArray(value?.luckyNumbers)
        ? value.luckyNumbers
        : [];
      const programmeKey = value?.key || value?.code || '';
      const programmeDate = value?.date || state.valid?.date || '';
      target.appendChild(node(
        'div',
        'admin-v3-list-row',
        node('div', 'admin-v3-row-copy',
          node('strong', '', key),
          node('span', '', [
            programmeDate ? formatDate(programmeDate) : '',
            programmeKey ? `clé ${programmeKey}` : '',
            luckyNumbers.length
              ? `numéros chanceux : ${luckyNumbers.join(' · ')}`
              : '',
            numbers.length
              ? `numéros valides : ${numbers.join(' · ')}`
              : 'Données disponibles'
          ].filter(Boolean).join(' · '))
        ),
        node(
          'span',
          `admin-v3-status-badge ${value?.status === 'ready' ? 'is-active' : ''}`,
          value?.status === 'missing' ? 'Absent' : 'Privé · chargé'
        )
      ));
    });
  }

  function buildHome() {
    const page = node('div', 'admin-v3-home');
    const intro = node('div', 'admin-v3-home-intro',
      node('div', '', node('p', 'admin-v3-eyebrow', 'Espace protégé'), node('h2', '', 'Tableau administrateur'), node('p', '', 'Pilotez les publications, les accès et les paiements depuis un seul espace.')),
      node('span', 'admin-v3-connected', node('i', '', '●'), ' Supabase connecté')
    );
    HOME_SECTIONS.forEach((section) => {
      const sectionNode = node(
        'section',
        'admin-home-section',
        node('div', 'admin-home-section-heading',
          node('h3', '', section.title),
          node('p', '', section.description)
        )
      );
      const grid = node('div', 'admin-home-grid');
      section.cards.forEach(([route, title, description, icon]) => {
        const card = button('', 'admin-home-card', () => go(route));
        card.setAttribute('aria-label', `${title} — ${description}`);
        card.append(
          iconBox(icon),
          node('div', 'admin-home-card-title', title),
          node('div', 'admin-home-card-description', description),
          node('span', 'admin-home-card-arrow', makeIcon('arrow'))
        );
        grid.appendChild(card);
      });
      sectionNode.appendChild(grid);
      page.appendChild(sectionNode);
    });
    page.prepend(intro);
    return page;
  }

  function makeRouteHeader(route) {
    const meta = ROUTES[route];
    const back = button('', 'admin-v3-back-button', () => go('home'));
    back.append(makeIcon('back'), node('span', '', 'Retour au tableau admin'));
    return node('header', 'admin-v3-route-header',
      node('div', 'admin-v3-route-title', iconBox(meta.icon), node('div', '', node('p', 'admin-v3-eyebrow', 'Administration'), node('h2', '', meta.title), node('p', '', meta.description))),
      back
    );
  }

  function buildOverview() {
    const page = node('div', 'admin-v3-page');
    const stats = node('div', 'admin-v3-stats');
    [
      ['rules', 'Règles d’accès', state.access.rules?.length || 0, 'règle(s) configurée(s)'],
      ['sources', 'Sources pays / heures', state.config.drawSources?.length || 0, 'source(s) active(s)'],
      ['packs', 'Packs de jetons', state.access.tokenPrices?.length || 0, 'pack(s) disponible(s)']
    ].forEach(([key, label, value, suffix]) => {
      const card = node(
        'article',
        'admin-v3-stat-card',
        node('div', 'admin-v3-stat-label', label),
        node('strong', '', String(value)),
        node('small', '', suffix)
      );
      card.dataset.stat = key;
      stats.appendChild(card);
    });
    const sync = node('div', 'admin-v3-sync-card',
      node('div', '',
        node('div', 'admin-v3-section-label', 'État du système'),
        node('strong', '', 'Configuration synchronisée'),
        node('p', '', state.loadedAt ? `Dernière lecture : ${formatDate(state.loadedAt)}` : 'Lecture en attente.')
      ),
      node('span', 'admin-v3-health', node('i', '', '●'), ' Opérationnel')
    );
    const refresh = button('', 'admin-v3-button admin-v3-button--primary', async () => {
      setBusy(refresh, true, 'Rafraîchir', 'Actualisation…');
      try {
        await refreshData(true);
      } catch (error) {
        toast(error?.message || 'Actualisation impossible.', 'error');
      } finally {
        setBusy(refresh, false, 'Rafraîchir');
      }
    });
    refresh.append(makeIcon('refresh'), node('span', '', 'Rafraîchir les données'));
    sync.appendChild(refresh);
    page.append(makeRouteHeader('overview'), stats, sync);
    return page;
  }

  function buildSources() {
    const page = node('div', 'admin-v3-page');
    const form = node('form', 'admin-v3-form');
    const policy = state.config.generationPolicy || {};
    const generationTime = formatTime(policy.generationTime || '16:00');
    const generationZone = policy.timeZone || 'Africa/Abidjan';
    const policyNotice = node(
      'div',
      'admin-v3-policy-notice',
      node('strong', '', 'Génération commune'),
      node(
        'span',
        '',
        `Tous les programmes sont générés automatiquement à ${generationTime} (${generationZone}). Cette heure est globale et ne se règle pas par pays.`
      )
    );
    form.append(node('div', 'admin-v3-form-grid',
      field('Composant', 'moduleKey', {
        type: 'select',
        value: 'matrice',
        options: [
          ['matrice', 'Matrice'],
          ['boules-rejetees', 'Boules rejetées']
        ]
      }),
      field('Code pays', 'countryCode', { required: true, placeholder: 'code pays' }),
      field('Nom du pays', 'countryName', { required: true, placeholder: 'nom du pays' }),
      field('Nom du tirage', 'drawName', { required: true, placeholder: 'nom du tirage' }),
      field('Heure du tirage', 'drawTime', {
        type: 'time',
        required: true,
        value: '08:00'
      })
    ));
    form.appendChild(node('p', 'admin-v3-section-label', 'Composants générés automatiquement'));
    form.appendChild(node('div', 'admin-v3-check-grid',
      field('Inclure le Clavier', 'hasKeyboard', { type: 'checkbox', checked: true }),
      field('Inclure le Cerveau', 'hasCerveau', { type: 'checkbox' }),
      field('Générer le Code', 'hasCode', { type: 'checkbox', checked: true }),
      field('Générer l’Event', 'hasEvent', { type: 'checkbox', checked: true })
    ));
    form.appendChild(node('p', 'admin-v3-section-label', 'Jours de génération'));
    const daysGrid = node('div', 'admin-v3-check-grid admin-v3-generation-days');
    GENERATION_WEEK_DAYS.forEach(([value, label]) => {
      daysGrid.appendChild(field(label, 'generationDays', {
        type: 'checkbox',
        value: String(value),
        checked: true
      }));
    });
    form.appendChild(daysGrid);
    form.appendChild(node(
      'p',
      'admin-v3-form-help',
      'Cochez les jours où ce tirage existe. Les jours non cochés ne produiront aucune matrice pour ce pays.'
    ));
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Générer et enregistrer');
    submit.type = 'submit';
    const addAnother = button(
      'Ajouter encore',
      'admin-v3-button admin-v3-button--secondary'
    );
    addAnother.type = 'button';
    addAnother.setAttribute(
      'aria-label',
      'Réinitialiser le formulaire pour ajouter une autre matrice'
    );
    addAnother.addEventListener('click', () => {
      form.reset();
      form.elements.namedItem('moduleKey').value = 'matrice';
      setStatus(status, 'Formulaire prêt pour une nouvelle matrice.', 'success');
      form.elements.namedItem('countryCode')?.focus();
    });
    form.appendChild(makeFormActions(submit, status, addAnother));
    runForm(form, submit, async (data) => {
      await generateAdminDrawSource({
        moduleKey: data.get('moduleKey'),
        countryCode: data.get('countryCode'),
        countryName: data.get('countryName'),
        drawName: data.get('drawName'),
        drawTime: data.get('drawTime'),
        hasKeyboard: data.get('hasKeyboard') === 'on',
        hasCerveau: data.get('hasCerveau') === 'on',
        hasCode: data.get('hasCode') === 'on',
        hasEvent: data.get('hasEvent') === 'on',
        generationDays: data.getAll('generationDays').map(Number)
      });
      await refreshData();
    }, status);
    const list = node('div', 'admin-v3-list');
    renderSourceList(list);
    const crossList = node('div', 'admin-v3-list');
    async function renderCrossList() {
      crossList.replaceChildren(
        node('p', 'admin-v3-empty', 'Chargement des Croix historiques…')
      );
      try {
        const rows = await fetchAdminCrossGenerations();
        crossList.replaceChildren();
        rows.forEach((cross) => {
          const row = node(
            'div',
            'admin-v3-list-row',
            node(
              'div',
              'admin-v3-row-copy',
              node('strong', '', `Croix du ${formatDate(cross.programme_date)}`),
              node(
                'span',
                '',
                `${cross.scope_key || '—'} · terminaison ${cross.visible_terminaison || '—'} · ${cross.signature || 'signature indisponible'}`
              )
            )
          );
          const remove = button(
            'Supprimer',
            'admin-v3-button admin-v3-button--danger',
            () => {
              inlineConfirmation(
                row,
                remove,
                'Supprimer cette ancienne Croix nationale ? Elle ne sera plus disponible dans l’historique public.',
                'Confirmer',
                async () => {
                  await deleteAdminCrossGeneration({
                    id: cross.id,
                    programmeDate: cross.programme_date
                  });
                  await renderCrossList();
                  toast('Ancienne Croix supprimée.');
                }
              );
            }
          );
          row.appendChild(remove);
          crossList.appendChild(row);
        });
        if (!crossList.childNodes.length) {
          crossList.appendChild(
            node('p', 'admin-v3-empty', 'Aucune Croix historique enregistrée.')
          );
        }
      } catch (error) {
        crossList.replaceChildren(
          node(
            'p',
            'admin-v3-status is-error',
            error?.message || 'Impossible de lire les Croix historiques.'
          )
        );
      }
    }
    page.append(
      makeRouteHeader('sources'),
      makeCard(
        'Ajouter une source',
        'Chaque enregistrement ajoute un pays et un horaire à la liste. Répétez l’opération pour chaque nouvelle matrice. La même combinaison pays + heure met à jour cette ligne uniquement ; elle ne remplace pas les autres pays.',
        node('div', 'admin-v3-form-stack', policyNotice, form),
        'admin-v3-form-card'
      ),
      makeCard('Sources configurées', 'Les suppressions sont confirmées puis synchronisées immédiatement.', list),
      makeCard(
        'Croix nationales historiques',
        'Cette maintenance permet de retirer une ancienne publication. La Croix du programme courant est protégée.',
        crossList
      )
    );
    void renderCrossList();
    return page;
  }

  function buildRules({ historyOnly = false } = {}) {
    const page = node('div', 'admin-v3-page');
    const form = node('form', 'admin-v3-form');
    const options = featureCatalog(state).filter(([value]) => (
      !historyOnly || value.startsWith('historique-')
    ));
    form.append(node('div', 'admin-v3-form-grid',
      field('Programme ou fonctionnalité', 'featureKey', {
        type: 'select',
        required: true,
        options
      }),
      field('Nom affiché', 'displayName', { placeholder: 'Nom public' }),
      field('Monnaie', 'unlockCurrency', { type: 'select', options: [['tokens', 'Jetons'], ['stars', 'Étoiles']] }),
      field('Jetons requis', 'requiredTokens', { type: 'number', min: 0 }),
      field('Étoiles requises', 'requiredStars', { type: 'number', min: 0 }),
      field('Durée d’accès (jours)', 'durationDays', { type: 'number', min: 1, max: 3650, value: 30 }),
      field('Jours gratuits avant historique', 'historyFreeDays', { type: 'number', min: 0, max: 3650, value: 0 }),
      field('Étoiles au parrain (vide = global)', 'referralRewardStars', { type: 'number', min: 0, value: '' }),
      field('Jetons au parrain (vide = global)', 'referralRewardTokens', { type: 'number', min: 0, value: '' }),
      field('Activer la règle', 'enabled', { type: 'checkbox', checked: true })
    ));
    const featureSelect = form.elements.namedItem('featureKey');
    const displayNameInput = form.elements.namedItem('displayName');
    const syncDisplayName = () => {
      const selected = options.find(([value]) => value === featureSelect?.value);
      if (selected && displayNameInput && !displayNameInput.value.trim()) {
        displayNameInput.value = selected[1];
      }
    };
    featureSelect?.addEventListener('change', syncDisplayName);
    syncDisplayName();
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer la règle');
    submit.type = 'submit';
    form.appendChild(makeFormActions(submit, status));

    const fillRuleForm = (rule) => {
      featureSelect.value = rule.feature_key || '';
      displayNameInput.value = rule.display_name || '';
      form.elements.namedItem('unlockCurrency').value = rule.unlock_currency || 'tokens';
      form.elements.namedItem('requiredTokens').value = Number(rule.required_tokens) || 0;
      form.elements.namedItem('requiredStars').value = Number(rule.required_stars) || 0;
      form.elements.namedItem('durationDays').value = Number(rule.duration_days) || 30;
      form.elements.namedItem('historyFreeDays').value = Number(rule.history_free_days) || 0;
      form.elements.namedItem('referralRewardStars').value = rule.referral_reward_stars == null ? '' : Number(rule.referral_reward_stars) || 0;
      form.elements.namedItem('referralRewardTokens').value = rule.referral_reward_tokens == null ? '' : Number(rule.referral_reward_tokens) || 0;
      form.elements.namedItem('enabled').checked = rule.enabled !== false;
      submit.textContent = 'Modifier la règle';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    runForm(form, submit, async (data) => {
      await requestAdmin({
        action: 'save-access-rule',
        featureKey: data.get('featureKey'),
        displayName: data.get('displayName'),
        unlockCurrency: data.get('unlockCurrency'),
        requiredTokens: numberValue(form, 'requiredTokens'),
        requiredStars: numberValue(form, 'requiredStars'),
        durationDays: numberValue(form, 'durationDays', 30),
        historyFreeDays: numberValue(form, 'historyFreeDays', 0),
        referralRewardStars: optionalNumberValue(form, 'referralRewardStars'),
        referralRewardTokens: optionalNumberValue(form, 'referralRewardTokens'),
        enabled: form.elements.namedItem('enabled')?.checked !== false,
        planSlug: null
      });
      await refreshData();
    }, status);
    const list = node('div', 'admin-v3-list');
    renderRulesList(list, {
      filter: historyOnly
        ? (rule) => String(rule.feature_key || '').startsWith('historique-')
        : undefined,
      onEdit: fillRuleForm,
      onDelete: async (rule) => {
        await deleteAdminAccessRule(rule.feature_key);
        await refreshData();
        toast('Règle supprimée.');
      }
    });
    const planForm = node('form', 'admin-v3-form');
    planForm.append(node('div', 'admin-v3-form-grid',
      field('Identifiant de l’abonnement', 'slug', {
        required: true,
        placeholder: 'ex. premium'
      }),
      field('Nom de l’abonnement', 'planDisplayName', {
        required: true,
        placeholder: 'Abonnement Premium'
      }),
      field('Monnaie principale', 'planCurrency', {
        type: 'select',
        options: [['tokens', 'Jetons'], ['stars', 'Étoiles']]
      }),
      field('Jetons requis', 'planTokens', { type: 'number', min: 0 }),
      field('Prix normal (jetons)', 'planRegularTokens', { type: 'number', min: 0 }),
      field('Étoiles requises', 'planStars', { type: 'number', min: 0 }),
      field('Étoiles au parrain', 'planReferralRewardStars', { type: 'number', min: 0, value: 0 }),
      field('Jetons au parrain', 'planReferralRewardTokens', { type: 'number', min: 0, value: 0 }),
      field('Durée (jours)', 'planDuration', { type: 'number', min: 1, value: 30 }),
      field('Libellé de promotion', 'planPromotionLabel', {
        placeholder: 'Offre spéciale'
      }),
      field('Fin de promotion', 'planPromotionEndsAt', { type: 'date' }),
      field('Activer la promotion', 'planPromotionEnabled', { type: 'checkbox' })
    ));
    planForm.appendChild(node('span', 'admin-v3-section-label', 'Programmes inclus — cliquez pour sélectionner'));
    planForm.appendChild(featurePicker('features', state));
    const planStatus = makeStatus();
    const planSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer l’abonnement');
    planSubmit.type = 'submit';
    planForm.appendChild(makeFormActions(planSubmit, planStatus));

    const fillPlanForm = (plan) => {
      const setValue = (name, value) => {
        const input = planForm.elements.namedItem(name);
        if (input) input.value = value == null ? '' : String(value);
      };
      setValue('slug', plan.slug);
      setValue('planDisplayName', plan.display_name);
      setValue('planCurrency', plan.unlock_currency || 'tokens');
      setValue('planTokens', Number(plan.required_tokens) || 0);
      setValue('planRegularTokens', Number(plan.regular_tokens ?? plan.required_tokens) || 0);
      setValue('planStars', Number(plan.required_stars) || 0);
      setValue('planReferralRewardStars', Number(plan.referral_reward_stars) || 0);
      setValue('planReferralRewardTokens', Number(plan.referral_reward_tokens) || 0);
      setValue('planDuration', Number(plan.duration_days) || 30);
      setValue('planPromotionLabel', plan.promotion_label || '');
      setValue('planPromotionEndsAt', String(plan.promotion_ends_at || '').slice(0, 10));
      const promotion = planForm.elements.namedItem('planPromotionEnabled');
      if (promotion) promotion.checked = plan.promotion_enabled === true;
      const features = new Set(Array.isArray(plan.features) ? plan.features : []);
      planForm.querySelectorAll('input[name="features"]').forEach((input) => {
        input.checked = features.has(input.value);
      });
      planSubmit.textContent = 'Modifier l’abonnement';
      planForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    runForm(planForm, planSubmit, async (data) => {
      await saveAdminPlan({
        slug: data.get('slug'),
        display_name: data.get('planDisplayName'),
        unlock_currency: data.get('planCurrency'),
        required_tokens: numberValue(planForm, 'planTokens'),
        regular_tokens: numberValue(planForm, 'planRegularTokens', numberValue(planForm, 'planTokens')),
        promotion_enabled: Boolean(planForm.elements.namedItem('planPromotionEnabled')?.checked),
        promotion_label: data.get('planPromotionLabel'),
        promotion_ends_at: data.get('planPromotionEndsAt'),
        required_stars: numberValue(planForm, 'planStars'),
        duration_days: numberValue(planForm, 'planDuration', 30),
        referral_reward_stars: numberValue(planForm, 'planReferralRewardStars', 0),
        referral_reward_tokens: numberValue(planForm, 'planReferralRewardTokens', 0),
        payment_mode: 'manual',
        price_label: '',
        features: data.getAll('features'),
        enabled: true
      });
      planForm.reset();
      await refreshData();
    }, planStatus);
    const plansList = node('div', 'admin-v3-list');
    (state.access.plans || []).forEach((plan) => {
      const row = node('div', 'admin-v3-list-row');
      const actions = node('div', 'admin-v3-row-actions');
      const edit = button(
        'Modifier',
        'admin-v3-button admin-v3-button--secondary',
        () => fillPlanForm(plan)
      );
      const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger');
      remove.addEventListener('click', () => {
        inlineConfirmation(
          row,
          remove,
          `Supprimer l’abonnement ${plan.display_name || plan.slug} ? Les accès actifs seront annulés, mais l’historique sera conservé.`,
          'Confirmer',
          async () => {
            await deleteAdminPlan(plan.slug);
            await refreshData();
            toast('Abonnement supprimé.');
          }
        );
      });
      actions.append(edit, remove);
      row.append(
        node('div', 'admin-v3-row-copy',
          node('strong', '', plan.display_name || plan.slug),
          node('div', 'admin-v3-row-meta', `${plan.slug} · ${(plan.features || []).length} programme(s) inclus · parrain : ${Number(plan.referral_reward_stars) || 0} étoile(s) / ${Number(plan.referral_reward_tokens) || 0} jeton(s)`)
        ),
        node('span', `admin-v3-status-badge ${plan.enabled === false ? 'is-muted' : 'is-active'}`,
          plan.enabled === false
            ? 'Inactif'
            : plan.promotion_enabled
              ? `Promo · ${Number(plan.required_tokens) || 0} jetons`
              : 'Actif')
      );
      row.append(actions);
      plansList.appendChild(row);
    });
    if (!plansList.childNodes.length) {
      plansList.appendChild(node('p', 'admin-v3-empty', 'Aucun abonnement configuré.'));
    }
    const cards = [
      makeRouteHeader(historyOnly ? 'history' : 'rules'),
      makeCard(
        historyOnly ? 'Configurer un historique' : 'Nouvelle règle',
        historyOnly
          ? 'Choisissez un domaine historique, définissez sa période gratuite, son tarif et sa durée d’accès.'
          : 'Sélectionnez un programme dans le catalogue. La récompense affichée ici est prioritaire sur le réglage global.',
        form,
        'admin-v3-form-card'
      ),
      makeCard(
        historyOnly ? 'Historiques configurés' : 'Règles enregistrées',
        historyOnly
          ? 'Ces règles pilotent directement l’accès public à la rubrique Historique.'
          : 'Configuration actuellement active.',
        list
      )
    ];
    if (!historyOnly) {
      cards.push(
        makeCard('Créer un abonnement et sa récompense d’affiliation', 'Cochez les programmes inclus, puis indiquez les étoiles et les jetons à attribuer au parrain lors du premier accès qualifiant du filleul.', planForm, 'admin-v3-form-card'),
        makeCard('Abonnements enregistrés', 'Les programmes inclus viennent de Supabase.', plansList)
      );
    }
    page.append(...cards);
    if (!state.programsLoading && !state.programs.programs.length && !state.programs.modules.length) {
      void loadPrograms();
    }
    return page;
  }

  function buildHistory() {
    return buildRules({ historyOnly: true });
  }

  function buildPromotions() {
    const page = node('div', 'admin-v3-page');
    const form = node('form', 'admin-v3-form');
    const featureOptions = [['', 'Aucun schéma spécifique'], ...featureCatalog(state)];
    form.append(node('div', 'admin-v3-form-grid',
      field('Pays ciblé', 'countryCode', {
        type: 'select',
        options: [
          ['ALL', 'Tous les pays'],
          ['CI', 'Côte d’Ivoire'],
          ['BJ', 'Bénin'],
          ['NE', 'Niger'],
          ['GH', 'Ghana'],
          ['SN', 'Sénégal'],
          ['TG', 'Togo']
        ]
      }),
      field('Emplacement', 'placement', {
        type: 'select',
        options: [
          ['homepage', 'Accueil'],
          ['tableaux', 'Tableaux'],
          ['account', 'Compte'],
          ['all', 'Tous les emplacements']
        ]
      }),
      field('Titre de la bannière', 'title', {
        required: true,
        placeholder: 'Le schéma qui donne de bons résultats'
      }),
      field('Titre anglais (facultatif)', 'titleEn', {
        placeholder: 'English banner title'
      }),
      field('Titre espagnol (facultatif)', 'titleEs', {
        placeholder: 'Título de la pancarta'
      }),
      field('Description', 'description', {
        placeholder: 'Présentez le résultat ou la clé mise en avant'
      }),
      field('Description anglaise (facultatif)', 'descriptionEn', {
        placeholder: 'English banner description'
      }),
      field('Description espagnole (facultatif)', 'descriptionEs', {
        placeholder: 'Descripción de la pancarta'
      }),
      field('Schéma concerné', 'featureKey', {
        type: 'select',
        options: featureOptions
      }),
      field('Clé ou résultat à afficher', 'keyValue', {
        placeholder: 'Ex. 27 · 42 · 63'
      }),
      field('Lien cible', 'targetUrl', {
        placeholder: '/ ou https://…'
      }),
      field('Libellé du bouton', 'actionLabel', {
        placeholder: 'Voir le schéma'
      }),
      field('Bouton anglais (facultatif)', 'actionLabelEn', {
        placeholder: 'View the method'
      }),
      field('Bouton espagnol (facultatif)', 'actionLabelEs', {
        placeholder: 'Ver el método'
      }),
      field('Ordre de défilement', 'sortOrder', {
        type: 'number',
        min: 0,
        value: 0
      }),
      field('Début', 'startsAt', { type: 'datetime-local' }),
      field('Fin', 'endsAt', { type: 'datetime-local' }),
      field('Bannière active', 'enabled', { type: 'checkbox', checked: true })
    ));
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Publier la bannière');
    submit.type = 'submit';
    form.appendChild(makeFormActions(submit, status));
    runForm(form, submit, async (data) => {
      await savePromoBanner({
        placement: data.get('placement'),
        countryCode: data.get('countryCode'),
        title: data.get('title'),
        titleI18n: {
          fr: data.get('title'),
          en: data.get('titleEn'),
          es: data.get('titleEs')
        },
        description: data.get('description'),
        descriptionI18n: {
          fr: data.get('description'),
          en: data.get('descriptionEn'),
          es: data.get('descriptionEs')
        },
        featureKey: data.get('featureKey'),
        keyValue: data.get('keyValue'),
        targetUrl: data.get('targetUrl'),
        actionLabel: data.get('actionLabel'),
        actionLabelI18n: {
          fr: data.get('actionLabel'),
          en: data.get('actionLabelEn'),
          es: data.get('actionLabelEs')
        },
        sortOrder: numberValue(form, 'sortOrder'),
        startsAt: data.get('startsAt'),
        endsAt: data.get('endsAt'),
        enabled: Boolean(form.elements.namedItem('enabled')?.checked)
      });
      form.reset();
      await renderPromoList();
    }, status);

    const list = node('div', 'admin-v3-list');
    async function renderPromoList() {
      list.replaceChildren(node('p', 'admin-v3-empty', 'Chargement des bannières…'));
      try {
        const banners = await listPromoBanners();
        list.replaceChildren();
        banners.forEach((banner) => {
          const row = node(
            'div',
            'admin-v3-list-row',
            node(
              'div',
              'admin-v3-row-copy',
              node('strong', '', banner.title),
              node(
                'span',
                '',
                `${banner.country_code || 'ALL'} · ${banner.placement} · ${banner.feature_key || 'tous les schémas'}`
              )
            ),
            node(
              'button',
              'admin-v3-button admin-v3-button--quiet',
              'Supprimer'
            )
          );
          row.lastElementChild.addEventListener('click', async () => {
            await deletePromoBanner(banner.id);
            await renderPromoList();
          });
          list.appendChild(row);
        });
        if (!list.childNodes.length) {
          list.appendChild(node('p', 'admin-v3-empty', 'Aucune bannière publiée.'));
        }
      } catch (error) {
        list.replaceChildren(node(
          'p',
          'admin-v3-status is-error',
          error?.message || 'Impossible de lire les bannières.'
        ));
      }
    }
    void renderPromoList();
    page.append(
      makeRouteHeader('promotions'),
      makeCard(
        'Nouvelle bannière',
        'Mettez en avant un Tableau, sa clé ou un résultat remarqué.',
        form,
        'admin-v3-form-card'
      ),
      makeCard(
        'Bannières publiées',
        'Les visiteurs verront les bannières actives selon leur emplacement et leurs dates.',
        list
      )
    );
    return page;
  }

  function buildResultats() {
    const page = node('div', 'admin-v3-page');
    const data = state.resultatAide || {};
    const draws = Array.isArray(data.draws) ? data.draws : [];
    const records = Array.isArray(data.records) ? data.records : [];
    const stats = Array.isArray(data.stats) ? data.stats : [];
    const dayStats = Array.isArray(data.dayStats) ? data.dayStats : [];
    // Older result-helf deployments do not return the capability flag yet;
    // the server still enforces the principal-admin check on delete-draw.
    const canDeleteResults = data.canDeleteResults !== false;
    const trafficSummary = data.traffic?.summary || {};
    const analyticsViews = {
      draws: {
        title: 'Résultats publiés',
        description: 'Consulter et supprimer les résultats publiés par les contributeurs.',
        icon: 'functions'
      },
      traffic: {
        title: 'Trafic & statistiques',
        description: 'Volumes d’actions enregistrées par pays et types de vues.',
        icon: 'overview'
      },
      import: {
        title: 'Import intelligent',
        description: 'Ajouter plusieurs résultats à partir d’un pays, d’une date et d’un fichier ou texte.',
        icon: 'sources'
      },
      matches: {
        title: 'Correspondances détaillées',
        description: 'Consulter l’historique privé des programmes, NAP, clés et ordres.',
        icon: 'functions'
      },
      trends: {
        title: 'Tendances par semaine',
        description: 'Comparer les performances des programmes selon le jour de la semaine.',
        icon: 'overview'
      }
    };
    const activeView = analyticsViews[state.resultatAideView] ? state.resultatAideView : 'home';
    const openAnalyticsView = (view) => {
      state.resultatAideView = view;
      renderRoute();
      window.scrollTo(0, 0);
      if (view !== 'import' && !state.resultatAide && !state.resultatAideLoading) {
        void loadResultatAide();
      }
    };
    const backToAnalyticsHome = () => {
      state.resultatAideView = 'home';
      renderRoute();
      window.scrollTo(0, 0);
    };
    if (activeView === 'home') {
      const home = node('div', 'admin-v3-analytics-home');
      const heading = node(
        'div',
        'admin-v3-analytics-home-heading',
        node('p', 'admin-v3-eyebrow', 'Espace analytique Cidmap'),
        node('h3', '', 'Pilotage Résultat-Aide'),
        node('p', '', 'Choisissez une vue pour accéder directement aux données utiles.')
      );
      const cards = node('div', 'admin-v3-analytics-view-grid');
      Object.entries(analyticsViews).forEach(([view, meta]) => {
        const card = button('', 'admin-v3-analytics-view-card', () => openAnalyticsView(view));
        card.setAttribute('aria-label', `${meta.title} — ${meta.description}`);
        card.append(
          iconBox(meta.icon),
          node('strong', '', meta.title),
          node('span', '', meta.description),
          node('i', '', makeIcon('arrow'))
        );
        cards.appendChild(card);
      });
      home.append(makeRouteHeader('resultats'), heading, cards);
      page.appendChild(home);
      return page;
    }
    const locale = window.cidTranslation?.current?.() || 'fr';
    const number = (value) => Number(value || 0).toLocaleString(locale);
    const percentage = (value) => `${Number(value || 0).toLocaleString(locale, {
      maximumFractionDigits: 1
    })} %`;
    const statusLabels = {
      pending: 'En attente',
      published: 'Validé',
      disputed: 'Contesté',
      rejected: 'Rejeté'
    };
    const kindLabels = {
      key: 'Clé',
      order: 'Ordre',
      nap1: 'NAP 1',
      nap2: 'NAP 2',
      combination: 'Combinaison',
      satellite: 'Satellite',
      permutation: 'Permutation'
    };
    const table = (headers, rows, emptyMessage, className = '') => {
      const wrap = node('div', `admin-v3-table-wrap admin-v3-results-table-wrap ${className}`.trim());
      const tableNode = node('table', 'admin-v3-table admin-v3-results-table');
      const head = node('thead', '', node('tr', '', ...headers.map((label) => node('th', '', label))));
      const body = node('tbody');
      if (!rows.length) {
        const emptyRow = node('tr', '', node('td', 'admin-v3-table-empty', emptyMessage));
        emptyRow.firstElementChild.colSpan = headers.length;
        body.appendChild(emptyRow);
      } else {
        rows.forEach((row) => body.appendChild(row));
      }
      tableNode.append(head, body);
      wrap.appendChild(tableNode);
      return wrap;
    };

    const filters = node('form', 'admin-v3-form');
    filters.append(node('div', 'admin-v3-form-grid admin-v3-result-filters-grid',
      field('Code pays', 'countryCode', { placeholder: 'BJ, CI…' }),
      field('Semaine ISO', 'weekKey', { placeholder: '2026-W36' }),
      field('Mois', 'monthKey', { type: 'month' }),
      field('Heure du tirage', 'drawTime', { type: 'time' }),
      field('Statut', 'status', {
        type: 'select',
        options: [
          ['', 'Tous les statuts'],
          ['pending', 'En attente'],
          ['published', 'Publié'],
          ['disputed', 'Contesté'],
          ['rejected', 'Rejeté']
        ]
      }),
      field('Du', 'fromDate', { type: 'date' }),
      field('Au', 'toDate', { type: 'date' })
    ));
    const filterStatus = makeStatus();
    const filterSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Actualiser les données');
    filterSubmit.type = 'submit';
    filters.appendChild(makeFormActions(filterSubmit, filterStatus));
    runForm(filters, filterSubmit, async () => {
      await loadResultatAide({
        countryCode: formValue(filters, 'countryCode'),
        status: formValue(filters, 'status'),
        fromDate: formValue(filters, 'fromDate'),
        toDate: formValue(filters, 'toDate'),
        weekKey: formValue(filters, 'weekKey'),
        monthKey: formValue(filters, 'monthKey'),
        drawTime: formValue(filters, 'drawTime')
      }, true);
    }, filterStatus, false);

    const statCards = node('div', 'admin-v3-stats admin-v3-result-kpis');
    [
      ['draws', 'Tirages enregistrés / soumis', draws.length, 'soumis ou publiés'],
      ['published', 'Tirages validés', draws.filter((row) => row.status === 'published').length, 'statut publié'],
      ['matches', 'Correspondances privées', records.length, 'lignes comparées'],
      ['traffic', 'Événements de trafic', Object.values(trafficSummary).reduce((sum, value) => sum + Number(value || 0), 0), 'actions enregistrées']
    ].forEach(([key, label, value, suffix]) => {
      const card = node('article', 'admin-v3-stat-card',
        node('div', 'admin-v3-stat-label', label),
        node('strong', '', String(value)),
        node('small', '', suffix)
      );
      card.dataset.stat = key;
      statCards.appendChild(card);
    });

    const drawRows = draws.map((draw) => {
      const actions = node('div', 'admin-v3-row-actions');
      const row = node('tr');
      const actionCell = node('td', 'admin-v3-result-action-cell', actions);
      const drawNumber = draw.draw_number !== null
        && draw.draw_number !== undefined
        && String(draw.draw_number).trim() !== ''
        ? ` · Tirage ${draw.draw_number}`
        : '';
      const dateCell = node('td', 'admin-v3-results-date-cell',
        node('strong', '', `${draw.country_code || '—'} · ${formatDate(draw.draw_date)}`),
        node('small', '', `${formatTime(draw.draw_time)}${drawNumber}`)
      );
      const volumeCell = node('td', '',
        node('strong', '', draw.source || 'Visiteur'),
        node('small', '', `${draw.first_numbers?.length || 0} premiers · ${draw.machine_numbers?.length || 0} machine`)
      );
      const statusCell = node('td', '',
        node('span', `admin-v3-status-badge ${draw.status === 'published' ? 'is-active' : draw.status === 'rejected' ? 'is-failed' : ''}`, statusLabels[draw.status] || draw.status || 'Inconnu')
      );
      if (['pending', 'disputed'].includes(draw.status)) {
        const publish = button('Valider', 'admin-v3-button admin-v3-button--primary', async () => {
          setBusy(publish, true, 'Valider', 'Évaluation…');
          try {
            await validateResultatAideDraw(draw.id, 'published');
            await loadResultatAide();
            toast('Tirage validé et statistiques recalculées.');
          } catch (error) {
            toast(error?.message || 'Le tirage n’a pas pu être validé.', 'error');
            setBusy(publish, false, 'Valider');
          }
        });
        const reject = button('Rejeter', 'admin-v3-button admin-v3-button--danger', () => {
          inlineConfirmation(
            actionCell,
            reject,
            'Rejeter ce résultat ?',
            'Confirmer',
            async () => {
              try {
                await validateResultatAideDraw(draw.id, 'rejected');
                await loadResultatAide();
                toast('Résultat rejeté.');
              } catch (error) {
                toast(error?.message || 'Le résultat n’a pas pu être rejeté.', 'error');
                throw error;
              }
            }
          );
        });
        actions.append(publish, reject);
      }
      if (draw.status === 'published' && canDeleteResults) {
        const deleteButton = button('Supprimer', 'admin-v3-button admin-v3-button--danger', () => {
          inlineConfirmation(
            actionCell,
            deleteButton,
            `Supprimer définitivement ${draw.country_code || 'ce pays'} · ${formatDate(draw.draw_date)} · ${formatTime(draw.draw_time)}${drawNumber} ?`,
            'Supprimer définitivement',
            async () => {
              await deleteResultatAideDraw(draw.id);
              await loadResultatAide();
              toast('Résultat publié supprimé.');
            }
          );
        });
        deleteButton.title = 'Supprimer ce résultat publié';
        actions.appendChild(deleteButton);
      }
      row.append(dateCell, volumeCell, statusCell, actionCell);
      return row;
    });
    const drawsTable = table(
      ['Date / tirage', 'Source', 'Statut', 'Action'],
      drawRows,
      state.resultatAideLoading ? 'Chargement des résultats…' : 'Aucun résultat enregistré.',
      'admin-v3-published-results-table-wrap'
    );

    const statsRows = stats.slice(0, 100).map((row) => {
      const metric = (name) => percentage((row[`${name}_metric`] || {}).percentage);
      return node(
        'tr',
        '',
        node('td', '', node('strong', '', row.country_code || '—'), node('small', '', row.week_key || '—')),
        node('td', '', node('strong', '', row.program_name || row.program_key || 'Programme'), node('small', '', `${number(row.draws_evaluated)} tirage(s)`)),
        node('td', 'admin-v3-metric-cell', metric('key')),
        node('td', 'admin-v3-metric-cell', metric('order')),
        node('td', 'admin-v3-metric-cell', metric('nap1')),
        node('td', 'admin-v3-metric-cell admin-v3-metric-cell--accent', metric('overall'))
      );
    });
    const statsTable = table(
      ['Pays / semaine', 'Programme', 'Clé', 'Ordre', 'NAP 1', 'Global'],
      statsRows,
      state.resultatAideLoading ? 'Chargement des statistiques…' : 'Aucune statistique calculée.',
      'admin-v3-weekly-table-wrap'
    );

    const dayGroups = new Map();
    dayStats.slice(0, 150).forEach((row) => {
      const day = row.day_name || 'Jour non défini';
      if (!dayGroups.has(day)) dayGroups.set(day, []);
      dayGroups.get(day).push(row);
    });
    const dayStatsGrid = node('div', 'admin-v3-day-comparison-grid');
    dayGroups.forEach((rows, dayName) => {
      const dayCard = node('article', 'admin-v3-day-comparison-card');
      const dayHeader = node('header', 'admin-v3-day-comparison-header',
        node('div', '',
          node('span', 'admin-v3-day-kicker', 'Tendance'),
          node('h4', '', dayName)
        ),
        node('span', 'admin-v3-day-count', `${rows.length} programme(s)`)
      );
      const programList = node('div', 'admin-v3-day-program-list');
      rows.forEach((row) => {
        const metrics = node('div', 'admin-v3-day-metrics',
          node('div', '', node('span', '', 'Clé'), node('strong', '', percentage(row.key_metric?.percentage))),
          node('div', '', node('span', '', 'Ordre'), node('strong', '', percentage(row.order_metric?.percentage))),
          node('div', 'is-global', node('span', '', 'Global'), node('strong', '', percentage(row.overall_metric?.percentage)))
        );
        programList.appendChild(node('div', 'admin-v3-day-program',
          node('div', 'admin-v3-day-program-title',
            node('strong', '', row.program_name || row.program_key || 'Programme'),
            node('span', '', `${row.country_code || '—'} · ${number(row.draws_evaluated)} tirage(s)`)
          ),
          metrics
        ));
      });
      dayCard.append(dayHeader, programList);
      dayStatsGrid.appendChild(dayCard);
    });
    if (!dayStatsGrid.childNodes.length) {
      dayStatsGrid.appendChild(node('p', 'admin-v3-empty', state.resultatAideLoading
        ? 'Chargement des tendances…'
        : 'Aucune tendance par jour calculée.'));
    }

    const recordRows = records.slice(0, 150).map((record) => {
      const match = record.match || {};
      const matchStatusIcon = (hit) => {
        const icon = node('span', `admin-v3-match-status-icon ${hit ? 'is-success' : 'is-neutral'}`, hit ? '✓' : '×');
        const label = hit ? 'Correspondance réussie' : 'Correspondance non trouvée';
        icon.title = label;
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', label);
        return icon;
      };
      const detailLine = (label, value, className = '') => node(
        'div',
        `admin-v3-match-line ${className}`.trim(),
        node('span', '', label),
        node('strong', '', value)
      );
      const detailCell = node('td', 'admin-v3-match-details',
        detailLine('Type', kindLabels[match.kind] || match.predictionLabel || match.kind || 'Comparaison'),
        detailLine('Annoncé', (match.predictedNumbers || []).join(' · ') || '—'),
        detailLine('Trouvé', (match.matchedNumbers || []).join(' · ') || '—', match.hit ? 'is-hit' : 'is-miss'),
        match.matchedGroups?.length ? detailLine('Groupes', match.matchedGroups.join(' · ')) : null
      );
      return node(
        'tr',
        '',
        node('td', 'admin-v3-results-date-cell',
          node('strong', '', `${record.countryCode || '—'} · ${formatDate(record.drawDate)}`),
          node('small', '', `${formatTime(record.drawTime)} · ${record.dayKey || '—'}`)
        ),
        node('td', '',
          node('strong', '', record.programName || 'Programme'),
          node('small', '', `${record.weekKey || '—'} · ${match.level || 'niveau standard'}`)
        ),
        detailCell,
        node('td', 'admin-v3-result-status-cell', matchStatusIcon(match.hit))
      );
    });
    const recordsTable = table(
      ['Date', 'Programme', 'Détails annoncés / trouvés', 'Statut'],
      recordRows,
      state.resultatAideLoading ? 'Chargement des correspondances…' : 'Aucune correspondance détaillée.',
      'admin-v3-matches-table-wrap'
    );

    const trafficTotal = Object.values(trafficSummary).reduce((sum, value) => sum + Number(value || 0), 0);
    const trafficList = node('div', 'admin-v3-traffic-grid');
    Object.entries(trafficSummary).forEach(([key, count]) => {
      const [actionName, countryName] = key.split(':');
      trafficList.appendChild(node(
        'article',
        'admin-v3-traffic-item',
        node('div', 'admin-v3-traffic-item-heading',
          node('strong', '', actionName || 'Action'),
          node('span', '', countryName || 'Tous les pays')
        ),
        node('b', '', number(count))
      ));
    });
    if (!trafficList.childNodes.length) {
      trafficList.appendChild(node('p', 'admin-v3-empty', 'Aucun trafic enregistré.'));
    }
    const trafficPanel = node('div', 'admin-v3-traffic-panel',
      node('div', 'admin-v3-traffic-total',
        node('span', '', 'Volume total'),
        node('strong', '', number(trafficTotal))
      ),
      trafficList
    );

    const importPanel = createAdminResultImport({
      loadSchedules: (countryCode) => fetchAdminResultSchedules(countryCode),
      saveSchedules: (countryCode, schedules) => saveAdminResultSchedules(countryCode, schedules),
      onSave: async (payload) => {
        const result = await importAdminResultatAideDraws(payload);
        await loadResultatAide();
        return result;
      }
    });
    const viewBack = button('Retour aux vues analytiques', 'admin-v3-button admin-v3-button--secondary', backToAnalyticsHome);
    page.append(
      makeRouteHeader('resultats'),
      node('div', 'admin-v3-analytics-view-toolbar',
        node('span', '', analyticsViews[activeView].title),
        viewBack
      )
    );
    if (activeView === 'draws') {
      page.append(
        makeCard(
          'Résultats publiés',
          'Chaque ligne est identifiable par son pays, sa date, son heure et son numéro de tirage. La suppression est réservée à l’administration autorisée.',
          drawsTable
        ),
        makeCard('Filtres des résultats', 'Affinez la liste avant de supprimer une publication erronée.', filters, 'admin-v3-form-card admin-v3-results-filter-card')
      );
    } else if (activeView === 'traffic') {
      page.append(
        makeCard('Filtres de la mémoire', 'Filtrez les volumes et événements selon le pays, la semaine, le mois ou l’heure.', filters, 'admin-v3-form-card admin-v3-results-filter-card'),
        statCards,
        makeCard('Trafic Résultat-Aide', 'Volumes d’actions enregistrées par pays.', trafficPanel, 'admin-v3-traffic-section')
      );
    } else if (activeView === 'import') {
      page.append(importPanel);
    } else if (activeView === 'matches') {
      page.append(
        makeCard('Filtres de la mémoire', 'Affinez l’historique privé par pays, période, semaine ISO, mois ou heure.', filters, 'admin-v3-form-card admin-v3-results-filter-card'),
        makeCard('Correspondances détaillées', 'Historique privé des programmes, NAP, combinaisons, clés et ordres.', recordsTable)
      );
    } else if (activeView === 'trends') {
      page.append(
        makeCard('Filtres de la mémoire', 'Comparez une période précise pour isoler les tendances utiles.', filters, 'admin-v3-form-card admin-v3-results-filter-card'),
        makeCard('Statistiques par pays et semaine', 'Les pourcentages sont calculés sur les tirages publiés ; les échecs restent comptabilisés.', statsTable),
        makeCard('Tendances par jour de la semaine', 'Comparez les performances des programmes par jour avec les pourcentages Clé, Ordre et Global.', dayStatsGrid, 'admin-v3-day-section')
      );
    }
    if (activeView !== 'import' && !state.resultatAide && !state.resultatAideLoading) {
      void loadResultatAide();
    }
    return page;
  }

  function buildFunctions() {
    const page = node('div', 'admin-v3-page');
    const functionsStatus = makeStatus();
    functionsStatus.dataset.adminV3FunctionsStatus = '';
    const refresh = button('Actualiser les fonctions', 'admin-v3-button admin-v3-button--secondary', () => loadPrograms(true));
    const functionsList = node('div', 'admin-v3-list');
    renderFunctionsList(functionsList);
    const createForm = node('form', 'admin-v3-form');
    createForm.append(node('div', 'admin-v3-form-grid',
      field('Clé du programme', 'program', {
        required: true,
        placeholder: 'ex. espoir'
      }),
      field('Nom affiché', 'displayName', {
        required: true,
        placeholder: 'Programme Espoir'
      }),
      field('Modèle de calcul', 'sourceTemplate', {
        type: 'select',
        options: [
          ['universelle', 'Universelle'],
          ['intuition', 'Intuition'],
          ['oracle', 'Oracle'],
          ['lnb', 'LNB'],
          ['balsa', 'Balsa Plus'],
          ['standby', 'Stand-by'],
          ['robot', 'Robot']
        ]
      }),
      field('Horaires du tirage', 'schedules', {
        placeholder: 'facultatif : 08:00, 16:00'
      })
    ));
    createForm.appendChild(node(
      'div',
      'admin-v3-policy-notice',
      node('strong', '', 'Création automatique'),
      node('span', '', 'La clé est validée, testée et créée en brouillon dans Supabase. La génération globale reste à 16:00 ; les horaires indiqués ici décrivent uniquement le programme.')
    ));
    const createStatus = makeStatus();
    const createSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Créer la clé');
    createSubmit.type = 'submit';
    createForm.appendChild(makeFormActions(createSubmit, createStatus));
    runForm(createForm, createSubmit, async (data) => {
      const schedules = formValue(createForm, 'schedules')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      await createProgram({
        program: data.get('program'),
        displayName: data.get('displayName'),
        sourceTemplate: data.get('sourceTemplate'),
        schedules,
        theme: {
          background: '#0F3B29',
          accent: '#FFD700',
          text: '#FFFFFF'
        },
        rule: { selection: 'plus_grand_numero' },
        tests: [],
        instructions: ''
      });
      createForm.reset();
      await loadPrograms();
    }, createStatus);
    const duplicateForm = node('form', 'admin-v3-form');
    const duplicateOptions = programCatalogOptions(state);
    duplicateForm.append(node('div', 'admin-v3-form-grid',
      field('Dupliquer à partir de', 'sourceProgram', {
        type: 'select',
        options: duplicateOptions
      }),
      field('Nouvelle clé', 'program', {
        required: true,
        placeholder: 'ex. espoir'
      }),
      field('Nouveau nom', 'displayName', {
        required: true,
        placeholder: 'Programme Espoir'
      }),
      field('Couleur de fond', 'background', { type: 'color', value: '#3B0000' }),
      field('Couleur principale', 'accent', { type: 'color', value: '#FFD400' }),
      field('Couleur du texte', 'text', { type: 'color', value: '#FFFFFF' })
    ));
    duplicateForm.appendChild(node(
      'div',
      'admin-v3-policy-notice',
      node('strong', '', 'Copie fidèle du modèle'),
      node('span', '', 'La clé, le nom et les couleurs changent ; la règle, le moule visuel, la croix, les satellites, les tableaux et la structure du modèle sélectionné sont conservés.')
    ));
    const previewPanel = node('div', 'admin-v3-program-preview');
    previewPanel.setAttribute('aria-live', 'polite');
    previewPanel.textContent = 'La prévisualisation apparaîtra ici.';
    const previewButton = node('button', 'admin-v3-button admin-v3-button--secondary', 'Prévisualiser');
    previewButton.type = 'button';
    previewButton.addEventListener('click', async () => {
      setBusy(previewButton, true, 'Prévisualiser', 'Prévisualisation…');
      try {
        const source = formValue(duplicateForm, 'sourceProgram');
        const preview = await previewAdminProgram(
          source,
          new Date().toISOString().slice(0, 10)
        );
        previewPanel.replaceChildren();
        const previewCard = node('div', 'admin-v3-preview-card');
        previewCard.style.background = formValue(duplicateForm, 'background') || '#3B0000';
        previewCard.style.color = formValue(duplicateForm, 'text') || '#FFFFFF';
        previewCard.style.borderColor = formValue(duplicateForm, 'accent') || '#FFD400';
        previewCard.append(
          node('strong', '', formValue(duplicateForm, 'displayName') || 'Nouveau programme'),
          node('span', '', `Modèle : ${source}`),
          node('b', '', preview?.key || '000000'),
          node('span', '', `Croix : ${preview?.cross?.top || '0'} · ${preview?.cross?.bottom || '0'} · ${preview?.cross?.left || '0'} · ${preview?.cross?.right || '0'}`),
          node('small', '', 'Structure du modèle conservée à la publication')
        );
        previewPanel.appendChild(previewCard);
      } catch (error) {
        previewPanel.textContent = error?.message || 'La prévisualisation est indisponible.';
        toast(error?.message || 'La prévisualisation est indisponible.', 'error');
      } finally {
        setBusy(previewButton, false, 'Prévisualiser');
      }
    });
    const duplicateStatus = makeStatus();
    const duplicateSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Dupliquer et enregistrer');
    duplicateSubmit.type = 'submit';
    duplicateForm.append(previewButton, previewPanel, makeFormActions(duplicateSubmit, duplicateStatus));
    runForm(duplicateForm, duplicateSubmit, async (data) => {
      await duplicateAdminProgram({
        sourceProgram: data.get('sourceProgram'),
        program: data.get('program'),
        displayName: data.get('displayName'),
        visualTemplate: data.get('sourceProgram'),
        theme: {
          background: data.get('background'),
          accent: data.get('accent'),
          text: data.get('text')
        }
      });
      duplicateForm.reset();
      previewPanel.textContent = 'Programme dupliqué en brouillon.';
      await loadPrograms();
    }, duplicateStatus);
    const dateForm = node('form', 'admin-v3-inline-form');
    dateForm.append(field('Date des numéros valides', 'date', { type: 'date', value: new Date().toISOString().slice(0, 10) }));
    const validSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Charger les numéros');
    validSubmit.type = 'submit';
    dateForm.appendChild(validSubmit);
    dateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void loadValidNumbers(dateForm, validSubmit);
    });
    const validStatus = makeStatus();
    validStatus.dataset.adminV3ValidStatus = '';
    const validList = node('div', 'admin-v3-list');
    renderValidList(validList);
    page.append(
      makeRouteHeader('functions'),
      node('div', 'admin-v3-route-toolbar', node('p', '', 'Catalogue administrateur et grilles générées côté serveur.'), refresh),
      makeCard('Créer une nouvelle clé', 'Ajoutez un programme futur sans modifier le code du site.', createForm, 'admin-v3-form-card'),
      makeCard('Dupliquer un modèle', 'Conservez le même format, les mêmes tableaux et la même structure visuelle, puis choisissez seulement une nouvelle clé et de nouvelles couleurs.', duplicateForm, 'admin-v3-form-card'),
      makeCard('Fonctions disponibles', 'Chaque fonction est lue depuis la configuration protégée Supabase.', functionsList),
      makeCard('Numéros valides', 'Chargez la grille générée pour une date précise.', node('div', 'admin-v3-form-stack', dateForm, validStatus, validList)),
      functionsStatus
    );
    if (!state.programs.programs.length && !state.programs.modules.length) void loadPrograms();
    if (!state.valid && !state.validLoading) {
      state.validLoading = true;
      void fetchValidNumbers()
        .then((data) => {
          state.valid = clone(data);
          renderRoute();
        })
        .catch((error) => {
          toast(error?.message || 'Les numéros privés du jour ne peuvent pas être chargés.', 'error');
        })
        .finally(() => {
          state.validLoading = false;
        });
    }
    return page;
  }

  function buildBalances() {
    const page = node('div', 'admin-v3-page');
    const searchForm = node('form', 'admin-v3-form');
    const searchStatus = makeStatus();
    const searchSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Rechercher');
    searchSubmit.type = 'submit';
    searchForm.append(
      node('div', 'admin-v3-form-grid',
        field('Adresse e-mail de l’utilisateur', 'email', {
          type: 'email',
          required: true,
          placeholder: 'utilisateur@exemple.com'
        })
      ),
      makeFormActions(searchSubmit, searchStatus)
    );

    const results = node('div', 'admin-v3-list');
    const grantPanel = node('div', 'admin-v3-form-stack');
    let selectedUser = null;

    function renderGrantPanel() {
      grantPanel.replaceChildren();
      if (!selectedUser) {
        grantPanel.appendChild(node(
          'p',
          'admin-v3-empty',
          'Recherchez une adresse e-mail puis sélectionnez un compte.'
        ));
        return;
      }

      const form = node('form', 'admin-v3-form');
      form.appendChild(node(
        'div',
        'admin-v3-policy-notice',
        node('strong', '', 'Compte sélectionné'),
        node('span', '', `${selectedUser.email}${selectedUser.name ? ` · ${selectedUser.name}` : ''}`)
      ));
      form.append(
        node('div', 'admin-v3-form-grid',
          field('Nombre de jetons à créditer', 'tokens', {
            type: 'number',
            min: 0,
            value: 0
          }),
          field('Nombre d’étoiles à créditer', 'stars', {
            type: 'number',
            min: 0,
            value: 0
          }),
          field('Note interne', 'note', {
            placeholder: 'Motif du crédit manuel'
          }),
          field('Référence de preuve', 'proofReference', {
            placeholder: 'Référence facultative'
          })
        )
      );
      const status = makeStatus();
      const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Créditer le solde');
      submit.type = 'submit';
      form.appendChild(makeFormActions(submit, status));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        const tokens = numberValue(form, 'tokens');
        const stars = numberValue(form, 'stars');
        if (tokens < 0 || stars < 0 || (tokens === 0 && stars === 0)) {
          setStatus(status, 'Indiquez au moins un jeton ou une étoile.', 'error');
          return;
        }
        setBusy(submit, true, 'Créditer le solde', 'Crédit en cours…');
        setStatus(status, 'Enregistrement sécurisé dans Supabase…');
        try {
          const result = await grantAdminBalance({
            userId: selectedUser.id,
            tokens,
            stars,
            note: formValue(form, 'note'),
            proofReference: formValue(form, 'proofReference')
          });
          const balance = result?.balance || {};
          setStatus(
            status,
            `Crédit enregistré. Nouveau solde : ${Number(balance.tokens || 0)} jeton(s), ${Number(balance.stars || 0)} étoile(s).`,
            'success'
          );
          toast('Solde utilisateur crédité.');
          form.elements.namedItem('tokens').value = '0';
          form.elements.namedItem('stars').value = '0';
          form.elements.namedItem('note').value = '';
          form.elements.namedItem('proofReference').value = '';
        } catch (error) {
          setStatus(status, error?.message || 'Le crédit n’a pas pu être enregistré.', 'error');
          toast(error?.message || 'Crédit impossible.', 'error');
        } finally {
          setBusy(submit, false, 'Créditer le solde');
        }
      });
      grantPanel.appendChild(form);

      const subscriptionForm = node('form', 'admin-v3-form');
      const planOptions = [
        ['', 'Choisir une offre']
      ].concat((state.access.plans || []).map((plan) => [
        plan.slug,
        `${plan.display_name || plan.slug} · ${Number(plan.duration_days) || 30} jour(s)`
      ]));
      subscriptionForm.append(
        node(
          'div',
          'admin-v3-policy-notice',
          node('strong', '', 'Abonnement manuel'),
          node('span', '', 'Cette action annule l’ancien abonnement actif et conserve son historique.')
        ),
        node(
          'div',
          'admin-v3-form-grid',
          field('Offre à attribuer', 'planSlug', {
            type: 'select',
            options: planOptions,
            required: true
          }),
          field('Durée personnalisée (jours)', 'durationDays', {
            type: 'number',
            min: 1,
            max: 3650,
            placeholder: 'Durée de l’offre par défaut'
          }),
          field('Note interne', 'subscriptionNote', {
            placeholder: 'Motif de l’attribution'
          })
        )
      );
      const subscriptionStatus = makeStatus();
      const subscriptionSubmit = node(
        'button',
        'admin-v3-button admin-v3-button--secondary',
        'Attribuer l’abonnement'
      );
      subscriptionSubmit.type = 'submit';
      subscriptionForm.appendChild(makeFormActions(subscriptionSubmit, subscriptionStatus));
      subscriptionForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (subscriptionSubmit.disabled) return;
        const planSlug = formValue(subscriptionForm, 'planSlug');
        if (!planSlug) {
          setStatus(subscriptionStatus, 'Choisissez une offre.', 'error');
          return;
        }
        setBusy(subscriptionSubmit, true, 'Attribuer l’abonnement', 'Attribution…');
        setStatus(subscriptionStatus, 'Enregistrement sécurisé dans Supabase…');
        try {
          const result = await grantAdminSubscription({
            userId: selectedUser.id,
            planSlug,
            durationDays: formValue(subscriptionForm, 'durationDays'),
            note: formValue(subscriptionForm, 'subscriptionNote')
          });
          setStatus(
            subscriptionStatus,
            `Abonnement ${result?.plan?.displayName || planSlug} attribué jusqu’au ${formatDate(result?.subscription?.expires_at)}.`,
            'success'
          );
          toast('Abonnement utilisateur attribué.');
          subscriptionForm.reset();
        } catch (error) {
          setStatus(subscriptionStatus, error?.message || 'L’abonnement n’a pas pu être attribué.', 'error');
          toast(error?.message || 'Attribution impossible.', 'error');
        } finally {
          setBusy(subscriptionSubmit, false, 'Attribuer l’abonnement');
        }
      });
      grantPanel.appendChild(
        makeCard(
          'Abonnement manuel',
          'Le même contrôleur admin-method-control applique l’attribution et l’audit.',
          subscriptionForm,
          'admin-v3-form-card'
        )
      );
    }

    function renderResults(users) {
      results.replaceChildren();
      if (!users.length) {
        results.appendChild(node(
          'p',
          'admin-v3-empty',
          'Aucun compte trouvé pour cette adresse e-mail.'
        ));
        return;
      }
      users.forEach((user) => {
        const choose = button(
          'Sélectionner',
          'admin-v3-button admin-v3-button--secondary',
          () => {
            selectedUser = user;
            renderResults([user]);
            renderGrantPanel();
            setStatus(searchStatus, `Compte sélectionné : ${user.email}.`, 'success');
          }
        );
        results.appendChild(node(
          'div',
          'admin-v3-list-row',
          node(
            'div',
            'admin-v3-row-copy',
            node('strong', '', user.email || 'E-mail indisponible'),
            node('span', '', user.name || user.id)
          ),
          choose
        ));
      });
    }

    searchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = formValue(searchForm, 'email');
      if (!email) return;
      setBusy(searchSubmit, true, 'Rechercher', 'Recherche…');
      setStatus(searchStatus, 'Recherche sécurisée par e-mail…');
      selectedUser = null;
      grantPanel.replaceChildren();
      try {
        const users = await searchAdminUsers(email);
        renderResults(users);
        setStatus(
          searchStatus,
          users.length ? `${users.length} compte(s) trouvé(s). Sélectionnez le bon compte.` : 'Aucun compte trouvé.',
          users.length ? 'success' : 'error'
        );
      } catch (error) {
        renderResults([]);
        setStatus(searchStatus, error?.message || 'Recherche impossible.', 'error');
      } finally {
        setBusy(searchSubmit, false, 'Rechercher');
      }
    });

    renderResults([]);
    renderGrantPanel();
    page.append(
      makeRouteHeader('balances'),
      makeCard(
        'Rechercher un utilisateur',
        'Saisissez l’adresse e-mail, puis sélectionnez le compte avant toute attribution.',
        searchForm,
        'admin-v3-form-card'
      ),
      makeCard(
        'Comptes trouvés',
        'Le crédit est toujours rattaché à l’utilisateur sélectionné, jamais à un e-mail saisi librement.',
        results
      ),
      makeCard(
        'Créditer manuellement',
        'Les jetons et les étoiles sont enregistrés avec une trace administrateur.',
        grantPanel,
        'admin-v3-form-card'
      )
    );
    return page;
  }

  function buildTableauAccess() {
    const page = node('div', 'admin-v3-page');
    const tableauOptions = featureCatalog(state)
      .filter(([key]) => key.startsWith('tableaux-'));
    const searchForm = node('form', 'admin-v3-form');
    const searchStatus = makeStatus();
    const searchSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Rechercher');
    searchSubmit.type = 'submit';
    searchForm.append(
      node('div', 'admin-v3-form-grid',
        field('Adresse e-mail de l’utilisateur', 'email', {
          type: 'email',
          required: true,
          placeholder: 'utilisateur@exemple.com'
        })
      ),
      makeFormActions(searchSubmit, searchStatus)
    );

    const users = node('div', 'admin-v3-list');
    const grantPanel = node('div', 'admin-v3-form-stack');
    const accessList = node('div', 'admin-v3-list');
    let selectedUser = null;

    function renderUsers(rows) {
      users.replaceChildren();
      if (!rows.length) {
        users.appendChild(node('p', 'admin-v3-empty', 'Aucun compte trouvé.'));
        return;
      }
      rows.forEach((user) => {
        users.appendChild(node(
          'div',
          'admin-v3-list-row',
          node(
            'div',
            'admin-v3-row-copy',
            node('strong', '', user.email || 'E-mail indisponible'),
            node('span', '', user.name || user.id)
          ),
          button('Sélectionner', 'admin-v3-button admin-v3-button--secondary', () => {
            selectedUser = user;
            renderGrantPanel();
            setStatus(searchStatus, `Compte sélectionné : ${user.email}.`, 'success');
          })
        ));
      });
    }

    function renderGrantPanel() {
      grantPanel.replaceChildren();
      if (!selectedUser) {
        grantPanel.appendChild(node(
          'p',
          'admin-v3-empty',
          'Recherchez un compte puis sélectionnez-le pour attribuer un Tableau.'
        ));
        return;
      }
      const form = node('form', 'admin-v3-form');
      const feature = field('Tableau', 'featureKey', {
        type: 'select',
        required: true,
        options: tableauOptions
      });
      form.append(
        node(
          'div',
          'admin-v3-policy-notice',
          node('strong', '', 'Compte sélectionné'),
          node('span', '', `${selectedUser.email || selectedUser.id}`)
        ),
        node('div', 'admin-v3-form-grid',
          feature,
          field('Durée (jours)', 'durationDays', {
            type: 'number',
            min: 1,
            max: 3650,
            value: 30
          }),
          field('Référence de transaction', 'transactionReference', {
            placeholder: 'MANUAL-2026-001'
          }),
          field('Note interne', 'note', {
            placeholder: 'Motif de l’attribution'
          })
        )
      );
      const status = makeStatus();
      const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Attribuer l’accès');
      submit.type = 'submit';
      form.appendChild(makeFormActions(submit, status));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        setBusy(submit, true, 'Attribuer l’accès', 'Attribution…');
        setStatus(status, 'Vérification administrateur et enregistrement…');
        try {
          await grantAdminTableauAccess({
            userId: selectedUser.id,
            featureKey: formValue(form, 'featureKey'),
            durationDays: numberValue(form, 'durationDays', 30),
            transactionReference: formValue(form, 'transactionReference'),
            note: formValue(form, 'note')
          });
          setStatus(status, 'Accès attribué et audité dans Supabase.', 'success');
          toast('Accès Tableau attribué.');
          await loadTableauAccess();
        } catch (error) {
          setStatus(status, error?.message || 'L’attribution a échoué.', 'error');
          toast(error?.message || 'Attribution impossible.', 'error');
        } finally {
          setBusy(submit, false, 'Attribuer l’accès');
        }
      });
      grantPanel.appendChild(form);
    }

    function renderAccessList() {
      accessList.replaceChildren();
      const rows = Array.isArray(state.tableauAccess) ? state.tableauAccess : [];
      if (!rows.length) {
        accessList.appendChild(node(
          'p',
          'admin-v3-empty',
          state.tableauAccessLoading
            ? 'Lecture des accès…'
            : 'Aucun déblocage individuel enregistré.'
        ));
        return;
      }
      rows.forEach((access) => {
        const row = node(
          'div',
          'admin-v3-list-row admin-tableau-access-row',
          node(
            'div',
            'admin-v3-row-copy',
            node('strong', '', `${access.email || access.user_id} · ${access.display_name || access.feature_key}`),
            node('span', '', `${access.is_active === false ? 'Expiré' : 'Actif'} · ${access.expires_at ? `Expire le ${formatDate(access.expires_at)}` : 'Sans expiration'} · Débloqué le ${formatDate(access.unlocked_at)}`),
            node('small', '', `${access.source || 'purchase'} · Référence : ${access.transaction_reference || '—'}${access.note ? ` · ${access.note}` : ''}`)
          )
        );
        const revoke = button('Révoquer', 'admin-v3-button admin-v3-button--danger', () => {
          inlineConfirmation(
            row,
            revoke,
            `Révoquer ${access.display_name || access.feature_key} pour ${access.email || access.user_id} ?`,
            'Confirmer',
            async () => {
              try {
                await revokeAdminTableauAccess({
                  userId: access.user_id,
                  featureKey: access.feature_key,
                  note: 'Révocation depuis le tableau administrateur'
                });
                toast('Accès Tableau révoqué.');
                await loadTableauAccess();
              } catch (error) {
                toast(error?.message || 'La révocation a échoué.', 'error');
                throw error;
              }
            }
          );
        });
        const expiry = access.expires_at
          ? `Expire le ${formatDate(access.expires_at)}`
          : 'Sans expiration';
        const status = access.is_active === false ? 'Expiré' : 'Actif';
        row.querySelector('.admin-v3-row-copy span').textContent = `${status} · ${expiry} · Débloqué le ${formatDate(access.unlocked_at)}`;
        row.appendChild(revoke);
        accessList.appendChild(row);
      });
    }

    searchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = formValue(searchForm, 'email');
      if (!email) return;
      setBusy(searchSubmit, true, 'Rechercher', 'Recherche…');
      setStatus(searchStatus, 'Recherche sécurisée par e-mail…');
      try {
        const results = await searchAdminUsers(email);
        renderUsers(results);
        setStatus(searchStatus, results.length ? 'Sélectionnez le compte à gérer.' : 'Aucun compte trouvé.', results.length ? 'success' : 'error');
      } catch (error) {
        renderUsers([]);
        setStatus(searchStatus, error?.message || 'Recherche impossible.', 'error');
      } finally {
        setBusy(searchSubmit, false, 'Rechercher');
      }
    });

    const refresh = button('Actualiser', 'admin-v3-button admin-v3-button--secondary', () => loadTableauAccess(true));
    renderUsers([]);
    renderGrantPanel();
    renderAccessList();
    page.append(
      makeRouteHeader('tableauAccess'),
      makeCard(
        'Rechercher un utilisateur',
        'La recherche et les écritures passent par les fonctions administrateur protégées.',
        searchForm,
        'admin-v3-form-card'
      ),
      makeCard(
        'Attribuer un accès individuel',
        'Chaque Tableau est enregistré séparément avec une durée, une référence et une trace administrateur.',
        grantPanel,
        'admin-v3-form-card'
      ),
      makeCard(
        'Accès enregistrés',
        'Les dates, références et sources proviennent de user_feature_unlocks.',
        node('div', 'admin-v3-form-stack', refresh, accessList)
      )
    );
    if (!state.tableauAccess.length && !state.tableauAccessLoading) {
      void loadTableauAccess();
    }
    return page;
  }

  function buildPayments() {
    const page = node('div', 'admin-v3-page');
    const paymentForm = node('form', 'admin-v3-form');
    const settings = state.access.settings || {};
    const socialLinksValue = Array.isArray(settings.social_links)
      ? settings.social_links
        .map((item) => `${String(item?.name || '').trim()} | ${String(item?.url || '').trim()}`)
        .filter((item) => !/^\s*\|\s*$/.test(item))
        .join('\n')
      : String(settings.social_links || '');
    paymentForm.append(node('div', 'admin-v3-form-grid',
      field('Mode de paiement', 'payment_mode', { type: 'select', options: [['manual', 'Manuel'], ['online', 'Paystack']] }),
      field('Monnaie affichée sur le site', 'currency_mode', {
        type: 'select',
        options: [
          ['stars', 'Étoiles uniquement'],
          ['tokens', 'Jetons uniquement'],
          ['both', 'Étoiles et jetons']
        ]
      }),
      field('Fournisseur', 'online_provider', { placeholder: 'fournisseur configuré' }),
      field('Lien Paystack', 'online_payment_link', { type: 'url', placeholder: 'https://...' }),
      field('Contact', 'contact_label', { placeholder: 'WhatsApp, e-mail…' }),
      field('Canal de contact', 'contact_channel', {
        type: 'select',
        options: [['chat', 'Assistant / chat'], ['whatsapp', 'WhatsApp']]
      }),
      field('Numéro de contact / WhatsApp', 'whatsapp_number', {
        placeholder: '+225…'
      }),
      field('Nom du bouton de contact', 'chat_label', {
        placeholder: 'Contacter l’équipe'
      })
    ),
    field('Instructions manuelles', 'physical_instructions', { multiline: true, rows: 4 }),
    field(
      'Réseaux sociaux publics',
      'social_links',
      {
        multiline: true,
        rows: 6,
        value: socialLinksValue,
        placeholder: 'Un réseau par ligne : Nom | https://lien-public'
      }
    ));
    ['payment_mode', 'currency_mode', 'online_provider', 'online_payment_link', 'contact_label', 'physical_instructions'].forEach((name) => {
      const input = paymentForm.elements.namedItem(name);
      if (input && settings[name] !== undefined) {
        input.value = settings[name] || (name === 'currency_mode' ? 'both' : '');
      }
    });
    ['contact_channel', 'whatsapp_number', 'chat_label'].forEach((name) => {
      const input = paymentForm.elements.namedItem(name);
      if (input && settings[name] !== undefined) input.value = settings[name] || '';
    });
    const paymentStatus = makeStatus();
    const paymentSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer le paiement');
    paymentSubmit.type = 'submit';
    paymentForm.appendChild(makeFormActions(paymentSubmit, paymentStatus));
    runForm(paymentForm, paymentSubmit, async (data) => {
      await saveAdminPayment({
        payment_mode: data.get('payment_mode'),
        currency_mode: data.get('currency_mode'),
        online_provider: data.get('online_provider'),
        online_payment_link: data.get('online_payment_link'),
        physical_instructions: data.get('physical_instructions'),
        contact_label: data.get('contact_label'),
        contact_channel: data.get('contact_channel'),
        whatsapp_number: data.get('whatsapp_number'),
        chat_label: data.get('chat_label'),
        social_links: data.get('social_links'),
        manual_enabled: true
      });
      await refreshData();
    }, paymentStatus);

    const packForm = node('form', 'admin-v3-form');
    packForm.append(node('div', 'admin-v3-form-grid',
      field('Identifiant', 'pack_id', { required: true, placeholder: 'tokens-1000' }),
      field('Nom du pack', 'name', { required: true, placeholder: 'Pack Essentiel' }),
      field('Quantité de jetons', 'quantity', { type: 'number', min: 1, required: true }),
      field('Prix en XOF', 'price_xof', { type: 'number', min: 1, required: true })
    ));
    const packStatus = makeStatus();
    const packSubmit = node('button', 'admin-v3-button admin-v3-button--primary', 'Ajouter le pack');
    packSubmit.type = 'submit';
    packForm.appendChild(makeFormActions(packSubmit, packStatus));
    runForm(packForm, packSubmit, async (data) => {
      await saveAdminTokenPrice({
        pack_id: data.get('pack_id'),
        name: data.get('name'),
        quantity: numberValue(packForm, 'quantity'),
        price_xof: numberValue(packForm, 'price_xof')
      });
      packForm.reset();
      await refreshData();
    }, packStatus);
    const packList = node('div', 'admin-v3-list');
    renderTokenList(packList);
    page.append(
      makeRouteHeader('payments'),
      makeCard(
        'Configuration du paiement et du solde',
        'Choisissez si le bandeau supérieur et la fenêtre Solde affichent les étoiles, les jetons ou les deux. Le choix est enregistré dans Supabase et s’applique à tout le site.',
        paymentForm,
        'admin-v3-form-card'
      ),
      makeCard('Ajouter un pack de jetons', 'Les packs seront proposés dans le parcours d’achat.', packForm, 'admin-v3-form-card'),
      makeCard('Packs configurés', 'Liste synchronisée avec Supabase.', packList)
    );
    return page;
  }

  function buildChatKnowledge() {
    const page = node('div', 'admin-v3-page');
    const form = node('form', 'admin-v3-form');
    let editingId = null;
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer la réponse');
    submit.type = 'submit';
    const cancel = button('Annuler la modification', 'admin-v3-button admin-v3-button--secondary');
    cancel.hidden = true;

    form.append(
      node('div', 'admin-v3-form-grid',
        field('Intention', 'intent', {
          required: true,
          placeholder: 'ex. achat individuel'
        }),
        field('Question type', 'question', {
          required: true,
          placeholder: 'ex. Puis-je acheter un seul tableau ?'
        }),
        field('Mots-clés', 'keywords', {
          placeholder: 'achat, individuel, tableau, déblocage'
        }),
        field('Priorité', 'priority', {
          type: 'number',
          min: 1,
          max: 10000,
          value: 100
        })
      ),
      field('Réponse officielle', 'answer', {
        multiline: true,
        rows: 7,
        required: true,
        placeholder: 'Réponse exacte à restituer à l’utilisateur.'
      }),
      field('Entrée active', 'enabled', {
        type: 'checkbox',
        checked: true
      }),
      makeFormActions(submit, status, cancel)
    );

    const resetForm = () => {
      form.reset();
      editingId = null;
      submit.textContent = 'Enregistrer la réponse';
      cancel.hidden = true;
      form.elements.namedItem('priority').value = '100';
      form.elements.namedItem('enabled').checked = true;
    };
    cancel.addEventListener('click', resetForm);
    runForm(form, submit, async (data) => {
      await saveAdminChatKnowledge({
        id: editingId,
        intent: data.get('intent'),
        question: data.get('question'),
        answer: data.get('answer'),
        keywords: data.get('keywords'),
        priority: numberValue(form, 'priority', 100),
        enabled: form.elements.namedItem('enabled')?.checked !== false
      });
      resetForm();
      await loadChatKnowledge();
    }, status);

    const tableWrap = node('div', 'admin-v3-table-wrap');
    const table = node('table', 'admin-v3-table');
    const head = node('thead');
    const headRow = node('tr');
    ['Intention', 'Question type', 'Priorité', 'État', 'Actions'].forEach((label) => {
      headRow.appendChild(node('th', '', label));
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = node('tbody');
    if (state.chatKnowledgeLoading) {
      body.appendChild(node('tr', '', node('td', 'admin-v3-table-empty', 'Chargement de la base de connaissances…')));
    } else if (!state.chatKnowledge.length) {
      body.appendChild(node('tr', '', node('td', 'admin-v3-table-empty', 'Aucune réponse officielle enregistrée.')));
    } else {
      state.chatKnowledge.forEach((entry) => {
        const row = node('tr');
        const edit = button('Modifier', 'admin-v3-button admin-v3-button--secondary', () => {
          editingId = entry.id;
          form.elements.namedItem('intent').value = entry.intent || '';
          form.elements.namedItem('question').value = entry.question || '';
          form.elements.namedItem('answer').value = entry.answer || '';
          form.elements.namedItem('keywords').value = entry.keywords || '';
          form.elements.namedItem('priority').value = Number(entry.priority) || 100;
          form.elements.namedItem('enabled').checked = entry.enabled !== false;
          submit.textContent = 'Mettre à jour la réponse';
          cancel.hidden = false;
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        const remove = button('Supprimer', 'admin-v3-button admin-v3-button--danger', async () => {
          if (!window.confirm(`Supprimer la réponse « ${entry.intent || entry.question} » ?`)) return;
          setBusy(remove, true, 'Supprimer', 'Suppression…');
          try {
            await deleteAdminChatKnowledge(entry.id);
            await loadChatKnowledge();
            toast('Réponse officielle supprimée.');
          } catch (error) {
            toast(error?.message || 'Suppression impossible.', 'error');
            setBusy(remove, false, 'Supprimer');
          }
        });
        row.append(
          node('td', '', node('strong', '', entry.intent || '—')),
          node('td', '', node('span', 'admin-v3-table-question', entry.question || '—')),
          node('td', '', String(Number(entry.priority) || 100)),
          node('td', '', node('span', `admin-v3-status-badge ${entry.enabled === false ? 'is-muted' : 'is-active'}`, entry.enabled === false ? 'Inactive' : 'Active')),
          node('td', 'admin-v3-table-actions', edit, remove)
        );
        body.appendChild(row);
      });
    }
    table.appendChild(body);
    tableWrap.appendChild(table);
    const refresh = button('Actualiser', 'admin-v3-button admin-v3-button--secondary', () => loadChatKnowledge(true));
    page.append(
      makeRouteHeader('chat'),
      makeCard(
        'Base de connaissances prioritaire',
        'Ces réponses sont recherchées avant le modèle et sont restituées telles qu’elles ont été rédigées par l’administration.',
        node('div', 'admin-v3-form-stack',
          node('div', 'admin-v3-policy-notice',
            node('strong', '', 'Règle d’autorité'),
            node('span', '', 'Une intention correctement reconnue prime sur toute réponse générée. Utilisez les mots-clés pour sécuriser les sujets sensibles.')
          ),
          form
        ),
        'admin-v3-form-card'
      ),
      makeCard(
        'Réponses enregistrées',
        'Les en-têtes restent visibles pendant le défilement pour faciliter la maintenance.',
        node('div', 'admin-v3-form-stack', refresh, tableWrap)
      )
    );
    if (!state.chatKnowledge.length && !state.chatKnowledgeLoading) void loadChatKnowledge();
    return page;
  }

  function buildReferral() {
    const page = node('div', 'admin-v3-page');
    const settings = state.referralSettings || {
      enabled: true,
      share_reward_stars: 0,
      share_reward_tokens: 0,
      signup_reward_stars: 0,
      signup_reward_tokens: 0,
      unlock_reward_stars: 0,
      unlock_reward_tokens: 0,
      max_share_rewards_per_day: 10
    };
    const form = node('form', 'admin-v3-form');
    form.append(
      node(
        'div',
        'admin-v3-policy-notice',
        node('strong', '', 'Chaîne complète'),
        node(
          'span',
          '',
          'Partage → inscription du filleul → premier accès qualifiant. Chaque personne invitée récompense son parrain une seule fois, quel que soit le nombre de sections achetées. Le parrain peut continuer à partager le site pour inviter de nouvelles personnes.'
        )
      ),
      node('p', 'admin-v3-section-label', 'Montants automatiques'),
      node(
        'div',
        'admin-v3-form-grid',
        field('Partage · étoiles', 'shareRewardStars', {
          type: 'number',
          min: 0,
          value: Number(settings.share_reward_stars) || 0
        }),
        field('Partage · jetons', 'shareRewardTokens', {
          type: 'number',
          min: 0,
          value: Number(settings.share_reward_tokens) || 0
        }),
        field('Inscription · étoiles', 'signupRewardStars', {
          type: 'number',
          min: 0,
          value: Number(settings.signup_reward_stars) || 0
        }),
        field('Inscription · jetons', 'signupRewardTokens', {
          type: 'number',
          min: 0,
          value: Number(settings.signup_reward_tokens) || 0
        }),
        field('Déblocage · étoiles', 'unlockRewardStars', {
          type: 'number',
          min: 0,
          value: Number(settings.unlock_reward_stars) || 0
        }),
        field('Déblocage · jetons', 'unlockRewardTokens', {
          type: 'number',
          min: 0,
          value: Number(settings.unlock_reward_tokens) || 0
        }),
        field('Limite de récompenses de partage par jour', 'maxShareRewardsPerDay', {
          type: 'number',
          min: 0,
          max: 1000,
          value: Number(settings.max_share_rewards_per_day) || 10
        }),
        field('Activer les récompenses', 'enabled', {
          type: 'checkbox',
          checked: settings.enabled !== false
        })
      )
    );
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer les récompenses');
    submit.type = 'submit';
    form.appendChild(makeFormActions(submit, status));
    runForm(form, submit, async () => {
      state.referralSettings = await saveAdminReferralSettings({
        enabled: form.elements.namedItem('enabled')?.checked !== false,
        share_reward_stars: numberValue(form, 'shareRewardStars'),
        share_reward_tokens: numberValue(form, 'shareRewardTokens'),
        signup_reward_stars: numberValue(form, 'signupRewardStars'),
        signup_reward_tokens: numberValue(form, 'signupRewardTokens'),
        unlock_reward_stars: numberValue(form, 'unlockRewardStars'),
        unlock_reward_tokens: numberValue(form, 'unlockRewardTokens'),
        max_share_rewards_per_day: numberValue(form, 'maxShareRewardsPerDay', 10)
      });
      renderRoute();
    }, status);
    page.append(
      makeRouteHeader('referral'),
      makeCard(
        'Récompenses de parrainage',
        'Configurez séparément le partage, l’inscription et le premier déblocage. Les valeurs sont conservées lors de chaque sauvegarde et servent de secours lorsqu’aucune règle plus précise ne s’applique.',
        form,
        'admin-v3-form-card'
      ),
      makeCard(
        'Récompense du forfait collectif',
        'La récompense liée à un forfait collectif se configure directement dans chaque offre, dans « Accès & tarifs ». Une seule récompense est versée par personne invitée ; les achats suivants de cette même personne ne recréditent jamais le parrain.',
        node(
          'div',
          'admin-v3-policy-notice',
          node('span', '', 'Une conversion validée utilise uniquement la configuration de l’offre achetée.')
        )
      )
    );
    return page;
  }

  function buildEarly() {
    const page = node('div', 'admin-v3-page');
    const form = node('form', 'admin-v3-form');
    const options = featureCatalog(state);
    form.append(node('div', 'admin-v3-form-grid',
      field('Programme ou fonctionnalité', 'featureKey', {
        type: 'select',
        required: true,
        options
      }),
      field('Nom affiché', 'displayName', { placeholder: 'Nom public (facultatif)' }),
      field('Jetons — 1 jour', 'tokenCost1Day', { type: 'number', min: 1, value: 1 }),
      field('Jetons — 2 jours', 'tokenCost2Days', { type: 'number', min: 2, value: 2 }),
      field('Jetons — 3 jours', 'tokenCost3Days', { type: 'number', min: 3, value: 3 }),
      field('Dates futures autorisées', 'previewDays', { type: 'number', min: 1, max: 30, value: 1 }),
      field('Validité d’un déblocage (jours)', 'durationDays', { type: 'number', min: 1, max: 3650, value: 30 }),
      field('Étoiles au parrain (vide = global)', 'referralRewardStars', { type: 'number', min: 0, value: '' }),
      field('Jetons au parrain (vide = global)', 'referralRewardTokens', { type: 'number', min: 0, value: '' })
    ));
    const featureSelect = form.elements.namedItem('featureKey');
    const displayNameInput = form.elements.namedItem('displayName');
    featureSelect?.addEventListener('change', () => {
      const selected = options.find(([value]) => value === featureSelect.value);
      if (selected && displayNameInput && !displayNameInput.value.trim()) {
        displayNameInput.value = selected[1];
      }
    });
    featureSelect?.dispatchEvent(new Event('change'));
    form.appendChild(node(
      'div',
      'admin-v3-policy-notice',
      node('strong', '', 'Anticipation globale'),
      node('span', '', 'Toutes les publications anticipées suivent la même frontière de 16:00 en Côte d’Ivoire. Cette heure ne se règle pas par fonctionnalité.')
    ));
    /*
     * Do not preload the first database row here: that used to make an
     * administrator editing a new key accidentally overwrite whichever rule
     * happened to be returned first. Existing rules remain visible below and
     * can be re-saved by entering their key explicitly.
     */
    const enabled = node('label', 'admin-v3-switch');
    const enabledInput = node('input');
    enabledInput.type = 'checkbox';
    enabledInput.name = 'enabled';
    enabledInput.checked = false;
    enabled.append(enabledInput, node('span', '', 'Activer l’accès anticipé'));
    form.appendChild(enabled);
    const status = makeStatus();
    const submit = node('button', 'admin-v3-button admin-v3-button--primary', 'Enregistrer la publication');
    submit.type = 'submit';
    form.appendChild(makeFormActions(submit, status));

    const fillEarlyForm = (rule) => {
      form.elements.namedItem('featureKey').value = rule.feature_key || '';
      form.elements.namedItem('displayName').value = rule.display_name || '';
      form.elements.namedItem('tokenCost1Day').value = Math.max(1, Number(rule.token_cost_1_day ?? rule.required_tokens) || 1);
      form.elements.namedItem('tokenCost2Days').value = Math.max(2, Number(rule.token_cost_2_days) || 2);
      form.elements.namedItem('tokenCost3Days').value = Math.max(3, Number(rule.token_cost_3_days) || 3);
      form.elements.namedItem('previewDays').value = Number(rule.preview_days) || 1;
      form.elements.namedItem('durationDays').value = Number(rule.duration_days) || 30;
      form.elements.namedItem('referralRewardStars').value = rule.referral_reward_stars == null ? '' : Number(rule.referral_reward_stars) || 0;
      form.elements.namedItem('referralRewardTokens').value = rule.referral_reward_tokens == null ? '' : Number(rule.referral_reward_tokens) || 0;
      form.elements.namedItem('enabled').checked = rule.enabled === true;
      submit.textContent = 'Modifier la publication';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    runForm(form, submit, async (data) => {
      await requestAdmin({
        action: 'save-early-access-rule',
        featureKey: data.get('featureKey'),
        displayName: formValue(form, 'displayName') || data.get('featureKey'),
        enabled: data.get('enabled') === 'on',
        requiredTokens: numberValue(form, 'tokenCost1Day', 1),
        tokenCost1Day: numberValue(form, 'tokenCost1Day', 1),
        tokenCost2Days: numberValue(form, 'tokenCost2Days', 2),
        tokenCost3Days: numberValue(form, 'tokenCost3Days', 3),
        previewDays: numberValue(form, 'previewDays', 1),
        durationDays: numberValue(form, 'durationDays', 30),
        referralRewardStars: optionalNumberValue(form, 'referralRewardStars'),
        referralRewardTokens: optionalNumberValue(form, 'referralRewardTokens')
      });
      await refreshData();
    }, status);
    const list = node('div', 'admin-v3-list');
    renderEarlyList(list, {
      onEdit: fillEarlyForm,
      onDelete: async (rule) => {
        await deleteAdminEarlyAccessRule(rule.feature_key);
        await refreshData();
        toast('Règle d’anticipation supprimée.');
      }
    });
    page.append(makeRouteHeader('early'), makeCard('Planifier une publication', 'Ouvrez une fonctionnalité plus tôt en échange d’un nombre défini de jetons. La récompense du parrain se règle pour cette publication.', form, 'admin-v3-form-card'), makeCard('Publications anticipées', 'État des règles actuellement enregistrées.', list));
    if (!state.programsLoading && !state.programs.programs.length && !state.programs.modules.length) {
      void loadPrograms();
    }
    return page;
  }

  function renderRoute() {
    content.replaceChildren();
    content.appendChild(state.route === 'home'
      ? buildHome()
      : ({
        overview: buildOverview,
        sources: buildSources,
        rules: buildRules,
        functions: buildFunctions,
        payments: buildPayments,
        balances: buildBalances,
        tableauAccess: buildTableauAccess,
        early: buildEarly,
        history: buildHistory,
        promotions: buildPromotions,
        resultats: buildResultats,
        chat: buildChatKnowledge,
        referral: buildReferral
      }[state.route] || buildHome)());
  }

  const header = node('header', 'admin-v3-header',
    node('div', 'admin-v3-brand', node('span', 'admin-v3-brand-mark', 'A'), node('span', '', 'Administration')),
    button('Retour au compte', 'admin-v3-account-button', () => {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
      actions.closeAdmin?.();
    })
  );
  root.append(header, content, toastRegion);
  window.addEventListener('popstate', onPopState);
  renderRoute();
  void refreshData().catch((error) => toast(error?.message || 'Les données administrateur ne peuvent pas être chargées.', 'error'));
  if (state.route === 'referral') void loadReferralSettings();
  return root;
}
