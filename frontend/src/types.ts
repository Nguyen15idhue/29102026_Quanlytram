export type Scope = 'all' | 'subtree' | 'tenant' | 'own' | 'none';

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
  companyId?: number | null;
  companyName?: string | null;
  companyStatus?: string | null;
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
  company_id?: number | null;
  company_name?: string | null;
  station_type?: string;
  status?: 'active' | 'disabled' | 'locked';
  station_source_role?: 'ntrip_client' | 'ntrip_caster' | null;
  station_client_host?: string | null;
  station_client_port?: number | null;
  station_client_mount?: string | null;
  station_caster_listener_id?: number | null;
  station_caster_port?: number | null;
  coordinate_type?: 'wgs84' | 'vn2000' | 'itrf';
  province?: string;
  ward?: string;
  address_detail?: string;
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
  created_at?: string;
  updated_at?: string;
  created_by?: number | null;
  mountpoint_count?: number;
  mountpoint_name?: string | null;
  account_username?: string | null;
  quality_score?: number | null;
  quality_state?: string;
  transportStatus?: StationTransportStatus;
  last_data_at?: string | null;
}

export interface StationSource {
  station_id: number;
  source_role: 'ntrip_client' | 'ntrip_caster';
  client_host: string;
  client_port: number;
  client_mount: string;
  client_username: string;
  client_has_password: boolean;
  client_tls: boolean;
  client_send_gga: boolean;
  client_nmea_interval_sec: number;
  client_gga_lat: number | null;
  client_gga_lon: number | null;
  caster_version: 'v1' | 'v2';
  caster_username: string;
  caster_has_password: boolean;
  caster_requires_auth: boolean;
  caster_listener_id: number | null;
  caster_listener_name?: string | null;
  caster_port?: number | null;
  relay_job_id: number | null;
  updated_at?: string;
}

export type StationTransportStatus = 'online' | 'offline' | 'no_data' | 'error' | 'unknown' | null;
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

export type StationActivityRange = '24h' | '7d' | '30d';

export interface StationActivityEvent {
  id: string;
  at: string;
  source: 'caster' | 'relay';
  reason: string;
  durationSec: number;
}

export interface StationActivitySegment {
  from: string;
  to: string;
  status: 'up' | 'down';
}

export interface StationActivityPoint {
  at: string;
  satellites: number | null;
  avgCnr: number | null;
  msmEpochs: number | null;
  gaps: number | null;
  ageMs: number | null;
}

export interface StationActivityResponse {
  stationId?: number;
  relayJobId?: number;
  direction?: 'ingest' | 'upstream' | 'downstream';
  range: StationActivityRange;
  from: string;
  to: string;
  totalSec: number;
  onlineSec: number;
  uptimePct: number;
  events: StationActivityEvent[];
  segments: StationActivitySegment[];
  series: StationActivityPoint[];
}

export type TimelineStatus = 'online' | 'offline' | 'no_data' | 'none';
export type TimelineRange = '1h' | '24h' | '7d' | '1m';

export interface TimelineBucket {
  from: string;
  to: string;
  status: TimelineStatus;
}

export interface TimelineSeriesPoint {
  at: string;
  satellites: number | null;
  avgCnr: number | null;
  msmEpochs: number | null;
  gaps: number | null;
  ageMs: number | null;
}

export interface EntityTimelineResponse {
  rangeFrom: string;
  to: string;
  createdAt: string | null;
  range: TimelineRange;
  bucketSec: number;
  buckets: TimelineBucket[];
  series: TimelineSeriesPoint[];
  onlineSec: number;
  offlineSec: number;
  noDataSec: number;
  noneSec: number;
  totalSec: number;
  uptimePct: number;
  current: TimelineStatus;
  direction?: 'upstream' | 'downstream';
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
  probeHistory?: { available: boolean; message: string };
}

export interface StationMetadataResponse {
  stationId: number;
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
  owner_web_user_id: number | null;
  owner_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
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
  companyId?: number | null;
  companyName?: string | null;
  companyStatus?: string | null;
  role: {
    id: number;
    code: string;
    name: string;
    level: number;
  };
  createdAt?: string;
  lastLoginAt?: string | null;
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
  ownerName?: string | null;
  companyId?: number | null;
  companyName?: string | null;
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

export interface DataUptimeBucket {
  bucket: string;
  onlineSec: number;
  downSec: number;
  samples: number;
  crcErrors: number;
  parseErrors: number;
}

export interface DataUptimeResult {
  from: string;
  to: string;
  totalSec: number;
  onlineSec: number;
  downSec: number;
  uptimePct: number;
  samples: number;
  crcErrors: number;
  parseErrors: number;
  lastDataAt: string | null;
  buckets: DataUptimeBucket[];
}
export type RelayStreamStatus = 'online' | 'offline' | 'no_data' | null;

export interface RelayJobMetrics {
  state: string;
  bytesUp: number;
  bytesDown: number;
  frames: number;
  crcErrors: number;
  lastDataAt: string | null;
  lastUpAt: string | null;
  lastDownAt: string | null;
  lastError: string | null;
}

export interface RelayJob {
  id: number;
  externalKey?: string | null;
  name: string;
  enabled: boolean;
  locked: boolean;
  streamStatus: RelayStreamStatus;
  directionStatus?: {
    upstream: 'online' | 'offline' | 'no_data';
    downstream: 'online' | 'offline' | 'no_data';
  };
  metrics?: RelayJobMetrics | null;
  desiredRevision: number;
  upstream: RelayEndpoint;
  downstream: RelayEndpoint;
  downstreamMode: 'auto' | 'post' | 'source';
  lat?: number | null;
  lon?: number | null;
  uaPrefix?: string;
  nmeaIntervalSec?: number;
  origin?: string;
  originRef?: string;
  ownerWebUserId?: number | null;
  ownerName?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  state: RelayJobState | null;
}

export interface RelayJobStatusResponse {
  item: RelayJob;
  uptime: {
    windowSec: number;
    onlineSec: number;
    uptimePct: number;
    buckets: Array<{
      hourStartUtc: string;
      onlineSec: number;
      sessions: number;
      errors: number;
      timeouts: number;
      authErrors: number;
      proxyErrors: number;
      retries: number;
    }>;
  };
  sessions: Array<{
    id: number;
    startTs: string;
    endTs: string | null;
    durationSec: number | null;
    result: string;
    closeReason: string;
    message: string;
  }>;
  errorSummary: {
    authFailed: number;
    timeout: number;
    network: number;
    proxy: number;
  };
  dataUptime?: DataUptimeResult;
  recentErrors: Array<{
    id: number;
    at: string;
    closeReason: string;
    message: string;
  }>;
}

export interface CasterListener {
  id: number;
  name: string;
  port: number;
  enabled: boolean;
  role: 'both' | 'source' | 'rover';
  description: string;
  global?: boolean;
  ownerWebUserId?: number | null;
  ownerName?: string | null;
  mountpointCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Company {
  id: number;
  code: string;
  name: string;
  status: 'active' | 'disabled';
  notes: string;
  userCount: number;
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
  band?: string;
  cnr?: number;
}

export interface SignalCnr {
  system: string;
  satellite: number;
  signal: number;
  band: string;
  cnr: number;
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
  signalsCnr?: SignalCnr[];
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

export type MountpointSourceState =
  | 'online'
  | 'stale'
  | 'offline'
  | 'error'
  | 'unknown'
  | 'disabled';

export interface MountpointExplorerRelay {
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
  };
  downstream: {
    host: string;
    port: number;
    mount: string;
    ssl: boolean;
    ntripVersion: string;
    mode: string;
  };
  hasCredential: { upstream: boolean; downstream: boolean };
  origin: string;
  updatedAt: string;
}

export interface MountpointExplorerListener {
  id: number;
  name: string;
  port: number;
  enabled: boolean;
  role: string;
}

export interface MountpointExplorerAccount {
  id: number;
  username: string;
  enabled: boolean;
  maxConnections: number;
}

export interface MountpointExplorerItem {
  id: number;
  name: string;
  enabled: boolean;
  serviceType: string;
  positionMode: string;
  satelliteSystems: string;
  casterInterval: number;
  codeProtocol: string;
  codeType: string;
  description: string;
  stationId: number | null;
  stationName: string | null;
  ownerWebUserId: number | null;
  ownerName: string | null;
  sourceState: MountpointSourceState;
  quality: {
    score: number;
    state: string;
    lastSampleAt: string;
    ageSec: number | null;
    bitrateBps: number;
    messageRatePerMinute: number;
  } | null;
  bitrateBps: number;
  messageRatePerMinute: number;
  relays: MountpointExplorerRelay[];
  listeners: MountpointExplorerListener[];
  accounts: MountpointExplorerAccount[];
  onlineConnections: CasterConnection[];
  onlineCount: number;
  alertsOpen: number;
}

export interface MountpointExplorerResponse {
  items: MountpointExplorerItem[];
  total: number;
  pageSize: number;
  offset: number;
  casterAvailable: boolean;
  filters: {
    q: string;
    stationId: number | null;
    ownerId: number | null;
    state: string | null;
    alerts: boolean;
  };
}

export interface MountpointExplorerDetailResponse {
  item: MountpointExplorerItem;
  casterAvailable: boolean;
}

export type CoordSource = '1005' | 'station' | 'none';

export type AccountFixStatus = 'single' | 'fixed' | 'float' | 'rtd' | 'error';

export interface MapStationItem {
  id: number;
  name: string;
  lat: number | null;
  lon: number | null;
  coordSource: CoordSource;
  hasCoords: boolean;
  has1005: boolean;
  transport: 'online' | 'stale' | 'no_data' | 'offline' | 'error' | 'unknown';
  quality: string;
  score: number | null;
  sourceType: string;
  mountpointCount: number;
  relayJobCount: number | null;
  onlineAccounts: number;
  accountStatus: AccountFixStatus | null;
  connectedAccounts: Array<{ id: number; username: string; fixType: AccountFixStatus }>;
  region: string;
  address: string;
  companyId: number | null;
  companyName: string | null;
  ownerWebUserId: number | null;
  ownerName: string | null;
}

export interface MapOverviewResponse {
  items: MapStationItem[];
  total: number;
  counts: {
    all: number;
    online: number;
    issues: number;
    online_accounts: number;
    withCoords: number;
    missingCoords: number;
    missing_1005: number;
    stationStatus: {
      online: number;
      stale: number;
      no_data: number;
      offline: number;
      error: number;
      unknown: number;
    };
    accountStatus: {
      single: number;
      fixed: number;
      float: number;
      rtd: number;
      error: number;
    };
    filtered: number;
  };
  layersAvailable: string[];
  regions: string[];
  owners: Array<{ id: number; name: string }>;
  filters: {
    q: string;
    region: string;
    owner: number | null;
    layer: string;
    transport: string[];
    status: string | null;
    hasCoords: string | null;
    companyId: number | null;
  };
}

export type MapMode = 'streets' | 'satellite' | 'terrain';

export interface MapModeConfig {
  provider?: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom?: number;
  retina?: boolean;
  subdomains?: string[];
}

export interface MapConfig {
  version: number;
  provider: string;
  tileMode: 'proxy' | 'direct';
  tileUrl: string;
  attribution: string;
  subdomains: string[];
  maxZoom: number;
  maxNativeZoom: number;
  retina: boolean;
  center: { lat: number; lng: number };
  zoom: number;
  modes: Record<MapMode, MapModeConfig>;
}
