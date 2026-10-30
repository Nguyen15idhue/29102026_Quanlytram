import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ApiClientError } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1 className="login-title">Quản lý trạm CORS</h1>
            <small>Đăng nhập quản trị</small>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        <Field label="Tên đăng nhập">
          <Input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </Field>
        <Field label="Mật khẩu">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>
          Đăng nhập
        </Button>
      </form>
    </div>
  );
}
