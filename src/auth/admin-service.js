/*
 * Server boundary for the Admin dashboard.
 *
 * Reads and writes go through authenticated administrator Edge Functions. The
 * browser never receives a service-role key and never mutates subscription,
 * pricing, payment or program tables directly.
 */
import { supabaseClient } from '../services/supabaseClient.js';

const emptyAccess = Object.freeze({
  plans: [],
  rules: [],
  subscriptions: [],
  settings: { payment_mode: 'manual', paystack_enabled: false },
  requests: [],
  starPrices: [],
  tokenPrices: []
});

async function errorMessage(error, fallback) {
  const directMessage = String(error?.message || '').trim();
  const isResponseLike = (value) => value
    && typeof value.clone === 'function'
    && typeof value.json === 'function';
  const response = isResponseLike(error?.context)
    ? error.context
    : isResponseLike(error?.context?.response)
      ? error.context.response
      : null;

  // supabase-js uses a generic FunctionsHttpError message for non-2xx
  // responses. The Edge Function's JSON body contains the actionable reason.
  if (response) {
    try {
      const payload = await response.clone().json();
      const serverMessage = String(payload?.error || payload?.message || '').trim();
      if (serverMessage) return serverMessage;
    } catch (_) {
      // Keep the SDK message when the response is not JSON.
    }
  }
  return directMessage || fallback;
}

async function adminErrorMessage(error, fallback) {
  const message = await errorMessage(error, fallback);
  if (/foreign key|violates foreign key|plan_slug|subscription_plans/i.test(message)) {
    return 'Cette offre est encore liée à des abonnements ou à un historique. La suppression va détacher ces liens puis conserver l’historique.';
  }
  return message;
}

async function getClientAndUser() {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw new Error('Connexion administrateur indisponible.');
  const { data, error } = await client.auth.getUser();
  if (error && Number(error.status) !== 401 && error.name !== 'AuthSessionMissingError') {
    throw new Error('Impossible de vérifier la session administrateur.');
  }
  return { client, user: data?.user || null };
}

export async function requestAdmin(body = {}) {
  const { client, user } = await getClientAndUser();
  if (!user?.id) {
    throw new Error('Accès administrateur refusé.');
  }
  const action = String(body?.action || 'list').trim().toLowerCase();
  // admin-program-control is retired. All administrator actions, including
  // matrix sources and program methods, now use the secured controller that
  // owns the deployed database contract.
  const functionName = 'admin-method-control';
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) {
    const message = await errorMessage(error, 'Le service administrateur est indisponible.');
    const isTokenAction = ['save-token-price', 'delete-token-price'].includes(
      String(body?.action || '').trim().toLowerCase()
    );
    if (isTokenAction && /action inconnue|non-2xx|failed to send|edge function/i.test(message)) {
      throw new Error('La fonction administrateur ou le schéma token_prices n’est pas à jour. Vérifiez pack_id, name, quantity, price_xof puis redéployez admin-method-control.');
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(await errorMessage(
    { message: data?.error },
    'Commande administrateur refusée.'
  ));
  return data;
}

export async function checkAdminAccess(profile = null) {
  // A profile hydrated from user_roles may already carry the confirmation.
  // Keep this guard defensive: undefined fields are a normal state during
  // the first authenticated paint and must not throw.
  const configuredAdmin = profile?.role || profile?.is_admin;
  if (configuredAdmin === 'admin' || configuredAdmin === true || configuredAdmin === 'true') {
    return true;
  }
  try {
    /*
     * The role table is the authoritative source already verified in
     * Supabase. Prefer its SECURITY DEFINER helper so the account UI does not
     * stay hidden merely because an older admin-method-control deployment is
     * still serving the previous list-access contract.
     */
    const { client, user } = await getClientAndUser();
    if (user?.id && client?.rpc) {
      const { data: roleCheck, error: roleCheckError } = await client.rpc(
        'has_role',
        {
          requested_user_id: user.id,
          requested_role: 'admin'
        }
      );
      if (!roleCheckError && roleCheck === true) return true;
    }

    // The Edge Function performs the authoritative user_roles check with its
    // server client. This avoids a false negative caused by client-side RLS.
    await requestAdmin({ action: 'list-access' });
    return true;
  } catch (_) {
    // Compatibility fallback for an installation where the Admin Edge
    // Function has not yet been redeployed. It is only used to reveal the
    // entry point; every read/write remains protected by requestAdmin().
    try {
      const { client, user } = await getClientAndUser();
      if (!user?.id) return false;
      const { data, error } = await client
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      return !error && data?.role === 'admin';
    } catch (_) {
      return false;
    }
  }
}

async function requestAdminDatabase(functionName, args = {}) {
  const { client, user } = await getClientAndUser();
  if (!user?.id) throw new Error('Accès administrateur refusé.');
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw new Error(await adminErrorMessage(error, 'La commande administrateur a échoué.'));
  if (data?.ok === false) throw new Error(await adminErrorMessage(
    { message: data.error },
    'La commande administrateur a été refusée.'
  ));
  return data || { ok: true };
}

export async function fetchAdminData() {
  const data = await requestAdmin({ action: 'list-access' });
  const access = data.access || {};
  return {
    ...emptyAccess,
    ...access,
    settings: { ...emptyAccess.settings, ...(access.settings || {}) }
  };
}

export async function saveAdminPlan(plan) {
  const data = await requestAdmin({
    action: 'save-access-plan',
    slug: plan.slug,
    displayName: plan.display_name,
    requiredStars: Number(plan.required_stars),
    unlockCurrency: plan.unlock_currency || 'stars',
    requiredTokens: Number(plan.required_tokens ?? 0),
    regularTokens: Number(plan.regular_tokens ?? plan.required_tokens ?? 0),
    durationDays: Number(plan.duration_days),
    referralRewardStars: Number(plan.referral_reward_stars),
    referralRewardTokens: Number(plan.referral_reward_tokens ?? 0),
    // Payment configuration is managed exclusively by the Payments view.
    paymentMode: plan.payment_mode || 'manual',
    priceLabel: plan.price_label,
    features: Array.isArray(plan.features) ? plan.features : [],
    enabled: plan.enabled !== false
  });
  return data.plan;
}

export async function deleteAdminPlan(slug, compensation = []) {
  const normalizedCompensation = Array.isArray(compensation) ? compensation : [];
  try {
    return await requestAdmin({
      action: 'delete-access-plan',
      slug,
      compensation: normalizedCompensation
    });
  } catch (error) {
    // A deployment may have the small admin deletion migration but not yet
    // the later compensation RPC. Use the authenticated, admin-guarded
    // legacy function for a plain deletion so an offer linked to users can
    // still be removed completely.
    const message = String(error?.message || '');
    const canUseLegacyDelete = normalizedCompensation.length === 0
      && /admin_delete_access_plan_with_compensation|function .* does not exist|failed to send|edge function|action inconnue/i
        .test(message);
    if (!canUseLegacyDelete) throw error;
    return requestAdminDatabase('admin_delete_access_plan', {
      target_slug: slug
    });
  }
}

export async function deleteAdminAccessRule(featureKey) {
  return requestAdmin({
    action: 'delete-access-rule',
    featureKey: String(featureKey || '').trim()
  });
}

export async function deleteAdminEarlyAccessRule(featureKey) {
  return requestAdmin({
    action: 'delete-early-access-rule',
    featureKey: String(featureKey || '').trim()
  });
}

export async function saveAdminPayment(settings) {
  const data = await requestAdmin({
    action: 'save-payment-settings',
    paymentMode: settings.payment_mode,
    onlineProvider: settings.online_provider,
    onlinePaymentLink: settings.online_payment_link,
    physicalInstructions: settings.physical_instructions,
    contactLabel: settings.contact_label,
    manualEnabled: settings.manual_enabled !== false,
    currencyMode: settings.currency_mode || '',
    contactChannel: settings.contact_channel || '',
    whatsappNumber: settings.whatsapp_number || '',
    chatLabel: settings.chat_label || 'Contacter l’équipe',
    socialLinks: settings.social_links ?? settings.socialLinks ?? ''
  });
  return data.settings;
}

export async function saveAdminCommentRule(key, enabled) {
  const result = await requestAdmin({
    action: 'save-comment-rule',
    key: String(key || '').trim(),
    enabled: enabled !== false
  });
  window.dispatchEvent(new CustomEvent('cid:comments-settings-updated'));
  return result;
}

export async function deleteAdminCommentRule(key) {
  const result = await requestAdmin({
    action: 'delete-comment-rule',
    key: String(key || '').trim()
  });
  window.dispatchEvent(new CustomEvent('cid:comments-settings-updated'));
  return result;
}

export async function saveAdminContentLock(lock) {
  return requestAdmin({ action: 'save-content-lock', ...(lock || {}) });
}

export async function deleteAdminContentLock(id) {
  return requestAdmin({ action: 'delete-content-lock', id: Number(id) || 0 });
}

export async function saveAdminPrice(price) {
  const data = await requestAdmin({
    action: 'save-star-price',
    countryCode: price.country_code,
    countryName: price.country_name,
    currencyCode: price.currency_code,
    currencySymbol: price.currency_symbol,
    pricePerStar: Number(price.price_per_star),
    enabled: price.enabled !== false
  });
  return data.starPrice;
}

export async function deleteAdminPrice(countryCode) {
  return requestAdmin({ action: 'delete-star-price', countryCode });
}

export async function saveAdminTokenPrice(price) {
  const data = await requestAdmin({
    action: 'save-token-price',
    packId: price.pack_id,
    name: price.name,
    quantity: Number(price.quantity),
    priceXof: Number(price.price_xof)
  });
  return data.tokenPrice;
}

export async function deleteAdminTokenPrice(packId) {
  return requestAdmin({ action: 'delete-token-price', packId });
}

export async function searchAdminUsers(email) {
  const data = await requestAdmin({ action: 'search-users', email });
  return Array.isArray(data.users) ? data.users : [];
}

export async function grantAdminBalance({
  userId,
  stars = 0,
  tokens = 0,
  note = '',
  proofReference = ''
} = {}) {
  const data = await requestAdmin({
    action: 'grant-balance',
    userId,
    stars: Number(stars),
    tokens: Number(tokens),
    note,
    proofReference
  });
  return data;
}

export async function grantAdminSubscription({
  userId,
  planSlug,
  durationDays,
  note = ''
} = {}) {
  return requestAdmin({
    action: 'grant-subscription',
    userId,
    planSlug,
    durationDays: Number(durationDays) || undefined,
    note
  });
}

export async function fetchAdminTableauAccess() {
  const data = await requestAdminDatabase('admin_list_tableau_access');
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.accesses)
      ? data.accesses
      : Array.isArray(data?.rows)
        ? data.rows
        : [];
}

export async function grantAdminTableauAccess({
  userId,
  featureKey,
  durationDays,
  transactionReference = '',
  note = ''
} = {}) {
  return requestAdminDatabase('admin_grant_tableau_access', {
    target_user_id: userId,
    target_feature_key: featureKey,
    target_duration_days: Number(durationDays) || null,
    target_transaction_reference: transactionReference,
    target_note: note
  });
}

export async function revokeAdminTableauAccess({
  userId,
  featureKey,
  note = ''
} = {}) {
  return requestAdminDatabase('admin_revoke_tableau_access', {
    target_user_id: userId,
    target_feature_key: featureKey,
    target_note: note
  });
}

export async function listPromoBanners() {
  const data = await requestAdmin({ action: 'list-promo-banners' });
  return Array.isArray(data.banners) ? data.banners : [];
}

export async function savePromoBanner(banner = {}) {
  const data = await requestAdmin({
    action: 'save-promo-banner',
    id: banner.id || undefined,
    countryCode: banner.country_code || banner.countryCode || 'ALL',
    placement: banner.placement || 'homepage',
    title: banner.title,
    titleI18n: banner.title_i18n || banner.titleI18n || {},
    description: banner.description || '',
    descriptionI18n: banner.description_i18n || banner.descriptionI18n || {},
    featureKey: banner.feature_key || banner.featureKey || '',
    keyValue: banner.key_value || banner.keyValue || '',
    imageUrl: banner.image_url || banner.imageUrl || '',
    targetUrl: banner.target_url || banner.targetUrl || '',
    actionLabel: banner.action_label || banner.actionLabel || '',
    actionLabelI18n: banner.action_label_i18n || banner.actionLabelI18n || {},
    sortOrder: Number(banner.sort_order ?? banner.sortOrder ?? 0),
    startsAt: banner.starts_at || banner.startsAt || '',
    endsAt: banner.ends_at || banner.endsAt || '',
    enabled: banner.enabled !== false
  });
  return data.banner || data;
}

export async function deletePromoBanner(id) {
  return requestAdmin({ action: 'delete-promo-banner', id });
}

export async function fetchAdminReferralSettings() {
  const data = await requestAdmin({ action: 'list-referral-settings' });
  return data.settings || null;
}

export async function saveAdminReferralSettings(settings = {}) {
  const data = await requestAdmin({
    action: 'save-referral-settings',
    enabled: settings.enabled !== false,
    shareRewardStars: Number(settings.share_reward_stars ?? settings.shareRewardStars ?? 0),
    shareRewardTokens: Number(settings.share_reward_tokens ?? settings.shareRewardTokens ?? 0),
    signupRewardStars: Number(settings.signup_reward_stars ?? settings.signupRewardStars ?? 0),
    signupRewardTokens: Number(settings.signup_reward_tokens ?? settings.signupRewardTokens ?? 0),
    unlockRewardStars: Number(settings.unlock_reward_stars ?? settings.unlockRewardStars ?? 0),
    unlockRewardTokens: Number(settings.unlock_reward_tokens ?? settings.unlockRewardTokens ?? 0),
    maxShareRewardsPerDay: Number(
      settings.max_share_rewards_per_day ?? settings.maxShareRewardsPerDay ?? 10
    )
  });
  return data.settings || null;
}

async function requestResultatAide(body = {}) {
  const { client, user } = await getClientAndUser();
  if (!user?.id) throw new Error('Accès administrateur refusé.');
  const { data, error } = await client.functions.invoke('result-helf', { body });
  if (error) throw new Error(await errorMessage(error, 'Le service Résultat-Aide est indisponible.'));
  if (!data?.ok) throw new Error(data?.error || 'Commande Résultat-Aide refusée.');
  return data;
}

export async function fetchResultatAideDashboard(filters = {}) {
  return requestResultatAide({
    action: 'admin-dashboard',
    countryCode: filters.countryCode || '',
    status: filters.status || '',
    fromDate: filters.fromDate || '',
    toDate: filters.toDate || '',
    weekKey: filters.weekKey || '',
    monthKey: filters.monthKey || '',
    drawTime: filters.drawTime || ''
  });
}

export async function validateResultatAideDraw(drawId, status = 'published', note = '') {
  return requestResultatAide({
    action: 'validate-draw',
    drawId,
    status,
    note
  });
}

export async function deleteResultatAideDraw(drawId) {
  return requestResultatAide({
    action: 'delete-draw',
    drawId
  });
}

export async function importAdminResultatAideDraws({ countryCode, draws, source = 'admin-import-document' } = {}) {
  return requestResultatAide({
    action: 'admin-import-draws',
    countryCode,
    draws: Array.isArray(draws) ? draws : [],
    source
  });
}

export async function fetchAdminResultSchedules(countryCode) {
  return requestResultatAide({
    action: 'admin-result-schedules',
    countryCode
  });
}

export async function saveAdminResultSchedules(countryCode, schedules) {
  return requestResultatAide({
    action: 'admin-save-result-schedules',
    countryCode,
    schedules: Array.isArray(schedules) ? schedules : []
  });
}

export async function fetchProgramsData() {
  const data = await requestAdmin({ action: 'list' });
  return {
    controls: data.controls || [],
    programs: data.programs || [],
    modules: data.modules || [],
    methods: data.methods || []
  };
}

export async function fetchAdminConfig() {
  let data;
  try {
    data = await requestAdmin({ action: 'list-admin-config' });
  } catch (error) {
    // Keep the existing dashboard usable during a rolling Edge Function
    // deployment. The new cards become active as soon as the function and
    // SUPABASE_ADMIN_FACTORY.sql are installed.
    if (!/action inconnue|admin_draw_sources|admin_control_settings|admin_user_permissions|fonction administrateur/i
      .test(String(error?.message || ''))) throw error;
    return {
      admins: [], principalUserId: null, permissionOptions: [], drawSources: []
    };
  }
  return {
    admins: Array.isArray(data.admins) ? data.admins : [],
    principalUserId: data.principalUserId || null,
    permissionOptions: Array.isArray(data.permissionOptions) ? data.permissionOptions : [],
    drawSources: Array.isArray(data.drawSources) ? data.drawSources : [],
    generationPolicy: data.generationPolicy || {
      generationTime: '16:00',
      timeZone: 'Africa/Abidjan',
      scope: 'global',
      enabled: true
    }
  };
}

export async function saveAdminUser(admin) {
  const data = await requestAdmin({
    action: 'save-admin',
    email: admin.email,
    role: admin.role,
    permissions: Array.isArray(admin.permissions) ? admin.permissions : []
  });
  return data.admin;
}

export async function deleteAdminUser(userId) {
  return requestAdmin({ action: 'delete-admin', userId });
}

export async function saveAdminDrawSource(source) {
  const data = await requestAdmin({
    action: 'save-draw-source',
    id: source.id || undefined,
    moduleKey: source.module_key || source.moduleKey,
    countryCode: source.country_code || source.countryCode,
    countryName: source.country_name || source.countryName,
    drawName: source.draw_name || source.drawName,
    drawTime: source.draw_time || source.drawTime,
    matrix: source.matrix || {},
    keyboard: source.keyboard || {},
    cerveau: source.cerveau || {},
    code: source.code || '',
    event: source.event || '',
    settings: source.settings || {},
    generationDays: Array.isArray(source.generationDays)
      ? source.generationDays
      : undefined,
    enabled: source.enabled !== false
  });
  return data.drawSource;
}

export async function deleteAdminDrawSource(id) {
  return requestAdmin({ action: 'delete-draw-source', id });
}

export async function generateAdminDrawSource(source) {
  const data = await requestAdmin({
    action: 'generate-draw-source',
    moduleKey: source.module_key || source.moduleKey || '',
    countryCode: source.country_code || source.countryCode,
    countryName: source.country_name || source.countryName,
    drawName: source.draw_name || source.drawName,
    // drawTime is the country's programme/draw time. The generation boundary
    // is global and is deliberately not sent by the browser.
    drawTime: source.draw_time || source.drawTime,
    hasKeyboard: source.hasKeyboard !== false,
    hasCerveau: source.hasCerveau === true,
    hasCode: source.hasCode !== false,
    hasEvent: source.hasEvent !== false,
    generationDays: Array.isArray(source.generationDays)
      ? source.generationDays
      : undefined,
    enabled: source.enabled !== false
  });
  return data.drawSource;
}

export async function fetchAdminCrossGenerations() {
  const data = await requestAdmin({ action: 'list-cross-generations' });
  return Array.isArray(data.crossGenerations) ? data.crossGenerations : [];
}

export async function deleteAdminCrossGeneration({ id, programmeDate } = {}) {
  return requestAdmin({
    action: 'delete-cross-generation',
    id: Number(id) || undefined,
    programmeDate: programmeDate || undefined
  });
}

export async function duplicateAdminProgram(program) {
  const data = await requestAdmin({
    action: 'duplicate-program',
    sourceProgram: program.sourceProgram,
    program: program.program,
    displayName: program.displayName,
    schedules: program.schedules,
    theme: program.theme,
    visualTemplate: program.visualTemplate || program.sourceTemplate
  });
  return data;
}

export async function previewAdminProgram(program, date, rule) {
  const data = await requestAdmin({
    action: 'preview-program',
    program,
    date,
    rule
  });
  return data.preview || null;
}

export async function fetchBalsaProgram(date) {
  const data = await requestAdmin({
    action: 'list-balsa-program',
    date
  });
  return data.balsaProgram || null;
}

export async function fetchValidNumbers(date) {
  const body = { action: 'list-valid-numbers' };
  if (date) body.date = date;
  const data = await requestAdmin(body);
  return {
    date: data.date || date,
    plans: data.programs || {},
    errors: Array.isArray(data.errors) ? data.errors : []
  };
}

export async function createProgram(program) {
  const data = await requestAdmin({
    action: 'create-program',
    program: program.program,
    displayName: program.displayName,
    sourceTemplate: program.sourceTemplate || 'universelle',
    visualTemplate: program.visualTemplate || program.sourceTemplate || 'universelle',
    schedules: program.schedules || [],
    theme: program.theme || {},
    rule: program.rule || {},
    tests: program.tests || [],
    instructions: program.instructions || ''
  });
  return data;
}

export async function saveProgramDraft(program) {
  const data = await requestAdmin({
    action: 'save-draft',
    program: program.program,
    rule: program.rule || {},
    tests: program.tests || [],
    instructions: program.instructions || ''
  });
  return data.control || data;
}

export async function testProgramDraft(program) {
  return requestAdmin({
    action: 'test',
    program: program.program,
    rule: program.rule || {},
    tests: program.tests || []
  });
}

export async function publishProgram(program, version) {
  return requestAdmin({ action: 'publish', program, version: Number(version) });
}

export async function deleteAdminProgram(program) {
  return requestAdmin({ action: 'delete-program', program });
}

export async function fetchCommentSettings() {
  const data = await requestAdmin({ action: 'list-comment-settings' });
  return Array.isArray(data.settings) ? data.settings : [];
}

export async function setPublicationCommentsEnabled(drawId, enabled) {
  const data = await requestAdmin({
    action: 'set-comments-enabled',
    drawId,
    enabled: enabled !== false
  });
  window.dispatchEvent(new CustomEvent('cid:comments-settings-updated', {
    detail: { drawId: String(drawId || '').trim(), enabled: enabled !== false }
  }));
  return data.setting || data;
}

async function requestChatKnowledge(path = '/api/admin/chat-knowledge', options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || 'La base de connaissances est indisponible.');
  }
  return payload;
}

export async function fetchAdminChatKnowledge() {
  const data = await requestChatKnowledge();
  return Array.isArray(data.entries) ? data.entries : [];
}

export async function saveAdminChatKnowledge(entry) {
  const data = await requestChatKnowledge('/api/admin/chat-knowledge', {
    method: 'POST',
    body: JSON.stringify(entry || {})
  });
  return data.entry || null;
}

export async function deleteAdminChatKnowledge(id) {
  return requestChatKnowledge(`/api/admin/chat-knowledge/${encodeURIComponent(Number(id))}`, {
    method: 'DELETE'
  });
}

export const adminService = Object.freeze({
  requestAdmin,
  checkAdminAccess,
  fetchAdminData,
  saveAdminPlan,
  deleteAdminPlan,
  deleteAdminAccessRule,
  deleteAdminEarlyAccessRule,
  saveAdminPayment,
  saveAdminPrice,
  deleteAdminPrice,
  saveAdminTokenPrice,
  deleteAdminTokenPrice,
  searchAdminUsers,
  grantAdminBalance,
  grantAdminSubscription,
  fetchAdminTableauAccess,
  grantAdminTableauAccess,
  revokeAdminTableauAccess,
  fetchAdminReferralSettings,
  saveAdminReferralSettings,
  requestResultatAide,
  fetchResultatAideDashboard,
  validateResultatAideDraw,
  importAdminResultatAideDraws,
  fetchAdminResultSchedules,
  saveAdminResultSchedules,
  fetchProgramsData,
  fetchAdminConfig,
  saveAdminUser,
  deleteAdminUser,
  saveAdminDrawSource,
  deleteAdminDrawSource,
  generateAdminDrawSource,
  fetchAdminCrossGenerations,
  deleteAdminCrossGeneration,
  duplicateAdminProgram,
  previewAdminProgram,
  fetchBalsaProgram,
  fetchValidNumbers,
  createProgram,
  saveProgramDraft,
  testProgramDraft,
  publishProgram,
  deleteAdminProgram,
  fetchCommentSettings,
  setPublicationCommentsEnabled,
  saveAdminCommentRule,
  deleteAdminCommentRule,
  saveAdminContentLock,
  deleteAdminContentLock,
  fetchAdminChatKnowledge,
  saveAdminChatKnowledge,
  deleteAdminChatKnowledge
});

window.cidAdminService = adminService;
