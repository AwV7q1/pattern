import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { LogOut, Monitor, Trash2, UserRound } from 'lucide-react';
import { api, ApiError } from '@/app/api';
import { useAuth, type User } from '@/app/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { BackLink } from '@/components/BackLink';

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

const when = (s: string) => new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const device = (ua: string | null) => {
  if (!ua) return 'Không rõ';
  const browser = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Trình duyệt';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
};

/** `/account`: profile, password and signed-in devices. */
export function AccountPage() {
  const { status, user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName ?? '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const loadSessions = useCallback(() => api<SessionRow[]>('/auth/sessions').then(setSessions).catch(() => {}), []);
  useEffect(() => {
    if (status === 'signed-in') void loadSessions();
  }, [status, loadSessions]);
  useEffect(() => setName(user?.displayName ?? ''), [user]);

  if (status === 'unknown') return null;
  if (status !== 'signed-in' || !user) return <Navigate to="/login?next=/account" replace />;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-2xl gap-6 px-6 py-8">
        <BackLink label="Quay lại" className="-mb-4 -ml-3 justify-self-start" />
        <div className="flex items-center gap-3">
          <UserRound className="size-6" />
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">{user.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {user.email} {user.role === 'admin' && <Badge variant="secondary">admin</Badge>}
            </p>
          </div>
          <Button variant="outline" onClick={() => logout().then(() => navigate('/learn'))}>
            <LogOut /> Đăng xuất
          </Button>
        </div>
        {msg && <p className={msg.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{msg.text}</p>}

        <section className="grid gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Tên hiển thị (trên leaderboard)</h2>
          <div className="flex gap-2">
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <Button
              disabled={!name.trim() || name === user.displayName}
              onClick={() =>
                run(async () => {
                  const r = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { displayName: name } });
                  setUser(r.user);
                }, 'Đã đổi tên')
              }
            >
              Lưu
            </Button>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Đổi mật khẩu</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cur">Mật khẩu hiện tại</Label>
              <Input id="cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new">Mật khẩu mới (8+ ký tự)</Label>
              <Input id="new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
          </div>
          <Button
            className="justify-self-start"
            disabled={!pw.current || pw.next.length < 8}
            onClick={() =>
              run(async () => {
                await api('/auth/password', { body: pw });
                setPw({ current: '', next: '' });
                await loadSessions();
              }, 'Đã đổi mật khẩu, các thiết bị khác đã bị đăng xuất')
            }
          >
            Đổi mật khẩu
          </Button>
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Thiết bị đang đăng nhập</h2>
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 text-sm">
              <Monitor className="size-4 text-muted-foreground" />
              <div className="mr-auto">
                <div>
                  {device(s.userAgent)} {s.current && <Badge variant="secondary">thiết bị này</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.ip ?? '—'} · hoạt động {when(s.lastSeenAt)} · từ {when(s.createdAt)}
                </div>
              </div>
              {!s.current && (
                <Button size="icon-sm" variant="ghost" aria-label="Đăng xuất thiết bị" onClick={() => run(async () => {
                  await api(`/auth/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
                  await loadSessions();
                }, 'Đã đăng xuất thiết bị')}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
