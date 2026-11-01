import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyGuard } from '../lib/useDirtyGuard';
import { useListParams } from '../lib/useListParams';
import type { Company, Role } from '../types';
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
  StatusBadge,
  TableToolbar
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface CompanyList {
  items: Company[];
  total: number;
  pageSize: number;
  offset: number;
}

interface CompanyUsers {
  items: Array<{
    id: number;
    username: string;
    displayName: string;
    email: string;
    status: string;
    role: Role;
  }>;
  total: number;
}

const emptyForm = { code: '', name: '', notes: '' };

export function Companies() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const { page, pageSize, q, setPage, setPageSize, setQ, getParam, setParam } =
    useListParams();
  const status = getParam('status');
  const activeFilterCount = [status].filter(Boolean).length;
  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      q
    });
    if (status) params.set('status', status);
    return params.toString();
  }, [page, pageSize, q, status]);

  const [formOpen, setFormOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  useDirtyGuard(dirty && formOpen);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [usersTarget, setUsersTarget] = useState<Company | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const companies = useQuery({
    queryKey: ['companies', listQuery],
    queryFn: () => apiFetch<CompanyList>(`/api/companies?${listQuery}`)
  });

  const companyUsers = useQuery({
    queryKey: ['company-users', usersTarget?.id],
    queryFn: () => apiFetch<CompanyUsers>(`/api/companies/${usersTarget?.id}/users?pageSize=50`),
    enabled: Boolean(usersTarget?.id)
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch(editing ? `/api/companies/${editing.id}` : '/api/companies', {
        method: editing ? 'PATCH' : 'POST',
        csrfToken,
        body: editing
          ? { name: form.name, notes: form.notes }
          : { code: form.code, name: form.name, notes: form.notes }
      }),
    onSuccess: async () => {
      setFormOpen(false);
      setDirty(false);
      setEditing(null);
      setError('');
      push(editing ? 'Đã cập nhật công ty' : 'Đã tạo công ty', 'success');
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Lưu công ty thất bại')
  });

  const action = useMutation({
    mutationFn: ({ company, action }: { company: Company; action: 'enable' | 'disable' | 'delete' }) =>
      apiFetch(
        action === 'delete'
          ? `/api/companies/${company.id}`
          : `/api/companies/${company.id}/${action}`,
        { method: action === 'delete' ? 'DELETE' : 'POST', csrfToken }
      ),
    onSuccess: async (_data, variables) => {
      setDeleteTarget(null);
      push(
        variables.action === 'delete'
          ? 'Đã xóa công ty'
          : variables.action === 'disable'
            ? 'Đã vô hiệu hóa công ty'
            : 'Đã kích hoạt công ty',
        'success'
      );
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) =>
      push(err instanceof ApiClientError ? err.message : 'Thao tác thất bại', 'error')
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(company: Company) {
    setEditing(company);
    setForm({ code: company.code, name: company.name, notes: company.notes });
    setError('');
    setDirty(false);
    setFormOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="page">
      <PageHeader
        title="Công ty"
        description="Mỗi công ty có nhiều admin cùng quản lý tài nguyên; chỉ super admin quản lý công ty."
        actions={
          can('companies', 'add') && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Thêm công ty
            </Button>
          )
        }
      />

      <div className="panel">
        <TableToolbar
          search={<SearchInput value={q} onChange={setQ} placeholder="Tìm mã hoặc tên công ty" />}
          activeFilterCount={activeFilterCount}
          actions={
            <Button variant="ghost" onClick={() => companies.refetch()} loading={companies.isFetching}>
              Tải lại
            </Button>
          }
        >
          <Field label="Trạng thái">
            <Select value={status} onChange={(event) => setParam('status', event.target.value || null)}>
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="disabled">Đã vô hiệu hóa</option>
            </Select>
          </Field>
        </TableToolbar>
        <DataTable
          items={companies.data?.items ?? []}
          rowKey={(company) => company.id}
          loading={companies.isLoading}
          error={companies.isError ? 'Không tải được danh sách công ty.' : undefined}
          empty="Chưa có công ty."
          columns={[
            {
              key: 'code',
              header: 'Mã',
              cell: (company) => (
                <button type="button" className="link-btn mono" onClick={() => openEdit(company)}>
                  {company.code}
                </button>
              )
            },
            {
              key: 'name',
              header: 'Tên công ty',
              cell: (company) => (
                <div>
                  <div>{company.name}</div>
                  <div className="muted table-subline">{company.notes || '—'}</div>
                </div>
              )
            },
            {
              key: 'users',
              header: 'Người dùng',
              hideOnMobile: true,
              cell: (company) => (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setUsersTarget(company)}
                >
                  {company.userCount}
                </button>
              )
            },
            {
              key: 'status',
              header: 'Trạng thái',
              cell: (company) => (
                <StatusBadge
                  label={company.status === 'active' ? 'active' : 'disabled'}
                  kind={company.status === 'active' ? 'ok' : 'warn'}
                />
              )
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (company) => (
                <div className="row-actions">
                  {can('companies', 'edit') && (
                    <>
                      <IconButton label={`Sửa ${company.name}`} onClick={() => openEdit(company)}>
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={
                          company.status === 'active'
                            ? `Vô hiệu hóa ${company.name}`
                            : `Kích hoạt ${company.name}`
                        }
                        onClick={() =>
                          action.mutate({
                            company,
                            action: company.status === 'active' ? 'disable' : 'enable'
                          })
                        }
                      >
                        {company.status === 'active' ? (
                          <Ban size={16} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        )}
                      </IconButton>
                    </>
                  )}
                  {can('companies', 'delete') && (
                    <IconButton
                      label={`Xóa ${company.name}`}
                      onClick={() => setDeleteTarget(company)}
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
          total={companies.data?.total ?? 0}
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
        title={editing ? 'Sửa công ty' : 'Thêm công ty'}
        description="Mã công ty dùng một lần, không đổi sau khi tạo."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="company-form" loading={save.isPending}>
              {editing ? 'Cập nhật' : 'Tạo'}
            </Button>
          </>
        }
      >
        <form
          id="company-form"
          className="form-grid"
          onSubmit={submit}
          onChange={() => setDirty(true)}
        >
          <Field label="Mã công ty" error={error || undefined}>
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              disabled={Boolean(editing)}
              pattern="[A-Za-z0-9_.-]+"
              required
            />
          </Field>
          <Field label="Tên công ty">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Ghi chú">
            <Input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(usersTarget)}
        onOpenChange={(open) => !open && setUsersTarget(null)}
        title={usersTarget ? `Người dùng · ${usersTarget.name}` : 'Người dùng công ty'}
        description="Danh sách tài khoản thuộc công ty."
        side="right"
        footer={
          <Button variant="ghost" onClick={() => setUsersTarget(null)}>
            Đóng
          </Button>
        }
      >
        {companyUsers.isLoading && <p className="muted">Đang tải…</p>}
        {companyUsers.isError && <p className="form-error">Không tải được người dùng.</p>}
        {companyUsers.data && companyUsers.data.items.length === 0 && (
          <p className="muted">Công ty chưa có người dùng.</p>
        )}
        {companyUsers.data && companyUsers.data.items.length > 0 && (
          <ul className="fact-list">
            {companyUsers.data.items.map((user) => (
              <li key={user.id}>
                <Users size={16} aria-hidden="true" />
                <div>
                  <div>
                    <strong>{user.displayName}</strong> <span className="mono muted">({user.username})</span>
                  </div>
                  <div className="muted table-subline">
                    {user.role.name} · {user.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa công ty?"
        description={`Công ty ${deleteTarget?.name ?? ''} chỉ xóa được khi không còn người dùng hoặc tài nguyên.`}
        pending={action.isPending}
        onConfirm={() =>
          deleteTarget && action.mutate({ company: deleteTarget, action: 'delete' })
        }
      />
    </section>
  );
}
