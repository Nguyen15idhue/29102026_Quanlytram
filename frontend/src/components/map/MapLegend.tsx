const ITEMS = [
  { color: '#1f8a57', label: 'Online' },
  { color: '#b7791f', label: 'Stale' },
  { color: '#c53030', label: 'Offline / lỗi' },
  { color: '#6b7280', label: 'Không xác định / tắt' }
];

export function MapLegend() {
  return (
    <div className="map-legend" aria-label="Chú giải bản đồ">
      {ITEMS.map((item) => (
        <span key={item.label} className="map-legend-item">
          <span className="map-legend-dot" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}
