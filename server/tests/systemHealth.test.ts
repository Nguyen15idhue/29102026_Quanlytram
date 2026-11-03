import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callGo: vi.fn(),
  query: vi.fn()
}));

vi.mock('../src/lib/internalApi', () => ({ callGoInternal: mocks.callGo }));
vi.mock('../src/db/pool', () => ({
  adminPool: { query: mocks.query, pool: {} }
}));
vi.mock('../src/realtime/socket', () => ({ socketClientCount: () => 0 }));

async function loadHealth() {
  vi.resetModules();
  const module = await import('../src/lib/systemHealth');
  return module.getSystemHealth();
}

function stubGo(healthDoc: unknown) {
  mocks.callGo.mockImplementation(async (path: string) => {
    if (path === '/health') {
      if (healthDoc instanceof Error) throw healthDoc;
      return healthDoc;
    }
    if (path === '/internal/rtcm/health') {
      return { status: 'ok', queueDepth: 0, queueSize: 8 };
    }
    return { items: [] };
  });
}

describe('systemHealth — relayDegraded từ Go /health', () => {
  beforeEach(() => {
    mocks.callGo.mockReset();
    mocks.query.mockReset();
    mocks.query.mockImplementation(async (sql: string) =>
      sql.includes('schema_migrations') ? [[{ version: 36 }]] : []
    );
  });

  it('Go báo degraded → Go metric warn và relayDegraded true', async () => {
    stubGo({ status: 'ok', relayDegraded: true });

    const health = await loadHealth();

    expect(health.go.relayDegraded).toBe(true);
    expect(health.go.relayHealthStatus).toBe('ok');
    expect(health.go.status).toBe('warn');
    expect(mocks.callGo).toHaveBeenCalledWith('/health', undefined, {
      method: 'GET',
      timeoutMs: 2000
    });
  });

  it('Go khỏe → relayDegraded false, Go metric ok', async () => {
    stubGo({ status: 'ok', relayDegraded: false });

    const health = await loadHealth();

    expect(health.go.relayDegraded).toBe(false);
    expect(health.go.status).toBe('ok');
  });

  it('không đọc được /health → null, không tự suy đoán degraded', async () => {
    stubGo(new Error('health timeout'));

    const health = await loadHealth();

    expect(health.go.relayDegraded).toBeNull();
    expect(health.go.relayHealthStatus).toBeNull();
    expect(health.go.status).toBe('ok');
  });
});
