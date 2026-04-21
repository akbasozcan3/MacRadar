export type SocketStatus = 'connecting' | 'live' | 'offline';
export type PositionSource = 'gps' | 'fused';

export type GpsFix = {
  accuracy: number;
  heading: number;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: number;
};

export type MotionSnapshot = {
  acceleration: {
    x: number;
    y: number;
    z: number;
  };
  energy: number;
  gyro: {
    x: number;
    y: number;
    z: number;
  };
  heading: number;
  headingAccuracy: number;
  timestamp: number;
};

export type SensorSnapshotPayload = {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  ha: number;
  me: number;
};

export type PlayerPositionPayload = {
  acc: number;
  ax: number;
  ay: number;
  az: number;
  /** Display name for map / markers (optional, short). */
  dn?: string;
  gx: number;
  gy: number;
  gz: number;
  ha: number;
  hdg: number;
  lat: number;
  lng: number;
  me: number;
  mx: number;
  my: number;
  pid: string;
  /** Avatar or profile image URL (optional). */
  pu?: string;
  rid: string;
  spd: number;
  sq: number;
  src: PositionSource;
  t: 'p';
  ts: number;
};

export type PlayerSnapshotPayload = {
  ps: PlayerPositionPayload[];
  rid: string;
  t: 's';
  ts: number;
};

export type PlayerLeavePayload = {
  pid: string;
  rid: string;
  t: 'l';
  ts: number;
};

export type PlayerAckPayload = {
  pid: string;
  rid: string;
  t: 'a';
  ts: number;
};

export type PlayerSocketMessage =
  | PlayerAckPayload
  | PlayerLeavePayload
  | PlayerPositionPayload
  | PlayerSnapshotPayload;

export type RenderPlayer = {
  coordinate: [number, number];
  displayName: string;
  heading: number;
  id: string;
  isLocal: boolean;
  photoUrl: string;
  speed: number;
  statusLine?: string;
  updatedAt: number;
};

export type TrackingDiagnostics = {
  gpsAgeMs: number;
  motionEnergy: number;
  publishedAt: number;
  remoteCount: number;
  socketStatus: SocketStatus;
};
