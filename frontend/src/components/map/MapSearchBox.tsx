import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { IconButton, Input } from '../ui';

export interface AddressResult {
  label: string;
  lat: number;
  lon: number;
}

interface MapSearchBoxProps {
  value: string;
  onSearch: (q: string) => void;
  onPickAddress: (item: AddressResult) => void;
}

interface SearchResponse {
  items?: AddressResult[];
  warning?: string;
}

export function MapSearchBox({ value, onSearch, onPickAddress }: MapSearchBoxProps) {
  const [text, setText] = useState(value);
  const [items, setItems] = useState<AddressResult[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed !== value) {
      const timer = window.setTimeout(() => onSearch(trimmed), 300);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [text, value, onSearch]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setItems([]);
      setNotice(null);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
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
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setOpen(nextItems.length > 0);
        if (nextItems.length === 0) {
          setNotice(
            data.warning === 'missing_key'
              ? 'Chưa cấu hình tìm địa chỉ. Bạn vẫn có thể tìm trạm bình thường.'
              : null
          );
        } else {
          setNotice(null);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setItems([]);
          setNotice('Không tìm được địa chỉ. Bạn vẫn có thể tìm trạm bình thường.');
        }
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

  function clear() {
    setText('');
    setItems([]);
    setNotice(null);
    setOpen(false);
    onSearch('');
  }

  return (
    <div className="map-search-box" ref={containerRef}>
      <Search size={16} aria-hidden="true" className="map-search-icon" />
      <Input
        aria-label="Tìm trạm hoặc địa chỉ"
        value={text}
        placeholder="Tìm trạm hoặc địa chỉ..."
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setOpen(items.length > 0)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter' && items.length > 0) {
            event.preventDefault();
            onPickAddress(items[0]);
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-controls="map-search-results"
      />
      {text && (
        <IconButton label="Xoá tìm kiếm" onClick={clear} className="map-search-clear">
          <X size={14} aria-hidden="true" />
        </IconButton>
      )}

      {open && items.length > 0 && (
        <ul id="map-search-results" className="map-search-results" role="listbox">
          <li className="map-search-group" role="presentation">
            Địa chỉ
          </li>
          {items.map((item) => (
            <li key={`${item.label}-${item.lat}-${item.lon}`} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onPickAddress(item);
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
      {notice && !open && <p className="map-search-notice">{notice}</p>}
    </div>
  );
}
