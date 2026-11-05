import { useEffect, useMemo, useState } from 'react';
import { LeafletCanvas, type MapCanvasProps } from './LeafletCanvas';

export type { MapCanvasProps, MapPermissions, MapTempMarker } from './LeafletCanvas';

type MaplibreModule = typeof import('./MaplibreCanvas');

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(context);
  } catch {
    return false;
  }
}

export function MapCanvas(props: MapCanvasProps) {
  const wantsMaplibre = props.config.renderer === 'maplibre';
  const webgl = useMemo(() => (wantsMaplibre ? webglAvailable() : true), [wantsMaplibre]);
  const [module, setModule] = useState<MaplibreModule | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const { onFallback, ...canvasProps } = props;

  // Đổi renderer thì xoá lỗi cũ để có thể thử lại.
  useEffect(() => {
    setFatal(null);
  }, [wantsMaplibre]);

  useEffect(() => {
    if (!wantsMaplibre || !webgl || module) return;
    let alive = true;
    import('./MaplibreCanvas')
      .then((loaded) => {
        if (alive) setModule(loaded);
      })
      .catch(() => {
        if (alive) setFatal('Không tải được thư viện MapLibre');
      });
    return () => {
      alive = false;
    };
  }, [wantsMaplibre, webgl, module]);

  const fallbackReason = !wantsMaplibre
    ? null
    : !webgl
      ? 'Trình duyệt không hỗ trợ WebGL'
      : fatal;

  useEffect(() => {
    onFallback?.(fallbackReason);
  }, [fallbackReason, onFallback]);

  if (!wantsMaplibre || fallbackReason) {
    return <LeafletCanvas {...canvasProps} />;
  }

  if (!module) {
    return <div className="panel map-canvas table-state">Đang tải bản đồ…</div>;
  }

  const MaplibreCanvas = module.MaplibreCanvas;
  return <MaplibreCanvas {...canvasProps} onFatal={setFatal} />;
}
