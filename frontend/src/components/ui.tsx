import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react';

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const label = nodeText(children);
  const actionClass =
    /^(Tải lại|Làm mới)/i.test(label.trim()) && variant === 'ghost'
      ? 'action-refresh'
      : '';
  return (
    <button
      className={`btn ${variant} ${size === 'sm' ? 'small' : ''} ${actionClass} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`.trim()} {...props} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Tìm kiếm'
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLocal(value);
  }, [value]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [local, onChange, value]);
  return (
    <div className="search-input">
      <Search size={16} aria-hidden="true" />
      <input
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function TableToolbar({
  search,
  actions,
  children,
  activeFilterCount = 0
}: {
  search?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  activeFilterCount?: number;
}) {
  const [open, setOpen] = useState(activeFilterCount > 0);
  return (
    <div className="table-toolbar">
      <div className="table-toolbar-row">
        <div className="table-toolbar-search">{search}</div>
        <div className="toolbar">
          {children && (
            <Button
              variant="ghost"
              size="sm"
              className={`filter-toggle ${open ? 'active' : ''}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Bộ lọc
              {activeFilterCount > 0 && (
                <span className="filter-count">{activeFilterCount}</span>
              )}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={open ? 'chevron-up' : ''}
              />
            </Button>
          )}
          {actions}
        </div>
      </div>
      {children && open && <div className="filter-grid">{children}</div>}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'center',
  size = 'md'
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'center' | 'right';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          className={`modal-content ${side === 'right' ? 'drawer' : ''} size-${size}`}
        >
          <div className="modal-head">
            <div>
              <DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="modal-description">
                {description ?? title}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label="Đóng">
                <X size={18} aria-hidden="true" />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Xóa',
  pending = false,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="modal-overlay" />
        <AlertDialogPrimitive.Content className="modal-content size-sm">
          <div className="confirm-icon">
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <AlertDialogPrimitive.Title className="modal-title">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="modal-description">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="modal-footer">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="ghost">Hủy</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant="danger" loading={pending} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  items,
  rowKey,
  loading = false,
  error,
  empty,
  onRowClick,
  showIndex = true
}: {
  columns: Column<T>[];
  items: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  showIndex?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showIndex && <th className="index-col">STT</th>}
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.align === 'right' ? 'align-right' : ''} ${
                  column.hideOnMobile ? 'hide-mobile' : ''
                } ${column.className ?? ''}`.trim()}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, index) => (
              <tr key={`skeleton-${index}`} className="skeleton-row">
                {showIndex && (
                  <td className="index-col">
                    <span className="skeleton" />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={column.hideOnMobile ? 'hide-mobile' : ''}>
                    <span className="skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading && error && (
            <tr>
              <td colSpan={columns.length + (showIndex ? 1 : 0)}>
                <div className="table-state error">{error}</div>
              </td>
            </tr>
          )}
          {!loading && !error && items.length === 0 && (
            <tr>
              <td colSpan={columns.length + (showIndex ? 1 : 0)}>
                <div className="table-state">{empty ?? 'Chưa có dữ liệu.'}</div>
              </td>
            </tr>
          )}
          {!loading &&
            !error &&
            items.map((row, rowIndex) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'clickable' : ''}
                onClick={(event) => {
                  if (!onRowClick) return;
                  const target = event.target as HTMLElement;
                  if (target.closest('button, a, select, input')) return;
                  onRowClick(row);
                }}
                onKeyDown={(event) => {
                  if (!onRowClick || event.key !== 'Enter') return;
                  const target = event.target as HTMLElement;
                  if (target.closest('button, a, select, input')) return;
                  onRowClick(row);
                }}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {showIndex && <td className="index-col">{rowIndex + 1}</td>}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`${column.align === 'right' ? 'align-right' : ''} ${
                      column.hideOnMobile ? 'hide-mobile' : ''
                    } ${column.className ?? ''}`.trim()}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span className="muted">
        {start}–{end} / {total}
      </span>
      <div className="pagination-controls">
        <select
          className="input page-size"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label="Số dòng mỗi trang"
        >
          <option value={10}>10 / trang</option>
          <option value={20}>20 / trang</option>
          <option value={50}>50 / trang</option>
        </select>
        <IconButton
          label="Trang trước"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
        <span className="mono">
          {page}/{pages}
        </span>
        <IconButton
          label="Trang sau"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

export function StatusBadge({
  label,
  kind = 'neutral'
}: {
  label: string;
  kind?: 'neutral' | 'ok' | 'warn' | 'error' | 'info';
}) {
  return <span className={`badge ${kind}`}>{label}</span>;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`tab ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description && <span className="muted">{description}</span>}
      {action}
    </div>
  );
}
