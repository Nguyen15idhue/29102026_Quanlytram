import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Pencil, Plus, Trash2, Unlock, Upload } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
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
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<WebUser | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<WebUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState('');

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
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'ÄĂ£ cáº­p nháº­t tĂ i khoáº£n' : 'ÄĂ£ thĂªm tĂ i khoáº£n', 'success');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'LÆ°u tháº¥t báº¡i')
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
      push('ÄĂ£ cáº­p nháº­t tĂ i khoáº£n', 'success');
      await queryClient.invalidateQueries({ queryKey: ['web-users'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Thao tĂ¡c tháº¥t báº¡i', 'error')
  });

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
      role_id: user.role.id
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
        title="NgÆ°á»i dĂ¹ng web"
        description="TĂ i khoáº£n Ä‘Äƒng nháº­p UI, tĂ¡ch biá»‡t vá»›i tĂ i khoáº£n NTRIP."
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
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="TĂ¬m username, tĂªn, email" />
          <Button variant="ghost" onClick={() => users.refetch()} loading={users.isFetching}>
            Táº£i láº¡i
          </Button>
        </div>
        <DataTable
          items={users.data?.items ?? []}
          rowKey={(user) => user.id}
          loading={users.isLoading}
          error={users.isError ? 'KhĂ´ng táº£i Ä‘Æ°á»£c danh sĂ¡ch.' : undefined}
          empty="ChÆ°a cĂ³ tĂ i khoáº£n."
          onRowClick={setDetail}
          columns={[
            {
              key: 'username',
              header: 'Username',
              cell: (user) => <span className="mono">{user.username}</span>
            },
            { key: 'name', header: 'TĂªn', cell: (user) => user.displayName },
            {
              key: 'role',
              header: 'Vai trĂ²',
              hideOnMobile: true,
              cell: (user) => (
                <>
                  {user.role.name} <span className="muted">({user.role.code})</span>
                </>
              )
            },
            {
              key: 'status',
              header: 'Tráº¡ng thĂ¡i',
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
                        label={`Sá»­a ${user.username}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(user);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={user.status === 'active' ? `KhĂ³a ${user.username}` : `Má»Ÿ khĂ³a ${user.username}`}
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
                      label={`XĂ³a ${user.username}`}
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
        title={editing ? 'Sá»­a tĂ i khoáº£n web' : 'ThĂªm tĂ i khoáº£n web'}
        description="TĂ i khoáº£n dĂ¹ng session cookie Ä‘á»ƒ Ä‘Äƒng nháº­p UI."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Há»§y
            </Button>
            <Button variant="primary" type="submit" form="web-user-form" loading={save.isPending}>
              {editing ? 'Cáº­p nháº­t' : 'Táº¡o'}
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
          <Field label={editing ? 'Máº­t kháº©u má»›i (bá» trá»‘ng Ä‘á»ƒ giá»¯)' : 'Máº­t kháº©u'}>
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required={!editing}
            />
          </Field>
          <Field label="TĂªn hiá»ƒn thá»‹">
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
          <Field label="Vai trĂ²">
            <Select
              value={form.role_id}
              onChange={(event) => setForm({ ...form, role_id: event.target.value })}
              required
            >
              <option value="">Chá»n role</option>
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
        title={detail?.displayName ?? 'Chi tiáº¿t tĂ i khoáº£n'}
        description={detail?.username}
        side="right"
        footer={
          detail && (
            <>
              {can('web_users', 'edit') && (
                <Button onClick={() => openEdit(detail)}>
                  <Pencil size={16} aria-hidden="true" /> Sá»­a
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDetail(null)}>
                ÄĂ³ng
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
              <dd>{detail.email || 'â€”'}</dd>
            </div>
            <div>
              <dt>Vai trĂ²</dt>
              <dd>
                {detail.role.name} ({detail.role.code})
              </dd>
            </div>
            <div>
              <dt>Tráº¡ng thĂ¡i</dt>
              <dd>{detail.status ?? 'active'}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="XĂ³a tĂ i khoáº£n?"
        description={`TĂ i khoáº£n ${deleteTarget?.username ?? ''} sáº½ bá»‹ xĂ³a.`}
        pending={action.isPending}
        onConfirm={() => deleteTarget && action.mutate({ user: deleteTarget, action: 'delete' })}
      />
    </section>
  );
}
