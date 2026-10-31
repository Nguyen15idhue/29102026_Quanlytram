import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { Mountpoint, NtripAccount } from '../types';
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
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface AccountList {
  items: NtripAccount[];
  total: number;
}

interface MountpointList {
  items: Mountpoint[];
}

const emptyForm = {
  username: '', password: '', enabled: true, max_connections: 1,
  company: '', contact_name: '', email: '', phone: '',
  valid_from: '', valid_to: '', available_area: '', auth_method: 'basic', notes: ''
};

export function NtripAccounts() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ } = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<NtripAccount | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [detail, setDetail] = useState<NtripAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NtripAccount | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [aclIds, setAclIds] = useState<number[]>([]);

  const list = useQuery({
    queryKey: ['ntrip-accounts', page, pageSize, q],
    queryFn: () =>
      apiFetch<AccountList>(
        `/api/ntrip-accounts?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`
      )
  });
  const mountpoints = useQuery({
    queryKey: ['mountpoints', 'options'],
    queryFn: () => apiFetch<MountpointList>('/api/mountpoints?pageSize=50'),
    enabled: Boolean(detail) && can('mountpoints', 'view')
  });
  const acl = useQuery({
    queryKey: ['ntrip-acl', detail?.id],
    queryFn: () => apiFetch<MountpointList>(`/api/ntrip-accounts/${detail?.id}/mountpoints`),
    enabled: Boolean(detail)
  });

  useEffect(() => {
    if (acl.data) setAclIds(acl.data.items.map((item) => item.id));
  }, [acl.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        username: form.username,
        enabled: form.enabled,
        max_connections: Number(form.max_connections),
        company: form.company,
        contact_name: form.contact_name,
        email: form.email,
        phone: form.phone,
        valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
        valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
        available_area: form.available_area,
        auth_method: form.auth_method,
        notes: form.notes
      };
      if (form.password) body.password = form.password;
      if (editing) {
        return apiFetch(`/api/ntrip-accounts/${editing.id}`, { method: 'PATCH', body, csrfToken });
      }
      return apiFetch('/api/ntrip-accounts', { method: 'POST', body, csrfToken });
    },
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật tài khoản NTRIP' : 'Đã thêm tài khoản NTRIP', 'success');
      await queryClient.invalidateQueries({ queryKey: ['ntrip-accounts'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu thất bại')
  });

  const action = useMutation({
    mutationFn: ({ account, action }: { account: NtripAccount; action: 'lock' | 'unlock' | 'delete' }) =>
      apiFetch(`/api/ntrip-accounts/${account.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        csrfToken
      }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDetail(null);
      push('Đã cập nhật tài khoản NTRIP', 'success');
      await queryClient.invalidateQueries({ queryKey: ['ntrip-accounts'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Thao tác thất bại', 'error')
  });

  const saveAcl = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ntrip-accounts/${detail?.id}/mountpoints`, {
        method: 'PUT',
        body: { mountpointIds: aclIds },
        csrfToken
      }),
    onSuccess: async () => {
      push('Đã lưu ACL mountpoint', 'success');
      await queryClient.invalidateQueries({ queryKey: ['ntrip-acl', detail?.id] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Lưu ACL thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(account: NtripAccount) {
    setEditing(account);
    setForm({
      username: account.username,
      password: '',
      enabled: account.enabled,
      max_connections: account.maxConnections,
      company: account.company ?? '',
      contact_name: account.contactName ?? '',
      email: account.email ?? '',
      phone: account.phone ?? '',
      valid_from: account.validFrom ? account.validFrom.slice(0, 16) : '',
      valid_to: account.validTo ? account.validTo.slice(0, 16) : '',
      available_area: account.availableArea ?? '',
      auth_method: account.authMethod ?? 'basic',
      notes: account.notes ?? ''
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
        title="Tài khoản NTRIP"
        description="Tài khoản xác thực caster/rover, tách biệt tài khoản web."
        actions={
          can('ntrip_accounts', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm tài khoản
            </Button>
          )
        }
      />

      <div className="panel">
        <div className="table-head">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm username" />
          <Button variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
            Tải lại
          </Button>
        </div>
        <DataTable
          items={list.data?.items ?? []}
          rowKey={(account) => account.id}
          loading={list.isLoading}
          error={list.isError ? 'Không tải được tài khoản NTRIP.' : undefined}
          empty="Chưa có tài khoản NTRIP nào."
          onRowClick={setDetail}
          columns={[
            {
              key: 'username',
              header: 'Username',
              cell: (account) => <span className="mono">{account.username}</span>
            },
            {
              key: 'enabled',
              header: 'Trạng thái',
              cell: (account) => (
                <StatusBadge
                  label={account.enabled ? 'enabled' : 'locked'}
                  kind={account.enabled ? 'ok' : 'warn'}
                />
              )
            },
            {
              key: 'max',
              header: 'Max conn',
              align: 'right',
              cell: (account) => account.maxConnections
            },
            {
              key: 'company',
              header: 'Công ty',
              hideOnMobile: true,
              cell: (account) => (
                <div>
                  <div>{account.company || '—'}</div>
                  <div className="muted table-subline">
                    {account.contactName || account.email || account.phone || '—'}
                  </div>
                </div>
              )
            },
            {
              key: 'validity',
              header: 'Hiệu lực',
              hideOnMobile: true,
              cell: (account) =>
                account.validFrom || account.validTo
                  ? `${account.validFrom ? new Date(account.validFrom).toLocaleDateString('vi-VN') : '—'} → ${
                      account.validTo ? new Date(account.validTo).toLocaleDateString('vi-VN') : '—'
                    }`
                  : 'Không giới hạn'
            },
            {
              key: 'owner',
              header: 'Owner',
              hideOnMobile: true,
              cell: (account) => <span className="muted">{account.ownerWebUserId ?? '—'}</span>
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (account) => (
                <div className="row-actions">
                  {can('ntrip_accounts', 'edit') && (
                    <>
                      <IconButton
                        label={`Sửa ${account.username}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(account);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={account.enabled ? `Khóa ${account.username}` : `Mở khóa ${account.username}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.mutate({
                            account,
                            action: account.enabled ? 'lock' : 'unlock'
                          });
                        }}
                      >
                        {account.enabled ? <Lock size={16} aria-hidden="true" /> : <Unlock size={16} aria-hidden="true" />}
                      </IconButton>
                    </>
                  )}
                  {can('ntrip_accounts', 'delete') && (
                    <IconButton
                      label={`Xóa ${account.username}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(account);
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
          total={list.data?.total ?? 0}
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
        title={editing ? 'Sửa tài khoản NTRIP' : 'Thêm tài khoản NTRIP'}
        description="Mật khẩu chỉ dùng để xác thực Basic; không hiển thị lại."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="ntrip-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Thêm'}
            </Button>
          </>
        }
      >
        <form
          id="ntrip-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <Field label="Username" error={error || undefined}>
            <Input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </Field>
          <Field label={editing ? 'Mật khẩu mới (bỏ trống để giữ)' : 'Mật khẩu'}>
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required={!editing}
              minLength={8}
            />
          </Field>
          <Field label="Max connections">
            <Input
              type="number"
              min={1}
              max={1000}
              value={form.max_connections}
              onChange={(event) =>
                setForm({ ...form, max_connections: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Công ty">
            <Input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
          </Field>
          <Field label="Người liên hệ">
            <Input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label="Điện thoại">
            <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label="Hiệu lực từ">
            <Input type="datetime-local" value={form.valid_from} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} />
          </Field>
          <Field label="Hiệu lực đến">
            <Input type="datetime-local" value={form.valid_to} onChange={(event) => setForm({ ...form, valid_to: event.target.value })} />
          </Field>
          <Field label="Khu vực">
            <Input value={form.available_area} onChange={(event) => setForm({ ...form, available_area: event.target.value })} />
          </Field>
          <Field label="Auth method">
            <Input value={form.auth_method} onChange={(event) => setForm({ ...form, auth_method: event.target.value })} />
          </Field>
          <Field label="Ghi chú">
            <Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            Bật tài khoản
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.username ?? 'Chi tiết tài khoản NTRIP'}
        description="Thông tin tài khoản và ACL mountpoint."
        side="right"
        footer={
          detail && (
            <>
              {can('ntrip_accounts', 'edit') && (
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
          <>
            <dl className="facts">
              <div>
                <dt>Trạng thái</dt>
                <dd>{detail.enabled ? 'enabled' : 'locked'}</dd>
              </div>
              <div>
                <dt>Max connections</dt>
                <dd>{detail.maxConnections}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{detail.ownerWebUserId ?? '—'}</dd>
              </div>
              <div>
                <dt>Công ty</dt>
                <dd>{detail.company || '—'}</dd>
              </div>
              <div>
                <dt>Liên hệ</dt>
                <dd>{[detail.contactName, detail.email, detail.phone].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
              <div>
                <dt>Hiệu lực</dt>
                <dd>
                  {detail.validFrom || detail.validTo
                    ? `${detail.validFrom ? new Date(detail.validFrom).toLocaleString('vi-VN') : '—'} → ${
                        detail.validTo ? new Date(detail.validTo).toLocaleString('vi-VN') : '—'
                      }`
                    : 'Không giới hạn'}
                </dd>
              </div>
              <div>
                <dt>Khu vực</dt>
                <dd>{detail.availableArea || '—'}</dd>
              </div>
              <div>
                <dt>Auth method</dt>
                <dd>{detail.authMethod || '—'}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd>{detail.notes || '—'}</dd>
              </div>
            </dl>
            <div className="panel">
              <div className="table-head">
                <h2>ACL mountpoint</h2>
                {can('ntrip_accounts', 'edit') && (
                  <Button size="sm" onClick={() => saveAcl.mutate()} loading={saveAcl.isPending}>
                    <KeyRound size={14} aria-hidden="true" /> Lưu ACL
                  </Button>
                )}
              </div>
              {mountpoints.data?.items.length ? (
                <div className="check-list">
                  {mountpoints.data.items.map((mountpoint) => (
                    <label className="check" key={mountpoint.id}>
                      <input
                        type="checkbox"
                        checked={aclIds.includes(mountpoint.id)}
                        disabled={!can('ntrip_accounts', 'edit')}
                        onChange={(event) =>
                          setAclIds((current) =>
                            event.target.checked
                              ? [...current, mountpoint.id]
                              : current.filter((id) => id !== mountpoint.id)
                          )
                        }
                      />
                      <span className="mono">{mountpoint.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">Chưa có mountpoint hoặc chưa có quyền xem.</p>
              )}
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa tài khoản NTRIP?"
        description={`Tài khoản ${deleteTarget?.username ?? ''} sẽ bị xóa.`}
        pending={action.isPending}
        onConfirm={() => deleteTarget && action.mutate({ account: deleteTarget, action: 'delete' })}
      />
    </section>
  );
}
