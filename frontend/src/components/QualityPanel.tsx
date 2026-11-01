import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, RadioTower } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useRealtime } from '../realtime/RealtimeProvider';
import type {
  QualityLiveItem,
  QualitySample,
  SignalCnr,
  SkyPoint
} from '../types';
import { Button, EmptyState, Select } from './ui';
import {
  ScoreDial,
  SkyPlot,
  SnrBars,
  bandColor,
  formatInteger,
  formatNumber,
  systemPrefix
} from './charts';

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

interface QualityPanelProps {
  targetType: TargetType;
  targetId: number;
  mountpointId?: number;
}

const PARTS: Array<{ key: string; label: string; max: number }> = [
  { key: 'transport', label: 'Transport', max: 25 },
  { key: 'integrity', label: 'Toàn vẹn', max: 20 },
  { key: 'msm', label: 'MSM', max: 25 },
  { key: 'metadata', label: 'Metadata', max: 15 },
  { key: 'signal', label: 'Tín hiệu', max: 10 },
  { key: 'latency', label: 'Độ trễ', max: 5 }
];

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

function detailRecord(value: LatestQuality | null): Record<string, unknown> | null {
  if (!value || !('details' in value)) return null;
  const details = value.details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
}

function BandLegend({ items }: { items: SignalCnr[] }) {
  const bands = [...new Set(items.map((item) => item.band))];
  if (bands.length === 0) return null;
  return (
    <div className="band-legend">
      {bands.map((band) => (
        <span className="legend-item" key={band}>
          <i className="legend-dot" style={{ background: bandColor(band) }} /> {band}
        </span>
      ))}
    </div>
  );
}

export function QualityPanel({ targetType, targetId, mountpointId }: QualityPanelProps) {
  const isStation = targetType === 'station';
  const { quality } = useRealtime();
  const [direction, setDirection] = useState<Direction>(isStation ? 'ingest' : 'upstream');

  useEffect(() => {
    setDirection(isStation ? 'ingest' : 'upstream');
  }, [isStation, targetId]);

  const qualityQuery = useQuery({
    queryKey: ['quality-detail', targetType, targetId, mountpointId, direction],
    queryFn: () =>
      isStation
        ? apiFetch<QualityResponse>(
            `/api/stations/${targetId}/quality?window=60${
              mountpointId ? `&mountpointId=${mountpointId}` : ''
            }`
          )
        : apiFetch<QualityResponse>(
            `/api/relay-jobs/${targetId}/quality?window=60&direction=${direction}`
          ),
    refetchInterval: 15_000
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
  const details = detailRecord(latest);
  const scoreParts =
    latestLive?.scoreParts ??
    (details?.scoreParts && typeof details.scoreParts === 'object'
      ? (details.scoreParts as Record<string, number>)
      : null);
  const skyPlot: SkyPoint[] = latestLive?.skyPlot ?? [];
  const signalsCnr: SignalCnr[] = latestLive?.signalsCnr ?? [];
  const satelliteRows = useMemo(() => {
    const skyKeys = new Set(skyPlot.map((point) => `${point.system}:${point.satellite}`));
    const map = new Map<
      string,
      {
        system: string;
        satellite: number;
        bands: Set<string>;
        maxCnr: number;
        hasSky: boolean;
      }
    >();
    for (const item of signalsCnr) {
      const key = `${item.system}:${item.satellite}`;
      const row =
        map.get(key) ??
        {
          system: item.system,
          satellite: item.satellite,
          bands: new Set<string>(),
          maxCnr: 0,
          hasSky: skyKeys.has(key)
        };
      row.bands.add(item.band);
      row.maxCnr = Math.max(row.maxCnr, item.cnr);
      map.set(key, row);
    }
    return [...map.values()].sort(
      (a, b) => a.system.localeCompare(b.system) || a.satellite - b.satellite
    );
  }, [signalsCnr, skyPlot]);
  const skyPlotReason = latestLive?.skyPlotReason;
  const hasData = Boolean(latest) || samples.length > 0;

  return (
    <div className="quality-embedded">
      <div className="quality-embedded-head">
        <div>
          <h3>Chất lượng RTCM</h3>
          <p className="muted">Sky plot, CNR theo băng và điểm chất lượng hiện tại.</p>
        </div>
        <div className="quality-head-actions">
          {!isStation && (
            <label className="quality-filter">
              <span className="muted">Luồng dữ liệu</span>
              <Select
                aria-label="Chọn luồng chất lượng"
                value={direction}
                onChange={(event) => setDirection(event.target.value as Direction)}
              >
                <option value="upstream">Nguồn (upstream)</option>
                <option value="downstream">Đích (downstream)</option>
              </Select>
            </label>
          )}
          <Button
            variant="ghost"
            onClick={() => qualityQuery.refetch()}
            loading={qualityQuery.isFetching}
          >
            Tải lại
          </Button>
        </div>
      </div>

      {qualityQuery.isError ? (
        <EmptyState
          title="Không tải được dữ liệu chất lượng"
          description={
            qualityQuery.error instanceof ApiClientError
              ? qualityQuery.error.message
              : 'Kiểm tra kết nối Node/Go hoặc quyền quality.view.'
          }
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
          <div className="quality-score-row">
            <ScoreDial score={latest?.score ?? 0} state={latest?.state ?? 'unknown'} />
            <div className="quality-parts">
              {PARTS.map((part) => {
                const value = Number(
                  (scoreParts as Record<string, number> | null)?.[part.key] ?? 0
                );
                return (
                  <div className="quality-part" key={part.key}>
                    <span className="muted">{part.label}</span>
                    <span className="quality-part-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (value / part.max) * 100)}%` }} />
                    </span>
                    <strong className="mono">
                      {value}/{part.max}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="quality-card">
            <h3>Sky plot</h3>
            <SkyPlot points={skyPlot} reason={skyPlotReason} />
            <BandLegend items={signalsCnr} />
          </div>

          <div className="quality-card">
            <h3>CNR theo vệ tinh và băng</h3>
            <SnrBars items={signalsCnr} />
            <BandLegend items={signalsCnr} />
          </div>

          <div className="quality-card">
            <div className="quality-card-head">
              <h3>Vệ tinh đang quan sát</h3>
              <span className="muted">
                {satelliteRows.length} vệ tinh · {signalsCnr.length} tín hiệu
              </span>
            </div>
            {satelliteRows.length === 0 ? (
              <p className="muted">Chưa có CNR theo vệ tinh.</p>
            ) : (
              <div className="sat-list">
                {satelliteRows.map((row) => (
                  <div className="sat-row" key={`${row.system}-${row.satellite}`}>
                    <span className="mono">
                      {systemPrefix(row.system)}
                      {row.satellite}
                    </span>
                    <span className="muted">{[...row.bands].join(' · ')}</span>
                    <strong className="mono">{formatNumber(row.maxCnr)} dBHz</strong>
                    <span className={`badge ${row.hasSky ? 'ok' : 'neutral'}`}>
                      {row.hasSky ? 'sky' : 'chưa có ephemeris'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="quality-foot muted">
            {isStation ? <RadioTower size={14} aria-hidden="true" /> : <Radio size={14} aria-hidden="true" />}
            {latestLive ? 'Live Go internal' : 'Lịch sử sample 60s'}
            {latest?.satellites !== undefined && (
              <span className="mono"> · {formatInteger(latest.satellites)} vệ tinh</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
