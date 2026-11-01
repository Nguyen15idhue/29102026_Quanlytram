import { useEffect, useState } from 'react';
import { RotateCcw, Scan } from 'lucide-react';
import { Button, Field, SearchInput, Select } from '../ui';

export interface MapFilterState {
  q: string;
  layer: string;
  transport: string;
  status: string;
  region: string;
  owner: string;
  hasCoords: string;
}

interface MapFilterPanelProps {
  state: MapFilterState;
  layers: Array<{ value: string; label: string }>;
  regions: string[];
  owners: Array<{ id: number; name: string }>;
  onChange: (patch: Partial<MapFilterState>) => void;
  onReset: () => void;
  onFit: () => void;
}

const TRANSPORTS = [
  { value: '', label: 'Mọi trạng thái truyền' },
  { value: 'online', label: 'Online' },
  { value: 'stale', label: 'Stale' },
  { value: 'no_data', label: 'Không có dữ liệu' },
  { value: 'offline', label: 'Offline' },
  { value: 'error', label: 'Lỗi' },
  { value: 'unknown', label: 'Không xác định' }
];

const STATUSES = [
  { value: '', label: 'Mọi trạng thái trạm' },
  { value: 'active', label: 'Đang bật' },
  { value: 'disabled', label: 'Đã tắt' },
  { value: 'locked', label: 'Đã khoá' }
];

export function MapFilterPanel({
  state,
  layers,
  regions,
  owners,
  onChange,
  onReset,
  onFit
}: MapFilterPanelProps) {
  const [search, setSearch] = useState(state.q);

  useEffect(() => {
    setSearch(state.q);
  }, [state.q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== state.q) onChange({ q: search });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, state.q, onChange]);

  return (
    <div className="map-filter-panel">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Tìm trạm, ID, vùng, địa chỉ, owner"
      />

      <div className="map-filter-grid">
        <Field label="Layer">
          <Select
            aria-label="Layer bản đồ"
            value={state.layer}
            onChange={(event) => onChange({ layer: event.target.value })}
          >
            {layers.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Truyền dữ liệu">
          <Select
            aria-label="Lọc truyền dữ liệu"
            value={state.transport}
            onChange={(event) => onChange({ transport: event.target.value })}
          >
            {TRANSPORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Trạng thái trạm">
          <Select
            aria-label="Lọc trạng thái trạm"
            value={state.status}
            onChange={(event) => onChange({ status: event.target.value })}
          >
            {STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Vùng">
          <Select
            aria-label="Lọc vùng"
            value={state.region}
            onChange={(event) => onChange({ region: event.target.value })}
          >
            <option value="">Mọi vùng</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Owner">
          <Select
            aria-label="Lọc owner"
            value={state.owner}
            onChange={(event) => onChange({ owner: event.target.value })}
          >
            <option value="">Mọi owner</option>
            {owners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Toạ độ">
          <Select
            aria-label="Lọc toạ độ"
            value={state.hasCoords}
            onChange={(event) => onChange({ hasCoords: event.target.value })}
          >
            <option value="">Tất cả</option>
            <option value="1">Có toạ độ</option>
            <option value="0">Chưa có toạ độ</option>
          </Select>
        </Field>
      </div>

      <div className="map-actions">
        <Button type="button" onClick={onFit}>
          <Scan size={16} aria-hidden="true" /> Fit kết quả
        </Button>
        <Button type="button" onClick={onReset}>
          <RotateCcw size={16} aria-hidden="true" /> Xoá lọc
        </Button>
      </div>
    </div>
  );
}
