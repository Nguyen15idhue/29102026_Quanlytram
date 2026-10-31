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
  source_type?: 'relay_caster' | 'caster_ingest' | 'probe_client' | 'manual';
  ntrip_version?: 'v1' | 'v2';
  ntrip_mode?: 'v1_noauth' | 'v1_auth' | 'v2_auth' | 'ntrip_client';
  relay_job_id?: number | null;
  relay_job_name?: string | null;
  relay_upstream_host?: string | null;
  relay_upstream_port?: number | null;
  relay_upstream_mount?: string | null;
  probe_enabled?: boolean;
  probe_interval_sec?: number | null;
  reported_lat?: number | null;
  reported_lon?: number | null;
  reported_height?: number | null;
  itrf_x?: number | null;
  itrf_y?: number | null;
  itrf_z?: number | null;
  vn2000_easting?: number | null;
  vn2000_northing?: number | null;
  coordinate_source?: 'none' | '1005/1006';
  reported_station_id?: number | null;
  lat: number | null;
  lon: number | null;
  notes: string;
  owner_web_user_id: number | null;
  owner_name?: string;
  station_type?: string;
  enabled?: boolean | number;
  receiver_type?: string;
  receiver_sn?: string;
  receiver_firmware?: string;
  antenna_type?: string;
  antenna_sn?: string;
  antenna_height?: number | null;
  elevation_mask?: number | null;
  contractor?: string;
  region?: string;
  address?: string;
  device_id?: string;
  network_type?: string;
  network_mode?: string;
  protocol?: string;
  custom_fields?: unknown;
  last_seen_at?: string | null;
  mountpoint_count?: number;
  quality_score?: number | null;
  quality_state?: string;
  last_data_at?: string | null;
}

export type StationTransportStatus = 'online' | 'stale' | 'offline' | 'error' | 'unknown';
export type StationQualityStatus = 'good' | 'warning' | 'critical' | 'unknown';
export type StationMetadataStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface StationReliability {
  windowSec: number;
  sampleCount: number;
  validSampleCount: number;
  dataCompleteness: number;
  observationStartedAt: string | null;
  scoreUpdatedAt: string | null;
  lastDataAt: string | null;
}

export interface StationDetail extends Station {
  transportStatus: StationTransportStatus;
  qualityStatus: StationQualityStatus;
  metadataStatus: StationMetadataStatus;
  reliability: StationReliability;
}

export interface StationConnectionListener {
  id: number;
  name: string;
  port: number;
  enabled: boolean;
  role: string;
}

export interface StationConnectionRelay {
  id: number;
  name: string;
  enabled: boolean;
  desiredRevision: number;
  appliedRevision: number | null;
  runtimeState: string;
  lastAppliedAt: string | null;
  lastError: string | null;
  upstream: {
    host: string;
    port: number;
    mount: string;
    ssl: boolean;
    ntripVersion: string;
    hasCredential: boolean;
  };
  downstream: {
    host: string;
    port: number;
    mount: string;
    ssl: boolean;
    ntripVersion: string;
    hasCredential: boolean;
    mode: string;
  };
  origin: string;
  updatedAt: string;
  lastSession: {
    id: number;
    startTs: string;
    endTs: string | null;
    durationSec: number | null;
    result: string;
    closeReason: string;
    message: string;
  } | null;
}

export interface StationConnectionMountpoint {
  id: number;
  name: string;
  enabled: boolean;
  requiresAuth: boolean;
  serviceType: string;
  positionMode: string;
  satelliteSystems: string;
  casterInterval: number;
  codeProtocol: string;
  codeType: string;
  description: string;
  listeners: StationConnectionListener[];
  relays: StationConnectionRelay[];
  onlineConnections: CasterConnection[];
}

export interface StationConnectionsResponse {
  stationId: number;
  generatedAt: string;
  casterAvailable: boolean;
  summary: {
    mountpoints: number;
    relays: number;
    listeners: number;
    probes: number;
    onlineConnections: number;
  };
  mountpoints: StationConnectionMountpoint[];
  probes: Array<{
    id: number;
    mountpointId: number | null;
    enabled: boolean;
    probeIntervalSec: number;
    hasCredential: boolean;
  }>;
  onlineConnections: CasterConnection[];
  probeHistory: { available: boolean; message: string };
}

export interface StationHistoryItem {
  id: string;
  source: 'quality' | 'caster' | 'relay' | 'audit';
  type: string;
  at: string;
  title: string;
  detail: string;
  level: string;
}

export interface StationHistoryResponse {
  items: StationHistoryItem[];
  total: number;
  pageSize: number;
  offset: number;
  from: string;
  to: string;
  sources: { quality: number; caster: number; relay: number; audit: number };
  probeHistory: { available: boolean; message: string };
}

export interface StationMetadataResponse {
  stationId: number;
  code: string;
  name: string;
  windowMinutes: number;
  metadataStatus: StationMetadataStatus;
  latest: QualitySample | null;
  metadata: {
    has1005: boolean;
    has1006: boolean;
    reportedStationId: number | null;
    arpX: number | null;
    arpY: number | null;
    arpZ: number | null;
    arpDeltaM: number | null;
    antenna: string | null;
    lastSeenAt: string | null;
  };
  messages: Array<{
    messageType: number;
    count: number;
    bytes: number;
    ratePerMinute: number;
    lastSeenAt: string;
  }>;
  bitrateBps: number;
  messageRatePerMinute: number;
  reliability: StationReliability;
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
  service_type?: string;
  position_mode?: string;
  satellite_systems?: string;
  caster_interval?: number;
  code_protocol?: string;
  code_type?: string;
  description?: string;
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
  company?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  validFrom?: string | null;
  validTo?: string | null;
  availableArea?: string;
  authMethod?: string;
  notes?: string;
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
  eventType?: string;
  level?: 'critical' | 'major' | 'minor' | 'info';
  unread?: boolean;
  readAt?: string | null;
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

export interface QualityConstellation {
  system: string;
  satellites: number;
  signals: number;
  cells: number;
}

export interface SkyPoint {
  azimuth: number;
  elevation: number;
  system: string;
  satellite: number;
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
  constellations?: QualityConstellation[];
  avgCnr: number;
  cnrAvailable: boolean;
  reportedStationId?: number;
  arpX?: number;
  arpY?: number;
  arpZ?: number;
  arpDeltaM?: number;
  antenna?: string;
  ageMs: number;
  latencyMs?: number;
  cycleSlips?: number;
  cycleSlipRate?: number;
  codePhaseRmsM?: number;
  codePhaseSamples?: number;
  observations?: number;
  skyPlotAvailable?: boolean;
  skyPlotReason?: string;
  skyPlot?: SkyPoint[];
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

export interface AuditLog {
  id: number;
  actorId: number | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string;
  createdAt: string;
}
