import { TRACKING_CONFIG } from './config';
import { blendPayload, moveCoordinate, payloadCoordinate } from './math';
import type { PlayerPositionPayload } from './types';

export class PlayerInterpolator {
  private samples: PlayerPositionPayload[] = [];

  push(sample: PlayerPositionPayload) {
    const filtered = this.samples.filter(existing => existing.sq !== sample.sq);
    filtered.push(sample);
    filtered.sort((left, right) => left.ts - right.ts);
    this.samples = filtered.slice(-6);
  }

  latest() {
    return this.samples[this.samples.length - 1] ?? null;
  }

  isStale(now: number) {
    const latest = this.latest();
    return !latest || now - latest.ts > TRACKING_CONFIG.remotePlayerTtlMs;
  }

  sample(now: number) {
    if (this.samples.length === 0) {
      return null;
    }

    if (this.samples.length === 1) {
      return this.samples[0];
    }

    const renderTime = now - TRACKING_CONFIG.interpolationBackTimeMs;

    for (let index = 0; index < this.samples.length - 1; index += 1) {
      const current = this.samples[index];
      const next = this.samples[index + 1];

      if (renderTime < current.ts || renderTime > next.ts) {
        continue;
      }

      const alpha =
        (renderTime - current.ts) / Math.max(next.ts - current.ts, 1);
      return blendPayload(current, next, alpha);
    }

    const latest = this.latest();
    if (!latest) {
      return null;
    }

    const ageMs = now - latest.ts;
    if (ageMs > TRACKING_CONFIG.maxExtrapolationMs) {
      return latest;
    }

    const distanceMeters = latest.spd * (ageMs / 1000);
    const [nextLng, nextLat] = moveCoordinate(
      payloadCoordinate(latest),
      latest.hdg,
      distanceMeters,
    );

    return {
      ...latest,
      lat: nextLat,
      lng: nextLng,
      ts: now,
    };
  }
}
