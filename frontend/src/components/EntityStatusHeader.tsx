import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { useRealtime } from '../realtime/RealtimeProvider';
import { StatusBadge } from './ui';

export interface EntityStatusBadge {
  label: string;
  value: string;
  kind: 'ok' | 'warn' | 'error' | 'neutral';
}

function formatNow(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(value);
}

export function EntityStatusHeader({ badges }: { badges: EntityStatusBadge[] }) {
  const { snapshot, connected } = useRealtime();
  const serverOffsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!snapshot?.ts) return;
    const serverTs = Date.parse(snapshot.ts);
    if (!Number.isNaN(serverTs)) serverOffsetRef.current = serverTs - Date.now();
  }, [snapshot?.ts]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const display = new Date(now + serverOffsetRef.current);
  return (
    <div className="entity-status">
      <div className="entity-status-time">
        <span className="muted">
          <Clock3 size={14} aria-hidden="true" /> Hiện tại
        </span>
        <strong
          className="mono"
          title={connected ? 'Đồng bộ realtime qua socket' : 'Mất kết nối realtime'}
        >
          {formatNow(display)}
        </strong>
      </div>
      <div className="entity-status-badges">
        {badges.map((badge) => (
          <div className="entity-status-badge" key={badge.label}>
            <span className="muted">{badge.label}</span>
            <StatusBadge label={badge.value} kind={badge.kind} />
          </div>
        ))}
      </div>
    </div>
  );
}
