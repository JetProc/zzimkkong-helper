(() => {
  if (window.__zzkPopupPageBridgeLoaded) {
    return;
  }
  window.__zzkPopupPageBridgeLoaded = true;

  const debug = () => {};

  const REQUEST_TYPE = 'ZZK_PAGE_BRIDGE_FETCH_MY_RESERVATIONS';
  const RESPONSE_TYPE = 'ZZK_PAGE_BRIDGE_FETCH_MY_RESERVATIONS_RESULT';

  debug('bridge loaded');

  const safeParseJson = (text) => {
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };

  const normalizeErrorMessage = (response, data) => {
    if (typeof data?.message === 'string' && data.message.trim() !== '') {
      return data.message;
    }
    const statusCode = Number(response?.status);
    if (Number.isInteger(statusCode)) {
      return '요청 실패 (' + statusCode + ')';
    }
    return '요청 실패';
  };

  const requestReservationsOnce = async (endpoint, authorizationHeader = '') => {
    const headers = {
      Accept: '*/*',
    };

    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
    }

    debug('fetch attempt', {
      endpoint,
      hasAuthorization: Boolean(authorizationHeader),
    });

    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'omit',
      headers,
    });

    const text = await response.text();
    debug('fetch response', {
      status: response.status,
      ok: response.ok,
      bodyKeys: Object.keys(safeParseJson(text) || {}),
    });

    return {
      response,
      data: safeParseJson(text),
    };
  };

  const postResult = (requestId, result) => {
    debug('post result', {
      requestId,
      ok: Boolean(result?.ok),
      error: result?.error || '',
      hasData: Boolean(result?.data),
    });

    window.postMessage(
      {
        type: RESPONSE_TYPE,
        requestId,
        ...result,
      },
      '*'
    );
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.type !== REQUEST_TYPE) {
      return;
    }

    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const endpoint = typeof message.endpoint === 'string' ? message.endpoint : '';
    const authHeaders = Array.isArray(message.authorizationHeaders)
      ? message.authorizationHeaders.filter((value) => typeof value === 'string' && value.trim() !== '')
      : [];

    debug('request received', {
      requestId,
      endpoint,
      authHeaderCount: authHeaders.length,
    });

    if (!requestId || !endpoint) {
      postResult(requestId, {
        ok: false,
        error: '잘못된 요청입니다.',
      });
      return;
    }

    try {
      const attempts = authHeaders.length > 0 ? authHeaders : [''];
      let lastErrorMessage = '요청 실패';

      for (const authorizationHeader of attempts) {
        const { response, data } = await requestReservationsOnce(endpoint, authorizationHeader);

        if (response.ok) {
          postResult(requestId, {
            ok: true,
            data,
          });
          return;
        }

        lastErrorMessage = normalizeErrorMessage(response, data);
        if (response.status !== 401 && response.status !== 403) {
          break;
        }
      }

      postResult(requestId, {
        ok: false,
        error: lastErrorMessage,
      });
    } catch (error) {
      postResult(requestId, {
        ok: false,
        error: error instanceof Error && error.message ? error.message : '페이지 컨텍스트 요청 실패',
      });
    }
  });
})();
