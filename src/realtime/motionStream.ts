import { TRACKING_CONFIG } from './config';
import { clamp, normalizeHeading } from './math';
import { loadCompassHeadingModule, loadSensorsModule } from './nativeModules';
import type { MotionSnapshot } from './types';

const ZERO_MOTION: MotionSnapshot = {
  acceleration: { x: 0, y: 0, z: 0 },
  energy: 0,
  gyro: { x: 0, y: 0, z: 0 },
  heading: 0,
  headingAccuracy: 0,
  timestamp: 0,
};

export function startMotionStream(onSample: (sample: MotionSnapshot) => void) {
  const sensors = loadSensorsModule();
  const compassHeading = loadCompassHeadingModule();

  if (!sensors?.accelerometer || !sensors?.gyroscope) {
    onSample(ZERO_MOTION);
    return () => undefined;
  }

  const accelerometerType = sensors.SensorTypes?.accelerometer;
  const gyroscopeType = sensors.SensorTypes?.gyroscope;
  if (sensors.setUpdateIntervalForType && accelerometerType && gyroscopeType) {
    sensors.setUpdateIntervalForType(
      accelerometerType,
      TRACKING_CONFIG.sensorIntervalMs,
    );
    sensors.setUpdateIntervalForType(
      gyroscopeType,
      TRACKING_CONFIG.sensorIntervalMs,
    );
  }

  let latest: MotionSnapshot = {
    ...ZERO_MOTION,
    timestamp: Date.now(),
  };

  const publish = () => {
    onSample(latest);
  };

  const accelerometerSubscription = sensors.accelerometer.subscribe(sample => {
    const magnitude = Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2);
    const energy = clamp(Math.abs(magnitude - 1) * 4.5, 0, 2.2);

    latest = {
      ...latest,
      acceleration: {
        x: sample.x,
        y: sample.y,
        z: sample.z,
      },
      energy,
      timestamp: Date.now(),
    };
    publish();
  });

  const gyroscopeSubscription = sensors.gyroscope.subscribe(sample => {
    latest = {
      ...latest,
      gyro: {
        x: sample.x,
        y: sample.y,
        z: sample.z,
      },
      timestamp: Date.now(),
    };
    publish();
  });

  if (compassHeading?.start) {
    compassHeading.start(3, ({ accuracy, heading }) => {
      latest = {
        ...latest,
        heading: normalizeHeading(heading),
        headingAccuracy: clamp(accuracy ?? 0, 0, 360),
        timestamp: Date.now(),
      };
      publish();
    });
  }

  return () => {
    accelerometerSubscription.unsubscribe();
    gyroscopeSubscription.unsubscribe();
    compassHeading?.stop?.();
  };
}
