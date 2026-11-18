import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Loader2, LogIn, Shapes, UserPlus } from 'lucide-react';
import { useAuth } from '@/app/auth-store';
import { ApiError } from '@/app/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** `/login?next=/path`: sign in, or create an account when the server allows it. */
export function LoginPage() {
  const { status, signupOpen, login, signup } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/studio';
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signed-in') return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, name);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 rounded-xl border bg-card/40 p-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Shapes className="size-4" />
          </span>
          <div>
            <h1 className="font-semibold">{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h1>
            <p className="text-xs text-muted-foreground">Đồng bộ dự án, chia sẻ link, gửi điểm leaderboard.</p>
          </div>
        </div>
        {status === 'offline' && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            Không kết nối được server (`pnpm dev:server`). Ứng dụng vẫn chạy ở chế độ cục bộ.
          </p>
        )}
        {mode === 'signup' && (
          <div className="grid gap-1.5">
            <Label htmlFor="name">Tên hiển thị</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Mật khẩu</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={mode === 'signup' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || status === 'offline'}>
          {busy ? <Loader2 className="animate-spin" /> : mode === 'login' ? <LogIn /> : <UserPlus />}
          {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </Button>
        {signupOpen ? (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Chưa có tài khoản? Tạo mới' : 'Đã có tài khoản? Đăng nhập'}
          </button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Tài khoản do quản trị viên tạo: <code>pnpm --filter server cli create-user</code>
          </p>
        )}
        <Link to="/learn" className="text-center text-xs text-muted-foreground hover:text-foreground">
          Tiếp tục không đăng nhập
        </Link>
      </form>
    </div>
  );
}
