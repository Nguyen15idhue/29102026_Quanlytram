export interface StationCountRow {
  id: number;
  enabled: boolean;
  status: string;
  ownerId?: number | null;
}

export interface StationMountpointRow {
  id: number;
  stationId: number | null;
}

export interface SourceConnectionRow {
  direction: string;
  mountpointId: number;
}

export interface StationStatusCounts {
  total: number;
  online: number;
  offline: number;
  other: number;
}

/**
 * Đếm trạm theo trạng thái vận hành thay vì trạng thái cấu hình:
 * - other: trạm tắt/khóa (không kỳ vọng online)
 * - online: đang có kết nối nguồn (publisher) tới một mountpoint của trạm
 * - offline: đang bật nhưng không có nguồn kết nối
 */
export function countStationStatuses(
  stations: StationCountRow[],
  mountpoints: StationMountpointRow[],
  connections: SourceConnectionRow[]
): StationStatusCounts {
  const stationByMountpoint = new Map<number, number>();
  for (const mountpoint of mountpoints) {
    if (mountpoint.stationId !== null) {
      stationByMountpoint.set(mountpoint.id, mountpoint.stationId);
    }
  }
  const onlineStations = new Set<number>();
  for (const connection of connections) {
    if (connection.direction !== 'source') continue;
    const stationId = stationByMountpoint.get(connection.mountpointId);
    if (stationId !== undefined) onlineStations.add(stationId);
  }

  const counts: StationStatusCounts = { total: 0, online: 0, offline: 0, other: 0 };
  for (const station of stations) {
    counts.total += 1;
    if (!station.enabled || station.status !== 'active') {
      counts.other += 1;
    } else if (onlineStations.has(station.id)) {
      counts.online += 1;
    } else {
      counts.offline += 1;
    }
  }
  return counts;
}
