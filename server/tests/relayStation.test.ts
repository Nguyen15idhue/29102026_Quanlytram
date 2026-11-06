import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret, secretAad } from '../src/lib/crypto';
import { loadStationOptions, resolveStationEndpoint } from '../src/lib/relayStation';

const { KEY, queryMock } = vi.hoisted(() => {
  const key = Buffer.alloc(32, 5).toString('base64');
  process.env.APP_ENC_KEY = key;
  return { KEY: key, queryMock: vi.fn() };
});

vi.mock('../src/db/pool', () => ({ query: queryMock }));

const SCOPE = { sql: '1=1', params: [] as unknown[] };

const baseStation = {
  id: 5,
  name: 'DOCS-Trạm Hậu Lộc',
  company_id: 35,
  company_name: 'DOCS Demo',
  ntrip_version: 'v2' as const,
  source_role: 'ntrip_caster' as const,
  client_host: '',
  client_port: 1509,
  client_mount: '',
  client_tls: 0,
  client_username: '',
  client_password_enc: null,
  caster_username: 'hl-source',
  caster_password_enc: encryptSecret('hl-pass', KEY),
  caster_version: 'v2' as const,
  listener_port: 1509
};

const mountpoint = {
  station_id: 5,
  id: 9,
  name: 'HL_RTCM',
  requires_auth: 1,
  port: 1509
};

function mockQueries(stations: unknown[], mountpoints: unknown[]) {
  queryMock.mockImplementation(async (sql: string) =>
    sql.includes('FROM stations') ? stations : mountpoints
  );
}

describe('relayStation', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('chọn trạm nguồn: dùng mountpoint nội bộ + credential của trạm', async () => {
    mockQueries([baseStation], [mountpoint]);

    const resolved = await resolveStationEndpoint(SCOPE, 5, 9, 'source');

    expect(resolved.endpoint).toMatchObject({
      host: '127.0.0.1',
      port: 1509,
      mount: 'HL_RTCM',
      ntripVersion: 'v2'
    });
    expect(resolved.credential).toEqual({ username: 'hl-source', password: 'hl-pass' });
    expect(resolved.mountpointId).toBe(9);
  });

  it('trạm nguồn: tái dùng credential relay có ACL khi trạm thiếu mật khẩu caster', async () => {
    const credentialId = 170;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM stations')) {
        return [{ ...baseStation, caster_password_enc: null }];
      }
      if (sql.includes('FROM ntrip_accounts')) {
        return [
          {
            id: credentialId,
            username: 'reader',
            password_enc: encryptSecret(
              'read-pass',
              KEY,
              secretAad('relay_credentials', 'password_enc', credentialId)
            )
          }
        ];
      }
      return [mountpoint];
    });

    const resolved = await resolveStationEndpoint(SCOPE, 5, 9, 'source');

    expect(resolved.endpoint).toMatchObject({ host: '127.0.0.1', mount: 'HL_RTCM' });
    expect(resolved.credential).toEqual({ username: 'reader', password: 'read-pass' });
    expect(resolved.mountpointId).toBe(9);
  });

  it('trạm nguồn thiếu mật khẩu và không có credential dự phòng bị từ chối', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM stations')) {
        return [{ ...baseStation, caster_password_enc: null }];
      }
      if (sql.includes('FROM ntrip_accounts')) return [];
      return [mountpoint];
    });

    await expect(resolveStationEndpoint(SCOPE, 5, 9, 'source')).rejects.toMatchObject({
      code: 'STATION_CREDENTIAL_REQUIRED'
    });
  });

  it('trạm ntrip_client: nguồn dùng client_* kể cả khi có mountpoint nội bộ', async () => {
    mockQueries(
      [
        {
          ...baseStation,
          source_role: 'ntrip_client',
          client_host: 'rtk.example',
          client_port: 2101,
          client_mount: 'EXT',
          client_tls: 1,
          client_username: 'ext-user',
          client_password_enc: encryptSecret(
            'ext-pass',
            KEY,
            secretAad('station_sources', 'client_password_enc', 5)
          ),
          listener_port: 1509
        }
      ],
      [mountpoint]
    );

    const resolved = await resolveStationEndpoint(SCOPE, 5, 9, 'source');

    expect(resolved.endpoint).toMatchObject({
      host: 'rtk.example',
      port: 2101,
      mount: 'EXT',
      ssl: true
    });
    expect(resolved.credential).toEqual({ username: 'ext-user', password: 'ext-pass' });
    expect(resolved.mountpointId).toBeNull();
  });

  it('trạm ntrip_client: đích vẫn dùng mountpoint nội bộ', async () => {
    mockQueries(
      [
        {
          ...baseStation,
          source_role: 'ntrip_client',
          client_host: 'rtk.example',
          client_port: 2101,
          client_mount: 'EXT',
          client_username: 'ext-user',
          client_password_enc: null,
          listener_port: 1509
        }
      ],
      [mountpoint]
    );

    const resolved = await resolveStationEndpoint(SCOPE, 5, null, 'destination');

    expect(resolved.endpoint).toMatchObject({
      host: '127.0.0.1',
      port: 1509,
      mount: 'HL_RTCM'
    });
    expect(resolved.mountpointId).toBe(9);
  });

  it('trạm ntrip_client không có mountpoint: fallback client_* và giải mã AAD', async () => {
    mockQueries(
      [
        {
          ...baseStation,
          source_role: 'ntrip_client',
          client_host: 'rtk.example',
          client_port: 2101,
          client_mount: 'EXT',
          client_tls: 1,
          client_username: 'ext-user',
          client_password_enc: encryptSecret(
            'ext-pass',
            KEY,
            secretAad('station_sources', 'client_password_enc', 5)
          ),
          listener_port: null
        }
      ],
      []
    );

    const resolved = await resolveStationEndpoint(SCOPE, 5, null, 'source');

    expect(resolved.endpoint).toMatchObject({
      host: 'rtk.example',
      port: 2101,
      mount: 'EXT',
      ssl: true
    });
    expect(resolved.credential).toEqual({ username: 'ext-user', password: 'ext-pass' });
  });

  it('trạm đích có nguồn no-auth thì không cần credential', async () => {
    mockQueries([{ ...baseStation, caster_requires_auth: 0 }], [mountpoint]);

    const resolved = await resolveStationEndpoint(SCOPE, 5, 9, 'destination');

    expect(resolved.endpoint).toMatchObject({ host: '127.0.0.1', mount: 'HL_RTCM' });
    expect(resolved.credential).toBeNull();
  });

  it('trạm đích không có mountpoint bị từ chối', async () => {    mockQueries([{ ...baseStation, listener_port: null, client_host: '', client_mount: '' }], []);

    await expect(resolveStationEndpoint(SCOPE, 5, null, 'destination')).rejects.toMatchObject({
      code: 'STATION_NO_ENDPOINT'
    });
  });

  it('trạm ngoài scope trả STATION_NOT_FOUND', async () => {
    mockQueries([], []);

    await expect(resolveStationEndpoint(SCOPE, 5, null, 'source')).rejects.toMatchObject({
      code: 'STATION_NOT_FOUND'
    });
  });

  it('station-options trả tóm tắt 2 hướng và danh sách mountpoint', async () => {
    mockQueries([baseStation], [mountpoint]);

    const items = await loadStationOptions(SCOPE);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 5,
      name: 'DOCS-Trạm Hậu Lộc',
      companyId: 35,
      sourceRole: 'ntrip_caster'
    });
    expect(items[0].source).toMatchObject({ host: '127.0.0.1', mount: 'HL_RTCM' });
    expect(items[0].destination).toMatchObject({ mount: 'HL_RTCM' });
    expect(items[0].mountpoints).toEqual([
      { id: 9, name: 'HL_RTCM', port: 1509, requiresAuth: true }
    ]);
  });
});
