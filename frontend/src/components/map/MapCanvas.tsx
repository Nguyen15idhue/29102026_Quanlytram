import { lazy, Suspense } from 'react';
import { LeafletCanvas, type MapCanvasProps } from './LeafletCanvas';

export type { MapCanvasProps, MapPermissions, MapTempMarker } from './LeafletCanvas';

// MapLibre được tải theo nhu cầu: trang không dùng renderer này không phải tải
// thêm bundle của maplibre-gl.
const MaplibreCanvas = lazy(() =>
  import('./MaplibreCanvas').then((module) => ({ default: module.MaplibreCanvas }))
);

export function MapCanvas(props: MapCanvasProps) {
  if (props.config.renderer !== 'maplibre') {
    return <LeafletCanvas {...props} />;
  }
  return (
    <Suspense
      fallback={<div className="panel map-canvas table-state">Đang tải bản đồ…</div>}
    >
      <MaplibreCanvas {...props} />
    </Suspense>
  );
}
