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
