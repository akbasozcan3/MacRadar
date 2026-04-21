export const VOICE_PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export type VoicePlaybackRate = (typeof VOICE_PLAYBACK_RATES)[number];

/**
 * Professional color palette for Voice UI
 */
export const VOICE_COLORS = {
  primary: '#ff5a1f', // MacRadar Orange
  primaryLight: '#fff7ed',
  primaryMuted: '#ffcdbd',
  peer: '#1f2937', // Dark Gray
  peerMuted: '#94a3b8',
  waveformActive: '#ff5a1f',
  waveformInactive: 'rgba(255, 90, 31, 0.18)',
  waveformPeerActive: '#4b5563',
  waveformPeerInactive: 'rgba(75, 85, 99, 0.18)',
  glassBackground: 'rgba(255, 255, 255, 0.82)',
  recordPulse: '#ef4444',
} as const;

export function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function resolveVoiceDurationSec(
  durationSec: number | null | undefined,
  fallback = 6,
) {
  if (!Number.isFinite(durationSec)) {
    return fallback;
  }
  return Math.max(1, Math.floor(Number(durationSec)));
}

export function formatVoiceSeconds(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatVoicePlaybackClock(
  value: number,
  options?: { includeTenths?: boolean },
) {
  const safe = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  const minutes = Math.floor(safe / 60);
  const secondsFloat = safe - minutes * 60;
  const wholeSeconds = Math.floor(secondsFloat);
  const tenths = Math.floor((secondsFloat - wholeSeconds) * 10);
  const base = `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  if (options?.includeTenths) {
    return `${base}.${Math.max(0, Math.min(9, tenths))}`;
  }
  return base;
}

function hashSeed(value: string) {
  let hash = 1;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

function buildVoiceWaveformBars(seed: string, count: number) {
  let hash = hashSeed(seed);
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    hash = (hash * 48271 + index + 1) % 2147483647;
    const normalized = hash / 2147483647;
    // Premium waveforms have a minimum height for better aesthetics
    bars.push(0.18 + normalized * 0.82);
  }
  return bars;
}

function normalizeWaveformSource(values: number[]) {
  const next = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .map(value => clampRatio(value))
    .filter(value => value > 0)
    .slice(0, 512); // Increased limit for smoother resampling

  return next.length > 0 ? next : [];
}

function resampleWaveform(values: number[], targetCount: number) {
  const source = normalizeWaveformSource(values);
  if (source.length === 0) {
    return [];
  }

  const safeTarget = Math.max(8, Math.min(120, Math.floor(targetCount)));
  if (source.length === safeTarget) {
    return source;
  }

  const segmentLength = source.length / safeTarget;
  const points: number[] = [];
  for (let index = 0; index < safeTarget; index += 1) {
    const start = Math.floor(index * segmentLength);
    const end = Math.max(start + 1, Math.floor((index + 1) * segmentLength));
    const chunk = source.slice(start, end);
    if (chunk.length === 0) {
      points.push(0.08);
      continue;
    }
    const average = chunk.reduce((sum, current) => sum + current, 0) / chunk.length;
    // Apply a slight non-linear scaling for better visual impact
    const scaled = Math.pow(average, 0.85);
    points.push(Math.max(0.08, clampRatio(scaled)));
  }
  return points;
}

export function resolveVoiceWaveformBars(
  messageId: string,
  voiceId: string,
  durationSec: number,
  waveform: number[] | undefined,
  count: number,
) {
  const fromPayload = Array.isArray(waveform) ? resampleWaveform(waveform, count) : [];
  if (fromPayload.length > 0) {
    return fromPayload;
  }

  return buildVoiceWaveformBars(`${messageId}:${voiceId}:${durationSec}`, count);
}

export function buildVoiceRecordingPreviewBars(
  elapsedSec: number,
  isLocked: boolean,
  count: number,
) {
  const bars: number[] = [];
  const safeCount = Math.max(12, Math.min(36, Math.floor(count)));
  const safeElapsed = Math.max(0, Number.isFinite(elapsedSec) ? elapsedSec : 0);
  const seed = Math.max(1, Math.floor(safeElapsed) + (isLocked ? 17 : 7));

  for (let index = 0; index < safeCount; index += 1) {
    // More complex wave function for a professional live feel
    const waveA = Math.abs(Math.sin((index + 1) * 0.55 + seed * 0.65));
    const waveB = Math.abs(Math.cos((index + 1) * 0.35 + seed * 0.45));
    const drift = Math.abs(Math.sin((index + 1) * 0.15 + seed * 0.25));
    const amplitude = 0.22 + waveA * 0.38 + waveB * 0.28 + drift * 0.12;
    bars.push(Math.min(1, amplitude));
  }

  return bars;
}

export function normalizeVoicePlaybackRate(value: number | null | undefined): VoicePlaybackRate {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  const exact = VOICE_PLAYBACK_RATES.find(candidate => candidate === parsed);
  if (exact) {
    return exact;
  }

  return VOICE_PLAYBACK_RATES.reduce((best, candidate) => {
    const bestDelta = Math.abs(best - parsed);
    const candidateDelta = Math.abs(candidate - parsed);
    return candidateDelta < bestDelta ? candidate : best;
  }, VOICE_PLAYBACK_RATES[0]);
}

export function formatVoicePlaybackRate(rate: VoicePlaybackRate) {
  return Number.isInteger(rate)
    ? `${rate}x`
    : `${rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

