import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Radio, RadioTower, RefreshCw } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useListParams } from '../lib/useListParams';
import type {
  MountpointExplorerDetailResponse,
  MountpointExplorerItem,
  MountpointExplorerResponse,
  MountpointSourceState,
  Station
} from '../types';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  TableToolbar
} from '../components/ui';
import { formatNumber } from '../components/charts';

function formatLocal(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(date);
}

function stateKind(value: MountpointSourceState): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'online') return 'ok';
  if (value === 'stale') return 'warn';
  if (value === 'offline' || value === 'error') return 'error';
  return 'neutral';
}

function runtimeKind(value: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (value === 'streaming') return 'ok';
  if (value === 'backoff' || value === 'degraded') return 'warn';
  if (value === 'error') return 'error';
  return 'neutral';
}

export function MountpointExplorerDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ['mountpoint-explorer-detail', id],
    queryFn: () => apiFetch<MountpointExplorerDetailResponse>(`/api/mountpoints/${id}/explorer`),
    refetchInterval: 15_000
  });
  const item = detail.data?.item;
  const firstRelay = item?.relays[0];
  const firstListener = item?.listeners[0];

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={item?.name ?? 'Mountpoint Explorer'}
      description={item ? `${item.stationCode ?? 'Chưa gắn trạm'} · #${item.id}` : `#${id}`}
      side="right"
      size="lg"
      footer={
        <>
          {item?.stationId && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/stations/${item.stationId}`)}
            >
              <ArrowUpRight size={16} aria-hidden="true" /> Mở trạm
            </Button>
          )}
          {firstRelay && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/relay-jobs?job=${firstRelay.id}`)}
            >
              <Radio size={16} aria-hidden="true" /> Mở relay
            </Button>
          )}
          {firstListener && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/caster?listener=${firstListener.id}`)}
            >
              <RadioTower size={16} aria-hidden="true" /> Mở listener
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <div className="chart-empty">Đang tải chuỗi mountpoint...</div>
      ) : detail.isError ? (
        <EmptyState
          title="Không mở được mountpoint"
          description={
            detail.error instanceof ApiClientError
              ? detail.error.message
              : 'Mountpoint không tồn tại hoặc ngoài phạm vi quyền.'
          }
          action={<Button onClick={() => detail.refetch()}>Thử lại</Button>}
        />
      ) : item ? (
        <>
          <div className="detail-status-row">
            <StatusBadge label={item.sourceState} kind={stateKind(item.sourceState)} />
            {item.quality && (
              <StatusBadge
                label={`score ${item.quality.score} · ${item.quality.state}`}
                kind={item.quality.score >= 85 ? 'ok' : item.quality.score >= 60 ? 'warn' : 'error'}
              />
            )}
            {item.alertsOpen > 0 && (
              <StatusBadge label={`${item.alertsOpen} alert mở`} kind="error" />
            )}
            {!item.enabled && <StatusBadge label="disabled" kind="neutral" />}
          </div>

          {!item.stationId && (
            <div className="inline-alert">
              <AlertTriangle size={14} aria-hidden="true" /> Mountpoint chưa gắn trạm nguồn; không
              suy đoán trạm.
            </div>
          )}
          {!detail.data?.casterAvailable && (
            <div className="inline-alert">
              <AlertTriangle size={14} aria-hidden="true" /> Không gọi được caster nội bộ; số online
              có thể chưa đầy đủ.
            </div>
          )}

          <div className="quality-kpis">
            <div>
              <span className="muted">Quality</span>
              <strong className="mono">{item.quality?.score ?? '—'}</strong>
            </div>
            <div>
              <span className="muted">Bitrate</span>
              <strong className="mono">{formatNumber(item.bitrateBps)}</strong>
            </div>
            <div>
              <span className="muted">Msg/phút</span>
              <strong className="mono">{formatNumber(item.messageRatePerMinute)}</strong>
            </div>
            <div>
              <span className="muted">Online</span>
              <strong className="mono">{item.onlineCount}</strong>
            </div>
            <div>
              <span className="muted">Alert mở</span>
              <strong className="mono">{item.alertsOpen}</strong>
            </div>
            <div>
              <span className="muted">Sample cuối</span>
              <strong className="mono kpi-time">{formatLocal(item.quality?.lastSampleAt)}</strong>
            </div>
          </div>

          <dl className="facts">
            <div>
              <dt>Trạm nguồn</dt>
              <dd>
                {item.stationId
                  ? `${item.stationCode} · ${item.stationName}`
                  : 'Chưa gắn trạm'}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{item.ownerName || item.ownerWebUserId || '—'}</dd>
            </div>
            <div>
              <dt>Dịch vụ</dt>
              <dd>
                {item.serviceType || '—'} · {item.positionMode || '—'}
              </dd>
            </div>
            <div>
              <dt>Hệ vệ tinh</dt>
              <dd>{item.satelliteSystems || '—'}</dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>{item.requiresAuth ? 'Bắt buộc' : 'Không auth'}</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>
                {item.codeProtocol || '—'} / {item.codeType || '—'}
              </dd>
            </div>
            <div>
              <dt>Caster interval</dt>
              <dd className="mono">{item.casterInterval || '—'}</dd>
            </div>
            <div>
              <dt>Mô tả</dt>
              <dd>{item.description || '—'}</dd>
            </div>
          </dl>

          <div className="detail-subhead">
            <h4>
              <Radio size={16} aria-hidden="true" /> Relay lấy mountpoint
            </h4>
            <span className="muted">{item.relays.length} job</span>
          </div>
          {item.relays.length === 0 ? (
            <p className="muted">Chưa có relay job lấy mountpoint này.</p>
          ) : (
            <div className="connection-list">
              {item.relays.map((relay) => (
                <article className="connection-item block" key={relay.id}>
                  <div className="connection-item-head">
                    <strong>{relay.name}</strong>
                    <div className="connection-badges">
                      <StatusBadge
                        label={relay.runtimeState}
                        kind={runtimeKind(relay.runtimeState)}
                      />
                      <StatusBadge
                        label={relay.enabled ? 'enabled' : 'disabled'}
                        kind={relay.enabled ? 'ok' : 'neutral'}
                      />
                    </div>
                  </div>
                  <div className="muted table-subline">
                    Desired {relay.desiredRevision} · Applied {relay.appliedRevision ?? '—'} ·{' '}
                    {relay.upstream.ntripVersion.toUpperCase()} → {relay.downstream.mode}
                  </div>
                  <div className="muted table-subline mono">
                    up {relay.upstream.host}:{relay.upstream.port}/{relay.upstream.mount} → down{' '}
                    {relay.downstream.host}:{relay.downstream.port}/{relay.downstream.mount}
                  </div>
                  {relay.lastError && (
                    <div className="inline-alert">
                      <AlertTriangle size={14} aria-hidden="true" /> {relay.lastError}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="detail-subhead">
            <h4>
              <RadioTower size={16} aria-hidden="true" /> Listener
            </h4>
            <span className="muted">{item.listeners.length}</span>
          </div>
          {item.listeners.length === 0 ? (
            <p className="muted">Chưa gán listener.</p>
          ) : (
            <div className="connection-list">
              {item.listeners.map((listener) => (
                <div className="connection-item" key={listener.id}>
                  <span>
                    <strong>{listener.name}</strong>
                    <small className="muted">
                      Port {listener.port} · {listener.role}
                    </small>
                  </span>
                  <StatusBadge
                    label={listener.enabled ? 'enabled' : 'disabled'}
                    kind={listener.enabled ? 'ok' : 'neutral'}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="detail-subhead">
            <h4>Tài khoản ACL</h4>
            <span className="muted">{item.accounts.length}</span>
          </div>
          {item.accounts.length === 0 ? (
            <p className="muted">Chưa gán tài khoản NTRIP cho mountpoint.</p>
          ) : (
            <div className="connection-list">
              {item.accounts.map((account) => (
                <div className="connection-item" key={account.id}>
                  <span>
                    <strong className="mono">{account.username}</strong>
                    <small className="muted">Tối đa {account.maxConnections} kết nối</small>
                  </span>
                  <StatusBadge
                    label={account.enabled ? 'enabled' : 'disabled'}
                    kind={account.enabled ? 'ok' : 'neutral'}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="detail-subhead">
            <h4>Kết nối online</h4>
            <span className="muted">{item.onlineCount}</span>
          </div>
          {item.onlineConnections.length === 0 ? (
            <p className="muted">Không có kết nối caster online.</p>
          ) : (
            <div className="connection-list">
              {item.onlineConnections.map((connection) => (
                <div className="connection-item" key={connection.id}>
                  <span>
                    <strong className="mono">
                      {connection.accountUsername || connection.remoteAddr}
                    </strong>
                    <small className="muted">
                      {connection.listenerName} · {connection.direction} ·{' '}
                      {formatLocal(connection.startTs)}
                    </small>
                  </span>
                  <span className="muted mono">
                    in {formatNumber(connection.bytesIn)} · out {formatNumber(connection.bytesOut)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}

export function MountpointExplorer() {
  const { can } = useAuth();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const [selected, setSelected] = useState<number | null>(null);
  const stationId = getParam('stationId');
  const state = getParam('state');
  const ownerId = getParam('ownerId');
  const alerts = getParam('alerts');
  const activeFilterCount = [stationId, state, ownerId, alerts].filter(Boolean).length;

  const stations = useQuery({
    queryKey: ['stations', 'options'],
    queryFn: () => apiFetch<{ items: Station[] }>('/api/stations?pageSize=50'),
    enabled: can('stations', 'view')
  });
  const owners = useQuery({
    queryKey: ['web-users', 'options'],
    queryFn: () =>
      apiFetch<{ items: Array<{ id: number; username: string; displayName?: string; display_name?: string }> }>(
        '/api/web-users?pageSize=50'
      ),
    enabled: can('web_users', 'view')
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (stationId) params.set('stationId', stationId);
    if (state) params.set('state', state);
    if (ownerId) params.set('ownerId', ownerId);
    if (alerts) params.set('alerts', alerts);
    return params.toString();
  }, [page, pageSize, q, stationId, state, ownerId, alerts]);

  const list = useQuery({
    queryKey: ['mountpoint-explorer', query],
    queryFn: () => apiFetch<MountpointExplorerResponse>(`/api/mountpoints/explorer?${query}`)
  });

  return (
    <section className="page">
      <PageHeader
        title="Mountpoint Explorer"
        description="Chuỗi trạm nguồn → relay → listener → tài khoản ACL → online → quality/alert."
      />

      <div className="panel">
        <TableToolbar
          search={
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Tìm mountpoint hoặc trạm"
            />
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              <RefreshCw size={16} aria-hidden="true" /> Tải lại
            </Button>
          }
        >
          <Field label="Trạm">
            <Select
              aria-label="Lọc trạm"
              value={stationId}
              onChange={(event) => setParam('stationId', event.target.value || null)}
            >
              <option value="">Mọi trạm</option>
              {(stations.data?.items ?? []).map((station) => (
                <option key={station.id} value={station.id}>
                  {station.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trạng thái nguồn">
            <Select
              aria-label="Lọc trạng thái"
              value={state}
              onChange={(event) => setParam('state', event.target.value || null)}
            >
              <option value="">Mọi trạng thái</option>
              <option value="online">Online</option>
              <option value="stale">Stale</option>
              <option value="offline">Offline</option>
              <option value="error">Error</option>
              <option value="unknown">Unknown</option>
              <option value="disabled">Disabled</option>
            </Select>
          </Field>
          {can('web_users', 'view') && (
            <Field label="Owner">
              <Select
                aria-label="Lọc owner"
                value={ownerId}
                onChange={(event) => setParam('ownerId', event.target.value || null)}
              >
                <option value="">Mọi owner</option>
                {(owners.data?.items ?? []).map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName || owner.display_name || owner.username}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Cảnh báo">
            <Select
              aria-label="Lọc cảnh báo"
              value={alerts}
              onChange={(event) => setParam('alerts', event.target.value || null)}
            >
              <option value="">Mọi alert</option>
              <option value="1">Chỉ có alert mở</option>
            </Select>
          </Field>
        </TableToolbar>

        <DataTable
          items={list.data?.items ?? []}
          rowKey={(item) => item.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được Mountpoint Explorer.' : undefined}
          empty="Không có mountpoint phù hợp."
          onRowClick={(item) => setSelected(item.id)}
          columns={[
            {
              key: 'name',
              header: 'Mountpoint',
              cell: (item) => (
                <div>
                  <span className="mono">{item.name}</span>
                  <div className="muted table-subline">
                    {item.serviceType || '—'} · {item.positionMode || '—'}
                  </div>
                </div>
              )
            },
            {
              key: 'station',
              header: 'Trạm',
              cell: (item) =>
                item.stationCode ? (
                  <div>
                    <span className="mono">{item.stationCode}</span>
                    <div className="muted table-subline">{item.stationName}</div>
                  </div>
                ) : (
                  <span className="muted">Chưa gắn trạm</span>
                )
            },
            {
              key: 'state',
              header: 'Nguồn',
              cell: (item) => (
                <StatusBadge label={item.sourceState} kind={stateKind(item.sourceState)} />
              )
            },
            {
              key: 'quality',
              header: 'Quality',
              align: 'right',
              hideOnMobile: true,
              cell: (item) =>
                item.quality ? (
                  <StatusBadge
                    label={String(item.quality.score)}
                    kind={
                      item.quality.score >= 85
                        ? 'ok'
                        : item.quality.score >= 60
                          ? 'warn'
                          : 'error'
                    }
                  />
                ) : (
                  '—'
                )
            },
            {
              key: 'relay',
              header: 'Relay',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => item.relays.length
            },
            {
              key: 'listener',
              header: 'Listener',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => item.listeners.length
            },
            {
              key: 'accounts',
              header: 'ACL',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => item.accounts.length
            },
            {
              key: 'online',
              header: 'Online',
              align: 'right',
              cell: (item) => item.onlineCount
            },
            {
              key: 'alerts',
              header: 'Alert',
              align: 'right',
              cell: (item) =>
                item.alertsOpen > 0 ? (
                  <StatusBadge label={String(item.alertsOpen)} kind="error" />
                ) : (
                  '0'
                )
            },
            {
              key: 'bitrate',
              header: 'bps',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => <span className="mono">{formatNumber(item.bitrateBps)}</span>
            },
            {
              key: 'msg',
              header: 'Msg/phút',
              align: 'right',
              hideOnMobile: true,
              cell: (item) => <span className="mono">{formatNumber(item.messageRatePerMinute)}</span>
            }
          ]}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {selected !== null && <MountpointExplorerDrawer id={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
