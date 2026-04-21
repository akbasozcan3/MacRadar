type Subscription = {
  unsubscribe: () => void;
};

type SensorStream = {
  subscribe: (
    listener: (sample: {
      timestamp?: number;
      x: number;
      y: number;
      z: number;
    }) => void,
  ) => Subscription;
};

type SensorsModule = {
  SensorTypes?: {
    accelerometer: string;
    gyroscope: string;
  };
  accelerometer?: SensorStream;
  gyroscope?: SensorStream;
  setUpdateIntervalForType?: (type: string, intervalMs: number) => void;
};

type CompassHeadingModule = {
  start: (
    updateRate: number,
    callback: (data: { accuracy?: number; heading: number }) => void,
  ) => void;
  stop: () => void;
};

type NativeRealtimeModules = {
  compassHeading: CompassHeadingModule | null;
  sensors: SensorsModule | null;
};

let nativeRealtimeModules: NativeRealtimeModules = {
  compassHeading: null,
  sensors: null,
};

// Metro rejects dynamic require(...) calls for optional dependencies.
// Call this during app bootstrap if sensor packages are installed.
export function registerNativeRealtimeModules(
  modules: Partial<NativeRealtimeModules>,
) {
  nativeRealtimeModules = {
    ...nativeRealtimeModules,
    ...modules,
  };
}

export function loadSensorsModule() {
  return nativeRealtimeModules.sensors;
}

export function loadCompassHeadingModule() {
  return nativeRealtimeModules.compassHeading;
}
