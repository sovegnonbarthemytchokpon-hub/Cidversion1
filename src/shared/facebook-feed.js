/* Facebook-style Cidmap home feed.
   This controller owns only #cid-home-feed and leaves the other SPA views
   untouched. */

import {
  createComment,
  getPublicProfile,
  getPostMetrics,
  getPublicationCommentsEnabled,
  listCommentMetrics,
  listPublicProfiles,
  listComments,
  listCroixGenerations,
  recordPostShare,
  subscribeToFeed,
  toggleCommentLike,
  togglePostLike
} from '/src/services/social-repository.js';
import { getProgrammeDate } from '/src/backend-server/methods/program-clock.js';
import {
  CROSS_DAY_COLORS,
  crossDayStyleForDate
} from '/src/croix/redCrossService.js';

const FEED_ID = 'cid-home-feed';
const PAGE_NAME = 'Cidmap';
const DEFAULT_AVATAR = '/src/shared/images/squirrel-croix-192.png';
const brandAvatar = () => window.__cidBrandAvatarSrc || DEFAULT_AVATAR;

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const OFFICIAL_CROSS_DAY_COLORS = CROSS_DAY_COLORS;
const COUNTRY_STORAGE_KEY = 'cidgroup.smart-country.v1';
const COUNTRY_OPTIONS = [
  "Côte d'Ivoire",
  'Niger',
  'Ghana',
  'Bénin',
  'Sénégal',
  'Togo'
];
const COUNTRY_FLAGS = {
  Tous: '🌐',
  "Côte d'Ivoire": '🇨🇮',
  Bénin: '🇧🇯',
  Niger: '🇳🇪',
  Togo: '🇹🇬',
  Ghana: '🇬🇭',
  Sénégal: '🇸🇳'
};
const PUBLICATION_HOUR_GMT = 16;
// Nine visible publication days total: today plus the eight preceding days.
// The oldest group is recycled when the programme date advances.
const HOME_HISTORY_DAYS = 8;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
let crossNode = null;
let crossPlaceholder = null;
let feedRealtimeCleanup = null;
let feedRealtimeWarningShown = false;
const pendingCommentsRequests = new WeakMap();
const pendingMetricsRequests = new WeakMap();
const pendingHomeHistoryHydrations = new WeakMap();
const FEED_CACHE_KEY = 'cidgroup.feed-hydration.v40';
const FEED_CACHE_TTL = 2 * 60 * 1000;
// Public comments are paused for now; the social row keeps like and share.
const COMMENTS_ENABLED = false;
let commentsSheetState = null;
let commentsSheetPreviousOverflow = '';
let commentsPaginationObserver = null;
const COMMENTS_PAGE_SIZE = 5;
const COMMENTS_MODE_VIEW = 'view';
const COMMENTS_MODE_WRITE = 'write';

function uiLocale() {
  return String(
    window.cidTranslation?.current?.()
      || localStorage.getItem('cid_i18n_locale')
      || localStorage.getItem('userLang')
      || 'fr'
  ).replace('_', '-');
}

function uiTranslate(key, fallback = key) {
  return window.cidTranslation?.t?.(key, fallback)
    || window.cidI18n?.translate?.(key, uiLocale())
    || fallback;
}

function uiDate(date, options) {
  return new Intl.DateTimeFormat(uiLocale(), options).format(date);
}

function isEnglishUi() {
  return uiLocale().toLowerCase().startsWith('en');
}

function baseUiLocale() {
  return uiLocale().split('-')[0].toLowerCase();
}

function localizedPublicationText(kind, country, fullDate) {
  const locale = baseUiLocale();
  const hasCountry = country && country !== 'Tous';
  const localizedNames = {
    fr: {
      cross: 'Croix nationale',
      matrix: 'Matrice',
      rejected: 'Boules rejetées',
      entertainment: '#divertissement'
    },
    en: {
      cross: 'National Cross',
      matrix: 'Matrix',
      rejected: 'Rejected Balls',
      entertainment: '#entertainment'
    },
    es: {
      cross: 'Cruz nacional',
      matrix: 'Matriz',
      rejected: 'Bolas rechazadas',
      entertainment: '#entretenimiento'
    },
    pt: {
      cross: 'Cruz nacional',
      matrix: 'Matriz',
      rejected: 'Bolas rejeitadas',
      entertainment: '#entretenimento'
    },
    ar: {
      cross: 'الصليب الوطني',
      matrix: 'المصفوفة',
      rejected: 'الكرات المرفوضة',
      entertainment: '#الترفيه'
    }
  };
  const words = localizedNames[locale] || localizedNames.fr;
  const label = uiTranslate(
    `feed.${kind}Title`,
    words?.[kind] || words?.cross
  );
  const entertainment = uiTranslate(
    'feed.entertainment',
    words?.entertainment || '#divertissement'
  );
  const subject = hasCountry
    ? `${label} ${country}`
    : `${label} ${locale === 'ar' ? 'اليوم' : locale === 'en' ? 'of the day' : locale === 'es' ? 'del día' : locale === 'pt' ? 'do dia' : 'du jour'}`;
  const preposition = {
    fr: 'pour le',
    en: 'for',
    es: 'para el',
    pt: 'para o',
    ar: 'لـ'
  }[locale] || 'pour le';
  const dayWord = {
    fr: 'de ce',
    en: 'this',
    es: 'de este',
    pt: 'deste',
    ar: 'لهذا'
  }[locale] || 'de ce';
  return {
    title: label,
    copy: `${subject} ${preposition} ${entertainment} 💯 ${dayWord} ${fullDate}`
  };
}

function socialPostId(post) {
  return post?.dataset.postId
    || post?.dataset.postType
    || post?.dataset.croixPostId
    || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCountry(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalCountry(value) {
  const normalized = normalizeCountry(value);
  if (!normalized || normalized === 'auto' || normalized === 'tous' || normalized === 'tous les pays') {
    return 'Tous';
  }
  return COUNTRY_OPTIONS.find((country) => normalizeCountry(country) === normalized) || 'Tous';
}

function countryFlag(value) {
  return COUNTRY_FLAGS[canonicalCountry(value)] || COUNTRY_FLAGS.Tous;
}

function countryFlagLabel(value) {
  const country = canonicalCountry(value);
  return country === 'Tous' ? 'Tous les pays' : country;
}

function currentFeedCountry() {
  // The preference belongs to the visitor, not only to a connected profile.
  // Anonymous visitors can have selected a country during the first visit or
  // through the smart-country control, so the home feed must use that same
  // source of truth as Matrice and Boules rejetées.
  if (typeof window.cidSmartCountry?.get === 'function') {
    return canonicalCountry(window.cidSmartCountry.get());
  }

  const stored = safeJson(COUNTRY_STORAGE_KEY, {});
  const profile = window.cidAuth?.getCurrentProfile?.();
  const storedCountry = profile?.cid
    ? stored.byCid?.[profile.cid]
    : stored.anonymous;
  return canonicalCountry(storedCountry || localStorage.getItem('firstVisitCountry') || 'Tous');
}

function dateInfo() {
  const now = new Date();
  // The illustration catalogue can still be loading when the feed mounts.
  // Never fall back to the visitor's civil date: the shared Abidjan clock is
  // the source of truth for the publication date.
  const programmeDate = window.cidDailyIllustrations?.getProgrammeDate?.(now)
    || getProgrammeDate(now);
  return {
    now,
    programmeDate,
    dayIndex: programmeDate.getUTCDay(),
    weekday: DAY_NAMES[programmeDate.getUTCDay()],
    fullDate: uiDate(programmeDate, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }),
    dateKey: uiDate(programmeDate, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }),
    isoDateKey: programmeDate.toISOString().slice(0, 10)
  };
}

function programmeInfoForDate(programmeDate, now = new Date()) {
  const date = programmeDate instanceof Date
    ? new Date(programmeDate)
    : new Date(programmeDate);
  if (Number.isNaN(date.getTime())) return dateInfo();

  return {
    now,
    programmeDate: date,
    dayIndex: date.getUTCDay(),
    weekday: DAY_NAMES[date.getUTCDay()],
    fullDate: uiDate(date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }),
    dateKey: uiDate(date, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }),
    isoDateKey: date.toISOString().slice(0, 10)
  };
}

function previousProgrammeInfo(info, daysBack) {
  const date = new Date(info.programmeDate);
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(daysBack) || 0));
  return programmeInfoForDate(date, info.now);
}

function publicationId(type, info) {
  return `${type}:${info?.isoDateKey || dateInfo().isoDateKey}`;
}

function publicationTimestamp(programmeDate) {
  const date = programmeDate instanceof Date ? programmeDate : new Date(programmeDate);
  if (Number.isNaN(date.getTime())) return null;

  // A programme dated Tuesday is published on Monday at 16:00 GMT (the
  // existing programme clock opens the next day's content at 16:00).
  // Converting that publication time with UTC keeps it identical for every
  // visitor, whatever their local country/time zone is.
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - 1,
    PUBLICATION_HOUR_GMT,
    0,
    0,
    0
  ));
}

function publicationAge(publishedAt, now = new Date()) {
  const timestamp = publishedAt instanceof Date
    ? publishedAt.getTime()
    : new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return window.cidTranslation?.t?.('notifications.justNow', 'À l’instant') || 'À l’instant';
  }

  const diff = Math.max(0, now.getTime() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (diff < minute) {
    return window.cidTranslation?.t?.('notifications.justNow', 'À l’instant') || 'À l’instant';
  }
  if (diff < hour) {
    const value = Math.floor(diff / minute);
    return window.cidTranslation?.relativeTime?.(-value, 'minute')
      || `Il y a ${value} ${value === 1 ? 'minute' : 'minutes'}`;
  }
  // Keep the 24-hour wording visible, as on the publication examples shown
  // in the product brief, before switching to a day count.
  if (diff < 2 * day) {
    const value = Math.floor(diff / hour);
    return window.cidTranslation?.relativeTime?.(-value, 'hour')
      || `Il y a ${value} ${value === 1 ? 'heure' : 'heures'}`;
  }
  if (diff < month) {
    const value = Math.floor(diff / day);
    return window.cidTranslation?.relativeTime?.(-value, 'day')
      || `Il y a ${value} ${value === 1 ? 'jour' : 'jours'}`;
  }
  if (diff < year) {
    const value = Math.floor(diff / month);
    return window.cidTranslation?.relativeTime?.(-value, 'month')
      || `Il y a ${value} mois`;
  }

  const value = Math.floor(diff / year);
  return window.cidTranslation?.relativeTime?.(-value, 'year')
    || `Il y a ${value} ${value === 1 ? 'an' : 'ans'}`;
}

function publicationDateLabel(publishedAt) {
  const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return isEnglishUi()
    ? 'Publication date unavailable'
    : 'Date de publication indisponible';
  const formatted = date.toLocaleString(uiLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
  return isEnglishUi() ? `Published on ${formatted}` : `Publié le ${formatted}`;
}

function publicationMoreLabel(historical) {
  return historical
    ? (isEnglishUi() ? 'History' : 'Historique')
    : (isEnglishUi() ? 'See more' : 'Voir plus');
}

function programmeResults() {
  return Array.isArray(window.generatedResults) ? window.generatedResults : [];
}

function compactText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function captureCrossInstance() {
  if (crossNode?.isConnected) return crossNode;
  const source = crossNode || document.getElementById('redCross');
  if (!source) return null;

  crossNode = source;
  if (!crossPlaceholder && source.parentNode) {
    crossPlaceholder = document.createComment('emplacement original du composant Croix');
    source.parentNode.insertBefore(crossPlaceholder, source);
  }
  return crossNode;
}

function restoreCrossInstance() {
  if (!crossNode || !crossPlaceholder?.parentNode) return;
  if (crossNode.parentNode !== crossPlaceholder.parentNode) {
    crossPlaceholder.parentNode.insertBefore(crossNode, crossPlaceholder.nextSibling);
  }
}

function isDedicatedCroixSurfaceActive() {
  return document.body?.classList.contains('croix-active')
    || document.body?.dataset?.cidDedicatedView === 'croix'
    || window.__currentCategory === 'croix';
}

function unmountHomeFeed({ restoreCross = true } = {}) {
  document.body?.classList.remove('cid-facebook-feed-active');
  /*
   * The dedicated Croix route takes ownership of the canonical #redCross
   * node after this feed is hidden. A feed observer can run again because
   * the node was moved into #croixViewCurrentCross; restoring it here would
   * leave the selected publication card completely white.
   *
   * The explicit route hook still requests restoration before it moves the
   * node, while observer-driven calls leave the node in the dedicated route.
   */
  if (restoreCross || !isDedicatedCroixSurfaceActive()) {
    restoreCrossInstance();
  }
  const feed = document.getElementById(FEED_ID);
  if (!feed) return;
  /*
   * Keep the prepared nine-day pool mounted while a dedicated route owns the
   * live Croix node. Returning to Accueil can therefore restore the exact same
   * cards, images and social state without rebuilding the feed.
  */
  feed.hidden = true;
  feed.setAttribute('aria-hidden', 'true');
  feed.style.display = 'none';
  // The canonical source may move into a dedicated route after this point.
  // Remove duplicate IDs from hidden history artwork so global legacy
  // selectors always resolve to the live source.
  feed.querySelectorAll('.cid-fb-home-history-cross').forEach((clone) => {
    clone.removeAttribute('id');
  });
}

// Route controllers use this hook before showing a dedicated Croix surface.
// The feed stays mounted but hidden so its prepared publication pool survives.
window.cidUnmountHomeFeed = unmountHomeFeed;

function mountCrossInstance(feed) {
  const slot = $('.cid-fb-cross-live-host', feed);
  const instance = captureCrossInstance();
  if (slot && instance) {
    slot.appendChild(instance);
    syncCrossLoadingState(slot, instance);
  }
}

function syncCrossLoadingState(slot, instance = $('#redCross')) {
  if (!slot || !instance) return;
  const ready = instance.dataset.crossReady === 'true' &&
    instance.getAttribute('aria-hidden') !== 'true';
  slot.classList.toggle('is-cross-ready', ready);
  slot.setAttribute('aria-busy', String(!ready));
}

function crossMedia(info) {
  return `
    <div class="cid-fb-media cid-fb-cross-media">
      <div class="cid-fb-cross-slot" aria-label="Composant Croix nationale">
        <div class="cid-fb-cross-live-host" aria-busy="true"></div>
        <div class="cid-fb-cross-history-visual"></div>
      </div>
    </div>
  `;
}

function imageMedia(src, alt) {
  if (!src) {
    return '<div class="cid-fb-media cid-fb-image-media cid-fb-image-empty"></div>';
  }
  return `
    <div class="cid-fb-media cid-fb-image-media">
      <img class="cid-fb-media-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">
    </div>
  `;
}

function safeDailyColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
    ? String(value).trim()
    : fallback;
}

function dailyBannerInk(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#ffffff';
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= .03928
      ? channel / 12.92
      : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > .48 ? '#10233f' : '#ffffff';
}

function dailyBannerHash(value) {
  return Array.from(String(value || '')).reduce(
    (hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0,
    17
  ) >>> 0;
}

function dailyBannerContext(kind, info, country) {
  const normalizedCountry = country && country !== 'Tous' ? country : '';
  if (kind === 'cross') {
    return ['Croix nationale publiée', 'Résultat officiel du jour', 'Publication nationale']
      [dailyBannerHash(`${kind}:${info.isoDateKey}`) % 3];
  }
  const variants = kind === 'matrix'
    ? normalizedCountry === "Côte d'Ivoire"
      ? [`Spécial ${normalizedCountry}`, 'Clé du jour ivoirienne', 'Votre matrice personnalisée']
      : normalizedCountry === 'Bénin'
        ? ['Bonne fête Bénin', 'Clé du jour béninoise', 'Votre matrice personnalisée']
        : normalizedCountry
          ? [`Spécial ${normalizedCountry}`, 'Clé du jour', 'Votre matrice personnalisée']
      : ['Votre matrice du jour', 'La matrice qui vous ressemble', 'Édition personnalisée']
    : normalizedCountry === "Côte d'Ivoire"
      ? [`Spécial ${normalizedCountry}`, 'Sélection ivoirienne', 'À garder près de soi']
      : normalizedCountry === 'Bénin'
        ? ['Bonne fête Bénin', 'Sélection béninoise', 'À garder près de soi']
      : normalizedCountry
          ? [`Spécial ${normalizedCountry}`, 'Sélection du pays', 'À garder près de soi']
        : ['Votre sélection de boules rejetées', 'Sélection du jour', 'À garder près de soi'];
  const index = dailyBannerHash(`${kind}:${info.isoDateKey}:${normalizedCountry}`) % variants.length;
  return variants[index];
}

function dailyPublicationVisualMarkup(kind, info) {
  const fallback = kind === 'matrix'
    ? '#2f73c5'
    : kind === 'cross'
      ? '#800020'
      : '#159b1b';
  const officialDayColor = safeDailyColor(
    window.getOfficialPublicationColor?.(info.programmeDate)
      || OFFICIAL_CROSS_DAY_COLORS[info.dayIndex],
    fallback
  );
  // Every publication for a programme date follows the official Croix colour
  // for that date. Never read the current root colour for a historical card.
  const color = officialDayColor;
  const weekday = String(info.weekday || '')
    .charAt(0)
    .toUpperCase() + String(info.weekday || '').slice(1);
  const country = currentFeedCountry();
  const localized = localizedPublicationText(kind, country, info.fullDate);
  const title = `${localized.title} ${weekday}`;
  const context = dailyBannerContext(kind, info, country);
  const ink = dailyBannerInk(color);
  const localizedLabels = {
    fr: {
      matrix: 'Matrice du jour',
      cross: 'Croix nationale du jour',
      rejected: 'Boules rejetées du jour'
    },
    en: {
      matrix: 'Matrix of the day',
      cross: 'National Cross of the day',
      rejected: 'Rejected Balls of the day'
    },
    es: {
      matrix: 'Matriz del día',
      cross: 'Cruz nacional del día',
      rejected: 'Bolas rechazadas del día'
    },
    pt: {
      matrix: 'Matriz do dia',
      cross: 'Cruz nacional do dia',
      rejected: 'Bolas rejeitadas do dia'
    },
    ar: {
      matrix: 'مصفوفة اليوم',
      cross: 'الصليب الوطني لليوم',
      rejected: 'الكرات المرفوضة لليوم'
    }
  };
  const labels = localizedLabels[baseUiLocale()] || localizedLabels.fr;
  const label = labels[kind];
  const actionLabel = kind === 'cross'
    ? (baseUiLocale() === 'en' ? 'Official national publication'
      : baseUiLocale() === 'es' ? 'Publicación nacional oficial'
        : baseUiLocale() === 'pt' ? 'Publicação nacional oficial'
          : baseUiLocale() === 'ar' ? 'المنشور الوطني الرسمي'
            : 'Publication nationale officielle')
    : localized.copy;

  return `
    <div
      class="daily-publication-visual cid-fb-daily-publication-visual"
      data-daily-publication-kind="${escapeHtml(kind)}"
      style="--daily-publication-color:${escapeHtml(color)};--daily-publication-ink:${ink}"
      role="img"
      aria-label="${escapeHtml(`${title} — ${context} — ${info.fullDate}`)}"
    >
      <div class="daily-banner-copy">
        <span class="daily-banner-brand"><span class="daily-banner-brand-mark">✦</span> CIDMAP</span>
        <span class="cid-fb-daily-publication-eyebrow">${isEnglishUi() ? 'Program of the day' : 'Programme du jour'}</span>
        <strong>${escapeHtml(title)}</strong>
        <span class="daily-banner-context">${escapeHtml(context)}</span>
        <small>${escapeHtml(info.fullDate)} · ${escapeHtml(label)}</small>
        <span class="daily-banner-contact"><span aria-hidden="true">◌</span> ${escapeHtml(actionLabel)}</span>
      </div>
    </div>
  `;
}

function dailyPublicationMedia(kind, info) {
  const illustration = window.cidDailyIllustrations?.getIllustration?.(
    kind,
    info?.programmeDate
  );
  if (illustration?.src) {
    return `
      <div class="cid-fb-media cid-fb-image-media cid-fb-configured-publication-media">
        <img
          class="cid-fb-media-image"
          src="${escapeHtml(illustration.src)}"
          alt="${escapeHtml(`${illustration.label} — ${info?.fullDate || ''}`)}"
          loading="eager"
          decoding="async">
      </div>`;
  }
  return `
    <div class="cid-fb-media cid-fb-daily-publication-media">
      ${dailyPublicationVisualMarkup(kind, info)}
    </div>
  `;
}

function updateDailyPublicationVisual(visual, kind, info, country = currentFeedCountry()) {
  if (!visual || !info) return;
  const fallback = kind === 'matrix'
    ? '#2f73c5'
    : kind === 'cross'
      ? '#800020'
      : '#159b1b';
  const color = safeDailyColor(
    window.getOfficialPublicationColor?.(info.programmeDate)
      || OFFICIAL_CROSS_DAY_COLORS[info.dayIndex],
    fallback
  );
  const weekday = String(info.weekday || '')
    .charAt(0).toUpperCase() + String(info.weekday || '').slice(1);
  const localized = localizedPublicationText(kind, country, info.fullDate);
  const title = `${localized.title} ${weekday}`;
  const context = dailyBannerContext(kind, info, country);
  const labels = {
    fr: {
      matrix: 'Matrice du jour',
      cross: 'Croix nationale du jour',
      rejected: 'Boules rejetées du jour'
    },
    en: {
      matrix: 'Matrix of the day',
      cross: 'National Cross of the day',
      rejected: 'Rejected Balls of the day'
    },
    es: {
      matrix: 'Matriz del día',
      cross: 'Cruz nacional del día',
      rejected: 'Bolas rechazadas del día'
    },
    pt: {
      matrix: 'Matriz do dia',
      cross: 'Cruz nacional do dia',
      rejected: 'Bolas rejeitadas do dia'
    },
    ar: {
      matrix: 'مصفوفة اليوم',
      cross: 'الصليب الوطني لليوم',
      rejected: 'الكرات المرفوضة لليوم'
    }
  }[baseUiLocale()] || {
    matrix: 'Matrice du jour',
    cross: 'Croix nationale du jour',
    rejected: 'Boules rejetées du jour'
  };
  const label = labels[kind];
  const actionLabel = kind === 'cross'
    ? (baseUiLocale() === 'en' ? 'Official national publication'
      : baseUiLocale() === 'es' ? 'Publicación nacional oficial'
        : baseUiLocale() === 'pt' ? 'Publicação nacional oficial'
          : baseUiLocale() === 'ar' ? 'المنشور الوطني الرسمي'
            : 'Publication nationale officielle')
    : localized.copy;
  const copy = $('.daily-banner-copy', visual);
  const children = copy ? {
    eyebrow: $('.cid-fb-daily-publication-eyebrow', copy),
    title: $('strong', copy),
    context: $('.daily-banner-context', copy),
    date: $('small', copy),
    contact: $('.daily-banner-contact', copy)
  } : {};

  visual.dataset.dailyPublicationDate = info.isoDateKey;
  visual.style.setProperty('--daily-publication-color', color);
  visual.style.setProperty('--daily-publication-ink', dailyBannerInk(color));
  visual.setAttribute(
    'aria-label',
    `${title} — ${context} — ${info.fullDate}`
  );
  if (children.eyebrow) children.eyebrow.textContent = isEnglishUi()
    ? 'Program of the day'
    : 'Programme du jour';
  if (children.title) children.title.textContent = title;
  if (children.context) children.context.textContent = context;
  if (children.date) children.date.textContent = `${info.fullDate} · ${label}`;
  if (children.contact) {
    children.contact.textContent = `◌ ${actionLabel}`;
  }
}

function historyCrossRecord(slot) {
  let assignment = [];
  try {
    assignment = JSON.parse(slot?.dataset.historyCrossAssignment || '[]')
      .map(String)
      .slice(0, 8);
  } catch (_) {}
  return {
    assignment,
    term: String(slot?.dataset.historyCrossTerm || ''),
    terminaison: String(slot?.dataset.historyCrossTermination || '')
  };
}

function historyCrossColor(info) {
  return safeDailyColor(
    window.getOfficialPublicationColor?.(info?.programmeDate)
      || crossDayStyleForDate(info?.programmeDate).color,
    '#800020'
  );
}

function resetHistoryCrossInlineStyles(root) {
  if (!root) return;
  root.style.removeProperty('background');
  root.style.removeProperty('background-color');
  root.style.removeProperty('--redCross-bg');
  root.querySelectorAll([
    '.cross-numbers .num',
    '#redCrossDate',
    '.term-title',
    '.term-paren',
    '.right-label',
    '.redCrossFooter',
    '.sunday-button',
    '.black-square-btn',
    'svg .cross-line',
    '.black-square-btn svg circle',
    '.black-square-btn svg text',
    '.black-square-btn svg textPath'
  ].join(',')).forEach((element) => {
    [
      'color',
      '-webkit-text-fill-color',
      '-webkit-text-stroke',
      '-webkit-text-stroke-color',
      'text-stroke',
      'text-shadow',
      'background',
      'background-color',
      'border',
      'border-color',
      'fill',
      'stroke'
    ].forEach((property) => element.style.removeProperty(property));
  });
}

/*
 * Historical Croix cards are permanent visual duplicates of the canonical
 * Croix component. Only their published values and weekday palette change.
 * This is intentionally called after the initial pool is mounted and on
 * rotation; it never creates or replaces a historical DOM subtree.
 */
function paintHomeHistoryCross(slot, info, record = historyCrossRecord(slot)) {
  const clone = $('.cid-fb-home-history-cross', slot);
  if (!clone || !info) return;
  const color = historyCrossColor(info);
  const dayStyle = crossDayStyleForDate(info.programmeDate);
  const foreground = dayStyle.ink;
  const assignment = Array.isArray(record?.assignment)
    ? record.assignment.map(String).slice(0, 8)
    : [];

  /*
   * Daily illustrations belong to the live publication only. Historical
   * cards are the official coordinate-plane clone; an image overlay on a
   * clone would sit above the digits and make them appear to disappear when
   * the illustration catalogue refreshes.
   */
  clone.querySelector('.daily-cross-illustration')?.remove();
  clone.classList.remove('has-daily-cross-illustration');
  resetHistoryCrossInlineStyles(clone);
  window.cidCrossDayStyles?.apply?.(clone, info.programmeDate);
  clone.dataset.crossDay = String(dayStyle.day);
  clone.dataset.crossDayKey = dayStyle.key;
  clone.dataset.crossDayLabel = dayStyle.label;
  clone.dataset.crossInk = foreground === '#000000' ? 'dark' : 'light';
  clone.dataset.crossReady = 'true';
  slot.dataset.historyCrossSnapshotDate = info.isoDateKey;
  clone.style.setProperty('--cid-cross-color', color, 'important');
  clone.style.setProperty('--cid-cross-ink', foreground, 'important');
  clone.style.setProperty('--redCross-bg', color, 'important');
  clone.style.setProperty('background', color, 'important');
  clone.setAttribute('aria-label', `Croix nationale du ${info.fullDate}`);

  clone.querySelectorAll('.cross-numbers .num').forEach((number, index) => {
    number.textContent = assignment[index] || '0';
  });
  const dateElement = clone.querySelector('#redCrossDate');
  if (dateElement) dateElement.textContent = info.fullDate;
  const termTitle = clone.querySelector('.term-title');
  if (termTitle) termTitle.textContent = `Terminaison ${record?.terminaison || '0'}`;
  const termValue = clone.querySelector('.term-paren');
  if (termValue) termValue.textContent = record?.term || '0';

  clone.querySelectorAll([
    '.cross-numbers .num',
    '#redCrossDate',
    '.term-title',
    '.term-paren',
    '.right-label',
    '.redCrossFooter'
  ].join(',')).forEach((element) => {
    const isDigit = element.matches('.cross-numbers .num');
    element.style.setProperty('color', foreground, 'important');
    element.style.setProperty('-webkit-text-fill-color', foreground, 'important');
    element.style.setProperty(
      '-webkit-text-stroke',
      isDigit ? `1.45px ${foreground}` : '0',
      'important'
    );
    element.style.setProperty(
      'text-stroke',
      isDigit ? `1.45px ${foreground}` : '0',
      'important'
    );
    element.style.setProperty(
      'text-shadow',
      isDigit
        ? `.45px 0 ${foreground}, -.45px 0 ${foreground}, 0 .45px ${foreground}, 0 -.45px ${foreground}`
        : 'none',
      'important'
    );
  });
  clone.querySelectorAll('svg .cross-line').forEach((line) => {
    line.style.setProperty('stroke', foreground, 'important');
  });
  clone.querySelectorAll('.sunday-button').forEach((button) => {
    button.style.setProperty('background', color, 'important');
    button.style.setProperty('color', foreground, 'important');
    button.style.setProperty('-webkit-text-fill-color', foreground, 'important');
    button.style.setProperty('border-color', foreground, 'important');
  });
  clone.querySelectorAll('.black-square-btn').forEach((button) => {
    button.style.setProperty('background', '#ffffff', 'important');
    button.style.setProperty('color', color, 'important');
    button.style.setProperty('border-color', 'rgba(0,0,0,0.06)', 'important');
    button.querySelectorAll('svg circle').forEach((circle) => {
      circle.style.setProperty('fill', color, 'important');
      circle.style.setProperty('stroke', color, 'important');
    });
    button.querySelectorAll('svg textPath').forEach((textPath) => {
      textPath.style.setProperty('fill', color, 'important');
    });
    button.querySelectorAll('svg text').forEach((text) => {
      text.style.setProperty(
        'fill',
        String(text.textContent || '').trim() === '5/90' ? foreground : color,
        'important'
      );
    });
  });
}

function mountHomeCrossHistoryPool(feed) {
  if (!feed) return;
  const source = canonicalCrossSource();
  if (!source) {
    scheduleHistoryCrossPoolRetry(feed);
    return;
  }
  feed.querySelectorAll('.cid-fb-cross-slot').forEach((slot) => {
    const visual = $('.cid-fb-cross-history-visual', slot);
    if (!visual || visual.querySelector('.cid-fb-home-history-cross')) return;
    const clone = source.cloneNode(true);
    clone.id = 'redCross';
    clone.classList.add('cid-fb-home-history-cross');
    clone.dataset.cidHistoryClone = 'true';
    clone.dataset.crossReady = 'true';
    clone.setAttribute('aria-hidden', 'true');
    clone.style.display = 'flex';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0 auto';
    clone.querySelector('#crossDatePicker')?.remove();
    clone.querySelector('#openCrossDateBtn')?.remove();
    clone.querySelector('#redCrossCopyImageBtn')?.remove();
    clone.querySelectorAll('button').forEach((button) => {
      button.tabIndex = -1;
      button.setAttribute('aria-hidden', 'true');
    });
    visual.appendChild(clone);
    observeHistoryCrossGeometry(clone);
    const date = String(slot.closest('.cid-fb-post')?.dataset.programmeDate || '');
    const info = date
      ? programmeInfoForDate(new Date(`${date}T12:00:00.000Z`))
      : dateInfo();
    paintHomeHistoryCross(slot, info);
  });
  if (!feed.querySelector(
    '.cid-fb-cross-history-visual:not(:has(.cid-fb-home-history-cross))'
  )) {
    clearHistoryCrossPoolWatcher(feed);
  }
}

function refreshHomeCrossHistoryImages(feed) {
  if (!feed) return;
  feed.querySelectorAll('.cid-fb-post[data-post-type="cross"]').forEach((post) => {
    const slot = $('.cid-fb-cross-slot', post);
    const date = String(post.dataset.programmeDate || '').slice(0, 10);
    if (!slot || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    paintHomeHistoryCross(
      slot,
      programmeInfoForDate(new Date(`${date}T12:00:00.000Z`)),
      historyCrossRecord(slot)
    );
  });
}

function restoreHomeHistoryCrossIds(feed) {
  feed?.querySelectorAll('.cid-fb-home-history-cross').forEach((clone) => {
    clone.id = 'redCross';
  });
}

const HISTORY_CROSS_REFERENCE_SIZE = 380;
const historyCrossGeometryObservers = new WeakSet();
const historyCrossPoolWatchers = new WeakMap();

/*
 * The canonical Croix moves between Accueil and the dedicated route while
 * the historical cards are being painted. A document-wide getElementById()
 * can then resolve a clone (or nothing at all). Resolve only the real source
 * and retry the pool when the source is moved in later.
 */
function canonicalCrossSource() {
  return Array.from(document.querySelectorAll('#redCross')).find((element) => (
    element.dataset.cidHistoryClone !== 'true'
      && !element.classList.contains('cid-fb-home-history-cross')
      && !element.classList.contains('cid-croix-history-component')
  )) || null;
}

function clearHistoryCrossPoolWatcher(feed) {
  const watcher = historyCrossPoolWatchers.get(feed);
  if (!watcher) return;
  watcher.observer?.disconnect();
  if (watcher.timer) window.clearTimeout(watcher.timer);
  historyCrossPoolWatchers.delete(feed);
}

function scheduleHistoryCrossPoolRetry(feed) {
  if (!feed || !feed.isConnected || historyCrossPoolWatchers.has(feed)) return;
  const watcher = { observer: null, timer: 0 };
  const retry = () => {
    if (!feed.isConnected) {
      clearHistoryCrossPoolWatcher(feed);
      return;
    }
    mountHomeCrossHistoryPool(feed);
    const waiting = feed.querySelector(
      '.cid-fb-cross-history-visual:not(:has(.cid-fb-home-history-cross))'
    );
    if (!waiting) {
      clearHistoryCrossPoolWatcher(feed);
      return;
    }
    watcher.timer = window.setTimeout(retry, 250);
  };
  if ('MutationObserver' in window) {
    watcher.observer = new MutationObserver(() => {
      if (canonicalCrossSource()) retry();
    });
    watcher.observer.observe(document.body, { childList: true, subtree: true });
  }
  historyCrossPoolWatchers.set(feed, watcher);
  watcher.timer = window.setTimeout(retry, 0);
}

function syncHistoryCrossGeometry(root) {
  if (!root) return;
  const width = root.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) return;

  const size = `${Math.round(width * 100) / 100}px`;
  const scale = Math.min(1, width / HISTORY_CROSS_REFERENCE_SIZE);
  root.style.setProperty('--cross-scale', String(scale), 'important');
  root.style.setProperty('height', size, 'important');
  root.style.setProperty('min-height', size, 'important');
  root.style.setProperty('max-height', size, 'important');
  root.style.setProperty('aspect-ratio', '1 / 1', 'important');
  /*
   * The live Croix may carry a persisted pixel font-size. It is correct for
   * the reference publication, but copying it into a smaller archive card
   * makes the glyphs grow into the diagonal strokes. Historical copies use
   * the canonical scale rule instead, so their whole coordinate plane shrinks
   * proportionally without changing any percentage position.
   */
  root.querySelectorAll('.cross-numbers .num').forEach((number) => {
    number.style.removeProperty('font-size');
    const transform = number.style.getPropertyValue('transform');
    if (transform && transform.includes('px')
        && !transform.includes('--cross-scale')) {
      number.style.setProperty(
        'transform',
        transform.replace(
          /(-?\d+(?:\.\d+)?)px/g,
          'calc($1px * var(--cross-scale, 1))'
        ),
        'important'
      );
    }
  });

  const svg = root.querySelector(':scope > svg');
  if (svg) {
    svg.style.setProperty('width', '100%', 'important');
    svg.style.setProperty('height', '100%', 'important');
    svg.style.setProperty('max-width', 'none', 'important');
    svg.style.setProperty('max-height', 'none', 'important');
    svg.style.setProperty('aspect-ratio', '1 / 1', 'important');
  }
}

function observeHistoryCrossGeometry(root) {
  if (!root) return;
  syncHistoryCrossGeometry(root);
  if (historyCrossGeometryObservers.has(root)) return;
  historyCrossGeometryObservers.add(root);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => syncHistoryCrossGeometry(root));
    observer.observe(root);
  } else {
    window.addEventListener('resize', () => syncHistoryCrossGeometry(root), { passive: true });
    window.addEventListener('orientationchange', () => syncHistoryCrossGeometry(root), { passive: true });
  }
}

function snapshotLiveCrossIntoHistory(slot, source, info) {
  if (!slot || !source || !info) return;
  const assignment = Array.from(source.querySelectorAll('.cross-numbers .num'))
    .slice(0, 8)
    .map((number) => String(number.textContent || '').trim());
  const term = String(source.querySelector('.term-paren')?.textContent || '');
  const terminaison = String(source.querySelector('.term-title')?.textContent || '')
    .match(/\d+/)?.[0] || '';
  slot.dataset.historyCrossDate = info.isoDateKey;
  slot.dataset.historyCrossAssignment = JSON.stringify(assignment);
  slot.dataset.historyCrossTerm = term;
  slot.dataset.historyCrossTermination = terminaison;
  slot.dataset.historyCrossSnapshotDate = info.isoDateKey;
  paintHomeHistoryCross(slot, info, {
    assignment,
    term,
    terminaison
  });
}

function updateCrossCard(post, info, country, isCurrent) {
  const slot = $('.cid-fb-cross-slot', post);
  if (!slot) return;
  slot.dataset.historyCrossDate = info.isoDateKey;
  slot.classList.toggle('is-current-cross', Boolean(isCurrent));
  $('.cid-fb-cross-history-visual', slot)?.classList.toggle('is-hidden', Boolean(isCurrent));
  const liveHost = $('.cid-fb-cross-live-host', slot);
  if (liveHost) liveHost.setAttribute('aria-busy', isCurrent ? 'true' : 'false');
  /*
   * The live card is the new publication. Its hidden duplicate is refreshed
   * only when the official payload arrives. A historical card whose date did
   * not change is never repainted, so its published image stays pixel-stable.
   */
  if (isCurrent) return;
  if (slot.dataset.historyCrossSnapshotDate !== info.isoDateKey) {
    slot.dataset.historyCrossSnapshotDate = info.isoDateKey;
    paintHomeHistoryCross(slot, info);
  }
}

function updatePostInPlace(post, publication, {
  index,
  historical,
  historyDay,
  historyStart,
  country
} = {}) {
  if (!post || !publication) return;
  const publishedAt = publicationTimestamp(publication.info?.programmeDate);
  const publishedAtIso = publishedAt?.toISOString() || '';
  post.id = `cid-post-${publication.postId}`;
  post.dataset.feedOrder = String(index + 1);
  post.dataset.historyDay = String(historyDay);
  post.dataset.programmeDate = publication.info?.isoDateKey || '';
  post.dataset.postType = publication.type;
  post.dataset.postId = publication.postId;
  post.dataset.country = publication.country || '';
  post.classList.toggle('is-pinned', !historical);
  post.classList.toggle('is-historical', Boolean(historical));
  post.classList.toggle('is-history-start', Boolean(historyStart));

  const copy = $('.cid-fb-post-copy p strong', post);
  if (copy) copy.textContent = publication.copy;
  const more = $('.cid-fb-more-button', post);
  if (more) {
    more.dataset.feedAction = publication.action || '';
    more.textContent = publicationMoreLabel(historical);
    more.setAttribute(
      'aria-label',
      publicationMoreLabel(historical)
    );
  }
  const time = $('.cid-fb-relative-time', post);
  if (time) {
    time.dataset.publishedAt = publishedAtIso;
    time.textContent = publicationAge(publishedAt);
  }
  const timeWrap = $('.cid-fb-time', post);
  if (timeWrap) timeWrap.title = publicationDateLabel(publishedAt);
  const flag = $('.cid-fb-country-flag', post);
  if (flag) {
    flag.textContent = countryFlag(country);
    flag.setAttribute('aria-label', `Pays sélectionné : ${countryFlagLabel(country)}`);
  }

  if (publication.type === 'cross') {
    updateCrossCard(post, publication.info, country, !historical);
  } else {
    const visual = $('.cid-fb-daily-publication-visual', post);
    updateDailyPublicationVisual(visual, publication.type, publication.info, country);
  }
  post.__cidComments = null;
  post.__cidCommentAuthors = null;
  post.__cidCommentMetrics = null;
  const commentsEnabled = typeof window.cidContentControl?.commentsEnabled === 'function'
    ? window.cidContentControl.commentsEnabled(publication.postId, publication.type)
    : false;
  applyCommentsVisibility(post, commentsEnabled);
}

function currentProfileName(userId = '') {
  const profile = window.cidAuth?.getCurrentProfile?.();
  return profile?.uid && profile.uid === userId ? String(profile.name || '').trim() : '';
}

function commentAuthorName(comment, currentUserId = '', authors = new Map()) {
  const publicProfile = authors.get(String(comment.user_id || ''));
  if (isOfficialCommentAuthor(publicProfile)) return 'Cidmap';
  if (comment.user_id && comment.user_id === currentUserId) {
    return currentProfileName(currentUserId) || 'Vous';
  }
  return publicProfile?.full_name || 'Membre Cidmap';
}

function commentTimeLabel(createdAt) {
  const timestamp = new Date(createdAt || '').getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'à l’instant';
  if (diff < hour) return `${Math.floor(diff / minute)} min`;
  if (diff < day) return `${Math.floor(diff / hour)} h`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} j`;
  return `${Math.floor(diff / (30 * day))} mois`;
}

function isOfficialCommentAuthor(profile) {
  const name = String(profile?.full_name || '').trim().toLocaleLowerCase('fr-FR');
  return Boolean(
    profile?.is_official
    || /^(cidmap(?:\.com)?|équipe cidmap|administration cidmap)$/.test(name)
  );
}

function commentAvatarMarkup(comment, authorName, authors) {
  const profile = authors.get(String(comment.user_id || ''));
  if (isOfficialCommentAuthor(profile)) {
    return `<img class="cid-comment-sheet-avatar-image" data-cid-brand-avatar src="${brandAvatar()}" alt="">`;
  }
  const initial = escapeHtml(authorName.charAt(0).toUpperCase() || 'M');
  return `<span class="cid-comment-sheet-avatar-initial">${initial}</span>`;
}

function verifiedBadgeMarkup() {
  return `
    <svg class="cid-comment-verified" viewBox="0 0 24 24" aria-label="Compte vérifié" role="img">
      <path d="M12 1.5 14.1 3l2.5-.4 1.1 2.3 2.3 1.1-.4 2.5 1.5 2.1-1.5 2.1.4 2.5-2.3 1.1-1.1 2.3-2.5-.4-2.1 1.5-2.1-1.5-2.5.4-1.1-2.3-2.3-1.1.4-2.5L1.5 12l1.5-2.1-.4-2.5 2.3-1.1L6 4.6l2.5.4L12 1.5Z" fill="#1877f2"/>
      <path d="m7.2 12.2 3 3 6.5-6.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function commentReactionIcon(type) {
  return type === 'like'
    ? '<path d="M7.5 10.5v10h-3A1.5 1.5 0 0 1 3 19v-7a1.5 1.5 0 0 1 1.5-1.5h3Zm2 10v-10l3.2-6.3a1.8 1.8 0 0 1 3.3.8v4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.8a2.7 2.7 0 0 1-2.6 2.1H9.5Z"/>'
    : '<path d="M16.5 13.5v-10h3A1.5 1.5 0 0 1 21 5v7a1.5 1.5 0 0 1-1.5 1.5h-3Zm-2-10v10l-3.2 6.3a1.8 1.8 0 0 1-3.3-.8v-4H3.9A2 2 0 0 1 2 12.4l1.8-6.8A2.7 2.7 0 0 1 6.4 3.5h8.1Z"/>';
}

function commentMarkup(
  comments,
  currentUserId = '',
  authors = new Map(),
  expandedIds = new Set(),
  reactions = new Map(),
  commentMetrics = new Map()
) {
  const children = new Map();
  const knownIds = new Set(comments.map((comment) => comment.id));
  comments.forEach((comment) => {
    // A hidden/deleted parent may be filtered by RLS while its visible reply
    // remains readable. In that case keep the reply visible as a root item.
    const parent = comment.parent_id && knownIds.has(comment.parent_id)
      ? comment.parent_id
      : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(comment);
  });

  const renderBranch = (parentId = null, depth = 0) => (children.get(parentId) || [])
    .map((comment) => {
      const publicProfile = authors.get(String(comment.user_id || ''));
      const authorName = commentAuthorName(comment, currentUserId, authors);
      const official = isOfficialCommentAuthor(publicProfile);
      const replies = children.get(comment.id) || [];
      const expanded = expandedIds.has(comment.id);
      const reaction = reactions.get(comment.id) || '';
      const metric = commentMetrics.get(comment.id) || { likes: 0, liked: false };
      const status = String(comment.status || 'visible');
      const statusLabel = !['visible', 'approved'].includes(status)
        ? `<span class="cid-fb-comment-status">${escapeHtml(status)}</span>`
        : '';
      return `
        <article class="cid-comment-sheet-item" data-comment-id="${escapeHtml(comment.id)}"
             data-comment-parent="${escapeHtml(comment.parent_id || '')}"
             data-comment-status="${escapeHtml(status)}"
             style="--cid-comment-depth:${Math.min(depth, 5)}">
          <div class="cid-comment-sheet-avatar" aria-hidden="true">
            ${commentAvatarMarkup(comment, authorName, authors)}
          </div>
          <div class="cid-comment-sheet-content">
            <div class="cid-comment-sheet-author-row">
              ${comment.user_id ? `
            <button type="button"
              class="cid-fb-comment-author cid-comment-sheet-author"
              data-comment-author="${escapeHtml(comment.user_id)}"
              aria-label="Voir le profil public de ${escapeHtml(authorName)}">
              ${escapeHtml(authorName)}
            </button>
          ` : `<span class="cid-fb-comment-author cid-comment-sheet-author">${escapeHtml(authorName)}</span>`}
              ${official ? verifiedBadgeMarkup() : ''}
            </div>
            <div class="cid-comment-sheet-bubble">
              ${escapeHtml(comment.comment_text)}
              ${statusLabel}
            </div>
            <div class="cid-comment-sheet-actions">
              <button type="button" class="cid-fb-comment-reply"
                data-comment-reply="${escapeHtml(comment.id)}"
                data-comment-author-name="${escapeHtml(authorName)}"
                data-comment-text="${escapeHtml(comment.comment_text)}">Répondre</button>
              ${replies.length ? `
                <button type="button" class="cid-comment-replies-toggle" data-comment-replies="${escapeHtml(comment.id)}" aria-expanded="${expanded}">
                  ${expanded ? '∧ Masquer les réponses' : `∨ Voir ${replies.length} réponse${replies.length === 1 ? '' : 's'}`}
                </button>
              ` : ''}
              ${commentTimeLabel(comment.created_at) ? `<span class="cid-comment-time">· ${commentTimeLabel(comment.created_at)}</span>` : ''}
              <span class="cid-comment-reaction-group" aria-label="Réactions">
                <button type="button" class="cid-comment-reaction${metric.liked ? ' is-active' : ''}" data-comment-like="${escapeHtml(comment.id)}" aria-label="J’aime" aria-pressed="${metric.liked}">
                  <svg viewBox="0 0 24 24" aria-hidden="true">${commentReactionIcon('like')}</svg>
                </button>
                ${metric.likes > 0 ? `<span class="cid-comment-like-badge"><span aria-hidden="true">👍</span> ${metric.likes}</span>` : ''}
                <button type="button" class="cid-comment-reaction${reaction === 'dislike' ? ' is-active is-dislike' : ''}" data-comment-reaction="dislike" data-comment-reaction-id="${escapeHtml(comment.id)}" aria-label="Je n’aime pas" aria-pressed="${reaction === 'dislike'}">
                  <svg viewBox="0 0 24 24" aria-hidden="true">${commentReactionIcon('dislike')}</svg>
                </button>
              </span>
            </div>
            ${expanded ? `<div class="cid-comment-sheet-replies">${renderBranch(comment.id, depth + 1)}</div>` : ''}
          </div>
        </article>
      `;
    }).join('');

  return renderBranch();
}

function postMarkup({
  type,
  info,
  title,
  country = '',
  copy,
  media,
  likes,
  shares,
  comments,
  action,
  postId,
  order = 0,
  pinned = false,
  historical = false,
  historyDay = 0,
  historyStart = false,
  socialEnabled = true,
  shareEnabled = true,
  commentsEnabled = false
}) {
  commentsEnabled = COMMENTS_ENABLED && commentsEnabled === true;
  const commentsCount = comments.length;
  const publishedAt = publicationTimestamp(info?.programmeDate);
  const publishedAtIso = publishedAt?.toISOString() || '';
  return `
    <article id="cid-post-${escapeHtml(postId)}" class="cid-fb-post${pinned ? ' is-pinned' : ''}${historical ? ' is-historical' : ''}${historyStart ? ' is-history-start' : ''}${commentsEnabled ? '' : ' is-comments-off'}" data-feed-order="${order}" data-history-day="${historyDay}" data-programme-date="${escapeHtml(info?.isoDateKey || '')}" data-post-type="${escapeHtml(type)}" data-post-id="${escapeHtml(postId)}" data-country="${escapeHtml(country)}" data-social-enabled="${socialEnabled ? 'true' : 'false'}" data-comments-open="false" data-share-open="false" data-comments-enabled="${commentsEnabled ? 'true' : 'false'}">
      <header class="cid-fb-post-header">
        <div class="cid-fb-avatar">
          <img data-cid-brand-avatar src="${brandAvatar()}" alt="Photo de profil ${PAGE_NAME}">
        </div>
        <div class="cid-fb-author">
          <div class="cid-fb-author-line">
            <span class="cid-fb-page-name">${PAGE_NAME}</span>
            <svg class="cid-fb-verified" viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="Page vérifiée" focusable="false">
              <title>Page vérifiée</title>
              <g transform="translate(12 12) scale(1.65) translate(-17 -12.5)">
                <path d="M22.5 12.5c0-.8-.5-1.5-1.1-1.9.3-.8.2-1.8-.4-2.4-.6-.6-1.6-.7-2.4-.4-.4-.6-1.1-1.1-1.9-1.1s-1.5.5-1.9 1.1c-.8-.3-1.8-.2-2.4.4-.6.6-.7 1.6-.4 2.4-.6.4-1.1 1.1-1.1 1.9s.5 1.5 1.1 1.9c-.3.8-.2 1.8.4 2.4.6.6 1.6.7 2.4.4.4.6 1.1 1.1 1.9 1.1s1.5-.5 1.9-1.1c.8.3 1.8.2 2.4-.4.6-.6.7-1.6.4-2.4.6-.4 1.1-1.1 1.1-1.9z" fill="#1877F2"/>
              </g>
              <path d="M7.4 12.1l3.2 3.2 6.1-6.1" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cid-fb-time" title="${escapeHtml(publicationDateLabel(publishedAt))}">
            <span class="cid-fb-relative-time" data-published-at="${escapeHtml(publishedAtIso)}">${publicationAge(publishedAt)}</span>
            · <span class="cid-fb-country-flag" role="img" aria-label="Pays sélectionné : ${escapeHtml(countryFlagLabel(country))}">${countryFlag(country)}</span>
          </div>
        </div>
      </header>
      <div class="cid-fb-post-copy">
        <p><strong>${escapeHtml(copy)}</strong></p>
        ${action ? `
          <button type="button" class="cid-fb-more-button" data-feed-action="${escapeHtml(action)}" aria-label="${escapeHtml(publicationMoreLabel(historical))}">
            ${escapeHtml(publicationMoreLabel(historical))}
          </button>
        ` : ''}
      </div>
      ${media}
      ${socialEnabled ? `
      <div class="cid-fb-summary">
        <span class="cid-fb-reactions">
          <span class="cid-fb-reaction-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7.5 10.5v10h-3a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5h3Zm2 10v-10l3.2-6.3a1.8 1.8 0 0 1 3.3.8v4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.8a2.7 2.7 0 0 1-2.6 2.1H9.5Z"/>
            </svg>
          </span>
          <span class="cid-fb-like-count">${likes}</span>
        </span>
          <span class="cid-fb-summary-meta">
          ${commentsEnabled ? `
          <button type="button" class="cid-fb-comments-summary" aria-controls="cid-comments-sheet-root" aria-label="Voir ${commentsCount} commentaire${commentsCount === 1 ? '' : 's'}">
            <span class="cid-fb-comment-count">${commentsCount}</span>
            <span class="cid-fb-comment-label">commentaire${commentsCount === 1 ? '' : 's'}</span>
          </button>
          <span data-comments-separator aria-hidden="true">·</span>` : ''}
          ${shareEnabled ? `<span><span class="cid-fb-share-count">${shares}</span> partages</span>` : ''}
        </span>
      </div>
      ${shareEnabled ? `<div class="cid-fb-share-panel">
        <p class="cid-fb-share-title">Partager cette publication</p>
        <div class="cid-fb-share-options">
          <button type="button" class="cid-fb-share-option" data-share-method="profile">Sur mon profil</button>
          <button type="button" class="cid-fb-share-option" data-share-method="message">Par message</button>
          <button type="button" class="cid-fb-share-option" data-share-method="copy">Copier le lien</button>
        </div>
      </div>` : ''}
      <div class="cid-fb-status" role="status" aria-live="polite"></div>
      <footer class="cid-fb-actions">
        <button type="button" class="cid-fb-action cid-fb-like" aria-label="J’aime" aria-pressed="false">
          <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M7.5 10.5v10h-3a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5h3Zm2 10v-10l3.2-6.3a1.8 1.8 0 0 1 3.3.8v4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.8a2.7 2.7 0 0 1-2.6 2.1H9.5Z"/>
          </svg>
          <span class="cid-fb-action-label">J’aime</span>
          <span class="cid-fb-action-count cid-fb-like-action-count">${likes}</span>
        </button>
        ${commentsEnabled ? `
        <button type="button" class="cid-fb-action cid-fb-comment-toggle" aria-controls="cid-comments-sheet-root">
          <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M20.5 11.5a8 8 0 0 1-8 8H8l-4.5 2 1.3-3.9a8 8 0 1 1 15.7-6.1ZM8 11.5h.01M12 11.5h.01M16 11.5h.01"/>
          </svg>
          <span>Commenter</span>
        </button>` : ''}
        ${shareEnabled ? `<button type="button" class="cid-fb-action cid-fb-share-toggle">
          <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m14 5 6 7-6 7v-4.2C8.5 14.8 5 17 3 20c.5-5.7 3.3-9.3 11-10.8V5Z"/>
          </svg>
          <span class="cid-fb-action-label">Partager</span>
          <span class="cid-fb-action-count cid-fb-share-action-count">${shares}</span>
        </button>` : ''}
      </footer>
      ` : ''}
    </article>
  `;
}

function historicalCrossPostMarkup(row, historyDay = 0) {
  const programmeDate = new Date(`${String(row?.programme_date || '').slice(0, 10)}T12:00:00.000Z`);
  const info = programmeInfoForDate(programmeDate);
  const country = currentFeedCountry();
  const copy = localizedPublicationText('cross', country, info.fullDate).copy;
  const postId = publicationId('cross', info);
  const commentsEnabled = typeof window.cidContentControl?.commentsEnabled === 'function'
    ? window.cidContentControl.commentsEnabled(postId, 'cross')
    : false;
  return postMarkup({
    type: 'cross',
    info,
    title: 'Croix nationale',
    country: country === 'Tous' ? '' : country,
    copy,
    media: crossMedia(info),
    likes: 0,
    shares: 0,
    comments: [],
    action: 'croix',
    postId,
    order: historyDay + 1,
    historical: true,
    historyDay,
    historyStart: historyDay === 0,
    socialEnabled: true,
    shareEnabled: true,
    commentsEnabled
  });
}

function mountHistoricalCrossPost(post, row) {
  if (!post || !row) return;
  const date = String(row.programme_date || '').slice(0, 10);
  const info = programmeInfoForDate(new Date(`${date}T12:00:00.000Z`));
  const slot = $('.cid-fb-cross-slot', post);
  if (!slot) return;
  slot.dataset.historyCrossDate = date;
  slot.dataset.historyCrossAssignment = JSON.stringify(
    Array.isArray(row.assignment) ? row.assignment.map(String).slice(0, 8) : []
  );
  slot.dataset.historyCrossTerm = String(row.term || '');
  slot.dataset.historyCrossTermination = String(row.visible_terminaison || '');
  mountHomeCrossHistoryPool(post);
  paintHomeHistoryCross(slot, info, {
    assignment: row.assignment,
    term: row.term,
    terminaison: row.visible_terminaison
  });
}

/*
 * A publication override is loaded during hydration, after the first card
 * markup has been painted. Keep the nodes available for a later re-enable,
 * while hiding every comment affordance as soon as the setting is known.
 */
function applyCommentsVisibility(post, enabled) {
  if (!post) return;
  const commentsEnabled = COMMENTS_ENABLED && enabled === true;
  post.dataset.commentsEnabled = String(commentsEnabled);
  post.classList.toggle('is-comments-off', !commentsEnabled);

  const summary = $('.cid-fb-comments-summary', post);
  const separator = $('[data-comments-separator]', post);
  const commentAction = $('.cid-fb-comment-toggle', post);
  if (summary) summary.hidden = !commentsEnabled;
  if (separator) separator.hidden = !commentsEnabled;
  if (commentAction) commentAction.hidden = !commentsEnabled;

  if (!commentsEnabled) {
    post.dataset.commentsOpen = 'false';
    if (commentsSheetState?.post === post) closeCommentsSheet();
  }
}

function publicationsForDate(info, country, { historical = false } = {}) {
  const hasCountry = country !== 'Tous';
  const countryValue = hasCountry ? country : '';
  const crossText = localizedPublicationText('cross', country, info.fullDate);
  const matrixText = localizedPublicationText('matrix', country, info.fullDate);
  const rejectedText = localizedPublicationText('rejected', country, info.fullDate);
  return [
    {
      type: 'cross',
      info,
      title: crossText.title,
      country: countryValue,
      copy: crossText.copy,
      media: crossMedia(info),
      likes: 0,
      shares: 0,
      comments: [],
      postId: publicationId('cross', info),
      action: 'croix',
      pinned: !historical,
      socialEnabled: true,
      shareEnabled: true
    },
    {
      type: 'rejected',
      info,
      title: rejectedText.title,
      country: countryValue,
      copy: rejectedText.copy,
      media: dailyPublicationMedia('rejected', info),
      likes: 0,
      shares: 0,
      comments: [],
      postId: publicationId('rejected', info),
      action: historical ? 'rejected-history' : 'rejected',
      socialEnabled: true,
      shareEnabled: true
    },
    {
      type: 'matrix',
      info,
      title: matrixText.title,
      country: countryValue,
      copy: matrixText.copy,
      media: dailyPublicationMedia('matrix', info),
      likes: 0,
      shares: 0,
      comments: [],
      postId: publicationId('matrix', info),
      action: historical ? 'matrix-history' : 'matrix',
      socialEnabled: true,
      shareEnabled: true
    }
  ];
}

function renderFeed() {
  const info = dateInfo();
  const country = currentFeedCountry();
  const feed = document.createElement('main');
  feed.id = FEED_ID;
  feed.setAttribute('aria-label', 'Fil d’actualité Facebook de Cidmap');

  // Every day uses the same publication cards and the same order. Only the
  // live Croix component belongs to the current day; older days use the
  // matching dated publication visual and remain in the normal feed flow.
  const days = [
    { info, historical: false },
    ...Array.from(
      { length: HOME_HISTORY_DAYS },
      (_, index) => ({
        info: previousProgrammeInfo(info, index + 1),
        historical: true
      })
    )
  ];
  const publications = days.flatMap(({ info: dayInfo, historical }) => (
    publicationsForDate(dayInfo, country, { historical })
  ));

  feed.innerHTML = publications
    .map((publication, index) => {
      const historyDay = Math.floor(index / 3);
      const historical = historyDay > 0;
      const commentsEnabled = publication.socialEnabled !== false
        && typeof window.cidContentControl?.commentsEnabled === 'function'
        ? window.cidContentControl.commentsEnabled(publication.postId, publication.type)
        : false;
      return postMarkup({
        ...publication,
        order: index + 1,
        historical,
        historyDay,
        historyStart: historical && index % 3 === 0,
        commentsEnabled
      });
    })
    .join('');
  feed._cidDayGroups = Array.from({ length: days.length }, (_, dayIndex) => (
    Array.from({ length: 3 }, (_, typeIndex) => (
      feed.children[(dayIndex * 3) + typeIndex]
    ))
  ));
  feed.dataset.selectedCountry = country;
  feed.dataset.historyDays = String(HOME_HISTORY_DAYS);
  feed.dataset.currentDate = info.isoDateKey;
  return feed;
}

function programmeDayDelta(fromIso, toIso) {
  const from = Date.parse(`${String(fromIso || '').slice(0, 10)}T12:00:00Z`);
  const to = Date.parse(`${String(toIso || '').slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000);
}

function rotateFeedDayGroups(feed, delta) {
  const groups = feed?._cidDayGroups;
  if (!Array.isArray(groups) || !groups.length || !delta) return;
  const steps = Math.min(Math.abs(delta), groups.length);
  for (let step = 0; step < steps; step += 1) {
    if (delta > 0) {
      const group = groups.pop();
      groups.unshift(group);
      group.slice().reverse().forEach((post) => feed.prepend(post));
    } else {
      const group = groups.shift();
      groups.push(group);
      group.slice().reverse().forEach((post) => feed.append(post));
    }
  }
}

function syncFeedCards(feed, info, country) {
  const groups = feed?._cidDayGroups;
  if (!Array.isArray(groups) || groups.length === 0) return;
  groups.forEach((group, historyDay) => {
    const dayInfo = historyDay === 0
      ? info
      : previousProgrammeInfo(info, historyDay);
    const publications = publicationsForDate(dayInfo, country, {
      historical: historyDay > 0
    });
    group.forEach((post, typeIndex) => {
      updatePostInPlace(post, publications[typeIndex], {
        index: historyDay * 3 + typeIndex,
        historical: historyDay > 0,
        historyDay,
        historyStart: historyDay > 0 && typeIndex === 0,
        country
      });
    });
  });
  feed.dataset.selectedCountry = country;
  feed.dataset.currentDate = info.isoDateKey;
}

async function refreshRotatedFeedData(feed) {
  if (!feed || document.getElementById(FEED_ID) !== feed) return;
  const posts = $$('.cid-fb-post', feed);
  await Promise.all(posts.map(hydratePost));
  if (document.getElementById(FEED_ID) === feed) {
    hydrateHomeCroixHistory(feed).catch(() => {});
  }
}

function updateFeedInPlace(feed, info, country) {
  const previousDate = feed.dataset.currentDate || info.isoDateKey;
  const delta = programmeDayDelta(previousDate, info.isoDateKey);
  if (delta) rotateFeedDayGroups(feed, delta);
  syncFeedCards(feed, info, country);
  mountCrossInstance(feed);
  updatePublicationAges(feed);
}

function ensureFeedLoader(results) {
  if (!results) return null;
  const existing = results.querySelector('#cid-feed-loader');
  /*
   * Kept as a compatibility lookup for older integrations. The feed itself
   * is usable as soon as its cards are mounted; no global overlay is created
   * while one independent card is still hydrating.
   */
  return existing;
}

function setFeedLoader(results, {
  visible = false,
  mode = 'initial',
  label = 'Chargement des publications…'
} = {}) {
  if (!results) return;
  results.dataset.cidFeedRefreshing = String(visible);
  const loader = ensureFeedLoader(results);
  if (!loader) return;
  loader.dataset.mode = mode;
  loader.hidden = !visible;
  loader.setAttribute('aria-hidden', String(!visible));
  loader.setAttribute('aria-busy', String(visible));
  const labelNode = loader.querySelector('.cid-feed-loader-label');
  if (labelNode) labelNode.textContent = label;
}

async function hydrateHomeCroixHistory(feed) {
  if (!feed) return;
  const posts = Array.from(
    feed.querySelectorAll('.cid-fb-post[data-post-type="cross"]')
  );
  const dates = posts
    .map((post) => String(post.dataset.programmeDate || '').slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const signature = dates.join('|');
  const previous = pendingHomeHistoryHydrations.get(feed);
  if (previous?.signature === signature) return previous.promise;

  /*
   * The live feed can receive several `cid:cross-ready` events while the
   * current Croix is being painted. Share one history request between those
   * events instead of starting the same archive refresh again.
   */
  const promise = (async () => {
    const currentDate = dateInfo().isoDateKey;

    /*
     * The feed already has a complete local/cache-first history source. Do
     * not request each historical date individually here: when an anonymous
     * read is rejected, that fallback used to invoke the protected generator
     * once per day and made the first load painfully slow. Detailed date
     * reads are still performed by the dedicated history views when the
     * visitor asks for them.
     */
    const rowsPromise = listCroixGenerations
      ? Promise.resolve(listCroixGenerations(HOME_HISTORY_DAYS + 1))
        .catch((error) => {
          console.info('Liste historique Croix non disponible dans le fil d’accueil.', error);
          return [];
        })
      : Promise.resolve([]);
    const rows = await rowsPromise;
    if (document.getElementById(FEED_ID) !== feed) return;

    const byDate = new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.programme_date || '')))
        .map((row) => [String(row.programme_date), row])
    );

    posts.forEach((post) => {
      const date = String(post.dataset.programmeDate || '').slice(0, 10);
      const row = byDate.get(date);
      if (!row || date === currentDate) return;
      const slot = $('.cid-fb-cross-slot', post);
      if (!slot) return;
      slot.dataset.historyCrossDate = date;
      slot.dataset.historyCrossAssignment = JSON.stringify(
        Array.isArray(row.assignment) ? row.assignment.map(String).slice(0, 8) : []
      );
      slot.dataset.historyCrossTerm = String(row.term || '');
      slot.dataset.historyCrossTermination = String(row.visible_terminaison || '');
      paintHomeHistoryCross(
        slot,
        programmeInfoForDate(new Date(`${date}T12:00:00.000Z`)),
        {
          assignment: row.assignment,
          term: row.term,
          terminaison: row.visible_terminaison
        }
      );
    });
  })();
  pendingHomeHistoryHydrations.set(feed, { signature, promise });
  return promise;
}

function updatePublicationAges(root = document) {
  $$('.cid-fb-relative-time', root).forEach((element) => {
    const publishedAt = element.dataset.publishedAt;
    element.textContent = publicationAge(publishedAt);
    const time = element.closest('.cid-fb-time');
    if (time) time.title = publicationDateLabel(publishedAt);
  });
}

function setStatus(post, text, duration = 2600) {
  const status = $('.cid-fb-status', post);
  if (!status) return;
  status.textContent = text;
  window.setTimeout(() => {
    if (status.textContent === text) status.textContent = '';
  }, duration);
}

function isSocialAuthError(error) {
  return /connexion requise|connectez-vous|not authenticated|jwt|auth session missing/i
    .test(String(error?.message || error || ''));
}

function showSocialAuthMessage(post, action) {
  setStatus(
    post,
    `Connectez-vous à votre compte Cidmap pour ${action}.`,
    5200
  );
}

async function requireSocialAccount(action) {
  if (typeof window.cidSocialAuthGate?.requireAccount === 'function') {
    return window.cidSocialAuthGate.requireAccount(action);
  }
  const bridge = await Promise.resolve(window.cidSupabaseReady).catch(() => null);
  const user = await Promise.resolve(bridge?.getUser?.()).catch(() => null);
  if (user?.id) return user;
  const open = window.showProfileView || window.openInlineAuthPanel;
  if (typeof open === 'function') await Promise.resolve(open()).catch(() => {});
  return null;
}

function profileInitial(profile) {
  return String(profile?.full_name || 'M').trim().charAt(0).toUpperCase() || 'M';
}

function closePublicProfileDialog() {
  const dialog = document.getElementById('cid-public-profile-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.remove();
}

function renderPublicProfileDialog(profile) {
  if (!profile) return false;
  let dialog = document.getElementById('cid-public-profile-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'cid-public-profile-dialog';
    dialog.className = 'cid-public-profile-dialog';
    document.body.appendChild(dialog);
  }
  const name = profile.full_name || 'Membre Cidmap';
  dialog.innerHTML = `
    <div class="cid-public-profile-card">
      <button type="button" class="cid-public-profile-close" aria-label="Retour">‹</button>
      <div class="cid-public-profile-avatar" aria-hidden="true">${escapeHtml(profileInitial(profile))}</div>
      <span class="cid-public-profile-kicker">Profil public</span>
      <h2>${escapeHtml(name)}</h2>
      <p>Membre de la communauté Cidmap.</p>
    </div>
  `;
  dialog.querySelector('.cid-public-profile-close')?.addEventListener('click', closePublicProfileDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closePublicProfileDialog();
  }, { once: true });
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return true;
}

async function openCommentAuthorProfile(post, userId) {
  const key = String(userId || '').trim();
  if (!key) return;
  const cached = post.__cidCommentAuthors?.get(key);
  if (cached && renderPublicProfileDialog(cached)) return;
  setStatus(post, 'Chargement du profil…');
  const profile = await getPublicProfile(key);
  if (!profile) {
    if (commentsSheetState?.post === post) {
      setCommentsSheetStatus('Ce profil public est momentanément indisponible.');
    } else {
      setStatus(post, 'Ce profil public est momentanément indisponible.');
    }
    return;
  }
  post.__cidCommentAuthors ||= new Map();
  post.__cidCommentAuthors.set(key, profile);
  renderPublicProfileDialog(profile);
}

function commentsComposerName(user) {
  const profile = window.cidAuth?.getCurrentProfile?.();
  if (profile?.uid && profile.uid === user?.id) return profile.name || 'Vous';
  if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
  if (user?.user_metadata?.name) return user.user_metadata.name;
  return profile?.name || 'vous';
}

function prepareComposerForReply(input) {
  if (!input) return;
  // The parent comment is carried by `parentId` when the reply is published.
  // Keep the editor empty so the visible reply context is not accidentally
  // saved as part of the member's message.
  input.value = '';
}

function focusCommentComposer() {
  if (!commentsSheetState) return;
  const root = document.getElementById('cid-comments-sheet-root');
  const input = root?.querySelector('.cid-comments-composer-input');
  if (!input) return;
  autoSizeCommentComposer(input);
  input.focus({ preventScroll: true });
  document.body.classList.add('cid-keyboard-input-active');
}

function autoSizeCommentComposer(input) {
  if (!(input instanceof HTMLTextAreaElement)) return;
  input.style.height = 'auto';
  const nextHeight = Math.min(Math.max(input.scrollHeight, 40), 110);
  input.style.height = `${nextHeight}px`;
}

function positionWriteComposer(post, root) {
  if (!post || !root || commentsSheetState?.mode !== COMMENTS_MODE_WRITE) return;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const gutter = 8;
  const availableWidth = Math.max(0, viewportWidth - (gutter * 2));
  const rect = post.getBoundingClientRect();
  const width = Math.min(
    Math.max(0, rect.width || availableWidth),
    availableWidth
  );
  const left = Math.max(
    gutter,
    Math.min(rect.left || gutter, viewportWidth - width - gutter)
  );
  root.style.setProperty('--cid-write-composer-left', `${left}px`);
  root.style.setProperty('--cid-write-composer-width', `${width}px`);
}

function ensureCommentsSheet() {
  let root = document.getElementById('cid-comments-sheet-root');
  if (root) return root;

  root = document.createElement('div');
  root.id = 'cid-comments-sheet-root';
  root.className = 'cid-comments-sheet-root';
  root.hidden = true;
  root.innerHTML = `
    <div class="cid-comments-sheet-backdrop" data-comments-close></div>
    <section class="cid-comments-sheet" role="dialog" aria-modal="true" aria-labelledby="cid-comments-sheet-title">
      <div class="cid-comments-sheet-handle" aria-hidden="true"></div>
      <header class="cid-comments-sheet-header">
        <div>
          <h2 id="cid-comments-sheet-title">Commentaires</h2>
          <span class="cid-comments-sheet-count" aria-live="polite">0 commentaires</span>
        </div>
        <button type="button" class="cid-comments-sheet-close" data-comments-close aria-label="Retour">‹</button>
      </header>
      <div class="cid-comments-sheet-list" aria-live="polite"></div>
      <div class="cid-comments-closed" hidden><span class="cid-comments-closed-icon" aria-hidden="true">🔒</span><strong>Les commentaires sont désactivés sur cette publication.</strong></div>
      <div class="cid-comments-sheet-status" role="status" aria-live="polite"></div>
      <form class="cid-comments-composer">
        <div class="cid-comments-reply-context" hidden>
          <div class="cid-comments-reply-copy">
            <span>Réponse à <strong class="cid-comments-reply-name"></strong></span>
            <span class="cid-comments-reply-quote"></span>
          </div>
          <button type="button" class="cid-comments-reply-clear" aria-label="Annuler la réponse">Annuler</button>
        </div>
        <div class="cid-comments-composer-row">
          <div class="cid-comments-composer-avatar" aria-hidden="true">C</div>
          <textarea
            class="cid-comments-composer-input"
            rows="1"
            inputmode="text"
            enterkeyhint="send"
            autocapitalize="sentences"
            autocomplete="off"
            spellcheck="true"
            placeholder="Commentez…"
            aria-label="Commentez"></textarea>
          <button type="button" class="cid-comments-composer-emoji" data-comments-emoji aria-label="Ajouter un emoji ou un sticker">+</button>
          <button type="submit" class="cid-comments-composer-submit" aria-label="Publier le commentaire" hidden>Publier</button>
        </div>
        <div class="cid-comments-emoji-picker" data-comments-emoji-picker hidden aria-label="Emojis et stickers">
          <button type="button" data-comment-emoji="👍">👍</button>
          <button type="button" data-comment-emoji="❤️">❤️</button>
          <button type="button" data-comment-emoji="😂">😂</button>
          <button type="button" data-comment-emoji="👏">👏</button>
          <button type="button" data-comment-emoji="🔥">🔥</button>
          <button type="button" data-comment-emoji="🎉">🎉</button>
          <button type="button" data-comment-emoji="💯">💯</button>
          <button type="button" data-comment-emoji="🙏">🙏</button>
        </div>
      </form>
    </section>
  `;
  document.body.appendChild(root);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-comments-close]')) {
      closeCommentsSheet();
      return;
    }

    const emojiToggle = target.closest('[data-comments-emoji]');
    if (emojiToggle) {
      const picker = root.querySelector('[data-comments-emoji-picker]');
      if (picker) picker.hidden = !picker.hidden;
      return;
    }

    const emojiButton = target.closest('[data-comment-emoji]');
    if (emojiButton) {
      const input = root.querySelector('.cid-comments-composer-input');
      if (input) {
        input.value = `${input.value || ''}${emojiButton.dataset.commentEmoji || ''}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
      }
      root.querySelector('[data-comments-emoji-picker]')?.setAttribute('hidden', '');
      return;
    }

    const repliesToggle = target.closest('[data-comment-replies]');
    if (repliesToggle && commentsSheetState) {
      const id = repliesToggle.dataset.commentReplies;
      if (commentsSheetState.expandedIds.has(id)) commentsSheetState.expandedIds.delete(id);
      else commentsSheetState.expandedIds.add(id);
      renderCommentsSheet();
      return;
    }

    const likeButton = target.closest('[data-comment-like]');
    if (likeButton && commentsSheetState) {
      if (!commentsSheetState.user) {
        closeCommentsSheet();
        requireSocialAccount('aimer ce commentaire');
        return;
      }
      handleCommentLike(
        likeButton.dataset.commentLike,
        likeButton
      );
      return;
    }

    const reactionButton = target.closest('[data-comment-reaction]');
    if (reactionButton && commentsSheetState) {
      if (!commentsSheetState.user) {
        closeCommentsSheet();
        requireSocialAccount('réagir à ce commentaire');
        return;
      }
      const id = reactionButton.dataset.commentReactionId;
      const type = reactionButton.dataset.commentReaction;
      if (commentsSheetState.reactions.get(id) === type) {
        commentsSheetState.reactions.delete(id);
      } else {
        commentsSheetState.reactions.set(id, type);
      }
      renderCommentsSheet();
      return;
    }

    const replyButton = target.closest('[data-comment-reply]');
    if (replyButton && commentsSheetState) {
      if (!commentsSheetState.user) {
        closeCommentsSheet();
        requireSocialAccount('répondre à ce commentaire');
        return;
      }
      const id = replyButton.dataset.commentReply;
      const name = replyButton.dataset.commentAuthorName || 'Membre Cidmap';
      const text = compactText(replyButton.dataset.commentText || '');
      // Replying happens inside the comments surface. Keep the list and its
      // scroll position visible while the composer receives the keyboard.
      const list = root.querySelector('.cid-comments-sheet-list');
      const previousScrollTop = list?.scrollTop || 0;
      commentsSheetState.mode = COMMENTS_MODE_VIEW;
      commentsSheetState.replyParentId = id;
      commentsSheetState.replyName = name;
      commentsSheetState.replyText = text;
      renderCommentsSheet();
      if (list) {
        list.scrollTop = previousScrollTop;
        requestAnimationFrame(() => {
          if (commentsSheetState) list.scrollTop = previousScrollTop;
        });
      }
      const input = root.querySelector('.cid-comments-composer-input');
      if (input) {
        prepareComposerForReply(input);
        focusCommentComposer();
      }
      return;
    }

    const authorButton = target.closest('[data-comment-author]');
    if (authorButton && commentsSheetState?.post) {
      openCommentAuthorProfile(
        commentsSheetState.post,
        authorButton.dataset.commentAuthor
      ).catch(() => {
        setCommentsSheetStatus('Ce profil public est momentanément indisponible.');
      });
      return;
    }

    if (target.closest('.cid-comments-reply-clear')) {
      clearCommentsReplyTarget();
    }
  });

  root.querySelector('.cid-comments-composer')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCommentsSheet();
  });
  root.querySelector('.cid-comments-composer-input')?.addEventListener('input', (event) => {
    const submit = root.querySelector('.cid-comments-composer-submit');
    const emoji = root.querySelector('[data-comments-emoji]');
    const hasText = Boolean(event.target.value.trim());
    autoSizeCommentComposer(event.target);
    if (submit) {
      submit.disabled = !hasText;
      submit.hidden = !hasText;
    }
    if (emoji) emoji.hidden = hasText;
  });
  const composerInput = root.querySelector('.cid-comments-composer-input');
  composerInput?.addEventListener('focus', () => {
    document.body.classList.add('cid-keyboard-input-active');
  });
  composerInput?.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!root.classList.contains('is-keyboard-open')) {
        document.body.classList.remove('cid-keyboard-input-active');
      }
    }, 120);
  });
  if (window.visualViewport) {
    const syncSheetViewport = () => {
      const viewport = window.visualViewport;
      const keyboardInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );
      root.style.setProperty('--cid-comments-keyboard-inset', `${keyboardInset}px`);
      root.style.setProperty('--cid-comments-viewport-height', `${viewport.height}px`);
      positionWriteComposer(commentsSheetState?.post, root);
      root.classList.toggle('is-keyboard-open', keyboardInset > 80);
      document.body.classList.toggle(
        'cid-keyboard-input-active',
        Boolean(commentsSheetState && (keyboardInset > 80 || document.activeElement === composerInput))
      );
    };
    window.visualViewport.addEventListener('resize', syncSheetViewport);
    window.visualViewport.addEventListener('scroll', syncSheetViewport);
    syncSheetViewport();
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && commentsSheetState) closeCommentsSheet();
  });
  return root;
}

function setCommentsSheetData(comments, { reset = false } = {}) {
  if (!commentsSheetState) return;
  const allComments = Array.isArray(comments) ? comments : [];
  const previousVisibleCount = Number(commentsSheetState.visibleCount) || COMMENTS_PAGE_SIZE;
  const visibleCount = reset
    ? Math.min(COMMENTS_PAGE_SIZE, allComments.length)
    : Math.min(allComments.length, Math.max(COMMENTS_PAGE_SIZE, previousVisibleCount));
  commentsSheetState.allComments = allComments;
  commentsSheetState.visibleCount = visibleCount;
  commentsSheetState.comments = allComments.slice(0, visibleCount);
  commentsSheetState.hasMore = visibleCount < allComments.length;
}

function loadMoreComments() {
  if (!commentsSheetState || commentsSheetState.loadingMore || !commentsSheetState.hasMore) return;
  commentsSheetState.loadingMore = true;
  renderCommentsSheet();
  window.setTimeout(() => {
    if (!commentsSheetState) return;
    commentsSheetState.visibleCount = Math.min(
      commentsSheetState.allComments.length,
      commentsSheetState.visibleCount + COMMENTS_PAGE_SIZE
    );
    commentsSheetState.comments = commentsSheetState.allComments
      .slice(0, commentsSheetState.visibleCount);
    commentsSheetState.hasMore = commentsSheetState.visibleCount < commentsSheetState.allComments.length;
    commentsSheetState.loadingMore = false;
    renderCommentsSheet();
  }, 0);
}

function observeCommentsPagination(list) {
  commentsPaginationObserver?.disconnect();
  commentsPaginationObserver = null;
  if (!list || !commentsSheetState?.hasMore) return;
  const sentinel = list.querySelector('.cid-comments-load-sentinel');
  if (!sentinel || typeof IntersectionObserver !== 'function') return;
  commentsPaginationObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) loadMoreComments();
  }, {
    root: list,
    rootMargin: '0px 0px 180px 0px',
    threshold: 0
  });
  commentsPaginationObserver.observe(sentinel);
}

function setCommentsSheetStatus(message, duration = 4200) {
  const status = document.querySelector('.cid-comments-sheet-status');
  if (!status) return;
  status.textContent = message || '';
  if (message) {
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, duration);
  }
}

async function handleCommentLike(commentId, button) {
  if (!commentsSheetState || !commentId) return;
  if (!commentsSheetState.user) {
    closeCommentsSheet();
    await requireSocialAccount('aimer ce commentaire');
    return;
  }
  button.disabled = true;
  try {
    await toggleCommentLike(commentId);
    const freshMetrics = await listCommentMetrics([commentId]);
    const metric = freshMetrics.get(commentId) || { likes: 0, liked: false };
    commentsSheetState.commentMetrics.set(commentId, metric);
    renderCommentsSheet();
  } catch (error) {
    if (isSocialAuthError(error)) {
      setCommentsSheetStatus('Connectez-vous à votre compte Cidmap pour aimer ce commentaire.');
    } else {
      setCommentsSheetStatus(error?.message || 'Impossible d’enregistrer votre réaction.');
    }
    button.disabled = false;
  }
}

function clearCommentsReplyTarget() {
  if (!commentsSheetState) return;
  commentsSheetState.replyParentId = null;
  commentsSheetState.replyName = '';
  commentsSheetState.replyText = '';
  const input = document.querySelector('.cid-comments-composer-input');
  if (input) input.value = '';
  renderCommentsSheet();
  focusCommentComposer();
}

function renderCommentsSheet() {
  const root = document.getElementById('cid-comments-sheet-root');
  if (!root || !commentsSheetState) return;
  const {
    comments,
    allComments,
    authors,
    expandedIds,
    reactions,
    commentMetrics,
    user,
    loading,
    loadingMore,
    mode = COMMENTS_MODE_VIEW,
    replyName = '',
    replyText = ''
  } = commentsSheetState;
  const count = root.querySelector('.cid-comments-sheet-count');
  const list = root.querySelector('.cid-comments-sheet-list');
  const input = root.querySelector('.cid-comments-composer-input');
  const submit = root.querySelector('.cid-comments-composer-submit');
  const replyContext = root.querySelector('.cid-comments-reply-context');
  const replyContextName = root.querySelector('.cid-comments-reply-name');
  const replyContextQuote = root.querySelector('.cid-comments-reply-quote');
  const avatar = root.querySelector('.cid-comments-composer-avatar');
  const composer = root.querySelector('.cid-comments-composer');
  const closedNotice = root.querySelector('.cid-comments-closed');
  const sheet = root.querySelector('.cid-comments-sheet');
  const compactComposer = mode === COMMENTS_MODE_WRITE;
  const commentsDisabled = commentsSheetState.post?.__cidCommentsEnabled !== true;

  root.classList.toggle('is-view-mode', mode === COMMENTS_MODE_VIEW);
  root.classList.toggle('is-write-mode', mode === COMMENTS_MODE_WRITE);
  root.classList.toggle('is-guest', !user);
  root.classList.toggle('is-compact-composer', compactComposer);
  root.classList.toggle('is-comments-closed', commentsDisabled);
  sheet?.classList.toggle('is-compact-composer', compactComposer);
  if (composer) composer.hidden = !user || commentsDisabled;
  if (closedNotice) closedNotice.hidden = !commentsDisabled;

  if (count) {
    const total = Array.isArray(allComments) ? allComments.length : comments.length;
    count.textContent = `${total} commentaire${total === 1 ? '' : 's'}`;
  }
  if (list) {
    if (loading) {
      list.innerHTML = '<div class="cid-comments-sheet-loading"><span></span><strong>Chargement des commentaires…</strong></div>';
    } else if (!comments.length) {
      list.innerHTML = `
        <div class="cid-comments-sheet-empty">
          <span class="cid-comments-sheet-empty-icon">💬</span>
          <strong>Soyez le premier à commenter</strong>
          <span>Votre avis peut commencer la conversation.</span>
        </div>
      `;
    } else {
      list.innerHTML = commentMarkup(
        comments,
        user?.id || '',
        authors,
        expandedIds,
        reactions,
        commentMetrics
      ) + (commentsSheetState.hasMore
        ? `<div class="cid-comments-load-sentinel" aria-hidden="true">${loadingMore ? 'Chargement…' : ''}</div>`
        : '');
    }
    observeCommentsPagination(list);
  }
  if (replyContext) replyContext.hidden = !replyName;
  if (replyContextName) replyContextName.textContent = replyName;
  if (replyContextQuote) {
    replyContextQuote.textContent = replyText
      ? `« ${replyText} »`
      : '';
  }
  if (input) {
    autoSizeCommentComposer(input);
    const displayName = commentsComposerName(user);
    input.placeholder = user
      ? (replyName ? `Répondre à ${replyName}…` : 'Commentez…')
      : 'Connectez-vous pour commenter…';
    input.setAttribute(
      'aria-label',
      user
        ? (replyName ? `Votre commentaire pour ${replyName} en tant que ${displayName}` : 'Commentez')
        : 'Se connecter pour commenter'
    );
  }
  const emojiButton = root.querySelector('[data-comments-emoji]');
  const emojiPicker = root.querySelector('[data-comments-emoji-picker]');
  const hasComposerText = Boolean(input?.value.trim());
  if (submit) {
    submit.disabled = !hasComposerText;
    submit.hidden = !hasComposerText;
  }
  if (emojiButton) emojiButton.hidden = hasComposerText;
  if (!hasComposerText && emojiPicker) emojiPicker.hidden = true;
  if (avatar) {
    const displayName = commentsComposerName(user);
    avatar.textContent = displayName.charAt(0).toUpperCase() || 'C';
  }
  if (submit) submit.disabled = !input?.value.trim();
}

async function submitCommentsSheet() {
  if (!commentsSheetState?.post) return;
  const root = document.getElementById('cid-comments-sheet-root');
  const input = root?.querySelector('.cid-comments-composer-input');
  const submit = root?.querySelector('.cid-comments-composer-submit');
  const text = compactText(input?.value);
  if (!text) {
    setCommentsSheetStatus('Écrivez un commentaire avant de publier.');
    input?.focus();
    return;
  }

  if (submit) submit.disabled = true;
  const { post, replyParentId } = commentsSheetState;
  try {
    const comment = await createComment({
      drawId: socialPostId(post),
      text,
      parentId: replyParentId || null
    });
    commentsSheetState.allComments = [...commentsSheetState.allComments, comment];
    commentsSheetState.visibleCount = commentsSheetState.allComments.length;
    commentsSheetState.comments = commentsSheetState.allComments.slice();
    commentsSheetState.hasMore = false;
    if (replyParentId) commentsSheetState.expandedIds.add(replyParentId);
    commentsSheetState.replyParentId = null;
    commentsSheetState.replyName = '';
    commentsSheetState.replyText = '';
    commentsSheetState.mode = COMMENTS_MODE_VIEW;
    input.value = '';
    input.blur();
    document.body.classList.remove('cid-keyboard-input-active');
    renderCommentsSheet();
    setCommentsSheetStatus('Commentaire publié.', 2600);
    await refreshPostComments(post);
  } catch (error) {
    if (isSocialAuthError(error)) {
      setCommentsSheetStatus('Connectez-vous à votre compte Cidmap pour commenter.');
    } else {
      setCommentsSheetStatus(error?.message || 'Impossible de publier le commentaire.');
    }
    if (submit) submit.disabled = false;
  }
}

async function openCommentsSheet(
  post,
  mode = COMMENTS_MODE_VIEW,
  { focusComposer = false } = {}
) {
  const drawId = socialPostId(post);
  const postType = post?.dataset?.postType || '';
  const commentsEnabled = typeof window.cidContentControl?.commentsEnabled === 'function'
    ? window.cidContentControl.commentsEnabled(drawId, postType)
    : false;
  if (commentsEnabled !== true) {
    // Le mode réaction-only est appliqué : le bouton de commentaire est déjà
    // masqué par le rendu, on empêche aussi toute ouverture directe.
    return Promise.resolve(false);
  }
  if (post?.dataset?.commentsEnabled !== 'true' || post?.__cidCommentsEnabled === false) {
    return false;
  }
  if (post && post.__cidCommentsEnabled === undefined) {
    let publicationEnabled = false;
    try {
      publicationEnabled = await getPublicationCommentsEnabled(drawId);
    } catch (_) {}
    post.__cidCommentsEnabled = publicationEnabled === true;
    applyCommentsVisibility(post, post.__cidCommentsEnabled);
    if (!post.__cidCommentsEnabled) return false;
  }
  const root = ensureCommentsSheet();
  const cachedComments = readFeedCache(drawId)?.comments || [];
  commentsSheetState = {
    post,
    // All entry points use the same comments surface. The composer can be
    // focused, but it must never switch to the old publication-anchored mode.
    mode: COMMENTS_MODE_VIEW,
    focusComposerOnOpen: Boolean(focusComposer),
    comments: cachedComments.slice(0, COMMENTS_PAGE_SIZE),
    allComments: cachedComments,
    visibleCount: Math.min(COMMENTS_PAGE_SIZE, cachedComments.length),
    hasMore: cachedComments.length > COMMENTS_PAGE_SIZE,
    loadingMore: false,
    authors: new Map(),
    expandedIds: new Set(),
    reactions: new Map(),
    commentMetrics: new Map(),
    replyParentId: null,
    replyName: '',
    replyText: '',
    user: null,
    loading: true
  };
  commentsSheetPreviousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  window.cidSetDocumentScrollLocked?.(true);
  document.body.classList.add('cid-comments-sheet-active');
  root.hidden = false;
  root.classList.remove('is-open');
  // A previous emoji menu must never be carried into a new comment session:
  // it is a floating accessory, not part of the composer height.
  root.querySelector('[data-comments-emoji-picker]')?.setAttribute('hidden', '');
  renderCommentsSheet();
  if (commentsSheetState.mode === COMMENTS_MODE_VIEW) {
    if (commentsSheetState.focusComposerOnOpen) {
      // Keep the composer inside the comments panel and focus it while the
      // click is still trusted, so mobile Safari can open the keyboard.
      root.classList.add('is-open');
      focusCommentComposer();
    } else {
      root.querySelector('.cid-comments-composer-input')?.blur();
      document.body.classList.remove('cid-keyboard-input-active');
    }
  }
  requestAnimationFrame(() => {
    root.classList.add('is-open');
  });

  const bridge = await Promise.resolve(window.cidSupabaseReady).catch(() => null);
  commentsSheetState.user = await Promise.resolve(bridge?.getUser?.()).catch(() => null);
  renderCommentsSheet();
  await refreshPostComments(post);
  if (!commentsSheetState || commentsSheetState.post !== post) return;
  setCommentsSheetData(post.__cidComments || [], { reset: true });
  commentsSheetState.authors = post.__cidCommentAuthors || new Map();
  commentsSheetState.commentMetrics = post.__cidCommentMetrics || new Map();
  commentsSheetState.loading = false;
  renderCommentsSheet();
  if (commentsSheetState?.focusComposerOnOpen) {
    focusCommentComposer();
  }
}

function viewCommentsMode(post) {
  return openCommentsSheet(post, COMMENTS_MODE_VIEW);
}

function writeCommentMode(post) {
  // The publication action uses the same comments surface as the counter.
  // Only the focus changes; the composer never floats over the home post.
  return openCommentsSheet(post, COMMENTS_MODE_VIEW, { focusComposer: true });
}

async function writeCommentModeForAccount(post) {
  const user = await requireSocialAccount('commenter');
  if (!user) return;
  return writeCommentMode(post);
}

window.cidCommentsFlows = {
  viewCommentsMode,
  writeCommentMode
};

function closeCommentsSheet() {
  const root = document.getElementById('cid-comments-sheet-root');
  if (!root) return;
  commentsPaginationObserver?.disconnect();
  commentsPaginationObserver = null;
  root.classList.remove('is-open');
  document.body.style.overflow = commentsSheetPreviousOverflow;
  document.body.classList.remove('cid-comments-sheet-active');
  document.body.classList.remove('cid-keyboard-input-active');
  window.cidResetScrollLock?.({ resetSurfaces: false });
  commentsSheetState = null;
  window.setTimeout(() => {
    if (!root.classList.contains('is-open')) root.hidden = true;
  }, 260);
}

function toggleSharing(post) {
  const open = post.dataset.shareOpen === 'true';
  post.dataset.shareOpen = String(!open);
  if (!open) post.dataset.commentsOpen = 'false';
}

function openScheduleFromFeed() {
  if (typeof window.cidOpenSchedule === 'function') {
    window.cidOpenSchedule();
    return;
  }
  // The schedule controller is loaded as a module. Keep this fallback
  // harmless if a visitor clicks before that module has finished loading.
  const modal = document.getElementById('scheduleModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  window.cidSetDocumentScrollLocked?.(true);
  if (typeof window.renderSchedule === 'function') window.renderSchedule();
}

function openFeedPublication(action, programmeDate = '') {
  if (String(action || '').startsWith('anticipation:tableaux-')) {
    if (typeof window.cidShowPublicationHistory === 'function') {
      window.cidShowPublicationHistory({
        kind: 'tableaux',
        featureKey: String(action).slice('anticipation:'.length),
        returnTo: () => window.showAnticipationView?.({ updateHistory: false })
      });
      return;
    }
  }
  if (action === 'croix') {
    if (typeof window.showCroixView === 'function') {
      window.showCroixView({
        date: String(programmeDate || '').slice(0, 10),
        updateHistory: true
      });
      return;
    }
    const button = document.getElementById('plantCroixBtn')
      || document.getElementById('submenuCroix');
    button?.click();
    return;
  }
  if (action === 'matrix') {
    if (typeof window.showMatriceView === 'function') {
      window.showMatriceView({
        date: String(programmeDate || '').slice(0, 10),
        updateHistory: true
      });
      return;
    }
    document.getElementById('submenuMatrice')?.click();
    return;
  }
  if (action === 'matrix-history') {
    if (typeof window.cidShowPublicationHistory === 'function') {
      window.cidShowPublicationHistory({
        kind: 'matrix',
        returnTo: () => window.showHomeView?.({ updateHistory: false })
      });
      return;
    }
    if (typeof window.showMatriceView === 'function') {
      window.showMatriceView({
        date: String(programmeDate || '').slice(0, 10),
        updateHistory: true
      });
      return;
    }
    document.getElementById('submenuMatrice')?.click();
    return;
  }
  if (action === 'rejected') {
    if (typeof window.showRejectedView === 'function') {
      window.showRejectedView({
        date: String(programmeDate || '').slice(0, 10),
        updateHistory: true
      });
      return;
    }
    document.getElementById('submenuRejected')?.click();
    return;
  }
  if (action === 'rejected-history') {
    if (typeof window.cidShowPublicationHistory === 'function') {
      window.cidShowPublicationHistory({
        kind: 'rejected',
        returnTo: () => window.showHomeView?.({ updateHistory: false })
      });
      return;
    }
    document.getElementById('submenuRejected')?.click();
    return;
  }
  if (action === 'tableaux') {
    if (typeof window.cidShowPublicationHistory === 'function') {
      window.cidShowPublicationHistory({
        kind: 'tableaux',
        featureKey: 'tableaux-universelle',
        returnTo: () => window.showTableauxView?.({ updateHistory: false })
      });
      return;
    }
    document.getElementById('tableauxBtn')?.click();
    return;
  }
  if (action === 'schedule') openScheduleFromFeed();
}

async function nativeShare(post, method) {
  const type = post.dataset.postType;
  const postId = post.dataset.postId || type;
  const shareUrl = window.cidReferralSystem?.getShareUrl?.(window.location.href) || (() => {
    try {
      const url = new URL(window.location.href);
      url.protocol = 'https:';
      url.hostname = 'cidmap.com';
      url.port = '';
      return url.toString();
    } catch (_) {
      return 'https://cidmap.com/';
    }
  })();
  const text = type === 'cross'
    ? 'Croix nationale pour le divertissement sur Cidmap'
    : type === 'matrix'
      ? 'Matrice du jour sur Cidmap'
      : type === 'rejected'
        ? 'Boules rejetées du jour sur Cidmap'
        : type === 'tableaux'
          ? 'Tableaux du jour sur Cidmap'
          : 'Horaires des programmes sur Cidmap';

  if (method === 'copy') {
    if (!navigator.clipboard) {
      setStatus(post, 'Copie indisponible dans ce navigateur.');
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    await recordPostShare(postId, method);
    await refreshPostMetrics(post);
    setStatus(post, 'Lien avec votre parrainage copié.');
    return;
  }

  if (typeof navigator.share === 'function') {
    // Share the page URL so WhatsApp and the social preview keep the full
    // Cidmap context. The cross itself is corrected in the responsive CSS,
    // so the generated preview now follows the real on-page composition.
    await navigator.share({ title: PAGE_NAME, text, url: shareUrl });
    await recordPostShare(postId, method);
    await refreshPostMetrics(post);
    setStatus(post, method === 'profile' ? 'Publication prête à être partagée sur votre profil.' : 'Fenêtre de partage ouverte.');
    return;
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
    await recordPostShare(postId, method);
    await refreshPostMetrics(post);
    setStatus(post, 'Lien et texte copiés pour le partage.');
  } else {
    setStatus(post, 'Partage disponible depuis le menu du navigateur.');
  }
}

function readFeedCache(postId) {
  try {
    const cache = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}');
    const item = cache?.[postId];
    if (!item || Date.now() - Number(item.savedAt || 0) > FEED_CACHE_TTL) return null;
    return item;
  } catch (_) {
    return null;
  }
}

function writeFeedCache(postId, value) {
  try {
    const cache = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}');
    cache[postId] = { ...value, savedAt: Date.now() };
    const entries = Object.entries(cache)
      .sort(([, left], [, right]) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0))
      .slice(0, 24);
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {
    // Storage is only a fast paint cache; Supabase remains authoritative.
  }
}

async function refreshPostComments(post) {
  const postId = socialPostId(post);
  if (!postId) return;
  if (!COMMENTS_ENABLED) {
    post.__cidCommentsEnabled = false;
    applyCommentsVisibility(post, false);
    return;
  }
  const postType = post?.dataset?.postType || '';
  const configured = typeof window.cidContentControl?.commentsEnabled === 'function'
    ? window.cidContentControl.commentsEnabled(postId, postType)
    : false;
  if (configured !== true) {
    post.__cidCommentsEnabled = false;
    applyCommentsVisibility(post, false);
    return;
  }

  /*
   * CommentControlPage stores a targeted publication override separately from
   * the global platform rules. Resolve it before painting cached counters so a
   * disabled publication never flashes a stale comment affordance.
   */
  let publicationEnabled = false;
  try {
    publicationEnabled = await getPublicationCommentsEnabled(postId);
  } catch (_) {}
  post.__cidCommentsEnabled = publicationEnabled === true;
  applyCommentsVisibility(post, post.__cidCommentsEnabled);
  if (post.__cidCommentsEnabled === false) return;

  const count = $('.cid-fb-comment-count, [data-croix-comment-count]', post);
  const label = $('.cid-fb-comment-label', post);
  const croixPlural = $('.cid-croix-comment-count-plural', post);
  const summary = $('.cid-fb-comments-summary', post);
  if (!count) return;
  const cached = readFeedCache(postId);
  if (cached?.comments) {
    const total = cached.comments.length;
    count.textContent = String(total);
    if (label) label.textContent = `commentaire${total === 1 ? '' : 's'}`;
    if (croixPlural) croixPlural.textContent = total === 1 ? '' : 's';
    summary?.setAttribute('aria-label', `Voir ${total} commentaire${total === 1 ? '' : 's'}`);
    post.__cidComments = cached.comments;
    if (commentsSheetState?.post === post) {
      setCommentsSheetData(cached.comments, { reset: commentsSheetState.loading });
      commentsSheetState.loading = false;
      renderCommentsSheet();
    }
  }

  if (pendingCommentsRequests.has(post)) return pendingCommentsRequests.get(post);
  const request = (async () => {
    try {
      const comments = await listComments(postId);
      const bridge = await window.cidSupabaseReady;
      const user = await bridge?.getUser?.();
      post.__cidCommentAuthors = await listPublicProfiles(
        comments.map((comment) => comment.user_id)
      );
      post.__cidCommentMetrics = await listCommentMetrics(
        comments.map((comment) => comment.id)
      );
      count.textContent = String(comments.length);
      if (label) label.textContent = `commentaire${comments.length === 1 ? '' : 's'}`;
      if (croixPlural) croixPlural.textContent = comments.length === 1 ? '' : 's';
      summary?.setAttribute('aria-label', `Voir ${comments.length} commentaire${comments.length === 1 ? '' : 's'}`);
      post.__cidComments = comments;
      writeFeedCache(postId, { ...(readFeedCache(postId) || {}), comments });
      if (commentsSheetState?.post === post) {
        setCommentsSheetData(comments, { reset: commentsSheetState.loading });
        commentsSheetState.authors = post.__cidCommentAuthors;
        commentsSheetState.commentMetrics = post.__cidCommentMetrics;
        commentsSheetState.user = user;
        commentsSheetState.loading = false;
        renderCommentsSheet();
      }
    } catch (error) {
      // Do not erase a useful cached view because a refresh is temporarily slow.
      if (!cached) {
        count.textContent = '0';
      }
      if (commentsSheetState?.post === post) {
        commentsSheetState.loading = false;
        renderCommentsSheet();
      }
      if (!isSocialAuthError(error)) {
        setStatus(post, 'Les commentaires sont indisponibles pour le moment.');
      }
    }
  })().finally(() => pendingCommentsRequests.delete(post));
  pendingCommentsRequests.set(post, request);
  return request;
}

async function refreshPostMetrics(post) {
  const postId = post.dataset.postId || post.dataset.postType;
  const cached = readFeedCache(postId);
  if (cached?.metrics) applyPostMetrics(post, cached.metrics);
  if (pendingMetricsRequests.has(post)) return pendingMetricsRequests.get(post);
  const request = (async () => {
    try {
      const metrics = await getPostMetrics(postId);
      applyPostMetrics(post, metrics);
      writeFeedCache(postId, { ...(readFeedCache(postId) || {}), metrics });
    } catch (error) {
      if (!isSocialAuthError(error)) {
        setStatus(post, 'Les compteurs sont indisponibles pour le moment.');
      }
    }
  })().finally(() => pendingMetricsRequests.delete(post));
  pendingMetricsRequests.set(post, request);
  return request;
}

function applyPostMetrics(post, metrics) {
  const likeButton = $('.cid-fb-like', post);
  const likeCount = $('.cid-fb-like-count', post);
  const likeActionCount = $('.cid-fb-like-action-count', post);
  const shareCount = $('.cid-fb-share-count', post);
  const shareActionCount = $('.cid-fb-share-action-count', post);
  if (likeCount) likeCount.textContent = String(metrics.likes);
  if (likeActionCount) likeActionCount.textContent = String(metrics.likes);
  if (shareCount) shareCount.textContent = String(metrics.shares);
  if (shareActionCount) shareActionCount.textContent = String(metrics.shares);
  if (likeButton) {
    likeButton.setAttribute('aria-pressed', String(metrics.liked));
    likeButton.classList.toggle('is-liked', metrics.liked);
  }
}

function applyLikeResult(post, liked, likes) {
  const likeButton = $('.cid-fb-like', post);
  const likeCount = $('.cid-fb-like-count', post);
  const likeActionCount = $('.cid-fb-like-action-count', post);
  if (likeCount && Number.isFinite(Number(likes))) {
    likeCount.textContent = String(Math.max(0, Number(likes)));
  }
  if (likeActionCount && Number.isFinite(Number(likes))) {
    likeActionCount.textContent = String(Math.max(0, Number(likes)));
  }
  if (likeButton) {
    likeButton.setAttribute('aria-pressed', String(Boolean(liked)));
    likeButton.classList.toggle('is-liked', Boolean(liked));
  }
}

async function hydratePost(post) {
  await Promise.all([refreshPostComments(post), refreshPostMetrics(post)]);
}

async function hydrateFeed(feed) {
  const posts = $$('.cid-fb-post', feed);
  const socialPosts = posts.filter((post) => post.dataset.socialEnabled !== 'false');
  feedRealtimeCleanup?.();
  feedRealtimeCleanup = null;

  // Subscribe before the initial reads so a new comment or reaction cannot
  // arrive in the gap between the first SELECTs and the realtime channel.
  const subscriptionPromise = subscribeToFeed(async ({ table, payload }) => {
      const record = payload?.new || payload?.old || {};
      const drawId = String(record.draw_id || '');
      const post = $$('.cid-fb-post', feed)
        .find((candidate) => candidate.dataset.postId === drawId);
      if (!post || post.dataset.socialEnabled === 'false') return;
      if (table === 'comments') await refreshPostComments(post);
      else await refreshPostMetrics(post);
    }).catch((error) => {
    /*
     * Realtime is an enhancement, not a prerequisite for reading the
     * publication. Some Supabase projects deliberately leave anonymous
     * Realtime disabled; the initial public queries still work in that case.
     * Keep the console quiet after the first optional transport failure and
     * let the normal feed hydration finish immediately below.
     */
    if (error?.message !== 'Connexion requise.' && !feedRealtimeWarningShown) {
      feedRealtimeWarningShown = true;
      console.info('Mises à jour en direct du fil indisponibles ; les publications restent accessibles.');
    }
    return null;
  });

  /*
   * The three current-day cards are the first-paint path. Historical cards
   * keep their reserved geometry and cached values, then reconcile during the
   * browser idle window so 27 metrics requests cannot compete with the first
   * scroll/input frame.
   */
  const criticalPosts = socialPosts.filter((post) => post.dataset.historyDay === '0');
  const deferredPosts = socialPosts.filter((post) => !criticalPosts.includes(post));
  await Promise.all(criticalPosts.map(hydratePost));

  const hydrateDeferred = () => Promise.all(deferredPosts.map(hydratePost));
  if (deferredPosts.length) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => {
        hydrateDeferred().catch(() => {});
      }, { timeout: 1200 });
    } else {
      window.setTimeout(() => {
        hydrateDeferred().catch(() => {});
      }, 180);
    }
  }

  // Realtime setup is an enhancement and never delays the first paint.
  subscriptionPromise.then((cleanup) => {
    if (document.getElementById(FEED_ID) === feed) {
      feedRealtimeCleanup = cleanup;
    } else {
      cleanup?.();
    }
  }).catch(() => {});
}

function wireFeed(feed) {
  feed.addEventListener('click', event => {
    const post = event.target.closest('.cid-fb-post');
    if (!post) return;

    const moreButton = event.target.closest('.cid-fb-more-button');
    if (moreButton) {
      openFeedPublication(
        moreButton.dataset.feedAction,
        post.dataset.programmeDate || ''
      );
      return;
    }
    if (post.dataset.socialEnabled === 'false') return;

    const likeButton = event.target.closest('.cid-fb-like');
    if (likeButton) {
      likeButton.disabled = true;
      (async () => {
        const user = await requireSocialAccount('aimer cette publication');
        if (!user) {
          likeButton.disabled = false;
          return;
        }
        const previousLiked = likeButton.getAttribute('aria-pressed') === 'true';
        const likeCount = $('.cid-fb-like-count', post);
        const previousLikes = Math.max(0, Number(likeCount?.textContent) || 0);
        // Give immediate feedback only after the session has been verified.
        const optimisticLiked = !previousLiked;
        const optimisticLikes = previousLikes + (optimisticLiked ? 1 : -1);
        applyLikeResult(post, optimisticLiked, optimisticLikes);
        try {
          const liked = await togglePostLike(post.dataset.postId || post.dataset.postType);
          const serverLiked = Boolean(liked);
          const serverLikes = previousLikes + (serverLiked === previousLiked
            ? 0
            : (serverLiked ? 1 : -1));
          applyLikeResult(post, serverLiked, serverLikes);
          if (serverLiked && !previousLiked) window.cidPlayLikeSound?.();
          const postId = post.dataset.postId || post.dataset.postType;
          const cached = readFeedCache(postId);
          writeFeedCache(postId, {
            ...(cached || {}),
            metrics: {
              ...(cached?.metrics || {}),
              likes: Math.max(0, serverLikes),
              liked: serverLiked
            }
          });
          await refreshPostMetrics(post);
        } catch (error) {
          applyLikeResult(post, previousLiked, previousLikes);
          if (isSocialAuthError(error)) {
            await requireSocialAccount('aimer cette publication');
          } else {
            setStatus(post, error?.message || 'Impossible d’enregistrer le like.');
          }
        } finally {
          likeButton.disabled = false;
        }
      })();
      return;
    }

    const commentsSummary = event.target.closest('.cid-fb-comments-summary');
    if (commentsSummary) {
      // Reading comments is public. Guests do not see a writable composer.
      viewCommentsMode(post);
      return;
    }

    if (event.target.closest('.cid-fb-comment-toggle')) {
      // The explicit Commenter action opens the shared Account view for a
      // guest, and only opens the composer after the session is confirmed.
      writeCommentModeForAccount(post);
      return;
    }

    if (event.target.closest('.cid-fb-share-toggle')) {
      toggleSharing(post);
      return;
    }

    const option = event.target.closest('.cid-fb-share-option');
    if (option) {
      nativeShare(post, option.dataset.shareMethod).catch(error => {
        if (error?.name !== 'AbortError') setStatus(post, 'Le partage n’a pas pu être lancé.');
      });
    }
  });

}

function isAccueil() {
  if (new URLSearchParams(location.search).get('section') === 'profil') return false;
  if (document.body.classList.contains('categories-active') ||
      document.body.classList.contains('matrice-active')) return false;

  const activeItem = $$('.category-item.active, .plant-btn.active').find(Boolean);
  if (activeItem) {
    // The translation layer can turn "Accueil" into "Home" (or another
    // locale). Use the stable navigation id first so the feed still mounts.
    if (activeItem.id === 'categoryAccueilButton') return true;
    const active = activeItem.textContent.trim().toLocaleLowerCase();
    return active === 'accueil' || active === 'home';
  }

  const currentCategory = String(window.__currentCategory || '').trim().toLowerCase();
  if (currentCategory) return currentCategory === 'accueil' || currentCategory === 'home';
  return true;
}

function dataSignature() {
  const info = dateInfo();
  const first = programmeResults()[0] || {};
  // The live Croix node is moved into the first card and updates in place
  // when the official payload arrives. It is deliberately not part of the
  // feed signature, otherwise the whole feed would be destroyed/rebuilt just
  // as the first publication becomes ready.
  return `${info.dateKey}|${currentFeedCountry()}|${compactText(first?.date)}|${compactText(first?.country)}`;
}

function syncCountryFlags(country = currentFeedCountry()) {
  const selectedCountry = canonicalCountry(country);
  const flag = countryFlag(selectedCountry);
  const label = countryFlagLabel(selectedCountry);
  $$('.cid-fb-country-flag').forEach((element) => {
    element.textContent = flag;
    element.setAttribute('aria-label', `Pays sélectionné : ${label}`);
  });
}

function mount({ force = false } = {}) {
  const results = document.getElementById('results');
  if (!results) return;

  const active = isAccueil();
  document.body.classList.toggle('cid-facebook-feed-active', active);
  const existing = document.getElementById(FEED_ID);
  if (!active) {
    setFeedLoader(results, { visible: false });
    // The dedicated Croix view owns the live node while it is active. The
    // explicit route unmount already restores that node; keeping this path
    // idempotent makes the observer safe during the same transition.
    unmountHomeFeed({ restoreCross: false });
    return;
  }

  if (existing) {
    existing.hidden = false;
    existing.removeAttribute('aria-hidden');
    existing.style.display = '';
  }
  const signature = dataSignature();
  if (!force && existing?.dataset.signature === signature) {
    if (existing) {
      mountCrossInstance(existing);
      restoreHomeHistoryCrossIds(existing);
    }
    if (existing?.dataset.feedState !== 'loading'
        && existing?.dataset.feedState !== 'refreshing') {
      setFeedLoader(results, { visible: false });
    }
    return;
  }
  const info = dateInfo();
  const country = currentFeedCountry();
  if (existing) {
    existing.dataset.feedState = 'refreshing';
    setFeedLoader(results, {
      visible: true,
      mode: 'refresh',
      label: 'Actualisation des publications…'
    });
    updateFeedInPlace(existing, info, country);
    existing.dataset.signature = signature;
    restoreHomeHistoryCrossIds(existing);
    Promise.allSettled([
      refreshRotatedFeedData(existing)
    ]).finally(() => {
      if (document.getElementById(FEED_ID) === existing) {
        existing.dataset.feedState = 'ready';
        setFeedLoader(results, { visible: false });
      }
    });
    return;
  }
  restoreCrossInstance();

  const feed = renderFeed();
  feed.dataset.feedState = 'loading';
  setFeedLoader(results, {
    visible: true,
    mode: 'initial',
    label: 'Chargement des publications…'
  });
  feed.dataset.signature = signature;
  results.prepend(feed);
  mountCrossInstance(feed);
  mountHomeCrossHistoryPool(feed);
  wireFeed(feed);
  window.dispatchEvent(new CustomEvent('cid:feed-rendered', {
    detail: { feed }
  }));
  updatePublicationAges(feed);

  /*
   * Historical cards already have reserved geometry and can use the local
   * snapshot. Reconcile that archive when the browser is idle so the current
   * day's three publications get the network and main-thread budget first.
   */
  const hydrateHistoryWhenIdle = () => {
    hydrateHomeCroixHistory(feed).catch(() => {});
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(hydrateHistoryWhenIdle, { timeout: 1800 });
  } else {
    window.setTimeout(hydrateHistoryWhenIdle, 450);
  }
  Promise.allSettled([
    hydrateFeed(feed)
  ]).then((settled) => {
    const failure = settled.find((result) => result.status === 'rejected')?.reason;
    if (failure?.message !== 'Connexion requise.') {
      if (failure) console.warn('Initialisation dynamique du fil indisponible', failure);
    }
  }).finally(() => {
    if (document.getElementById(FEED_ID) === feed) {
      feed.dataset.feedState = 'ready';
      setFeedLoader(results, { visible: false });
    }
  });

}

function init() {
  const results = document.getElementById('results');
  if (!results) return;
  mount();

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(mount, 80);
  });
  observer.observe(results, { childList: true });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.querySelector('.category-bar')?.addEventListener('click', () => setTimeout(mount, 120));
  document.querySelector('#inlineCategoryBar')?.addEventListener('click', () => setTimeout(mount, 120));
  window.addEventListener('cid:country-change', (event) => {
    syncCountryFlags(event.detail?.country);
    setTimeout(mount, 0);
  });
  window.addEventListener('cid:language-change', () => {
    setTimeout(() => mount({ force: true }), 0);
  });
  window.addEventListener('cid:cross-ready', () => {
    const instance = canonicalCrossSource();
    const slot = instance?.closest('.cid-fb-cross-slot');
    if (slot) {
      syncCrossLoadingState(slot, instance);
      const post = slot.closest('.cid-fb-post');
      const info = post?.dataset.programmeDate
        ? programmeInfoForDate(new Date(`${post.dataset.programmeDate}T12:00:00.000Z`))
        : dateInfo();
      snapshotLiveCrossIntoHistory(slot, instance, info);
    }
    const feed = document.getElementById(FEED_ID);
    if (feed) hydrateHomeCroixHistory(feed).catch(() => {});
  });
  window.addEventListener('cid:croix-history-updated', () => {
    const feed = document.getElementById(FEED_ID);
    if (feed) hydrateHomeCroixHistory(feed).catch(() => {});
  });
  window.addEventListener('cid:home-view-restored', () => {
    // Returning from Compte must restore the first publication around the
    // existing canonical Croix node; this is a DOM repair, not a data reload.
    setTimeout(mount, 0);
  });
  const refreshCommentPresentation = () => {
    // Global rules are resolved by site-config; targeted publication rules are
    // resolved by Supabase during hydration. Rebuild the feed so a newly
    // enabled global/category rule can restore controls that were omitted
    // from the previous server-configured markup.
    setTimeout(() => mount({ force: true }), 0);
  };
  window.addEventListener('cid:site-config-loaded', refreshCommentPresentation);
  window.addEventListener('cid:comments-settings-updated', refreshCommentPresentation);
  window.addEventListener('cidgroup:illustrations-updated', () => {
    if (!isAccueil()) return;
    setTimeout(() => {
      const feed = document.getElementById(FEED_ID);
      refreshHomeCrossHistoryImages(feed);
      mount({ force: true });
    }, 0);
  });
  window.addEventListener('cid:auth-sync', () => setTimeout(mount, 0));
  window.addEventListener('storage', (event) => {
    if (event.key === COUNTRY_STORAGE_KEY || event.key === 'cidgroup.session.v1') {
      setTimeout(mount, 0);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updatePublicationAges();
  });
  window.addEventListener('pageshow', () => updatePublicationAges());
  setInterval(() => {
    if (!isAccueil()) return;
    updatePublicationAges();
  }, 30000);
}

/*
 * Small public bridge for dedicated feeds.
 *
 * Anticipé uses the exact postMarkup mould and the same social handlers as
 * Accueil, but it owns a separate scroll surface. Keeping this bridge here
 * prevents the two views from drifting into subtly different card markup.
 */
window.cidFacebookFeed = Object.freeze({
  postMarkup,
  historicalCrossPostMarkup,
  mountHistoricalCrossPost,
  dailyPublicationMedia,
  wireFeed,
  hydratePost,
  updatePublicationAges
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
