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
