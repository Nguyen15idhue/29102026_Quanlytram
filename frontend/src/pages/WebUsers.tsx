import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Pencil, Plus, Trash2, Unlock, Upload } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { bulkMessage, sendBulk } from '../lib/bulk';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { Company, Role, WebUser } from '../types';
import {
  BulkActionBar,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  TableToolbar
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface UserList {
  items: WebUser[];
  total: number;
}

interface RoleList {
  items: Role[];
}

interface CompanyList {
  items: Company[];
}

const emptyForm = {
  username: '',
  password: '',
  display_name: '',
  email: '',
  role_id: '' as string | number,
  company_id: '' as string | number
};

export function WebUsers() {
  const { can, csrfToken, user } = useAuth();
  const isSuper = user?.role.code === 'super_admin';
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const roleId = getParam('roleId');
  const status = getParam('status');
  const companyId = getParam('companyId');
  const activeFilterCount = [roleId, status, isSuper ? companyId : null].filter(Boolean).length;
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (roleId) params.set('roleId', roleId);
    if (status) params.set('status', status);
    if (isSuper && companyId) params.set('companyId', companyId);
    return params.toString();
  }, [page, pageSize, q, roleId, status, companyId, isSuper]);
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<WebUser | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<WebUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebUser | null>(null);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState('');

  const users = useQuery({
    queryKey: ['web-users', listQuery],
    queryFn: () => apiFetch<UserList>(`/api/web-users?${listQuery}`)
  });
  const roles = useQuery({
    queryKey: ['roles', 'options'],
    queryFn: () => apiFetch<RoleList>('/api/roles')
  });
  const companies = useQuery({
    queryKey: ['companies', 'options'],
    queryFn: () => apiFetch<CompanyList>('/api/companies?pageSize=100'),
    enabled: isSuper
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const body: Record<string, unknown> = {
          display_name: form.display_name,
          email: form.email,
          role_id: Number(form.role_id)
        };
        if (form.password) body.password = form.password;
        return apiFetch(`/api/web-users/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/web-users', {
        method: 'POST',
        csrfToken,
        body: {
          username: form.username,
          password: form.password,
          display_name: form.display_name,
          email: form.email,
          role_id: Number(form.role_id),
          ...(isSuper && form.company_id
            ? { company_id: Number(form.company_id) }
            : {})
        }
      });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật tài khoản' : 'Đã thêm tài khoản', 'success');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({ user, action }: { user: WebUser; action: 'lock' | 'unlock' | 'delete' }) =>
      apiFetch(`/api/web-users/${user.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetail(null);
      push('Đã cập nhật tài khoản', 'success');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Thao tác thất bại', 'error')
  });

  const bulk = useMutation({
    mutationFn: (bulkAction: string) =>
      sendBulk('/api/web-users/bulk', bulkAction, [...selected], csrfToken),
    onSuccess: async (result, bulkAction) => {
      setSelected(new Set());
      setBulkDeleteOpen(false);
      setDetail(null);
      push(bulkMessage(result), result.forbidden || result.notFound ? 'error' : 'success');
      if (bulkAction === 'delete') push('Đã xóa các tài khoản đã chọn', 'success');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Thao tác hàng loạt thất bại', 'error')
  });

  useEffect(() => {
    setSelected(new Set());
  }, [page, pageSize, q, roleId, status, companyId]);

  const importUsers = useMutation({
    mutationFn: () =>
      apiFetch<{ created: number; updated: number }>('/api/web-users/import', {
        method: 'POST',
        body: { dataBase64: importData, dryRun: false },
        csrfToken
      }),
    onSuccess: async (result) => {
      push(`Import xong: ${result.created} thêm, ${result.updated} cập nhật`, 'success');
      setImportData('');
      if (importRef.current) importRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Import thất bại', 'error')
  });

  function handleImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      setImportData(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  }

  async function exportUsers() {
    const response = await fetch('/api/web-users/export', { credentials: 'include' });
    if (!response.ok) {
      push('Export thất bại', 'error');
      return;
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `web-users-${Date.now()}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(user: WebUser) {
    setEditing(user);
    setForm({
      username: user.username,
      password: '',
      display_name: user.displayName,
      email: user.email,
      role_id: user.role.id,
      company_id: user.companyId ?? ''
    });
    setError('');
    setDirty(false);
    setFormOpen(true);
    setDetail(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="page">
      <PageHeader
        title="Người dùng web"
        description="Tài khoản đăng nhập UI, tách biệt với tài khoản NTRIP."
        actions={
          <div className="toolbar">
            {can('web_users', 'view') && (
              <Button variant="ghost" onClick={() => void exportUsers()}>
                <Download size={16} aria-hidden="true" /> Excel
              </Button>
            )}
            {can('web_users', 'add') && (
              <>
                <input
                  ref={importRef}
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(event) => handleImportFile(event.target.files?.[0] ?? null)}
                />
                <Button variant="ghost" onClick={() => importRef.current?.click()}>
                  <Upload size={16} aria-hidden="true" /> Import
                </Button>
                {importData && (
                  <Button
                    variant="ghost"
                    loading={importUsers.isPending}
                    onClick={() => importUsers.mutate()}
                  >
                    Ghi import
                  </Button>
                )}
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={16} aria-hidden="true" /> Thêm tài khoản
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="panel">
        <TableToolbar
          search={
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Tìm username, tên, email"
            />
          }
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => users.refetch()} loading={users.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Vai trò">
            <Select
              value={roleId}
              onChange={(event) => setParam('roleId', event.target.value || null)}
            >
              <option value="">Mọi vai trò</option>
              {(roles.data?.items ?? []).map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trạng thái">
            <Select
              value={status}
              onChange={(event) => setParam('status', event.target.value || null)}
            >
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="locked">Đã khóa</option>
            </Select>
          </Field>
          {isSuper && (
            <Field label="Công ty">
              <Select
                value={companyId}
                onChange={(event) => setParam('companyId', event.target.value || null)}
              >
                <option value="">Tất cả công ty</option>
                {(companies.data?.items ?? []).map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </TableToolbar>
        <BulkActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          actions={[
            ...(can('web_users', 'edit')
              ? [
                  { label: 'Khóa', onClick: () => bulk.mutate('lock') },
                  { label: 'Mở khóa', onClick: () => bulk.mutate('unlock') }
                ]
              : []),
            ...(can('web_users', 'delete')
              ? [
                  {
                    label: 'Xóa',
                    variant: 'danger' as const,
                    onClick: () => setBulkDeleteOpen(true)
                  }
                ]
              : [])
          ]}
        />
        <DataTable
          items={users.data?.items ?? []}
          rowKey={(user) => user.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          selectionLabel={(user) => `tài khoản ${user.username}`}
          loading={users.isLoading}
          error={users.isError ? 'Không tải được danh sách.' : undefined}
          empty="Chưa có tài khoản."
          columns={[
            {
              key: 'username',
              header: 'Username',
              cell: (user) => (
                <button type="button" className="link-btn mono" onClick={() => setDetail(user)}>
                  {user.username}
                </button>
              )
            },
            {
              key: 'name',
              header: 'Tên',
              cell: (user) => (
                <div>
                  <div>{user.displayName}</div>
                  <div className="muted table-subline">{user.email || '—'}</div>
                </div>
              )
            },
            {
              key: 'role',
              header: 'Vai trò',
              hideOnMobile: true,
              cell: (user) => (
                <>
                  {user.role.name} <span className="muted">({user.role.code})</span>
                </>
              )
            },
            {
              key: 'company',
              header: 'Công ty',
              hideOnMobile: true,
              cell: (user) => (
                <span className="muted">
                  {user.companyName ?? (user.companyId ? `#${user.companyId}` : '—')}
                </span>
              )
            },
            {
              key: 'lastLogin',
              header: 'Đăng nhập cuối',
              hideOnMobile: true,
              cell: (user) => (
                <span className="mono muted">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('vi-VN')
                    : 'Chưa đăng nhập'}
                </span>
              )
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (user) => (
                <StatusBadge
                  label={user.status ?? 'active'}
                  kind={user.status === 'active' ? 'ok' : 'warn'}
                />
              )
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (user) => (
                <div className="row-actions">
                  {can('web_users', 'edit') && (
                    <>
                      <IconButton
                        label={`Sửa ${user.username}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(user);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={user.status === 'active' ? `Khóa ${user.username}` : `Mở khóa ${user.username}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({
                            user,
                            action: user.status === 'active' ? 'lock' : 'unlock'
                          });
                        }}
                      >
                        {user.status === 'active' ? <Lock size={16} aria-hidden="true" /> : <Unlock size={16} aria-hidden="true" />}
                      </IconButton>
                    </>
                  )}
                  {can('web_users', 'delete') && (
                    <IconButton
                      label={`Xóa ${user.username}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(user);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              )
            }
          ]}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={users.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setDirty(false);
            setEditing(null);
          }
        }}
        title={editing ? 'Sửa tài khoản web' : 'Thêm tài khoản web'}
        description="Tài khoản dùng session cookie để đăng nhập UI."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="web-user-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Tạo'}
            </Button>
          </>
        }
      >
        <form
          id="web-user-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <Field label="Username" error={error || undefined}>
            <Input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              disabled={Boolean(editing)}
              required
            />
          </Field>
          <Field label={editing ? 'Mật khẩu mới (bỏ trống để giữ)' : 'Mật khẩu'}>
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required={!editing}
            />
          </Field>
          <Field label="Tên hiển thị">
            <Input
              value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Vai trò">
            <Select
              value={form.role_id}
              onChange={(event) => setForm({ ...form, role_id: event.target.value })}
              required
            >
              <option value="">Chọn role</option>
              {roles.data?.items.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.code})
                </option>
              ))}
            </Select>
          </Field>
          {isSuper && (
            <Field label="Công ty">
              <Select
                value={form.company_id}
                onChange={(event) => setForm({ ...form, company_id: event.target.value })}
                disabled={Boolean(editing)}
              >
                <option value="">Chọn công ty</option>
                {(companies.data?.items ?? []).map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.displayName ?? 'Chi tiết tài khoản'}
        description={detail?.username}
        side="right"
        footer={
          detail && (
            <>
              {can('web_users', 'edit') && (
                <Button onClick={() => openEdit(detail)}>
                  <Pencil size={16} aria-hidden="true" /> Sửa
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Đóng
              </Button>
            </>
          )
        }
      >
        {detail && (
          <dl className="facts">
            <div>
              <dt>Username</dt>
              <dd className="mono">{detail.username}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{detail.email || '—'}</dd>
            </div>
            <div>
              <dt>Vai trò</dt>
              <dd>
                {detail.role.name} ({detail.role.code})
              </dd>
            </div>
            <div>
              <dt>Công ty</dt>
              <dd>{detail.companyName ?? (detail.companyId ? `#${detail.companyId}` : '—')}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>{detail.status ?? 'active'}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa tài khoản?"
        description={`Tài khoản ${deleteTarget?.username ?? ''} sẽ bị xóa.`}
        pending={action.isPending}
        onConfirm={() => deleteTarget && action.mutate({ user: deleteTarget, action: 'delete' })}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Xóa các tài khoản đã chọn?"
        description={`${selected.size} tài khoản sẽ bị xóa. Hành động này không thể hoàn tác.`}
        pending={bulk.isPending}
        onConfirm={() => bulk.mutate('delete')}
      />
    </section>
  );
}
