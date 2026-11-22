/*
 * Cache-first repair for Tableau archive cards.
 *
 * The archive route owns the entitlement decision and the canonical history
 * cache. This small adapter only guarantees that each visible Tableau card
 * has the official portfolio mould while that route is active, then hydrates
 * it from the same server payload/cache used by the shared history view.
 * It never calculates programme values or grants access.
 */
import {
  historyCacheKey,
  readHistoryPayload
} from '/src/shared/history-cache.js?history-cache-v40';
import {
  TABLEAU_DEFINITIONS,
  normalizeTableauFeatureKey,
  resolveTableauPlan
} from '/src/tableaux/tableau-contract.js?tableau-contract-v2';

const PORTFOLIOS = Object.freeze(Object.fromEntries(
  TABLEAU_DEFINITIONS.map(({ featureKey, portfolioClass }) => [featureKey, portfolioClass])
));
const ZERO_KEY = '000000';
const ZERO_VALUE = '00';
const ZERO_CROSS = '0';
let scanQueued = false;

function allowed(featureKey) {
  return window.cidIsAdmin === true
    || window.cidFeatureAccess?.has?.(featureKey) === true;
}

function portfolioSource(featureKey) {
  if (featureKey === 'tableaux-created') {
    return document.querySelector('#tableauxViewContainer #createdProgramPortfolios');
  }
  const portfolioClass = PORTFOLIOS[featureKey];
  return portfolioClass
    ? document.querySelector(`#tableauxViewContainer .${portfolioClass}`)
    : null;
}

function text(value, fallback = ZERO_VALUE) {
  if (Array.isArray(value)) {
    const entries = value.map((item) => typeof item === 'object' ? item?.value : item)
      .filter((item) => item !== null && item !== undefined && String(item).trim());
    return entries.length ? entries.join(' ') : fallback;
  }
  return value !== null && value !== undefined && String(value).trim()
    ? String(value)
    : fallback;
}

function paintCombination(node, combination) {
  if (!node) return;
  const values = Array.isArray(combination) ? combination : [];
  const operator = combination?.operator || '+';
  node.replaceChildren();
  if (!values.length) {
    node.textContent = `${ZERO_VALUE} ${operator} ${ZERO_VALUE}`;
    return;
  }
  values.forEach((part, index) => {
    if (index) node.append(document.createTextNode(` ${operator} `));
    const number = document.createElement('span');
    number.className = 'satellite-number';
    number.textContent = text(typeof part === 'object' ? part?.value : part);
    node.append(number);
  });
}

function paintSatelliteTable(table, plan) {
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr'));
  const footer = rows.find((row, index) => index >= 2 && row.querySelector('th[colspan]'));
  const template = rows[2]?.cloneNode(true);
  if (!template) return;
  rows.slice(2, footer ? rows.indexOf(footer) : rows.length).forEach((row) => row.remove());
  const satellites = Array.isArray(plan?.satellites) && plan.satellites.length
    ? plan.satellites
    : [null];
  const targetFooter = Array.from(table.querySelectorAll('tr'))
    .find((row, index) => index >= 2 && row.querySelector('th[colspan]'));
  satellites.forEach((satellite) => {
    const row = template.cloneNode(true);
    const cells = row.children;
    if (cells[0]) cells[0].textContent = text(satellite?.value);
    if (cells[1]) paintCombination(cells[1].querySelector('.satellite-combination')
      || (cells[1].classList.contains('satellite-combination') ? cells[1] : null),
    satellite?.combinations?.[0]);
    if (cells[2]) paintCombination(cells[2].querySelector('.satellite-combination')
      || (cells[2].classList.contains('satellite-combination') ? cells[2] : null),
    satellite?.combinations?.[1]);
    table.tBodies[0]?.insertBefore(row, targetFooter || null);
  });
  const nap = plan?.nap || {};
  const napValues = [
    Array.isArray(nap.nap1) ? nap.nap1[0] : null,
    Array.isArray(nap.nap1) ? nap.nap1[1] : null,
    Array.isArray(nap.nap2) ? nap.nap2.filter(Boolean).join(' ') : null
  ];
  table.querySelectorAll('.nap-value').forEach((node, index) => {
    node.textContent = text(napValues[index]);
  });
}

function paintStandby(root, payload, date) {
  const table = root.querySelector('.standby-week-table');
  const body = table?.querySelector('tbody');
  const template = body?.querySelector('tr')?.cloneNode(true);
  if (!body || !template) return;
  body.replaceChildren();
  const rows = Array.isArray(payload?.rows) && payload.rows.length ? payload.rows : [null];
  rows.forEach((item) => {
    const row = template.cloneNode(true);
    row.children[0].textContent = item?.countryDisplay || item?.country || '0';
    row.children[1].textContent = text(item?.nap2);
    row.children[2].textContent = text(item?.permutation);
    body.append(row);
  });
  root.querySelectorAll('.date, .table-date').forEach((node) => {
    node.textContent = new Date(`${date}T12:00:00Z`).toLocaleDateString(
      window.cidTranslation?.current?.() || 'fr', { dateStyle: 'long', timeZone: 'Africa/Abidjan' }
    );
  });
}

function paintPlan(root, payload, featureKey, date) {
  root.querySelectorAll('.date, .table-date').forEach((node) => {
    node.textContent = new Date(`${date}T12:00:00Z`).toLocaleDateString(
      window.cidTranslation?.current?.() || 'fr', { dateStyle: 'long', timeZone: 'Africa/Abidjan' }
    );
  });
  if (featureKey === 'tableaux-standby') {
    paintStandby(root, payload?.standby || payload, date);
    return;
  }
  if (featureKey === 'tableaux-created') {
    const byId = new Map((payload?.createdPrograms || []).map((program) => [
      String(program?.id || '').toLowerCase(), program
    ]));
    root.querySelectorAll('.created-program-card').forEach((card) => {
      const id = String(card.id || '').replace(/^created-program-/, '').toLowerCase();
      const program = byId.get(id);
      if (!program) return;
      const clone = card.querySelector('.created-program-template');
      if (clone) paintPlan(clone, { plans: { [String(program.visualTemplate || program.sourceTemplate || 'universal').toLowerCase()]: program } },
        normalizeTableauFeatureKey(program.visualTemplate || program.sourceTemplate || 'universal'), date);
    });
    return;
  }
  const plan = resolveTableauPlan(payload, featureKey) || {};
  root.querySelectorAll('.key-container .numbers').forEach((node) => { node.textContent = text(plan.key, ZERO_KEY); });
  root.querySelectorAll('.order-container .numbers').forEach((node) => { node.textContent = text(plan.order, ZERO_KEY); });
  root.querySelectorAll('.key-info strong').forEach((node, index) => {
    node.textContent = text([plan.code, plan.filter, plan.addition][index]);
  });
  const cross = plan.cross || {};
  [
    ['.cross-number-1', cross.top], ['.cross-number-2', cross.bottom],
    ['.cross-number-3', cross.right], ['.cross-number-6', cross.left]
  ].forEach(([selector, value]) => root.querySelectorAll(selector).forEach((node) => {
    node.textContent = text(value, ZERO_CROSS);
  }));
  root.querySelectorAll(
    '.universal-satellites, .intuition-cross-satellites, .oracle-satellites, ' +
    '.manual-satellites, .lnb-satellites'
  ).forEach((table) => paintSatelliteTable(table, plan));
}

function cachedPayload(date, featureKey) {
  const key = historyCacheKey({ kind: 'tableaux', date, featureKey });
  return readHistoryPayload(key)?.value || null;
}

function repairTableauCards() {
  if (!document.body?.classList.contains('archive-active')) return;
  const mount = document.getElementById('historyViewMount');
  const cards = mount?.querySelectorAll(
    '.cid-publication-history__card[data-history-kind="tableaux"]'
  ) || [];
  cards.forEach((card) => {
    const featureKey = normalizeTableauFeatureKey(
      card.dataset.historyKey?.split(':').slice(2).join(':') || ''
    );
    const date = String(card.dataset.historyDate || '').slice(0, 10);
    if (!featureKey || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowed(featureKey)) return;
    const payload = cachedPayload(date, featureKey);
    const source = portfolioSource(featureKey);
    if (!source) return;
    let target = card.querySelector('[data-history-tableau-mount]');
    if (!target) {
      target = document.createElement('div');
      target.className = 'cid-publication-history__tableau-mount';
      target.dataset.historyTableauMount = featureKey;
      card.querySelector('.cid-publication-history__body')?.replaceChildren(target);
    }
    const signature = `${featureKey}:${date}:${payload ? 'data' : 'shell'}`;
    if (target.dataset.repairSignature === signature) return;
    const clone = source.cloneNode(true);
    clone.hidden = false;
    clone.removeAttribute('hidden');
    clone.removeAttribute('id');
    clone.classList.add('cid-publication-history__tableau-clone', 'cid-tableaux-scope');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.querySelectorAll('.tableaux-access-badge, .tableaux-history-button, [data-tableaux-access]')
      .forEach((node) => node.remove());
    clone.querySelectorAll('.key-container .numbers, .order-container .numbers')
      .forEach((node) => { node.textContent = ZERO_KEY; });
    clone.querySelectorAll('.key-info strong, .satellite-number, .nap-value')
      .forEach((node) => { node.textContent = ZERO_VALUE; });
    clone.querySelectorAll('.cross-number').forEach((node) => { node.textContent = ZERO_CROSS; });
    clone.querySelectorAll('.cross-base-numbers, .cross-base-number').forEach((node) => node.remove());
    if (payload) paintPlan(clone, payload, featureKey, date);
    target.replaceChildren(clone);
    target.dataset.repairSignature = signature;
    card.dataset.historyState = payload ? 'cached' : 'loading';
  });
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    repairTableauCards();
  });
}

if (typeof MutationObserver === 'function' && document.body) {
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
}
window.addEventListener('cid:history-cache-written', scheduleScan);
window.addEventListener('cid:feature-access-changed', scheduleScan);
window.addEventListener('cid:auth-sync', scheduleScan);
window.addEventListener('online', scheduleScan);
window.addEventListener('cid:tableaux-history-route-ready', scheduleScan);
scheduleScan();
