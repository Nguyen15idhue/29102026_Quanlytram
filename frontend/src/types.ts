export type Scope = 'all' | 'subtree' | 'own' | 'none';

export interface Permission {
  code: string;
  scope: Scope;
}

export interface Role {
  id: number;
  code: string;
  name: string;
  level: number;
  is_system: number;
  description: string;
  user_count?: number;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  email: string;
  parentUserId: number | null;
  role: {
    id: number;
    code: string;
    name: string;
    level: number;
  };
  status?: string;
}

export interface Station {
  id: number;
  code: string;
  name: string;
  host: string;
  port: number;
  connection_type: string;
  lat: number | null;
  lon: number | null;
  notes: string;
  owner_web_user_id: number | null;
}

export interface Mountpoint {
  id: number;
  name: string;
  station_id: number | null;
  enabled: number;
  requires_auth: number;
  owner_web_user_id: number | null;
  station_code?: string | null;
  station_name?: string | null;
}

export interface WebUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  status: string;
  parentUserId: number | null;
  role: {
    id: number;
    code: string;
    name: string;
    level: number;
  };
}

export interface NtripAccount {
  id: number;
  username: string;
  enabled: boolean;
  maxConnections: number;
  ownerWebUserId: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RelayEndpoint {
  host: string;
  port: number;
  mount: string;
  proxy?: string;
  ssl?: boolean;
  ntripVersion?: string;
  key?: string;
  credential?: { id: number; username: string; hasSecret: boolean } | null;
}

export interface RelayJobState {
  runtimeState: string;
  appliedRevision: number;
  lastError: string | null;
  lastAppliedAt?: string | null;
  updatedAt?: string | null;
}

export interface RelayJob {
  id: number;
  name: string;
  enabled: boolean;
  desiredRevision: number;
  upstream: RelayEndpoint;
  downstream: RelayEndpoint;
  downstreamMode: 'auto' | 'post' | 'source';
  state: RelayJobState | null;
}

export interface CasterListener {
  id: number;
  name: string;
  port: number;
  enabled: boolean;
  role: 'both' | 'source' | 'rover';
  description: string;
  mountpointCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CasterConnection {
  id: number;
  direction: 'source' | 'rover';
  listenerId: number;
  listenerName: string;
  mountpointId: number;
  mountpointName: string;
  accountId: number | null;
  accountUsername: string;
  remoteAddr: string;
  userAgent: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
}

export interface RealtimeRelay {
  jobId: number;
  name: string;
  enabled: boolean;
  state: string;
  appliedRevision: number;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt: string | null;
  lastError: string | null;
}

export interface RealtimeConnection {
  id: number;
  direction: string;
  listenerId: number;
  mountpointId: number;
  accountId: number | null;
  remoteAddr: string;
  startTs: string;
  bytesIn: number;
  bytesOut: number;
}

export interface RealtimeAlert {
  id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  targetType: string;
  targetId: number | null;
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

export interface RealtimeSnapshot {
  ts: string;
  summary: {
    stations: number;
    relayTotal: number;
    relayStreaming: number;
    relayBackoff: number;
    relayError: number;
    relayPending: number;
    connections: number;
    listeners: number;
    openAlerts: number;
  };
  relays: RealtimeRelay[];
  connections: RealtimeConnection[];
  alerts: RealtimeAlert[];
}

export interface AlertItem {
  id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  targetType: string;
  targetId: number | null;
  title: string;
  message: string;
  status: 'open' | 'acked';
  ownerWebUserId: number | null;
  createdAt: string;
  ackedAt: string | null;
  ackedBy: number | null;
  ackNote: string;
}

export interface RelaySession {
  id: number;
  jobId: number;
  jobName: string;
  startTs: string;
  endTs: string | null;
  durationSec: number | null;
  result: string;
  closeReason: string;
  message: string;
}

export interface RelayEvent {
  id: number;
  jobId: number;
  jobName: string;
  ts: string;
  type: string;
  message: string;
  durationSec: number | null;
}

export interface RelayHourly {
  jobId: number;
  jobName: string;
  hourStartUtc: string;
  onlineSec: number;
  sessions: number;
  errors: number;
  timeouts: number;
  authErrors: number;
  proxyErrors: number;
  nmeaErrors: number;
  retries: number;
}

export interface QualityScoreParts {
  transport: number;
  integrity: number;
  msm: number;
  metadata: number;
  signal: number;
  latency: number;
}

export interface QualityLiveItem {
  targetType: 'station' | 'relay_job';
  targetId: number;
  mountpointId: number;
  direction: 'ingest' | 'upstream' | 'downstream';
  ts: string;
  score: number;
  scoreParts: QualityScoreParts;
  state: string;
  frames: number;
  bytes: number;
  crcErrors: number;
  parseErrors: number;
  lengthErrors: number;
  unknownMessages: number;
  msmEpochs: number;
  satellites: number;
  signals: number;
  cells: number;
  avgCnr: number;
  cnrAvailable: boolean;
  reportedStationId?: number;
  arpX?: number;
  arpY?: number;
  arpZ?: number;
  arpDeltaM?: number;
  antenna?: string;
  ageMs: number;
  gaps: number;
  metadataOk: boolean;
  baselineSatellites: number;
  baselineCells: number;
  messageTypes: Record<string, number>;
  parity?: number;
  jobScore?: number;
  live: boolean;
}

export interface QualityOverviewItem extends QualityLiveItem {
  name: string;
  ownerWebUserId: number | null;
  alertsOpen: number;
  parity?: number;
  jobScore?: number;
}

export interface QualitySample {
  id: number;
  targetType: 'station' | 'relay_job';
  targetId: number;
  mountpointId: number;
  direction: 'ingest' | 'upstream' | 'downstream';
  ts: string;
  windowSec: number;
  score: number;
  state: string;
  frames: number;
  bytes: number;
  crcErrors: number;
  parseErrors: number;
  unknownMessages: number;
  msmEpochs: number;
  satellites: number;
  signals: number;
  cells: number;
  avgCnr: number | null;
  reportedStationId: number | null;
  arpX: number | null;
  arpY: number | null;
  arpZ: number | null;
  arpDeltaM: number | null;
  antenna: string | null;
  ageMs: number;
  gaps: number;
  cnrAvailable: boolean;
  details: unknown;
}

export interface QualityAlertItem {
  id: number;
  targetType: 'station' | 'relay_job';
  targetId: number;
  mountpointId: number;
  direction: 'ingest' | 'upstream' | 'downstream';
  eventType: string;
  code: string;
  level: 'critical' | 'major' | 'minor' | 'info';
  severity: 'critical' | 'warning' | 'info';
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  status: 'open' | 'resolved';
  details: unknown;
  ownerWebUserId: number | null;
  ackedAt: string | null;
  ackedBy: number | null;
  ackNote: string | null;
}

export interface QualityMessageStat {
  targetType: string;
  targetId: number;
  mountpointId: number;
  direction: string;
  hourStartUtc: string;
  messageType: number;
  count: number;
  bytes: number;
  ratePerMinute: number;
  lastSeenAt: string;
}

export interface StationProbe {
  id: number;
  stationId: number;
  mountpointId: number | null;
  enabled: boolean;
  probeIntervalSec: number;
  credentialId: number | null;
  hasCredential: boolean;
  ownerWebUserId: number | null;
  createdAt: string;
  updatedAt: string;
  runner: string;
}
