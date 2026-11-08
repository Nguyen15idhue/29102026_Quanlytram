import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ToastProvider';
import { Button, Field, Select, StatusBadge } from '../../components/ui';
import type { DeviceProfile } from '../../types';

interface DeviceProfileSettings {
  defaultCode: string;
  probeCode: string;
  profiles: DeviceProfile[];
}

export function DeviceProfileTab() {
  const { csrfToken, can } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [defaultCode, setDefaultCode] = useState('');
  const [probeCode, setProbeCode] = useState('');
  const canEdit = can('device_profiles', 'edit');

  const settings = useQuery({
    queryKey: ['device-profile-settings'],
    queryFn: () => apiFetch<DeviceProfileSettings>('/api/system/device-profile')
  });

  useEffect(() => {
    if (!settings.data) return;
    setDefaultCode(settings.data.defaultCode);
    setProbeCode(settings.data.probeCode);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ defaultCode: string; probeCode: string }>('/api/system/device-profile', {
        method: 'PUT',
        body: { defaultCode, probeCode },
        csrfToken
      }),
    onSuccess: async () => {
      push('Đã lưu device profile mặc định', 'success');
      await queryClient.invalidateQueries({ queryKey: ['device-profile-settings'] });
    },
    onError: () => push('Lưu device profile thất bại', 'error')
  });

  const profiles = settings.data?.profiles ?? [];
  const selectedDefault = profiles.find((profile) => profile.code === defaultCode);
  const selectedProbe = profiles.find((profile) => profile.code === probeCode);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Device profile ngụy trang</h2>
          <p className="muted">
            Profile mặc định dùng khi job/trạm không chọn profile; probe dùng cố định một
            profile để không lộ dấu vết nội bộ.
          </p>
        </div>
        {settings.isFetching ? <StatusBadge kind="neutral" label="đang tải" /> : null}
      </div>

      <div className="form-grid">
        <Field label="Profile mặc định">
          <Select
            data-testid="system-device-default"
            value={defaultCode}
            onChange={(event) => setDefaultCode(event.target.value)}
            disabled={!canEdit}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.code}>
                {profile.name} ({profile.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Profile cho probe">
          <Select
            data-testid="system-device-probe"
            value={probeCode}
            onChange={(event) => setProbeCode(event.target.value)}
            disabled={!canEdit}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.code}>
                {profile.name} ({profile.code})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <dl className="health-facts">
        <div>
          <dt>Mặc định</dt>
          <dd>
            {selectedDefault
              ? `${selectedDefault.name} · Ntrip ${selectedDefault.ntripVersion} · ${selectedDefault.connection}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Probe</dt>
          <dd>
            {selectedProbe
              ? `${selectedProbe.name} · NMEA ${selectedProbe.nmeaIntervalSec}s`
              : '—'}
          </dd>
        </div>
      </dl>

      {canEdit ? (
        <div className="form-actions">
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!defaultCode || !probeCode}
          >
            Lưu cấu hình
          </Button>
        </div>
      ) : (
        <p className="muted">Chỉ super admin được sửa cấu hình device profile.</p>
      )}
    </section>
  );
}
