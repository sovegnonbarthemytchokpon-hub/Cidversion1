/*
 * Supabase notification repository.
 *
 * Notifications are private rows addressed to auth.uid(). The browser never
 * fabricates notifications and never writes a recipient id; database
 * triggers/RPCs own creation and RLS owns access.
 */
(function initCidNotificationRepository() {
  'use strict';

  let realtimeChannel = null;
  let realtimeCleanup = null;

  async function getBridgeAndUser() {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client) throw new Error('Supabase est indisponible.');
    const user = await bridge.getUser();
    if (!user) throw new Error('Connexion requise.');
    return { bridge, user };
  }

  function normalize(row) {
    return {
      id: row.id,
      type: String(row.type || 'INFO').toUpperCase(),
      title: String(row.title || ''),
      message: String(row.message || ''),
      actor_id: row.actor_id || null,
      conversation_id: row.conversation_id || null,
      post_id: row.post_id || null,
      comment_id: row.comment_id || null,
      is_read: Boolean(row.is_read),
      read_at: row.read_at || null,
      created_at: row.created_at
    };
  }

  async function list() {
    const { bridge, user } = await getBridgeAndUser();
    const { data, error } = await bridge.client
      .from('notifications')
      .select('id,user_id,actor_id,conversation_id,type,title,message,post_id,comment_id,is_read,read_at,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalize);
  }

  async function markRead(id) {
    const { bridge, user } = await getBridgeAndUser();
    const { error } = await bridge.client
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;
  }

  async function markAllRead() {
    const { bridge, user } = await getBridgeAndUser();
    const { error } = await bridge.client
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) throw error;
  }

  async function isAdminRecipient() {
    try {
      const { bridge, user } = await getBridgeAndUser();
      const { data, error } = await bridge.client
        .from('notification_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) return false;
      return Boolean(data?.user_id);
    } catch (_) {
      return false;
    }
  }

  async function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    const { bridge, user } = await getBridgeAndUser();
    if (realtimeChannel) {
      bridge.client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeCleanup?.();
    realtimeCleanup = null;

    realtimeChannel = bridge.client
      .channel(`cid-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => callback({ table: 'notifications', payload })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notification_admins' },
        (payload) => callback({ table: 'notification_admins', payload })
      );

    const result = await realtimeChannel.subscribe();
    if (result === 'CHANNEL_ERROR' || result === 'TIMED_OUT') {
      throw new Error('Le temps réel des notifications est indisponible.');
    }

    realtimeCleanup = () => {
      if (realtimeChannel) bridge.client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    };
    return realtimeCleanup;
  }

  window.cidNotificationRepository = Object.freeze({
    list,
    markRead,
    markAllRead,
    isAdminRecipient,
    subscribe
  });
})();
