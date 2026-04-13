(() => {
  if (window.__zzkAvailabilityLensLoaded) {
    return;
  }
  window.__zzkAvailabilityLensLoaded = true;

  const PANEL_HOST_ID = 'zzk-availability-lens-root';
  const MAP_CALENDAR_OVERLAY_ID = 'zzk-map-calendar-overlay';
  const MAP_CALENDAR_STYLE_ID = 'zzk-map-calendar-style';
  const SEOUL_TIMEZONE = 'Asia/Seoul';
  const KST_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    timeZone: SEOUL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const KST_HOUR_MINUTE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    timeZone: SEOUL_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const KST_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
    timeZone: SEOUL_TIMEZONE,
    weekday: 'short',
  });
  const TIME_STEP_MINUTES = 10;
  const AUTO_PICK_DURATION_MINUTES = 60;
  const BOOKABLE_START_MINUTE = 7 * 60;
  const BOOKABLE_END_MINUTE = 23 * 60;
  const AUTO_PICK_DURATION_OPTIONS = [10, 20, 30, 40, 50, 60];
  const MATRIX_TIME_COLUMN_WIDTH_PX = 52;
  const MATRIX_ROOM_COLUMN_MIN_WIDTH_PX = 30;
  const CURRENT_TIME_INITIAL_TOP_OFFSET_ROWS = 3;
  const CURRENT_TIME_TARGET_VIEWPORT_RATIO = 0.45;
  const MY_RESERVATION_CACHE_TTL_MS = 2 * 60 * 1000;
  const INLINE_ASIDE_SCROLL_CLASS = 'zzk-inline-aside-scroll';
  const CALENDAR_WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const BIG_ROOM_NAMES = new Set(['금성', '지구', '보이저', '디스커버리']);
  const SMALL_ROOM_NAMES = new Set(['수성', '화성', '아폴로', '허블']);
  const SPACE_CATEGORY_MEETING = 'meeting';
  const SPACE_CATEGORY_PAIRING = 'pairing';
  const MAP_CALENDAR_SPACE_CATEGORY_OPTIONS = [
    { value: SPACE_CATEGORY_MEETING, label: '회의실' },
    { value: SPACE_CATEGORY_PAIRING, label: '페어링 존' },
  ];
  const HOST_FORM_ACTION_DELAY_MS = 70;
  const HOST_TIME_SECTION_SELECTOR = '#root > div > aside > form > section > div:nth-child(2)';
  const HOST_TIME_PANEL_SELECTORS = [
    '#root > div > aside > form > section > div:nth-child(2) > div.sc-fbIWvP.jREztg',
    '#root > div > aside > form > section > div:nth-child(2) > div.sc-fbIWvP.jREztg > div.sc-dvXYtj.iduHXF',
    '#root > div > aside > form > section > div:nth-child(2) .sc-fbIWvP.jREztg .sc-dvXYtj.iduHXF',
    "#root > div > aside > form > section > div:nth-child(2) > div[class*='sc-fbIWvP']",
    "#root > div > aside > form > section > div:nth-child(2) > div[class*='sc-dvXYtj']",
    "#root > div > aside > form > section > div:nth-child(2) [class*='sc-dvXYtj']",
  ];
  const EXTENSION_FONT_PATH = 'src/fonts/BMDOHYEON_ttf.ttf';
  const GUEST_FAVICON_SELECTOR = "link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']";

  const state = {
    mounted: false,
    loading: false,
    slotAutoPicking: false,
    highlightedRects: new Set(),
    latestRooms: [],
    highlightEnabled: true,
    scheduleOverlayEnabled: true,
    scheduleCache: new Map(),
    activeScheduleDate: null,
    mapCalendarCollapsed: false,
    currentSharingMapId: null,
    inputRefreshTimer: null,
    autoRefreshTimer: null,
    autoScheduleRefreshTimer: null,
    autoPickedRange: null,
    autoPickDurationMinutes: AUTO_PICK_DURATION_MINUTES,
    mapCalendarSpaceCategory: SPACE_CATEGORY_MEETING,
    mapCalendarManualExpanded: false,
    popupMessageBridgeRegistered: false,
    myReservationsCache: [],
    myReservationsLoadedAt: 0,
    myReservationsLoadingPromise: null,
    elements: null,
  };

  boot();

  function boot() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', boot, { once: true });
      return;
    }

    replaceNativeAlertWithToast();
    registerPopupMessageBridge();
    hookHistoryChanges();
    window.addEventListener('popstate', handleLocationChange);
    document.addEventListener('change', handleHostDateChange, true);
    document.addEventListener('pointerdown', handleHostTimeControlPointerDown, true);
    document.addEventListener('focusin', handleHostTimeControlFocusIn, true);
    restoreForcedHiddenHostTimePanels();

    if (isGuestPage()) {
      applyGuestPageFavicon();
      ensurePanel();
      refreshAvailability();
    }

    const observer = new MutationObserver(() => {
      if (!isGuestPage()) {
        return;
      }
      applyGuestPageFavicon();
      ensurePanel();
      if (state.latestRooms.length > 0 && state.highlightEnabled) {
        scheduleHighlightRefresh();
      }
      if (state.scheduleOverlayEnabled && state.activeScheduleDate) {
        const overlay = document.getElementById(MAP_CALENDAR_OVERLAY_ID);
        const targetRoot = getMapRootElement();
        if (!overlay || (targetRoot && overlay.parentElement !== targetRoot)) {
          scheduleCalendarOverlayRefresh();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function ensurePanel() {
    if (state.mounted && document.getElementById(PANEL_HOST_ID)) {
      return;
    }

    const previous = document.getElementById(PANEL_HOST_ID);
    if (previous) {
      previous.remove();
    }

    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.position = 'fixed';
    host.style.right = '18px';
    host.style.top = '88px';
    host.style.zIndex = '2147483646';
    host.style.width = 'fit-content';
    host.style.maxWidth = 'calc(100vw - 24px)';
    host.style.maxHeight = 'calc(100vh - 96px)';
    host.style.pointerEvents = 'auto';
    host.style.display = 'none';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `${panelStyle()}${panelMarkup()}`;

    document.body.appendChild(host);

    const elements = {
      host,
      form: shadow.querySelector('#zzk-form'),
      collapseButton: shadow.querySelector('#zzk-collapse'),
      refreshButton: shadow.querySelector('#zzk-refresh'),
      dateInput: shadow.querySelector('#zzk-date'),
      startInput: shadow.querySelector('#zzk-start'),
      endInput: shadow.querySelector('#zzk-end'),
      highlightToggle: shadow.querySelector('#zzk-highlight-toggle'),
      scheduleToggle: shadow.querySelector('#zzk-schedule-toggle'),
      statusMessage: shadow.querySelector('#zzk-status-message'),
      totalCount: shadow.querySelector('#zzk-total-count'),
      availableCount: shadow.querySelector('#zzk-available-count'),
      occupiedCount: shadow.querySelector('#zzk-occupied-count'),
      availableList: shadow.querySelector('#zzk-available-list'),
      occupiedList: shadow.querySelector('#zzk-occupied-list'),
      updatedAt: shadow.querySelector('#zzk-updated-at'),
      card: shadow.querySelector('.zzk-card'),
    };

    if (!isElementsValid(elements)) {
      return;
    }

    state.elements = elements;
    state.mounted = true;

    initializeDefaults(elements);

    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      refreshAvailability();
    });

    elements.highlightToggle.addEventListener('change', () => {
      state.highlightEnabled = elements.highlightToggle.checked;
      if (state.highlightEnabled) {
        applyMapHighlights(state.latestRooms);
      } else {
        clearMapHighlights();
      }
    });

    elements.scheduleToggle.addEventListener('change', () => {
      state.scheduleOverlayEnabled = elements.scheduleToggle.checked;
      if (!state.scheduleOverlayEnabled) {
        removeMapCalendarOverlay();
        return;
      }

      const currentDate = elements.dateInput.value;
      if (currentDate && state.scheduleCache.has(currentDate)) {
        state.activeScheduleDate = currentDate;
        renderMapCalendarOverlay(state.scheduleCache.get(currentDate));
        return;
      }

      if (currentDate) {
        refreshDailySchedule(currentDate);
      }
    });

    elements.dateInput.addEventListener('change', () => {
      const nextDate = normalizeDateInput(elements.dateInput);
      if (!nextDate) {
        return;
      }
      state.autoPickedRange = null;

      if (state.scheduleOverlayEnabled && state.scheduleCache.has(nextDate)) {
        state.activeScheduleDate = nextDate;
        renderMapCalendarOverlay(state.scheduleCache.get(nextDate));
      }

      scheduleInputRefresh();
    });

    const rerenderCalendarSelection = () => {
      if (!state.scheduleOverlayEnabled || !state.activeScheduleDate) {
        return;
      }
      const cached = state.scheduleCache.get(state.activeScheduleDate);
      if (cached) {
        renderMapCalendarOverlay(cached);
      }
    };

    const handleTimeInputChange = (inputElement) => {
      normalizeTimeInput(inputElement);
      if (inputElement instanceof HTMLInputElement) {
        inputElement.setCustomValidity('');
      }
      state.autoPickedRange = null;
      rerenderCalendarSelection();
      scheduleInputRefresh();
    };

    elements.startInput.addEventListener('change', () => {
      handleTimeInputChange(elements.startInput);
    });
    elements.endInput.addEventListener('change', () => {
      handleTimeInputChange(elements.endInput);
    });

    elements.collapseButton.addEventListener('click', () => {
      elements.card.classList.toggle('collapsed');
      elements.collapseButton.textContent = elements.card.classList.contains('collapsed') ? '열기' : '접기';
    });
  }

  async function refreshAvailability() {
    if (!isGuestPage() || !state.elements || state.loading) {
      return;
    }

    const sharingMapId = getSharingMapId();
    if (!sharingMapId) {
      setStatus('공유 맵 정보를 찾지 못했습니다.', 'error');
      return;
    }

    if (state.currentSharingMapId !== sharingMapId) {
      state.currentSharingMapId = sharingMapId;
      state.scheduleCache.clear();
      state.activeScheduleDate = null;
      state.autoPickedRange = null;
      state.myReservationsCache = [];
      state.myReservationsLoadedAt = 0;
      state.myReservationsLoadingPromise = null;
      removeMapCalendarOverlay();
      clearMapHighlights();
    }

    const date = normalizeDateInput(state.elements.dateInput);
    const startTime = normalizeTimeInput(state.elements.startInput);
    const endTime = normalizeTimeInput(state.elements.endInput);

    if (!date || !startTime || !endTime) {
      setStatus('날짜와 시작/종료 시간을 모두 선택해 주세요.', 'error');
      return;
    }

    const isStartValid = validateTenMinuteField(state.elements.startInput);
    const isEndValid = validateTenMinuteField(state.elements.endInput);

    if (!isStartValid || !isEndValid) {
      setStatus('시간은 10분 단위로 선택해 주세요.', 'error');
      return;
    }

    if (startTime >= endTime) {
      setStatus('종료 시간은 시작 시간보다 늦어야 합니다.', 'error');
      return;
    }

    state.loading = true;
    setStatus('공간 현황을 불러오는 중입니다...', 'loading');
    state.elements.refreshButton.disabled = true;

    try {
      let scheduleOverlayErrorMessage = '';
      const response = await sendMessage({
        type: 'ZZK_FETCH_AVAILABILITY',
        payload: {
          sharingMapId,
          date,
          startTime,
          endTime,
        },
      });

      if (!response?.ok) {
        throw new Error(response?.error || '데이터를 불러오지 못했습니다.');
      }

      const data = response.data;
      const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
      state.latestRooms = rooms;

      renderCounts(data?.counts || { total: 0, available: 0, occupied: 0 });
      renderRoomLists(rooms);
      renderUpdatedAt();

      if (state.highlightEnabled) {
        applyMapHighlights(rooms);
      }

      if (state.scheduleOverlayEnabled) {
        try {
          await refreshDailySchedule(date);
        } catch (error) {
          scheduleOverlayErrorMessage = reportScheduleOverlayFailure(error, {
            date,
            sharingMapId,
          });
          removeMapCalendarOverlay();
        }
      }

      if (scheduleOverlayErrorMessage) {
        setStatus(
          `${data?.mapName || '공간 지도'} 현황은 불러왔지만 시간표 표시에는 실패했습니다. ${scheduleOverlayErrorMessage}`,
          'error'
        );
        return;
      }

      setStatus(`${data?.mapName || '공간 지도'} · ${date} ${startTime}~${endTime} 기준`, 'success');
    } catch (error) {
      clearMapHighlights();
      setStatus(getErrorMessage(error), 'error');
    } finally {
      state.loading = false;
      if (state.elements) {
        state.elements.refreshButton.disabled = false;
      }
    }
  }

  function renderCounts(counts) {
    state.elements.totalCount.textContent = String(counts.total || 0);
    state.elements.availableCount.textContent = String(counts.available || 0);
    state.elements.occupiedCount.textContent = String(counts.occupied || 0);
  }

  function renderRoomLists(rooms) {
    const available = rooms.filter((room) => room.isAvailable);
    const occupied = rooms.filter((room) => !room.isAvailable);

    fillList(state.elements.availableList, available, 'available');
    fillList(state.elements.occupiedList, occupied, 'occupied');
  }

  function fillList(container, rooms, type) {
    container.textContent = '';

    if (rooms.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'zzk-empty';
      empty.textContent = type === 'available' ? '비어 있는 공간 없음' : '사용 중인 공간 없음';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    rooms.forEach((room) => {
      const item = document.createElement('li');
      item.className = `zzk-room zzk-room-${type}`;
      const floorLabel = getRoomFloorLabel(room);
      item.textContent = floorLabel ? `${room.name} · ${floorLabel}` : room.name;
      item.title = floorLabel ? `${room.name} (${floorLabel}) · 공간 ID: ${room.id}` : `공간 ID: ${room.id}`;
      fragment.appendChild(item);
    });
    container.appendChild(fragment);
  }

  async function refreshDailySchedule(date) {
    if (!state.elements || !isGuestPage() || !state.scheduleOverlayEnabled || !date) {
      return;
    }

    try {
      await ensureMyReservationsForOverlayLoaded();
    } catch (error) {
      popupDebug('내 예약 캐시 로딩 실패', getErrorMessage(error));
    }

    if (state.scheduleCache.has(date)) {
      const cachedSchedule = state.scheduleCache.get(date);
      state.activeScheduleDate = date;
      renderMapCalendarOverlay(cachedSchedule);
      return;
    }

    const sharingMapId = getSharingMapId();
    if (!sharingMapId) {
      throw new Error('공유 맵 정보를 찾지 못했습니다.');
    }

    const response = await sendMessage({
      type: 'ZZK_FETCH_DAILY_SCHEDULE',
      payload: {
        sharingMapId,
        date,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || '시간대별 예약 현황을 불러오지 못했습니다.');
    }

    state.scheduleCache.set(date, response.data);
    state.activeScheduleDate = date;
    renderMapCalendarOverlay(response.data);
  }

  function isTodayAllPastSchedule(scheduleData) {
    if (!scheduleData || !isDateString(scheduleData?.date)) {
      return false;
    }

    if (scheduleData.date !== getTodayDateInKST()) {
      return false;
    }

    const currentMinute = getCurrentMinuteInKST();
    if (!Number.isInteger(currentMinute)) {
      return false;
    }

    const timeline = Array.isArray(scheduleData?.timeline) ? scheduleData.timeline : [];
    if (timeline.length === 0) {
      return false;
    }

    return timeline.every((slot) => Number.isInteger(slot?.startMinute) && slot.startMinute < currentMinute);
  }

  function getEffectiveCalendarMinDate() {
    const todayDate = getTodayDateInKST();
    const tomorrowDate = addDaysToDateString(todayDate, 1);
    const currentMinute = getCurrentMinuteInKST();

    if (Number.isInteger(currentMinute) && currentMinute >= BOOKABLE_END_MINUTE) {
      return isDateString(tomorrowDate) ? tomorrowDate : todayDate;
    }

    const todaySchedule = state.scheduleCache.get(todayDate);
    if (isTodayAllPastSchedule(todaySchedule)) {
      return isDateString(tomorrowDate) ? tomorrowDate : todayDate;
    }

    return todayDate;
  }

  async function ensureMyReservationsForOverlayLoaded(force = false) {
    const now = Date.now();
    if (
      !force &&
      Array.isArray(state.myReservationsCache) &&
      state.myReservationsLoadedAt > 0 &&
      now - state.myReservationsLoadedAt < MY_RESERVATION_CACHE_TTL_MS
    ) {
      return state.myReservationsCache;
    }

    if (state.myReservationsLoadingPromise) {
      return state.myReservationsLoadingPromise;
    }

    state.myReservationsLoadingPromise = (async () => {
      const merged = [];
      const seen = new Set();
      let page = 0;
      let hasNext = true;
      let guard = 0;

      while (hasNext && guard < 20) {
        const response = await fetchMyReservationsForPopup({ page });
        const items = Array.isArray(response?.items) ? response.items : [];

        items.forEach((item) => {
          const key = [
            Number.isInteger(item?.id) ? String(item.id) : 'no-id',
            Number.isFinite(item?.startTimestamp) ? String(item.startTimestamp) : 'no-start',
            Number.isInteger(item?.roomId) ? String(item.roomId) : normalizeElementText(item?.roomName || ''),
          ].join('|');

          if (seen.has(key)) {
            return;
          }
          seen.add(key);
          merged.push(item);
        });

        const pagination = response?.pagination;
        if (typeof pagination?.hasNext === 'boolean') {
          hasNext = pagination.hasNext;
        } else if (Number.isInteger(pagination?.totalPages) && Number.isInteger(pagination?.page)) {
          hasNext = pagination.page + 1 < pagination.totalPages;
        } else {
          hasNext = false;
        }

        page += 1;
        guard += 1;
      }

      state.myReservationsCache = merged;
      state.myReservationsLoadedAt = Date.now();
      popupDebug('내 예약 캐시 갱신 완료', { count: merged.length });
      return merged;
    })()
      .catch((error) => {
        state.myReservationsCache = [];
        state.myReservationsLoadedAt = 0;
        throw error;
      })
      .finally(() => {
        state.myReservationsLoadingPromise = null;
      });

    return state.myReservationsLoadingPromise;
  }

  function buildMyReservationsByRoomForDate(scheduleDate) {
    const byRoom = new Map();
    if (!isDateString(scheduleDate)) {
      return byRoom;
    }

    const source = Array.isArray(state.myReservationsCache) ? state.myReservationsCache : [];
    source.forEach((reservation) => {
      if (!reservation || reservation.startDateKey !== scheduleDate) {
        return;
      }

      if (!Number.isInteger(reservation.startMinute) || !Number.isInteger(reservation.endMinute)) {
        return;
      }

      const keys = [];
      if (Number.isInteger(reservation.roomId)) {
        keys.push('id:' + reservation.roomId);
      }

      const normalizedName = normalizeElementText(reservation.roomName || '');
      if (normalizedName) {
        keys.push('name:' + normalizedName);
      }

      const normalizedNameKey = normalizeSpaceNameForMatch(reservation.roomName || '');
      if (normalizedNameKey) {
        keys.push('name-key:' + normalizedNameKey);
      }

      keys.forEach((key) => {
        const list = byRoom.get(key) || [];
        list.push(reservation);
        byRoom.set(key, list);
      });
    });

    return byRoom;
  }

  function getMyReservationsForRoom(myReservationsByRoom, room) {
    const candidates = [];

    if (Number.isInteger(room?.id)) {
      const byId = myReservationsByRoom.get('id:' + room.id);
      if (Array.isArray(byId)) {
        candidates.push(...byId);
      }
    }

    const normalizedRoomName = normalizeElementText(room?.name || '');
    if (normalizedRoomName) {
      const byName = myReservationsByRoom.get('name:' + normalizedRoomName);
      if (Array.isArray(byName)) {
        candidates.push(...byName);
      }
    }

    const normalizedRoomNameKey = normalizeSpaceNameForMatch(room?.name || '');
    if (normalizedRoomNameKey) {
      const byNameKey = myReservationsByRoom.get('name-key:' + normalizedRoomNameKey);
      if (Array.isArray(byNameKey)) {
        candidates.push(...byNameKey);
      }
    }

    if (candidates.length <= 1) {
      return candidates;
    }

    const unique = [];
    const seen = new Set();
    candidates.forEach((candidate) => {
      const key = [
        Number.isInteger(candidate?.id) ? candidate.id : 'no-id',
        candidate?.startMinute,
        candidate?.endMinute,
      ].join('|');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(candidate);
    });

    return unique;
  }

  function clearMapCalendarHoverPreview(container) {
    const root = container instanceof HTMLElement ? container : document.getElementById(MAP_CALENDAR_OVERLAY_ID);
    if (!(root instanceof HTMLElement)) {
      return;
    }

    root.querySelectorAll('.zzk-map-calendar-slot.hoverpick').forEach((element) => {
      element.classList.remove('hoverpick');
    });
  }

  function setMapCalendarHoverPreview(container, roomId, startMinute) {
    const root = container instanceof HTMLElement ? container : document.getElementById(MAP_CALENDAR_OVERLAY_ID);
    if (!(root instanceof HTMLElement) || !Number.isInteger(roomId) || !Number.isInteger(startMinute)) {
      return;
    }

    clearMapCalendarHoverPreview(root);

    const previewEndMinute = startMinute + getAutoPickDurationMinutes();
    const selector = '.zzk-map-calendar-slot[data-room-id="' + roomId + '"]';

    root.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      const slotStartMinute = Number(element.dataset.startMinute);
      const slotEndMinute = Number(element.dataset.endMinute);
      if (!Number.isFinite(slotStartMinute) || !Number.isFinite(slotEndMinute)) {
        return;
      }

      if (slotStartMinute < previewEndMinute && slotEndMinute > startMinute) {
        element.classList.add('hoverpick');
      }
    });
  }

  function getAutoPickDurationMinutes() {
    const selectedDuration = Number(state.autoPickDurationMinutes);
    if (AUTO_PICK_DURATION_OPTIONS.includes(selectedDuration)) {
      return selectedDuration;
    }
    return AUTO_PICK_DURATION_MINUTES;
  }

  function getAutoPickDurationLabel(durationMinutes) {
    const minutes = Number(durationMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      return '1시간';
    }

    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    if (hour > 0 && minute > 0) {
      return `${hour}시간 ${minute}분`;
    }
    if (hour > 0) {
      return `${hour}시간`;
    }
    return `${minute}분`;
  }

  function sanitizeSpaceCategory(value) {
    if (value === SPACE_CATEGORY_PAIRING) {
      return SPACE_CATEGORY_PAIRING;
    }
    return SPACE_CATEGORY_MEETING;
  }

  function getSpaceCategoryLabel(category) {
    return category === SPACE_CATEGORY_PAIRING ? '페어링 존' : '회의실';
  }

  function normalizeSpaceNameForMatch(value) {
    const normalized = normalizeElementText(value);
    return normalized.replace(/\s+/g, '');
  }

  function getRoomSpaceCategory(room) {
    const fromProperty = sanitizeSpaceCategory(room?.spaceCategory);
    if (room?.spaceCategory === SPACE_CATEGORY_MEETING || room?.spaceCategory === SPACE_CATEGORY_PAIRING) {
      return fromProperty;
    }

    const roomNameKey = normalizeSpaceNameForMatch(room?.name || '');
    if (/^페\d+$/.test(roomNameKey)) {
      return SPACE_CATEGORY_PAIRING;
    }

    return SPACE_CATEGORY_MEETING;
  }

  function createMapCalendarSpaceCategoryControls(onSelect) {
    const selectedCategory = sanitizeSpaceCategory(state.mapCalendarSpaceCategory);
    const controlRow = document.createElement('div');
    controlRow.className = 'zzk-map-calendar-space-category-controls';

    const label = document.createElement('strong');
    label.className = 'zzk-map-calendar-space-category-label';
    label.textContent = '구분';
    controlRow.appendChild(label);

    const tabs = document.createElement('div');
    tabs.className = 'zzk-map-calendar-space-category-tabs';
    controlRow.appendChild(tabs);

    MAP_CALENDAR_SPACE_CATEGORY_OPTIONS.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zzk-map-calendar-space-category-button';

      const isActive = option.value === selectedCategory;
      if (isActive) {
        button.classList.add('active');
      }

      button.textContent = option.label;
      button.setAttribute('aria-pressed', String(isActive));
      button.addEventListener('click', () => {
        if (typeof onSelect === 'function') {
          onSelect(option.value);
        }
      });
      tabs.appendChild(button);
    });

    return controlRow;
  }

  function createMapCalendarDurationControls(onSelect) {
    const selectedDurationMinutes = getAutoPickDurationMinutes();

    const controlRow = document.createElement('div');
    controlRow.className = 'zzk-map-calendar-duration-controls';

    const label = document.createElement('strong');
    label.className = 'zzk-map-calendar-duration-label';
    label.textContent = '선택 길이';
    controlRow.appendChild(label);

    AUTO_PICK_DURATION_OPTIONS.forEach((durationMinutes) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zzk-map-calendar-duration-button';
      if (durationMinutes === selectedDurationMinutes) {
        button.classList.add('active');
      }

      button.textContent = getAutoPickDurationLabel(durationMinutes);
      button.setAttribute('aria-pressed', String(durationMinutes === selectedDurationMinutes));
      button.addEventListener('click', () => {
        if (typeof onSelect === 'function') {
          onSelect(durationMinutes);
        }
      });

      controlRow.appendChild(button);
    });

    return controlRow;
  }

  function renderMapCalendarOverlay(scheduleData) {
    if (!state.scheduleOverlayEnabled) {
      removeMapCalendarOverlay();
      return;
    }

    if (!scheduleData || !Array.isArray(scheduleData.timeline)) {
      removeMapCalendarOverlay();
      return;
    }

    if (state.currentSharingMapId !== getSharingMapId()) {
      state.mapCalendarCollapsed = false;
    }

    const mapRoot = getMapRootElement();
    if (!mapRoot) {
      scheduleCalendarOverlayRefresh(450);
      return;
    }

    ensureMapCalendarStyle();
    const inlineTarget = mapRoot.tagName === 'ASIDE';

    let overlay = document.getElementById(MAP_CALENDAR_OVERLAY_ID);
    if (overlay instanceof HTMLElement && overlay.parentElement !== mapRoot) {
      overlay.remove();
      overlay = null;
    }

    if (!(overlay instanceof HTMLElement)) {
      overlay = document.createElement('section');
      overlay.id = MAP_CALENDAR_OVERLAY_ID;
    }

    if (inlineTarget) {
      ensureInlineAsideScrollContainer(mapRoot);
      if (overlay.parentElement !== mapRoot || mapRoot.firstElementChild !== overlay) {
        mapRoot.insertBefore(overlay, mapRoot.firstChild);
      }
      overlay.classList.add('zzk-inline');
    } else {
      if (overlay.parentElement !== mapRoot) {
        mapRoot.appendChild(overlay);
      }
      overlay.classList.remove('zzk-inline');
    }

    overlay.textContent = '';

    const timeline = scheduleData.timeline;
    const allRooms = Array.isArray(scheduleData.rooms) ? scheduleData.rooms : [];
    const selectedSpaceCategory = sanitizeSpaceCategory(state.mapCalendarSpaceCategory);
    const rooms = allRooms.filter((room) => getRoomSpaceCategory(room) === selectedSpaceCategory);
    const scheduleDate = isDateString(scheduleData?.date) ? scheduleData.date : '';
    const todayDate = getTodayDateInKST();
    const isTodaySchedule = scheduleDate === todayDate;
    const currentMinute = isTodaySchedule ? getCurrentMinuteInKST() : null;
    const timelineStartMinute = Number.isInteger(timeline?.[0]?.startMinute) ? timeline[0].startMinute : null;
    const timelineEndMinute = Number.isInteger(timeline?.[timeline.length - 1]?.endMinute)
      ? timeline[timeline.length - 1].endMinute
      : null;
    const currentMinuteForLine =
      Number.isInteger(currentMinute) && Number.isInteger(timelineStartMinute) && Number.isInteger(timelineEndMinute)
        ? Math.min(Math.max(currentMinute, timelineStartMinute), Math.max(timelineEndMinute - 1, timelineStartMinute))
        : currentMinute;
    const fallbackCurrentMinute = isTodaySchedule ? new Date().getHours() * 60 + new Date().getMinutes() : null;
    const effectiveCurrentMinuteForLine = Number.isInteger(currentMinuteForLine)
      ? currentMinuteForLine
      : fallbackCurrentMinute;

    if (isMapCalendarDebugEnabled()) {
      popupDebug('[line-debug] timeline-context', {
        scheduleDate,
        todayDate,
        isTodaySchedule,
        currentMinute,
        currentMinuteForLine,
        effectiveCurrentMinuteForLine,
        timelineStartMinute,
        timelineEndMinute,
        timelineLength: timeline.length,
      });
    }

    const activeAutoPickedRange =
      state.autoPickedRange && state.autoPickedRange.date === scheduleData.date ? state.autoPickedRange : null;
    const myReservationsByRoom = buildMyReservationsByRoomForDate(scheduleDate);

    const card = document.createElement('div');
    card.className = 'zzk-map-calendar-card';
    const stopOverlayEventPropagation = (event) => {
      event.stopPropagation();
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'].forEach((eventName) => {
      card.addEventListener(eventName, stopOverlayEventPropagation);
    });
    card.addEventListener('wheel', stopOverlayEventPropagation, { passive: true });
    overlay.appendChild(card);

    const header = document.createElement('div');
    header.className = 'zzk-map-calendar-header';
    card.appendChild(header);

    const titleControls = document.createElement('div');
    titleControls.className = 'zzk-map-calendar-title-controls';
    header.appendChild(titleControls);

    const topBar = document.createElement('div');
    topBar.className = 'zzk-map-calendar-topbar';

    const brand = document.createElement('div');
    brand.className = 'zzk-map-calendar-brand';

    const brandIcon = document.createElement('img');
    brandIcon.className = 'zzk-map-calendar-brand-icon';
    brandIcon.src = getExtensionIconUrl();
    brandIcon.alt = '찜꽁 Helper 아이콘';
    brandIcon.width = 34;
    brandIcon.height = 34;
    brand.appendChild(brandIcon);

    const brandText = document.createElement('div');
    brandText.className = 'zzk-map-calendar-brand-text';

    const brandTitle = document.createElement('strong');
    brandTitle.className = 'zzk-map-calendar-brand-title';
    brandTitle.textContent = '찜꽁 Helper';
    brandText.appendChild(brandTitle);

    const brandMeta = document.createElement('small');
    brandMeta.className = 'zzk-map-calendar-brand-meta';
    brandMeta.textContent = 'made by 8기 프론트엔드 파라디';
    brandText.appendChild(brandMeta);

    brand.appendChild(brandText);
    topBar.appendChild(brand);

    const topBarActions = document.createElement('div');
    topBarActions.className = 'zzk-map-calendar-topbar-actions';

    const helpButton = document.createElement('button');
    helpButton.type = 'button';
    helpButton.className = 'zzk-map-calendar-help-button';
    helpButton.textContent = '찜꽁 Helper 매뉴얼';
    topBarActions.appendChild(helpButton);

    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'zzk-map-calendar-toggle';
    updateMapCalendarToggleButton(collapseButton, state.mapCalendarCollapsed);
    collapseButton.setAttribute('aria-label', '지도 타임블록 접기/펼치기');
    collapseButton.addEventListener('click', () => {
      setMapCalendarCollapsed(!state.mapCalendarCollapsed, scheduleData);
    });
    topBarActions.appendChild(collapseButton);
    topBar.appendChild(topBarActions);
    titleControls.appendChild(topBar);

    const manual = document.createElement('div');
    manual.className = 'zzk-map-calendar-manual';
    manual.classList.toggle('is-expanded', state.mapCalendarManualExpanded);
    manual.setAttribute('aria-hidden', String(!state.mapCalendarManualExpanded));
    manual.innerHTML = [
      "<strong class='zzk-map-calendar-manual-title'>📘 찜꽁 Helper 사용 가이드</strong>",
      "<p class='zzk-map-calendar-manual-item'>🗓️ <b>날짜 선택</b> 상단 달력에서 <span class='zzk-map-calendar-manual-emphasis'>예약할 날짜를 먼저 고르세요</span>.</p>",
      "<p class='zzk-map-calendar-manual-item'>🟩 <b>시간 클릭</b> 비어 있는 블록(초록)을 누르면 해당 시각부터 <span class='zzk-map-calendar-manual-emphasis'>기본 1시간</span>이 자동 선택됩니다. (하단 버튼으로 10분 단위 조절 가능)</p>",
      "<p class='zzk-map-calendar-manual-item'>🤖 <b>자동 입력</b> 날짜/시작/종료/공간이 사이트 예약 폼에 <span class='zzk-map-calendar-manual-emphasis'>자동 반영</span>됩니다.</p>",
      "<p class='zzk-map-calendar-manual-item'>⏬ <b>자동 이동</b> <span class='zzk-map-calendar-manual-emphasis'>반영 후 약 3초 내 화면이 내려가며</span> 안내 문구와 함께 '사용 목적' 입력란으로 포커스가 이동합니다.</p>",
      "<p class='zzk-map-calendar-manual-item'>🧩 <b>구분 탭</b> <span class='zzk-map-calendar-manual-emphasis'>회의실/페어링 존</span>을 전환해 원하는 공간 타입만 빠르게 조회·선택할 수 있습니다.</p>",
    ].join('');
    titleControls.appendChild(manual);

    helpButton.setAttribute('aria-expanded', String(state.mapCalendarManualExpanded));
    helpButton.setAttribute('aria-controls', 'zzk-map-calendar-manual');
    manual.id = 'zzk-map-calendar-manual';
    helpButton.addEventListener('click', () => {
      if (state.mapCalendarCollapsed) {
        state.mapCalendarManualExpanded = true;
        setMapCalendarCollapsed(false, scheduleData);
      } else {
        state.mapCalendarManualExpanded = !state.mapCalendarManualExpanded;
      }
      manual.classList.toggle('is-expanded', state.mapCalendarManualExpanded);
      manual.setAttribute('aria-hidden', String(!state.mapCalendarManualExpanded));
      helpButton.setAttribute('aria-expanded', String(state.mapCalendarManualExpanded));
    });

    if (state.elements) {
      const controlRow = document.createElement('div');
      controlRow.className = 'zzk-map-calendar-controls';

      const dateMin = getEffectiveCalendarMinDate();
      const initialDate = clampDateToMin(state.elements.dateInput.value || scheduleData.date || '', dateMin);
      state.elements.dateInput.min = dateMin;
      state.elements.dateInput.value = initialDate;

      const datePicker = createMapCalendarDatePicker({
        selectedDate: initialDate,
        minDate: dateMin,
        onSelect: (nextDate) => {
          const currentMinDate = getEffectiveCalendarMinDate();
          const normalizedDate = clampDateToMin(nextDate, currentMinDate);
          state.elements.dateInput.min = currentMinDate;
          state.elements.dateInput.value = normalizedDate;
          state.autoPickedRange = null;
          if (state.scheduleOverlayEnabled && state.scheduleCache.has(normalizedDate)) {
            state.activeScheduleDate = normalizedDate;
            renderMapCalendarOverlay(state.scheduleCache.get(normalizedDate));
          }
          scheduleInputRefresh();
        },
      });
      controlRow.appendChild(datePicker);

      titleControls.appendChild(controlRow);
    }

    const spaceCategoryControls = createMapCalendarSpaceCategoryControls((nextCategory) => {
      const normalizedCategory = sanitizeSpaceCategory(nextCategory);
      if (normalizedCategory === state.mapCalendarSpaceCategory) {
        return;
      }

      state.mapCalendarSpaceCategory = normalizedCategory;
      state.autoPickedRange = null;

      const targetDate = isDateString(scheduleData?.date) ? scheduleData.date : state.activeScheduleDate;
      const nextScheduleData =
        targetDate && state.scheduleCache.has(targetDate) ? state.scheduleCache.get(targetDate) : scheduleData;
      renderMapCalendarOverlay(nextScheduleData);
    });
    titleControls.appendChild(spaceCategoryControls);

    const durationControls = createMapCalendarDurationControls((nextDurationMinutes) => {
      if (nextDurationMinutes === getAutoPickDurationMinutes()) {
        return;
      }

      state.autoPickDurationMinutes = nextDurationMinutes;
      state.autoPickedRange = null;
      const targetDate = isDateString(scheduleData?.date) ? scheduleData.date : state.activeScheduleDate;
      const nextScheduleData = targetDate && state.scheduleCache.has(targetDate) ? state.scheduleCache.get(targetDate) : scheduleData;
      renderMapCalendarOverlay(nextScheduleData);
      showHelperToast(`자동 선택 시간이 ${getAutoPickDurationLabel(nextDurationMinutes)}으로 변경되었습니다.`, 'info', 1800);
    });
    titleControls.appendChild(durationControls);

    const legend = document.createElement('div');
    legend.className = 'zzk-map-calendar-legend';
    legend.innerHTML =
      '<span class="free">비어 있음</span><span class="busy">예약 있음</span><span class="mine">내 예약</span><span class="past">지난 시간</span><span class="current">현재 시간선</span>';
    titleControls.appendChild(legend);

    const body = document.createElement('div');
    body.className = 'zzk-map-calendar-body';
    card.appendChild(body);
    bindMapCalendarInternalScroll(body);
    if (state.mapCalendarCollapsed) {
      card.classList.add('collapsed');
    }

    if (timeline.length === 0 || rooms.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'zzk-map-calendar-empty';
      empty.textContent = `표시할 ${getSpaceCategoryLabel(selectedSpaceCategory)} 일정이 없습니다.`;
      body.appendChild(empty);
      return;
    }

    const floorGroups = buildFloorGroups(rooms);
    const flatRooms = floorGroups.flatMap((group) => group.rooms);

    if (flatRooms.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'zzk-map-calendar-empty';
      empty.textContent = `표시할 ${getSpaceCategoryLabel(selectedSpaceCategory)} 일정이 없습니다.`;
      body.appendChild(empty);
      return;
    }

    const columnTemplate = `${MATRIX_TIME_COLUMN_WIDTH_PX}px repeat(${flatRooms.length}, minmax(${MATRIX_ROOM_COLUMN_MIN_WIDTH_PX}px, 1fr))`;
    const floorStartIndexes = new Set();
    let roomOffset = 0;

    const matrix = document.createElement('div');
    matrix.className = 'zzk-map-calendar-matrix';
    body.appendChild(matrix);

    const floorHeaderRow = document.createElement('div');
    floorHeaderRow.className = 'zzk-map-calendar-matrix-row zzk-floor-header-row';
    floorHeaderRow.style.gridTemplateColumns = columnTemplate;
    matrix.appendChild(floorHeaderRow);

    const floorAxisCell = document.createElement('div');
    floorAxisCell.className = 'zzk-map-calendar-axis-cell';
    floorAxisCell.textContent = '층';
    floorHeaderRow.appendChild(floorAxisCell);

    floorGroups.forEach((group) => {
      floorStartIndexes.add(roomOffset);
      roomOffset += group.rooms.length;

      const floorGroupCell = document.createElement('div');
      floorGroupCell.className = 'zzk-map-calendar-floor-group';
      floorGroupCell.style.gridColumn = `span ${group.rooms.length}`;

      const floorTitle = document.createElement('strong');
      floorTitle.className = 'zzk-map-calendar-floor-title';
      floorTitle.textContent = group.floorCategory;
      floorGroupCell.appendChild(floorTitle);

      const floorTypes = document.createElement('div');
      floorTypes.className = 'zzk-map-calendar-floor-types';
      floorTypes.style.setProperty('--zzk-floor-room-count', String(group.rooms.length));

      const floorTypeSections = getFloorRoomTypeSections(group);
      floorTypeSections.forEach((section) => {
        const floorType = document.createElement('span');
        floorType.className = `zzk-map-calendar-floor-type ${section.kind}`;
        floorType.style.gridColumn = `span ${section.span}`;
        floorType.textContent = section.label;
        floorTypes.appendChild(floorType);
      });

      floorGroupCell.appendChild(floorTypes);
      floorGroupCell.title =
        group.roomTypes.length > 0 ? `${group.floorCategory} (${group.roomTypes.join(', ')})` : group.floorCategory;
      floorHeaderRow.appendChild(floorGroupCell);
    });

    const roomHeaderRow = document.createElement('div');
    roomHeaderRow.className = 'zzk-map-calendar-matrix-row zzk-room-header-row';
    roomHeaderRow.style.gridTemplateColumns = columnTemplate;
    matrix.appendChild(roomHeaderRow);

    const timeAxisCell = document.createElement('div');
    timeAxisCell.className = 'zzk-map-calendar-axis-cell';
    timeAxisCell.textContent = '시간';
    roomHeaderRow.appendChild(timeAxisCell);

    flatRooms.forEach((room, roomIndex) => {
      const roomHeader = document.createElement('div');
      roomHeader.className = 'zzk-map-calendar-room-header';
      if (roomIndex !== 0 && floorStartIndexes.has(roomIndex)) {
        roomHeader.classList.add('floor-start');
      }

      const roomTitle = document.createElement('span');
      roomTitle.className = 'zzk-map-calendar-room-header-title';
      roomTitle.textContent = room.name;
      roomHeader.appendChild(roomTitle);

      roomHeader.title = `${room.name} (${getRoomFloorLabel(room)}) · 공간 ID: ${room.id}`;
      roomHeaderRow.appendChild(roomHeader);
    });

    const matrixBody = document.createElement('div');
    matrixBody.className = 'zzk-map-calendar-matrix-body';
    matrix.appendChild(matrixBody);
    let currentSlotRowElement = null;
    const autoPickDurationMinutes = getAutoPickDurationMinutes();
    const autoPickDurationLabel = getAutoPickDurationLabel(autoPickDurationMinutes);

    timeline.forEach((slot) => {
      const slotRow = document.createElement('div');
      slotRow.className = 'zzk-map-calendar-matrix-row zzk-slot-matrix-row';
      if (slot.isHourMark) {
        slotRow.classList.add('hour-boundary');
      }
      if (slot.startMinute % 60 === 30) {
        slotRow.classList.add('half-hour-boundary');
      }
      const isCurrentTimeRow =
        Number.isInteger(effectiveCurrentMinuteForLine) &&
        effectiveCurrentMinuteForLine >= slot.startMinute &&
        effectiveCurrentMinuteForLine < slot.endMinute;
      if (isCurrentTimeRow) {
        slotRow.classList.add('current-time-row');
        currentSlotRowElement = slotRow;
      }
      slotRow.style.gridTemplateColumns = columnTemplate;
      matrixBody.appendChild(slotRow);

      const timeCell = document.createElement('div');
      timeCell.className = 'zzk-map-calendar-time-cell';
      timeCell.textContent = slot.isHourMark ? slot.label : slot.startMinute % 60 === 30 ? '30' : '';
      slotRow.appendChild(timeCell);

      flatRooms.forEach((room, roomIndex) => {
        const slotElement = document.createElement('div');
        slotElement.className = 'zzk-map-calendar-slot';
        slotElement.dataset.roomId = Number.isInteger(room?.id) ? String(room.id) : '';
        slotElement.dataset.startMinute = String(slot.startMinute);
        slotElement.dataset.endMinute = String(slot.endMinute);
        if (roomIndex !== 0 && floorStartIndexes.has(roomIndex)) {
          slotElement.classList.add('floor-start');
        }

        const floorLabel = getRoomFloorLabel(room);
        const reservations = Array.isArray(room.reservations) ? room.reservations : [];
        const overlappedReservations = reservations.filter(
          (reservation) =>
            Number.isInteger(reservation.startMinute) &&
            Number.isInteger(reservation.endMinute) &&
            reservation.startMinute < slot.endMinute &&
            reservation.endMinute > slot.startMinute
        );

        const isBusy = overlappedReservations.length > 0;
        const myReservationsForRoom = getMyReservationsForRoom(myReservationsByRoom, room);
        const myOverlappedReservations = myReservationsForRoom.filter(
          (reservation) =>
            Number.isInteger(reservation.startMinute) &&
            Number.isInteger(reservation.endMinute) &&
            reservation.startMinute < slot.endMinute &&
            reservation.endMinute > slot.startMinute
        );
        const isMyReservation = myOverlappedReservations.length > 0;
        const isPastSlot = Number.isInteger(currentMinute) && slot.startMinute < currentMinute;
        const autoPickEndMinute = slot.startMinute + autoPickDurationMinutes;
        const maxBoundCandidates = [24 * 60];
        if (Number.isInteger(scheduleData?.range?.endMinute)) {
          maxBoundCandidates.push(scheduleData.range.endMinute);
        }
        if (Number.isInteger(room?.windowEndMinute)) {
          maxBoundCandidates.push(room.windowEndMinute);
        }
        const maximumAllowedMinute = Math.min(...maxBoundCandidates);
        const isAutoPickOverflow = autoPickEndMinute > maximumAllowedMinute;

        if (isPastSlot) {
          slotElement.classList.add('past', 'disabled');
          slotElement.setAttribute('aria-disabled', 'true');
        } else if (isBusy) {
          slotElement.classList.add('busy');
        } else {
          slotElement.classList.add('free');

          if (isAutoPickOverflow) {
            slotElement.classList.add('disabled');
            slotElement.setAttribute('aria-disabled', 'true');
          } else {
            slotElement.classList.add('clickable');
            slotElement.tabIndex = 0;
            slotElement.setAttribute('role', 'button');
            slotElement.setAttribute(
              'aria-label',
              `${room.name} ${slot.label} 슬롯 비어 있음. 클릭하면 이후 ${autoPickDurationLabel} 자동 선택`
            );
            const clearHoverPreview = () => {
              clearMapCalendarHoverPreview(overlay);
            };
            const previewHoverRange = () => {
              setMapCalendarHoverPreview(overlay, room.id, slot.startMinute);
            };

            slotElement.addEventListener('mouseenter', previewHoverRange);
            slotElement.addEventListener('mouseleave', clearHoverPreview);
            slotElement.addEventListener('focus', previewHoverRange);
            slotElement.addEventListener('blur', clearHoverPreview);

            slotElement.addEventListener('click', () => {
              clearHoverPreview();
              handleFreeSlotClick(scheduleData, room, slot);
            });
            slotElement.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                clearHoverPreview();
                handleFreeSlotClick(scheduleData, room, slot);
              }
            });
          }
        }

        const isAutoPickedRange =
          activeAutoPickedRange?.roomId === room.id &&
          activeAutoPickedRange.startMinute < slot.endMinute &&
          activeAutoPickedRange.endMinute > slot.startMinute;

        if (isMyReservation && !isPastSlot) {
          slotElement.classList.add('mine');
        }

        if (isAutoPickedRange && !isPastSlot) {
          slotElement.classList.add('autopick');
        }

        const slotEndLabel = minuteToHourMinute(slot.endMinute);
        const myReservationPreview = myOverlappedReservations
          .slice(0, 2)
          .map((reservation) => {
            const purposeText =
              typeof reservation.purpose === 'string' && reservation.purpose.trim() !== ''
                ? ` ${reservation.purpose.trim()}`
                : '';
            return `${minuteToHourMinute(reservation.startMinute)}~${minuteToHourMinute(reservation.endMinute)}${purposeText}`;
          })
          .join(' | ');
        const reservationPreview = overlappedReservations
          .slice(0, 2)
          .map((reservation) =>
            reservation.owner
              ? `${reservation.startTime}~${reservation.endTime} ${reservation.owner}`
              : `${reservation.startTime}~${reservation.endTime}`
          )
          .join(' | ');

        if (isPastSlot) {
          slotElement.title = `${room.name} (${floorLabel}) ${slot.label}~${slotEndLabel} 지난 시간으로 선택할 수 없습니다.`;
        } else if (isMyReservation) {
          slotElement.title = `${room.name} (${floorLabel}) ${slot.label}~${slotEndLabel} 내 예약${
            myReservationPreview ? ` (${myReservationPreview})` : ''
          }`;
        } else if (isBusy) {
          slotElement.title = `${room.name} (${floorLabel}) ${slot.label}~${slotEndLabel} 예약 있음${
            reservationPreview ? ` (${reservationPreview})` : ''
          }`;
        } else if (isAutoPickOverflow) {
          slotElement.title = `${room.name} (${floorLabel}) ${minuteToHourMinute(
            slot.startMinute
          )} 기준 ${autoPickDurationLabel} 구간을 확보할 수 없어 자동 선택할 수 없습니다.`;
        } else {
          slotElement.title = `${room.name} (${floorLabel}) ${slot.label}~${slotEndLabel} 비어 있음 · 클릭하면 ${slot.label} 기준 이후 ${autoPickDurationLabel} 자동 선택`;
        }

        slotRow.appendChild(slotElement);
      });
    });

    if (isTodaySchedule && !currentSlotRowElement && timeline.length > 0) {
      const fallbackRowElement =
        Number.isInteger(effectiveCurrentMinuteForLine) &&
        Number.isInteger(timelineEndMinute) &&
        effectiveCurrentMinuteForLine >= timelineEndMinute
          ? matrixBody.lastElementChild
          : matrixBody.firstElementChild;

      if (fallbackRowElement instanceof HTMLElement) {
        fallbackRowElement.classList.add('current-time-row');
        currentSlotRowElement = fallbackRowElement;
      }
    }

    if (isMapCalendarDebugEnabled()) {
      popupDebug('[line-debug] row-detection', {
        isTodaySchedule,
        foundCurrentRow: Boolean(currentSlotRowElement),
        effectiveCurrentMinuteForLine,
      });
    }

    if (isTodaySchedule && currentSlotRowElement) {
      requestAnimationFrame(() => {
        scrollMapCalendarBodyToCurrentTime(body, currentSlotRowElement);
      });
    }
  }

  function setMapCalendarCollapsed(nextCollapsed, scheduleData = null) {
    const collapsed = Boolean(nextCollapsed);
    state.mapCalendarCollapsed = collapsed;

    const overlay = document.getElementById(MAP_CALENDAR_OVERLAY_ID);
    const card = overlay?.querySelector('.zzk-map-calendar-card');
    const body = overlay?.querySelector('.zzk-map-calendar-body');
    const toggleButton = overlay?.querySelector('.zzk-map-calendar-toggle');
    const hasBodyContent = body instanceof HTMLElement && body.childElementCount > 0;

    if (card instanceof HTMLElement && (collapsed || hasBodyContent)) {
      card.classList.toggle('collapsed', collapsed);
      if (toggleButton instanceof HTMLButtonElement) {
        updateMapCalendarToggleButton(toggleButton, collapsed);
      }
      return;
    }

    if (scheduleData) {
      renderMapCalendarOverlay(scheduleData);
      return;
    }

    if (state.activeScheduleDate && state.scheduleCache.has(state.activeScheduleDate)) {
      renderMapCalendarOverlay(state.scheduleCache.get(state.activeScheduleDate));
    }
  }

  function updateMapCalendarToggleButton(buttonElement, collapsed) {
    if (!(buttonElement instanceof HTMLButtonElement)) {
      return;
    }

    if (collapsed) {
      buttonElement.textContent = '펼치기';
      buttonElement.classList.add('needs-expand');
      buttonElement.setAttribute('aria-pressed', 'false');
      return;
    }

    buttonElement.textContent = '접기';
    buttonElement.classList.remove('needs-expand');
    buttonElement.setAttribute('aria-pressed', 'true');
  }

  function ensureInlineAsideScrollContainer(asideElement) {
    if (!(asideElement instanceof HTMLElement)) {
      return;
    }

    asideElement.classList.add(INLINE_ASIDE_SCROLL_CLASS);

    if (asideElement.dataset.zzkInlineAsideWheelBound === '1') {
      return;
    }
    asideElement.dataset.zzkInlineAsideWheelBound = '1';

    asideElement.addEventListener(
      'wheel',
      (event) => {
        if (event.defaultPrevented) {
          return;
        }
        if (!(event.target instanceof Node) || !asideElement.contains(event.target)) {
          return;
        }

        if (asideElement.scrollHeight <= asideElement.clientHeight + 1) {
          return;
        }

        event.preventDefault();
        asideElement.scrollTop += event.deltaY;
      },
      { passive: false }
    );
  }

  function bindMapCalendarInternalScroll(scrollContainer) {
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    scrollContainer.addEventListener(
      'wheel',
      (event) => {
        if (!(event.target instanceof Node) || !scrollContainer.contains(event.target)) {
          return;
        }

        if (scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        scrollContainer.scrollTop += event.deltaY;
      },
      { passive: false }
    );
  }

  function scrollMapCalendarBodyToCurrentTime(scrollContainer, currentRowElement) {
    if (!(scrollContainer instanceof HTMLElement) || !(currentRowElement instanceof HTMLElement)) {
      return;
    }

    if (scrollContainer.clientHeight <= 0) {
      return;
    }

    const scrollContainerRect = scrollContainer.getBoundingClientRect();
    const currentRowRect = currentRowElement.getBoundingClientRect();
    const rowHeight = Math.max(currentRowRect.height, 1);

    let rowTopOffsetInContainer = currentRowRect.top - scrollContainerRect.top + scrollContainer.scrollTop;
    if (!Number.isFinite(rowTopOffsetInContainer)) {
      rowTopOffsetInContainer = Number.isFinite(currentRowElement.offsetTop) ? currentRowElement.offsetTop : 0;
    }
    const rowCenterOffset = rowTopOffsetInContainer + rowHeight / 2;

    const floorHeaderHeight = Math.max(
      scrollContainer.querySelector('.zzk-floor-header-row')?.getBoundingClientRect().height ?? 0,
      0
    );
    const roomHeaderHeight = Math.max(
      scrollContainer.querySelector('.zzk-room-header-row')?.getBoundingClientRect().height ?? 0,
      0
    );
    const stickyHeaderHeight = floorHeaderHeight + roomHeaderHeight;
    const minimumVisualTop = stickyHeaderHeight + rowHeight * CURRENT_TIME_INITIAL_TOP_OFFSET_ROWS;

    const preferredVisualTop = Math.max(scrollContainer.clientHeight * CURRENT_TIME_TARGET_VIEWPORT_RATIO, minimumVisualTop, 56);

    const rawScrollTop = rowCenterOffset - preferredVisualTop;
    const maxScrollTop = Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0);
    const nextScrollTop = Math.min(Math.max(rawScrollTop, 0), maxScrollTop);
    scrollContainer.scrollTop = nextScrollTop;

    if (isMapCalendarDebugEnabled()) {
      popupDebug('[line-debug] scroll-target', {
        rowTopOffsetInContainer,
        rowHeight,
        rowCenterOffset,
        preferredVisualTop,
        rawScrollTop,
        maxScrollTop,
        nextScrollTop,
      });
    }
  }

  function createMapCalendarDatePicker({ selectedDate, minDate, onSelect }) {
    const normalizedMinDate = isDateString(minDate) ? minDate : getTodayDateInKST();
    let activeDate = clampDateToMin(selectedDate, normalizedMinDate);
    if (!isDateString(activeDate)) {
      activeDate = normalizedMinDate;
    }

    const picker = document.createElement('div');
    picker.className = 'zzk-map-calendar-date-picker';

    const headerRow = document.createElement('div');
    headerRow.className = 'zzk-map-calendar-date-picker-header';
    picker.appendChild(headerRow);

    const activeDateLabel = document.createElement('strong');
    activeDateLabel.className = 'zzk-map-calendar-date-active';
    headerRow.appendChild(activeDateLabel);

    const monthNav = document.createElement('div');
    monthNav.className = 'zzk-map-calendar-date-month-nav';
    headerRow.appendChild(monthNav);

    const prevMonthButton = document.createElement('button');
    prevMonthButton.type = 'button';
    prevMonthButton.className = 'zzk-map-calendar-date-nav-button';
    prevMonthButton.setAttribute('aria-label', '이전 달');
    prevMonthButton.textContent = '<';
    monthNav.appendChild(prevMonthButton);

    const monthLabel = document.createElement('span');
    monthLabel.className = 'zzk-map-calendar-date-month-label';
    monthNav.appendChild(monthLabel);

    const nextMonthButton = document.createElement('button');
    nextMonthButton.type = 'button';
    nextMonthButton.className = 'zzk-map-calendar-date-nav-button';
    nextMonthButton.setAttribute('aria-label', '다음 달');
    nextMonthButton.textContent = '>';
    monthNav.appendChild(nextMonthButton);

    const quickActions = document.createElement('div');
    quickActions.className = 'zzk-map-calendar-date-quick-actions';
    picker.appendChild(quickActions);

    const quickButtonConfigs = [
      { label: '오늘', dayOffset: 0 },
      { label: '내일', dayOffset: 1 },
      { label: '모레', dayOffset: 2 },
      { label: '글피', dayOffset: 3 },
    ];

    const quickButtons = quickButtonConfigs.map((config) => {
      const quickButton = document.createElement('button');
      quickButton.type = 'button';
      quickButton.className = 'zzk-map-calendar-date-quick-button';
      quickButton.textContent = config.label;
      quickActions.appendChild(quickButton);
      return quickButton;
    });

    const weekdayRow = document.createElement('div');
    weekdayRow.className = 'zzk-map-calendar-date-weekdays';
    CALENDAR_WEEKDAY_LABELS.forEach((weekdayLabel) => {
      const weekdayCell = document.createElement('span');
      weekdayCell.textContent = weekdayLabel;
      weekdayRow.appendChild(weekdayCell);
    });
    picker.appendChild(weekdayRow);

    const dayGrid = document.createElement('div');
    dayGrid.className = 'zzk-map-calendar-date-grid';
    picker.appendChild(dayGrid);

    let visibleMonthDate =
      parseDateStringToLocal(activeDate) || parseDateStringToLocal(normalizedMinDate) || new Date();
    visibleMonthDate = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth(), 1);

    const selectDate = (nextDate) => {
      const normalizedDate = clampDateToMin(nextDate, normalizedMinDate);
      if (!isDateString(normalizedDate)) {
        return;
      }

      activeDate = normalizedDate;
      const activeLocalDate = parseDateStringToLocal(activeDate);
      if (activeLocalDate) {
        visibleMonthDate = new Date(activeLocalDate.getFullYear(), activeLocalDate.getMonth(), 1);
      }

      renderDateGrid();
      if (typeof onSelect === 'function') {
        onSelect(activeDate);
      }
    };

    const renderDateGrid = () => {
      const todayDate = getTodayDateInKST();
      const isTodayDisabled = isTodayAllPastSchedule(state.scheduleCache.get(todayDate));
      const minLocalDate = parseDateStringToLocal(normalizedMinDate);
      const minMonthKey =
        minLocalDate instanceof Date ? minLocalDate.getFullYear() * 12 + minLocalDate.getMonth() : -Infinity;
      const currentMonthKey = visibleMonthDate.getFullYear() * 12 + visibleMonthDate.getMonth();

      prevMonthButton.disabled = currentMonthKey <= minMonthKey;
      monthLabel.textContent = `${visibleMonthDate.getFullYear()}년 ${visibleMonthDate.getMonth() + 1}월`;
      activeDateLabel.textContent = formatDateWithWeekday(activeDate);

      quickButtonConfigs.forEach((config, index) => {
        const quickDate = addDaysToDateString(todayDate, config.dayOffset);
        const quickButton = quickButtons[index];
        if (quickButton instanceof HTMLButtonElement) {
          const isTodayQuickButton = config.dayOffset === 0 || quickDate === todayDate;
          const isDisabled =
            !isDateString(quickDate) || quickDate < normalizedMinDate || (isTodayQuickButton && isTodayDisabled);
          quickButton.disabled = isDisabled;
          quickButton.classList.toggle('active', !isDisabled && activeDate === quickDate);
        }
      });

      dayGrid.textContent = '';
      const firstDateOfMonth = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth(), 1);
      const firstWeekday = firstDateOfMonth.getDay();
      let gridStartDate = new Date(firstDateOfMonth);
      gridStartDate.setDate(firstDateOfMonth.getDate() - firstWeekday);

      if (
        minLocalDate instanceof Date &&
        visibleMonthDate.getFullYear() === minLocalDate.getFullYear() &&
        visibleMonthDate.getMonth() === minLocalDate.getMonth()
      ) {
        const minWeekStartDate = new Date(minLocalDate);
        minWeekStartDate.setDate(minWeekStartDate.getDate() - minWeekStartDate.getDay());
        if (gridStartDate < minWeekStartDate) {
          gridStartDate = minWeekStartDate;
        }
      }

      const lastDateOfMonth = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth() + 1, 0);
      const lastWeekday = lastDateOfMonth.getDay();
      const gridEndDate = new Date(lastDateOfMonth);
      gridEndDate.setDate(lastDateOfMonth.getDate() + (6 - lastWeekday));
      const totalDays = Math.max(
        Math.floor((gridEndDate.getTime() - gridStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1,
        0
      );

      for (let index = 0; index < totalDays; index += 1) {
        const dayDate = new Date(gridStartDate);
        dayDate.setDate(gridStartDate.getDate() + index);
        const dayDateString = formatDate(dayDate);

        if (dayDateString < normalizedMinDate) {
          const spacer = document.createElement('span');
          spacer.className = 'zzk-map-calendar-date-spacer';
          spacer.setAttribute('aria-hidden', 'true');
          dayGrid.appendChild(spacer);
          continue;
        }

        const dayButton = document.createElement('button');
        dayButton.type = 'button';
        dayButton.className = 'zzk-map-calendar-date-cell';
        dayButton.textContent = String(dayDate.getDate());
        dayButton.setAttribute('aria-label', `${formatDateWithWeekday(dayDateString)} 선택`);

        if (dayDate.getMonth() !== visibleMonthDate.getMonth()) {
          dayButton.classList.add('outside');
        }
        const isTodayCell = dayDateString === todayDate;
        const isDisabledTodayCell = isTodayCell && isTodayDisabled;

        if (isTodayCell) {
          dayButton.classList.add('today');
        }
        if (dayDateString === activeDate) {
          dayButton.classList.add('selected');
        }

        if (isDisabledTodayCell) {
          dayButton.classList.add('disabled');
          dayButton.disabled = true;
          dayButton.setAttribute('aria-disabled', 'true');
        } else {
          dayButton.addEventListener('click', () => {
            selectDate(dayDateString);
          });
        }

        dayGrid.appendChild(dayButton);
      }
    };

    prevMonthButton.addEventListener('click', () => {
      if (prevMonthButton.disabled) {
        return;
      }
      visibleMonthDate = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth() - 1, 1);
      renderDateGrid();
    });
    nextMonthButton.addEventListener('click', () => {
      visibleMonthDate = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth() + 1, 1);
      renderDateGrid();
    });
    quickButtonConfigs.forEach((config, index) => {
      const quickButton = quickButtons[index];
      if (!(quickButton instanceof HTMLButtonElement)) {
        return;
      }

      quickButton.addEventListener('click', () => {
        if (quickButton.disabled) {
          return;
        }

        const quickDate = addDaysToDateString(getTodayDateInKST(), config.dayOffset);
        if (isDateString(quickDate)) {
          selectDate(quickDate);
        }
      });
    });

    renderDateGrid();
    return picker;
  }

  async function handleFreeSlotClick(scheduleData, room, slot) {
    if (state.slotAutoPicking || !state.elements) {
      return;
    }

    const rangeResult = buildAutoPickRange(scheduleData, room, slot);
    if (!rangeResult.ok) {
      showHelperToast(rangeResult.message, 'error');
      setStatus(rangeResult.message, 'error');
      return;
    }

    const targetDate = isDateString(scheduleData?.date)
      ? scheduleData.date
      : normalizeDateInput(state.elements.dateInput);
    if (!targetDate) {
      const message = '자동 선택할 날짜 정보를 찾지 못했습니다.';
      showHelperToast(message, 'error');
      setStatus(message, 'error');
      return;
    }

    const startTime = minuteToHourMinute(rangeResult.startMinute);
    const endTime = minuteToHourMinute(rangeResult.endMinute);
    const floorLabel = getRoomFloorLabel(room);

    state.slotAutoPicking = true;
    state.autoPickedRange = {
      date: targetDate,
      roomId: room.id,
      startMinute: rangeResult.startMinute,
      endMinute: rangeResult.endMinute,
    };

    state.elements.dateInput.value = targetDate;
    state.elements.startInput.value = startTime;
    state.elements.endInput.value = endTime;
    normalizeTimeInput(state.elements.startInput);
    normalizeTimeInput(state.elements.endInput);

    renderMapCalendarOverlay(scheduleData);
    setStatus(`${room.name} (${floorLabel}) ${startTime}~${endTime} 사이트 예약 폼에 자동 반영 중입니다...`, 'loading');

    try {
      const hostSyncResult = await syncHostReservationForm({
        date: targetDate,
        startTime,
        endTime,
        roomName: room.name,
      });

      if (!hostSyncResult.ok) {
        showHelperToast(hostSyncResult.error, 'error');
        setStatus(hostSyncResult.error, 'error');
        return;
      }

      showReservationSetupToast();

      setStatus(
        `${room.name} (${floorLabel}) ${startTime}~${endTime} 자동 선택을 완료했습니다. 현황을 새로고침합니다.`,
        'success'
      );
      await refreshAvailability();
    } finally {
      state.slotAutoPicking = false;
    }
  }

  function showHelperToast(message, type = 'info', duration = 5000) {
    const normalizedMessage = normalizeElementText(String(message ?? ''));
    if (!normalizedMessage) {
      return;
    }

    const toastType = ['success', 'error', 'info'].includes(type) ? type : 'info';

    const toastStyles = {
      success: {
        background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
        color: '#f8fafc',
        borderRadius: '10px',
        boxShadow: '0 10px 24px rgba(2, 132, 199, 0.32)',
      },
      error: {
        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        color: '#fef2f2',
        borderRadius: '10px',
        boxShadow: '0 10px 24px rgba(220, 38, 38, 0.32)',
      },
      info: {
        background: 'linear-gradient(135deg, #475569 0%, #334155 100%)',
        color: '#f8fafc',
        borderRadius: '10px',
        boxShadow: '0 10px 24px rgba(51, 65, 85, 0.32)',
      },
    };

    if (typeof window.Toastify !== 'function') {
      setStatus(normalizedMessage, toastType === 'error' ? 'error' : 'success');
      return;
    }

    const activeToasts = document.querySelectorAll('.toastify.zzk-helper-toast');
    activeToasts.forEach((toastElement) => {
      if (toastElement instanceof HTMLElement) {
        toastElement.remove();
      }
    });

    window
      .Toastify({
        text: normalizedMessage,
        duration,
        gravity: 'top',
        position: 'center',
        close: false,
        stopOnFocus: true,
        className: 'zzk-helper-toast zzk-helper-toast-' + toastType,
        offset: {
          y: 10,
        },
        style: {
          ...toastStyles[toastType],
          fontSize: '12px',
          fontWeight: '700',
        },
      })
      .showToast();
  }

  function showReservationSetupToast() {
    showHelperToast('예약 세팅이 완료되었습니다. 사용 목적을 입력해주세요.', 'success', 5000);
  }

  function replaceNativeAlertWithToast() {
    if (window.__zzkAlertReplaced === true) {
      return;
    }

    const originalAlert = typeof window.alert === 'function' ? window.alert.bind(window) : null;

    window.alert = (message) => {
      const normalizedMessage = normalizeElementText(String(message ?? ''));
      if (!normalizedMessage) {
        return;
      }
      showHelperToast(normalizedMessage, 'error');
    };

    window.__zzkOriginalAlert = originalAlert;
    window.__zzkAlertReplaced = true;
  }
  function buildAutoPickRange(scheduleData, room, slot) {
    const startMinute = Number(slot?.startMinute);
    const autoPickDurationMinutes = getAutoPickDurationMinutes();
    const autoPickDurationLabel = getAutoPickDurationLabel(autoPickDurationMinutes);
    const endMinute = startMinute + autoPickDurationMinutes;
    const floorLabel = getRoomFloorLabel(room);

    if (!Number.isInteger(endMinute) || !Number.isInteger(startMinute)) {
      return {
        ok: false,
        message: `${room?.name || '선택한 공간'} 시간 정보를 읽지 못했습니다.`,
      };
    }

    if (startMinute >= endMinute) {
      return {
        ok: false,
        message: `${room.name} (${floorLabel}) 자동 선택 구간을 만들 수 없습니다.`,
      };
    }

    const minBoundCandidates = [0];
    if (Number.isInteger(scheduleData?.range?.startMinute)) {
      minBoundCandidates.push(scheduleData.range.startMinute);
    }
    if (Number.isInteger(room?.windowStartMinute)) {
      minBoundCandidates.push(room.windowStartMinute);
    }
    const minimumAllowedMinute = Math.max(...minBoundCandidates);

    if (startMinute < minimumAllowedMinute) {
      return {
        ok: false,
        message: `${room.name} (${floorLabel})은(는) ${slot.label} 시각이 운영 시간 이전이라 자동 선택할 수 없습니다.`,
      };
    }

    const maxBoundCandidates = [24 * 60];
    if (Number.isInteger(scheduleData?.range?.endMinute)) {
      maxBoundCandidates.push(scheduleData.range.endMinute);
    }
    if (Number.isInteger(room?.windowEndMinute)) {
      maxBoundCandidates.push(room.windowEndMinute);
    }
    const maximumAllowedMinute = Math.min(...maxBoundCandidates);

    if (endMinute > maximumAllowedMinute) {
      return {
        ok: false,
        message: `${room.name} (${floorLabel})은(는) ${slot.label} 기준 이후 ${autoPickDurationLabel}을(를) 확보할 수 없어 자동 선택할 수 없습니다.`,
      };
    }

    if (isDateString(scheduleData?.date) && scheduleData.date === getTodayDateInKST()) {
      const minimumSelectableMinute = ceilToStepMinute(getCurrentMinuteInKST(), TIME_STEP_MINUTES);
      if (Number.isInteger(minimumSelectableMinute) && startMinute < minimumSelectableMinute) {
        return {
          ok: false,
          message: `${room.name} (${floorLabel})은(는) 현재 시각 이전 시간을 포함해 자동 선택할 수 없습니다.`,
        };
      }
    }

    const reservations = Array.isArray(room?.reservations) ? room.reservations : [];
    if (hasReservationOverlap(reservations, startMinute, endMinute)) {
      return {
        ok: false,
        message: `${room.name} (${floorLabel}) ${minuteToHourMinute(
          startMinute
        )}~${minuteToHourMinute(endMinute)} 구간에 기존 예약이 있어 자동 선택할 수 없습니다.`,
      };
    }

    return {
      ok: true,
      startMinute,
      endMinute,
    };
  }

  function hasReservationOverlap(reservations, startMinute, endMinute) {
    return reservations.some(
      (reservation) =>
        Number.isInteger(reservation?.startMinute) &&
        Number.isInteger(reservation?.endMinute) &&
        reservation.startMinute < endMinute &&
        reservation.endMinute > startMinute
    );
  }

  function getRoomFloorLabel(room) {
    if (typeof room?.floorLabel === 'string' && room.floorLabel.trim() !== '') {
      return room.floorLabel.trim();
    }
    return '미지정층';
  }

  function getRoomFloorCategory(room) {
    const floorLabel = getRoomFloorLabel(room);
    const [floorCategory] = floorLabel.split('·');
    const normalized = normalizeElementText(floorCategory || '');
    return normalized || floorLabel;
  }

  function getRoomTypeMeta(room) {
    const floorLabel = getRoomFloorLabel(room);
    const fragments = floorLabel
      .split('·')
      .map((fragment) => normalizeElementText(fragment))
      .filter((fragment) => fragment !== '');

    if (fragments.length <= 1) {
      return '';
    }

    return fragments.slice(1).join(' · ');
  }

  function getRoomShortLabel(roomName) {
    const normalizedName = normalizeElementText(roomName);
    if (normalizedName.length <= 2) {
      return normalizedName;
    }
    return normalizedName.slice(0, 2);
  }

  function buildFloorGroups(rooms) {
    const groups = [];
    let activeGroup = null;

    rooms.forEach((room) => {
      const floorCategory = getRoomFloorCategory(room);
      const roomType = getRoomTypeMeta(room);
      const spaceCategory = getRoomSpaceCategory(room);

      if (
        !activeGroup ||
        activeGroup.floorCategory !== floorCategory ||
        activeGroup.spaceCategory !== spaceCategory
      ) {
        activeGroup = {
          floorCategory,
          roomTypes: [],
          rooms: [],
          spaceCategory,
        };
        groups.push(activeGroup);
      }

      activeGroup.rooms.push(room);

      if (roomType && !activeGroup.roomTypes.includes(roomType)) {
        activeGroup.roomTypes.push(roomType);
      }
    });

    return groups;
  }

  function getRoomSizeKind(roomName) {
    const normalizedRoomName = normalizeElementText(roomName || '');

    if (BIG_ROOM_NAMES.has(normalizedRoomName)) {
      return 'big';
    }

    if (SMALL_ROOM_NAMES.has(normalizedRoomName)) {
      return 'small';
    }

    return 'other';
  }

  function getFloorRoomTypeSections(group) {
    const rooms = Array.isArray(group?.rooms) ? group.rooms : [];
    if (rooms.length === 0) {
      return [];
    }

    if (group?.spaceCategory === SPACE_CATEGORY_PAIRING) {
      return [
        {
          kind: 'pairing',
          label: '페어링 존',
          span: rooms.length,
        },
      ];
    }

    const sections = [];
    rooms.forEach((room) => {
      const kind = getRoomSizeKind(room?.name || '');
      const label = kind === 'big' ? '큰방' : kind === 'small' ? '작은방' : '중간방';
      const previousSection = sections[sections.length - 1];

      if (previousSection && previousSection.kind === kind) {
        previousSection.span += 1;
        return;
      }

      sections.push({
        kind,
        label,
        span: 1,
      });
    });

    return sections;
  }

  async function syncHostReservationForm({ date, startTime, endTime, roomName }) {
    const hostElements = getHostReservationElements();
    if (!hostElements) {
      return { ok: false, error: '사이트 예약 폼을 찾지 못했습니다.' };
    }

    setHostDateValue(hostElements.dateInput, date);
    await sleep(HOST_FORM_ACTION_DELAY_MS);

    const startButton = document.querySelector("button[name='start']");
    if (!(startButton instanceof HTMLButtonElement)) {
      return { ok: false, error: '사이트 시작 시간 버튼을 찾지 못했습니다.' };
    }
    const startTimeApplied = await setHostTimeValue(startButton, startTime);
    if (!startTimeApplied) {
      return { ok: false, error: '사이트 시작 시간을 자동 선택하지 못했습니다.' };
    }

    const endButton = document.querySelector("button[name='end']");
    if (!(endButton instanceof HTMLButtonElement)) {
      return { ok: false, error: '사이트 종료 시간 버튼을 찾지 못했습니다.' };
    }
    const endTimeApplied = await setHostTimeValue(endButton, endTime);
    if (!endTimeApplied) {
      return { ok: false, error: '사이트 종료 시간을 자동 선택하지 못했습니다.' };
    }

    await closeHostTimePicker(endButton);
    await sleep(HOST_FORM_ACTION_DELAY_MS);

    const latestSpaceButton = document.getElementById('space-button');
    if (!(latestSpaceButton instanceof HTMLButtonElement)) {
      return { ok: false, error: '사이트 공간 선택 버튼을 찾지 못했습니다.' };
    }

    if (latestSpaceButton.disabled) {
      return {
        ok: false,
        error: '현재 선택한 시간에는 예약 가능한 공간이 없어 공간을 자동 선택할 수 없습니다.',
      };
    }

    const dropdownOpened = await openHostSpaceDropdown(latestSpaceButton);
    if (!dropdownOpened) {
      return { ok: false, error: '사이트 공간 목록을 열지 못했습니다.' };
    }

    const normalizedRoomName = normalizeElementText(roomName);
    const normalizedRoomNameKey = normalizeSpaceNameForMatch(roomName);
    const targetOption = getHostSpaceOptions().find(
      (option) => normalizeSpaceNameForMatch(option.textContent || '') === normalizedRoomNameKey
    );
    if (!(targetOption instanceof HTMLElement)) {
      return {
        ok: false,
        error: `사이트 공간 목록에서 '${roomName}'을 찾지 못했습니다.`,
      };
    }

    clickHTMLElement(targetOption);
    await sleep(HOST_FORM_ACTION_DELAY_MS);

    const selectedText = normalizeElementText(latestSpaceButton.textContent || '');
    const selectedTextKey = normalizeSpaceNameForMatch(selectedText);
    if (!selectedText.includes(normalizedRoomName) && !selectedTextKey.includes(normalizedRoomNameKey)) {
      return { ok: false, error: '공간 자동 선택을 완료하지 못했습니다.' };
    }

    await closeHostTimePicker(endButton);
    await closeHostTimePickerByPurposeDoubleClick();
    await focusHostPurposeFieldWithRetry();

    return { ok: true };
  }

  function getHostReservationElements() {
    const dateInput = document.querySelector("input[name='date']");
    const startButton = document.querySelector("button[name='start']");
    const endButton = document.querySelector("button[name='end']");
    const spaceButton = document.getElementById('space-button');

    if (
      !(dateInput instanceof HTMLInputElement) ||
      !(startButton instanceof HTMLButtonElement) ||
      !(endButton instanceof HTMLButtonElement) ||
      !(spaceButton instanceof HTMLButtonElement)
    ) {
      return null;
    }

    return {
      dateInput,
      startButton,
      endButton,
      spaceButton,
    };
  }

  function focusHostPurposeField() {
    const purposeField = getHostPurposeField();
    if (!purposeField) {
      return false;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    purposeField.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    try {
      purposeField.focus({ preventScroll: true });
    } catch {
      purposeField.focus();
    }

    if (purposeField instanceof HTMLInputElement || purposeField instanceof HTMLTextAreaElement) {
      try {
        const length = purposeField.value.length;
        purposeField.setSelectionRange(length, length);
      } catch {
        // 일부 input 타입에서는 setSelectionRange를 지원하지 않음
      }
    }

    return document.activeElement === purposeField;
  }

  async function focusHostPurposeFieldWithRetry(maxWaitMs = 1200) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (focusHostPurposeField()) {
        return true;
      }
      await sleep(35);
    }

    return focusHostPurposeField();
  }

  async function closeHostTimePickerByPurposeDoubleClick() {
    if (!hasOpenHostTimeUi()) {
      return true;
    }

    const openPanel = getHostTimePanelElement();
    const naturalDismissTarget = getHostTimeNaturalDismissTarget(openPanel);
    const purposeField = getHostPurposeField();
    if (!purposeField) {
      if (naturalDismissTarget instanceof HTMLElement) {
        doubleClickHTMLElement(naturalDismissTarget);
        await sleep(HOST_FORM_ACTION_DELAY_MS);
      }
      return !hasOpenHostTimeUi();
    }

    const clickTargetCandidates = [
      naturalDismissTarget,
      purposeField,
      purposeField.closest('section'),
      purposeField.closest('form'),
    ];

    for (const target of clickTargetCandidates) {
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      doubleClickHTMLElement(target);
      await sleep(HOST_FORM_ACTION_DELAY_MS);
      if (!hasOpenHostTimeUi()) {
        return true;
      }
    }

    return !hasOpenHostTimeUi();
  }

  function getHostPurposeField() {
    const selectorCandidates = [
      "textarea[name='description']",
      "input[name='description']",
      "textarea[name='purpose']",
      "input[name='purpose']",
      "textarea[name='usePurpose']",
      "input[name='usePurpose']",
      "textarea[placeholder*='사용 목적']",
      "input[placeholder*='사용 목적']",
      "textarea[placeholder*='목적']",
      "input[placeholder*='목적']",
      "textarea[aria-label*='사용 목적']",
      "input[aria-label*='사용 목적']",
      "textarea[aria-label*='목적']",
      "input[aria-label*='목적']",
    ];

    for (const selector of selectorCandidates) {
      const element = document.querySelector(selector);
      if (isFocusablePurposeField(element)) {
        return element;
      }
    }

    const labels = Array.from(document.querySelectorAll('label'));
    for (const label of labels) {
      const labelText = normalizeElementText(label.textContent || '');
      if (!labelText.includes('사용 목적') && !labelText.includes('예약 목적') && !labelText.includes('목적')) {
        continue;
      }

      const htmlFor = label.getAttribute('for');
      if (htmlFor) {
        const target = document.getElementById(htmlFor);
        if (isFocusablePurposeField(target)) {
          return target;
        }
      }

      const nestedField = label.querySelector('textarea, input');
      if (isFocusablePurposeField(nestedField)) {
        return nestedField;
      }
    }

    return null;
  }

  function isFocusablePurposeField(element) {
    if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
      return false;
    }

    if (element.disabled || element.readOnly) {
      return false;
    }

    if (
      element instanceof HTMLInputElement &&
      ['hidden', 'radio', 'checkbox', 'button', 'submit'].includes(element.type)
    ) {
      return false;
    }

    return element.getClientRects().length > 0;
  }

  function setHostDateValue(inputElement, nextValue) {
    dispatchNativeInputValue(inputElement, nextValue);
  }

  async function setHostTimeValue(buttonElement, timeValue) {
    const pickerValue = parseHostPickerTimeValue(timeValue);
    if (!pickerValue) {
      return false;
    }

    const pickerOpened = await openHostTimePicker(buttonElement);
    if (!pickerOpened) {
      return false;
    }

    const middaySet = setHostPickerRadio('midday', pickerValue.middayCandidates);
    const hourSet = setHostPickerRadio('hour', pickerValue.hourCandidates);
    const minuteSet = setHostPickerRadio('minute', pickerValue.minuteCandidates);
    await sleep(HOST_FORM_ACTION_DELAY_MS);

    return middaySet && hourSet && minuteSet;
  }

  function parseHostPickerTimeValue(timeValue) {
    const totalMinute = parseHourMinute(timeValue);
    if (!Number.isInteger(totalMinute)) {
      return null;
    }

    const hour24 = Math.floor(totalMinute / 60);
    const minute = totalMinute % 60;
    const isPm = hour24 >= 12;
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const hour = String(hour12);
    const hourPadded = String(hour12).padStart(2, '0');
    const minuteText = String(minute);
    const minutePadded = String(minute).padStart(2, '0');

    return {
      middayCandidates: isPm ? ['오후', 'PM', 'pm'] : ['오전', 'AM', 'am'],
      hourCandidates: [hour, hourPadded],
      minuteCandidates: [minuteText, minutePadded],
    };
  }

  async function openHostTimePicker(buttonElement) {
    restoreForcedHiddenHostTimePanels();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      clickHTMLElement(buttonElement);
      await sleep(HOST_FORM_ACTION_DELAY_MS);

      if (hasOpenHostTimeUi()) {
        return true;
      }
    }

    return false;
  }

  function isHostTimePickerOpen() {
    const hourRadios = Array.from(document.querySelectorAll("input[type='radio'][name='hour']"));
    return hourRadios.some((input) => {
      if (!(input instanceof HTMLElement)) {
        return false;
      }
      if (isVisibleElement(input)) {
        return true;
      }
      const panelLikeContainer =
        input.closest('.sc-dvXYtj') || input.closest('.sc-fbIWvP') || input.closest("[role='dialog']");
      return panelLikeContainer instanceof HTMLElement && isVisibleElement(panelLikeContainer);
    });
  }

  function getHostTimePanelElements() {
    const uniqueElements = new Set();
    const elements = [];

    for (const selector of HOST_TIME_PANEL_SELECTORS) {
      const matched = document.querySelectorAll(selector);
      matched.forEach((element) => {
        if (!(element instanceof HTMLElement) || uniqueElements.has(element)) {
          return;
        }
        uniqueElements.add(element);
        elements.push(element);
      });
    }

    return elements;
  }

  function getHostTimePanelElement() {
    return getHostTimePanelElements().find((element) => isVisibleElement(element)) || null;
  }

  function isHostTimePanelOpen() {
    const panel = getHostTimePanelElement();
    if (!(panel instanceof HTMLElement)) {
      return false;
    }

    const rect = panel.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
      return false;
    }

    const hourRadios = panel.querySelectorAll("input[type='radio'][name='hour']").length;
    if (hourRadios > 0) {
      return true;
    }

    const optionItems = panel.querySelectorAll("li[role='option'], [role='option']").length;
    if (optionItems > 0) {
      return true;
    }

    const panelText = normalizeElementText(panel.textContent || '');
    if (panelText.includes('오전') || panelText.includes('오후')) {
      return true;
    }

    return rect.height >= 100;
  }

  function hasOpenHostTimeUi() {
    return isHostTimePickerOpen() || isHostTimePanelOpen();
  }

  function restoreForcedHiddenHostTimePanels() {
    const forcedHiddenElements = Array.from(document.querySelectorAll("[data-zzk-force-hidden='1']"));

    forcedHiddenElements.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      const previousDisplay = element.dataset.zzkOrigDisplay;
      const previousVisibility = element.dataset.zzkOrigVisibility;
      const previousPointerEvents = element.dataset.zzkOrigPointerEvents;

      if (previousDisplay !== undefined) {
        element.style.display = previousDisplay;
      } else {
        element.style.removeProperty('display');
      }

      if (previousVisibility !== undefined) {
        element.style.visibility = previousVisibility;
      } else {
        element.style.removeProperty('visibility');
      }

      if (previousPointerEvents !== undefined) {
        element.style.pointerEvents = previousPointerEvents;
      } else {
        element.style.removeProperty('pointer-events');
      }

      delete element.dataset.zzkForceHidden;
      delete element.dataset.zzkOrigDisplay;
      delete element.dataset.zzkOrigVisibility;
      delete element.dataset.zzkOrigPointerEvents;
    });
  }

  function setHostPickerRadio(name, valueCandidates) {
    const candidates = Array.isArray(valueCandidates)
      ? valueCandidates.filter((value) => typeof value === 'string' && value !== '')
      : typeof valueCandidates === 'string' && valueCandidates !== ''
        ? [valueCandidates]
        : [];
    if (candidates.length === 0) {
      return false;
    }

    const radioInputs = Array.from(document.querySelectorAll(`input[type='radio'][name='${name}']`));
    if (radioInputs.length === 0) {
      return false;
    }

    const normalizedCandidates = candidates.map((candidate) => normalizeElementText(candidate).toLowerCase());
    const numericCandidates = normalizedCandidates
      .map((candidate) => Number(candidate))
      .filter((candidate) => Number.isFinite(candidate));

    const radioInput =
      radioInputs.find((input) => {
        const value = normalizeElementText(input.value || '').toLowerCase();
        if (normalizedCandidates.includes(value)) {
          return true;
        }

        const numericValue = Number(value);
        if (Number.isFinite(numericValue) && numericCandidates.includes(numericValue)) {
          return true;
        }

        const labelText = normalizeElementText(
          input.closest('label')?.textContent || input.parentElement?.textContent || ''
        ).toLowerCase();
        return normalizedCandidates.some((candidate) => labelText.includes(candidate));
      }) || radioInputs[0];

    if (!(radioInput instanceof HTMLInputElement)) {
      return false;
    }

    return triggerHostRadioSelection(radioInput);
  }

  function triggerHostRadioSelection(radioInput) {
    radioInput.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );

    if (!radioInput.checked) {
      radioInput.checked = true;
      radioInput.dispatchEvent(new Event('input', { bubbles: true }));
      radioInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return radioInput.checked;
  }

  async function closeHostTimePicker(fallbackTarget) {
    if (!hasOpenHostTimeUi()) {
      return;
    }

    const openPanel = getHostTimePanelElement();
    const preferredDismissTarget = getHostTimeDismissTarget(fallbackTarget, openPanel);

    tryCloseHostTimePanel(openPanel);
    dispatchEscapeKey(document);
    if (document.activeElement) {
      dispatchEscapeKey(document.activeElement);
    }
    blurActiveElement();
    dispatchHostTimePanelFocusOut(openPanel, preferredDismissTarget);

    if (preferredDismissTarget instanceof HTMLElement) {
      doubleClickHTMLElement(preferredDismissTarget);
      await sleep(HOST_FORM_ACTION_DELAY_MS);
    }

    if (hasOpenHostTimeUi()) {
      clickOutsideForDismiss(openPanel, preferredDismissTarget);
      await sleep(HOST_FORM_ACTION_DELAY_MS);
    }

    if (hasOpenHostTimeUi()) {
      toggleHostTimePickerButton(fallbackTarget);
      await sleep(HOST_FORM_ACTION_DELAY_MS);
    }

    if (hasOpenHostTimeUi()) {
      forceCollapseHostTimeSection();
      await sleep(HOST_FORM_ACTION_DELAY_MS);
    }

    if (hasOpenHostTimeUi()) {
      forceHideHostTimePickerLayer(openPanel);
    }
  }

  function dispatchEscapeKey(target) {
    if (!(target instanceof EventTarget)) {
      return;
    }

    const keyboardEventOptions = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    };

    target.dispatchEvent(new KeyboardEvent('keydown', keyboardEventOptions));
    target.dispatchEvent(new KeyboardEvent('keyup', keyboardEventOptions));
  }

  function getHostTimeDismissTarget(fallbackTarget, openPanel = getHostTimePanelElement()) {
    const naturalDismissTarget = getHostTimeNaturalDismissTarget(openPanel);
    if (naturalDismissTarget) {
      return naturalDismissTarget;
    }

    const targetCandidates = [
      document.querySelector('#root > div > aside > form > section > div:nth-child(1)'),
      document.querySelector('#root > div > aside > form'),
      document.querySelector('#root > div > aside'),
      fallbackTarget,
      document.body,
    ];

    return targetCandidates.find((target) => target instanceof HTMLElement) || null;
  }

  function getHostTimeNaturalDismissTarget(openPanel = getHostTimePanelElement()) {
    const startButton = document.querySelector("button[name='start']");
    const endButton = document.querySelector("button[name='end']");
    const timeFieldRoot =
      startButton instanceof HTMLElement
        ? startButton.closest("div.sc-hOPeYd, div[class*='sc-hOPeYd']")
        : endButton instanceof HTMLElement
          ? endButton.closest("div.sc-hOPeYd, div[class*='sc-hOPeYd']")
          : null;

    const targetCandidates = [
      document.querySelector('div.sc-hOPeYd.eXirsP > div.sc-daBunf.eQUdeu'),
      document.querySelector('div.sc-hOPeYd.eXirsP > div.sc-fbIWvP.jREztg > div.sc-TtZnY.gnBPmJ'),
      timeFieldRoot instanceof HTMLElement
        ? timeFieldRoot.querySelector("div.sc-daBunf.eQUdeu, div[class*='sc-daBunf']")
        : null,
      timeFieldRoot instanceof HTMLElement
        ? timeFieldRoot.querySelector("div.sc-TtZnY.gnBPmJ, div[class*='sc-TtZnY']")
        : null,
      document.querySelector('#root > div > aside > form > section > div:nth-child(2) > div.sc-daBunf.eQUdeu'),
    ];

    return (
      targetCandidates.find(
        (target) =>
          target instanceof HTMLElement &&
          !(openPanel instanceof HTMLElement && (target === openPanel || openPanel.contains(target)))
      ) || null
    );
  }

  function toggleHostTimePickerButton(preferredButton) {
    const candidates = [
      preferredButton,
      document.querySelector("button[name='end']"),
      document.querySelector("button[name='start']"),
    ];

    const visited = new Set();
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLButtonElement)) {
        continue;
      }
      if (visited.has(candidate)) {
        continue;
      }
      visited.add(candidate);
      clickHTMLElement(candidate);
      return true;
    }

    return false;
  }

  function getHostTimePickerLayerElement(openPanel = getHostTimePanelElement()) {
    if (!(openPanel instanceof HTMLElement)) {
      return null;
    }

    if (openPanel.matches("div.sc-dvXYtj.iduHXF, div[class*='sc-dvXYtj']")) {
      return openPanel;
    }

    const nestedLayer = openPanel.querySelector("div.sc-dvXYtj.iduHXF, div[class*='sc-dvXYtj']");
    return nestedLayer instanceof HTMLElement ? nestedLayer : null;
  }

  function dispatchHostTimePanelFocusOut(openPanel, relatedTarget = null) {
    const layerElement = getHostTimePickerLayerElement(openPanel);
    if (!(layerElement instanceof HTMLElement)) {
      return false;
    }

    const focusTarget =
      layerElement.querySelector("input[type='radio']:checked") ||
      layerElement.querySelector("input[type='radio']") ||
      layerElement;

    if (focusTarget instanceof HTMLElement) {
      focusTarget.blur();
    }

    if (typeof FocusEvent !== 'function') {
      return true;
    }

    const focusEventOptions = {
      bubbles: true,
      cancelable: true,
      relatedTarget: relatedTarget instanceof Element ? relatedTarget : null,
    };

    if (focusTarget instanceof HTMLElement) {
      focusTarget.dispatchEvent(new FocusEvent('focusout', focusEventOptions));
    }
    layerElement.dispatchEvent(new FocusEvent('focusout', focusEventOptions));
    layerElement.dispatchEvent(
      new FocusEvent('blur', {
        bubbles: false,
        cancelable: true,
        relatedTarget: relatedTarget instanceof Element ? relatedTarget : null,
      })
    );

    return true;
  }

  function forceHideHostTimePickerLayer(openPanel = getHostTimePanelElement()) {
    const layerElement = getHostTimePickerLayerElement(openPanel);
    if (!(layerElement instanceof HTMLElement)) {
      return false;
    }

    if (layerElement.dataset.zzkForceHidden !== '1') {
      layerElement.dataset.zzkOrigDisplay = layerElement.style.display || '';
      layerElement.dataset.zzkOrigVisibility = layerElement.style.visibility || '';
      layerElement.dataset.zzkOrigPointerEvents = layerElement.style.pointerEvents || '';
    }

    layerElement.dataset.zzkForceHidden = '1';
    layerElement.style.display = 'none';
    layerElement.style.visibility = 'hidden';
    layerElement.style.pointerEvents = 'none';
    return true;
  }

  function clickOutsideForDismiss(openPanel = getHostTimePanelElement(), preferredTarget = null) {
    const targetCandidates = [
      preferredTarget,
      document.querySelector('#root > div > aside > form > section > div:nth-child(1)'),
      document.querySelector('#root > div > aside > form'),
      document.body,
    ];

    let clicked = false;
    for (const target of targetCandidates) {
      if (target instanceof HTMLElement) {
        if (openPanel instanceof HTMLElement && (target === openPanel || openPanel.contains(target))) {
          continue;
        }
        clickHTMLElement(target);
        clicked = true;
        break;
      }
    }

    if (!clicked && openPanel instanceof HTMLElement) {
      clicked = clickOutsidePanelBounds(openPanel);
    }

    if (!clicked) {
      clickHTMLElement(document.body);
    }
  }

  function forceCollapseHostTimeSection() {
    const timeSection = document.querySelector(HOST_TIME_SECTION_SELECTOR);
    if (!(timeSection instanceof HTMLElement)) {
      return;
    }

    const expandedButton = timeSection.querySelector("[aria-expanded='true']");
    if (expandedButton instanceof HTMLElement) {
      clickHTMLElement(expandedButton);
      blurActiveElement();
      return;
    }

    const outsideTarget =
      timeSection.nextElementSibling instanceof HTMLElement
        ? timeSection.nextElementSibling
        : timeSection.parentElement instanceof HTMLElement
          ? timeSection.parentElement
          : document.body;
    clickHTMLElement(outsideTarget);
    blurActiveElement();
  }

  function tryCloseHostTimePanel(panelElement) {
    if (!(panelElement instanceof HTMLElement)) {
      return;
    }

    const closeActionButton = Array.from(panelElement.querySelectorAll('button')).find((button) => {
      const rawLabel = normalizeElementText(
        button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || ''
      );
      const label = rawLabel.toLowerCase();
      return (
        label.includes('닫기') ||
        label.includes('취소') ||
        label.includes('close') ||
        label === 'x' ||
        label === '×' ||
        label === '✕'
      );
    });

    if (closeActionButton instanceof HTMLElement) {
      clickHTMLElement(closeActionButton);
    }
  }

  async function openHostSpaceDropdown(spaceButton) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      clickHTMLElement(spaceButton);
      await sleep(HOST_FORM_ACTION_DELAY_MS);

      if (getHostSpaceOptions().length > 0) {
        return true;
      }
    }
    return false;
  }

  function getHostSpaceOptions() {
    return Array.from(document.querySelectorAll("li[role='option']"));
  }

  function clickHTMLElement(element, pointOverride = null) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const hasRect = rect.width > 0 && rect.height > 0;
    const point =
      pointOverride ||
      (hasRect
        ? {
            clientX: rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1)),
            clientY: rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1)),
          }
        : null);

    dispatchPointerSequence(element, point);

    if (isInteractiveClickTarget(element)) {
      element.click();
      return;
    }

    element.dispatchEvent(new MouseEvent('click', buildMouseEventOptions(point)));
  }

  function doubleClickHTMLElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const hasRect = rect.width > 0 && rect.height > 0;
    const point = hasRect
      ? {
          clientX: rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1)),
          clientY: rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1)),
        }
      : null;

    clickHTMLElement(element, point);
    clickHTMLElement(element, point);
    element.dispatchEvent(
      new MouseEvent('dblclick', {
        ...buildMouseEventOptions(point),
        detail: 2,
      })
    );
  }

  function clickOutsidePanelBounds(panelElement) {
    if (!(panelElement instanceof HTMLElement)) {
      return false;
    }

    const rect = panelElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const maxX = Math.max(window.innerWidth - 2, 2);
    const maxY = Math.max(window.innerHeight - 2, 2);
    const midY = Math.min(Math.max(rect.top + rect.height / 2, 2), maxY);
    const midX = Math.min(Math.max(rect.left + rect.width / 2, 2), maxX);

    const outsidePoints = [
      { clientX: Math.min(Math.max(rect.left - 10, 2), maxX), clientY: midY },
      { clientX: Math.min(Math.max(rect.right + 10, 2), maxX), clientY: midY },
      { clientX: midX, clientY: Math.min(Math.max(rect.top - 10, 2), maxY) },
      { clientX: midX, clientY: Math.min(Math.max(rect.bottom + 10, 2), maxY) },
    ];

    for (const point of outsidePoints) {
      const target = document.elementFromPoint(point.clientX, point.clientY);
      if (target instanceof HTMLElement) {
        clickHTMLElement(target, point);
        return true;
      }
    }

    return false;
  }

  function buildMouseEventOptions(point) {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: point?.clientX ?? 0,
      clientY: point?.clientY ?? 0,
    };
  }

  function dispatchPointerSequence(element, point) {
    const downOptions = buildMouseEventOptions(point);
    const upOptions = {
      ...downOptions,
      buttons: 0,
    };

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...downOptions,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
    }
    element.dispatchEvent(new MouseEvent('mousedown', downOptions));

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          ...upOptions,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
    }
    element.dispatchEvent(new MouseEvent('mouseup', upOptions));
  }

  function isInteractiveClickTarget(element) {
    return Boolean(
      element.matches("button, input, select, option, textarea, a[href], label, [role='button'], [role='option']")
    );
  }

  function blurActiveElement() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.getClientRects().length === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return true;
  }

  function dispatchNativeInputValue(inputElement, nextValue) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    if (typeof valueSetter === 'function') {
      valueSetter.call(inputElement, nextValue);
    } else {
      inputElement.value = nextValue;
    }

    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeElementText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function sleep(delay) {
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  function ensureMapCalendarStyle() {
    if (document.getElementById(MAP_CALENDAR_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = MAP_CALENDAR_STYLE_ID;
    const extensionFontUrl = getExtensionFontUrl();
    style.textContent = `
      @font-face {
        font-family: "BMDOHYEON";
        src: url("${extensionFontUrl}") format("truetype");
        font-display: swap;
      }

      #${MAP_CALENDAR_OVERLAY_ID} {
        z-index: 2147483640;
        pointer-events: auto;
      }

      #${MAP_CALENDAR_OVERLAY_ID}.zzk-inline {
        position: relative;
        margin: 0 0 12px;
      }

      #root > div > aside.${INLINE_ASIDE_SCROLL_CLASS} {
        height: 100vh;
        max-height: 100vh;
        overflow-y: auto !important;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }

      #${MAP_CALENDAR_OVERLAY_ID}:not(.zzk-inline) {
        position: fixed;
        left: 12px;
        right: 12px;
        top: 88px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card {
        border: 1px solid rgba(15, 23, 42, 0.15);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(7px);
        color: #0f172a;
        font-family: "BMDOHYEON", "SUIT Variable", "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
        padding: 12px;
        transition: padding 180ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-body {
        max-height: 0 !important;
        opacity: 0;
        overflow: hidden;
        pointer-events: none;
        padding-right: 0;
        margin-top: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed {
        padding-bottom: 8px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-guide,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-controls,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-space-category-controls,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-duration-controls,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-manual,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-legend {
        display: none;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-card.collapsed .zzk-map-calendar-header {
        margin-bottom: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-header {
        display: block;
        margin-bottom: 8px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-title-controls {
        display: grid;
        gap: 7px;
        min-width: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-topbar-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-brand {
        display: inline-flex;
        align-items: flex-start;
        gap: 9px;
        min-width: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-brand-icon {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        object-fit: cover;
        flex: 0 0 auto;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-brand-text {
        display: grid;
        gap: 1px;
        align-content: start;
        min-width: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-brand-title {
        font-size: 18px;
        font-weight: 900;
        color: #0f172a;
        line-height: 1;
        text-align: left;
        letter-spacing: -0.01em;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-brand-meta {
        font-size: 8px;
        font-weight: 600;
        color: #a1aebf;
        line-height: 1.3;
        padding-top: 4px;
        text-align: left;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-help-button,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-toggle {
        height: 26px;
        border: 1px solid rgba(15, 23, 42, 0.18);
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
        font-size: 10px;
        font-weight: 800;
        line-height: 1;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-help-button {
        border-color: rgba(14, 116, 144, 0.42);
        background: linear-gradient(135deg, rgba(224, 242, 254, 0.94), rgba(236, 253, 245, 0.88));
        color: #0c4a6e;
        box-shadow: 0 1px 0 rgba(125, 211, 252, 0.44);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-help-button:hover {
        border-color: rgba(2, 132, 199, 0.56);
        background: linear-gradient(135deg, rgba(186, 230, 253, 0.95), rgba(209, 250, 229, 0.9));
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-help-button[aria-expanded='true'] {
        border-color: rgba(2, 132, 199, 0.62);
        background: linear-gradient(135deg, rgba(186, 230, 253, 0.96), rgba(167, 243, 208, 0.92));
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-toggle:hover {
        background: rgba(241, 245, 249, 0.95);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-toggle.needs-expand {
        background: #f59e0b;
        color: #ffffff;
        border-color: #d97706;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.24);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-toggle.needs-expand:hover {
        background: #d97706;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-controls {
        display: grid;
        gap: 6px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-label {
        font-size: 8.5px;
        font-weight: 900;
        color: #0f766e;
        margin-right: 2px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-tabs {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px;
        border-radius: 999px;
        border: 1px solid rgba(14, 116, 144, 0.26);
        background: rgba(236, 253, 245, 0.72);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-button {
        height: 22px;
        border: 1px solid rgba(14, 116, 144, 0.22);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        color: #0f766e;
        font-size: 8.5px;
        font-weight: 800;
        line-height: 1;
        padding: 0 10px;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-button:hover {
        background: rgba(220, 252, 231, 0.88);
        border-color: rgba(5, 150, 105, 0.38);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-space-category-button.active {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        border-color: rgba(3, 105, 161, 0.76);
        color: #f8fafc;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.24);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-duration-controls {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-duration-label {
        font-size: 8.5px;
        font-weight: 900;
        color: #0f766e;
        margin-right: 2px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-duration-button {
        height: 22px;
        border: 1px solid rgba(14, 116, 144, 0.28);
        border-radius: 999px;
        background: rgba(236, 253, 245, 0.86);
        color: #0f766e;
        font-size: 8.5px;
        font-weight: 800;
        line-height: 1;
        padding: 0 9px;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-duration-button:hover {
        background: rgba(187, 247, 208, 0.82);
        border-color: rgba(5, 150, 105, 0.45);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-duration-button.active {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        border-color: rgba(3, 105, 161, 0.76);
        color: #f8fafc;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.28);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-picker {
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 10px;
        background: rgba(248, 250, 252, 0.97);
        padding: 6px;
        display: grid;
        gap: 4px;
        min-width: 220px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-picker-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-active {
        font-size: 9px;
        color: #0f172a;
        font-weight: 800;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-month-nav {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-month-label {
        font-size: 9px;
        font-weight: 700;
        color: #1e293b;
        min-width: 70px;
        text-align: center;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-nav-button {
        width: 20px;
        height: 20px;
        border: 1px solid rgba(15, 23, 42, 0.2);
        border-radius: 6px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        padding: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-nav-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-quick-actions {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-quick-button {
        border: 1px solid rgba(15, 23, 42, 0.18);
        border-radius: 999px;
        background: #ffffff;
        color: #334155;
        font-size: 8.5px;
        font-weight: 700;
        line-height: 1;
        padding: 3px 7px;
        cursor: pointer;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-quick-button:disabled {
        color: #94a3b8;
        background: rgba(248, 250, 252, 0.94);
        border-color: rgba(203, 213, 225, 0.72);
        cursor: not-allowed;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-quick-button.active {
        background: rgba(14, 165, 233, 0.18);
        border-color: rgba(14, 165, 233, 0.38);
        color: #0369a1;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-weekdays {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 2px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-weekdays span {
        text-align: center;
        font-size: 8px;
        font-weight: 800;
        color: #64748b;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 2px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell {
        height: 20px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 6px;
        background: #ffffff;
        color: #0f172a;
        font-size: 8.5px;
        font-weight: 700;
        cursor: pointer;
        padding: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-spacer {
        height: 20px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell.today {
        border-color: rgba(14, 165, 233, 0.48);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell.selected {
        background: rgba(14, 165, 233, 0.2);
        border-color: rgba(14, 165, 233, 0.52);
        color: #075985;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell.outside {
        color: #94a3b8;
        background: rgba(248, 250, 252, 0.95);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell.disabled {
        color: #cbd5e1;
        background: rgba(248, 250, 252, 0.9);
        border-color: rgba(203, 213, 225, 0.72);
        cursor: not-allowed;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual {
        display: grid;
        gap: 4px;
        border: 1px solid rgba(14, 116, 144, 0.26);
        border-radius: 10px;
        background: linear-gradient(160deg, rgba(240, 249, 255, 0.95), rgba(236, 253, 245, 0.9));
        color: #0f172a;
        font-size: 9.5px;
        line-height: 1.35;
        padding: 0 8px;
        margin: 0;
        max-height: 0;
        opacity: 0;
        transform: translateY(-6px);
        overflow: hidden;
        pointer-events: none;
        border-color: transparent;
        transition: max-height 260ms ease, opacity 180ms ease, transform 220ms ease, padding 220ms ease, margin 220ms ease, border-color 180ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual.is-expanded {
        padding: 7px 8px;
        margin-top: 2px;
        max-height: 420px;
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
        border-color: rgba(14, 116, 144, 0.26);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-title {
        color: #0369a1;
        font-size: 9px;
        font-weight: 900;
        line-height: 1.2;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual p {
        margin: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-item {
        padding: 4px 6px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(186, 230, 253, 0.7);
        color: #1e293b;
        font-size: 9px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-item b {
        color: #0c4a6e;
        font-weight: 900;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-emphasis {
        color: #0369a1;
        background: rgba(186, 230, 253, 0.52);
        border-radius: 4px;
        padding: 0 3px;
        font-weight: 900;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-note {
        margin-top: 2px;
        padding: 5px 6px;
        border-radius: 7px;
        background: linear-gradient(135deg, rgba(254, 249, 195, 0.85), rgba(254, 240, 138, 0.55));
        border: 1px solid rgba(234, 179, 8, 0.35);
        color: #713f12;
        font-size: 9px;
        font-weight: 700;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-manual-note strong {
        color: #854d0e;
        font-size: 8px;
        font-weight: 900;
        margin-right: 4px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-time-divider {
        font-size: 11px;
        font-weight: 700;
        color: #475569;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-guide {
        font-size: 9.5px;
        color: #0f766e;
        font-weight: 700;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend {
        display: flex;
        gap: 6px;
        font-size: 9.5px;
        color: #334155;
        flex-wrap: wrap;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend span::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 2px;
        border: 1px solid rgba(15, 23, 42, 0.25);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .free::before {
        background: rgba(34, 197, 94, 0.4);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .busy::before {
        background: rgba(239, 68, 68, 0.45);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .mine::before {
        background: rgba(249, 115, 22, 0.78);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .past::before {
        background: rgba(148, 163, 184, 0.7);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .hoverpick::before {
        background: rgba(56, 189, 248, 0.95);
        border-color: rgba(2, 132, 199, 0.92);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-legend .current::before {
        width: 10px;
        height: 2px;
        border: none;
        border-radius: 999px;
        background: rgba(30, 64, 175, 0.96);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-body {
        display: grid;
        gap: 6px;
        height: auto;
        max-height: calc(100vh - 280px);
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 2px;
        opacity: 1;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        transition: max-height 220ms ease, opacity 180ms ease, padding 180ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID}.zzk-inline .zzk-map-calendar-body {
        max-height: 62vh;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-matrix {
        --zzk-floor-header-height: 36px;
        display: grid;
        gap: 0;
        width: 100%;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-matrix-row {
        display: grid;
        align-items: center;
        column-gap: 1px;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-floor-header-row {
        position: sticky;
        top: 0;
        z-index: 8;
        background: #f8fafc;
        box-shadow: 0 1px 0 rgba(15, 23, 42, 0.08);
        min-height: var(--zzk-floor-header-height);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-room-header-row {
        position: sticky;
        top: var(--zzk-floor-header-height);
        z-index: 7;
        background: #f8fafc;
        box-shadow: 0 1px 0 rgba(15, 23, 42, 0.06);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-axis-cell {
        position: sticky;
        left: 0;
        z-index: 9;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9.5px;
        font-weight: 800;
        color: #334155;
        text-align: center;
        padding: 0 4px;
        background: rgba(241, 245, 249, 0.95);
        border-right: 1px solid rgba(15, 23, 42, 0.08);
        min-height: 100%;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-floor-header-row .zzk-map-calendar-axis-cell {
        color: #0f766e;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-group {
        font-size: 8.5px;
        font-weight: 800;
        color: #0f766e;
        text-align: center;
        background: rgba(15, 118, 110, 0.1);
        border: 1px solid rgba(15, 118, 110, 0.22);
        border-radius: 6px 6px 0 0;
        border-bottom: 0;
        padding: 0;
        min-height: var(--zzk-floor-header-height);
        display: grid;
        grid-template-rows: 1fr 1fr;
        align-items: stretch;
        overflow: hidden;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-title {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 8.5px;
        font-weight: 900;
        line-height: 1.1;
        text-align: center;
        padding: 2px 3px 1px;
        border-bottom: 1px solid rgba(15, 118, 110, 0.22);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-types {
        display: grid;
        grid-template-columns: repeat(var(--zzk-floor-room-count, 1), minmax(0, 1fr));
        align-items: stretch;
        min-height: 14px;
        width: 100%;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 7.2px;
        font-weight: 800;
        color: #155e75;
        border-left: 1px solid rgba(15, 118, 110, 0.16);
        background: rgba(207, 250, 254, 0.5);
        letter-spacing: -0.01em;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type:first-child {
        border-left: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type.big {
        background: rgba(153, 246, 228, 0.45);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type.small {
        background: rgba(186, 230, 253, 0.5);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type.pairing {
        background: rgba(191, 219, 254, 0.58);
        color: #1e3a8a;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-floor-type.other {
        background: rgba(226, 232, 240, 0.62);
        color: #475569;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-room-header {
        min-height: 26px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 0;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 0 0 6px 6px;
        background: rgba(248, 250, 252, 0.96);
        padding: 1px 2px;
        overflow: visible;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-room-header.floor-start {
        border-left: 2px solid rgba(15, 118, 110, 0.55);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-room-header-title {
        font-size: 8px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.2;
        letter-spacing: -0.01em;
        white-space: normal;
        word-break: keep-all;
        text-align: center;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-room-header-meta {
        display: none;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-matrix-body {
        display: grid;
        gap: 0;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row {
        height: 8px;
        min-height: 8px;
        align-items: stretch;
        position: relative;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-time-cell {
        position: sticky;
        left: 0;
        z-index: 2;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        height: 100%;
        font-size: 8.5px;
        color: #94a3b8;
        text-align: right;
        padding-right: 6px;
        background: rgba(248, 250, 252, 0.96);
        font-variant-numeric: tabular-nums;
        line-height: 1;
        box-sizing: border-box;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.hour-boundary .zzk-map-calendar-time-cell {
        color: #334155;
        font-weight: 700;
        transform: translateY(3px);
        z-index: 5;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.half-hour-boundary .zzk-map-calendar-time-cell {
        color: #64748b;
        font-size: 8px;
        font-weight: 700;
        transform: translateY(3px);
        z-index: 5;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.hour-boundary::before,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.half-hour-boundary::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        pointer-events: none;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.hour-boundary::before {
        border-top: 2px solid rgba(71, 85, 105, 0.46);
        z-index: 4;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.half-hour-boundary::before {
        border-top: 1px solid rgba(148, 163, 184, 0.28);
        z-index: 3;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.current-time-row::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 3px;
        background: rgba(30, 64, 175, 0.96);
        border-radius: 999px;
        z-index: 6;
        pointer-events: none;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-slot-matrix-row.current-time-row .zzk-map-calendar-time-cell {
        color: #1e40af;
        font-weight: 900;
        z-index: 3;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot {
        height: 100%;
        border-radius: 2px;
        border: 1px solid rgba(100, 116, 139, 0.22);
        box-sizing: border-box;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.floor-start {
        box-shadow: inset 1px 0 0 rgba(15, 118, 110, 0.42);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.free {
        background: rgba(34, 197, 94, 0.32);
        border-color: rgba(22, 163, 74, 0.24);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.busy {
        background: rgba(239, 68, 68, 0.45);
        border-color: rgba(220, 38, 38, 0.2);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.mine {
        background: rgba(249, 115, 22, 0.88);
        border-color: rgba(194, 65, 12, 0.72);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.past,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.disabled {
        background: rgba(148, 163, 184, 0.74) !important;
        border-color: rgba(100, 116, 139, 0.26) !important;
        cursor: not-allowed;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.clickable {
        cursor: pointer;
        transition: filter 110ms ease;
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.clickable:hover,
      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.clickable:focus {
        filter: brightness(0.84) saturate(1.2);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.hoverpick {
        background: rgba(56, 189, 248, 0.92) !important;
        border-color: rgba(2, 132, 199, 0.92) !important;
        box-shadow: inset 0 0 0 1px rgba(3, 105, 161, 0.58);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-slot.autopick {
        box-shadow: none;
        background: rgba(125, 211, 252, 0.95) !important;
        border-color: rgba(14, 165, 233, 0.75) !important;
      }

      .toastify.zzk-helper-toast {
        font-family: 'BMDOHYEON', 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
        letter-spacing: 0.01em;
      }

      .toastify.zzk-helper-toast.zzk-helper-toast-error {
        border: 1px solid rgba(254, 202, 202, 0.42);
      }

      .toastify.zzk-helper-toast.zzk-helper-toast-success {
        border: 1px solid rgba(186, 230, 253, 0.42);
      }

      .toastify.zzk-helper-toast.zzk-helper-toast-info {
        border: 1px solid rgba(203, 213, 225, 0.42);
      }

      #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-empty {
        margin: 0;
        font-size: 11px;
        color: #64748b;
      }

      @media (max-width: 920px) {
        #${MAP_CALENDAR_OVERLAY_ID}:not(.zzk-inline) {
          left: 8px;
          right: 8px;
          top: 8px;
        }

        #${MAP_CALENDAR_OVERLAY_ID}.zzk-inline .zzk-map-calendar-body {
          max-height: none;
        }

        #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-picker {
          min-width: 0;
          width: 100%;
        }

        #${MAP_CALENDAR_OVERLAY_ID} .zzk-map-calendar-date-cell {
          height: 22px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function getMapRootElement() {
    const inlineRoot = document.querySelector('#root > div > aside');
    if (inlineRoot instanceof HTMLElement) {
      return inlineRoot;
    }

    const fallbackAside = document.querySelector('#root aside');
    if (fallbackAside instanceof HTMLElement) {
      return fallbackAside;
    }

    const mapSvg = Array.from(document.querySelectorAll('svg')).find(
      (svg) => svg.querySelectorAll('g[data-testid]').length > 0
    );
    if (!(mapSvg instanceof SVGElement)) {
      return null;
    }

    const parent = mapSvg.parentElement;
    if (!(parent instanceof HTMLElement)) {
      return null;
    }

    return parent;
  }

  function removeMapCalendarOverlay() {
    const overlay = document.getElementById(MAP_CALENDAR_OVERLAY_ID);
    if (overlay) {
      overlay.remove();
    }
  }

  function applyMapHighlights(rooms) {
    clearMapHighlights();

    const roomById = new Map(rooms.filter((room) => Number.isInteger(room.id)).map((room) => [room.id, room]));

    if (!state.highlightEnabled || roomById.size === 0) {
      return;
    }

    const groups = document.querySelectorAll('svg g[data-testid]');
    groups.forEach((group) => {
      const id = Number(group.getAttribute('data-testid'));
      const room = roomById.get(id);
      if (!room) {
        return;
      }

      const rect = group.querySelector('rect');
      if (!(rect instanceof SVGElement)) {
        return;
      }

      rememberOriginalRect(rect);

      const fillColor = room.isAvailable ? '#22c55e' : '#ef4444';
      const strokeColor = room.isAvailable ? '#166534' : '#991b1b';
      const textColor = room.isAvailable ? '#064e3b' : '#7f1d1d';

      rect.setAttribute('fill', fillColor);
      rect.setAttribute('opacity', '0.82');
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', '2.5');

      const text = group.querySelector('text');
      if (text instanceof SVGElement) {
        rememberOriginalText(text);
        text.setAttribute('fill', textColor);
        text.setAttribute('font-weight', '700');
      }

      group.setAttribute('data-zzk-status', room.isAvailable ? 'available' : 'occupied');
      state.highlightedRects.add(rect);
    });
  }

  function clearMapHighlights() {
    state.highlightedRects.forEach((rect) => {
      restoreRect(rect);
      const group = rect.parentElement;
      if (group) {
        group.removeAttribute('data-zzk-status');
      }

      const text = group?.querySelector('text');
      if (text instanceof SVGElement) {
        restoreText(text);
      }
    });

    state.highlightedRects.clear();
  }

  function rememberOriginalRect(rect) {
    if (rect.dataset.zzkOrigFill === undefined) {
      rect.dataset.zzkOrigFill = rect.getAttribute('fill') || '';
    }
    if (rect.dataset.zzkOrigOpacity === undefined) {
      rect.dataset.zzkOrigOpacity = rect.getAttribute('opacity') || '';
    }
    if (rect.dataset.zzkOrigStroke === undefined) {
      rect.dataset.zzkOrigStroke = rect.getAttribute('stroke') || '';
    }
    if (rect.dataset.zzkOrigStrokeWidth === undefined) {
      rect.dataset.zzkOrigStrokeWidth = rect.getAttribute('stroke-width') || '';
    }
  }

  function restoreRect(rect) {
    setAttrOrRemove(rect, 'fill', rect.dataset.zzkOrigFill || '');
    setAttrOrRemove(rect, 'opacity', rect.dataset.zzkOrigOpacity || '');
    setAttrOrRemove(rect, 'stroke', rect.dataset.zzkOrigStroke || '');
    setAttrOrRemove(rect, 'stroke-width', rect.dataset.zzkOrigStrokeWidth || '');
  }

  function rememberOriginalText(text) {
    if (text.dataset.zzkOrigFill === undefined) {
      text.dataset.zzkOrigFill = text.getAttribute('fill') || '';
    }
    if (text.dataset.zzkOrigWeight === undefined) {
      text.dataset.zzkOrigWeight = text.getAttribute('font-weight') || '';
    }
  }

  function restoreText(text) {
    setAttrOrRemove(text, 'fill', text.dataset.zzkOrigFill || '');
    setAttrOrRemove(text, 'font-weight', text.dataset.zzkOrigWeight || '');
  }

  function setAttrOrRemove(element, attrName, value) {
    if (!value) {
      element.removeAttribute(attrName);
      return;
    }
    element.setAttribute(attrName, value);
  }

  function renderUpdatedAt() {
    const now = new Date();
    const text = now.toLocaleString('ko-KR', {
      hour12: false,
      timeZone: SEOUL_TIMEZONE,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    state.elements.updatedAt.textContent = `업데이트: ${text} (KST)`;
  }

  function setStatus(message, type) {
    if (!state.elements) {
      return;
    }

    state.elements.statusMessage.textContent = message;
    state.elements.statusMessage.className = `zzk-status ${type}`;
  }

  function initializeDefaults(elements) {
    const todayDate = getTodayDateInKST();

    const hostDateInput = document.querySelector("input[name='date']");
    const hostDateValue =
      hostDateInput instanceof HTMLInputElement && hostDateInput.value ? hostDateInput.value : todayDate;
    const baseDate = clampDateToMin(hostDateValue, todayDate);

    const range = getNextHourRange(baseDate);
    const minDate = getEffectiveCalendarMinDate();

    elements.dateInput.min = minDate;
    elements.dateInput.value = clampDateToMin(range.date, minDate);
    elements.startInput.value = range.startTime;
    elements.endInput.value = range.endTime;
    normalizeTimeInput(elements.startInput);
    normalizeTimeInput(elements.endInput);
    elements.highlightToggle.checked = true;
    elements.scheduleToggle.checked = true;
    state.scheduleOverlayEnabled = true;
    renderCounts({ total: 0, available: 0, occupied: 0 });
  }

  function handleHostDateChange(event) {
    if (!state.elements) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name !== 'date' || !target.value) {
      return;
    }

    const minDate = getEffectiveCalendarMinDate();
    state.elements.dateInput.min = minDate;
    const normalizedDate = clampDateToMin(target.value, minDate);
    state.elements.dateInput.value = normalizedDate;
    if (!state.slotAutoPicking) {
      state.autoPickedRange = null;
    }

    if (state.scheduleOverlayEnabled && state.scheduleCache.has(normalizedDate)) {
      state.activeScheduleDate = normalizedDate;
      renderMapCalendarOverlay(state.scheduleCache.get(normalizedDate));
    }

    scheduleInputRefresh();
  }

  function handleHostTimeControlPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (!shouldRestoreForcedHiddenHostTimePanels(target)) {
      return;
    }

    restoreForcedHiddenHostTimePanels();
  }

  function handleHostTimeControlFocusIn(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (!shouldRestoreForcedHiddenHostTimePanels(target)) {
      return;
    }

    restoreForcedHiddenHostTimePanels();
  }

  function shouldRestoreForcedHiddenHostTimePanels(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(
      target.closest("button[name='start'], button[name='end'], input[type='radio'][name='midday'], input[type='radio'][name='hour'], input[type='radio'][name='minute']")
    );
  }

  function scheduleHighlightRefresh() {
    clearTimeout(state.autoRefreshTimer);
    state.autoRefreshTimer = setTimeout(() => {
      applyMapHighlights(state.latestRooms);
    }, 180);
  }

  function scheduleInputRefresh(delay = 220) {
    clearTimeout(state.inputRefreshTimer);
    state.inputRefreshTimer = setTimeout(() => {
      if (state.loading) {
        scheduleInputRefresh(180);
        return;
      }

      refreshAvailability();
    }, delay);
  }

  function scheduleCalendarOverlayRefresh(delay = 220) {
    clearTimeout(state.autoScheduleRefreshTimer);
    state.autoScheduleRefreshTimer = setTimeout(() => {
      if (!state.scheduleOverlayEnabled || !state.activeScheduleDate) {
        return;
      }

      const cached = state.scheduleCache.get(state.activeScheduleDate);
      if (cached) {
        renderMapCalendarOverlay(cached);
      }
    }, delay);
  }

  function reportScheduleOverlayFailure(error, context = {}) {
    const message = getErrorMessage(error);

    console.error('[zzk] schedule overlay render failed', {
      ...context,
      message,
      error,
    });

    return message;
  }

  function handleLocationChange() {
    if (!isGuestPage()) {
      restoreSiteFavicon();
      if (state.elements?.host) {
        state.elements.host.remove();
      }
      state.elements = null;
      state.mounted = false;
      state.currentSharingMapId = null;
      state.scheduleCache.clear();
      state.activeScheduleDate = null;
      state.autoPickedRange = null;
      state.slotAutoPicking = false;
      clearMapHighlights();
      removeMapCalendarOverlay();
      return;
    }

    applyGuestPageFavicon();
    ensurePanel();
    refreshAvailability();
  }

  function hookHistoryChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      handleLocationChange();
      return result;
    };

    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      handleLocationChange();
      return result;
    };
  }

  function isGuestPage() {
    return /^\/guest\/[^/?#]+/.test(location.pathname);
  }

  function applyGuestPageFavicon() {
    if (!document.head) {
      return;
    }

    const iconUrl = getExtensionIconUrl();
    if (!iconUrl) {
      return;
    }

    const iconLinks = Array.from(document.querySelectorAll(GUEST_FAVICON_SELECTOR));
    if (iconLinks.length === 0) {
      const createdLink = document.createElement('link');
      createdLink.rel = 'icon';
      createdLink.type = 'image/png';
      createdLink.href = iconUrl;
      createdLink.dataset.zzkGuestFavicon = '1';
      createdLink.dataset.zzkOrigHref = '';
      createdLink.dataset.zzkOrigRel = 'icon';
      document.head.appendChild(createdLink);
      return;
    }

    iconLinks.forEach((linkElement) => {
      if (!(linkElement instanceof HTMLLinkElement)) {
        return;
      }
      if (linkElement.dataset.zzkOrigHref === undefined) {
        linkElement.dataset.zzkOrigHref = linkElement.getAttribute('href') || '';
      }
      if (linkElement.dataset.zzkOrigRel === undefined) {
        linkElement.dataset.zzkOrigRel = linkElement.getAttribute('rel') || '';
      }
      linkElement.dataset.zzkGuestFavicon = '1';
      linkElement.setAttribute('href', iconUrl);
      if (!linkElement.getAttribute('type')) {
        linkElement.setAttribute('type', 'image/png');
      }
    });
  }

  function restoreSiteFavicon() {
    const iconLinks = Array.from(document.querySelectorAll("link[data-zzk-guest-favicon='1']"));
    iconLinks.forEach((linkElement) => {
      if (!(linkElement instanceof HTMLLinkElement)) {
        return;
      }

      const originalHref = linkElement.dataset.zzkOrigHref ?? '';
      const originalRel = linkElement.dataset.zzkOrigRel ?? '';

      if (originalHref) {
        linkElement.setAttribute('href', originalHref);
      } else if (linkElement.parentElement) {
        linkElement.remove();
      }

      if (originalRel) {
        linkElement.setAttribute('rel', originalRel);
      }

      delete linkElement.dataset.zzkGuestFavicon;
      delete linkElement.dataset.zzkOrigHref;
      delete linkElement.dataset.zzkOrigRel;
    });
  }

  function popupDebug() {}


  function registerPopupMessageBridge() {
    if (state.popupMessageBridgeRegistered) {
      popupDebug('popup bridge already registered');
      return;
    }
    state.popupMessageBridgeRegistered = true;

    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      popupDebug('chrome.runtime.onMessage unavailable');
      return;
    }

    popupDebug('register popup message bridge');

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'ZZK_POPUP_FETCH_MY_RESERVATIONS') {
        return false;
      }

      popupDebug('bridge message received', {
        type: message?.type,
        hasPayload: Boolean(message?.payload),
      });

      fetchMyReservationsForPopup(message.payload)
        .then((data) => {
          popupDebug('bridge response success', { itemCount: Array.isArray(data?.items) ? data.items.length : -1 });
          sendResponse({ ok: true, data });
        })
        .catch((error) => {
          popupDebug('bridge response error', getErrorMessage(error));
          sendResponse({ ok: false, error: getErrorMessage(error) });
        });

      return true;
    });
  }

  async function fetchMyReservationsForPopup(payload) {
    const page = popupSanitizePage(payload?.page);
    const endpoint =
      'https://k8s.zzimkkong.com/api/guests/reservations?' + new URLSearchParams({ page: String(page) }).toString();

    popupDebug('fetchMyReservationsForPopup start', { page, endpoint });

    const requestReservations = async (authorizationHeader = '') => {
      const headers = {
        Accept: '*/*',
      };

      popupDebug('requestReservations attempt', { hasAuthorization: Boolean(authorizationHeader) });

      if (authorizationHeader) {
        headers.Authorization = authorizationHeader;
      }

      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'omit',
        headers,
      });

      const text = await response.text();
      const parsed = popupSafeParseJsonText(text);

      popupDebug('requestReservations response', {
        status: response.status,
        ok: response.ok,
        bodyKeys: Object.keys(parsed || {}),
      });

      return {
        response,
        data: parsed,
      };
    };

    const authHeaderCandidates = popupResolveAuthorizationHeaderValues();
    popupDebug('authorization header candidates', { count: authHeaderCandidates.length });

    const requestAttemptHeaders = authHeaderCandidates.length > 0 ? authHeaderCandidates : [''];

    let response;
    let data;

    try {
      ({ response, data } = await requestReservations(requestAttemptHeaders[0]));
    } catch (error) {
      if (!isPopupNetworkFetchError(getErrorMessage(error))) {
        throw error;
      }

      popupDebug('direct fetch failed; trying page context fallback');
      const fallback = await popupRequestReservationsInPageContext(endpoint, authHeaderCandidates);
      if (fallback?.ok) {
        popupDebug('page context fallback success');
        return popupBuildReservationPayload(fallback.data, page);
      }

      const fallbackErrorMessage =
        typeof fallback?.error === 'string' && fallback.error.trim() !== '' ? fallback.error : getErrorMessage(error);
      popupDebug('page context fallback error', fallbackErrorMessage);
      throw new Error(fallbackErrorMessage);
    }

    if (!response.ok && (response.status === 401 || response.status === 403)) {
      popupDebug(response.status + ' received; retry with authorization candidates');
      for (const authHeaderValue of requestAttemptHeaders.slice(1)) {
        ({ response, data } = await requestReservations(authHeaderValue));
        popupDebug('retry result', { status: response.status, ok: response.ok });
        if (response.ok || (response.status !== 401 && response.status !== 403)) {
          break;
        }
      }
    }

    if (!response.ok) {
      popupDebug('response not ok after retries', { status: response.status });
      const fallback = await popupRequestReservationsInPageContext(endpoint, authHeaderCandidates);
      if (fallback?.ok) {
        return popupBuildReservationPayload(fallback.data, page);
      }

      const fallbackErrorMessage = typeof fallback?.error === 'string' ? fallback.error.trim() : '';
      const message =
        fallbackErrorMessage ||
        (typeof data?.message === 'string' ? data.message : '요청 실패 (' + response.status + ')');
      throw new Error(message);
    }

    popupDebug('fetchMyReservationsForPopup success via content fetch', {
      itemCount: Array.isArray(data?.data) ? data.data.length : Array.isArray(data?.items) ? data.items.length : -1,
    });
    return popupBuildReservationPayload(data, page);
  }

  function popupSanitizePage(value) {
    const page = Number(value);
    if (!Number.isInteger(page) || page < 0) {
      return 0;
    }
    return page;
  }

  function popupSafeParseJsonText(text) {
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  function isPopupNetworkFetchError(message) {
    if (typeof message !== 'string') {
      return false;
    }

    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes('failed to fetch') ||
      normalizedMessage.includes('networkerror') ||
      normalizedMessage.includes('load failed') ||
      normalizedMessage.includes('fetch to fail')
    );
  }

  function popupBuildReservationPayload(data, page) {
    const items = popupExtractReservationItems(data)
      .map((reservation) => popupNormalizeReservation(reservation))
      .filter((reservation) => reservation != null)
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    return {
      items,
      pagination: popupExtractReservationPagination(data, page, items.length),
    };
  }

  function popupRequestReservationsInPageContext(endpoint, authorizationHeaders) {
    popupDebug('popupRequestReservationsInPageContext start', {
      endpoint,
      authHeaderCount: Array.isArray(authorizationHeaders) ? authorizationHeaders.length : 0,
    });
    const requestType = 'ZZK_PAGE_BRIDGE_FETCH_MY_RESERVATIONS';
    const responseType = 'ZZK_PAGE_BRIDGE_FETCH_MY_RESERVATIONS_RESULT';
    const requestId = 'zzk-popup-fetch-' + String(Date.now()) + '-' + Math.random().toString(16).slice(2, 10);

    const normalizedAuthHeaders = Array.isArray(authorizationHeaders)
      ? authorizationHeaders.filter((value) => typeof value === 'string' && value.trim() !== '')
      : [];

    return new Promise((resolve) => {
      let timerId = null;

      const cleanup = () => {
        window.removeEventListener('message', handleResponse);
        if (timerId != null) {
          window.clearTimeout(timerId);
        }
      };

      const handleResponse = (event) => {
        if (event.source !== window) {
          return;
        }

        const message = event.data;
        if (!message || message.type !== responseType || message.requestId !== requestId) {
          return;
        }

        popupDebug('page bridge response', {
          requestId,
          ok: Boolean(message?.ok),
          error: message?.error || '',
          hasData: Boolean(message?.data),
        });

        cleanup();

        if (message.ok) {
          resolve({
            ok: true,
            data: message.data,
          });
          return;
        }

        resolve({
          ok: false,
          error:
            typeof message.error === 'string' && message.error.trim() !== ''
              ? message.error
              : '페이지 컨텍스트 요청 실패',
        });
      };

      window.addEventListener('message', handleResponse);

      popupDebug('postMessage to page bridge', { requestId, authHeaderCount: normalizedAuthHeaders.length });

      window.postMessage(
        {
          type: requestType,
          requestId,
          endpoint,
          authorizationHeaders: normalizedAuthHeaders,
        },
        '*'
      );

      timerId = window.setTimeout(() => {
        popupDebug('page bridge timeout', { requestId });
        cleanup();
        resolve({
          ok: false,
          error: '페이지 컨텍스트 요청 시간이 초과되었습니다.',
        });
      }, 9000);
    });
  }

  function popupExtractReservationItems(data) {
    const candidates = [
      data?.reservations,
      data?.content,
      data?.items,
      data?.data,
      data?.data?.reservations,
      data?.data?.content,
      data?.data?.items,
      data?.result,
      data?.result?.reservations,
      data?.result?.content,
      data?.result?.items,
      data?.page?.content,
      data?.reservationPage?.content,
      Array.isArray(data) ? data : null,
    ];

    const matchedItems = candidates.find((candidate) => Array.isArray(candidate)) || [];
    return matchedItems.map((item) => popupUnwrapReservationItem(item)).filter((item) => item != null);
  }

  function popupUnwrapReservationItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const nested =
      item.reservation || item.booking || item.data || item.item || item.result || item.payload || item.content;

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested;
    }

    return item;
  }

  function popupExtractReservationPagination(data, fallbackPage, itemCount) {
    const page =
      popupToNonNegativeInteger(data?.number) ??
      popupToNonNegativeInteger(data?.pageNumber) ??
      popupToNonNegativeInteger(data?.page?.number) ??
      fallbackPage;

    const totalPages =
      popupToNonNegativeInteger(data?.totalPages) ?? popupToNonNegativeInteger(data?.page?.totalPages) ?? null;

    const totalElements =
      popupToNonNegativeInteger(data?.totalElements) ??
      popupToNonNegativeInteger(data?.page?.totalElements) ??
      popupToNonNegativeInteger(data?.count) ??
      itemCount;

    let hasNext = false;
    if (typeof data?.last === 'boolean') {
      hasNext = !data.last;
    } else if (typeof data?.page?.last === 'boolean') {
      hasNext = !data.page.last;
    } else if (Number.isInteger(totalPages)) {
      hasNext = page + 1 < totalPages;
    }

    return {
      page,
      totalPages,
      totalElements,
      hasNext,
    };
  }

  function popupToNonNegativeInteger(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      return null;
    }
    return number;
  }

  function popupNormalizeReservation(reservation) {
    const target = popupUnwrapReservationItem(reservation);
    if (!target || typeof target !== 'object') {
      return null;
    }

    const startDateTime = popupPickFirstString([
      target.startDateTime,
      target.reservationStartDateTime,
      target.startDatetime,
      target.startTime,
      target.startedAt,
      target.startAt,
      target.reservationStartAt,
    ]);

    const endDateTime = popupPickFirstString([
      target.endDateTime,
      target.reservationEndDateTime,
      target.endDatetime,
      target.endTime,
      target.endedAt,
      target.endAt,
      target.reservationEndAt,
    ]);

    const roomName =
      popupPickFirstString([target.spaceName, target.space?.name, target.roomName, target.room?.name, target.name]) ||
      '공간 미확인';

    const mapName = popupPickFirstString([
      target.mapName,
      target.map?.name,
      target.placeName,
      target.sharingMapName,
      target.sharingMap?.mapName,
    ]);

    const purpose = popupPickFirstString([
      target.description,
      target.purpose,
      target.usePurpose,
      target.content,
      target.memo,
      target.note,
    ]);

    const status = popupPickFirstString([target.status, target.reservationStatus, target.state]) || '예약';

    const roomId = popupToNullableInteger(target.spaceId ?? target.roomId ?? target.space?.id ?? target.room?.id);

    const reserverName =
      popupPickFirstString([
        target.name,
        target.memberName,
        target.userName,
        target.reserverName,
        target.ownerName,
        target.member?.name,
      ]) || '미확인';

    const startTimestamp = popupToTimestamp(startDateTime);
    const endTimestamp = popupToTimestamp(endDateTime);
    const startDateKey = popupTimestampToKstDateKey(startTimestamp);
    const startMinute = popupTimestampToKstMinuteOfDay(startTimestamp);
    const endMinute = popupTimestampToKstMinuteOfDay(endTimestamp);

    const dateLabel = Number.isFinite(startTimestamp) ? popupFormatKstDate(startDateTime) : '날짜 미확인';
    let timeLabel = '시간 미확인';
    if (Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp)) {
      timeLabel = popupFormatKstTime(startDateTime) + ' ~ ' + popupFormatKstTime(endDateTime);
    } else if (Number.isFinite(startTimestamp)) {
      timeLabel = popupFormatKstTime(startDateTime) + ' 시작';
    }

    const idCandidates = [target.id, target.reservationId, target.bookingId];
    const id = idCandidates.find((value) => Number.isInteger(Number(value)));

    return {
      id: Number.isInteger(Number(id)) ? Number(id) : null,
      roomId,
      roomName,
      mapName: mapName || '',
      purpose: purpose || '',
      reserverName,
      status,
      startDateKey,
      startMinute,
      endMinute,
      dateLabel,
      timeLabel,
      isPast: Number.isFinite(endTimestamp) ? endTimestamp < Date.now() : false,
      startTimestamp: Number.isFinite(startTimestamp) ? startTimestamp : Number.MAX_SAFE_INTEGER,
    };
  }

  function popupPickFirstString(values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
    return '';
  }

  function popupFormatKstDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '날짜 미확인';
    }

    const parts = KST_DATE_PARTS_FORMATTER.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '----';
    const month = parts.find((part) => part.type === 'month')?.value || '--';
    const day = parts.find((part) => part.type === 'day')?.value || '--';
    const weekday = KST_WEEKDAY_FORMATTER.format(date);

    return year + '-' + month + '-' + day + ' (' + weekday + ')';
  }

  function popupFormatKstTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--:--';
    }

    const parts = KST_HOUR_MINUTE_PARTS_FORMATTER.formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour')?.value || '--';
    const minute = parts.find((part) => part.type === 'minute')?.value || '--';
    return hour + ':' + minute;
  }

  function popupToTimestamp(value) {
    if (typeof value !== 'string' || value.trim() === '') {
      return Number.NaN;
    }

    const date = new Date(value);
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  }

  function popupToNullableInteger(value) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
      return null;
    }
    return number;
  }

  function popupTimestampToKstDateKey(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return '';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const parts = KST_DATE_PARTS_FORMATTER.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';

    if (!year || !month || !day) {
      return '';
    }

    return `${year}-${month}-${day}`;
  }

  function popupTimestampToKstMinuteOfDay(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts = KST_HOUR_MINUTE_PARTS_FORMATTER.formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }

    return hour * 60 + minute;
  }

  function popupResolveAuthorizationHeaderValues() {
    const uniqueHeaders = new Set();
    popupDebug('collect authorization header candidates start');
    const rawCandidates = [];

    try {
      popupCollectStorageTokenCandidates(window.localStorage, rawCandidates);
    } catch {
      // localStorage 접근 실패 시 무시
    }

    try {
      popupCollectStorageTokenCandidates(window.sessionStorage, rawCandidates);
    } catch {
      // sessionStorage 접근 실패 시 무시
    }

    for (const rawCandidate of rawCandidates) {
      const normalized = popupNormalizeAuthorizationCandidate(rawCandidate);
      if (normalized) {
        uniqueHeaders.add(normalized);
      }
    }

    const resolved = Array.from(uniqueHeaders);
    popupDebug('collect authorization header candidates done', { count: resolved.length });
    return resolved;
  }

  function popupCollectStorageTokenCandidates(storage, out) {
    if (!storage || typeof storage.getItem !== 'function') {
      return;
    }

    const commonKeys = [
      'accessToken',
      'token',
      'authToken',
      'authorization',
      'Authorization',
      'jwt',
      'zzimkkongToken',
      'idToken',
    ];

    commonKeys.forEach((key) => {
      const value = storage.getItem(key);
      if (typeof value === 'string' && value.trim() !== '') {
        out.push(value.trim());
      }
    });

    const keyLength = Number.isInteger(storage.length) ? storage.length : 0;
    for (let index = 0; index < keyLength; index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string') {
        continue;
      }

      const value = storage.getItem(key);
      if (typeof value !== 'string' || value.trim() === '') {
        continue;
      }

      if (/token|auth|jwt|session|persist/i.test(key)) {
        out.push(value.trim());
      }

      const extracted = popupExtractTokenLikeStrings(value);
      extracted.forEach((candidate) => {
        out.push(candidate);
      });
    }
  }

  function popupExtractTokenLikeStrings(source) {
    if (typeof source !== 'string' || source.trim() === '') {
      return [];
    }

    const unique = new Set();

    const bearerMatches = source.match(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi);
    if (Array.isArray(bearerMatches)) {
      bearerMatches.forEach((match) => {
        const trimmed = match.trim();
        if (trimmed) {
          unique.add(trimmed);
        }
      });
    }

    const jwtMatches = source.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
    if (Array.isArray(jwtMatches)) {
      jwtMatches.forEach((match) => {
        const trimmed = match.trim();
        if (trimmed) {
          unique.add(trimmed);
        }
      });
    }

    return Array.from(unique);
  }

  function popupNormalizeAuthorizationCandidate(rawCandidate) {
    if (typeof rawCandidate !== 'string' || rawCandidate.trim() === '') {
      return '';
    }

    const normalizedCandidates = [];
    const pushCandidate = (value) => {
      if (typeof value === 'string' && value.trim() !== '') {
        normalizedCandidates.push(value.trim());
      }
    };

    const collectNested = (value, depth = 0) => {
      if (depth > 4 || value == null) {
        return;
      }

      if (typeof value === 'string') {
        pushCandidate(value);
        popupExtractTokenLikeStrings(value).forEach(pushCandidate);
        return;
      }

      if (Array.isArray(value)) {
        value.slice(0, 30).forEach((item) => collectNested(item, depth + 1));
        return;
      }

      if (typeof value === 'object') {
        const objectValue = value;
        const directKeys = [
          'accessToken',
          'token',
          'authToken',
          'authorization',
          'Authorization',
          'jwt',
          'idToken',
          'value',
        ];

        directKeys.forEach((key) => {
          if (key in objectValue) {
            collectNested(objectValue[key], depth + 1);
          }
        });

        const entries = Object.entries(objectValue);
        entries.slice(0, 50).forEach(([key, nestedValue]) => {
          if (/token|auth|jwt|session|persist/i.test(key) || depth < 2) {
            collectNested(nestedValue, depth + 1);
          }
        });
      }
    };

    pushCandidate(rawCandidate);
    popupExtractTokenLikeStrings(rawCandidate).forEach(pushCandidate);

    try {
      collectNested(JSON.parse(rawCandidate));
    } catch {
      // JSON 형태가 아니면 무시
    }

    for (const candidate of normalizedCandidates) {
      const token = candidate.trim().replace(/^"|"$/g, '');
      if (!token) {
        continue;
      }
      if (/^Bearer\s+/i.test(token)) {
        return token;
      }
      if (token.split('.').length === 3 || token.length >= 24) {
        return 'Bearer ' + token;
      }
    }

    return '';
  }

  function getExtensionIconUrl() {
    try {
      if (chrome?.runtime?.getURL) {
        return chrome.runtime.getURL('src/icon.png');
      }
    } catch {
      // ignore runtime access errors
    }
    return '';
  }

  function getExtensionFontUrl() {
    try {
      if (chrome?.runtime?.getURL) {
        return chrome.runtime.getURL(EXTENSION_FONT_PATH);
      }
    } catch {
      // ignore runtime access errors
    }
    return '';
  }

  function getSharingMapId() {
    const match = location.pathname.match(/^\/guest\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function getNextHourRange(baseDate = '') {
    const todayDate = getTodayDateInKST();
    const normalizedBaseDate = isDateString(baseDate) ? baseDate : todayDate;

    const makeWindow = (date, startMinute) => {
      const safeStart = Math.max(BOOKABLE_START_MINUTE, Math.min(BOOKABLE_END_MINUTE - TIME_STEP_MINUTES, startMinute));
      let safeEnd = Math.min(BOOKABLE_END_MINUTE, safeStart + AUTO_PICK_DURATION_MINUTES);
      if (safeEnd <= safeStart) {
        safeEnd = Math.min(BOOKABLE_END_MINUTE, safeStart + TIME_STEP_MINUTES);
      }

      return {
        date,
        startTime: minuteToHourMinute(safeStart),
        endTime: minuteToHourMinute(safeEnd),
      };
    };

    if (normalizedBaseDate > todayDate) {
      return makeWindow(normalizedBaseDate, BOOKABLE_START_MINUTE);
    }

    if (normalizedBaseDate < todayDate) {
      return makeWindow(todayDate, BOOKABLE_START_MINUTE);
    }

    const currentMinuteInKst = getCurrentMinuteInKST();
    const roundedCurrentMinute = ceilToStepMinute(currentMinuteInKst, TIME_STEP_MINUTES);

    if (!Number.isInteger(roundedCurrentMinute)) {
      return makeWindow(todayDate, BOOKABLE_START_MINUTE);
    }

    if (roundedCurrentMinute >= BOOKABLE_END_MINUTE) {
      const tomorrowDate = addDaysToDateString(todayDate, 1);
      if (isDateString(tomorrowDate)) {
        return makeWindow(tomorrowDate, BOOKABLE_START_MINUTE);
      }
      return makeWindow(todayDate, BOOKABLE_END_MINUTE - TIME_STEP_MINUTES);
    }

    return makeWindow(todayDate, Math.max(BOOKABLE_START_MINUTE, roundedCurrentMinute));
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateStringToLocal(value) {
    if (!isDateString(value)) {
      return null;
    }

    const [yearText, monthText, dayText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }

    return date;
  }

  function addDaysToDateString(baseDate, dayCount) {
    const baseLocalDate = parseDateStringToLocal(baseDate);
    if (!(baseLocalDate instanceof Date) || !Number.isInteger(dayCount)) {
      return '';
    }

    const nextDate = new Date(baseLocalDate);
    nextDate.setDate(baseLocalDate.getDate() + dayCount);
    return formatDate(nextDate);
  }

  function formatDateWithWeekday(value) {
    const localDate = parseDateStringToLocal(value);
    if (!(localDate instanceof Date)) {
      return value;
    }

    const weekdayLabel = CALENDAR_WEEKDAY_LABELS[localDate.getDay()] || '';
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    return `${month}.${day} (${weekdayLabel})`;
  }

  function getTodayDateInKST() {
    const parts = KST_DATE_PARTS_FORMATTER.formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value || '1970';
    const month = parts.find((part) => part.type === 'month')?.value || '01';
    const day = parts.find((part) => part.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
  }

  function getCurrentMinuteInKST() {
    const parts = KST_HOUR_MINUTE_PARTS_FORMATTER.formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }

    return hour * 60 + minute;
  }

  function isMapCalendarDebugEnabled() {
    try {
      return localStorage.getItem('zzk_helper_debug') === '1' || localStorage.getItem('zzk-helper-debug') === '1';
    } catch {
      return false;
    }
  }

  function normalizeDateInput(inputElement) {
    if (!(inputElement instanceof HTMLInputElement)) {
      return '';
    }

    const minDate = getEffectiveCalendarMinDate();
    inputElement.min = minDate;
    const normalizedDate = clampDateToMin(inputElement.value, minDate);
    if (inputElement.value !== normalizedDate) {
      inputElement.value = normalizedDate;
    }

    return inputElement.value;
  }

  function clampDateToMin(value, minDate) {
    if (!isDateString(minDate)) {
      return isDateString(value) ? value : '';
    }

    if (!isDateString(value)) {
      return minDate;
    }

    return value < minDate ? minDate : value;
  }

  function isDateString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function normalizeTimeInput(inputElement) {
    if (!(inputElement instanceof HTMLInputElement)) {
      return '';
    }

    const normalized = normalizeToTenMinute(inputElement.value);
    if (normalized && inputElement.value !== normalized) {
      inputElement.value = normalized;
    }

    return inputElement.value;
  }

  function normalizeToTenMinute(value) {
    const totalMinute = parseHourMinute(value);
    if (!Number.isInteger(totalMinute)) {
      return value;
    }

    const normalizedMinute = Math.round(totalMinute / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
    const maxMinute = 24 * 60 - TIME_STEP_MINUTES;
    const clampedMinute = Math.max(0, Math.min(maxMinute, normalizedMinute));
    return minuteToHourMinute(clampedMinute);
  }

  function ceilToStepMinute(totalMinute, stepMinute) {
    if (!Number.isInteger(totalMinute) || !Number.isInteger(stepMinute) || stepMinute <= 0) {
      return null;
    }

    const nextMinute = Math.ceil(totalMinute / stepMinute) * stepMinute;
    return Math.max(0, Math.min(24 * 60, nextMinute));
  }

  function isTenMinuteAligned(value) {
    const totalMinute = parseHourMinute(value);
    if (!Number.isInteger(totalMinute)) {
      return false;
    }

    return totalMinute % TIME_STEP_MINUTES === 0;
  }

  function validateTenMinuteField(inputElement) {
    if (!(inputElement instanceof HTMLInputElement)) {
      return false;
    }

    const valid =
      inputElement.value !== '' && !inputElement.validity.stepMismatch && isTenMinuteAligned(inputElement.value);

    inputElement.setCustomValidity(valid ? '' : '시간은 10분 단위로 입력해 주세요.');

    if (!valid) {
      inputElement.reportValidity();
    }

    return valid;
  }

  function parseHourMinute(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  function minuteToHourMinute(totalMinute) {
    if (!Number.isFinite(totalMinute)) {
      return '00:00';
    }

    const minute = ((Math.trunc(totalMinute) % (24 * 60)) + 24 * 60) % (24 * 60);
    const hour = Math.floor(minute / 60);
    const remainMinute = minute % 60;
    return `${String(hour).padStart(2, '0')}:${String(remainMinute).padStart(2, '0')}`;
  }

  function getErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return '알 수 없는 오류가 발생했습니다.';
  }

  function isElementsValid(elements) {
    return (
      elements.form instanceof HTMLFormElement &&
      elements.collapseButton instanceof HTMLButtonElement &&
      elements.refreshButton instanceof HTMLButtonElement &&
      elements.dateInput instanceof HTMLInputElement &&
      elements.startInput instanceof HTMLInputElement &&
      elements.endInput instanceof HTMLInputElement &&
      elements.highlightToggle instanceof HTMLInputElement &&
      elements.scheduleToggle instanceof HTMLInputElement &&
      elements.statusMessage instanceof HTMLElement &&
      elements.totalCount instanceof HTMLElement &&
      elements.availableCount instanceof HTMLElement &&
      elements.occupiedCount instanceof HTMLElement &&
      elements.availableList instanceof HTMLElement &&
      elements.occupiedList instanceof HTMLElement &&
      elements.updatedAt instanceof HTMLElement &&
      elements.card instanceof HTMLElement
    );
  }

  function panelMarkup() {
    return `
      <section class="zzk-card">
        <header class="zzk-header">
          <div>
            <p class="zzk-eyebrow">찜꽁 확장 패널</p>
            <h2>시간대별 공간 현황</h2>
          </div>
          <button id="zzk-collapse" type="button" aria-label="패널 접기">접기</button>
        </header>

        <div class="zzk-body">
          <form id="zzk-form">
            <label class="zzk-field">
              <span>날짜</span>
              <input id="zzk-date" type="date" required>
            </label>

            <div class="zzk-time-row">
              <label class="zzk-field">
                <span>시작</span>
                <input id="zzk-start" type="time" step="600" min="00:00" required>
              </label>
              <label class="zzk-field">
                <span>종료</span>
                <input id="zzk-end" type="time" step="600" min="00:00" required>
              </label>
            </div>

            <label class="zzk-toggle">
              <input id="zzk-highlight-toggle" type="checkbox">
              <span>지도 색상으로 바로 보기</span>
            </label>

            <label class="zzk-toggle">
              <input id="zzk-schedule-toggle" type="checkbox">
              <span>지도에 캘린더 블록 표시</span>
            </label>

            <div class="zzk-actions">
              <button id="zzk-refresh" type="submit">현황 새로고침</button>
            </div>
          </form>

          <p id="zzk-status-message" class="zzk-status">시간대를 선택하고 현황을 불러오세요.</p>

          <div class="zzk-stats">
            <article>
              <span>전체</span>
              <strong id="zzk-total-count">0</strong>
            </article>
            <article class="available">
              <span>비어 있음</span>
              <strong id="zzk-available-count">0</strong>
            </article>
            <article class="occupied">
              <span>차 있음</span>
              <strong id="zzk-occupied-count">0</strong>
            </article>
          </div>

          <div class="zzk-lists">
            <section>
              <h3>비어 있는 공간</h3>
              <ul id="zzk-available-list" class="zzk-room-list"></ul>
            </section>
            <section>
              <h3>사용 중인 공간</h3>
              <ul id="zzk-occupied-list" class="zzk-room-list"></ul>
            </section>
          </div>

          <p id="zzk-updated-at" class="zzk-updated-at"></p>
        </div>
      </section>
    `;
  }

  function panelStyle() {
    const extensionFontUrl = getExtensionFontUrl();
    return `
      <style>
        @font-face {
          font-family: "BMDOHYEON";
          src: url("${extensionFontUrl}") format("truetype");
          font-display: swap;
        }

        :host {
          all: initial;
        }

        * {
          box-sizing: border-box;
        }

        .zzk-card {
          font-family: "BMDOHYEON", "SUIT Variable", "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
          color: #0f172a;
          background: linear-gradient(150deg, rgba(255, 255, 255, 0.96), rgba(240, 249, 255, 0.94));
          border: 1px solid rgba(15, 23, 42, 0.1);
          border-radius: 16px;
          box-shadow: 0 16px 32px rgba(15, 23, 42, 0.16);
          backdrop-filter: blur(8px);
          width: 340px;
          min-width: 280px;
          min-height: 260px;
          max-width: min(92vw, 960px);
          max-height: calc(100vh - 104px);
          resize: both;
          overflow: auto;
        }

        .zzk-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 14px 10px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.08);
          background: linear-gradient(120deg, rgba(2, 132, 199, 0.1), rgba(16, 185, 129, 0.12));
        }

        .zzk-header h2 {
          margin: 3px 0 0;
          font-size: 15px;
          line-height: 1.2;
        }

        .zzk-eyebrow {
          margin: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #0369a1;
        }

        #zzk-collapse {
          border: none;
          border-radius: 999px;
          padding: 6px 10px;
          background: rgba(15, 23, 42, 0.08);
          color: #0f172a;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        #zzk-collapse:hover {
          background: rgba(15, 23, 42, 0.16);
        }

        .zzk-body {
          padding: 12px;
          display: grid;
          gap: 10px;
        }

        .zzk-card.collapsed .zzk-body {
          display: none;
        }

        #zzk-form {
          display: grid;
          gap: 8px;
        }

        .zzk-field {
          display: grid;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          color: #334155;
        }

        .zzk-time-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        input[type="date"],
        input[type="time"] {
          width: 100%;
          padding: 8px 10px;
          border-radius: 9px;
          border: 1px solid rgba(15, 23, 42, 0.16);
          font-size: 12px;
          background: #ffffff;
        }

        input[type="date"]:focus,
        input[type="time"]:focus {
          outline: 2px solid rgba(14, 116, 144, 0.35);
          outline-offset: 0;
          border-color: rgba(14, 116, 144, 0.45);
        }

        .zzk-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #334155;
          user-select: none;
        }

        .zzk-actions {
          display: flex;
          justify-content: flex-end;
        }

        #zzk-refresh,
        .zzk-toggle,
        .zzk-stats,
        .zzk-lists,
        .zzk-updated-at {
          display: none;
        }

        #zzk-refresh {
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #0369a1, #0ea5e9);
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          padding: 8px 12px;
          cursor: pointer;
        }

        #zzk-refresh:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .zzk-status {
          margin: 0;
          padding: 8px 10px;
          border-radius: 10px;
          font-size: 11px;
          line-height: 1.4;
          background: #f1f5f9;
          color: #334155;
        }

        .zzk-status.success {
          background: rgba(16, 185, 129, 0.14);
          color: #065f46;
        }

        .zzk-status.error {
          background: rgba(239, 68, 68, 0.16);
          color: #7f1d1d;
        }

        .zzk-status.loading {
          background: rgba(14, 165, 233, 0.14);
          color: #075985;
        }

        .zzk-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .zzk-stats article {
          border-radius: 10px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.75);
          padding: 8px;
          text-align: center;
          display: grid;
          gap: 2px;
        }

        .zzk-stats article span {
          font-size: 10px;
          color: #475569;
        }

        .zzk-stats article strong {
          font-size: 15px;
        }

        .zzk-stats article.available strong {
          color: #15803d;
        }

        .zzk-stats article.occupied strong {
          color: #b91c1c;
        }

        .zzk-lists {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .zzk-lists h3 {
          margin: 0 0 6px;
          font-size: 11px;
          color: #334155;
        }

        .zzk-room-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 174px;
          overflow: auto;
        }

        .zzk-room {
          font-size: 10px;
          font-weight: 700;
          line-height: 1.2;
          padding: 5px 8px;
          border-radius: 999px;
          border: 1px solid transparent;
        }

        .zzk-room-available {
          color: #065f46;
          background: rgba(34, 197, 94, 0.2);
          border-color: rgba(22, 163, 74, 0.3);
        }

        .zzk-room-occupied {
          color: #7f1d1d;
          background: rgba(248, 113, 113, 0.2);
          border-color: rgba(220, 38, 38, 0.3);
        }

        .zzk-empty {
          font-size: 10px;
          color: #64748b;
        }

        .zzk-updated-at {
          margin: 0;
          font-size: 10px;
          color: #64748b;
          text-align: right;
        }

        #zzk-refresh,
        .zzk-toggle,
        .zzk-stats,
        .zzk-lists,
        .zzk-updated-at {
          display: none !important;
        }

        @media (max-width: 768px) {
          .zzk-card {
            width: min(340px, calc(100vw - 18px));
            max-width: calc(100vw - 18px);
          }
        }
      </style>
    `;
  }
})();
