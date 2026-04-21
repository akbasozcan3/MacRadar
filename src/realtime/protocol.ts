import type {
  PlayerAckPayload,
  PlayerLeavePayload,
  PlayerPositionPayload,
  PlayerSnapshotPayload,
  PlayerSocketMessage,
} from './types';

const MESSAGE_TYPE_ACK = 'a';
const MESSAGE_TYPE_LEAVE = 'l';
const MESSAGE_TYPE_POSITION = 'p';
const MESSAGE_TYPE_SNAPSHOT = 's';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function parsePositionPayload(
  payload: Record<string, unknown>,
): PlayerPositionPayload | null {
  if (
    !Number.isFinite(payload.lat) ||
    !Number.isFinite(payload.lng) ||
    !Number.isFinite(payload.ts)
  ) {
    return null;
  }

  const dnRaw = asString(payload.dn, '').trim();
  const puRaw = asString(payload.pu, '').trim();
  const dn = dnRaw.length > 0 ? dnRaw.slice(0, 120) : undefined;
  const pu = puRaw.length > 0 ? puRaw.slice(0, 2048) : undefined;

  return {
    acc: asNumber(payload.acc),
    ax: asNumber(payload.ax),
    ay: asNumber(payload.ay),
    az: asNumber(payload.az),
    gx: asNumber(payload.gx),
    gy: asNumber(payload.gy),
    gz: asNumber(payload.gz),
    ha: asNumber(payload.ha),
    hdg: asNumber(payload.hdg),
    lat: asNumber(payload.lat),
    lng: asNumber(payload.lng),
    me: asNumber(payload.me),
    mx: asNumber(payload.mx),
    my: asNumber(payload.my),
    pid: asString(payload.pid, 'guest'),
    rid: asString(payload.rid, 'global'),
    spd: asNumber(payload.spd),
    sq: Math.max(0, Math.floor(asNumber(payload.sq))),
    src: asString(payload.src, 'gps') === 'fused' ? 'fused' : 'gps',
    t: MESSAGE_TYPE_POSITION,
    ts: Math.floor(asNumber(payload.ts)),
    ...(dn ? { dn } : {}),
    ...(pu ? { pu } : {}),
  };
}

function parseSnapshotPayload(
  payload: Record<string, unknown>,
): PlayerSnapshotPayload | null {
  if (!Array.isArray(payload.ps)) {
    return null;
  }

  const players = payload.ps
    .map(item => (isObjectRecord(item) ? parsePositionPayload(item) : null))
    .filter((item): item is PlayerPositionPayload => item !== null);

  return {
    ps: players,
    rid: asString(payload.rid, 'global'),
    t: MESSAGE_TYPE_SNAPSHOT,
    ts: Math.floor(asNumber(payload.ts, Date.now())),
  };
}

function parseLeavePayload(
  payload: Record<string, unknown>,
): PlayerLeavePayload {
  return {
    pid: asString(payload.pid, 'guest'),
    rid: asString(payload.rid, 'global'),
    t: MESSAGE_TYPE_LEAVE,
    ts: Math.floor(asNumber(payload.ts, Date.now())),
  };
}

function parseAckPayload(
  payload: Record<string, unknown>,
): PlayerAckPayload {
  return {
    pid: asString(payload.pid, 'guest'),
    rid: asString(payload.rid, 'global'),
    t: MESSAGE_TYPE_ACK,
    ts: Math.floor(asNumber(payload.ts, Date.now())),
  };
}

export function parsePlayerSocketMessage(raw: unknown): PlayerSocketMessage | null {
  if (!isObjectRecord(raw)) {
    return null;
  }

  const type = asString(raw.t);
  if (type === MESSAGE_TYPE_POSITION) {
    return parsePositionPayload(raw);
  }

  if (type === MESSAGE_TYPE_SNAPSHOT) {
    return parseSnapshotPayload(raw);
  }

  if (type === MESSAGE_TYPE_LEAVE) {
    return parseLeavePayload(raw);
  }

  if (type === MESSAGE_TYPE_ACK) {
    return parseAckPayload(raw);
  }

  return null;
}
