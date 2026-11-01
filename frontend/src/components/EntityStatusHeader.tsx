import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
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
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="entity-status">
      <div className="entity-status-time">
        <span className="muted">
          <Clock3 size={14} aria-hidden="true" /> Hiện tại
        </span>
        <strong className="mono">{formatNow(now)}</strong>
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
