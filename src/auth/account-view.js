/*
 * Native account view.
 *
 * This file intentionally uses only browser APIs. It replaces the former
 * former component account surface while keeping the same service boundaries and
 * DOM hooks used by the application shell.
 */
import {
  loginWithGoogle,
  loginUser,
  registerUser,
  logoutUser,
  fetchUserProfile,
  updateUserProfile
} from './account-service.js';
import { checkAdminAccess } from './admin-service.js';
import { renderAdminDashboard as renderAdminDashboardView } from './admin-dashboard-view.js?chat-admin-v2-result-import';

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  children.forEach((child) => {
    if (child === undefined || child === null) return;
    if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  });
  return node;
};

const button = (label, className, handler, type = 'button') => {
  const node = el('button', className, label);
  node.type = type;
  if (handler) node.addEventListener('click', (event) => {
    event.preventDefault();
    handler(event);
  });
  return node;
};

const t = (key, fallback = key) => (
  window.cidTranslation?.t?.(key, fallback) || fallback
);

function errorMessage(error) {
  const messages = {
    'auth/invalid-email': 'L’adresse e-mail n’est pas valide.',
    'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte trouvé avec cet e-mail.',
    'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
    'auth/email-already-in-use': 'Cet e-mail est déjà utilisé.',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
    'auth/network-request-failed': 'Vérifiez votre connexion internet.'
  };
  return messages[error?.code] || error?.message || 'Une erreur est survenue. Réessayez.';
}

function isGreetingOnly(value) {
  const normalized = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return /^(salut|bonjour|bonsoir|hello|hi|hey|hola|oi|ola|مرحبا|اهلا|أهلا)$/.test(normalized);
}

function formatAssistantMessage(value) {
  const container = el('div', 'support-chat-message-body');
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  let list = null;
  const flushList = () => {
    if (!list) return;
    container.appendChild(list);
    list = null;
  };
  const inline = (text) => {
    const fragment = document.createDocumentFragment();
    const parts = String(text || '').split(/(\*\*.+?\*\*)/g);
    parts.forEach((part) => {
      if (/^\*\*.+\*\*$/.test(part)) {
        fragment.appendChild(el('strong', null, part.slice(2, -2)));
      } else if (part) {
        fragment.appendChild(document.createTextNode(part));
      }
    });
    return fragment;
  };
  lines.forEach((line) => {
    const text = line.trim();
    if (!text) {
      flushList();
      return;
    }
    const heading = text.match(/^#{1,3}\s+(.+)$/);
    const bullet = text.match(/^(?:[•*-])\s+(.+)$/);
    if (heading) {
      flushList();
      const node = el('h3');
      node.appendChild(inline(heading[1]));
      container.appendChild(node);
      return;
    }
    if (bullet) {
      if (!list) list = el('ul');
      const item = el('li');
      item.appendChild(inline(bullet[1]));
      list.appendChild(item);
      return;
    }
    flushList();
    const node = text.endsWith(':') && text.length <= 84 ? el('h3') : el('p');
    node.appendChild(inline(text));
    container.appendChild(node);
  });
  flushList();
  return container;
}

function dateLabel(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat(
    window.cidTranslation?.current?.() || 'fr',
    { dateStyle: 'medium' }
  ).format(date);
}

function dateTimeLabel(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat(
    window.cidTranslation?.current?.() || 'fr',
    { dateStyle: 'medium', timeStyle: 'short' }
  ).format(date);
}

const ACCOUNT_COUNTRIES = [
  ['BJ', 'Bénin'],
  ['CI', 'Côte d’Ivoire'],
  ['GH', 'Ghana'],
  ['NE', 'Niger'],
  ['SN', 'Sénégal'],
  ['TG', 'Togo'],
  ['DEFAULT', 'Autre pays']
];

function countryLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ACCOUNT_COUNTRIES.find(([code]) => code === normalized)?.[1]
    || String(value || '').trim()
    || 'Pays non défini';
}

function setDisabled(node, disabled) {
  if (node) {
    node.disabled = Boolean(disabled);
    node.setAttribute('aria-busy', String(Boolean(disabled)));
  }
}

async function invokePersistentVirtualChat({
  state,
  messages = [],
  mode = 'answer',
  answer = '',
  source = 'account-virtual-assistant'
}) {
  const bridge = await window.cidSupabaseReady;
  const userResult = bridge?.auth?.getUser
    ? await bridge.auth.getUser()
    : null;
  const sessionResult = bridge?.auth?.getSession
    ? await bridge.auth.getSession()
    : null;
  const authSession = sessionResult?.data?.session || null;
  const authUser = userResult?.data?.user || null;
  const cid = authUser?.id || state.user?.id || state.session?.user?.id || '';
  if (!cid) throw new Error('Connexion requise pour utiliser le chat virtuel.');
  const latestQuestion = [...messages].reverse()
    .find((message) => message?.role === 'user')?.content
    || [...messages].reverse()
      .find((message) => message?.role === 'user')?.body
    || '';
  const featureAccessState = window.cidFeatureAccess?.state?.() || {};
  const localeCode = String(
    state.helpAccess?.localeCode
      || window.cidSiteConfig?.localization?.()?.selectedLocale
      || window.cidTranslation?.current?.()
      || 'fr'
  ).trim() || 'fr';
  const context = {
    dataSource: 'supabase',
    today: new Date().toISOString().slice(0, 10),
    localeCode,
    userId: cid,
    userRole: state.helpAccess?.isAdmin
      ? 'admin'
      : state.helpAccess?.canHelp
        ? 'subscriber'
        : 'non-subscriber',
    subscriptionTier: state.helpAccess?.subscription?.planName || '',
    subscriptionStatus: state.helpAccess?.subscription?.status
      || (state.helpAccess?.subscription ? 'active' : 'none'),
    userCountry: state.helpContext?.userCountry || state.helpAccess?.user?.country || '',
    allowedPrograms: state.helpAccess?.scope?.authorizedPrograms
      || state.helpContext?.authorizedPrograms
      || [],
    assistantAccess: state.helpAccess
      ? {
        canHelp: state.helpAccess.canHelp === true,
        isAdmin: state.helpAccess.isAdmin === true,
        scope: state.helpAccess.scope
      }
      : null,
    subscription: state.helpAccess?.subscription
      ? {
        name: state.helpAccess.subscription.planName || '',
        expiresAt: state.helpAccess.subscription.expiresAt || null
      }
      : null,
    plans: (
      featureAccessState.plans
      || window.cidSiteConfig?.plans?.()
      || []
    ).slice(0, 30),
    earlyAccess: {
      rules: Array.isArray(featureAccessState.earlyAccessRules)
        ? featureAccessState.earlyAccessRules.slice(0, 30)
        : [],
      unlocks: Array.isArray(featureAccessState.earlyAccessUnlocks)
        ? featureAccessState.earlyAccessUnlocks.slice(0, 60)
        : [],
      grants: Array.isArray(featureAccessState.earlyAccessGrants)
        ? featureAccessState.earlyAccessGrants.slice(0, 60)
        : []
    },
    publishedResults: (state.helpContext?.publishedResults
      || state.helpContext?.publishedForCountry
      || []).slice(0, 80),
    publicStatistics: {
      suggestions: (state.helpContext?.allProgramStatistics || []).slice(0, 80),
      daySuggestions: (state.helpContext?.dayProgramStatistics || []).slice(0, 80)
    },
    currentPrograms: (state.helpContext?.currentPrograms || []).slice(0, 12),
    // The account chat used to send only the question and a small access
    // summary. Keep the server as the decision-maker, but pass the
    // authorized assistant snapshot so it can answer from the same Supabase
    // data that populated this screen (especially Déchiffrement Plus / MT).
    assistantContext: {
      userCountry: state.helpContext?.userCountry || '',
      authorizedPrograms: (state.helpContext?.authorizedPrograms || []).slice(0, 20),
      accessScope: state.helpContext?.accessScope || '',
      publishedForCountry: (state.helpContext?.publishedForCountry || []).slice(0, 30),
      publishedCountForCountry: Number(state.helpContext?.publishedCountForCountry || 0),
      allProgramStatistics: (state.helpContext?.allProgramStatistics || []).slice(0, 80),
      dayProgramStatistics: (state.helpContext?.dayProgramStatistics || []).slice(0, 80),
      records: (state.helpContext?.records || []).slice(0, 120),
      dayPatterns: (state.helpContext?.dayPatterns || []).slice(0, 120),
      timePatterns: (state.helpContext?.timePatterns || []).slice(0, 120),
      delayPatterns: (state.helpContext?.delayPatterns || []).slice(0, 160),
      permutationObservations: (state.helpContext?.permutationObservations || []).slice(0, 120),
      delayProgramStatistics: (state.helpContext?.delayProgramStatistics || []).slice(0, 160),
      currentPrograms: (state.helpContext?.currentPrograms || []).slice(0, 12),
      currentWeek: state.helpContext?.currentWeek || '',
      weeklyActivity: (state.helpContext?.weeklyActivity || []).slice(0, 120),
      crossProgramPatterns: (state.helpContext?.crossProgramPatterns || []).slice(0, 80),
      recommendationProjection: state.helpContext?.recommendationProjection || null,
      drawNumberMemory: state.helpContext?.drawNumberMemory || null,
      personalPeriodStatistics: state.helpContext?.personalPeriodStatistics || null,
      dechiffrementPlus: state.helpContext?.dechiffrementPlus || { available: false }
    },
    dechiffrementPlus: state.helpContext?.dechiffrementPlus || { available: false }
  };
  const response = await fetch('/api/virtual-chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authSession?.access_token
        ? { Authorization: `Bearer ${authSession.access_token}` }
        : {})
    },
    body: JSON.stringify({
      cid,
      name: state.user?.name || authUser?.user_metadata?.name || '',
      sessionId: state.helpSessionId || null,
      localeCode,
      message: latestQuestion,
      context,
      mode,
      answer,
      source
    })
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || 'Cidmap virtuel est momentanément indisponible.');
  }
  state.helpSessionId = payload.sessionId || state.helpSessionId;
  return { content: payload.answer || 'Je n’ai pas pu formuler une réponse. Réessayez.' };
}

async function readPersistentVirtualChat({ state }) {
  const bridge = await window.cidSupabaseReady;
  const userResult = bridge?.auth?.getUser
    ? await bridge.auth.getUser()
    : null;
  const sessionResult = bridge?.auth?.getSession
    ? await bridge.auth.getSession()
    : null;
  const authSession = sessionResult?.data?.session || null;
  const authUser = userResult?.data?.user || null;
  const cid = authUser?.id || state.user?.id || state.session?.user?.id || '';
  if (!cid) throw new Error('Connexion requise pour utiliser le chat virtuel.');
  const url = new URL('/api/virtual-chat', window.location.origin);
  url.searchParams.set('cid', cid);
  const response = await fetch(url.toString(), {
    headers: {
      'content-type': 'application/json',
      ...(authSession?.access_token
        ? { Authorization: `Bearer ${authSession.access_token}` }
        : {})
    }
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || 'Mémoire du chat indisponible.');
  }
  return payload;
}

function makeHeading(kicker, title, description) {
  const heading = el('div', 'account-card-heading');
  heading.appendChild(el('span', 'account-kicker', kicker));
  heading.appendChild(el('h1', null, title));
  if (description) heading.appendChild(el('p', null, description));
  return heading;
}

function makeField(labelText, id, type = 'text', value = '', options = {}) {
  const label = el('label', null, labelText);
  label.htmlFor = id;
  const input = el(options.multiline ? 'textarea' : 'input');
  input.id = id;
  input.name = id;
  // HTMLTextAreaElement.type is read-only in WebKit/Safari. Only assign the
  // input type when the node is actually an <input>.
  if (!options.multiline) input.type = type;
  input.value = value ?? '';
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.required) input.required = true;
  if (options.readOnly) {
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
  }
  if (options.minLength) input.minLength = options.minLength;
  if (options.min !== undefined) input.min = options.min;
  if (options.rows) input.rows = options.rows;
  label.appendChild(input);
  return { label, input };
}

function makeStatus(message, className = 'account-form-error') {
  if (!message) return null;
  const status = el('p', className, message);
  status.setAttribute('role', 'alert');
  return status;
}

function renderHelpPanel(state, actions) {
  const panel = el('article', 'account-card account-panel-card support-chat-card');
  panel.appendChild(makeHeading(
    t('assistant.name', 'Cidmap virtuel'),
    `Bonjour ${state.user?.name || 'Membre Cidmap'}`,
    'Votre assistant virtuel pour comprendre les tableaux et les pourcentages.'
  ));
  if (state.helpLoading) {
    panel.appendChild(el('p', 'account-muted', 'Vérification de votre forfait…'));
    return panel;
  }
  if (state.helpError) {
    panel.append(el('p', 'account-form-error', state.helpError),
      button('Réessayer', 'account-button account-button--primary', actions.loadHelp));
    return panel;
  }
  const accessContext = el('div', 'support-chat-context');
  if (!state.helpAccess?.canHelp) {
    accessContext.append(
      el('strong', null, 'Mode information publique'),
      el('p', null, 'Cidmap virtuel peut expliquer les tendances publiques enregistrées pour les pays et les programmes. Les tableaux verrouillés, clés, numéros et combinaisons restent protégés.'),
      button('Voir les offres', 'account-button account-button--quiet', actions.openOffers)
    );
  } else if (state.helpAccess.isAdmin) {
    accessContext.append(
      el('strong', null, 'Espace de travail actif'),
      el('p', null, 'Les données autorisées sont synchronisées pour vous accompagner dans vos vérifications.')
    );
  }
  if (state.helpAccess.subscription) {
    accessContext.append(
      el('strong', null, `Votre forfait : ${state.helpAccess.subscription.planName || 'Forfait actif'}`),
      el('p', null, `Valide jusqu’au ${state.helpAccess.subscription.expiresAt ? dateLabel(state.helpAccess.subscription.expiresAt) : 'sans date de fin'}.`)
    );
  }
  if (Array.isArray(state.helpAccess.individualUnlocks) && state.helpAccess.individualUnlocks.length) {
    accessContext.append(
      el('strong', null, 'Vos tableaux individuels'),
      el('p', null, state.helpAccess.individualUnlocks.map((item) => (
        `${String(item.featureKey || '').replace(/^tableaux-/, '')} jusqu’au ${item.expiresAt ? dateLabel(item.expiresAt) : 'sans date de fin'}`
      )).join(' · '))
    );
  }
  if (state.helpContext?.userCountry) {
    accessContext.append(
      el('strong', null, `Pays détecté : ${state.helpContext.userCountry}`),
      el('p', null, state.helpContext.publishedCountForCountry
        ? `${state.helpContext.publishedCountForCountry} résultat(s) publié(s) sont disponibles pour ce pays.`
        : 'Aucun résultat publié n’est encore mémorisé pour ce pays.')
    );
  }
  if (state.helpAccess.loyalty) {
    accessContext.append(
      el('strong', null, 'Fidélité du compte'),
      el('p', null, `${state.helpAccess.loyalty.loyaltyMonths || 0} mois d’ancienneté · ${state.helpAccess.loyalty.subscriptionCount || 0} abonnement(s) enregistré(s).`)
    );
  }
  if (state.helpContext?.dechiffrementPlus?.available) {
    const memory = state.helpContext.dechiffrementPlus;
    accessContext.append(
      el('strong', null, 'Déchiffrement Plus / MT reconnu'),
      el('p', null, memory.storageReady === false
        ? 'Votre accès est reconnu. La mémoire MT sera disponible dès que son stockage sera activé.'
        : `${Number(memory.historyCount || 0)} analyse(s) MT mémorisée(s) · ${Number(memory.matrixCount || 0)} matrice(s) connue(s).`)
    );
  }
  panel.appendChild(accessContext);
  panel.appendChild(button(
    'Voir les résultats publiés',
    'account-button account-button--primary',
    actions.openResults
  ));
  const thread = el('div', 'support-chat-thread');
  const messages = state.helpMessages || [];
  if (!messages.length) thread.appendChild(el(
    'p',
    'support-chat-empty',
    t('assistant.greeting', 'Bonjour, je suis Cidmap virtuel. Comment puis-je vous aider à comprendre vos analyses ?')
  ));
  messages.forEach((message) => {
    thread.appendChild(el('div', `support-chat-message ${message.role === 'admin' ? 'is-admin' : 'is-user'}`,
      el('span', 'support-chat-message-author', message.role === 'assistant' || message.role === 'admin'
        ? t('assistant.name', 'Cidmap virtuel')
        : (state.user?.name || 'Vous')),
      formatAssistantMessage(message.body),
      el('time', null, dateLabel(message.createdAt))
    ));
  });
  panel.appendChild(thread);
  const form = el('form', 'support-chat-compose');
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.placeholder = t('assistant.messagePlaceholder', 'Posez votre question à Cidmap virtuel…');
  textarea.value = state.helpDraft || t('assistant.helpDefault', 'Bonjour, j’ai besoin d’aide.');
  textarea.addEventListener('input', () => { state.helpDraft = textarea.value; });
  const submit = button(state.helpSending ? 'Envoi…' : 'Envoyer', 'account-button account-button--primary', null, 'submit');
  submit.disabled = state.helpSending;
  form.append(textarea, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.sendHelp(textarea.value);
  });
  panel.appendChild(form);
  return panel;
}

function renderAuthForm(state, actions) {
  const card = el('section', 'account-card account-auth-card');
  card.setAttribute('aria-labelledby', 'accountAuthTitle');
  const signup = state.authMode === 'signup';
  const heading = makeHeading(
    'Espace personnel',
    signup ? 'Créer votre compte' : 'Ravi de vous revoir',
    signup
      ? 'Votre profil est enregistré dans votre compte sécurisé.'
      : 'Connectez-vous pour retrouver vos données.'
  );
  heading.querySelector('h1').id = 'accountAuthTitle';
  card.appendChild(heading);

  const google = button('Continuer avec Google', 'account-google-button', actions.google);
  const googleIcon = document.createElement('img');
  googleIcon.src = 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg';
  googleIcon.alt = '';
  google.prepend(googleIcon);
  setDisabled(google, state.loading);
  card.appendChild(google);

  const divider = el('div', 'account-divider');
  divider.setAttribute('aria-hidden', 'true');
  divider.appendChild(el('span', null, 'ou avec votre e-mail'));
  card.appendChild(divider);

  const switcher = el('div', 'account-mode-switch');
  switcher.setAttribute('role', 'tablist');
  switcher.setAttribute('aria-label', 'Authentification');
  const loginTab = button('Se connecter', !signup ? 'is-active' : '', () => actions.mode('login'));
  const signupTab = button('Créer un compte', signup ? 'is-active' : '', () => actions.mode('signup'));
  loginTab.setAttribute('role', 'tab');
  signupTab.setAttribute('role', 'tab');
  loginTab.setAttribute('aria-selected', String(!signup));
  signupTab.setAttribute('aria-selected', String(signup));
  switcher.append(loginTab, signupTab);
  card.appendChild(switcher);

  const form = el('form', 'account-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.submit({
      name: form.elements.accountName?.value || '',
      email: form.elements.accountEmail.value,
      password: form.elements.accountPassword.value,
      confirmation: form.elements.accountConfirmation?.value || ''
    });
  });
  if (signup) {
    const name = makeField('Nom complet', 'accountName', 'text', '', {
      autocomplete: 'name',
      required: true
    });
    form.append(name.label);
  }
  const email = makeField('Adresse e-mail', 'accountEmail', 'email', '', {
    autocomplete: 'email',
    required: true
  });
  form.append(email.label);
  const password = makeField('Mot de passe', 'accountPassword', 'password', '', {
    autocomplete: signup ? 'new-password' : 'current-password',
    minLength: 6,
    required: true
  });
  form.append(password.label);
  if (signup) {
    const confirmation = makeField('Confirmer le mot de passe', 'accountConfirmation', 'password', '', {
      autocomplete: 'new-password',
      minLength: 6,
      required: true
    });
    form.append(confirmation.label);
  }
  const status = makeStatus(state.error);
  if (status) form.appendChild(status);
  const submit = button(
    state.loading ? 'Connexion…' : signup ? 'Créer mon compte' : 'Se connecter',
    'account-button account-button--primary',
    null,
    'submit'
  );
  setDisabled(submit, state.loading);
  form.appendChild(submit);
  card.appendChild(form);

  const privacy = el('p', 'account-privacy-link');
  privacy.append(
    document.createTextNode('Vos données sont protégées. '),
    (() => {
      const link = document.createElement('a');
      link.href = '/politique-confidentialite.html';
      link.textContent = 'Lire la politique de confidentialité';
      return link;
    })()
  );
  card.appendChild(privacy);
  return card;
}

function renderHistoryList(history, full = false) {
  const list = el('ul', `account-history-list${full ? ' account-history-list--full' : ''}`);
  history.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const row = el('li');
    const currencyLabel = item.currency === 'tokens' ? 'jeton(s)' : 'étoile(s)';
    const operationLabel = item.type === 'purchase'
      ? 'Achat'
      : item.type === 'debit'
        ? 'Débit'
        : 'Crédit';
    if (full) {
      const details = el('div');
      details.appendChild(el('strong', null, String(item.label || 'Opération de compte')));
      details.appendChild(el('small', null, `${operationLabel} · ${dateTimeLabel(item.createdAt)}`));
      if (item.expiresAt) {
        details.appendChild(el('small', 'account-history-expiry', `Actif jusqu’au ${dateTimeLabel(item.expiresAt)}`));
      }
      if (item.totalPrice || item.currencyCode) {
        const paid = item.totalPrice
          ? ` · ${item.totalPrice} ${item.currencyCode || ''}`.trim()
          : '';
        details.appendChild(el('small', null, `Paiement${paid}`));
      }
      row.appendChild(details);
    } else {
      row.appendChild(el('span', null, String(item.label || 'Opération de compte')));
    }
    const amount = el(
      'strong',
      item.type === 'debit' ? 'is-debit' : 'is-credit',
      item.type === 'purchase'
        ? `${item.amount || 0} ${currencyLabel}`
        : `${item.type === 'debit' ? '−' : '+'}${item.amount || 0} ${item.currency === 'tokens' ? 'jeton(s)' : '★'}`
    );
    row.appendChild(amount);
    list.appendChild(row);
  });
  return list;
}

function renderSubscriptionPanel(state, actions) {
  const panel = el('article', 'account-card account-panel-card account-subscription-panel');
  panel.id = 'accountSubscriptionPanel';
  panel.appendChild(makeHeading(
    'Accès au site',
    'Abonnement',
    'Retrouvez votre formule active et sa date de fin.'
  ));
  const subscription = state.user?.subscription;
  const plan = state.user?.activePlan || {};
  if (!subscription) {
    panel.append(
      el('div', 'account-empty-state',
        el('strong', null, 'Aucun abonnement actif'),
        el('p', null, 'Choisissez une formule pour accéder aux tableaux inclus.')),
      button('Voir les abonnements', 'account-button account-button--primary', actions.openOffers)
    );
    return panel;
  }
  const status = el('div', 'account-subscription-status');
  status.append(
    el('span', 'account-status-dot', ''),
    el('strong', null, subscription.planName || plan.display_name || 'Forfait actif'),
    el('span', null, subscription.status === 'active' ? 'Actif' : String(subscription.status || 'À vérifier'))
  );
  panel.appendChild(status);
  const facts = el('div', 'account-subscription-facts');
  facts.append(
    el('div', null, el('span', null, 'Début'), el('strong', null, dateTimeLabel(subscription.started_at))),
    el('div', null, el('span', null, 'Fin'), el('strong', null, subscription.expires_at
      ? dateTimeLabel(subscription.expires_at)
      : 'Sans date de fin'))
  );
  panel.appendChild(facts);
  const features = Array.isArray(subscription.features) ? subscription.features.filter(Boolean) : [];
  if (features.length) {
    panel.appendChild(el(
      'p',
      'account-subscription-features',
      `Tableaux inclus : ${features.map((feature) => String(feature).replace(/^tableaux-/, '')).join(' · ')}`
    ));
  }
  panel.appendChild(button('Gérer les offres', 'account-button account-button--quiet', actions.openOffers));
  return panel;
}

function renderPrivacyPanel() {
  const panel = el('article', 'account-card account-panel-card account-privacy-panel');
  panel.id = 'accountPrivacyPanel';
  panel.appendChild(makeHeading(
    'Compte',
    'Confidentialité & sécurité',
    'Les informations de compte servent à sécuriser vos accès et à afficher votre activité.'
  ));
  panel.append(
    el('div', 'account-privacy-block',
      el('strong', null, 'Vos données personnelles'),
      el('p', null, 'Votre nom, votre adresse e-mail, votre pays et les informations nécessaires à vos accès sont utilisés uniquement pour faire fonctionner votre compte et personnaliser votre expérience.')
    ),
    el('div', 'account-privacy-block',
      el('strong', null, 'Sécurité du compte'),
      el('p', null, 'Les données d’accès sont gérées par le service d’authentification sécurisé. Les opérations de solde, d’achat et de déblocage sont vérifiées côté serveur avant d’être affichées.')
    ),
    el('div', 'account-privacy-block',
      el('strong', null, 'Vos choix'),
      el('p', null, 'Vous pouvez modifier votre profil, consulter votre historique et fermer votre session à tout moment.'),
    ),
    el('p', null, 'Pour lire les conditions complètes de traitement, consultez notre politique de confidentialité.'),
    (() => {
      const link = document.createElement('a');
      link.className = 'account-privacy-action';
      link.href = '/politique-confidentialite.html';
      link.textContent = 'Lire la politique de confidentialité';
      return link;
    })()
  );
  return panel;
}

function renderQuickAccess(state, actions) {
  const user = state.user || {};
  const stats = user.stats || {};
  const tokens = Number(stats.tokens) || 0;
  const shortcuts = [
    {
      icon: '💬',
      title: t('account.quickVirtualTitle', 'Cidmap virtuel'),
      description: t('account.quickVirtualDescription', 'Discute avec l’IA'),
      className: 'account-quick-access--virtual',
      handler: actions.openVirtualAssistant
    },
    {
      icon: '👑',
      title: t('account.quickSubscriptionTitle', 'Abonnement'),
      description: t('account.quickSubscriptionDescription', 'Gérer mes offres'),
      className: 'account-quick-access--subscription',
      handler: actions.openOffers
    },
    {
      icon: '📊',
      title: t('account.quickHistoryTitle', 'Solde & historique'),
      description: `${tokens.toLocaleString(window.cidTranslation?.current?.() || 'fr')} ${
        t(tokens === 1 ? 'balance.tokenSingular' : 'balance.tokenPlural', tokens === 1 ? 'jeton' : 'jetons')
      }`,
      className: 'account-quick-access--history',
      handler: () => actions.tab('history', { scroll: true })
    },
    {
      icon: '🔒',
      title: t('account.quickPrivacyTitle', 'Confidentialité & sécurité'),
      description: t('account.quickPrivacyDescription', 'Sécurité & données'),
      className: 'account-quick-access--privacy',
      handler: () => actions.tab('privacy', { scroll: true })
    }
  ];
  const section = el('section', 'account-quick-access-section');
  section.appendChild(el('h2', null, 'Accès rapides & services'));
  const grid = el('div', 'account-quick-grid');
  shortcuts.forEach((shortcut) => {
    const item = button(null, `account-quick-access ${shortcut.className}`, shortcut.handler);
    item.setAttribute('aria-label', `${shortcut.title} — ${shortcut.description}`);
    item.dataset.accountAction = shortcut.title;
    item.append(
      el('span', 'account-quick-access-icon', shortcut.icon),
      el('span', 'account-quick-access-copy',
        el('strong', null, shortcut.title),
        el('small', null, shortcut.description))
    );
    grid.appendChild(item);
  });
  section.appendChild(grid);
  return section;
}

function renderCountryPicker(state, actions) {
  const wrapper = el('label', 'account-country-picker');
  wrapper.appendChild(el('span', null, 'Pays du programme personnalisé'));
  const select = document.createElement('select');
  select.id = 'accountCountryQuickSelect';
  select.name = 'accountCountryQuickSelect';
  select.setAttribute('aria-label', 'Pays du programme personnalisé');
  const current = String(state.user?.country || state.edit?.country || '').trim().toUpperCase();
  const values = ACCOUNT_COUNTRIES.map(([code]) => code);
  const addOption = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  if (current && !values.includes(current)) {
    addOption(current, countryLabel(current));
  }
  ACCOUNT_COUNTRIES.forEach(([code, label]) => {
    addOption(code, label);
  });
  select.value = current || 'DEFAULT';
  select.addEventListener('change', () => {
    actions.save({
      name: state.user?.name || '',
      country: select.value,
      phone: state.user?.phone || ''
    });
  });
  wrapper.appendChild(select);
  return wrapper;
}

function renderDashboard(state, actions) {
  const user = state.user || {};
  const history = Array.isArray(user.history) ? user.history : [];
  const featureUnlocks = Array.isArray(user.featureUnlocks)
    ? user.featureUnlocks
    : [];
  const stats = user.stats || {};
  let currencies = [];
  try {
    const activeCurrencies = typeof window.cidCurrencyMode?.activeCurrencies === 'function'
      ? window.cidCurrencyMode.activeCurrencies()
      : [];
    currencies = Array.isArray(activeCurrencies) ? activeCurrencies : [];
  } catch (_) {
    currencies = [];
  }
  const section = el('section', 'account-dashboard');
  section.id = 'profileView';
  section.setAttribute('aria-labelledby', 'accountDashboardTitle');

  const header = el('header', 'account-dashboard-header account-card');
  const identity = el('div');
  identity.appendChild(el('span', 'account-kicker', 'Mon profil & compte'));
  const title = el('h1', null, user.name || 'Membre Cidmap');
  title.id = 'accountDashboardTitle';
  identity.append(title, el('p', null, user.email || 'Adresse e-mail non renseignée'));
  const accountStatus = user.subscription?.status === 'active'
    ? 'Abonné actif'
    : 'Compte actif';
  const headerMeta = el('div', 'account-dashboard-header-meta');
  headerMeta.append(
    el('span', `account-status-pill${user.subscription?.status === 'active' ? ' is-subscriber' : ''}`,
      `Statut : ${accountStatus}`),
    button('Se déconnecter', 'account-button account-button--quiet', actions.logout)
  );
  header.append(identity, headerMeta);
  section.appendChild(header);
  section.appendChild(renderCountryPicker(state, actions));

  const nav = el('nav', 'account-dashboard-nav');
  nav.setAttribute('aria-label', 'Sections du compte');
  [
    ['overview', 'Accueil'],
    ['settings', 'Profil']
  ].forEach(([tab, label]) => {
    const item = button(label, state.tab === tab ? 'is-active' : '', () => actions.tab(tab));
    item.dataset.accountTab = tab;
    nav.appendChild(item);
  });
  section.appendChild(nav);

  if (state.tab === 'overview') {
    section.appendChild(renderQuickAccess(state, actions));
    const grid = el('div', 'account-grid');
    const unlocksCard = el('article', 'account-card account-summary-card');
    unlocksCard.append(
      el('span', 'account-kicker', 'Schémas débloqués'),
      el('strong', null, String(featureUnlocks.length)),
      el('p', null, featureUnlocks.length
        ? featureUnlocks
          .map((item) => String(item?.feature_key || item?.featureKey || '').replace(/^tableaux-/, ''))
          .filter(Boolean)
          .join(' · ') || 'Aucun schéma débloqué'
        : 'Aucun schéma débloqué')
    );
    const activity = el('article', 'account-card account-summary-card');
    const stars = Number(stats.stars) || 0;
    const tokens = Number(stats.tokens) || 0;
    const shareCount = Number(stats.shareCount) || 0;
    const shareLabel = shareCount === 1
      ? t('share.singular', 'partage')
      : t('share.plural', 'partages');
    activity.append(
      el('span', 'account-kicker', 'Activité'),
      el('strong', null, `${tokens} jeton${tokens === 1 ? '' : 's'}`),
      el('p', null, `${currencies.includes('stars') ? `${stars} étoile${stars === 1 ? '' : 's'} · ` : ''}${shareCount} ${shareLabel}`)
    );
    const historyCard = el('article', 'account-card account-summary-card account-summary-card--wide');
    historyCard.appendChild(el('span', 'account-kicker', 'Historique récent'));
    if (history.length) historyCard.appendChild(renderHistoryList(history.slice(0, 3)));
    else historyCard.appendChild(el('p', null, 'Aucune opération enregistrée.'));
    grid.append(unlocksCard, activity, historyCard);
    section.appendChild(grid);
  } else if (state.tab === 'history') {
    const panel = el('article', 'account-card account-panel-card');
    panel.id = 'accountHistoryPanel';
    panel.appendChild(makeHeading('Données distantes', 'Historique du compte'));
    const heading = panel.querySelector('h1');
    if (heading) heading.tagName = 'h2';
    if (history.length) panel.appendChild(renderHistoryList(history, true));
    else panel.appendChild(el('p', 'account-muted', 'Aucun historique disponible.'));
    section.appendChild(panel);
  } else if (state.tab === 'subscription') {
    section.appendChild(renderSubscriptionPanel(state, actions));
  } else if (state.tab === 'help') {
    const panel = renderHelpPanel(state, actions);
    panel.id = 'accountHelpPanel';
    section.appendChild(panel);
  } else if (state.tab === 'privacy') {
    section.appendChild(renderPrivacyPanel());
  } else {
    const panel = el('article', 'account-card account-panel-card');
    panel.id = 'accountSettingsPanel';
    const heading = makeHeading('Compte', 'Profil & paramètres');
    const h1 = heading.querySelector('h1');
    if (h1) {
      const h2 = document.createElement('h2');
      h2.id = h1.id;
      h2.textContent = h1.textContent;
      h1.replaceWith(h2);
    }
    panel.appendChild(heading);
    const form = el('form', 'account-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      actions.save({
        name: form.elements.accountProfileName.value,
        country: form.elements.accountProfileCountry.value,
        phone: form.elements.accountProfilePhone?.value || ''
      });
    });
    const name = makeField('Nom affiché', 'accountProfileName', 'text', state.edit.name, { required: true });
    const email = makeField('Adresse e-mail', 'accountProfileEmail', 'email', user.email || '', { readOnly: true });
    const country = makeField('Pays du programme', 'accountProfileCountry', 'text', state.edit.country, { placeholder: 'Votre pays' });
    const phoneGroup = el('div', 'cid-phone-country-field');
    phoneGroup.dataset.cidPhoneSelector = 'true';
    const phoneLabel = el('label', null, 'Indicatif international');
    phoneLabel.htmlFor = 'accountProfilePhone';
    const phoneInput = document.createElement('input');
    phoneInput.id = 'accountProfilePhone';
    phoneInput.name = 'accountProfilePhone';
    phoneInput.type = 'tel';
    phoneInput.inputMode = 'tel';
    phoneInput.autocomplete = 'tel';
    phoneInput.placeholder = '+229 90 00 00 00';
    try {
      phoneInput.value = state.user?.phone
        || localStorage.getItem(`cidmap:phone:${state.user?.id || 'visitor'}`)
        || '';
    } catch (_) {
      phoneInput.value = state.user?.phone || '';
    }
    phoneInput.setAttribute('list', 'cidInternationalDialCodes');
    const phoneCountry = el('small', 'cid-phone-country-name');
    phoneCountry.dataset.cidPhoneCountry = '';
    phoneGroup.append(phoneLabel, phoneInput, phoneCountry);
    form.append(name.label, email.label, country.label, phoneGroup);
    window.cidInternationalPhone?.enhance?.(phoneGroup, {
      countryInput: country.input,
      value: phoneInput.value
    });
    phoneInput.addEventListener('input', () => {
      try {
        localStorage.setItem(`cidmap:phone:${state.user?.id || 'visitor'}`, phoneInput.value.trim());
      } catch (_) {}
    });
    const status = makeStatus(state.editError);
    if (status) form.appendChild(status);
    const save = button(state.editLoading ? 'Enregistrement…' : 'Enregistrer', 'account-button account-button--primary', null, 'submit');
    setDisabled(save, state.editLoading);
    form.appendChild(save);
    panel.appendChild(form);
    section.appendChild(panel);
  }

  // Keep the admin entry visible from every account tab. Administrators were
  // previously only shown this action on the overview tab, which made the
  // dashboard appear to be missing after opening Historique, Récompenses or
  // Paramètres.
  if (state.isAdmin) {
    const admin = button(null, 'account-admin-entry', actions.openAdmin);
    const content = el('span', 'account-admin-entry-content');
  content.append(el('strong', null, 'Tableau administrateur'), el('small', null, 'Gérer les schémas, paiements et tarifs'));
    admin.appendChild(content);
    section.appendChild(admin);
  }
  return section;
}

function adminInput(id, labelText, type = 'text', value = '', options = {}) {
  const wrapper = el('label', 'admin-form-field');
  wrapper.appendChild(el('span', null, labelText));
  const input = el(options.multiline ? 'textarea' : 'input');
  input.id = id;
  if (!options.multiline) input.type = type;
  input.value = value;
  if (options.required) input.required = true;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.readOnly) {
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
  }
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step !== undefined) input.step = options.step;
  if (options.rows) input.rows = options.rows;
  wrapper.appendChild(input);
  return wrapper;
}

function renderAdminDashboardFallback(actions, error) {
  const root = el('section', 'admin-dashboard admin-dashboard-fallback');
  root.setAttribute('aria-label', 'Tableau administrateur indisponible');
  const card = el('article', 'admin-dashboard-intro');
  card.append(
    el('span', 'admin-kicker', 'Espace protégé'),
    el('h2', null, 'Tableau administrateur'),
    el(
      'p',
      null,
      'Le panneau d’administration n’a pas pu être chargé. Vos données ne sont pas perdues.'
    )
  );
  const detail = el(
    'p',
    'admin-error-message',
    `Détail : ${error?.message || 'une donnée nécessaire est indisponible.'}`
  );
  detail.setAttribute('role', 'alert');
  card.appendChild(detail);
  card.appendChild(button('Retour au compte', 'admin-dashboard-back-link', actions.closeAdmin));
  root.appendChild(card);
  return root;
}

function renderAdminDashboardUnsafe(actions) {
  const root = el('section', 'admin-dashboard');
  root.setAttribute('aria-label', 'Tableau administrateur');
  const header = el('header', 'admin-dashboard-header');
  const headerCopy = el('div', 'admin-dashboard-header-copy');
  headerCopy.append(
    el('span', 'admin-kicker', 'Espace protégé'),
    el('h2', null, 'Tableau administrateur'),
    el('p', null, 'Pilotez les publications, accès et paiements depuis une seule console.')
  );
  const back = button('Retour au compte', 'admin-dashboard-back-link', actions.closeAdmin);
  header.append(headerCopy, back);
  root.appendChild(header);

  const nav = el('nav', 'admin-dashboard-nav');
  nav.id = 'adminDashboardNav';
  nav.setAttribute('aria-label', 'Rubriques administrateur');
  [
    ['overview', 'Vue d’ensemble'],
    ['sources', 'Pays, matrices & horaires'],
    ['rules', 'Règles d’accès & tarifs'],
    ['controle', 'Fonctions / images'],
    ['payments', 'Paiements & jetons'],
    ['early', 'Accès anticipé']
  ].forEach(([id, label]) => {
    const item = button(label, 'admin-dashboard-nav-button', null);
    item.dataset.adminDashboardView = id;
    nav.appendChild(item);
  });
  root.appendChild(nav);

  const overview = el('section', 'admin-dashboard-section');
  overview.id = 'adminDashboardSectionOverview';
  overview.dataset.adminDashboardSection = 'overview';
  const overviewHeading = el('div', 'admin-section-heading');
  overviewHeading.append(
    el('div', null, el('h3', null, 'Vue d’ensemble'), el('p', null, 'Un aperçu rapide de la configuration actuellement synchronisée.')),
    el('span', 'admin-live-pill', '● Connecté à Supabase')
  );
  overview.appendChild(overviewHeading);
  const status = el('p', 'admin-status-message');
  status.id = 'adminDashboardStatus';
  overview.appendChild(status);
  const stats = el('div', 'admin-overview-stats');
  [
    ['adminOverviewRulesCount', 'Règles d’accès', 'règle(s)'],
    ['adminOverviewSourcesCount', 'Sources pays / heure', 'source(s)'],
    ['adminOverviewPacksCount', 'Packs de jetons', 'pack(s)']
  ].forEach(([id, label, suffix]) => {
    const tile = el('article', 'admin-overview-stat');
    tile.append(el('span', null, label), Object.assign(el('strong', null, '—'), { id }), el('small', null, suffix));
    stats.appendChild(tile);
  });
  overview.appendChild(stats);
  const siteManagement = el('div', 'admin-site-management admin-action-card');
  const managementCopy = el('div', 'admin-card-heading');
  managementCopy.append(el('h4', null, 'Santé de la configuration'), el('p', null, 'Rechargez les dernières valeurs enregistrées et forcez une synchronisation globale.'));
  siteManagement.appendChild(managementCopy);
  const managementActions = el('div', 'admin-inline-actions');
  const refreshSite = button('Actualiser la configuration du site', 'admin-refresh-btn', null);
  refreshSite.id = 'adminRefreshSiteConfig';
  refreshSite.classList.add('admin-button-with-icon');
  managementActions.appendChild(refreshSite);
  const refreshAccess = button('Actualiser les accès', 'admin-refresh-btn', null);
  refreshAccess.id = 'adminRefreshAccessOverview';
  managementActions.appendChild(refreshAccess);
  siteManagement.appendChild(managementActions);
  overview.appendChild(siteManagement);
  root.appendChild(overview);

  const rules = el('section', 'admin-dashboard-section');
  rules.dataset.adminDashboardSection = 'rules';
  rules.id = 'adminDashboardSectionRules';
  const rulesHeading = el('div', 'admin-section-heading');
  rulesHeading.append(el('div', null, el('h3', null, 'Règles d’accès & tarifs'), el('p', null, 'Définissez la monnaie et le coût de déblocage de chaque fonctionnalité.')));
  rules.appendChild(rulesHeading);
  const ruleCard = el('article', 'admin-form-card');
  ruleCard.append(el('div', 'admin-card-heading', el('h4', null, 'Nouvelle règle de fonctionnalité'), el('p', null, 'Les changements sont enregistrés dans Supabase après validation.')));
  const ruleGrid = el('div', 'admin-form-grid');
  ruleGrid.append(adminInput('adminAccessFeatureKey', 'Clé de fonctionnalité', 'text', '', { placeholder: 'ex. tableaux-oracle' }));
  ruleGrid.append(adminInput('adminAccessFeatureName', 'Nom affiché', 'text', '', { placeholder: 'ex. Carte Oracle' }));
  const currency = adminInput('adminAccessFeatureCurrency', 'Monnaie de déblocage');
  const currencyInput = currency.querySelector('input');
  if (currencyInput) {
    const currencySelect = document.createElement('select');
    currencySelect.id = 'adminAccessFeatureCurrency';
    currencySelect.innerHTML = '<option value="tokens">Jetons</option><option value="stars">Étoiles</option>';
    currencyInput.replaceWith(currencySelect);
  }
  ruleGrid.append(currency);
  ruleGrid.append(adminInput('adminAccessFeatureTokens', 'Jetons requis', 'number', '1', { min: 1 }));
  ruleGrid.append(adminInput('adminAccessFeatureStars', 'Étoiles requises', 'number', '0', { min: 0 }));
  ruleCard.appendChild(ruleGrid);
  const ruleActions = el('div', 'admin-form-actions');
  const saveRule = button('Enregistrer la règle', 'admin-primary-button', null);
  saveRule.id = 'adminSaveAccessRule';
  ruleActions.appendChild(saveRule);
  ruleActions.append(Object.assign(el('p', 'admin-status-message'), { id: 'adminAccessRuleStatus' }));
  ruleCard.appendChild(ruleActions);
  rules.appendChild(ruleCard);
  const rulesListCard = el('article', 'admin-list-card');
  const rulesListHeading = el('div', 'admin-card-heading');
  rulesListHeading.append(el('h4', null, 'Règles enregistrées'), el('p', null, 'Vue en lecture des règles actuellement actives.'));
  rulesListCard.append(rulesListHeading, Object.assign(el('div', 'admin-access-rule-list'), { id: 'adminAccessRules' }));
  rules.appendChild(rulesListCard);
  root.appendChild(rules);

  const sources = el('section', 'admin-dashboard-section');
  sources.dataset.adminDashboardSection = 'sources';
  sources.id = 'adminDashboardSectionSources';
  const sourcesHeading = el('div', 'admin-section-heading');
  sourcesHeading.append(el('div', null, el('h3', null, 'Pays, matrices & horaires'), el('p', null, 'Créez une source par pays et horaire. Le serveur génère les éléments associés.')));
  sources.appendChild(sourcesHeading);
  const sourceCard = el('article', 'admin-form-card');
  sourceCard.append(el('div', 'admin-card-heading', el('h4', null, 'Ajouter une source'), el('p', null, 'Le code pays permet de rattacher automatiquement la source aux publications.')));
  const sourceGrid = el('div', 'admin-form-grid');
  const sourceModule = adminInput('adminDrawSourceModule', 'Programme');
  const sourceModuleInput = sourceModule.querySelector('input');
  if (sourceModuleInput) {
    const select = document.createElement('select');
    select.id = 'adminDrawSourceModule';
    select.innerHTML = '<option value="matrice">Matrice</option>';
    sourceModuleInput.replaceWith(select);
  }
  sourceGrid.append(sourceModule);
  sourceGrid.append(adminInput('adminDrawSourceCountryCode', 'Code pays', 'text', 'BJ', { placeholder: 'ex. BJ' }));
  sourceGrid.append(adminInput('adminDrawSourceCountryName', 'Nom du pays', 'text', 'Bénin'));
  sourceGrid.append(adminInput('adminDrawSourceName', 'Nom du programme', 'text', 'Bénin 00h'));
  sourceGrid.append(adminInput('adminDrawSourceTime', 'Heure', 'time', '00:00'));
  sourceCard.appendChild(sourceGrid);
  const sourceFlags = el('div', 'admin-source-flags');
  [
    ['adminDrawSourceKeyboard', 'Ajouter le Clavier', true],
    ['adminDrawSourceCerveau', 'Ajouter le Cerveau', false],
    ['adminDrawSourceCode', 'Générer le Code', true],
    ['adminDrawSourceEvent', 'Générer l’Event', true]
  ].forEach(([id, label, checked]) => {
    const item = el('label', 'admin-payment-toggle');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = checked;
    item.append(checkbox, el('span', null, label));
    sourceFlags.appendChild(item);
  });
  sourceCard.appendChild(sourceFlags);
  const sourceActions = el('div', 'admin-form-actions');
  const generateSource = button('Générer et enregistrer la source', 'admin-primary-button', null);
  generateSource.id = 'adminGenerateDrawSource';
  sourceActions.append(generateSource, Object.assign(el('p', 'admin-status-message'), { id: 'adminDrawSourceStatus' }));
  sourceCard.appendChild(sourceActions);
  sources.appendChild(sourceCard);
  const sourceListCard = el('article', 'admin-list-card');
  sourceListCard.append(
    el('div', 'admin-card-heading', el('h4', null, 'Sources configurées'), el('p', null, 'Chaque suppression est confirmée puis synchronisée côté serveur.')),
    Object.assign(el('div', 'admin-access-rule-list'), { id: 'adminDrawSources' })
  );
  sources.appendChild(sourceListCard);
  root.appendChild(sources);

  const payments = el('section', 'admin-dashboard-section');
  payments.dataset.adminDashboardSection = 'payments';
  payments.id = 'adminDashboardSectionPayments';
  const paymentsHeading = el('div', 'admin-section-heading');
  paymentsHeading.append(el('div', null, el('h3', null, 'Paiements & jetons'), el('p', null, 'Choisissez le parcours d’encaissement et administrez vos packs de jetons.')));
  payments.appendChild(paymentsHeading);
  const paymentCard = el('article', 'admin-form-card');
  paymentCard.append(el('div', 'admin-card-heading', el('h4', null, 'Configuration du paiement'), el('p', null, 'Le mode sélectionné est écrit directement dans la table payment_settings de Supabase.')));
  const paymentGrid = el('div', 'admin-form-grid');
  const paymentMode = adminInput('adminPaymentMode', 'Mode de paiement');
  const paymentModeInput = paymentMode.querySelector('input');
  if (paymentModeInput) {
    const paymentModeSelect = document.createElement('select');
    paymentModeSelect.id = 'adminPaymentMode';
    paymentModeSelect.setAttribute('aria-label', 'Mode de paiement');
    paymentModeSelect.innerHTML = '<option value="manual">Manuel</option><option value="online">En ligne Paystack</option>';
    paymentModeInput.replaceWith(paymentModeSelect);
  }
  paymentGrid.appendChild(paymentMode);
  const paymentProvider = adminInput('adminPaymentProvider', 'Fournisseur', 'text', 'Paystack');
  paymentProvider.dataset.adminPaymentOnline = 'true';
  paymentGrid.appendChild(paymentProvider);
  const paymentLink = adminInput('adminPaymentLink', 'Lien de paiement en ligne', 'url', '', { placeholder: 'https://...' });
  paymentLink.dataset.adminPaymentOnline = 'true';
  paymentGrid.appendChild(paymentLink);
  const paymentContact = adminInput('adminPaymentContact', 'Contact');
  paymentGrid.appendChild(paymentContact);
  paymentCard.appendChild(paymentGrid);
  const paystackToggle = el('label', 'admin-payment-toggle admin-toggle-card');
  const paystackCheckbox = document.createElement('input');
  paystackCheckbox.type = 'checkbox';
  paystackCheckbox.id = 'adminPaystackEnabled';
  paystackCheckbox.setAttribute('aria-label', 'Activer le paiement en ligne Paystack');
  paystackToggle.append(paystackCheckbox, el('span', null, 'Activer le paiement en ligne Paystack'));
  paymentCard.appendChild(paystackToggle);
  const physicalInstructions = adminInput('adminPhysicalInstructions', 'Instructions de paiement', 'text', '', { multiline: true, rows: 4 });
  physicalInstructions.dataset.adminPaymentManual = 'true';
  paymentCard.appendChild(physicalInstructions);
  const paymentActions = el('div', 'admin-form-actions');
  const savePayment = button('Enregistrer la configuration', 'admin-primary-button', null);
  savePayment.id = 'adminSavePaymentSettings';
  paymentActions.append(savePayment, Object.assign(el('p', 'admin-status-message'), { id: 'adminPaymentStatus' }));
  paymentCard.appendChild(paymentActions);
  payments.appendChild(paymentCard);
  const tokenCard = el('article', 'admin-list-card');
  tokenCard.append(
    el('div', 'admin-card-heading', el('h4', null, 'Packs de jetons'), el('p', null, 'Prix en XOF, stockés dans Supabase et visibles côté parcours de paiement.')),
    Object.assign(el('div', 'admin-token-pack-grid'), { id: 'adminTokenPrices' })
  );
  payments.appendChild(tokenCard);
  root.appendChild(payments);

  const early = el('section', 'admin-dashboard-section');
  early.dataset.adminDashboardSection = 'early';
  early.id = 'adminDashboardSectionEarly';
  const earlyHeading = el('div', 'admin-section-heading');
  earlyHeading.append(el('div', null, el('h3', null, 'Accès anticipé'), el('p', null, 'Ouvrez certaines publications plus tôt contre un nombre défini de jetons.')));
  early.appendChild(earlyHeading);
  const earlyCard = el('article', 'admin-form-card');
  earlyCard.append(el('div', 'admin-card-heading', el('h4', null, 'Planifier une publication'), el('p', null, 'À l’heure normale, la publication reste gratuite pour tous les utilisateurs.')));
  const earlyGrid = el('div', 'admin-form-grid');
  const earlyFeature = adminInput('adminEarlyAccessFeatureKey', 'Publication');
  earlyGrid.append(earlyFeature);
  earlyGrid.append(el(
    'p',
    'admin-form-hint',
    'Toutes les anticipations suivent automatiquement la génération globale de 16:00 en Côte d’Ivoire.'
  ));
  earlyGrid.append(adminInput('adminEarlyAccessTokens', 'Jetons requis', 'number', '1', { min: 1 }));
  earlyCard.appendChild(earlyGrid);
  const earlyEnabled = el('label', 'admin-payment-toggle admin-toggle-card');
  const earlyEnabledInput = document.createElement('input');
  earlyEnabledInput.type = 'checkbox';
  earlyEnabledInput.id = 'adminEarlyAccessEnabled';
  earlyEnabled.append(earlyEnabledInput, el('span', null, 'Activer l’accès anticipé pour cette publication'));
  earlyCard.appendChild(earlyEnabled);
  const earlyActions = el('div', 'admin-form-actions');
  const saveEarly = button('Enregistrer l’accès anticipé', 'admin-primary-button', null);
  saveEarly.id = 'adminSaveEarlyAccess';
  earlyActions.append(saveEarly, Object.assign(el('p', 'admin-status-message'), { id: 'adminEarlyAccessStatus' }));
  earlyCard.appendChild(earlyActions);
  early.appendChild(earlyCard);
  early.append(
    el('article', 'admin-list-card', el('div', 'admin-card-heading', el('h4', null, 'Règles d’accès anticipé'), el('p', null, 'État et coût de chaque publication configurée.')), Object.assign(el('div', 'admin-access-rule-list'), { id: 'adminEarlyAccessRules' }))
  );
  root.appendChild(early);

  const controle = el('section', 'admin-dashboard-section admin-dashboard-section--wide');
  controle.dataset.adminDashboardSection = 'controle';
  controle.id = 'adminDashboardSectionControle';
  const controleHeading = el('div', 'admin-section-heading');
  controleHeading.append(el('div', null,
    el('h3', null, 'Fonctions / images'),
    el('p', null, 'Chaque fonction dispose maintenant de sa propre fiche : image, état, fonction serveur, tables, règles et commandes disponibles.')
  ));
  controle.appendChild(controleHeading);

  const controleToolbar = el('div', 'admin-methods-toolbar');
  controleToolbar.id = 'adminMethodsToolbar';
  const todayDate = new Date().toISOString().slice(0, 10);
  const methodDate = adminInput('adminMethodDate', 'Date du tableau', 'date', todayDate);
  const loadBoard = button('Charger le tableau', 'admin-primary-button', null);
  loadBoard.id = 'adminLoadBoard';
  const refreshMethods = button('Actualiser', 'admin-refresh-btn', null);
  refreshMethods.id = 'adminRefreshMethods';
  controleToolbar.append(methodDate, loadBoard, refreshMethods);
  controle.appendChild(controleToolbar);
  controle.appendChild(el('p', 'admin-status-message')).id = 'adminMethodStatus';

  const methodTabs = el('div', 'admin-valid-tabs');
  methodTabs.id = 'adminMethodTabs';
  [['functions', 'Fonctions / images'], ['valid', 'Numéros valides'], ['programs', 'Programmes & méthodes'], ['balsa', 'Programme Balsa'], ['modules', 'Registre des modules']]
    .forEach(([id, label]) => {
      const tab = button(label, 'admin-valid-tab', null);
      tab.dataset.adminMethodTab = id;
      methodTabs.appendChild(tab);
    });
  controle.appendChild(methodTabs);

  const functionsPane = el('div', 'admin-valid-card');
  functionsPane.dataset.adminMethodPane = 'functions';
  const functionsHeading = el('div', 'admin-valid-heading');
  functionsHeading.appendChild(el('h3', null, 'Tableaux des fonctions'));
  functionsHeading.appendChild(el('small', null, 'Une fiche complète par fonction / image'));
  functionsPane.appendChild(functionsHeading);
  const functionsStack = el('div', 'admin-function-board');
  functionsStack.id = 'adminFunctionBoard';
  functionsPane.appendChild(functionsStack);
  controle.appendChild(functionsPane);

  const validPane = el('div', 'admin-valid-card');
  validPane.dataset.adminMethodPane = 'valid';
  const validHeading = el('div', 'admin-valid-heading');
  validHeading.appendChild(el('h3', null, 'Numéros valides du jour'));
  validHeading.appendChild(el('small', null, 'Grilles 1–90 · générées côté serveur'));
  validPane.appendChild(validHeading);
  const validStack = el('div', 'admin-valid-stack');
  validStack.id = 'adminValidBoard';
  validPane.appendChild(validStack);
  controle.appendChild(validPane);

  const programsPane = el('div', 'admin-valid-card');
  programsPane.dataset.adminMethodPane = 'programs';
  const programsHeading = el('div', 'admin-valid-heading');
  programsHeading.appendChild(el('h3', null, 'Contrôle des programmes'));
  programsHeading.appendChild(el('small', null, 'Versions, tests, publication'));
  programsPane.appendChild(programsHeading);
  const programsStack = el('div', 'admin-method-groups');
  programsStack.id = 'adminProgramsBoard';
  programsPane.appendChild(programsStack);
  controle.appendChild(programsPane);

  const balsaPane = el('div', 'admin-valid-card');
  balsaPane.dataset.adminMethodPane = 'balsa';
  const balsaHeading = el('div', 'admin-valid-heading');
  balsaHeading.appendChild(el('h3', null, 'Programme Balsa Plus'));
  balsaHeading.appendChild(el('small', null, 'Payload du programme pour la date'));
  balsaPane.appendChild(balsaHeading);
  const balsaStack = el('div', 'admin-valid-stack');
  balsaStack.id = 'adminBalsaBoard';
  balsaPane.appendChild(balsaStack);
  controle.appendChild(balsaPane);

  const modulesPane = el('div', 'admin-valid-card');
  modulesPane.dataset.adminMethodPane = 'modules';
  const modulesHeading = el('div', 'admin-valid-heading');
  modulesHeading.appendChild(el('h3', null, 'Modules du tableau de bord'));
  modulesHeading.appendChild(el('small', null, 'Sources pilotées par la base de données'));
  modulesPane.appendChild(modulesHeading);
  const modulesStack = el('div', 'admin-valid-stack');
  modulesStack.id = 'adminModulesBoard';
  modulesPane.appendChild(modulesStack);
  controle.appendChild(modulesPane);

  root.appendChild(controle);

  return root;
}

// Keep all dashboard construction behind one boundary. A malformed profile,
// an older Supabase schema, or a browser/runtime DOM error must leave the
// account route usable and must never result in a blank page.
function renderLegacyAdminDashboard(actions) {
  try {
    return renderAdminDashboardUnsafe(actions);
  } catch (error) {
    console.error('Rendu du tableau administrateur impossible', error);
    return renderAdminDashboardFallback(actions, error);
  }
}

export function mountAccountView(host, props = {}) {
  if (!host) return null;
  const state = {
    user: props.user ?? null,
    session: props.session ?? null,
    authMode: 'login',
    loading: false,
    error: '',
    tab: 'overview',
    edit: { name: props.user?.name || '', country: props.user?.country || '' },
    editLoading: false,
    editError: '',
    isAdmin: false,
    adminOpen: false,
    helpLoading: false,
    helpLoaded: false,
    helpSending: false,
    helpError: '',
    helpAccess: null,
    helpContext: null,
    helpMessages: [],
    helpSessionId: null,
    helpDraft: ''
  };
  let destroyed = false;
  let currencyUnsubscribe = null;
  let helpRequest = null;

  const loadHelp = async () => {
    if (destroyed || !state.user?.id || helpRequest) return;
    helpRequest = (async () => {
      state.helpLoading = true;
      state.helpError = '';
      render();
      try {
        const result = await window.cidMessageRepository.state(state.user);
        state.helpAccess = result.access || null;
        state.helpContext = result.assistantContext || null;
        state.helpMessages = [];
        state.helpLoaded = true;
        /*
         * Human support messages and Cidmap virtuel have separate histories.
         * Load the latter explicitly so a reload does not look like a fresh
         * assistant that forgot the user's previous clarification.
         */
        try {
          const persisted = await readPersistentVirtualChat({ state });
          state.helpSessionId = persisted?.sessionId || null;
          state.helpMessages = (Array.isArray(persisted?.messages)
            ? persisted.messages
            : []
          ).map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            body: String(message.content || ''),
            createdAt: message.createdAt || null
          }));
        } catch (_) {
          // The Supabase account panel remains usable if the optional
          // Websim/D1 history route has not been deployed yet.
        }
      } catch (error) {
        state.helpAccess = error?.access || state.helpAccess;
        state.helpError = errorMessage(error);
      } finally {
        state.helpLoading = false;
        helpRequest = null;
        if (!destroyed) render();
      }
    })();
    return helpRequest;
  };

  const refreshAdminStatus = async (profile = state.user) => {
    const user = profile || state.user;
    if (!user?.id) return;
    const expectedUserId = String(user.id);
    if (!window.cidAuthCurrentUserId) {
      window.cidAuthCurrentUserId = expectedUserId;
    }
    try {
      // Some installations expose the role directly on the profile while
      // others only expose it through the protected user_roles check.
      // Neither an absent role nor an absent flag may throw.
      const userRole = user?.role || user?.is_admin;
      // Supabase user objects can be frozen. Never annotate that object
      // directly; pass a mutable application copy to the authorization flow.
      const adminUser = { ...user, role: userRole };
      const configuredAdmin = adminUser?.role || adminUser?.is_admin;
      const confirmedByProfile = configuredAdmin === 'admin'
        || configuredAdmin === true
        || configuredAdmin === 'true';
      const isAdmin = confirmedByProfile || Boolean(await checkAdminAccess(adminUser));
      // An authorization check can finish after the visitor has logged out
      // or switched account. Never apply that late answer to the new session.
      if (state.user?.id && String(state.user.id) !== expectedUserId) return;
      if (window.cidAuthCurrentUserId
        && String(window.cidAuthCurrentUserId) !== expectedUserId) return;
      state.isAdmin = isAdmin;
      window.cidIsAdmin = isAdmin;
      window.dispatchEvent(new CustomEvent('cid:admin-access-updated', {
        detail: { isAdmin, userId: expectedUserId }
      }));
      if (!destroyed && !state.adminOpen) render();
    } catch (_) {
      state.isAdmin = false;
      if (!window.cidAuthCurrentUserId
        || String(window.cidAuthCurrentUserId) === expectedUserId) {
        window.cidIsAdmin = false;
      }
    }
  };
  const refresh = async () => {
    const profile = await fetchUserProfile();
    if (!profile) throw new Error('Votre profil n’est plus disponible.');
    state.user = profile;
    state.session = state.session || { user: profile };
    state.edit = { name: profile.name || '', country: profile.country || '' };
    render();
    return profile;
  };
  const actions = {
    mode: (mode) => {
      state.authMode = mode;
      state.error = '';
      render();
    },
    google: async () => {
      state.loading = true;
      state.error = '';
      render();
      try {
        const result = await loginWithGoogle();
        if (result?.user) {
          state.user = result.user;
          state.session = result.session || { user: result.user };
          state.edit = { name: state.user.name || '', country: state.user.country || '' };
        }
      } catch (error) {
        state.error = errorMessage(error);
      } finally {
        state.loading = false;
        render();
      }
    },
    submit: async (values) => {
      if (state.authMode === 'signup' && values.password !== values.confirmation) {
        state.error = 'Les mots de passe ne correspondent pas.';
        render();
        return;
      }
      state.loading = true;
      state.error = '';
      render();
      try {
        const profile = state.authMode === 'signup'
          ? await registerUser(values)
          : await loginUser(values);
        if (!profile) throw new Error('La connexion n’a pas retourné de profil.');
        state.user = profile;
        state.session = { user: profile };
        state.edit = { name: profile.name || '', country: profile.country || '' };
        refreshAdminStatus();
      } catch (error) {
        state.error = errorMessage(error);
      } finally {
        state.loading = false;
        render();
      }
    },
    logout: async () => {
      state.loading = true;
      render();
      try {
        await logoutUser();
        state.user = null;
        state.session = null;
        state.isAdmin = false;
        window.cidIsAdmin = false;
        window.dispatchEvent(new CustomEvent('cid:admin-access-updated', {
          detail: { isAdmin: false, userId: '' }
        }));
      } catch (error) {
        state.error = errorMessage(error);
      } finally {
        state.loading = false;
        render();
      }
    },
    tab: (tab, options = {}) => {
      state.tab = tab === 'rewards' ? 'history' : tab;
      window.dispatchEvent(new CustomEvent('cid:account-tab', { detail: { tab } }));
      render();
      if (options.scroll) {
        window.requestAnimationFrame(() => {
          const targetId = state.tab === 'history'
            ? 'accountHistoryPanel'
            : state.tab === 'privacy'
              ? 'accountPrivacyPanel'
              : 'profileView';
          const target = host.querySelector(`#${targetId}`);
          if (!target) return;
          const top = Math.max(0, target.offsetTop - 12);
          host.scrollTo?.({ top, left: 0, behavior: 'smooth' });
        });
      }
      if (state.tab === 'help' && !state.helpLoaded) window.setTimeout(loadHelp, 0);
    },
    openVirtualAssistant: () => {
      /*
       * Use the same dedicated messenger mounted by Catégories. Keeping one
       * chat surface avoids a second, partially wired account conversation
       * and preserves the assistant's existing session/access handling.
       */
      if (typeof window.showPublicVirtualView === 'function') {
        window.cidLeaveProfileView?.();
        return window.showPublicVirtualView({ updateHistory: true });
      }
      // The account chat remains a safe fallback while the category module
      // is still loading.
      actions.tab('help', { scroll: true });
      return undefined;
    },
    loadHelp,
    openOffers: () => {
      window.cidLeaveProfileView?.();
      if (window.showOffersView) window.showOffersView();
      else window.location.href = '/?section=categories-offers';
    },
    openResults: () => {
      window.cidLeaveProfileView?.();
      if (window.showResultatAideView) window.showResultatAideView();
      else window.location.href = '/?section=categories-resultat-aide';
    },
    sendHelp: async (content) => {
      if (state.helpSending || !String(content || '').trim()) return;
      state.helpSending = true;
      state.helpError = '';
      const question = String(content).trim();
      state.helpMessages = [
        ...state.helpMessages,
        { role: 'user', body: question, createdAt: new Date().toISOString() }
      ];
      state.helpDraft = '';
      render();
      try {
        if (isGreetingOnly(question)) {
          const answer = t('assistant.greetingResponse', 'Bonjour ! Que souhaitez-vous faire ou savoir ?');
          state.helpMessages = [
            ...state.helpMessages,
            {
              role: 'assistant',
              body: answer,
              createdAt: new Date().toISOString()
            }
          ];
          void invokePersistentVirtualChat({
            state,
            messages: state.helpMessages,
            mode: 'record',
            answer,
            source: 'account-greeting'
          }).catch(() => {});
          return;
        }
        /*
         * Refresh the authorized Supabase snapshot before every substantive
         * answer. The access banner may be several minutes old; the virtual
         * guide must see the current subscription, daily payloads and latest
         * published memories before it answers.
         */
        try {
          const refreshed = await window.cidMessageRepository?.state?.(state.user);
          if (refreshed?.access) state.helpAccess = refreshed.access;
          if (refreshed?.assistantContext) state.helpContext = refreshed.assistantContext;
        } catch (_) {
          // Keep the last verified snapshot if a transient refresh fails.
        }
        const asksAnalysis = /\b(analyse|analyser|comparaison|comparer|statistique|statistiques|tendance|tendances|pourcentage|pourcentages|historique|rejoue|revient|retour)\b/i
          .test(question);
        const asksSpecificTableau = /\b(universelle|intuition|oracle|lnb|balsa|stand[\s-]?by|robot|matrice|d[eé]chiffrement|boules?\s+rejet[eé]es?)\b/i
          .test(question);
        if (asksAnalysis && !asksSpecificTableau) {
          const country = String(
            state.helpContext?.userCountry
              || state.helpAccess?.user?.country
              || ''
          ).trim().toUpperCase();
          const availableResults = Array.isArray(state.helpContext?.publishedForCountry)
            ? state.helpContext.publishedForCountry
            : [];
          if (!country) {
            const answer = 'Pour analyser les résultats, indiquez d’abord le pays concerné.';
            state.helpMessages = [
              ...state.helpMessages,
              {
                role: 'assistant',
                body: answer,
                createdAt: new Date().toISOString()
              }
            ];
            void invokePersistentVirtualChat({
              state,
              messages: state.helpMessages,
              mode: 'record',
              answer,
              source: 'account-analysis-gate'
            }).catch(() => {});
            return;
          }
          if (!availableResults.length) {
            const answer = [
              'Aucun résultat mémorisé n’est disponible pour ce pays.',
              'Je ne peux pas faire une analyse sans données ; transmettez d’abord un résultat complet avec sa date, son heure et ses numéros afin qu’il puisse être validé.',
              'Vous pouvez aussi consulter la méthode Universelle et les offres configurées. Elle peut servir de point de départ pour plusieurs pays, mais son périmètre dépend du catalogue et elle ne crée pas un résultat absent.',
              'Un déblocage individuel donne accès au Tableau choisi ; un forfait collectif donne accès uniquement aux Tableaux inclus dans l’offre.'
            ].join('\n');
            state.helpMessages = [
              ...state.helpMessages,
              {
                role: 'assistant',
                body: answer,
                createdAt: new Date().toISOString()
              }
            ];
            void invokePersistentVirtualChat({
              state,
              messages: state.helpMessages,
              mode: 'record',
              answer,
              source: 'account-analysis-gate'
            }).catch(() => {});
            return;
          }
        }
        if (!window.websim?.chat?.completions?.create) {
          throw new Error('Cidmap virtuel est momentanément indisponible.');
        }
        const conversation = state.helpMessages.slice(-10).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.body
        }));
        const ownedTableaux = [
          ...(state.helpAccess?.subscription?.features || []),
          ...(state.helpAccess?.individualUnlocks || []).map((item) => item.featureKey),
          ...(state.helpAccess?.scope?.authorizedPrograms || [])
        ].map((feature) => String(feature).replace(/^tableaux-/, ''))
          .filter(Boolean);
        const publicOnly = state.helpAccess?.canHelp !== true;
        const localeCode = String(
          state.helpAccess?.localeCode
            || window.cidSiteConfig?.localization?.()?.selectedLocale
            || window.cidTranslation?.current?.()
            || 'fr'
        ).trim() || 'fr';
        let localeName = localeCode;
        try {
          localeName = new Intl.DisplayNames([localeCode], { type: 'language' })
            .of(localeCode) || localeCode;
        } catch (_) {}
        const experience = JSON.stringify({
          userCountry: state.helpContext?.userCountry || state.helpAccess?.user?.country || '',
          accessScope: state.helpAccess?.scope?.source || state.helpContext?.accessScope || 'aucun',
          authorizedPrograms: state.helpAccess?.scope?.authorizedPrograms
            || state.helpContext?.authorizedPrograms
            || [],
          publishedForCountry: (state.helpContext?.publishedForCountry || []).slice(0, 20),
          publishedCountForCountry: state.helpContext?.publishedCountForCountry || 0,
          publishedResults: (state.helpContext?.publishedResults || []).slice(0, 120),
          allProgramStatistics: (state.helpContext?.allProgramStatistics || []).slice(0, 180),
          dayProgramStatistics: (state.helpContext?.dayProgramStatistics || []).slice(0, 180),
          records: (state.helpContext?.records || []).slice(0, 80),
          dayPatterns: (state.helpContext?.dayPatterns || []).slice(0, 80),
          timePatterns: (state.helpContext?.timePatterns || []).slice(0, 80),
          delayPatterns: (state.helpContext?.delayPatterns || []).slice(0, 160),
          permutationObservations: (state.helpContext?.permutationObservations || []).slice(0, 80),
          delayProgramStatistics: (state.helpContext?.delayProgramStatistics || []).slice(0, 160),
          currentPrograms: (state.helpContext?.currentPrograms || []).slice(0, 12),
          currentWeek: state.helpContext?.currentWeek || '',
          weeklyActivity: (state.helpContext?.weeklyActivity || []).slice(0, 100),
          crossProgramPatterns: (state.helpContext?.crossProgramPatterns || []).slice(0, 50),
          dechiffrementPlus: state.helpContext?.dechiffrementPlus?.available
            ? {
              available: true,
              method: state.helpContext.dechiffrementPlus.method,
              storageReady: state.helpContext.dechiffrementPlus.storageReady !== false,
              historyCount: state.helpContext.dechiffrementPlus.historyCount || 0,
              matrixCount: state.helpContext.dechiffrementPlus.matrixCount || 0,
              summaries: (state.helpContext.dechiffrementPlus.summaries || []).slice(0, 40)
            }
            : { available: false }
        });
        const completion = await invokePersistentVirtualChat({
          state,
          messages: [
            {
              role: 'system',
              content: [
                publicOnly
                  ? 'Tu es Cidmap virtuel en mode information publique pour un compte sans forfait actif.'
                  : 'Tu es Cidmap virtuel avec la mémoire autorisée d’un compte ayant un forfait actif ou un Tableau individuel encore valide.',
                state.helpAccess?.isAdmin
                  ? 'Le compte est administrateur : reconnais explicitement son rôle et autorise les mémoires prévues pour le contrôle interne.'
                  : state.helpAccess?.isModerator
                    ? 'Le compte est modérateur : reconnais explicitement son rôle et respecte les mémoires prévues pour la modération.'
                    : state.helpAccess?.subscription
                      ? `Le compte possède la formule collective « ${state.helpAccess.subscription.planName || 'active'} ».`
                      : state.helpAccess?.individualUnlocks?.length
                        ? 'Le compte possède un ou plusieurs tableaux individuels actifs.'
                        : 'Le compte ne possède pas de formule collective ni de tableau individuel actif.',
                `Code de langue actif de l’utilisateur : ${localeCode}. Réponds exclusivement dans cette langue (${localeName}), avec un ton clair, calme et utile.`,
                publicOnly
                  ? 'Explique les noms des tableaux et les notions générales de NAP1, NAP2, combinaisons, clés, ordres et pourcentages, sans valeur calculée exacte.'
                  : 'Explique les tableaux, les règles NAP1, NAP2, combinaisons, clés, ordres et pourcentages déjà calculés.',
                'Tu peux aider à comprendre une statistique ou à utiliser le site.',
                'Lorsque l’utilisateur demande comment accéder à un tableau, explique le parcours de façon neutre : ouvrir ou créer un compte, consulter les offres, recharger le solde avec les unités virtuelles configurées, puis choisir un forfait collectif ou un tableau individuel.',
                'Les jetons sont des unités virtuelles internes utilisées pour débloquer un accès selon les tarifs affichés par l’administration ; ne les présente jamais comme de l’argent réel, un investissement, un gain ou une somme retirable.',
                'Un forfait collectif donne accès uniquement aux tableaux inclus dans ce forfait. Un déverrouillage individuel donne accès uniquement au tableau choisi, pendant la durée affichée. Ne confirme jamais un achat ou un accès sans preuve dans l’état du compte.',
                'Présente les options d’accès uniquement si la question le demande ou si elles expliquent directement un verrouillage. Ne fais pas de pression, ne crée pas d’urgence et ne promets jamais de réussite.',
                'Tu peux comparer les pays, semaines et jours uniquement pour les tableaux autorisés dans la mémoire reçue.',
                'Tu peux aussi comparer les tendances de journée et de nuit lorsque les heures historiques sont suffisantes.',
                'Compare toujours la semaine actuelle aux semaines précédentes avant de dire qu’un programme rejoue ou revient.',
                'Si une tendance se répète, décris-la comme une observation testée sur plusieurs semaines et précise le nombre de tirages observés.',
                'Un numéro ou une famille de numéros absente ne devient jamais un numéro sûr : signale seulement que l’observation manque.',
                `Ancienneté d’abonnement : ${state.helpAccess?.loyalty?.loyaltyMonths || 0} mois ; niveau : ${state.helpAccess?.loyalty?.level || 'récent'}.`,
                'Un client fidèle peut recevoir une explication historique plus large et des suggestions de méthode, mais la fidélité ne donne jamais droit à une garantie ni à la révélation de valeurs exactes d’un Tableau non autorisé.',
                publicOnly
                  ? 'En mode public, donne uniquement des tendances agrégées, des noms de méthodes et des explications générales. Ne donne aucune donnée calculée exacte.'
                  : 'Pour un Tableau non autorisé, ne donne aucune information de calcul, statistique, clé, numéro, ordre ou combinaison ; indique simplement que ce Tableau ne fait pas partie de son accès.',
                `Tableaux autorisés pour cet utilisateur : ${ownedTableaux.join(', ') || 'aucun détail'}.`,
                'Le périmètre collectif ou individuel transmis par le serveur est la seule source d’autorisation. Ne reconstruis jamais un accès à partir de la question de l’utilisateur.',
                'Pour une analyse détaillée d’un Tableau, respecte les Tableaux autorisés par l’utilisateur.',
                'Si l’utilisateur demande une valeur exacte d’un autre Tableau, explique que Cidmap virtuel ne révèle pas les données précises et donne seulement la tendance agrégée. Pour MT, utilise seulement les valeurs présentes dans les résumés autorisés.',
                'La mémoire ci-dessous vient uniquement de tirages validés et de pronostics autorisés.',
                'Commence par tenir compte du pays connu dans le profil et des résultats déjà publiés pour ce pays.',
                'Les lignes de publishedResults sont des résultats déjà publics : si l’utilisateur demande un pays, affiche la publication la plus récente de ce pays avec sa date, son heure et ses numéros. Si aucune ligne ne correspond, dis qu’aucun résultat n’est actuellement disponible et propose le parcours de transmission approprié.',
                'Pour rechercher un pays, reconnais BJ = Bénin, CI = Côte d’Ivoire, GH = Ghana, NE = Niger, SN = Sénégal et TG = Togo.',
                publicOnly
                  ? 'En mode public, présente seulement les résultats et tendances déjà publiés. Si l’utilisateur veut transmettre un nouveau résultat, explique qu’un forfait actif est nécessaire et ne collecte aucune donnée.'
                  : 'Avant de demander un nouveau résultat, vérifie le premier élément de publishedForCountry : présente-le comme le dernier résultat connu avec sa date et son heure, puis demande s’il s’agit bien du dernier ou s’il existe un autre horaire.',
                publicOnly
                  ? 'Ne demande jamais de renvoyer un pays, une date, une heure ou des numéros en mode public.'
                  : 'Ne demande jamais de renvoyer un pays, une date et une heure déjà présents ; indique que ce créneau est déjà mémorisé.',
                publicOnly
                  ? 'Si la mémoire publique est limitée, explique simplement qu’elle est agrégée et qu’un accès autorisé est nécessaire pour une analyse détaillée.'
                  : 'Si le pays contient peu ou pas de résultats publiés, propose une analyse d’une journée si elle est disponible dans le Tableau autorisé et demande à l’abonné d’envoyer le résultat complet manquant.',
                'currentPrograms contient les dernières sorties autorisées des tables daily_*_programs. Pour une question sur la valeur actuelle d’un Tableau, utilise d’abord cette mémoire, indique la date du programme, la table source et l’heure de mise à jour. Si la ligne est absente, dis que la publication n’est pas encore synchronisée et ne la remplace pas par un autre Tableau.',
                publicOnly
                  ? 'Ne demande pas l’heure, les premiers numéros, la machine ou les bonus à un compte sans forfait.'
                  : 'Demande toujours l’heure, les premiers numéros, la machine et les bonus lorsqu’un résultat doit être ajouté à la mémoire.',
                'Les anciens résultats peuvent montrer des répétitions ou des retours historiques, mais cela reste une observation et non une promesse de retour.',
                'Un satellite réussi alors qu’un NAP2 échoue doit être décrit comme une observation distincte, jamais comme une garantie.',
                'Une permutation regroupe un satellite et les combinaisons qui lui sont rattachées. Si la mémoire montre au moins trois tentatives et au moins deux réussites pour le même Tableau et le même décalage, tu peux proposer à l’abonné autorisé de suivre cette permutation comme une piste complémentaire pour augmenter la couverture, en rappelant que ce n’est jamais une garantie. Ne propose jamais une permutation à partir d’un seul cas.',
                'Pour une permutation, précise le satellite parent, les combinaisons associées, le nombre de numéros de l’ensemble, le décalage J+0/J+1/J+2/J+3/J+7, le nombre de tirages observés et les dates des exemples disponibles.',
                'Les statistiques directes (J+0) et les répétitions historiques sont séparées. Ne mélange jamais une réussite du même jour avec une observation à J+1, J+2, J+3 ou J+7. Dis explicitement « Observation historique sur X tirages » lorsque tu cites une tendance.',
                'Les croisements entre programmes sont des corrélations historiques, pas une preuve de causalité.',
                'Pour une permutation, utilise uniquement des nombres déjà présents dans la mémoire autorisée et présente-la comme une exploration, jamais comme une promesse.',
                'Déchiffrement Plus / MT est une méthode distincte : lorsqu’elle est disponible dans la mémoire autorisée, explique les couples, les correspondances et les groupes produits à partir des nombres fournis, ainsi que les rôles de Matrice, Clavier et Cerveau.',
                'Pour Déchiffrement Plus / MT uniquement, tu peux reprendre les valeurs exactes présentes dans les résumés autorisés et proposer une lecture ou une combinaison demandée par l’abonné. Présente toujours ces valeurs comme issues de la méthode et non comme des numéros certains.',
                'Dans un résumé MT, inputNumbers sont les nombres fournis, selected est la relation retenue par le moteur et calls contient les couples ou groupes disponibles. Pour une analyse Matrice / Clavier / Cerveau, tenNumbers et repeatedNumbers sont les sorties mémorisées du calcul. N’invente jamais une valeur absente du résumé.',
                'Ne mélange jamais une relation MT avec une réussite d’un autre Tableau : précise le nom de la méthode, la date, le pays et le contexte de la saisie.',
                'Si la mémoire ne contient pas assez de résultats pour le pays ou la période demandée, demande à l’abonné de fournir un résultat complet d’un jour ou une série de 5 à 7 jours consécutifs, sans trou, avec l’heure, les premiers numéros, la machine et les bonus.',
                'Explique que des résultats manquants ou des heures absentes empêchent une évaluation fiable.',
                'Ne promets jamais une victoire, un numéro, une date certaine ou un gain financier.',
                'Rappelle que les pourcentages décrivent l’historique et ne garantissent pas le prochain tirage.',
                'Après une simple salutation, réponds brièvement et pose une seule question ouverte pour comprendre le besoin. Ne présente pas spontanément tous les programmes, abonnements, prix ou fonctionnalités.',
                'Réponds uniquement au besoin exprimé. Ne donne jamais un catalogue complet sans demande explicite. Si la demande est vague, pose une seule question de clarification.',
                'Garde chaque réponse concise : au maximum trois courts paragraphes, sauf si l’utilisateur demande volontairement des détails.',
                `Utilisateur : ${state.user?.name || 'abonné'}.`,
                publicOnly
                  ? 'Aucun forfait actif reconnu : reste strictement dans le périmètre public agrégé.'
                  : `Accès actif : ${state.helpAccess?.subscription?.planName || 'déblocage individuel'}.`,
                `Mémoire d’expérience autorisée : ${experience}`,
                localeCode === 'en'
                  ? 'FINAL LANGUAGE RULE: answer only in English.'
                  : localeCode === 'ar'
                    ? 'قاعدة اللغة النهائية: أجب باللغة العربية فقط.'
                    : localeCode === 'es'
                      ? 'REGLA FINAL DE IDIOMA: responde únicamente en español.'
                      : localeCode === 'pt'
                        ? 'REGRA FINAL DE IDIOMA: responda somente em português.'
                        : `RÈGLE FINALE DE LANGUE : réponds uniquement en ${localeName}.`
              ].join(' ')
            },
            ...conversation
          ]
        });
        state.helpMessages = [
          ...state.helpMessages,
          {
            role: 'assistant',
            body: String(completion?.content || 'Je n’ai pas pu formuler une réponse. Réessayez.'),
            createdAt: new Date().toISOString()
          }
        ];
      } catch (error) {
        state.helpError = errorMessage(error);
      } finally {
        state.helpSending = false;
        render();
      }
    },
    save: async (values) => {
      state.editLoading = true;
      state.editError = '';
      state.edit = values;
      render();
      try {
        await updateUserProfile(values);
        await refresh();
        state.editLoading = false;
        render();
      } catch (error) {
        state.editError = errorMessage(error);
        state.editLoading = false;
        render();
      }
    },
    openAdmin: () => {
      try {
        if (!state.user?.id || !state.isAdmin) {
          throw new Error('Votre rôle administrateur n’est pas confirmé.');
        }
        state.adminOpen = true;
        document.body.classList.add('cid-admin-active');
        // Do not inherit the scroll position of the account dashboard under
        // the administration workspace.
        window.setTimeout(() => {
          if (state.adminOpen) host.scrollTop = 0;
        }, 0);
        render();
      } catch (error) {
        console.error('Ouverture du tableau administrateur impossible', error);
        state.adminOpen = false;
        state.error = error?.message || 'Le tableau administrateur est indisponible.';
        render();
      }
    },
    closeAdmin: () => {
      state.adminOpen = false;
      document.body.classList.remove('cid-admin-active');
      render();
    }
  };

  const onAuthSync = (event) => {
    if (event.detail?.id) {
      state.user = event.detail;
      state.session = state.session || { user: event.detail };
      state.edit = { name: event.detail.name || '', country: event.detail.country || '' };
      refreshAdminStatus();
    } else if (event.detail === null) {
      state.user = null;
      state.session = null;
      state.isAdmin = false;
      render();
    }
  };
  const onAccountTab = (event) => {
    const requested = event.detail?.tab;
    if (requested === 'chat' || requested === 'help') {
      state.tab = 'help';
      if (!state.helpLoaded) window.setTimeout(loadHelp, 0);
    } else if (requested === 'rewards' || requested === 'history') state.tab = 'history';
    else if (requested === 'subscription') state.tab = 'subscription';
    else if (requested === 'privacy') state.tab = 'privacy';
    else if (requested === 'settings') state.tab = 'settings';
    else if (requested === null || requested === 'overview') state.tab = 'overview';
    render();
  };
  const onPaymentValidated = async () => {
    if (destroyed || !state.user?.id || state.adminOpen) return;
    try {
      // The payment webhook/reconciliation is the source of truth. Reload
      // the complete account profile so the overview, balance and history
      // are updated together instead of leaving the account on its old
      // in-memory snapshot.
      await refresh();
    } catch (error) {
      console.warn('Actualisation du compte après paiement impossible', error);
    }
  };
  window.addEventListener('cid:auth-sync', onAuthSync);
  window.addEventListener('cid:account-tab', onAccountTab);
  window.addEventListener('cid:payment-validated', onPaymentValidated);
  if (typeof window.cidCurrencyMode?.subscribe === 'function') {
    currencyUnsubscribe = window.cidCurrencyMode.subscribe(() => render());
  }

  function render() {
    if (destroyed) return;
    try {
      host.replaceChildren();
      const root = el('main', 'account-view-root');
      if (state.adminOpen && state.user) root.appendChild(renderAdminDashboardView(actions));
      else if (state.user) root.appendChild(renderDashboard(state, actions));
      else root.appendChild(renderAuthForm(state, actions));
      host.appendChild(root);
    } catch (error) {
      // This is the last line of defence: even an error while assembling the
      // fallback itself is contained, and the host receives visible text.
      console.error('Rendu du compte impossible', error);
      try {
        host.replaceChildren();
        const fallback = el('main', 'account-view-root');
        const stateNode = el('section', 'account-state account-state--error');
        stateNode.append(
          el('span', 'account-state-icon', '!'),
          el('div', null,
            el('h2', null, 'Votre compte est temporairement indisponible'),
            el('p', null, 'Les données n’ont pas pu être assemblées. Réessayez sans recharger toute la page.'),
            button('Réessayer', 'account-button account-button--primary', () => render())
          )
        );
        fallback.appendChild(stateNode);
        host.appendChild(fallback);
      } catch (_) {
        host.textContent = 'Votre compte est temporairement indisponible. Réessayez dans un instant.';
      }
    }
  }
  render();
  if (state.user?.id) refreshAdminStatus();

  return {
    destroy() {
      destroyed = true;
      document.body.classList.remove('cid-admin-active');
      window.removeEventListener('cid:auth-sync', onAuthSync);
      window.removeEventListener('cid:account-tab', onAccountTab);
      window.removeEventListener('cid:payment-validated', onPaymentValidated);
      currencyUnsubscribe?.();
      host.replaceChildren();
    },
    refresh
  };
}

export default mountAccountView;
