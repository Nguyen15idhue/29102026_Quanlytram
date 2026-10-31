import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { apiFetch, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button, Field, Input, PageHeader, StatusBadge } from '../components/ui';
import { useToast } from '../components/ToastProvider';

interface Profile {
  id: number;
  username: string;
  displayName: string;
  email: string;
  status: string;
  role: { code: string; name: string; level: number };
  createdAt: string;
  lastLoginAt: string | null;
}

interface SessionItem {
  id: number;
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
}

export function Profile() {
  const { csrfToken } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<{ item: Profile }>('/api/profile')
  });
  const sessions = useQuery({
    queryKey: ['profile-sessions'],
    queryFn: () => apiFetch<{ items: SessionItem[] }>('/api/profile/sessions')
  });

  const current = profile.data?.item;
  useEffect(() => {
    if (!current) return;
    setDisplayName(current.displayName);
    setEmail(current.email);
  }, [current]);

  const saveProfile = useMutation({
    mutationFn: () =>
      apiFetch('/api/profile', {
        method: 'PATCH',
        body: { display_name: displayName, email },
        csrfToken
      }),
    onSuccess: async () => {
      push('Đã cập nhật hồ sơ', 'success');
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Lưu thất bại', 'error')
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch('/api/profile/password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
        csrfToken
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      push('Đã đổi mật khẩu', 'success');
    },
    onError: (err) => push(err instanceof ApiClientError ? err.message : 'Đổi mật khẩu thất bại', 'error')
  });

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    saveProfile.mutate();
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      push('Mật khẩu xác nhận không khớp', 'error');
      return;
    }
    changePassword.mutate();
  }

  return (
    <section className="page">
      <PageHeader
        title="Trang cá nhân"
        description="Cập nhật hồ sơ và đổi mật khẩu."
        actions={<UserRound size={20} className="muted" aria-hidden="true" />}
      />
      <div className="panel">
        <h2>Hồ sơ</h2>
        {current && (
          <dl className="facts">
            <div><dt>Tài khoản</dt><dd className="mono">{current.username}</dd></div>
            <div><dt>Vai trò</dt><dd>{current.role.name} · {current.role.code}</dd></div>
            <div><dt>Trạng thái</dt><dd><StatusBadge label={current.status} kind="ok" /></dd></div>
            <div><dt>Đăng nhập cuối</dt><dd className="mono">{current.lastLoginAt ? new Date(current.lastLoginAt).toLocaleString('vi-VN') : '—'}</dd></div>
          </dl>
        )}
        <form className="form-grid" onSubmit={submitProfile}>
          <Field label="Tên hiển thị">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <div className="form-actions">
            <Button variant="primary" type="submit" loading={saveProfile.isPending}>Lưu hồ sơ</Button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Đổi mật khẩu</h2>
        <form className="form-grid" onSubmit={submitPassword}>
          <Field label="Mật khẩu hiện tại">
            <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          </Field>
          <Field label="Mật khẩu mới">
            <Input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </Field>
          <Field label="Xác nhận mật khẩu">
            <Input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </Field>
          <div className="form-actions">
            <Button variant="primary" type="submit" loading={changePassword.isPending}>Đổi mật khẩu</Button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Phiên đăng nhập</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th className="index-col">STT</th><th>Thiết bị/IP</th><th>Bắt đầu</th><th>Hết hạn</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {(sessions.data?.items ?? []).map((item, index) => (
                <tr key={item.id}>
                  <td className="index-col">{index + 1}</td>
                  <td className="mono">{item.ip || '—'} · {item.userAgent || '—'}</td>
                  <td className="mono">{new Date(item.createdAt).toLocaleString('vi-VN')}</td>
                  <td className="mono">{new Date(item.expiresAt).toLocaleString('vi-VN')}</td>
                  <td>{item.current ? <StatusBadge label="hiện tại" kind="ok" /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
