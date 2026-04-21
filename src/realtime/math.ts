import type { PlayerPositionPayload } from './types';

const EARTH_RADIUS_METERS = 6371000;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

export function normalizeHeading(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return ((value % 360) + 360) % 360;
}

export function headingDelta(from: number, to: number) {
  const normalizedFrom = normalizeHeading(from);
  const normalizedTo = normalizeHeading(to);
  const delta = normalizedTo - normalizedFrom;

  if (delta > 180) {
    return delta - 360;
  }

  if (delta < -180) {
    return delta + 360;
  }

  return delta;
}

export function lerpHeading(from: number, to: number, alpha: number) {
  return normalizeHeading(from + headingDelta(from, to) * alpha);
}

export function distanceMeters(from: [number, number], to: [number, number]) {
  const latitudeDelta = toRadians(to[1] - from[1]);
  const longitudeDelta = toRadians(to[0] - from[0]);
  const startLatitude = toRadians(from[1]);
  const endLatitude = toRadians(to[1]);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function moveCoordinate(
  coordinate: [number, number],
  headingDegrees: number,
  distanceMetersValue: number,
): [number, number] {
  if (!Number.isFinite(distanceMetersValue) || distanceMetersValue === 0) {
    return coordinate;
  }

  const heading = toRadians(normalizeHeading(headingDegrees));
  const distanceRatio = distanceMetersValue / EARTH_RADIUS_METERS;
  const latitude = toRadians(coordinate[1]);
  const longitude = toRadians(coordinate[0]);

  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(distanceRatio) +
      Math.cos(latitude) * Math.sin(distanceRatio) * Math.cos(heading),
  );

  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(heading) * Math.sin(distanceRatio) * Math.cos(latitude),
      Math.cos(distanceRatio) - Math.sin(latitude) * Math.sin(nextLatitude),
    );

  return [toDegrees(nextLongitude), toDegrees(nextLatitude)];
}

export function payloadCoordinate(
  payload: Pick<PlayerPositionPayload, 'lng' | 'lat'>,
) {
  return [payload.lng, payload.lat] as [number, number];
}

export function velocityFromHeading(speed: number, heading: number) {
  const radians = toRadians(normalizeHeading(heading));

  return {
    x: Math.sin(radians) * speed,
    y: Math.cos(radians) * speed,
  };
}

export function blendPayload(
  from: PlayerPositionPayload,
  to: PlayerPositionPayload,
  alpha: number,
): PlayerPositionPayload {
  const dn =
    typeof to.dn === 'string' && to.dn.trim().length > 0
      ? to.dn.trim()
      : typeof from.dn === 'string' && from.dn.trim().length > 0
        ? from.dn.trim()
        : undefined;
  const pu =
    typeof to.pu === 'string' && to.pu.trim().length > 0
      ? to.pu.trim()
      : typeof from.pu === 'string' && from.pu.trim().length > 0
        ? from.pu.trim()
        : undefined;

  return {
    ...to,
    acc: lerp(from.acc, to.acc, alpha),
    ax: lerp(from.ax, to.ax, alpha),
    ay: lerp(from.ay, to.ay, alpha),
    az: lerp(from.az, to.az, alpha),
    gx: lerp(from.gx, to.gx, alpha),
    gy: lerp(from.gy, to.gy, alpha),
    gz: lerp(from.gz, to.gz, alpha),
    ha: lerp(from.ha, to.ha, alpha),
    hdg: lerpHeading(from.hdg, to.hdg, alpha),
    lat: lerp(from.lat, to.lat, alpha),
    lng: lerp(from.lng, to.lng, alpha),
    me: lerp(from.me, to.me, alpha),
    mx: lerp(from.mx, to.mx, alpha),
    my: lerp(from.my, to.my, alpha),
    spd: lerp(from.spd, to.spd, alpha),
    ts: Math.round(lerp(from.ts, to.ts, alpha)),
    ...(dn ? { dn } : {}),
    ...(pu ? { pu } : {}),
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}
