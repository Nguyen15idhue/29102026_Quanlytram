import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Role, Scope } from '../types';
import {
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge
} from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface RoleList {
  items: Role[];
}

interface PermissionRow {
  code: string;
  module: string;
  action: string;
  description: string;
  scope: Scope;
}

interface RolePermissions {
  role: Role;
  permissions: PermissionRow[];
}

const emptyRole = { code: '', name: '', level: 20, description: '' };

export function Roles() {
  const { can, csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState(emptyRole);
  const [error, setError] = useState('');

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleList>('/api/roles')
  });

  useEffect(() => {
    if (selectedId === null && roles.data?.items.length) {
      setSelectedId(roles.data.items[0].id);
    }
  }, [roles.data, selectedId]);

  const selected = roles.data?.items.find((role) => role.id === selectedId) ?? null;

  const detail = useQuery({
    queryKey: ['role-permissions', selectedId],
    queryFn: () => apiFetch<RolePermissions>(`/api/roles/${selectedId}/permissions`),
    enabled: selectedId !== null
  });

  useEffect(() => {
    if (!detail.data) return;
    const next: Record<string, Scope> = {};
    for (const permission of detail.data.permissions) next[permission.code] = permission.scope;
    setScopes(next);
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/roles/${selectedId}/permissions`, {
        method: 'PUT',
        csrfToken,
        body: {
          permissions: Object.entries(scopes).map(([code, scope]) => ({ code, scope }))
        }
      }),
    onSuccess: async () => {
      push('Đã lưu quyền', 'success');
      await queryClient.invalidateQueries({ queryKey: ['role-permissions', selectedId] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Lưu quyền thất bại', 'error')
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/roles', {
        method: 'POST',
        csrfToken,
        body: {
          code: newRole.code,
          name: newRole.name,
          level: Number(newRole.level),
          description: newRole.description
        }
      }),
    onSuccess: async () => {
      setFormOpen(false);
      setNewRole(emptyRole);
      setError('');
      push('Đã tạo role', 'success');
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Tạo role thất bại')
  });

  const remove = useMutation({
    mutationFn: (role: Role) => apiFetch(`/api/roles/${role.id}`, { method: 'DELETE', csrfToken }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setSelectedId(null);
      push('Đã xóa role', 'success');
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Xóa role thất bại', 'error')
  });

  const grouped = useMemo(() => {
    const rows = detail.data?.permissions ?? [];
    const map = new Map<string, PermissionRow[]>();
    for (const row of rows) {
      const list = map.get(row.module) ?? [];
      list.push(row);
      map.set(row.module, list);
    }
    return Array.from(map.entries());
  }, [detail.data]);

  function createRole(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="page">
      <PageHeader
        title="Vai trò & quyền"
        description="Ma trận view/add/edit/delete + scope all/subtree/own."
        actions={
          can('roles', 'add') && (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Tạo role
            </Button>
          )
        }
      />

      <div className="split">
        <aside className="panel role-list">
          <h2>Roles</h2>
          {roles.isLoading ? (
            <p className="muted">Đang tải...</p>
          ) : (
            <ul>
              {roles.data?.items.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    className={`role-item ${role.id === selectedId ? 'active' : ''}`}
                    onClick={() => setSelectedId(role.id)}
                  >
                    <span>
                      <strong>{role.name}</strong>
                      <small className="mono">{role.code}</small>
                    </span>
                    <StatusBadge label={String(role.level)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article className="panel">
          {!selected ? (
            <p className="muted">Chọn một role.</p>
          ) : detail.isLoading ? (
            <p className="muted">Đang tải quyền...</p>
          ) : (
            <>
              <div className="table-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted mono">{selected.code}</p>
                </div>
                <div className="row-actions">
                  {Number(selected.is_system) === 1 && <StatusBadge label="Hệ thống" />}
                  {can('roles', 'delete') && Number(selected.is_system) === 0 && (
                    <IconButton
                      label={`Xóa role ${selected.code}`}
                      onClick={() => setDeleteTarget(selected)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Hành động</th>
                      <th>Mã quyền</th>
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(([module, rows]) =>
                      rows.map((row, index) => (
                        <tr key={row.code}>
                          <td>{index === 0 ? module : ''}</td>
                          <td>{row.action}</td>
                          <td className="mono muted">{row.code}</td>
                          <td>
                            <Select
                              value={scopes[row.code] ?? 'none'}
                              disabled={Number(selected.is_system) === 1 || !can('roles', 'edit')}
                              onChange={(event) =>
                                setScopes({ ...scopes, [row.code]: event.target.value as Scope })
                              }
                            >
                              <option value="none">none</option>
                              <option value="own">own</option>
                              <option value="subtree">subtree</option>
                              <option value="all">all</option>
                            </Select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {Number(selected.is_system) === 0 && can('roles', 'edit') && (
                <div className="form-actions">
                  <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
                    Lưu quyền
                  </Button>
                </div>
              )}
            </>
          )}
        </article>
      </div>

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setNewRole(emptyRole);
            setError('');
          }
        }}
        title="Tạo role"
        description="Role custom có level 1–99."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" type="submit" form="role-form" loading={create.isPending}>
              Tạo role
            </Button>
          </>
        }
      >
        <form id="role-form" className="form-grid" onSubmit={createRole}>
          <Field label="Code" error={error || undefined}>
            <Input
              value={newRole.code}
              onChange={(event) => setNewRole({ ...newRole, code: event.target.value })}
              placeholder="operator"
              required
            />
          </Field>
          <Field label="Tên">
            <Input
              value={newRole.name}
              onChange={(event) => setNewRole({ ...newRole, name: event.target.value })}
              required
            />
          </Field>
          <Field label="Level">
            <Input
              type="number"
              min={1}
              max={99}
              value={newRole.level}
              onChange={(event) => setNewRole({ ...newRole, level: Number(event.target.value) })}
            />
          </Field>
          <Field label="Mô tả">
            <Input
              value={newRole.description}
              onChange={(event) => setNewRole({ ...newRole, description: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Xóa role?"
        description={`Role ${deleteTarget?.code ?? ''} sẽ bị xóa.`}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </section>
  );
}
