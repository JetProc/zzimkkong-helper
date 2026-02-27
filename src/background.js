const API_BASE_URL = 'https://k8s.zzimkkong.com';
const KST_TIMEZONE = 'Asia/Seoul';
const TIMELINE_SLOT_MINUTES = 10;
const REQUEST_TIME_STEP_MINUTES = 10;
const ROOM_LAYOUTS = [
  { name: '금성', floorLabel: '11층 · 큰방', order: 0 },
  { name: '지구', floorLabel: '11층 · 큰방', order: 1 },
  { name: '수성', floorLabel: '11층 · 작은방', order: 2 },
  { name: '화성', floorLabel: '11층 · 작은방', order: 3 },
  { name: '보이저', floorLabel: '12층 · 큰방', order: 4 },
  { name: '디스커버리', floorLabel: '12층 · 큰방', order: 5 },
  { name: '아폴로', floorLabel: '12층 · 작은방', order: 6 },
  { name: '허블', floorLabel: '12층 · 작은방', order: 7 },
  { name: '은하수', floorLabel: '13층', order: 8 },
];
const TARGET_ROOM_NAMES = ROOM_LAYOUTS.map((layout) => layout.name);
const TARGET_ROOM_SET = new Set(TARGET_ROOM_NAMES);
const ROOM_LAYOUT_BY_NAME = new Map(ROOM_LAYOUTS.map((layout) => [layout.name, layout]));
const KST_HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIMEZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
});
const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ZZK_FETCH_AVAILABILITY') {
    loadAvailability(message.payload)
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message?.type === 'ZZK_FETCH_DAILY_SCHEDULE') {
    loadDailySchedule(message.payload)
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  return false;
});

async function loadAvailability(payload) {
  const date = sanitizeDate(payload?.date);
  const startTime = sanitizeTime(payload?.startTime);
  const endTime = sanitizeTime(payload?.endTime);

  if (startTime >= endTime) {
    throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
  }

  const mapContext = await loadMapContext(payload);

  const startDateTime = `${date}T${startTime}:00+09:00`;
  const endDateTime = `${date}T${endTime}:00+09:00`;

  const availabilityResponse = await fetchJson(
    `${API_BASE_URL}/api/guests/maps/${mapContext.mapId}/spaces/availability?${new URLSearchParams({
      startDateTime,
      endDateTime,
    }).toString()}`
  );

  const availabilityEntries = Array.isArray(availabilityResponse?.spaces) ? availabilityResponse.spaces : [];

  const availabilityBySpaceId = new Map(
    availabilityEntries.map((entry) => [Number(entry?.spaceId), Boolean(entry?.isAvailable)])
  );

  const rooms = mapContext.targetRooms.map((room) => ({
    id: room.id,
    name: room.name,
    color: room.color,
    floorLabel: room.floorLabel,
    isAvailable: availabilityBySpaceId.get(room.id) === true,
  }));

  const availableCount = rooms.filter((room) => room.isAvailable).length;

  return {
    mapId: mapContext.mapId,
    mapName: mapContext.mapName,
    selectedWindow: {
      date,
      startTime,
      endTime,
    },
    counts: {
      total: rooms.length,
      available: availableCount,
      occupied: rooms.length - availableCount,
    },
    rooms,
  };
}

async function loadDailySchedule(payload) {
  const date = sanitizeDate(payload?.date);
  const mapContext = await loadMapContext(payload);

  const rooms = await Promise.all(
    mapContext.targetRooms.map(async (room) => {
      const reservationsResponse = await fetchJson(
        `${API_BASE_URL}/api/guests/maps/${mapContext.mapId}/spaces/${room.id}/reservations?date=${encodeURIComponent(
          date
        )}`
      );

      const reservations = normalizeReservations(reservationsResponse?.reservations);

      return {
        id: room.id,
        name: room.name,
        color: room.color,
        floorLabel: room.floorLabel,
        windowStartMinute: room.windowStartMinute,
        windowEndMinute: room.windowEndMinute,
        reservations,
      };
    })
  );

  const range = computeTimelineRange(rooms);
  const timeline = buildTimelineSlots(range.startMinute, range.endMinute, TIMELINE_SLOT_MINUTES);

  return {
    mapId: mapContext.mapId,
    mapName: mapContext.mapName,
    date,
    range,
    timeline,
    rooms,
  };
}

async function loadMapContext(payload) {
  const sharingMapId = sanitizeSharingMapId(payload?.sharingMapId);

  const mapData = await fetchJson(`${API_BASE_URL}/api/guests/maps?sharingMapId=${encodeURIComponent(sharingMapId)}`);

  const mapId = Number(mapData?.mapId);
  if (!Number.isInteger(mapId)) {
    throw new Error('맵 정보를 불러오지 못했습니다.');
  }

  const spacesResponse = await fetchJson(`${API_BASE_URL}/api/guests/maps/${mapId}/spaces`);
  const spaces = normalizeSpaces(spacesResponse);

  return {
    mapId,
    mapName: typeof mapData?.mapName === 'string' ? mapData.mapName : '회의실 지도',
    targetRooms: buildTargetRooms(spaces),
  };
}

function buildTargetRooms(spaces) {
  return spaces
    .filter((space) => Boolean(space?.reservationEnable))
    .map((space) => {
      const id = Number(space?.id);
      const normalizedName =
        typeof space?.name === 'string' && space.name.trim() !== '' ? space.name.trim() : `공간 ${id}`;
      const layout = ROOM_LAYOUT_BY_NAME.get(normalizedName);

      return {
        id,
        name: normalizedName,
        color: typeof space?.color === 'string' ? space.color : '#9CA3AF',
        floorLabel: layout?.floorLabel || '미지정층',
        order: Number.isInteger(layout?.order) ? layout.order : Number.MAX_SAFE_INTEGER,
        windowStartMinute: parseWindowStartMinute(space?.settings),
        windowEndMinute: parseWindowEndMinute(space?.settings),
      };
    })
    .filter((room) => Number.isInteger(room.id) && TARGET_ROOM_SET.has(room.name))
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...room }) => room);
}

function normalizeReservations(reservationsValue) {
  if (!Array.isArray(reservationsValue)) {
    return [];
  }

  return reservationsValue
    .map((reservation) => {
      const startMinute = toKstMinuteOfDay(reservation?.startDateTime);
      const endMinute = toKstMinuteOfDay(reservation?.endDateTime);

      if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
        return null;
      }

      return {
        id: Number(reservation?.id),
        title:
          typeof reservation?.description === 'string' && reservation.description.trim() !== ''
            ? reservation.description.trim()
            : '예약',
        owner: typeof reservation?.name === 'string' && reservation.name.trim() !== '' ? reservation.name.trim() : '',
        startMinute,
        endMinute,
        startTime: minuteToHourMinute(startMinute),
        endTime: minuteToHourMinute(endMinute),
      };
    })
    .filter((reservation) => reservation != null)
    .sort((a, b) => a.startMinute - b.startMinute);
}

function parseWindowStartMinute(settingsValue) {
  if (!Array.isArray(settingsValue)) {
    return null;
  }

  const minutes = settingsValue
    .map((setting) => parseTimeToMinute(setting?.settingStartTime))
    .filter((minute) => Number.isInteger(minute));

  if (minutes.length === 0) {
    return null;
  }

  return Math.min(...minutes);
}

function parseWindowEndMinute(settingsValue) {
  if (!Array.isArray(settingsValue)) {
    return null;
  }

  const minutes = settingsValue
    .map((setting) => parseTimeToMinute(setting?.settingEndTime))
    .filter((minute) => Number.isInteger(minute));

  if (minutes.length === 0) {
    return null;
  }

  return Math.max(...minutes);
}

function parseTimeToMinute(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
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

function computeTimelineRange(rooms) {
  const fallbackStartMinute = 7 * 60;
  const fallbackEndMinute = 23 * 60;

  const startCandidates = rooms.map((room) => room.windowStartMinute).filter((minute) => Number.isInteger(minute));
  const endCandidates = rooms.map((room) => room.windowEndMinute).filter((minute) => Number.isInteger(minute));

  const rawStartMinute = startCandidates.length > 0 ? Math.min(...startCandidates) : fallbackStartMinute;
  const rawEndMinute = endCandidates.length > 0 ? Math.max(...endCandidates) : fallbackEndMinute;

  const startMinute = Math.max(0, Math.floor(rawStartMinute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES);
  let endMinute = Math.min(24 * 60, Math.ceil(rawEndMinute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES);

  if (endMinute <= startMinute) {
    endMinute = Math.min(24 * 60, startMinute + TIMELINE_SLOT_MINUTES);
  }

  return {
    startMinute,
    endMinute,
    slotMinutes: TIMELINE_SLOT_MINUTES,
    startTime: minuteToHourMinute(startMinute),
    endTime: minuteToHourMinute(endMinute),
  };
}

function buildTimelineSlots(startMinute, endMinute, slotMinutes) {
  const slots = [];

  for (let minute = startMinute; minute < endMinute; minute += slotMinutes) {
    slots.push({
      startMinute: minute,
      endMinute: minute + slotMinutes,
      label: minuteToHourMinute(minute),
      isHourMark: minute % 60 === 0,
    });
  }

  return slots;
}

function toKstMinuteOfDay(isoDateTime) {
  if (typeof isoDateTime !== 'string') {
    return null;
  }

  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = KST_HOUR_MINUTE_FORMATTER.formatToParts(date);
  const hourPart = parts.find((part) => part.type === 'hour')?.value;
  const minutePart = parts.find((part) => part.type === 'minute')?.value;

  const hour = Number(hourPart);
  const minute = Number(minutePart);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
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

function normalizeSpaces(spacesResponse) {
  if (Array.isArray(spacesResponse?.spaces)) {
    return spacesResponse.spaces;
  }
  if (Array.isArray(spacesResponse)) {
    return spacesResponse;
  }
  return [];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  });

  const text = await response.text();
  const data = safeParseJson(text);

  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `요청 실패 (${response.status})`;
    throw new Error(message);
  }

  if (data == null || typeof data !== 'object') {
    throw new Error('서버 응답 형식이 올바르지 않습니다.');
  }

  return data;
}

function safeParseJson(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sanitizeSharingMapId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('공유 맵 ID를 찾을 수 없습니다.');
  }
  return value.trim();
}

function sanitizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('날짜 형식이 올바르지 않습니다.');
  }

  const todayDate = getTodayDateInKST();
  if (value < todayDate) {
    throw new Error('오늘 이전 날짜는 선택할 수 없습니다.');
  }

  return value;
}

function getTodayDateInKST() {
  const parts = KST_DATE_FORMATTER.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function sanitizeTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }

  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }
  if (minute % REQUEST_TIME_STEP_MINUTES !== 0) {
    throw new Error('시간은 10분 단위로 선택해 주세요.');
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
