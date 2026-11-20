/*
 * Supabase repository for the public feed.
 *
 * There is deliberately no local/mock fallback here. Published comments and
 * counters are read from Supabase for anonymous visitors too; mutations
 * still require an authenticated session.
 */

async function getBridge() {
  const bridge = await window.cidSupabaseReady;
  if (!bridge?.client) throw new Error('Supabase est indisponible.');
  return bridge;
}

async function getUser(action = 'effectuer cette action') {
  const bridge = await getBridge();
  const user = await bridge.getUser().catch(() => null);
  if (!user) throw new Error(`Connectez-vous à votre compte Cidmap pour ${action}.`);
  return { bridge, user };
}

function isMissingRpc(error, functionName) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST202'
    || /schema cache|could not find the function|searched for the function/i.test(message)
    || (functionName && message.includes(functionName) && /function/i.test(message));
}

function normalizeComment(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    draw_id: String(row.draw_id || ''),
    parent_id: row.parent_id || null,
    comment_text: String(row.comment_text || ''),
    status: String(row.status || 'visible'),
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}

function normalizePublicProfile(row) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    full_name: String(row.full_name || '').trim()
  };
}

export async function listPublicProfiles(userIds = []) {
  const ids = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )].slice(0, 100);
  const profiles = new Map();
  if (!ids.length) return profiles;

  try {
    const bridge = await getBridge();
    const { data, error } = await bridge.client
      .from('profiles')
      .select('id,full_name')
      .in('id', ids);
    if (error) throw error;
    (Array.isArray(data) ? data : [])
      .map(normalizePublicProfile)
      .filter(Boolean)
      .forEach((profile) => profiles.set(profile.id, profile));
  } catch (error) {
    // The public-profile migration is separate from the comment migration.
    // Keep comments readable if an older Supabase project has not run it yet.
    console.warn('Profils publics indisponibles', error);
  }
  return profiles;
}

export async function getPublicProfile(userId) {
  const profiles = await listPublicProfiles([userId]);
  return profiles.get(String(userId || '').trim()) || null;
}

export async function listCommentMetrics(commentIds = []) {
  const ids = [...new Set(
    (Array.isArray(commentIds) ? commentIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )];
  const metrics = new Map(
    ids.map((id) => [id, { likes: 0, liked: false }])
  );
  if (!ids.length) return metrics;

  try {
    const bridge = await getBridge();
    const user = await bridge.getUser().catch(() => null);
    const columns = user ? 'comment_id,user_id' : 'comment_id';
    const { data, error } = await bridge.client
      .from('comment_likes')
      .select(columns)
      .in('comment_id', ids);
    if (error) throw error;

    (Array.isArray(data) ? data : []).forEach((row) => {
      const id = String(row.comment_id || '');
      const current = metrics.get(id);
      if (!current) return;
      current.likes += 1;
      if (user && row.user_id === user.id) current.liked = true;
    });
  } catch (error) {
    // Older databases may not have the public comment-like policy yet.
    // Comments remain readable; counters simply stay at zero until migration.
    console.warn('Compteurs de likes des commentaires indisponibles', error);
  }
  return metrics;
}

export async function toggleCommentLike(commentId) {
  const { bridge, user } = await getUser('aimer ce commentaire');
  const id = String(commentId || '').trim();
  if (!id) throw new Error('Commentaire manquant.');

  const rpcResult = await bridge.client.rpc('toggle_comment_like', {
    target_comment_id: id
  });
  if (!rpcResult.error) return Boolean(rpcResult.data);

  if (!isMissingRpc(rpcResult.error, 'toggle_comment_like')) {
    throw normalizeSocialWriteError(rpcResult.error, 'like');
  }

  const existing = await bridge.client
    .from('comment_likes')
    .select('comment_id')
    .eq('comment_id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing.error) throw normalizeSocialWriteError(existing.error, 'like');

  if (existing.data) {
    const removed = await bridge.client
      .from('comment_likes')
      .delete()
      .eq('comment_id', id)
      .eq('user_id', user.id);
    if (removed.error) throw normalizeSocialWriteError(removed.error, 'like');
    return false;
  }

  const added = await bridge.client
    .from('comment_likes')
    .insert({ comment_id: id, user_id: user.id });
  if (added.error) throw normalizeSocialWriteError(added.error, 'like');
  return true;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCroixGeneration(row) {
  if (!row?.programme_date) return null;
  return {
    id: row.id,
    programme_date: String(row.programme_date),
    generated_year: Number(row.generated_year) || 0,
    generated_month: Number(row.generated_month) || 0,
    scope_key: String(row.scope_key || ''),
    term: String(row.term || ''),
    removed_digits: parseJsonArray(row.removed_digits).map(String),
    visible_terminaison: String(row.visible_terminaison || ''),
    date_sum: Number(row.date_sum) || 0,
    date_digit_sum: Number(row.date_digit_sum) || 0,
    date_finishing_digit: Number(row.date_finishing_digit) || 0,
    assignment: parseJsonArray(row.assignment).map(String),
    alignments: row.alignments || {},
    signature: String(row.signature || ''),
    created_at: row.created_at || null
  };
}

let croixHistoryRefreshPromise = null;

async function getCroixCacheService() {
  try {
    return await import('/src/croix/redCrossService.js');
  } catch (_) {
    return null;
  }
}

async function refreshCroixGenerations(safeLimit, cacheService) {
  if (croixHistoryRefreshPromise) return croixHistoryRefreshPromise;
  croixHistoryRefreshPromise = (async () => {
    const bridge = await getBridge();
    const { data, error } = await bridge.client
      .from('croix_nationale_generations')
      .select([
        'id',
        'programme_date',
        'generated_year',
        'generated_month',
        'scope_key',
        'term',
        'removed_digits',
        'visible_terminaison',
        'date_sum',
        'date_digit_sum',
        'date_finishing_digit',
        'assignment',
        'alignments',
        'signature',
        'created_at'
      ].join(','))
      .order('programme_date', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : [])
      .map(normalizeCroixGeneration)
      .filter(Boolean);
    cacheService?.cacheCroixGenerations?.(rows, undefined, safeLimit);
    window.dispatchEvent(new CustomEvent('cid:croix-history-updated', {
      detail: { rows }
    }));
    return rows;
  })().finally(() => {
    croixHistoryRefreshPromise = null;
  });
  return croixHistoryRefreshPromise;
}

export async function listCroixGenerations(limit = 31, { refreshStale = true } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 31));
  const cacheService = await getCroixCacheService();
  const cachedRows = cacheService?.getCachedCroixGenerations?.(safeLimit) || [];
  if (cachedRows.length) {
    // The cached rows paint every archive, including offline visits. When
    // online, refresh an old archive in the background from Supabase unless
    // the caller is a route transition that must stay entirely local.
    if (refreshStale
      && navigator.onLine !== false
      && !cacheService?.isCroixArchiveCacheFresh?.(safeLimit)) {
      void refreshCroixGenerations(safeLimit, cacheService)
        .catch((error) => console.warn('Actualisation de l’historique indisponible', error));
    }
    /*
     * A partial cache is still a valid offline archive. The dedicated Croix
     * view previously discarded it when refreshStale was false, then replaced
     * the whole rail with a loader if the Supabase request failed. Paint what
     * is known and let the next online refresh complete the missing dates.
     */
    return cachedRows;
  }

  // No local archive exists yet: obtain the official rows before rendering.
  return refreshCroixGenerations(safeLimit, cacheService);
}

export async function listComments(drawId) {
  const drawKey = String(drawId || '').trim();
  if (!drawKey || !(await getPublicationCommentsEnabled(drawKey))) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  // Reading published comments is public when the administrator has enabled
  // the publication. Only creating a comment still requires authentication.
  const bridge = await getBridge();
  const { data, error } = await bridge.client
    .from('comments')
    .select('id,user_id,draw_id,parent_id,comment_text,status,created_at,updated_at')
    .eq('draw_id', drawKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeComment);
}

export async function getPublicationCommentsEnabled(drawId) {
  /*
   * Public read of the per-publication comment setting. A publication with no
   * override row (and any installation still waiting for
   * SUPABASE_COMMENT_CONTROL.sql) stays closed to comments by default.
   */
  const drawKey = String(drawId || '').trim();
  const drawType = drawKey.split(':', 1)[0];
  if (typeof window.cidContentControl?.commentsEnabled !== 'function'
      || window.cidContentControl.commentsEnabled(drawKey, drawType) !== true) {
    return false;
  }
  try {
    const bridge = await getBridge();
    const { data, error } = await bridge.client
      .rpc('is_publication_comments_enabled', {
        target_draw_id: drawKey
      });
    if (error) return false;
    return data === true;
  } catch (_) {
    return false;
  }
}

export async function createComment({ drawId, text, parentId = null }) {
  const drawKey = String(drawId || '').trim();
  const commentText = String(text || '').trim();
  if (!drawKey) throw new Error('Identifiant de publication manquant.');
  if (!commentText) throw new Error('Écrivez un commentaire.');
  const drawType = drawKey.split(':', 1)[0];
  if (typeof window.cidContentControl?.commentsEnabled !== 'function'
      || window.cidContentControl.commentsEnabled(drawKey, drawType) !== true) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  if (!(await getPublicationCommentsEnabled(drawKey))) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  const { bridge, user } = await getUser('publier un commentaire');

  // Prefer the SECURITY DEFINER RPC. It validates auth.uid() inside
  // Supabase, writes a visible comment atomically, and avoids depending on
  // every older client-side INSERT policy being identical.
  const rpcResult = await bridge.client.rpc('create_public_comment', {
    target_draw_id: drawKey,
    target_comment_text: commentText,
    target_parent_id: parentId || null
  });
  if (!rpcResult.error) {
    const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    return normalizeComment(row);
  }

  // Keep compatibility with installations that have not run the hotfix yet.
  // The explicit visible status also prevents an INSERT ... RETURNING row
  // from being hidden by a stale "pending" default policy.
  if (!isMissingRpc(rpcResult.error, 'create_public_comment')) {
    throw normalizeSocialWriteError(rpcResult.error, 'commentaire');
  }

  const { data, error } = await bridge.client
    .from('comments')
    .insert({
      user_id: user.id,
      draw_id: drawKey,
      parent_id: parentId || null,
      comment_text: commentText,
      status: 'visible'
    })
    .select('id,user_id,draw_id,parent_id,comment_text,status,created_at,updated_at')
    .single();
  if (error) throw normalizeSocialWriteError(error, 'commentaire');
  return normalizeComment(data);
}

export async function getPostMetrics(drawId) {
  // Public counters can be read by visitors; the like/share mutations below
  // continue to require authentication.
  const bridge = await getBridge();
  const user = await bridge.getUser().catch(() => null);
  const key = String(drawId);
  const likesColumns = user ? 'user_id' : 'draw_id';
  const [likesResult, sharesResult] = await Promise.all([
    bridge.client.from('post_likes').select(likesColumns).eq('draw_id', key),
    bridge.client.from('post_shares').select('draw_id').eq('draw_id', key)
  ]);
  if (likesResult.error) throw likesResult.error;
  if (sharesResult.error) throw sharesResult.error;
  const likes = Array.isArray(likesResult.data) ? likesResult.data : [];
  return {
    likes: likes.length,
    shares: Array.isArray(sharesResult.data) ? sharesResult.data.length : 0,
    liked: Boolean(user && likes.some((row) => row.user_id === user.id))
  };
}

export async function togglePostLike(drawId) {
  const { bridge, user } = await getUser('aimer cette publication');
  const key = String(drawId || '').trim();
  if (!key) throw new Error('Identifiant de publication manquant.');

  const { data, error } = await bridge.client.rpc('toggle_post_like', {
    target_draw_id: key
  });
  if (!error) return Boolean(data);

  // Older deployments may have the tables and RLS policies but not yet the
  // SECURITY DEFINER RPC in PostgREST's schema cache. Keep likes usable while
  // the SQL migration is being refreshed; the RPC remains the preferred path
  // because it is atomic and also creates notifications.
  if (!isMissingRpc(error, 'toggle_post_like')) {
    throw normalizeSocialWriteError(error, 'like');
  }

  const existing = await bridge.client
    .from('post_likes')
    .select('draw_id')
    .eq('draw_id', key)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing.error) throw normalizeSocialWriteError(existing.error, 'like');

  if (existing.data) {
    const removed = await bridge.client
      .from('post_likes')
      .delete()
      .eq('draw_id', key)
      .eq('user_id', user.id);
    if (removed.error) throw normalizeSocialWriteError(removed.error, 'like');
    return false;
  }

  const added = await bridge.client
    .from('post_likes')
    .insert({ draw_id: key, user_id: user.id });
  if (added.error) throw normalizeSocialWriteError(added.error, 'like');
  return true;
}

function normalizeSocialWriteError(error, entity) {
  const message = String(error?.message || '');
  if (/connexion requise|not authenticated|jwt|auth session missing/i.test(message)) {
    const action = entity === 'like'
      ? 'aimer cette publication'
      : entity === 'commentaire'
        ? 'publier un commentaire'
        : 'effectuer cette action';
    return new Error(`Connectez-vous à votre compte Cidmap pour ${action}.`);
  }
  if (/row-level security|permission denied|violates.*policy/i.test(message)) {
    return new Error(
      `La base sociale refuse ce ${entity}. Exécutez la migration SUPABASE_SOCIAL_HOTFIX.sql dans Supabase.`
    );
  }
  return error;
}

export async function recordPostShare(drawId, channel = 'unknown') {
  const { bridge } = await getUser('partager cette publication');
  const { data, error } = await bridge.client.rpc('record_post_share', {
    target_draw_id: String(drawId),
    target_channel: String(channel || 'unknown')
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function recordCoreCalculation(feature, programmeDate, payload = {}) {
  const { bridge } = await getUser('enregistrer ce calcul');
  const { data, error } = await bridge.client.rpc('record_core_calculation', {
    feature_name: String(feature),
    target_programme_date: programmeDate || null,
    calculation_payload: payload
  });
  if (error) throw error;
  return data;
}

export async function subscribeToFeed(callback) {
  // Keep the real-time feed available to anonymous visitors too. RLS still
  // decides which rows may be delivered; posting remains authenticated.
  const bridge = await getBridge();
  const channel = bridge.client
    .channel('cid-feed-public')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments' },
      (payload) => callback({ table: 'comments', payload })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_likes' },
      (payload) => callback({ table: 'post_likes', payload })
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_shares' },
      (payload) => callback({ table: 'post_shares', payload })
    );
  await channel.subscribe();
  return () => {
    bridge.client.removeChannel(channel);
  };
}

window.cidSocialRepository = Object.freeze({
  createComment,
  getPublicProfile,
  getPostMetrics,
  getPublicationCommentsEnabled,
  listCommentMetrics,
  listPublicProfiles,
  listCroixGenerations,
  listComments,
  recordCoreCalculation,
  recordPostShare,
  subscribeToFeed,
  toggleCommentLike,
  togglePostLike
});
