(() => {
  const ROOM_FLOOR_BY_NAME = new Map([
    ['금성', '11층'],
    ['지구', '11층'],
    ['수성', '11층'],
    ['화성', '11층'],
    ['보이저', '12층'],
    ['디스커버리', '12층'],
    ['아폴로', '12층'],
    ['허블', '12층'],
    ['은하수', '13층'],
  ]);
  const GUEST_OPEN_URL = 'https://zzimkkong.com/guest/gAjJTeISFY54CNKWYmOVxQ';

  const debug = () => {};

  const toastTheme = {
    success: 'linear-gradient(135deg, #16a34a, #22c55e)',
    error: 'linear-gradient(135deg, #dc2626, #ef4444)',
    info: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
  };

  const notify = (message, type = 'info', duration = 2400) => {
    debug('toast', { type, message });

    if (typeof window.Toastify === 'function') {
      window.Toastify({
        text: message,
        duration,
        gravity: 'top',
        position: 'center',
        close: true,
        stopOnFocus: true,
        style: {
          background: toastTheme[type] || toastTheme.info,
          fontSize: '11px',
          fontWeight: '700',
        },
      }).showToast();
      return;
    }

    return;
  };

  debug('popup boot');

  const elements = {
    icon: document.getElementById('zzk-popup-icon'),
    refreshButton: document.getElementById('zzk-refresh'),
    list: document.getElementById('zzk-reservation-list'),
    inlineMessage: document.getElementById('zzk-popup-inline-message'),
  };

  if (!(elements.refreshButton instanceof HTMLButtonElement) || !(elements.list instanceof HTMLUListElement)) {
    debug('required DOM elements missing; aborting popup init');
    return;
  }

  if (elements.icon instanceof HTMLImageElement && chrome?.runtime?.getURL) {
    elements.icon.src = chrome.runtime.getURL('src/icon.png');
  }

  const clearList = () => {
    elements.list.textContent = '';
    elements.list.hidden = true;
  };

  const hideInlineMessage = () => {
    if (!(elements.inlineMessage instanceof HTMLParagraphElement)) {
      return;
    }
    elements.inlineMessage.hidden = true;
    elements.inlineMessage.textContent = '';
  };

  const showOpenSiteMessage = () => {
    if (!(elements.inlineMessage instanceof HTMLParagraphElement)) {
      return;
    }

    elements.inlineMessage.textContent = '예약 현황을 확인하려면 ';

    const link = document.createElement('a');
    link.href = GUEST_OPEN_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = '찜꽁 사이트';

    elements.inlineMessage.appendChild(link);
    elements.inlineMessage.append('를 열어주세요.');
    elements.inlineMessage.hidden = false;
  };

  const setLoading = (loading) => {
    debug('setLoading', { loading });
    elements.refreshButton.disabled = loading;
    elements.refreshButton.textContent = loading ? '불러오는 중...' : '새로고침';
  };

  const renderReservations = (payload, options = {}) => {
    const notifyOnSuccess = options.notifyOnSuccess !== false;
    hideInlineMessage();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const totalElements = Number.isInteger(payload?.pagination?.totalElements)
      ? payload.pagination.totalElements
      : items.length;

    debug('renderReservations', { itemCount: items.length, totalElements });

    if (items.length === 0) {
      clearList();
      notify('조회된 일정이 없습니다.', 'info');
      return;
    }

    elements.list.hidden = false;
    elements.list.textContent = '';

    if (notifyOnSuccess) {
      notify(`일정 ${items.length}건을 불러왔습니다.`, 'success');
    }

    items.forEach((reservation) => {
      const roomName = reservation.roomName || '공간 미확인';
      const floorLabel = getFloorLabelByRoomName(roomName);

      const item = document.createElement('li');
      item.className = 'zzk-item';

      const top = document.createElement('div');
      top.className = 'zzk-item-top';

      const room = document.createElement('p');
      room.className = 'zzk-item-room';
      room.textContent = roomName;
      top.appendChild(room);

      const badge = document.createElement('span');
      badge.className = `zzk-badge ${reservation.isPast ? 'past' : 'active'}`;
      badge.textContent = reservation.isPast ? '지난 일정' : '일정';
      top.appendChild(badge);
      item.appendChild(top);

      const floor = document.createElement('p');
      floor.className = 'zzk-item-floor';
      floor.innerHTML = `<strong>층</strong> ${escapeHtml(floorLabel)}`;
      item.appendChild(floor);

      const date = document.createElement('p');
      date.className = 'zzk-item-date';
      date.textContent = reservation.dateLabel || '날짜 미확인';
      item.appendChild(date);

      const time = document.createElement('p');
      time.className = 'zzk-item-time';
      time.innerHTML = `<strong>시간</strong> ${escapeHtml(reservation.timeLabel || '시간 미확인')}`;
      item.appendChild(time);

      if (typeof reservation.purpose === 'string' && reservation.purpose.trim() !== '') {
        const purpose = document.createElement('p');
        purpose.className = 'zzk-item-purpose';
        purpose.innerHTML = `<strong>사용 목적</strong> ${escapeHtml(reservation.purpose)}`;
        item.appendChild(purpose);
      }

      const reserverName = getReserverName(reservation);
      const reserver = document.createElement('p');
      reserver.className = 'zzk-item-reserver';
      reserver.innerHTML = `<strong>예약자</strong> ${escapeHtml(reserverName)}`;
      item.appendChild(reserver);

      const actions = document.createElement('div');
      actions.className = 'zzk-item-actions';

      const shareButton = document.createElement('button');
      shareButton.type = 'button';
      shareButton.className = 'zzk-item-share-button';
      shareButton.textContent = '이 예약 공유';
      shareButton.addEventListener('click', () => {
        handleShareSingleReservation(reservation);
      });

      actions.appendChild(shareButton);
      item.appendChild(actions);

      elements.list.appendChild(item);
    });
  };

  const loadReservations = async (options = {}) => {
    const notifyOnSuccess = options.notifyOnSuccess !== false;

    setLoading(true);
    clearList();
    hideInlineMessage();

    try {
      debug('loadReservations start');
      const response = await fetchReservationsViaGuestTab(0);
      debug('loadReservations response', {
        ok: Boolean(response?.ok),
        hasData: Boolean(response?.data),
      });

      if (!response?.ok) {
        throw new Error(response?.error || '내 예약 현황 조회에 실패했습니다.');
      }

      renderReservations(response.data, { notifyOnSuccess });
    } catch (error) {
      const message = getErrorMessage(error);
      debug('loadReservations error', message);

      if (isNeedOpenGuestPageMessage(message)) {
        showOpenSiteMessage();
      } else {
        notify(message, 'error', 3200);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleShareSingleReservation = async (reservation) => {
    const shareText = buildSingleReservationShareText(reservation);
    debug('share single reservation text generated', {
      lineCount: shareText.split('\n').length,
      reservationId: reservation?.id ?? null,
    });

    try {
      await copyTextToClipboard(shareText);
      notify('선택한 예약 공유 텍스트가 복사되었습니다.', 'success');
    } catch (error) {
      debug('clipboard copy failed', getErrorMessage(error));
      notify('복사에 실패했습니다. 다시 시도해주세요.', 'error', 3200);
    }
  };

  elements.refreshButton.addEventListener('click', () => {
    debug('refresh button clicked');
    loadReservations({ notifyOnSuccess: true });
  });

  loadReservations({ notifyOnSuccess: false });

  function isNeedOpenGuestPageMessage(message) {
    if (typeof message !== 'string') {
      return false;
    }

    return message.includes('찜꽁 게스트 페이지') || message.includes('게스트 탭을 찾지 못했습니다');
  }

  function getFloorLabelByRoomName(roomName) {
    if (typeof roomName !== 'string') {
      return '층 미확인';
    }

    const normalizedRoomName = roomName.replace(/\s+/g, ' ').trim();
    return ROOM_FLOOR_BY_NAME.get(normalizedRoomName) || '층 미확인';
  }

  function getReserverName(reservation) {
    if (!reservation || typeof reservation !== 'object') {
      return '미확인';
    }

    const candidate = reservation.reserverName;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }

    return '미확인';
  }

  function buildSingleReservationShareText(reservation) {
    const roomName = reservation?.roomName || '공간 미확인';
    const floorLabel = getFloorLabelByRoomName(roomName);
    const dateLabel = reservation?.dateLabel || '날짜 미확인';
    const timeLabel = reservation?.timeLabel || '시간 미확인';
    const purposeLabel =
      typeof reservation?.purpose === 'string' && reservation.purpose.trim() !== ''
        ? reservation.purpose.trim()
        : '미입력';
    const reserverName = getReserverName(reservation);

    return [
      '📌 찜꽁 예약 현황',
      '',
      `- 시간: ${dateLabel} ${timeLabel}`,
      `- 공간: ${roomName} (${floorLabel})`,
      `- 사용 목적: ${purposeLabel}`,
      `- 예약자: ${reserverName}`,
    ].join('\n');
  }

  async function copyTextToClipboard(text) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      if (!successful) {
        throw new Error('execCommand copy failed');
      }
    } finally {
      textarea.remove();
    }
  }
})();

async function fetchReservationsViaGuestTab(page) {
  const candidateTabs = await getCandidateGuestTabs();

  if (!Array.isArray(candidateTabs) || candidateTabs.length === 0) {
    throw new Error('찜꽁 게스트 페이지(https://zzimkkong.com/guest)를 먼저 열어주세요.');
  }

  let hadNoReceiverError = false;
  let lastResponseError = null;

  for (const tab of candidateTabs) {
    if (!Number.isInteger(tab?.id)) {
      continue;
    }

    try {
      const response = await sendMessageToTab(tab.id, {
        type: 'ZZK_POPUP_FETCH_MY_RESERVATIONS',
        payload: {
          page,
        },
      });

      if (response?.ok) {
        return response;
      }

      if (response && typeof response === 'object') {
        lastResponseError = new Error(response.error || '내 예약 현황 조회에 실패했습니다.');
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (isNoReceiverError(error)) {
        hadNoReceiverError = true;
        continue;
      }
      throw error;
    }
  }

  if (lastResponseError) {
    throw lastResponseError;
  }

  if (hadNoReceiverError) {
    throw new Error('게스트 페이지 탭을 새로고침(F5)한 뒤 다시 시도해주세요.');
  }

  throw new Error('내 예약 정보를 가져올 수 있는 게스트 탭을 찾지 못했습니다.');
}

function getCandidateGuestTabs() {
  return new Promise((resolve, reject) => {
    if (!chrome?.tabs?.query) {
      reject(new Error('탭 정보를 조회할 수 없습니다.'));
      return;
    }

    chrome.tabs.query({}, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || '탭 조회에 실패했습니다.'));
        return;
      }

      const guestUrlPattern = /^https:\/\/(?:www\.)?zzimkkong\.com\/guest(?:[/?#]|$)/;
      const allTabs = Array.isArray(tabs) ? tabs : [];
      const guestTabs = allTabs.filter((tab) => {
        const url = typeof tab?.url === 'string' ? tab.url : '';
        return guestUrlPattern.test(url);
      });

      guestTabs.sort((a, b) => {
        if (a.active === b.active) {
          return 0;
        }
        return a.active ? -1 : 1;
      });

      resolve(guestTabs);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    if (!chrome?.tabs?.sendMessage) {
      reject(new Error('탭 메시지 API를 사용할 수 없습니다.'));
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || '탭 메시지 전송에 실패했습니다.'));
        return;
      }
      resolve(response);
    });
  });
}

function isNoReceiverError(error) {
  const message = getErrorMessage(error);
  return (
    message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection') ||
    message.includes('No tab with id')
  );
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

function escapeHtml(value) {
  const text = String(value ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
