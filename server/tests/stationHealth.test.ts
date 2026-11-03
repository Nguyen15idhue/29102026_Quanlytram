import { describe, expect, it } from 'vitest';
import { countStationStatuses } from '../src/lib/stationHealth';

describe('countStationStatuses', () => {
  const stations = [
    { id: 1, enabled: true, status: 'active' },
    { id: 2, enabled: true, status: 'active' },
    { id: 3, enabled: false, status: 'disabled' },
    { id: 4, enabled: true, status: 'locked' }
  ];
  const mountpoints = [
    { id: 10, stationId: 1 },
    { id: 11, stationId: 2 }
  ];

  it('đếm online theo kết nối nguồn, offline và khác theo cấu hình', () => {
    const counts = countStationStatuses(stations, mountpoints, [
      { direction: 'source', mountpointId: 10 },
      { direction: 'rover', mountpointId: 11 }
    ]);
    expect(counts).toEqual({ total: 4, online: 1, offline: 1, other: 2 });
  });

  it('không có kết nối nguồn thì trạm bật là offline', () => {
    const counts = countStationStatuses(stations, mountpoints, []);
    expect(counts).toEqual({ total: 4, online: 0, offline: 2, other: 2 });
  });

  it('kết nối rover không tính là trạm online', () => {
    const counts = countStationStatuses(stations, mountpoints, [
      { direction: 'rover', mountpointId: 10 }
    ]);
    expect(counts.online).toBe(0);
  });
});
