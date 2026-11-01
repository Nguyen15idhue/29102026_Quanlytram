import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui';

interface TileErrorBannerProps {
  message: string | null;
  onRetry: () => void;
}

export function TileErrorBanner({ message, onRetry }: TileErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="tile-error-banner" role="alert" data-testid="tile-error-banner">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>{message}</span>
      <Button type="button" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" /> Thử lại
      </Button>
    </div>
  );
}
