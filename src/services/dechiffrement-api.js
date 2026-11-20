/*
 * Client boundary for the protected Déchiffrement Edge Function.
 *
 * The browser forwards the pasted values and receives the ten numbers
 * calculated by the autonomous server. It never reads a programme archive.
 */
(function exposeDechiffrementApi() {
  const REMOTE_TIMEOUT_MS = 12000;

  const remoteFailureStatus = (error) => Number(
    error?.context?.status || error?.status || error?.statusCode || 0
  );

  const remoteFailureMessage = async (error) => {
    const response = error?.context;
    if (typeof response?.clone === 'function') {
      try {
        const body = await response.clone().json();
        if (typeof body?.error === 'string' && body.error.trim()) return body.error;
      } catch (_) {}
    }
    return error?.message || 'Le serveur de déchiffrement est indisponible.';
  };

  const withRemoteFailureMessage = async (error) => {
    const message = await remoteFailureMessage(error);
    if (message === error?.message) return error;
    const normalized = new Error(message);
    normalized.name = error?.name || 'Error';
    normalized.status = remoteFailureStatus(error);
    normalized.context = error?.context;
    return normalized;
  };

  window.invokeDechiffrement = async function invokeDechiffrement(payload = {}) {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client?.functions?.invoke) {
      throw new Error('Supabase n’est pas configuré pour le déchiffrement.');
    }

    let data;
    let error;
    try {
      ({ data, error } = await Promise.race([
        bridge.client.functions.invoke('dechiffrement-mt', {
          body: payload
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => {
            const timeout = new Error(
              'La fonction de déchiffrement ne répond pas actuellement.'
            );
            timeout.name = 'DechiffrementTimeoutError';
            reject(timeout);
          }, REMOTE_TIMEOUT_MS);
        })
      ]));
    } catch (remoteError) {
      if (String(payload?.action || '').trim().toLowerCase() === 'plus'
        || [401, 403].includes(remoteFailureStatus(remoteError))) {
        throw String(payload?.action || '').trim().toLowerCase() === 'plus'
          ? await withRemoteFailureMessage(remoteError)
          : remoteError;
      }
      console.warn('Déchiffrement distant indisponible.', remoteError);
      throw remoteError;
    }
    if (error) {
      const status = remoteFailureStatus(error);
      if (String(payload?.action || '').trim().toLowerCase() === 'plus'
        || [401, 403].includes(status)) {
        throw String(payload?.action || '').trim().toLowerCase() === 'plus'
          ? await withRemoteFailureMessage(error)
          : error;
      }
      console.warn('Déchiffrement distant en erreur.', error);
      throw error;
    }
    const isPlus = String(payload?.action || '').trim().toLowerCase() === 'plus';
    const hasExpectedResult = isPlus ? data?.plus : data?.program;
    if (!data?.ok || !hasExpectedResult) {
      throw new Error(data?.error || 'Le serveur n’a pas trouvé de programme.');
    }
    return data;
  };
})();
