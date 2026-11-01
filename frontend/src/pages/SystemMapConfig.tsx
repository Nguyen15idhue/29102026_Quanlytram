import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PlugZap, Save } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/ToastProvider';
import { Button, Field, Input, PageHeader, Select } from '../components/ui';
import { MAP_CONFIG_QUERY_KEY, useMapConfig } from '../lib/useMapConfig';
import type { MapConfig, MapMode } from '../types';

const MODE_LABELS: Record<MapMode, string> = {
  streets: 'Đường phố',
  satellite: 'Vệ tinh',
  terrain: 'Địa hình'
};

interface TestResult {
  ok?: boolean;
  modes?: Record<MapMode, { ok: boolean; status: number; provider: string; ms: number }>;
}

export function SystemMapConfig() {
  const { csrfToken, can } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const configQuery = useMapConfig();
  const [form, setForm] = useState<MapConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (configQuery.data?.config && !form) {
      setForm(structuredClone(configQuery.data.config));
    }
  }, [configQuery.data, form]);

  if (!can('settings', 'edit')) {
    return (
      <section className="page">
        <PageHeader title="Cấu hình bản đồ" description="Chỉ super admin được cấu hình bản đồ." />
        <div className="table-state error">Bạn không có quyền truy cập trang này.</div>
      </section>
    );
  }

  if (configQuery.isError) {
    return (
      <section className="page">
        <PageHeader title="Cấu hình bản đồ" />
        <div className="table-state error">Không tải được cấu hình bản đồ.</div>
      </section>
    );
  }

  if (configQuery.isLoading || !form) {
    return (
      <section className="page">
        <PageHeader title="Cấu hình bản đồ" />
        <div className="table-state">Đang tải cấu hình...</div>
      </section>
    );
  }

  function update(patch: Partial<MapConfig>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function updateMode(mode: MapMode, patch: Partial<MapConfig['modes'][MapMode]>) {
    setForm((current) =>
      current
        ? { ...current, modes: { ...current.modes, [mode]: { ...current.modes[mode], ...patch } } }
        : current
    );
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setTestResult(null);
    try {
      const response = await apiFetch<{ config: MapConfig }>('/api/map/config', {
        method: 'PUT',
        body: form,
        csrfToken
      });
      setForm(structuredClone(response.config));
      await queryClient.invalidateQueries({ queryKey: MAP_CONFIG_QUERY_KEY });
      push('Đã lưu cấu hình bản đồ', 'success');
    } catch (error) {
      push(
        error instanceof ApiClientError ? error.message : 'Không lưu được cấu hình',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!form) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await apiFetch<TestResult>('/api/map/config/test', {
        method: 'POST',
        body: form,
        csrfToken
      });
      setTestResult(response);
      push(response.ok ? 'Kết nối tile thành công' : 'Một số nền không kết nối được', response.ok ? 'success' : 'error');
    } catch (error) {
      push(
        error instanceof ApiClientError ? error.message : 'Không kiểm tra được tile',
        'error'
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title="Cấu hình bản đồ"
        description="Cấu hình provider, tile proxy, nền mặc định và giới hạn zoom. Chỉ super admin."
      />

      <div className="panel form-section">
        <fieldset className="form-grid">
          <legend>Chung</legend>
          <Field label="Provider">
            <Input
              value={form.provider}
              onChange={(event) => update({ provider: event.target.value })}
            />
          </Field>
          <Field label="Chế độ tile">
            <Select
              value={form.tileMode}
              onChange={(event) =>
                update({ tileMode: event.target.value as MapConfig['tileMode'] })
              }
            >
              <option value="proxy">Proxy (khuyến nghị)</option>
              <option value="direct">Direct</option>
            </Select>
          </Field>
          <Field label="Tile URL">
            <Input
              value={form.tileUrl}
              onChange={(event) => update({ tileUrl: event.target.value })}
            />
          </Field>
          <Field label="Attribution">
            <Input
              value={form.attribution}
              onChange={(event) => update({ attribution: event.target.value })}
            />
          </Field>
          <Field label="Subdomains (phẩy)">
            <Input
              value={form.subdomains.join(',')}
              onChange={(event) =>
                update({
                  subdomains: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                })
              }
            />
          </Field>
          <Field label="Max zoom">
            <Input
              type="number"
              min={0}
              max={22}
              value={form.maxZoom}
              onChange={(event) => update({ maxZoom: Number(event.target.value) })}
            />
          </Field>
          <Field label="Max native zoom">
            <Input
              type="number"
              min={0}
              max={22}
              value={form.maxNativeZoom}
              onChange={(event) => update({ maxNativeZoom: Number(event.target.value) })}
            />
          </Field>
          <Field label="Zoom mặc định">
            <Input
              type="number"
              min={0}
              max={22}
              value={form.zoom}
              onChange={(event) => update({ zoom: Number(event.target.value) })}
            />
          </Field>
          <Field label="Center lat">
            <Input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={form.center.lat}
              onChange={(event) =>
                update({ center: { ...form.center, lat: Number(event.target.value) } })
              }
            />
          </Field>
          <Field label="Center lng">
            <Input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={form.center.lng}
              onChange={(event) =>
                update({ center: { ...form.center, lng: Number(event.target.value) } })
              }
            />
          </Field>
          <Field label="Retina">
            <Select
              value={form.retina ? '1' : '0'}
              onChange={(event) => update({ retina: event.target.value === '1' })}
            >
              <option value="0">Tắt</option>
              <option value="1">Bật</option>
            </Select>
          </Field>
        </fieldset>
      </div>

      {(Object.keys(MODE_LABELS) as MapMode[]).map((mode) => (
        <div className="panel form-section" key={mode}>
          <fieldset className="form-grid">
            <legend>Nền {MODE_LABELS[mode]}</legend>
            <Field label="Provider">
              <Input
                value={form.modes[mode].provider ?? ''}
                onChange={(event) => updateMode(mode, { provider: event.target.value })}
              />
            </Field>
            <Field label="Tile URL">
              <Input
                value={form.modes[mode].tileUrl}
                onChange={(event) => updateMode(mode, { tileUrl: event.target.value })}
              />
            </Field>
            <Field label="Attribution">
              <Input
                value={form.modes[mode].attribution}
                onChange={(event) => updateMode(mode, { attribution: event.target.value })}
              />
            </Field>
            <Field label="Max zoom">
              <Input
                type="number"
                min={0}
                max={22}
                value={form.modes[mode].maxZoom}
                onChange={(event) =>
                  updateMode(mode, { maxZoom: Number(event.target.value) })
                }
              />
            </Field>
          </fieldset>
        </div>
      ))}

      <div className="map-actions">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          <Save size={16} aria-hidden="true" /> Lưu cấu hình
        </Button>
        <Button onClick={handleTest} loading={testing}>
          <PlugZap size={16} aria-hidden="true" /> Kiểm tra kết nối
        </Button>
      </div>

      {testResult?.modes && (
        <div className="panel map-config-test">
          <h4>Kết quả kiểm tra</h4>
          <ul>
            {(Object.keys(MODE_LABELS) as MapMode[]).map((mode) => {
              const result = testResult.modes?.[mode];
              return (
                <li key={mode}>
                  <strong>{MODE_LABELS[mode]}:</strong>{' '}
                  {result?.ok ? (
                    <span className="text-ok">
                      OK · {result.provider} · {result.ms}ms
                    </span>
                  ) : (
                    <span className="text-error">Lỗi kết nối</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
