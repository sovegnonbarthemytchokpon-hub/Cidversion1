/*
 * Account messaging repository.
 *
 * Supabase is the sole source of truth for authenticated accounts:
 * conversations, messages and notification triggers live together there.
 */
(function initCidMessageRepository() {
  'use strict';

  const clean = (value) => String(value || '').trim();

  function currentLocale() {
    return window.cidTranslation?.current?.()
      || window.cidSiteConfig?.localization?.()?.selectedLocale
      || 'fr';
  }

  function normalizeSupabaseMessage(row) {
    const isAdmin = String(row?.sender_type || '').toUpperCase() === 'ADMIN';
    return {
      id: row.id,
      subject: '',
      body: String(row.content || ''),
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'admin' : 'user',
      isRead: Boolean(row.is_read),
      createdAt: row.created_at
    };
  }

  async function getSupabaseContext(profile) {
    if (!profile?.uid) return null;
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client) return null;
    const user = await bridge.getUser();
    if (!user || user.id !== profile.uid) return null;
    return { bridge, user };
  }

  async function getConversation(context, { conversationId = '', create = false } = {}) {
    const { bridge, user } = context;
    let query = bridge.client
      .from('conversations')
      .select('id')
      .eq('user_id', user.id);
    if (conversationId) query = query.eq('id', conversationId);
    const existing = await query.maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data;
    if (!create) return null;

    const created = await bridge.client
      .from('conversations')
      .insert({
        user_id: user.id,
        unread_count_user: 0,
        unread_count_admin: 0
      })
      .select('id')
      .single();
    if (!created.error) return created.data;

    // A concurrent login or the Auth trigger may have created it between
    // the first read and this insert. Read it once more before failing.
    const retry = await bridge.client
      .from('conversations')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (retry.error) throw retry.error;
    if (retry.data?.id) return retry.data;
    throw created.error;
  }

  async function requestSupport(context, body = {}) {
    const { data, error } = await context.bridge.client.functions.invoke('support-chat', { body });
    if (error) {
      const response = error?.context;
      if (response?.clone) {
        try {
          const payload = await response.clone().json();
          if (payload?.error) {
            const supportError = new Error(payload.error);
            supportError.access = payload.access || null;
            throw supportError;
          }
        } catch (nested) {
          if (nested?.message && nested.message !== error.message) throw nested;
        }
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  async function listFromSupabase(context, profile, options = {}) {
    const conversation = await getConversation(context, {
      conversationId: options.conversationId,
      create: false
    });
    if (!conversation?.id) return [];

    const { data, error } = await context.bridge.client
      .from('messages')
      .select('id,conversation_id,sender_type,content,status,is_read,created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalizeSupabaseMessage);
  }

  async function sendFromSupabase(context, profile, { subject = '', body = '', conversationId = '' } = {}) {
    const conversation = await getConversation(context, {
      conversationId,
      create: true
    });
    const content = clean(body);
    if (!content) throw new Error('Écrivez votre message avant de l’envoyer.');

    const { data, error } = await context.bridge.client
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'USER',
        content,
        status: 'SENT',
        is_read: true
      })
      .select('id,conversation_id,sender_type,content,status,is_read,created_at')
      .single();
    if (error) throw error;
    return normalizeSupabaseMessage(data);
  }

  async function unreadCountFromSupabase(context) {
    const conversation = await getConversation(context, { create: false });
    if (!conversation?.id) return 0;

    const { count, error } = await context.bridge.client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'ADMIN')
      .eq('is_read', false);
    if (error) throw error;
    return Math.max(0, Number(count) || 0);
  }

  async function markReadFromSupabase(context) {
    const conversation = await getConversation(context, { create: false });
    if (!conversation?.id) return;

    const { error } = await context.bridge.client
      .from('messages')
      .update({ is_read: true, status: 'READ' })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'ADMIN')
      .eq('is_read', false);
    if (error) throw error;
  }

  async function list(profile, options = {}) {
    const context = await getSupabaseContext(profile);
    if (!context) throw new Error('Connexion distante requise pour consulter vos messages.');
    const result = await requestSupport(context, {
      action: 'state',
      localeCode: currentLocale()
    });
    return (result.messages || []).map(normalizeSupabaseMessage);
  }

  async function send(profile, payload = {}) {
    const context = await getSupabaseContext(profile);
    if (!context) throw new Error('Connexion distante requise pour envoyer un message.');
    const result = await requestSupport(context, {
      action: 'send',
      content: payload.body || ''
    });
    return normalizeSupabaseMessage(result.message);
  }

  async function unreadCount(profile) {
    const context = await getSupabaseContext(profile);
    if (!context) throw new Error('Connexion distante requise pour consulter vos messages.');
    return unreadCountFromSupabase(context);
  }

  async function markRead(profile) {
    const context = await getSupabaseContext(profile);
    if (!context) throw new Error('Connexion distante requise pour modifier vos messages.');
    await markReadFromSupabase(context);
  }

  async function state(profile) {
    const context = await getSupabaseContext(profile);
    if (!context) throw new Error('Connexion distante requise pour accéder à l’aide.');
    const result = await requestSupport(context, {
      action: 'state',
      localeCode: currentLocale()
    });
    return {
      access: result.access || null,
      conversation: result.conversation || null,
      messages: (result.messages || []).map(normalizeSupabaseMessage)
    };
  }

  window.cidMessageRepository = Object.freeze({
    list,
    send,
    unreadCount,
    markRead,
    state
  });
})();
