import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, Radio, RadioTower } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useRealtime } from '../realtime/RealtimeProvider';
import type {
  QualityAlertItem,
  QualityLiveItem,
  QualityMessageStat,
  QualitySample
} from '../types';
import { Button, EmptyState, IconButton, StatusBadge, Tabs } from './ui';
import { BarChart, LineChart, ScoreDial, SkyPlot, formatNumber } from './charts';
import { useToast } from './ToastProvider';

type TargetType = 'station' | 'relay_job';
type Direction = 'ingest' | 'upstream' | 'downstream';
type LatestQuality = QualitySample | QualityLiveItem;

interface QualityResponse {
  items: QualitySample[];
  latest: LatestQuality | LatestQuality[] | null;
  live: QualityLiveItem[];
  window: number;
  jobScore?: number | null;
  parity?: number | null;
}

interface MessagesResponse {
  items: QualityMessageStat[];
}

interface AlertsResponse {
  items: QualityAlertItem[];
  total: number;
}

interface QualityPanelProps {
  targetType: TargetType;
  targetId: number;
  mountpointId?: number;
}

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

function levelKind(level: string): 'error' | 'warn' | 'info' | 'neutral' {
  if (level === 'critical') return 'error';
  if (level === 'major') return 'warn';
  if (level === 'minor') return 'info';
  return 'neutral';
}

function pickLatest(
  value: LatestQuality | LatestQuality[] | null | undefined,
  direction: Direction
): LatestQuality | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.find((item) => item.direction === direction) ?? value[0] ?? null;
  }
  return value;
}

export function QualityPanel({ targetType, targetId, mountpointId }: QualityPanelProps) {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { quality } = useRealtime();
  const isStation = targetType === 'station';
  const [direction, setDirection] = useState<Direction>(isStation ? 'ingest' : 'upstream');

  useEffect(() => {
    setDirection(isStation ? 'ingest' : 'upstream');
  }, [isStation, targetId]);

  const qualityQuery = useQuery({
    queryKey: ['quality-detail', targetType, targetId, mountpointId],
    queryFn: () =>
      isStation
        ? apiFetch<QualityResponse>(
            `/api/stations/${targetId}/quality?window=60${
              mountpointId ? `&mountpointId=${mountpointId}` : ''
            }`
          )
        : apiFetch<QualityResponse>(`/api/relay-jobs/${targetId}/quality?window=60`),
    refetchInterval: 15_000
  });

  const messagesQuery = useQuery({
    queryKey: ['quality-messages', targetType, targetId, mountpointId, direction],
    queryFn: () =>
      isStation
        ? apiFetch<MessagesResponse>(
            `/api/stations/${targetId}/rtcm/messages${
              mountpointId ? `?mountpointId=${mountpointId}` : ''
            }`
          )
        : apiFetch<MessagesResponse>(
            `/api/relay-jobs/${targetId}/rtcm/messages?direction=${direction}`
          )
  });

  const alertsQuery = useQuery({
    queryKey: ['quality-alerts-target', targetType, targetId],
    queryFn: () =>
      apiFetch<AlertsResponse>(
        `/api/quality/alerts?targetType=${targetType}&status=open&pageSize=50`
      )
  });

  const activeLive = quality.filter(
    (live) =>
      live.targetType === targetType &&
      live.targetId === targetId &&
      (!mountpointId || live.mountpointId === mountpointId)
  );
  const latest =
    activeLive.find((live) => live.direction === direction) ??
    activeLive[0] ??
    pickLatest(qualityQuery.data?.latest, direction);
  const latestLive = latest && 'scoreParts' in latest ? latest : null;
  const samples = (qualityQuery.data?.items ?? []).filter(
    (sample) => sample.direction === direction
  );
  const alerts = (alertsQuery.data?.items ?? []).filter(
    (alert) => alert.targetId === targetId && alert.targetType === targetType
  );

  const ack = useMutation({
    mutationFn: (alert: QualityAlertItem) =>
      apiFetch(`/api/quality/alerts/${alert.id}/ack`, {
        method: 'POST',
        body: {},
        csrfToken
      }),
    onSuccess: async () => {
      push('Đã xác nhận cảnh báo chất lượng', 'success');
      await queryClient.invalidateQueries({
        queryKey: ['quality-alerts-target', targetType, targetId]
      });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Xác nhận thất bại', 'error')
  });

  const messageData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const message of messagesQuery.data?.items ?? []) {
      if (message.direction !== direction) continue;
      if (mountpointId && message.mountpointId !== mountpointId) continue;
      totals.set(
        String(message.messageType),
        (totals.get(String(message.messageType)) ?? 0) + message.count
      );
    }
    if (totals.size > 0) {
      return [...totals.entries()].map(([label, value]) => ({ label, value }));
    }
    return Object.entries(latestLive?.messageTypes ?? {}).map(([label, value]) => ({
      label,
      value
    }));
  }, [messagesQuery.data?.items, direction, mountpointId, latestLive]);

  const scoreValues = samples.map((sample) => sample.score);
  const satValues = samples.map((sample) => sample.satellites);
  const cnrValues = samples
    .filter((sample) => sample.cnrAvailable)
    .map((sample) => sample.avgCnr ?? 0);
  const ageValues = samples.map((sample) => sample.ageMs);
  const gapValues = samples.map((sample) => sample.gaps);
  const hasData = Boolean(latest) || samples.length > 0;
  const availability = samples.length
    ? Math.round(
        (samples.filter((sample) => sample.state === 'streaming').length / samples.length) * 100
      )
    : latest?.state === 'streaming'
      ? 100
      : 0;
  const minScore = samples.length ? Math.min(...scoreValues) : latest?.score ?? 0;
  const constellations = latestLive?.constellations ?? [];
  const sampleDetails =
    latest && 'details' in latest && latest.details && typeof latest.details === 'object'
      ? (latest.details as Record<string, unknown>)
      : null;
  const latencyMs = latestLive?.latencyMs ?? latest?.ageMs ?? null;
  const cycleSlips =
    latestLive?.cycleSlips ??
    (sampleDetails?.cycleSlips === undefined ? null : Number(sampleDetails.cycleSlips));
  const cycleSlipRate =
    latestLive?.cycleSlipRate ??
    (sampleDetails?.cycleSlipRate === undefined ? null : Number(sampleDetails.cycleSlipRate));
  const codePhaseRms =
    latestLive?.codePhaseRmsM ??
    (sampleDetails?.codePhaseRmsM === undefined ? null : Number(sampleDetails.codePhaseRmsM));
  const observations =
    latestLive?.observations ??
    (sampleDetails?.observations === undefined ? null : Number(sampleDetails.observations));
  const skyPlotReason =
    latestLive?.skyPlotReason ??
    (sampleDetails?.skyPlotReason ? String(sampleDetails.skyPlotReason) : null);

  return (
    <div className="quality-embedded">
      <div className="quality-embedded-head">
        <div>
          <h3>Chất lượng RTCM</h3>
          <p className="muted">Điểm số, message type, satellite/cell, CNR, age/gap và cảnh báo.</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void qualityQuery.refetch();
            void messagesQuery.refetch();
            void alertsQuery.refetch();
          }}
          loading={qualityQuery.isFetching}
        >
          Tải lại
        </Button>
      </div>

      {qualityQuery.isError ? (
        <EmptyState
          title="Không tải được dữ liệu chất lượng"
          description="Kiểm tra kết nối Node/Go hoặc quyền quality.view."
          action={<Button onClick={() => qualityQuery.refetch()}>Thử lại</Button>}
        />
      ) : qualityQuery.isLoading ? (
        <div className="chart-empty">Đang tải dữ liệu chất lượng...</div>
      ) : !hasData ? (
        <EmptyState
          title={isStation ? 'Chưa có dữ liệu chất lượng trạm' : 'Chưa có dữ liệu chất lượng relay'}
          description={
            isStation
              ? 'Cần luồng caster ingest hoặc station probe GET-only đang hoạt động.'
              : 'Job relay cần đang chạy để upstream/downstream có dữ liệu.'
          }
        />
      ) : (
        <>
          <div className="quality-detail-head">
            <ScoreDial score={latest?.score ?? 0} state={latest?.state ?? 'unknown'} />
            {latestLive?.scoreParts && (
              <div className="quality-score-parts">
                {Object.entries(latestLive.scoreParts).map(([key, value]) => (
                  <div className="quality-part" key={key}>
                    <span className="muted">{key}</span>
                    <strong className="mono">{value}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="quality-kpis">
            <div>
              <span className="muted">Quality score</span>
              <strong className="mono">{latest?.score ?? 0}</strong>
            </div>
            <div>
              <span className="muted">Availability</span>
              <strong className="mono">{availability}%</strong>
            </div>
            <div>
              <span className="muted">Min score</span>
              <strong className="mono">{minScore}</strong>
            </div>
          </div>

          {!isStation && (
            <Tabs
              value={direction}
              options={[
                { value: 'upstream', label: 'Upstream' },
                { value: 'downstream', label: 'Downstream' }
              ]}
              onChange={(value) => setDirection(value as Direction)}
            />
          )}

          <div className="quality-grid">
            <div className="quality-card">
              <h3>Điểm chất lượng</h3>
              <LineChart values={scoreValues} label="Score" min={0} max={100} />
            </div>
            <div className="quality-card">
              <h3>Satellite</h3>
              <LineChart values={satValues} label="Satellites" min={0} />
            </div>
            <div className="quality-card">
              <h3>CNR</h3>
              <LineChart values={cnrValues} label="Avg CNR" suffix=" dBHz" min={0} />
            </div>
            <div className="quality-card">
              <h3>Age / Gap</h3>
              <LineChart values={ageValues} label="Age" suffix=" ms" min={0} />
              <LineChart values={gapValues} label="Gap" min={0} />
            </div>
          </div>

          <div className="quality-card">
            <h3>Constellation breakdown</h3>
            {constellations.length === 0 ? (
              <p className="muted">Chưa có breakdown theo chòm sao.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Chòm</th>
                      <th className="align-right">Vệ tinh</th>
                      <th className="align-right">Signal</th>
                      <th className="align-right">Cell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constellations.map((item) => (
                      <tr key={item.system}>
                        <td>{item.system}</td>
                        <td className="align-right mono">{item.satellites}</td>
                        <td className="align-right mono">{item.signals}</td>
                        <td className="align-right mono">{item.cells}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="quality-grid">
            <div className="quality-card">
              <h3>Latency</h3>
              <strong className="quality-metric">
                {latencyMs === null ? '—' : `${formatNumber(latencyMs)} ms`}
              </strong>
              <p className="muted">
                Tuổi dữ liệu RTCM gần nhất; điểm latency{' '}
                {latestLive?.scoreParts?.latency ?? '—'}/5.
              </p>
            </div>
            <div className="quality-card">
              <h3>Cycle slip</h3>
              <strong className="quality-metric">
                {cycleSlips === null ? '—' : formatNumber(cycleSlips)}
              </strong>
              <p className="muted">
                {cycleSlipRate === null
                  ? 'Chưa có MSM4/7 observation để đối chiếu phase.'
                  : `${formatNumber(cycleSlipRate)}% trên ${formatNumber(
                      observations ?? 0
                    )} observation.`}
              </p>
            </div>
            <div className="quality-card">
              <h3>Code &amp; Phase RMS</h3>
              <strong className="quality-metric">
                {codePhaseRms === null ? '—' : `${formatNumber(codePhaseRms)} m`}
              </strong>
              <p className="muted">
                RMS biến thiên code-phase giữa các epoch MSM; cần ít nhất 2 epoch.
              </p>
            </div>
            <div className="quality-card">
              <h3>Sky Plot</h3>
              <SkyPlot
                points={latestLive?.skyPlot ?? []}
                reason={
                  skyPlotReason ||
                  'Chưa có ephemeris 1019/1020/1045/1046 để tính azimuth/elevation.'
                }
              />
              <p className="muted">
                Không vẽ vị trí giả khi nguồn không phát ephemeris.
              </p>
            </div>
          </div>

          <div className="quality-grid two">
            <div className="quality-card">
              <h3>Message type / rate</h3>
              <BarChart data={messageData} label="Message type" />
            </div>
            <div className="quality-card">
              <h3>Metadata</h3>
              <dl className="quality-meta">
                <dt>Station ID</dt>
                <dd className="mono">{latest?.reportedStationId ?? '—'}</dd>
                <dt>ARP ECEF</dt>
                <dd className="mono">
                  {latest?.arpX !== undefined && latest?.arpX !== null
                    ? `${latest.arpX} / ${latest.arpY} / ${latest.arpZ}`
                    : '—'}
                </dd>
                <dt>ARP jump</dt>
                <dd className="mono">
                  {latest?.arpDeltaM !== undefined && latest?.arpDeltaM !== null
                    ? `${formatNumber(latest.arpDeltaM)} m`
                    : '—'}
                </dd>
                <dt>Antenna</dt>
                <dd>{latest?.antenna || '—'}</dd>
                <dt>Metadata</dt>
                <dd>
                  {latestLive
                    ? latestLive.metadataOk
                      ? 'Đủ 1005/1006'
                      : 'Thiếu 1005/1006'
                    : '—'}
                </dd>
                <dt>Sat / Cell</dt>
                <dd className="mono">
                  {latest?.satellites ?? '—'} / {latest?.cells ?? '—'}
                </dd>
              </dl>
            </div>
          </div>
        </>
      )}

      <div className="quality-card">
        <h3>Cảnh báo đang mở</h3>
        {alerts.length === 0 ? (
          <p className="muted">Không có cảnh báo đang mở.</p>
        ) : (
          <ul className="quality-alert-list">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <div>
                  <StatusBadge label={alert.level} kind={levelKind(alert.level)} />
                  <strong>{alert.code}</strong>
                  <div className="muted table-subline">
                    {alert.direction} · {formatLocal(alert.lastSeen)} · {alert.eventType}
                  </div>
                  <div className="muted table-subline">
                    First seen {formatLocal(alert.firstSeen)}
                    {alert.ackedAt ? ` · Ack ${formatLocal(alert.ackedAt)}` : ''}
                  </div>
                </div>
                {can('quality', 'ack') && (
                  <IconButton
                    label={`Xác nhận cảnh báo ${alert.id}`}
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(alert)}
                  >
                    <Check size={16} aria-hidden="true" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="quality-foot muted">
        <Activity size={14} aria-hidden="true" />
        <span>
          {isStation ? (
            <RadioTower size={14} aria-hidden="true" />
          ) : (
            <Radio size={14} aria-hidden="true" />
          )}
          {qualityQuery.data?.live?.length ? 'Live Go internal' : 'Lịch sử sample 60s'}
        </span>
        {qualityQuery.data?.parity !== null && qualityQuery.data?.parity !== undefined && (
          <span className="mono">Parity {qualityQuery.data.parity}%</span>
        )}
      </div>
    </div>
  );
}
