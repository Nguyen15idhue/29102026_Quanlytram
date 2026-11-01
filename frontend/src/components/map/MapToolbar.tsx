import { Info, Layers, List, Map as MapIcon, Maximize2, SlidersHorizontal } from 'lucide-react';
import { IconButton } from '../ui';

export type MapPanel = 'filter' | 'layers' | 'modes' | 'list' | null;

interface MapToolbarProps {
  panel: MapPanel;
  legendOpen: boolean;
  filterCount: number;
  resultCount: number;
  onToggle: (panel: Exclude<MapPanel, null>) => void;
  onToggleLegend: () => void;
  onFit: () => void;
}

export function MapToolbar({
  panel,
  legendOpen,
  filterCount,
  resultCount,
  onToggle,
  onToggleLegend,
  onFit
}: MapToolbarProps) {
  return (
    <div className="map-toolbar" role="toolbar" aria-label="Công cụ bản đồ">
      <IconButton
        label="Bộ lọc"
        className={panel === 'filter' ? 'active' : ''}
        aria-expanded={panel === 'filter'}
        aria-controls="map-filter-panel"
        onClick={() => onToggle('filter')}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        {filterCount > 0 && <span className="map-tool-badge">{filterCount}</span>}
      </IconButton>

      <IconButton
        label="Lớp bản đồ"
        className={panel === 'layers' ? 'active' : ''}
        aria-expanded={panel === 'layers'}
        aria-controls="map-layers-popover"
        onClick={() => onToggle('layers')}
      >
        <Layers size={18} aria-hidden="true" />
      </IconButton>

      <IconButton
        label="Nền bản đồ"
        className={panel === 'modes' ? 'active' : ''}
        aria-expanded={panel === 'modes'}
        aria-controls="map-modes-popover"
        onClick={() => onToggle('modes')}
      >
        <MapIcon size={18} aria-hidden="true" />
      </IconButton>

      <IconButton
        label="Danh sách trạm"
        className={panel === 'list' ? 'active' : ''}
        aria-expanded={panel === 'list'}
        aria-controls="map-station-list"
        onClick={() => onToggle('list')}
      >
        <List size={18} aria-hidden="true" />
        {resultCount > 0 && (
          <span className="map-tool-badge">{resultCount > 999 ? '999+' : resultCount}</span>
        )}
      </IconButton>

      <IconButton
        label="Chú giải"
        className={legendOpen ? 'active' : ''}
        aria-pressed={legendOpen}
        onClick={onToggleLegend}
      >
        <Info size={18} aria-hidden="true" />
      </IconButton>

      <IconButton label="Fit kết quả" onClick={onFit}>
        <Maximize2 size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
