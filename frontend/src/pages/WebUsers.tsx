import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useListParams } from '../lib/useListParams';
import type { Role, WebUser } from '../types';
import {
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
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface UserList {
  items: WebUser[];
  total: number;
}

interface RoleList {
  items: Role[];
}

const emptyForm = {
  username: '',
  password: '',
  display_name: '',
  email: '',
  role_id: '' as string | number
};

export function WebUsers() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebUser | null>(null);
  const [detail, setDetail] = useState<WebUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const users = useQuery({
    queryKey: ['web-users', page, pageSize, q],
    queryFn: () =>
      apiFetch<UserList>(
        `/api/web-users?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });
  const roles = useQuery({
    queryKey: ['roles', 'options'],
    queryFn: () => apiFetch<RoleList>('/api/roles')
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
          role_id: Number(form.role_id)
        }
      });
    },
    onSuccess: async () => {
      setFormOpen(false);
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

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setFormOpen(true);
  }

  function openEdit(user: WebUser) {
    setEditing(user);
    setForm({
      username: user.username,
      password: '',
      display_name: user.displayName,
      email: user.email,
      role_id: user.role.id
    });
    setError('');
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
          can('web_users', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm tài khoản
            </Button>
          )
        }
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm username, tên, email" />
          <Button variant="ghost" onClick={() => users.refetch()} loading={users.isFetching}>
            Tải lại
          </Button>
        </div>
        <DataTable
          items={users.data?.items ?? []}
          rowKey={(user) => user.id}
          loading={users.isLoading}
          error={users.isError ? 'Không tải được danh sách.' : undefined}
          empty="Chưa có tài khoản."
          onRowClick={setDetail}
          columns={[
            {
              key: 'username',
              header: 'Username',
              cell: (user) => <span className="mono">{user.username}</span>
            },
            { key: 'name', header: 'Tên', cell: (user) => user.displayName },
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
          if (!open) setEditing(null);
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
        <form id="web-user-form" className="form-grid" onSubmit={submit}>
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
    </section>
  );
}
