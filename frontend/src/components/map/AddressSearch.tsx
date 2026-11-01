import { useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Input } from '../ui';

export interface AddressResult {
  label: string;
  lat: number;
  lon: number;
}

interface AddressSearchProps {
  onPick: (item: AddressResult) => void;
}

interface SearchResponse {
  items?: AddressResult[];
  warning?: string;
}

export function AddressSearch({ onPick }: AddressSearchProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setItems([]);
      setNotice(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setNotice(null);
      try {
        const response = await fetch(
          `/api/geo/search?q=${encodeURIComponent(trimmed)}&limit=5`,
          { credentials: 'include', signal: controller.signal }
        );
        const data = (await response.json().catch(() => ({}))) as SearchResponse;
        if (!response.ok) {
          setItems([]);
          setNotice('Không tìm được địa chỉ. Bạn vẫn có thể tìm trạm bình thường.');
          return;
        }
        setItems(data.items ?? []);
        setOpen(true);
        if (!data.items || data.items.length === 0) {
          setNotice(
            data.warning === 'missing_key'
              ? 'Chưa cấu hình tìm địa chỉ. Bạn vẫn có thể tìm trạm bình thường.'
              : 'Không tìm thấy địa chỉ phù hợp.'
          );
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setItems([]);
          setNotice('Không tìm được địa chỉ. Bạn vẫn có thể tìm trạm bình thường.');
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="address-search" ref={containerRef}>
      <label className="field-label" htmlFor="map-address-search">
        Tìm địa chỉ
      </label>
      <div className="address-input">
        <Search size={16} aria-hidden="true" />
        <Input
          id="map-address-search"
          value={text}
          placeholder="Nhập địa chỉ (>= 3 ký tự)"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setOpen(items.length > 0)}
        />
      </div>
      {loading && <p className="muted tiny-text">Đang tìm địa chỉ...</p>}
      {notice && !loading && <p className="muted tiny-text">{notice}</p>}
      {open && items.length > 0 && (
        <ul className="address-results">
          {items.map((item) => (
            <li key={`${item.label}-${item.lat}-${item.lon}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(item);
                  setText(item.label);
                  setOpen(false);
                }}
              >
                <MapPin size={14} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
