import type { MapOverviewResponse } from '../../types';
import { AccountPin } from './AccountPin';

interface MapLegendProps {
  stationCounts?: MapOverviewResponse['counts']['stationStatus'];
  accountCounts?: MapOverviewResponse['counts']['accountStatus'];
  showAccounts?: boolean;
}

const COLORS = {
  green: '#15803d',
  amber: '#d97706',
  orange: '#ea580c',
  red: '#dc2626',
  darkRed: '#991b1b',
  blue: '#2563eb',
  gray: '#6b7280'
} as const;

interface LegendItem {
  key: string;
  label: string;
  count?: number;
  color: string;
  shape?: 'dot' | 'user';
}

function renderItems(items: LegendItem[]) {
  return items.map((item) => (
    <span key={item.key} className="map-legend-item">
      {item.shape === 'user' ? (
        <AccountPin color={item.color} size={20} />
      ) : (
        <span
          className="map-legend-dot"
          style={{ background: item.color }}
          aria-hidden="true"
        />
      )}
      <span>{item.label}</span>
      {item.count !== undefined && (
        <span className="map-legend-count">{item.count}</span>
      )}
    </span>
  ));
}

export function MapLegend({ stationCounts, accountCounts, showAccounts = false }: MapLegendProps) {
  const stationItems: LegendItem[] = [
    { key: 'online', label: 'Online', count: stationCounts?.online, color: COLORS.green },
    { key: 'stale', label: 'Stale', count: stationCounts?.stale, color: COLORS.amber },
    {
      key: 'no_data',
      label: 'Không có dữ liệu',
      count: stationCounts?.no_data,
      color: COLORS.orange
    },
    {
      key: 'offline',
      label: 'Offline / lỗi',
      count:
        stationCounts === undefined
          ? undefined
          : (stationCounts.offline ?? 0) + (stationCounts.error ?? 0),
      color: COLORS.red
    },
    {
      key: 'unknown',
      label: 'Không xác định',
      count: stationCounts?.unknown,
      color: COLORS.gray
    }
  ];

  const accountItems: LegendItem[] = [
    { key: 'single', label: 'Single', count: accountCounts?.single, color: COLORS.red, shape: 'user' },
    { key: 'fixed', label: 'Fixed', count: accountCounts?.fixed, color: COLORS.green, shape: 'user' },
    { key: 'float', label: 'Float', count: accountCounts?.float, color: COLORS.amber, shape: 'user' },
    { key: 'rtd', label: 'RTD', count: accountCounts?.rtd, color: COLORS.blue, shape: 'user' },
    { key: 'error', label: 'Lỗi', count: accountCounts?.error, color: COLORS.darkRed, shape: 'user' }
  ];

  return (
    <div className="map-legend-groups" aria-label="Chú giải trạng thái">
      <div className="map-legend-group">
        <div className="map-legend-title">Trạm</div>
        {renderItems(stationItems)}
      </div>
      {showAccounts && (
        <div className="map-legend-group">
          <div className="map-legend-title">Tài khoản</div>
          {renderItems(accountItems)}
        </div>
      )}
    </div>
  );
}
