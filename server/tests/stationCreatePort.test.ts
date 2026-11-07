import { describe, expect, it } from 'vitest';
import { createSchema, validateSourceFields } from '../src/routes/stations';

const base = {
  name: 'test-client-port',
  host: '',
  connection_type: 'ntrip',
  source_type: 'manual',
  ntrip_version: 'v1',
  ntrip_mode: 'v1_noauth',
  lat: null,
  lon: null,
  notes: '',
  station_type: 'reference',
  enabled: true,
  receiver_type: '',
  receiver_sn: '',
  receiver_firmware: '',
  antenna_type: '',
  antenna_sn: '',
  antenna_height: null,
  elevation_mask: null,
  contractor: '',
  region: '',
  address: '',
  device_id: '',
  coordinate_type: 'wgs84',
  province: '',
  ward: '',
  address_detail: '',
  network_type: '',
  network_mode: '',
  protocol: 'ntrip'
};

const clientSource = {
  source_role: 'ntrip_client',
  client_host: '192.0.2.10',
  client_port: 1509,
  client_mount: 'TEST',
  client_username: 'u',
  client_password: 'p',
  client_tls: false,
  client_send_gga: false,
  client_nmea_interval_sec: 0,
  client_gga_lat: null,
  client_gga_lon: null,
  caster_username: '',
  caster_requires_auth: true,
  caster_listener_id: null
};

describe('station create port (ntrip client)', () => {
  it('chấp nhận thiếu port trạm khi nguồn là ntrip_client', () => {
    const parsed = createSchema.safeParse({ ...base, ...clientSource });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.port).toBeUndefined();
      expect(validateSourceFields(parsed.data)).toBeNull();
    }
  });

  it('từ chối port = 0 với chi tiết path=port', () => {
    const parsed = createSchema.safeParse({ ...base, ...clientSource, port: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('port');
    }
  });

  it('caster không listener vẫn báo thiếu listener (không phải port)', () => {
    const parsed = createSchema.safeParse({
      ...base,
      port: 2101,
      source_role: 'ntrip_caster',
      caster_listener_id: null,
      caster_username: 'u',
      caster_password: 'p',
      caster_requires_auth: true
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(validateSourceFields(parsed.data)).toBe('Caster listener là bắt buộc');
    }
  });
});
