/*
 * Notification center UI.
 *
 * Rendering and interaction stay here; storage and Realtime are delegated to
 * cidNotificationRepository.
 */
(function initCidNotificationCenter() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const ti = (key, values, fallback = key) => Object.entries(values || {})
    .reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
      t(key, fallback)
    );

  function notificationKind(notification) {
    const type = String(notification?.type || '').toUpperCase();
    const text = `${notification?.title || ''} ${notification?.message || ''}`
      .toLocaleLowerCase('fr-FR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (
      ['PURCHASE', 'PAYMENT', 'ACCOUNT_PURCHASE', 'TOP_UP'].includes(type)
      || /achat|paiement|recharg|payment|purchase|top[\s-]?up|credit valide|credit.*(?:jeton|etoile)|ajout.*(?:jeton|etoile)/.test(text)
    ) {
      return 'purchase';
    }
    if (
      /parrain|parrainage|referral|partage|share|faire connaitre|faire connaître/.test(text)
      && !/abonnement|paiement|achat/.test(text)
    ) {
      return 'referral';
    }
    if (
      /abonnement|renouvel|schema debloque|acces debloque|acces jusqu|tableau debloque/.test(text)
    ) {
      return 'access';
    }
    if (['REWARD', 'ACCOUNT_REWARD'].includes(type) || /recompense|reward|felicitation/.test(text)) {
      return 'reward';
    }
    return 'info';
  }

  function localizedNotification(notification) {
    const locale = String(window.cidTranslation?.current?.() || 'fr')
      .split('-')[0]
      .toLowerCase();
    const type = String(notification?.type || '').toUpperCase();
    const rawTitle = String(notification?.title || '').trim();
    const rawMessage = String(notification?.message || '').trim();
    const kind = notificationKind(notification);
    if (kind === 'info' && type !== 'REWARD' && type !== 'ACCOUNT_REWARD'
      && !/récompense|recompensa|reward|مكافأة/i.test(rawTitle)) {
      return { title: rawTitle, message: rawMessage };
    }

    const titleFallback = {
      fr: 'Nouvelle récompense',
      en: 'New reward',
      es: 'Nueva recompensa',
      pt: 'Nova recompensa',
      ar: 'مكافأة جديدة'
    }[locale] || 'Nouvelle récompense';
    const receivedFallback = {
      fr: (amount, unit) => `Vous avez reçu ${amount} ${unit} dans votre compte.`,
      en: (amount, unit) => `You received ${amount} ${unit} in your account.`,
      es: (amount, unit) => `Has recibido ${amount} ${unit} en tu cuenta.`,
      pt: (amount, unit) => `Recebeu ${amount} ${unit} na sua conta.`,
      ar: (amount, unit) => `لقد تلقيت ${amount} ${unit} في حسابك.`
    }[locale] || ((amount, unit) => `Vous avez reçu ${amount} ${unit} dans votre compte.`);
    const unitFallback = {
      fr: ['jetons', 'étoiles'],
      en: ['tokens', 'stars'],
      es: ['fichas', 'estrellas'],
      pt: ['fichas', 'estrelas'],
      ar: ['رموز', 'نجوم']
    }[locale] || ['jetons', 'étoiles'];
    const amountMatch = rawMessage.match(/(\d[\d\s.,]*)\s*(jetons?|tokens?|fiches?|fichas?|étoiles?|stars?|نجوم|رموز)/i);
    const amountMatches = rawMessage.match(/(\d[\d\s.,]*)\s*(jetons?|tokens?|fiches?|fichas?|étoiles?|stars?|نجوم|رموز)/gi) || [];
    const amount = amountMatch?.[1]?.trim() || '';
    const unit = /étoiles?|stars?|نجوم/i.test(amountMatch?.[2] || '')
      ? unitFallback[1]
      : unitFallback[0];
    const genericTitle = !rawTitle
      || /nouvelle récompense|new reward|nueva recompensa|nova recompensa|مكافأة جديدة/i.test(rawTitle);
    const complexReward = /jusqu|actif|débloqu|renouvel|reste|accès|pour\s+\d+\s+jours?/i
      .test(rawMessage);
    if (kind === 'purchase') {
      return {
        title: genericTitle || /récompense|reward/i.test(rawTitle)
          ? 'Achat validé'
          : rawTitle,
        message: /^achat valid[eé]|^paiement valid[eé]/i.test(rawMessage)
          ? rawMessage
          : `Achat validé : ${rawMessage || 'votre solde a été mis à jour avec succès.'}`
      };
    }
    if (kind === 'referral') {
      const amountText = amountMatches.length === 1 ? amountMatches[0] : '';
      const warmMessage = amountText
        ? `Félicitations ! Vous avez reçu ${amountText} suite au partage du site cidgroup.net. Merci de faire connaître notre plateforme !`
        : `${rawMessage || 'Votre partage a été pris en compte.'} Merci de faire connaître notre plateforme !`;
      return {
        title: 'Récompense de partage',
        message: warmMessage
      };
    }
    if (kind === 'access') {
      return {
        title: rawTitle || 'Accès débloqué',
        message: rawMessage
      };
    }
    return {
      title: genericTitle ? t('notifications.newReward', titleFallback) : rawTitle,
      message: amount && amountMatches.length === 1 && !complexReward
        ? ti('notifications.rewardReceived', { amount, unit }, receivedFallback(amount, unit))
        : rawMessage
    };
  }
  const state = {
    notifications: [],
    filter: 'all',
    isOpen: false,
    returnFocus: null,
    historyActive: false,
    realtimeCleanup: null
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function typeMeta(type, notification = null) {
    const normalized = String(type || 'INFO').toUpperCase();
    const kind = notificationKind(notification || { type: normalized });
    const metaKey = normalized === 'ACCOUNT_REWARD'
      ? 'REWARD'
      : normalized === 'ACCOUNT_MESSAGE'
        ? 'NEW_MESSAGE'
        : normalized;
    const meta = {
      COMMENT_REPLY: {
        className: 'reply',
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8.5 8 8.5 8.5 0 0 1-4.1-1l-4.2 1.2 1.2-4.1A8 8 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>'
      },
      NEW_COMMENT_ADMIN: {
        className: 'admin',
        icon: '<span aria-hidden="true">⚠</span>'
      },
      NEW_MESSAGE: {
        className: 'message',
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8.5 8 8.5 8.5 0 0 1-4.1-1l-4.2 1.2 1.2-4.1A8 8 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>'
      },
      REWARD: {
        className: 'reward',
        icon: '<span aria-hidden="true">⭐</span>'
      },
      PURCHASE: {
        className: 'purchase',
        icon: '<span aria-hidden="true">✓</span>'
      },
      ACCESS: {
        className: 'access',
        icon: '<span aria-hidden="true">🔓</span>'
      },
      PROMO: {
        className: 'promo',
        icon: '<span aria-hidden="true">🎁</span>'
      },
      METHOD: {
        className: 'method',
        icon: '<span aria-hidden="true">⚡</span>'
      },
      INFO: {
        className: 'info',
        icon: '<span aria-hidden="true">i</span>'
      }
    };
    if (kind === 'purchase') return meta.PURCHASE;
    if (kind === 'access') return meta.ACCESS;
    if (kind === 'referral' || kind === 'reward') return meta.REWARD;
    return meta[metaKey] || meta.INFO;
  }

  function notificationKindLabel(notification) {
    return {
      referral: 'Récompense de partage',
      reward: 'Récompense',
      purchase: 'Achat confirmé',
      access: 'Accès débloqué',
      info: 'Information'
    }[notificationKind(notification)] || 'Information';
  }

  function formatNotificationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Math.max(0, Date.now() - date.getTime());
    if (diff < 60 * 1000) return t('notifications.justNow', 'À l’instant');
    if (diff < 60 * 60 * 1000) {
      const count = Math.floor(diff / (60 * 1000));
      return ti('notifications.minutesAgo', { count }, `Il y a ${count} min`);
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const count = Math.floor(diff / (60 * 60 * 1000));
      return ti('notifications.hoursAgo', { count }, `Il y a ${count} h`);
    }
    return new Intl.DateTimeFormat(window.cidTranslation?.current?.() || 'fr', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function formatNotificationDateFull(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('notifications.unknownDate', 'Date inconnue');
    return new Intl.DateTimeFormat(window.cidTranslation?.current?.() || 'fr', {
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(date);
  }

  function notificationDetailRows(notification) {
    const message = String(notification?.message || '').trim();
    const title = String(notification?.title || '').trim();
    const rows = [
      [t('notifications.type', 'Type'), notificationKindLabel(notification) || title || t('notifications.information', 'Information')],
      [t('notifications.receivedAt', 'Reçue le'), formatNotificationDateFull(notification?.created_at)]
    ];
    if (['reward', 'referral', 'purchase', 'access'].includes(notificationKind(notification))) {
      const duration = message.match(/(?:pour|pendant)\s+(\d+)\s+jours?/i);
      const expiry = message.match(/(?:jusqu[’']au|jusqu[’']à|jusqu'au|accès jusqu'au)\s+([^.!?]+)/i);
      const balance = message.match(/reste\s+([^.!?]+)/i);
      const amount = message.match(/(\d[\d\s.,]*)\s*(étoiles?|jetons?|tokens?)/gi);
      if (duration) rows.push([t('notifications.duration', 'Durée'), `${duration[1]} jour${duration[1] === '1' ? '' : 's'}`]);
      if (expiry) rows.push([t('notifications.validUntil', 'Accès valable jusqu’au'), expiry[1].trim()]);
      if (amount?.length) rows.push([t('notifications.amount', 'Montant concerné'), amount.join(' · ')]);
      if (balance) rows.push([t('notifications.balanceAfter', 'Solde après opération'), balance[1].trim()]);
    }
    return rows;
  }

  function removeNotificationDetails() {
    document.querySelector('.notification-detail')?.remove();
  }

  function openNotificationDetails(notification) {
    const center = get('notificationCenter');
    if (!center) return;
    removeNotificationDetails();
    const type = notificationType(notification);
    const meta = typeMeta(notification.type, notification);
    const localized = localizedNotification(notification);
    const kind = notificationKind(notification);
    const isAccountNotification = [
      'NEW_MESSAGE',
      'ACCOUNT_MESSAGE',
      'REWARD',
      'ACCOUNT_REWARD',
      'ACCOUNT_PROFILE',
      'ACCOUNT_SETTINGS'
    ].includes(type) || ['purchase', 'referral', 'access'].includes(kind);
    const isPublicationNotification = Boolean(
      notification.post_id
      || notification.comment_id
      || ['COMMENT_REPLY', 'NEW_COMMENT_ADMIN'].includes(type)
    );

    const detail = document.createElement('section');
    detail.className = `notification-detail notification-detail--${meta.className}`;
    detail.setAttribute('role', 'dialog');
    detail.setAttribute('aria-modal', 'true');
    detail.setAttribute('aria-labelledby', 'notificationDetailTitle');

    const card = document.createElement('article');
    card.className = 'notification-detail-card';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notification-detail-close';
    close.setAttribute('aria-label', t('notifications.closeDetail', 'Fermer le détail'));
    close.textContent = '×';
    close.addEventListener('click', removeNotificationDetails);

    const heading = document.createElement('div');
    heading.className = 'notification-detail-heading';
    const icon = document.createElement('span');
    icon.className = `notification-type-icon notification-type-icon--${meta.className}`;
    icon.innerHTML = meta.icon;
    heading.append(
      icon,
      document.createElement('div')
    );
    const headingCopy = heading.lastElementChild;
    headingCopy.append(
      Object.assign(document.createElement('span'), {
        className: 'notification-detail-kicker',
        textContent: isAccountNotification
          ? t('notifications.accountDetail', 'Détail du compte')
          : t('notifications.detail', 'Détail de la notification')
      }),
      Object.assign(document.createElement('h2'), {
        id: 'notificationDetailTitle',
        textContent: localized.title || t('notifications.defaultTitle', 'Notification')
      })
    );
    card.append(close, heading);

    const message = document.createElement('p');
    message.className = 'notification-detail-message';
    message.textContent = String(
      notification.message
        || localized.message
        || t('notifications.noDetail', 'Aucun détail supplémentaire.')
    );
    card.appendChild(message);

    const facts = document.createElement('dl');
    facts.className = 'notification-detail-facts';
    notificationDetailRows(notification).forEach(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      facts.append(term, description);
    });
    card.appendChild(facts);

    const actions = document.createElement('div');
    actions.className = 'notification-detail-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'notification-detail-secondary';
    dismiss.textContent = t('notifications.close', 'Fermer');
    dismiss.addEventListener('click', removeNotificationDetails);
    actions.appendChild(dismiss);
    if (isAccountNotification || isPublicationNotification) {
      const openTarget = document.createElement('button');
      openTarget.type = 'button';
      openTarget.className = 'notification-detail-primary';
      /*
       * Account notifications are private rows returned only after the
       * repository has authenticated the recipient. "Ouvrir mon compte"
       * sounded like an invitation to create an account, even though this
       * user is already signed in. Keep the action as an account shortcut.
       */
      openTarget.textContent = isAccountNotification
        ? t('notifications.viewAccount', 'Voir mon compte')
        : t('notifications.viewPublication', 'Voir la publication');
      openTarget.setAttribute(
        'aria-label',
        isAccountNotification
          ? t('notifications.viewAccount', 'Voir mon compte')
          : t('notifications.viewPublication', 'Voir la publication')
      );
      openTarget.addEventListener('click', () => {
        removeNotificationDetails();
        goToTarget(notification).catch((error) => {
          console.warn('Redirection de notification impossible', error);
        });
      });
      actions.appendChild(openTarget);
    }
    card.appendChild(actions);
    detail.appendChild(card);
    center.appendChild(detail);
    detail.addEventListener('click', (event) => {
      if (event.target === detail) removeNotificationDetails();
    });
    card.querySelector('.notification-detail-primary, .notification-detail-secondary')?.focus();
  }

  function visibleNotifications() {
    if (state.filter === 'unread') {
      return state.notifications.filter(notification => !notification.is_read);
    }
    if (state.filter === 'reward') {
      return state.notifications.filter(notification => (
        ['reward', 'referral'].includes(notificationKind(notification))
      ));
    }
    if (state.filter === 'purchase') {
      return state.notifications.filter(notification => notificationKind(notification) === 'purchase');
    }
    return state.notifications;
  }

  function updateBadge() {
    const badge = get('notificationsBadge');
    const button = get('notificationsBtn');
    const count = state.notifications.filter(notification => !notification.is_read).length;
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.setAttribute('aria-label', ti(
        'notifications.unreadCount',
        { count, plural: count === 1 ? '' : 's' },
        `${count} notification${count === 1 ? '' : 's'} non lue${count === 1 ? '' : 's'}`
      ));
    }
    if (button) {
      button.setAttribute(
        'aria-label',
        count > 0
          ? ti(
            'notifications.openUnread',
            { count, plural: count === 1 ? '' : 's' },
            `Ouvrir les notifications, ${count} non lue${count === 1 ? '' : 's'}`
          )
          : t('notifications.open', 'Ouvrir les notifications')
      );
    }
  }

  function publishNotificationState() {
    window.dispatchEvent(new CustomEvent('cid:notifications-change', {
      detail: { notifications: state.notifications.slice() }
    }));
  }

  function render() {
    const list = get('notificationList');
    const empty = get('notificationEmpty');
    const markAll = get('markAllNotificationsRead');
    if (!list || !empty) return;

    const notifications = visibleNotifications();
    list.replaceChildren();
    empty.hidden = notifications.length > 0;
    if (markAll) {
      markAll.disabled = !state.notifications.some(notification => !notification.is_read);
    }

    notifications.forEach((notification) => {
    const meta = typeMeta(notification.type, notification);
      const localized = localizedNotification(notification);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `notification-item${notification.is_read ? '' : ' is-unread'}`;
      item.dataset.notificationId = notification.id;
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <span class="notification-type-icon notification-type-icon--${meta.className}">
          ${meta.icon}
        </span>
        <span class="notification-item-copy">
          <strong class="notification-item-title">${escapeHtml(localized.title)}</strong>
          <span class="notification-item-message">${escapeHtml(localized.message)}</span>
          <span class="notification-item-meta">
            <span class="notification-kind-label notification-kind-label--${notificationKind(notification)}">${escapeHtml(notificationKindLabel(notification))}</span>
            ${escapeHtml(formatNotificationDate(notification.created_at))}
          </span>
        </span>
        ${notification.is_read ? '' : '<span class="notification-unread-dot" aria-label="Non lue"></span>'}
      `;
      item.addEventListener('click', () => handleNotificationClick(notification));
      list.appendChild(item);
    });

    updateBadge();
  }

  async function refresh() {
    const repository = window.cidNotificationRepository;
    if (!repository) return;
    try {
      state.notifications = await repository.list();
      render();
      publishNotificationState();
    } catch (error) {
      state.notifications = [];
      render();
      publishNotificationState();
      if (error?.message !== 'Connexion requise.') {
        console.warn('Centre de notifications indisponible', error);
      }
    }
  }

  function open({ updateHistory = true } = {}) {
    const center = get('notificationCenter');
    const button = get('notificationsBtn');
    if (!center) return;
    removeNotificationDetails();
    state.isOpen = true;
    state.returnFocus = document.activeElement;
    state.historyActive = false;
    window.cidRoutePersistence?.remember('notifications');
    if (updateHistory && !state.historyActive) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'notifications');
        window.history.pushState(
          { ...(window.history.state || {}), view: 'notifications' },
          '',
          url.toString()
        );
        state.historyActive = true;
      } catch (_) {}
    }
    window.cidShowDedicatedView?.({
      id: 'notifications',
      title: 'Notifications',
      onBack: () => close()
    });
    center.hidden = false;
    center.setAttribute('aria-hidden', 'false');
    document.body.classList.add('notification-center-open');
    button?.setAttribute('aria-expanded', 'true');
    render();
  }

  function close({ fromHistory = false } = {}) {
    const center = get('notificationCenter');
    const button = get('notificationsBtn');
    if (!center) return;
    const wasOpen = state.isOpen || state.historyActive || !center.hidden;
    if (!wasOpen) return;
    const hadHistoryEntry = state.historyActive;
    if (!fromHistory && hadHistoryEntry) {
      state.historyActive = false;
      try {
        window.history.back();
        // A stale history stack or an embedded preview can swallow back().
        // Close the route locally as a safety net so navigation never stays
        // blocked behind an open notification surface.
        window.setTimeout(() => {
          if (state.isOpen) close({ fromHistory: true });
        }, 180);
        return;
      } catch (_) {}
    }
    state.isOpen = false;
    state.historyActive = false;
    removeNotificationDetails();
    center.hidden = true;
    center.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('notification-center-open');
    window.cidHideDedicatedView?.();
    if (!fromHistory && !hadHistoryEntry) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'accueil');
        window.history.replaceState({ ...(window.history.state || {}), view: 'accueil' }, '', url.toString());
      } catch (_) {}
      window.showHomeView?.({ updateHistory: false });
    }
    button?.setAttribute('aria-expanded', 'false');
    state.returnFocus?.focus?.();
    state.returnFocus = null;
  }

  function normalizeRouteText(value) {
    return String(value || '')
      .toLocaleLowerCase('fr-FR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function findPublicationTarget(notification) {
    const postId = String(notification.post_id || '');
    const publications = Array.from(document.querySelectorAll(
      '#cid-home-feed .cid-fb-post[data-post-id], #cid-home-feed .cid-fb-post[data-post-type]'
    ));
    if (postId) {
      return publications.find(element =>
        element.dataset.postId === postId
        || element.dataset.postType === postId
        || element.id === `cid-post-${postId}`
      ) || null;
    }

    // Official notices may predate the post_id field. Use the publication
    // wording as a narrow fallback so the click still lands on its card.
    const noticeText = normalizeRouteText(`${notification.title} ${notification.message}`);
    const typeByText = [
      ['matrice', 'matrix'],
      ['boule', 'rejected'],
      ['rejet', 'rejected'],
      ['croix', 'cross'],
      ['horaire', 'schedule'],
      ['programme', 'schedule']
    ];
    const postType = typeByText.find(([term]) => noticeText.includes(term))?.[1];
    return postType
      ? publications.find(element => element.dataset.postType === postType) || null
      : null;
  }

  function findCommentTarget(commentId) {
    if (!commentId) return null;
    return Array.from(document.querySelectorAll(
      '#cid-comments-sheet-root [data-comment-id]'
    )).find(element => element.dataset.commentId === commentId) || null;
  }

  function findRepliesToggle(commentId) {
    if (!commentId) return null;
    return Array.from(document.querySelectorAll(
      '#cid-comments-sheet-root [data-comment-replies]'
    )).find(element => element.dataset.commentReplies === commentId) || null;
  }

  function waitFor(getValue, timeout = 4200, interval = 70) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const value = getValue();
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          resolve(null);
          return;
        }
        window.setTimeout(check, interval);
      };
      check();
    });
  }

  function highlightTarget(target) {
    if (!target) return;
    target.classList.remove('notification-target-highlight');
    target.classList.add('notification-target-highlight');
    window.setTimeout(() => {
      target.classList.remove('notification-target-highlight');
    }, 1600);
  }

  function notificationType(notification) {
    return String(notification?.type || '').toUpperCase();
  }

  async function openAccountNotification(notification) {
    const type = notificationType(notification);
    const kind = notificationKind(notification);
    let section = 'help';
    if (['reward', 'referral', 'purchase'].includes(kind)) section = 'history';
    else if (kind === 'access') section = 'subscription';
    else if (type === 'ACCOUNT_PROFILE' || type === 'ACCOUNT_SETTINGS') section = 'settings';

    close({ fromHistory: true });
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'profil');
      window.history.replaceState(
        { ...(window.history.state || {}), view: 'profil' },
        '',
        url.toString()
      );
    } catch (_) {}
    window.cidRoutePersistence?.remember('profil');

    if (typeof window.showProfileView === 'function') {
      await window.showProfileView();
    }
    window.cidSetAccountTab?.(section, {
      conversationId: notification.conversation_id || ''
    });

    const panel = await waitFor(() => {
      const candidate = document.getElementById(
        `account${section.charAt(0).toUpperCase()}${section.slice(1)}Panel`
      );
      return candidate && !candidate.hidden ? candidate : null;
    }, 3200, 70);
    if (panel) highlightTarget(panel);
  }

  async function revealComment(post, commentId) {
    // An empty cached array is not a completed load. Wait until the
    // Supabase response actually contains the comment referenced by the
    // notification; otherwise the notification click races hydration.
    const comments = await waitFor(() => {
      const value = post?.__cidComments;
      if (!Array.isArray(value)) return null;
      return value.some(comment => String(comment?.id || '') === commentId)
        ? value
        : null;
    }, 6200, 70);
    if (!comments) return null;

    const byId = new Map(comments.map(comment => [String(comment.id), comment]));
    const targetComment = byId.get(commentId);
    const ancestorIds = [];
    let parentId = targetComment?.parent_id || null;
    while (parentId && !ancestorIds.includes(String(parentId))) {
      ancestorIds.unshift(String(parentId));
      parentId = byId.get(String(parentId))?.parent_id || null;
    }

    // Reply nodes are rendered only after their parent branch is expanded.
    for (const ancestorId of ancestorIds) {
      if (findCommentTarget(commentId)) break;
      const toggle = findRepliesToggle(ancestorId);
      if (!toggle) continue;
      toggle.click();
      await new Promise(resolve => window.setTimeout(resolve, 45));
    }

    // The sheet initially renders only the first page. Allow its pagination
    // observer to render a later comment before giving up.
    const visibleComment = await waitFor(() => findCommentTarget(commentId), 1800);
    if (visibleComment) return visibleComment;

    const sheetList = document.querySelector(
      '#cid-comments-sheet-root .cid-comments-sheet-list'
    );
    const sentinel = sheetList?.querySelector('.cid-comments-load-sentinel');
    if (sentinel) {
      sentinel.scrollIntoView({ block: 'end' });
      return waitFor(() => findCommentTarget(commentId), 1800);
    }
    return null;
  }

  async function goToTarget(notification) {
    const type = notificationType(notification);
    if (
      type === 'NEW_MESSAGE'
      || type === 'ACCOUNT_MESSAGE'
      || type === 'REWARD'
      || type === 'ACCOUNT_REWARD'
      || ['PURCHASE', 'PAYMENT', 'ACCOUNT_PURCHASE', 'TOP_UP'].includes(type)
      || type === 'ACCOUNT_PROFILE'
      || type === 'ACCOUNT_SETTINGS'
      || ['reward', 'referral', 'purchase', 'access'].includes(notificationKind(notification))
    ) {
      await openAccountNotification(notification);
      return;
    }

    close({ fromHistory: true });
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'accueil');
      window.history.replaceState({ ...(window.history.state || {}), view: 'accueil' }, '', url.toString());
    } catch (_) {}

    // Mount Accueil explicitly before looking for the publication. The old
    // notification flow only changed the active tab, which could leave a
    // dedicated route (or a hidden feed) in place while the async lookup was
    // already timing out.
    if (typeof window.showHomeView === 'function') {
      window.showHomeView({ updateHistory: false });
    } else if (typeof window.setActiveTab === 'function') {
      window.setActiveTab('accueil', { updateHistory: false });
    }

    const publication = await waitFor(() => findPublicationTarget(notification), 6200, 70);
    if (!publication) return;
    publication.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Use the feed's public flow when available so navigation waits for the
    // comments request. The click fallback supports older feed instances.
    const openComments = window.cidCommentsFlows?.viewCommentsMode;
    if (typeof openComments === 'function') {
      await openComments(publication);
    } else {
      const commentsToggle = publication.querySelector(
        '.cid-fb-comments-summary, .cid-fb-comment-toggle'
      );
      commentsToggle?.click();
      await waitFor(
        () => document.querySelector('#cid-comments-sheet-root.is-open'),
        1800
      );
    }

    const commentId = String(notification.comment_id || '');
    if (!commentId) {
      highlightTarget(publication);
      return;
    }

    const comment = await revealComment(publication, commentId);
    if (comment) {
      comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightTarget(comment);
    } else {
      // Keep the route useful if the target comment was deleted or is no
      // longer readable: the publication remains visibly identified.
      highlightTarget(publication);
    }
  }

  async function handleNotificationClick(notification) {
    const repository = window.cidNotificationRepository;
    if (!notification.is_read) {
      notification.is_read = true;
      render();
      if (repository) {
        try {
          await repository.markRead(notification.id);
          publishNotificationState();
        } catch (error) {
          console.warn('Impossible de marquer la notification comme lue', error);
        }
      }
    }
    openNotificationDetails(notification);
  }

  async function markAllRead() {
    const repository = window.cidNotificationRepository;
    if (!repository) return;
    await repository.markAllRead();
    state.notifications = state.notifications.map(notification => ({
      ...notification,
      is_read: true
    }));
    render();
    publishNotificationState();
  }

  function setFilter(filter) {
    state.filter = ['unread', 'reward', 'purchase'].includes(filter) ? filter : 'all';
    document.querySelectorAll('[data-notification-filter]').forEach((button) => {
      const active = button.dataset.notificationFilter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    render();
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape' || !state.isOpen) return;
    if (document.querySelector('.notification-detail')) {
      removeNotificationDetails();
      return;
    }
    close();
  }

  function init() {
    if (!get('notificationsBtn') || !get('notificationCenter')) return;
    get('notificationsBtn').addEventListener('click', () => {
      if (state.isOpen) close();
      else open();
    });
    get('markAllNotificationsRead')?.addEventListener('click', markAllRead);
    document.querySelectorAll('[data-notification-filter]').forEach(button => {
      button.addEventListener('click', () => setFilter(button.dataset.notificationFilter));
    });
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('popstate', (event) => {
      if (event.state?.view === 'notifications') {
        open({ updateHistory: false });
      } else if (state.isOpen) {
        // The route controller that owns the destination (Accueil,
        // Catégories, Compte, Tableaux, …) handles the actual view change.
        // Closing the notification layer here must stay side-effect free.
        close({ fromHistory: true });
        const destination = event.state?.view
          || new URLSearchParams(window.location.search).get('section');
        if (!destination) window.showHomeView?.({ updateHistory: false });
      }
    });
    const repository = window.cidNotificationRepository;
    repository?.isAdminRecipient?.().then((isAdmin) => {
      document.body.dataset.notificationAdmin = String(Boolean(isAdmin));
    }).catch(() => {});
    repository?.subscribe(() => refresh())
      .then((cleanup) => { state.realtimeCleanup = cleanup; })
      .catch((error) => {
        if (error?.message !== 'Connexion requise.') {
          console.warn('Temps réel des notifications indisponible', error);
        }
      });
    window.addEventListener('cid:auth-sync', () => {
      state.realtimeCleanup?.();
      state.realtimeCleanup = null;
      repository?.subscribe(() => refresh())
        .then((cleanup) => { state.realtimeCleanup = cleanup; })
        .catch(() => {});
      refresh();
    });
    window.addEventListener('cid:language-change', () => {
      render();
      updateBadge();
    });
    window.cidNotifications = Object.freeze({
      refresh,
      open,
      close,
      markRead: (id) => window.cidNotificationRepository?.markRead(id),
      markAllRead
    });
    refresh();
    if (new URLSearchParams(window.location.search).get('section') === 'notifications') {
      open({ updateHistory: false });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
