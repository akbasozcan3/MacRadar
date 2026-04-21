import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

type NativeVoiceRecordingResult = {
  averageLevel?: number;
  base64: string;
  durationSec: number;
  fileName: string;
  filePath?: string;
  mimeType: string;
  peakLevel?: number;
  sizeBytes: number;
  waveform?: number[];
};

type NativeVoiceRecorderModule = {
  addListener?: (eventName: string) => void;
  cancelRecording: () => Promise<void>;
  removeListeners?: (count: number) => void;
  requestPermission: () => Promise<boolean>;
  startPlayback: (url: string) => Promise<boolean>;
  setPlaybackRate?: (rate: number) => Promise<boolean>;
  startRecording: () => Promise<{
    fileName: string;
    filePath?: string;
    mimeType: string;
  }>;
  stopPlayback: () => Promise<void>;
  stopRecording: () => Promise<NativeVoiceRecordingResult>;
};

const nativeVoiceRecorder = NativeModules.VoiceRecorderModule as
  | NativeVoiceRecorderModule
  | undefined;
const nativeVoiceRecorderEmitter = nativeVoiceRecorder
  ? new NativeEventEmitter(NativeModules.VoiceRecorderModule)
  : null;

export const VOICE_RECORDER_RECORDING_LEVEL_EVENT =
  'VoiceRecorderRecordingLevel';
export const VOICE_RECORDER_PLAYBACK_PROGRESS_EVENT =
  'VoiceRecorderPlaybackProgress';
export const VOICE_RECORDER_PLAYBACK_STATE_EVENT = 'VoiceRecorderPlaybackState';

export type VoiceRecordingLevelEvent = {
  level?: number;
  timestampMs?: number;
};

export type VoicePlaybackProgressEvent = {
  durationSec?: number;
  isPlaying?: boolean;
  positionSec?: number;
};

export type VoicePlaybackStateEvent = {
  state?: 'ended' | 'error' | 'playing' | 'stopped';
};

function ensureNativeModule() {
  if (!nativeVoiceRecorder) {
    throw new Error('Voice recorder module unavailable on this build.');
  }
  return nativeVoiceRecorder;
}

export async function ensureMicrophonePermission() {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) {
      return true;
    }

    const granted = await PermissionsAndroid.request(
      permission,
      {
        buttonNegative: 'Iptal',
        buttonPositive: 'Izin ver',
        message:
          'Sesli mesaj gonderebilmek icin mikrofon iznine ihtiyacimiz var.',
        title: 'Mikrofon Izni',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  const module = ensureNativeModule();
  return module.requestPermission();
}

export async function startVoiceRecording() {
  const module = ensureNativeModule();
  return module.startRecording();
}

export async function stopVoiceRecording() {
  const module = ensureNativeModule();
  return module.stopRecording();
}

export async function cancelVoiceRecording() {
  const module = ensureNativeModule();
  return module.cancelRecording();
}

export async function startVoicePlayback(url: string) {
  const module = ensureNativeModule();
  return module.startPlayback(url);
}

export async function setVoicePlaybackRate(rate: number) {
  if (!nativeVoiceRecorder?.setPlaybackRate) {
    return false;
  }

  const safeRate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  return nativeVoiceRecorder.setPlaybackRate(safeRate);
}

export async function stopVoicePlayback() {
  if (!nativeVoiceRecorder) {
    return;
  }
  await nativeVoiceRecorder.stopPlayback();
}

function subscribeNativeVoiceEvent<TPayload extends object>(
  eventName: string,
  listener: (event: TPayload) => void,
) {
  if (!nativeVoiceRecorderEmitter) {
    return () => undefined;
  }

  const subscription = nativeVoiceRecorderEmitter.addListener(
    eventName,
    event => {
      if (!event || typeof event !== 'object') {
        return;
      }
      listener(event as TPayload);
    },
  );

  return () => {
    subscription.remove();
  };
}

export function subscribeVoiceRecordingLevel(
  listener: (event: VoiceRecordingLevelEvent) => void,
) {
  return subscribeNativeVoiceEvent(
    VOICE_RECORDER_RECORDING_LEVEL_EVENT,
    listener,
  );
}

export function subscribeVoicePlaybackProgress(
  listener: (event: VoicePlaybackProgressEvent) => void,
) {
  return subscribeNativeVoiceEvent(
    VOICE_RECORDER_PLAYBACK_PROGRESS_EVENT,
    listener,
  );
}

export function subscribeVoicePlaybackState(
  listener: (event: VoicePlaybackStateEvent) => void,
) {
  return subscribeNativeVoiceEvent(
    VOICE_RECORDER_PLAYBACK_STATE_EVENT,
    listener,
  );
}
